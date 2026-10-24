// SPDX-License-Identifier: GPL-2.0-or-later
// Componente de balão: campo de texto + lista, aberto junto de um ponto da tela.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';

const MARGEM = 6;

// opcoes:
//   titulo, dica (placeholder), texto (inicial), rodape
//   ponto: {x, y, width, height} — retângulo do cursor/mouse
//   itens(filtro) → [{icone, rotulo, legenda?, ...}] ou Promise disso
//   aoEscolher(item, filtro) — chamado depois que o balão fecha
//   aoTecla(item, simbolo, estado) → true se tratou (a lista é recarregada)
//   aoFechar()
export class Balao {
    constructor(opcoes) {
        this._o = opcoes;
        this._itens = [];
        this._linhas = [];
        this._indice = 0;
        this._geracao = 0;
        this._arrasto = null;

        // Fundo transparente na tela toda: recebe o clique fora (fecha) e o arrasto.
        this._fundo = new St.Widget({
            reactive: true,
            x: 0, y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });
        this._fundo.connect('button-press-event', (_a, evento) => {
            if (global.stage.get_event_actor(evento) === this._fundo)
                this.fechar();
            return Clutter.EVENT_STOP;
        });
        this._fundo.connect('motion-event', (_a, evento) => {
            if (!this._arrasto)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = evento.get_coords();
            this._caixa.set_position(Math.round(x - this._arrasto[0]), Math.round(y - this._arrasto[1]));
            return Clutter.EVENT_STOP;
        });
        this._fundo.connect('button-release-event', () => {
            this._arrasto = null;
            return Clutter.EVENT_PROPAGATE;
        });

        this._caixa = new St.BoxLayout({vertical: true, style_class: 'pl-balao', reactive: true});
        this._fundo.add_child(this._caixa);

        const titulo = new St.Label({text: opcoes.titulo, style_class: 'pl-titulo', reactive: true});
        titulo.connect('button-press-event', (_a, evento) => {
            const [x, y] = evento.get_coords();
            this._arrasto = [x - this._caixa.x, y - this._caixa.y];
            this._movido = true;
            return Clutter.EVENT_STOP;
        });
        this._caixa.add_child(titulo);

        this._entrada = new St.Entry({
            style_class: 'pl-entrada',
            hint_text: opcoes.dica ?? '',
            text: opcoes.texto ?? '',
            can_focus: true,
            x_expand: true,
        });
        this._entrada.clutter_text.connect('text-changed', () => this._recarregar());
        this._entrada.clutter_text.connect('key-press-event', (_a, evento) => this._tecla(evento));
        this._caixa.add_child(this._entrada);

        this._lista = new St.BoxLayout({vertical: true});
        this._rolagem = new St.ScrollView({
            style_class: 'pl-rolagem',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._lista,
        });
        this._caixa.add_child(this._rolagem);

        if (opcoes.rodape)
            this._caixa.add_child(new St.Label({text: opcoes.rodape, style_class: 'pl-dica'}));

        Main.uiGroup.add_child(this._fundo);
        this._grab = Main.pushModal(this._fundo, {actionMode: Shell.ActionMode.POPUP});
        if (!(this._grab.get_seat_state() & Clutter.GrabState.KEYBOARD)) {
            this.fechar();
            return;
        }
        this._entrada.clutter_text.set_selection(0, -1);
        this._entrada.grab_key_focus();
        this._recarregar();
    }

    get aberto() {
        return !!this._fundo;
    }

    get texto() {
        return this._entrada.get_text();
    }

    fechar() {
        if (!this._fundo)
            return;
        if (this._grab)
            Main.popModal(this._grab);
        this._fundo.destroy();
        this._fundo = this._grab = null;
        this._o.aoFechar?.();
    }

