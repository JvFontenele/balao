// SPDX-License-Identifier: GPL-2.0-or-later
// Notch do Nexus: pílula sob o relógio que abre um painel com o dispositivo e os controles. Só existe com o Nexus ativo.
import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Shell from 'gi://Shell';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {formatarCodigo} from './nexus.js';

const BRANCO = [0.953, 0.957, 0.969];
const ESCURO = [0.078, 0.086, 0.106];
const CINZA = [0.788, 0.8, 0.831];
const AZUL = [0.557, 0.659, 1];

function elipse(cr, cx, cy, rx, ry) {
    cr.save();
    cr.translate(cx, cy);
    cr.scale(rx, ry);
    cr.newSubPath();
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
}

function arco(cr, cx, cy, r, de, ate) {
    cr.newPath();
    cr.arc(cx, cy, r, de * Math.PI, ate * Math.PI);
    cr.stroke();
}

// O Nexo nas mesmas coordenadas do design (viewBox 96×76); só olhos e boca mudam com a expressão.
export function desenharNexo(cr, largura, altura, expr) {
    cr.scale(largura / 96, altura / 76);
    const [x, y, w, h, r] = [4, 6, 88, 64, 26];
    cr.newPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
    cr.setSourceRGB(...(expr === 'dormindo' ? CINZA : BRANCO));
    cr.fill();

    cr.setSourceRGB(...ESCURO);
    cr.setLineWidth(5);
    cr.setLineCap(Cairo.LineCap.ROUND);
    switch (expr) {
    case 'feito':
        arco(cr, 36, 45, 7, 1.15, 1.85);
        arco(cr, 60, 45, 7, 1.15, 1.85);
        break;
    case 'curtindo':
        arco(cr, 36, 33, 7, 0.15, 0.85);
        arco(cr, 60, 33, 7, 0.15, 0.85);
        cr.setSourceRGB(...AZUL);
        cr.setLineWidth(3);
        cr.newPath();
        cr.moveTo(78, 4);
        cr.lineTo(78, 16);
        cr.stroke();
        elipse(cr, 75, 17, 4, 4);
        cr.fill();
        break;
    case 'atento':
        elipse(cr, 36, 38, 9, 9);
        elipse(cr, 60, 38, 9, 9);
        cr.fill();
        cr.setSourceRGB(...BRANCO);
        elipse(cr, 39, 35, 3, 3);
        elipse(cr, 63, 35, 3, 3);
        cr.fill();
        break;
    case 'surpreso':
        elipse(cr, 36, 36, 7, 7);
        elipse(cr, 60, 36, 7, 7);
        elipse(cr, 48, 54, 5, 6);
        cr.fill();
        break;
    case 'dormindo':
        cr.newPath();
        cr.moveTo(30, 40);
        cr.lineTo(42, 40);
        cr.moveTo(54, 40);
        cr.lineTo(66, 40);
        cr.stroke();
        cr.setSourceRGB(0.557, 0.573, 0.616);
        cr.setLineWidth(2.4);
        cr.newPath();
        cr.moveTo(74, 8);
        cr.lineTo(82, 8);
        cr.lineTo(74, 17);
        cr.lineTo(82, 17);
        cr.stroke();
        break;
    default: // conectado
        elipse(cr, 36, 38, 5.5, 8);
        elipse(cr, 60, 38, 5.5, 8);
        cr.fill();
    }
}

function nexo(largura, altura, expressao) {
    // alinhado ao centro: sem isso a área estica com a linha e o Nexo deforma
    const area = new St.DrawingArea({width: largura, height: altura, x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER});
    area.connect('repaint', a => {
        const cr = a.get_context();
        const [sw, sh] = a.get_surface_size();
        desenharNexo(cr, sw, sh, expressao());
        cr.$dispose();
    });
    return area;
}

function rotulo(texto, classe) {
    return new St.Label({text: texto, style_class: classe, y_align: Clutter.ActorAlign.CENTER});
}

// Primeira linha livre no topo do monitor: logo abaixo da barra do GNOME se ela estiver no topo; senão a própria borda.
// (Zorin e dash-to-panel podem pôr a barra embaixo ou de lado: aí o notch encosta na borda, sem flutuar.)
export function topoLivre(monitor, barra) {
    if (barra && barra.visivel && barra.altura > 0 && Math.abs(barra.y - monitor.y) <= 2 && barra.largura >= monitor.width / 2)
        return monitor.y + barra.altura;
    return monitor.y;
}

