// SPDX-License-Identifier: GPL-2.0-or-later
// Notch do Nexus: uma ilha que escorre do topo da tela (pílula ↔ painel com o dispositivo e os controles). Só existe com o Nexus ativo.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Shell from 'gi://Shell';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {formatarCodigo} from './nexus.js';
import {Mascote} from './mascote.js';
import {ORELHA, CRESCER_MS, ENCOLHER_MS, mola, fechar as curvaFechar, caminhoIlha} from './forma.js';

const FUNDO = [0.063, 0.067, 0.086]; // #101116
const FUNDO_HOVER = [0.114, 0.125, 0.153]; // #1D2027
const RAIO_PILULA = 19;
const RAIO_PAINEL = 28;

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

const ESCONDER_APOS = 2500; // ms sem o mouse em cima, depois de aparecer pelo topo
const FECHAR_HOVER = 600; // folga depois que o mouse sai de um painel aberto pelo hover

// Uma ilha só, que escorre do topo: escondida (altura 0) → pílula → painel, com mola ao crescer e curva ao encolher.
export class Notch {
    // acoes: {abrirPrincipal()}; settings: GSettings do Balão (opção de abrir ao passar o mouse)
    constructor(nexus, acoes, settings = null) {
        this._n = nexus;
        this._acoes = acoes;
        this._settings = settings;
        this._modo = null;
        this._alvoId = null;
        this._compacto = false; // pílula à mostra
        this._geo = {w: 0, h: 0, r: RAIO_PILULA};
        this._olhos = {dx: 0, dy: 0}; // para onde os Nexos olham (o mouse sobre a ilha)

        // Contêiner do tamanho da tela que não pega entrada: o modal agarra ele, então a ilha e o fundo
        // recebem cliques sem trocar a ilha de pai.
        this._raiz = new St.Widget({reactive: false});
        this._raiz.add_constraint(new Clutter.BindConstraint({source: global.stage, coordinate: Clutter.BindCoordinate.SIZE}));
        Main.layoutManager.addTopChrome(this._raiz, {affectsInputRegion: false});
        this._ilha = new St.Widget({reactive: true, track_hover: true, clip_to_allocation: true, visible: false});
        this._forma = new St.DrawingArea();
        this._forma.connect('repaint', a => this._pintarForma(a));
        this._ilha.add_child(this._forma);
        this._raiz.add_child(this._ilha);
        Main.layoutManager.trackChrome(this._ilha, {affectsInputRegion: true});
        this._ilha.connect('notify::hover', () => this._aoPassar());
        this._ilha.connect('motion-event', (_a, evento) => this._seguir(evento));
        this._raiz.connect('key-press-event', (_a, evento) => {
            if (this._modo !== 'normal' || evento.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this.fechar();
            return Clutter.EVENT_STOP;
        });

        this._pilula = new St.Button({style_class: 'nx-pilula', can_focus: true, accessible_name: 'Nexus', visible: false});
        const caixa = new St.BoxLayout({style_class: 'nx-pilula-caixa'});
        this._mascote = new Mascote(34, 31, () => this._n.expressao, {olhar: () => this._olhos, interativo: true});
        this._rosto = this._mascote.area;
        this._ponto = new St.Widget({style_class: 'nx-ponto', y_align: Clutter.ActorAlign.CENTER});
        this._onda = new St.Icon({icon_name: 'audio-volume-high-symbolic', style_class: 'nx-onda'});
        caixa.add_child(this._rosto);
        caixa.add_child(this._ponto);
        caixa.add_child(this._onda);
        this._pilula.set_child(caixa);
        this._pilula.connect('clicked', () => this.alternar());
        this._pilula.connect('notify::hover', () => this._forma.queue_repaint());
        this._pilula.connect('notify::height', () => this._compacto && this._ajustar());
        this._ilha.add_child(this._pilula);

        // Barreira de pressão no topo (a mesma técnica dos cantos ativos): não rouba cliques da borda,
        // como as abas de um navegador maximizado.
        this._pressao = new Layout.PressureBarrier(60, 1000, Shell.ActionMode.NORMAL);
        this._pressao.connect('trigger', () => this.mostrarPilula());
        this._criarBarreira();
        this._medirTopo();
        this._idMonitores = Main.layoutManager.connect('monitors-changed', () => {
            this._criarBarreira();
            this._medirTopo();
            this._aplicar();
        });
        this._desligarOuvinte = nexus.conectar(() => this._atualizar());
        this._atualizar();
    }

    destroy() {
        this._destruindo = true;
        this.fechar();
        this._tl?.stop();
        this._tl = null;
        this._cancelarEsconder();
        this._cancelarFecharHover();
        this._desligarOuvinte();
        Main.layoutManager.disconnect(this._idMonitores);
        this._removerBarreira();
        this._pressao.destroy();
        Main.layoutManager.removeChrome(this._raiz);
        this._raiz.destroy();
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

    // Pílula escorre do topo; some sozinha se o mouse não ficar em cima dela.
    mostrarPilula() {
        if (!this._n.disponivel || this._painel)
            return;
        this._agendarEsconder(ESCONDER_APOS);
        if (this._compacto)
            return;
        this._compacto = true;
        this._pilula.remove_all_transitions();
        this._pilula.set({visible: true, opacity: 255});
        this._ajustar();
        this._mascote.achatar(250); // "pousa" quando a mola chega
    }

    esconderPilula() {
        this._cancelarEsconder();
        if (!this._compacto)
            return;
        this._compacto = false;
        this._ajustar();
    }

    _agendarEsconder(ms) {
        this._cancelarEsconder();
        this._idEsconder = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._idEsconder = 0;
            if (!this._ilha.hover)
                this.esconderPilula();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelarEsconder() {
        if (this._idEsconder)
            GLib.source_remove(this._idEsconder);
        this._idEsconder = 0;
    }

    _cancelarFecharHover() {
        if (this._idFecharHover)
            GLib.source_remove(this._idFecharHover);
        this._idFecharHover = 0;
    }

    _aoPassar() {
        if (this._ilha.hover) {
            this._cancelarEsconder();
            this._cancelarFecharHover();
            if (this._compacto && !this._painel && this._settings?.get_boolean('notch-abrir-passando'))
                this.abrir('normal', {hover: true});
            return;
        }
        this._olhos.dx = this._olhos.dy = 0;
        if (this._porHover) {
            this._cancelarFecharHover();
            this._idFecharHover = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FECHAR_HOVER, () => {
                this._idFecharHover = 0;
                if (this._porHover && !this._ilha.hover)
                    this.fechar();
                return GLib.SOURCE_REMOVE;
            });
        } else if (this._compacto) {
            this._agendarEsconder(1200);
        }
    }

    // Olhos do Nexo seguem o mouse enquanto ele está sobre a ilha (no Wayland não há posição fora dela de graça).
    _seguir(evento) {
        const [px, py] = evento.get_coords();
        const [ix, iy] = this._ilha.get_transformed_position();
        const lim = v => Math.max(-1, Math.min(1, v));
        const dx = lim((px - ix - this._ilha.width / 2) / 200);
        const dy = lim((py - iy - this._ilha.height / 2) / 80);
        Object.assign(this._olhos, {dx, dy}); // os Nexos redesenham sozinhos enquanto estão na tela
        return Clutter.EVENT_PROPAGATE;
    }

    _nexo(largura, altura, expressao, opcoes = {}) {
        return new Mascote(largura, altura, expressao, {olhar: () => this._olhos, ...opcoes}).area;
    }

    // Onde a ilha fica: centro do monitor principal, na primeira linha livre. Orelhas só encostada na borda do monitor.
    _medirTopo() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m) {
            this._topo ??= {cx: 0, y: 0, margem: 0};
            return;
        }
        const caixa = Main.layoutManager.panelBox;
        const [, by] = caixa.get_transformed_position();
        const y = topoLivre(m, {visivel: caixa.visible, y: by, largura: caixa.width, altura: caixa.height});
        this._topo = {cx: m.x + m.width / 2, y, margem: y === m.y ? ORELHA : 0};
    }