    async _recarregar() {
        const geracao = ++this._geracao;
        const filtro = this._entrada.get_text();
        let itens;
        try {
            itens = await this._o.itens(filtro);
        } catch (e) {
            logError(e, 'balao: itens do balão');
            itens = [];
        }
        // Chegou resposta de um filtro antigo, ou o balão já fechou.
        if (geracao !== this._geracao || !this._fundo)
            return;
        this._itens = itens;
        this._desenhar();
    }

    _desenhar() {
        this._lista.destroy_all_children();
        this._linhas = this._itens.map((item, i) => {
            const linha = new St.Button({style_class: 'pl-item', x_expand: true, can_focus: false});
            const caixa = new St.BoxLayout({x_expand: true, style: 'spacing: 8px;'});
            if (item.icone)
                caixa.add_child(new St.Icon({icon_name: item.icone, style_class: 'pl-item-icone', y_align: Clutter.ActorAlign.CENTER}));
            const textos = new St.BoxLayout({vertical: true, x_expand: true});
            const rotulo = new St.Label({text: item.rotulo});
            rotulo.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            textos.add_child(rotulo);
            if (item.legenda)
                textos.add_child(new St.Label({text: item.legenda, style_class: 'pl-item-legenda'}));
            caixa.add_child(textos);
            linha.set_child(caixa);
            linha.connect('clicked', () => {
                this._indice = i;
                this._ativar();
            });
            // motion, não enter: o balão pode surgir embaixo do ponteiro parado.
            linha.connect('motion-event', () => {
                if (this._indice !== i)
                    this._selecionar(i);
                return Clutter.EVENT_PROPAGATE;
            });
            this._lista.add_child(linha);
            return linha;
        });
        if (!this._itens.length)
            this._lista.add_child(new St.Label({text: this._o.vazio ?? 'Nada aqui', style_class: 'pl-vazio'}));
        this._selecionar(Math.min(this._indice, this._itens.length - 1));
        this._posicionar();
    }

    _selecionar(i) {
        this._linhas[this._indice]?.remove_style_pseudo_class('selected');
        this._indice = Math.max(0, i);
        const linha = this._linhas[this._indice];
        if (!linha)
            return;
        linha.add_style_pseudo_class('selected');
        ensureActorVisibleInScrollView(this._rolagem, linha);
    }

    _mover(delta) {
        if (!this._itens.length)
            return;
        const n = this._itens.length;
        this._selecionar(Math.min(n - 1, Math.max(0, this._indice + delta)));
    }

    _ativar() {
        const item = this._itens[this._indice];
        if (!item)
            return;
        const filtro = this.texto;
        this.fechar();
        this._o.aoEscolher(item, filtro);
    }

    _tecla(evento) {
        const simbolo = evento.get_key_symbol();
        const estado = evento.get_state();
        switch (simbolo) {
        case Clutter.KEY_Escape:
            this.fechar();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._mover(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
        case Clutter.KEY_Tab:
            this._mover(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_ISO_Left_Tab:
            this._mover(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._mover(-8);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._mover(8);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            this._ativar();
            return Clutter.EVENT_STOP;
        }
        if (this._o.aoTecla?.(this._itens[this._indice], simbolo, estado)) {
            this._recarregar();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // Abaixo do ponto; se não couber, acima. Sempre dentro do monitor do ponto.
    _posicionar() {
        if (this._movido)
            return;
        const p = this._o.ponto;
        const monitores = Main.layoutManager.monitors;
        const m = monitores.find(mo => p.x >= mo.x && p.x < mo.x + mo.width && p.y >= mo.y && p.y < mo.y + mo.height) ??
            Main.layoutManager.primaryMonitor;
        const [, largura] = this._caixa.get_preferred_width(-1);
        const [, altura] = this._caixa.get_preferred_height(largura);

        let y = p.y + p.height + MARGEM;
        if (y + altura > m.y + m.height)
            y = Math.max(m.y, p.y - altura - MARGEM);
        const x = Math.min(Math.max(p.x, m.x), m.x + m.width - largura);
        this._caixa.set_position(Math.round(x), Math.round(y));
    }
}