const ANIMACAO = 180;
const ESCONDER_APOS = 2500; // ms sem o mouse em cima, depois de aparecer pelo topo

export class Notch {
    // acoes: {abrirPrincipal()}
    constructor(nexus, acoes) {
        this._n = nexus;
        this._acoes = acoes;
        this._modo = null;
        this._alvoId = null;

        this._pilula = new St.Button({style_class: 'nx-pilula', can_focus: true, accessible_name: 'Nexus'});
        const caixa = new St.BoxLayout({style_class: 'nx-pilula-caixa'});
        this._rosto = nexo(34, 27, () => this._n.expressao);
        this._ponto = new St.Widget({style_class: 'nx-ponto', y_align: Clutter.ActorAlign.CENTER});
        this._onda = new St.Icon({icon_name: 'audio-volume-high-symbolic', style_class: 'nx-onda'});
        caixa.add_child(this._rosto);
        caixa.add_child(this._ponto);
        caixa.add_child(this._onda);
        this._pilula.set_child(caixa);
        this._pilula.connect('clicked', () => this.alternar());
        this._pilula.connect('notify::width', () => this._posicionar());
        this._pilula.connect('enter-event', () => this._cancelarEsconder());
        this._pilula.connect('leave-event', () => this._agendarEsconder(1200));
        this._pilula.visible = false; // só aparece quando chamado ou com o mouse empurrado contra o topo
        Main.layoutManager.addTopChrome(this._pilula);

        // Barreira de pressão no topo (a mesma técnica dos cantos ativos): não rouba cliques da borda,
        // como as abas de um navegador maximizado.
        this._pressao = new Layout.PressureBarrier(60, 1000, Shell.ActionMode.NORMAL);
        this._pressao.connect('trigger', () => this.mostrarPilula());
        this._criarBarreira();
        this._idMonitores = Main.layoutManager.connect('monitors-changed', () => {
            this._criarBarreira();
            this._posicionar();
        });
        this._desligarOuvinte = nexus.conectar(() => this._atualizar());
        this._atualizar();
    }

    destroy() {
        this.fechar();
        this._cancelarEsconder();
        this._desligarOuvinte();
        Main.layoutManager.disconnect(this._idMonitores);
        this._removerBarreira();
        this._pressao.destroy();
        Main.layoutManager.removeChrome(this._pilula);
        this._pilula.destroy();
    }

    get aberto() {
        return !!this._painel;
    }

    // Dispositivo dos controles: o escolhido, senão o primeiro conectado, senão o primeiro pareado.
    get alvo() {
        const ds = this._n.dispositivos;
        return ds.find(d => d.device_id === this._alvoId) ?? ds.find(d => d.conectado) ?? ds[0] ?? null;
    }

    _criarBarreira() {
        this._removerBarreira();
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const centro = m.x + Math.round(m.width / 2);
        this._barreira = new Meta.Barrier({
            backend: global.backend,
            x1: centro - 200, x2: centro + 200, y1: m.y, y2: m.y,
            directions: Meta.BarrierDirection.POSITIVE_Y,
        });
        this._pressao.addBarrier(this._barreira);
    }

    _removerBarreira() {
        if (!this._barreira)
            return;
        this._pressao.removeBarrier(this._barreira);
        this._barreira.destroy();
        this._barreira = null;
    }