    // Tamanho que a ilha quer agora: o do painel, o da pílula, ou altura 0 (escondida).
    _alvo() {
        if (this._painel) {
            const [, , w, h] = this._painel.get_preferred_size();
            return {w, h, r: RAIO_PAINEL};
        }
        const [, , w, h] = this._pilula.get_preferred_size();
        return {w, h: this._compacto ? h : 0, r: RAIO_PILULA};
    }

    _ajustar() {
        if (this._destruindo)
            return;
        const alvo = this._alvo();
        const g = this._geo;
        const igual = (a, b) => a && ['w', 'h', 'r'].every(k => Math.abs(a[k] - b[k]) < 0.5);
        if (igual(this._alvoAtual, alvo) || (alvo.h === 0 && !this._ilha.visible)) {
            this._alvoAtual = alvo;
            if (!this._tl)
                Object.assign(g, alvo);
            this._aplicar();
            return;
        }
        this._alvoAtual = alvo;
        this._tl?.stop();
        if (alvo.h > 0 && !this._ilha.visible) {
            this._medirTopo();
            this._ilha.show();
        }
        const de = {...g};
        const crescer = alvo.h >= g.h;
        const tl = new Clutter.Timeline({actor: this._ilha, duration: crescer ? CRESCER_MS : ENCOLHER_MS});
        tl.connect('new-frame', () => {
            const t = tl.get_elapsed_time();
            const f = crescer ? mola(t / 1000) : curvaFechar(Math.min(1, t / ENCOLHER_MS));
            for (const k of ['w', 'h', 'r'])
                g[k] = de[k] + (alvo[k] - de[k]) * f;
            this._aplicar();
        });
        tl.connect('completed', () => {
            if (this._tl !== tl)
                return;
            this._tl = null;
            Object.assign(g, alvo);
            this._aplicar();
            if (alvo.h === 0)
                this._recolher();
        });
        this._tl = tl;
        tl.start();
    }