    // Pílula desce do topo; some sozinha se o mouse não ficar em cima dela.
    mostrarPilula() {
        if (!this._n.disponivel || this._painel)
            return;
        this._agendarEsconder(ESCONDER_APOS);
        if (this._pilula.visible)
            return;
        this._posicionar();
        this._pilula.set({visible: true, opacity: 0, translation_y: -this._pilula.height});
        this._pilula.ease({opacity: 255, translation_y: 0, duration: ANIMACAO, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    esconderPilula() {
        this._cancelarEsconder();
        if (!this._pilula.visible)
            return;
        this._pilula.ease({opacity: 0, translation_y: -this._pilula.height, duration: ANIMACAO,
            mode: Clutter.AnimationMode.EASE_IN_QUAD, onComplete: () => this._pilula.hide()});
    }

    _agendarEsconder(ms) {
        this._cancelarEsconder();
        this._idEsconder = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._idEsconder = 0;
            if (!this._pilula.hover)
                this.esconderPilula();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelarEsconder() {
        if (this._idEsconder)
            GLib.source_remove(this._idEsconder);
        this._idEsconder = 0;
    }

    _atualizar() {
        if (!this._n.disponivel) {
            this.esconderPilula();
            this.fechar();
            return;
        }
        this._ponto.visible = this._n.dispositivos.some(d => d.conectado);
        this._onda.visible = this._n.dispositivos.some(d => d.audio);
        this._rosto.queue_repaint();
        if (this._n.pareamento && this._modo !== 'pareamento')
            this.abrir('pareamento');
        else if (!this._n.pareamento && this._modo === 'pareamento')
            this.fechar();
        else if (this._n.transferencia && !this._modo)
            this.abrir('arquivo');  // como o pareamento: aparece sem pegar o teclado
        else if (!this._n.transferencia && this._modo === 'arquivo')
            this.fechar();
        else if (this._painel)
            this._montar();
    }

    _posicionar() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const [, by] = Main.layoutManager.panelBox.get_transformed_position();
        const y = topoLivre(m, {visivel: Main.layoutManager.panelBox.visible, y: by,
            largura: Main.layoutManager.panelBox.width, altura: Main.layoutManager.panelBox.height});
        this._pilula.set_position(m.x + Math.round((m.width - this._pilula.width) / 2), y);
        this._painel?.set_position(m.x + Math.round((m.width - this._painel.width) / 2), y);
    }

    alternar() {
        if (this._modo === 'normal')
            this.fechar();
        else
            this.abrir('normal');
    }

    abrir(modo) {
        this.fechar();
        this._pilula.hide(); // o painel ocupa o lugar dela
        this._cancelarEsconder();
        this._modo = modo;
        this._painel = new St.BoxLayout({vertical: true, reactive: true,
            style_class: modo === 'normal' ? 'nx-painel' : 'nx-painel nx-painel-pareamento'});
        this._painel.connect('notify::width', () => this._posicionar());
        if (modo === 'normal') {
            // Fundo na tela toda: clique fora fecha (o mesmo jeito do balão).
            this._fundo = new St.Widget({reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height});
            this._fundo.connect('button-press-event', (_a, evento) => {
                if (global.stage.get_event_actor(evento) === this._fundo)
                    this.fechar();
                return Clutter.EVENT_STOP;
            });
            this._fundo.connect('key-press-event', (_a, evento) => {
                if (evento.get_key_symbol() !== Clutter.KEY_Escape)
                    return Clutter.EVENT_PROPAGATE;
                this.fechar();
                return Clutter.EVENT_STOP;
            });
            this._fundo.add_child(this._painel);
            Main.uiGroup.add_child(this._fundo);
            this._grab = Main.pushModal(this._fundo, {actionMode: Shell.ActionMode.POPUP});
        } else {
            // Pedido de pareamento chega pela rede: aparece sem modal e sem pegar o teclado.
            Main.layoutManager.addTopChrome(this._painel);
        }
        this._montar();
        this._posicionar();
        this._painel.set({opacity: 0, translation_y: -24});
        this._painel.ease({opacity: 255, translation_y: 0, duration: ANIMACAO, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        if (modo === 'normal')
            this._primeiro?.grab_key_focus();
    }

    fechar() {
        if (this._grab)
            Main.popModal(this._grab);
        if (this._fundo) {
            this._fundo.destroy();
        } else if (this._painel) {
            Main.layoutManager.removeChrome(this._painel);
            this._painel.destroy();
        }
        this._fundo = this._painel = this._grab = this._primeiro = null;
        this._modo = null;
    }

    _montar() {
        this._painel.destroy_all_children();
        this._primeiro = null;
        if (this._modo === 'pareamento')
            this._montarPareamento(this._n.pareamento);
        else if (this._modo === 'arquivo')
            this._montarArquivo(this._n.transferencia);
        else
            this._montarNormal();
    }

    _montarPareamento(p) {
        const linha = new St.BoxLayout({style_class: 'nx-corpo'});
        linha.add_child(nexo(84, 66, () => 'atento'));
        const coluna = new St.BoxLayout({vertical: true, style_class: 'nx-coluna', x_expand: true});
        coluna.add_child(rotulo(`${p.name} quer parear`, 'nx-sub'));
        coluna.add_child(rotulo(formatarCodigo(p.code), 'nx-codigo'));
        coluna.add_child(rotulo(`Confirme só se o ${p.name} mostrar o mesmo código`, 'nx-dica'));
        const botoes = new St.BoxLayout({style_class: 'nx-botoes'});
        // Recusar primeiro e destacado: um Enter ou clique distraído nunca pareia.
        this._recusar = this._botao('Recusar', 'nx-botao nx-botao-padrao', () => this._responder(p, false));
        this._confirmar = this._botao('Confirmar', 'nx-botao', () => this._responder(p, true));
        botoes.add_child(this._recusar);
        botoes.add_child(this._confirmar);
        coluna.add_child(botoes);
        linha.add_child(coluna);
        this._painel.add_child(linha);
    }

    _montarArquivo(t) {
        const linha = new St.BoxLayout({style_class: 'nx-corpo'});
        linha.add_child(nexo(64, 51, () => (t.fim === 'ok' ? 'feito' : 'surpreso')));
        const coluna = new St.BoxLayout({vertical: true, style_class: 'nx-coluna', x_expand: true});
        const cab = new St.BoxLayout();
        cab.add_child(rotulo(t.name, 'nx-rotulo'));
        cab.add_child(new St.Widget({x_expand: true}));
        cab.add_child(rotulo(`${t.direction === 'in' ? 'de' : 'para'} ${t.device_name}`, 'nx-chave'));
        coluna.add_child(cab);
        const fracao = t.total > 0 ? t.done / t.total : 1;
        const barra = new St.Widget({style_class: 'nx-barra', x_expand: true});
        const cheio = new St.Widget({style_class: 'nx-barra-cheia'});
        barra.add_child(cheio);
        barra.connect('notify::width', () => cheio.set_width(Math.round(barra.width * fracao)));
        coluna.add_child(barra);
        const segundos = Math.max(0.25, (Date.now() - t.inicio) / 1000);
        const mb = b => (b / 1048576).toLocaleString('pt-BR', {maximumFractionDigits: 1});
        const estado = t.fim === 'ok' ? 'Concluído' : t.fim === 'cancelado' ? 'Cancelado'
            : `${Math.round(fracao * 100)}% · ${mb(t.done / segundos)} MB/s`;
        const rodape = new St.BoxLayout();
        rodape.add_child(rotulo(estado, 'nx-dica'));
        rodape.add_child(new St.Widget({x_expand: true}));
        rodape.add_child(rotulo(`${mb(t.done)} de ${mb(t.total)} MB`, 'nx-dica'));
        coluna.add_child(rodape);
        linha.add_child(coluna);
        if (!t.fim) {
            this._cancelar = new St.Button({style_class: 'nx-icone-botao', can_focus: true, y_align: Clutter.ActorAlign.CENTER,
                accessible_name: `Cancelar ${t.name}`, child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 16})});
            this._cancelar.connect('clicked', () => this._comando({cmd: 'file.cancel', id: t.id}));
            linha.add_child(this._cancelar);
        }
        this._painel.add_child(linha);
    }

    async _responder(p, aceitar) {
        const r = await this._n.confirmar(p.pid, aceitar);
        if (!r.ok)
            Main.notifyError('Nexus', r.error ?? 'falhou');
    }

    _montarNormal() {
        const topo = new St.BoxLayout({style_class: 'nx-topo'});
        topo.add_child(rotulo('Nexus', 'nx-marca'));
        topo.add_child(new St.Widget({x_expand: true}));
        const app = new St.Button({style_class: 'nx-icone-botao', can_focus: true, accessible_name: 'Abrir o app Nexus',
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16})});
        app.connect('clicked', () => this._comando({cmd: 'ui.open', what: 'app'}, {fechar: true}));
        topo.add_child(app);
        this._painel.add_child(topo);

        const d = this.alvo;
        const corpo = new St.BoxLayout({style_class: 'nx-corpo'});
        corpo.add_child(this._cartao(d));
        corpo.add_child(this._grade(d));
        this._painel.add_child(corpo);
    }

    _cartao(d) {
        const cartao = new St.BoxLayout({vertical: true, style_class: 'nx-cartao'});
        const cab = new St.BoxLayout({style_class: 'nx-cab'});
        cab.add_child(nexo(96, 76, () => this._n.expressao));
        const titulo = new St.BoxLayout({vertical: true, style_class: 'nx-coluna', y_align: Clutter.ActorAlign.CENTER});
        titulo.add_child(rotulo(d?.name ?? 'Nenhum dispositivo', 'nx-nome'));
        titulo.add_child(rotulo(d ? (d.conectado ? 'Conectado' : 'Fora da rede') : 'Pareie pelo app Nexus', 'nx-status'));
        cab.add_child(titulo);
        cartao.add_child(cab);
        if (!d)
            return cartao;

        const info = new St.BoxLayout({vertical: true, style_class: 'nx-info'});
        const texto = this._n.ultimo.texto;
        for (const [chave, valor, destaque] of [
            ['Áudio do PC', d.audio ? 'tocando no celular' : 'no PC', d.audio],
            ['Último arquivo', this._n.ultimo.arquivo ?? '—', false],
            ['Área de transf.', texto ? `“${texto.replace(/\s+/g, ' ').slice(0, 24)}”` : '—', false],
        ]) {
            const linha = new St.BoxLayout();
            linha.add_child(rotulo(chave, 'nx-chave'));
            linha.add_child(new St.Widget({x_expand: true}));
            linha.add_child(rotulo(valor, destaque ? 'nx-valor nx-valor-destaque' : 'nx-valor'));
            info.add_child(linha);
        }
        cartao.add_child(info);

        for (const outro of this._n.dispositivos.filter(x => x.device_id !== d.device_id)) {
            const b = new St.Button({style_class: 'nx-outro', can_focus: true, x_align: Clutter.ActorAlign.START,
                label: `${outro.name} · ${outro.conectado ? 'conectado' : 'fora da rede'}`});
            b.connect('clicked', () => {
                this._alvoId = outro.device_id;
                this._montar();
            });
            cartao.add_child(b);
        }
        return cartao;
    }

    _grade(d) {
        const ligado = !!d?.conectado;
        const controles = [
            ['video-display-symbolic', 'Espelhar tela', 'nx-azul', !!d, () => this._comando({cmd: 'mirror', device_id: d.device_id})],
            [d?.audio ? 'audio-volume-muted-symbolic' : 'audio-speakers-symbolic', d?.audio ? 'Parar áudio' : 'Áudio no celular',
                d?.audio ? 'nx-azul-cheio' : 'nx-azul', ligado,
                () => this._comando({cmd: d.audio ? 'audio.stop' : 'audio.start', device_id: d.device_id}), d?.audio],
            ['document-send-symbolic', 'Enviar arquivo', 'nx-laranja', ligado,
                () => this._comando({cmd: 'ui.open', what: 'send-file', device_id: d.device_id}, {fechar: true})],
            ['edit-copy-symbolic', 'Copiar no celular', 'nx-verde', ligado, () => this._copiarNoCelular(d)],
            ['system-search-symbolic', 'Pesquisar no celular', 'nx-roxo', ligado, () => {
                this.fechar();
                this._acoes.abrirPrincipal();
            }],
            ['security-high-symbolic', 'Permissões', 'nx-cinza', true,
                () => this._comando({cmd: 'ui.open', what: 'app'}, {fechar: true})],
        ];
        const grade = new St.BoxLayout({vertical: true, style_class: 'nx-grade', x_expand: true});
        for (let i = 0; i < controles.length; i += 2) {
            const linha = new St.BoxLayout({style_class: 'nx-linha-controles'});
            linha.layout_manager.homogeneous = true; // colunas iguais
            for (const [icone, texto, cor, ativo, acao, ligadoAgora] of controles.slice(i, i + 2))
                linha.add_child(this._controle(icone, texto, cor, ativo, acao, ligadoAgora));
            grade.add_child(linha);
        }
        return grade;
    }

    _controle(icone, texto, cor, ativo, acao, ligadoAgora) {
        const caixa = new St.BoxLayout({style_class: 'nx-controle-caixa'});
        caixa.add_child(new St.Bin({style_class: `nx-bolha ${cor}`, child: new St.Icon({icon_name: icone, icon_size: 17})}));
        caixa.add_child(rotulo(texto, 'nx-rotulo'));
        const classes = ['nx-controle'];
        if (ligadoAgora)
            classes.push('nx-controle-ativo');
        if (!ativo)
            classes.push('nx-controle-desligado');
        const b = new St.Button({style_class: classes.join(' '), child: caixa, can_focus: ativo, reactive: ativo,
            x_expand: true, accessible_name: texto});
        b.connect('clicked', acao);
        if (ativo && !this._primeiro)
            this._primeiro = b;
        return b;
    }

    _botao(texto, classe, acao) {
        const b = new St.Button({label: texto, style_class: classe, can_focus: true});
        b.connect('clicked', acao);
        return b;
    }

    _copiarNoCelular(d) {
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_c, texto) => {
            if (texto)
                this._comando({cmd: 'send.text', device_id: d.device_id, text: texto});
            else
                Main.notify('Nexus', 'A área de transferência não tem texto');
        });
    }

    async _comando(pedido, {fechar = false} = {}) {
        if (fechar)
            this.fechar();
        const r = await this._n.comando(pedido);
        if (r.ok)
            this._n.reagir('feito');
        else
            Main.notifyError('Nexus', r.error ?? 'falhou');
        return r;
    }
}