    _recolher() {
        this._ilha.hide();
        this._pilula.hide();
    }

    _aplicar() {
        const {w, h} = this._geo;
        const m = this._topo.margem;
        const lw = Math.round(w + 2 * m);
        const lh = Math.max(1, Math.round(h));
        this._ilha.set_position(Math.round(this._topo.cx - lw / 2), this._topo.y);
        this._ilha.set_size(lw, lh);
        this._forma.set_size(lw, lh);
        // Conteúdo centrado no corpo; a pílula desce junto com a borda de baixo, o painel fica preso no topo.
        for (const [c, embaixo] of [[this._pilula, true], [this._painel, false]]) {
            if (!c)
                continue;
            const [, , cw, ch] = c.get_preferred_size();
            c.set_position(Math.round(m + (w - cw) / 2), embaixo ? Math.min(0, Math.round(h - ch)) : 0);
        }
        this._forma.queue_repaint();
    }

    _pintarForma(area) {
        const cr = area.get_context();
        const [lw, lh] = area.get_surface_size();
        const m = this._topo.margem;
        cr.setSourceRGB(...(!this._painel && this._pilula.hover ? FUNDO_HOVER : FUNDO));
        caminhoIlha(cr, lw - 2 * m, lh, m, this._geo.r);
        cr.fill();
        cr.$dispose();
    }

    _atualizar() {
        if (!this._n.disponivel) {
            this.esconderPilula();
            this.fechar();
            return;
        }
        this._ponto.visible = this._n.dispositivos.some(d => d.conectado);
        this._onda.visible = this._n.dispositivos.some(d => d.audio);
        const expr = this._n.expressao;
        if (this._expr && expr !== this._expr && this._ilha.visible) {
            if (expr === 'feito')
                this._mascote.pular();
            else
                this._mascote.achatar();
        }
        this._expr = expr;
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
        else if (this._compacto)
            this._ajustar(); // ponto/onda mudam a largura da pílula
    }

    alternar() {
        if (this._modo === 'normal')
            this.fechar();
        else
            this.abrir('normal');
    }

    // hover: aberto ao passar o mouse; sem modal (não pega o teclado) e fecha quando o mouse sai.
    abrir(modo, {hover = false} = {}) {
        this.fechar();
        this._cancelarEsconder();
        this._compacto = false;
        if (this._pilula.visible) {
            this._pilula.ease({opacity: 0, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._compacto)
                        this._pilula.hide();
                }});
        }
        this._modo = modo;
        this._porHover = hover;
        this._painel = new St.BoxLayout({vertical: true, reactive: true,
            style_class: modo === 'normal' ? 'nx-painel' : 'nx-painel nx-painel-pareamento'});
        // A medida certa só sai depois do primeiro layout (fontes, rótulos): segue o tamanho real.
        this._painel.connect('notify::height', () => this._ajustar());
        this._ilha.add_child(this._painel);
        if (modo === 'normal' && !hover) {
            // Fundo na tela toda, atrás da ilha: clique fora fecha (o mesmo jeito do balão).
            this._fundo = new St.Widget({reactive: true});
            this._fundo.add_constraint(new Clutter.BindConstraint({source: global.stage, coordinate: Clutter.BindCoordinate.SIZE}));
            this._fundo.connect('button-press-event', () => {
                this.fechar();
                return Clutter.EVENT_STOP;
            });
            this._raiz.insert_child_below(this._fundo, this._ilha);
            this._grab = Main.pushModal(this._raiz, {actionMode: Shell.ActionMode.POPUP});
        }
        // Pedido de pareamento ou arquivo chega pela rede: aparece sem modal e sem pegar o teclado.
        this._montar();
        // Conteúdo entra depois que a ilha começa a crescer (Coucou: 160 ms de atraso, 300 ms, escala 0,97 → 1).
        this._painel.set_pivot_point(0.5, 0);
        this._painel.set({opacity: 0, scale_x: 0.97, scale_y: 0.97});
        this._painel.ease({opacity: 255, delay: 160, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._painel.ease({scale_x: 1, scale_y: 1, delay: 160, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        if (modo === 'normal' && !hover)
            this._primeiro?.grab_key_focus();
    }

    fechar() {
        if (this._grab)
            Main.popModal(this._grab);
        this._fundo?.destroy();
        const p = this._painel;
        if (p && this._destruindo) {
            p.destroy();
        } else if (p) {
            p.reactive = false;
            p.remove_all_transitions();
            p.ease({opacity: 0, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => p.destroy()});
        }
        this._fundo = this._painel = this._grab = this._primeiro = null;
        this._modo = null;
        this._porHover = false;
        this._cancelarFecharHover();
        if (!this._destruindo)
            this._ajustar();
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
        this._ajustar();
    }

    _montarPareamento(p) {
        const linha = new St.BoxLayout({style_class: 'nx-corpo'});
        linha.add_child(this._nexo(84, 77, () => 'atento'));
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
        linha.add_child(this._nexo(64, 59, () => (t.fim === 'ok' ? 'feito' : 'surpreso')));
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
        this._mascoteCartao = new Mascote(96, 88, () => this._n.expressao, {olhar: () => this._olhos, interativo: true,
            cutucavel: true});
        cab.add_child(this._mascoteCartao.area);
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
        if (r.ok) {
            this._n.reagir('feito');
        } else {
            this._n.reagir('preocupado');
            Main.notifyError('Nexus', r.error ?? 'falhou');
        }
        return r;
    }
}
