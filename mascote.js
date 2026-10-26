// SPDX-License-Identifier: GPL-2.0-or-later
// O Nexo: gota azul-mar com dois pinos de tomada. Desenho em Cairo (desenharNexo, puro, igual ao nexus/mascote.py
// do app GTK) e a classe Mascote, que anima (respirar, piscar, olhar, achatar, pular, cutucar, carinho) só enquanto
// está na tela: escondido, a Timeline para e não sobra nenhum timer.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

const AZUL = [0.525, 0.812, 0.933]; // #86CFEE
const APAGADO = [0.541, 0.663, 0.722]; // #8AA9B8 (dormindo)
const PINO = [0.31, 0.651, 0.812]; // #4FA6CF
const ESCURO = [0.078, 0.086, 0.122];
const BOCHECHA = [1, 0.561, 0.639];
const NOTA = [0.557, 0.659, 1];
const CORACAO = [1, 0.498, 0.659];
const ZZ = [0.6, 0.62, 0.68];

export const LARGURA = 96;
export const ALTURA = 88; // folga em cima para o pulinho e os corações
const BASE = 86; // y da base do corpo: o achatar e o respirar escalam a partir dela
export const EXPRESSOES = ['conectado', 'atento', 'feito', 'curtindo', 'surpreso', 'preocupado', 'irritado', 'tonto',
    'dormindo'];
const PARADO = {dx: 0, dy: 0, abertura: 1, sx: 1, sy: 1, pulo: 0, giro: 0, inclinacao: 0, coracoes: []};

function elipse(cr, cx, cy, rx, ry) {
    cr.save();
    cr.translate(cx, cy);
    cr.scale(rx, Math.max(ry, 0.01));
    cr.newSubPath();
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
}

function linha(cr, x1, y1, x2, y2) {
    cr.newPath();
    cr.moveTo(x1, y1);
    cr.lineTo(x2, y2);
    cr.stroke();
}

function arco(cr, cx, cy, r, de, ate) {
    cr.newPath();
    cr.arc(cx, cy, r, de * Math.PI, ate * Math.PI);
    cr.stroke();
}

function coracao(cr, x, y, s) {
    cr.newPath();
    cr.moveTo(x, y + s * 0.3);
    cr.curveTo(x, y, x - s / 2, y, x - s / 2, y + s * 0.3);
    cr.curveTo(x - s / 2, y + s * 0.6, x, y + s * 0.8, x, y + s);
    cr.curveTo(x, y + s * 0.8, x + s / 2, y + s * 0.6, x + s / 2, y + s * 0.3);
    cr.curveTo(x + s / 2, y, x, y, x, y + s * 0.3);
    cr.fill();
}

// e: {expr, dx, dy (olhar, -1…1), abertura (0…1), sx, sy (achatar/respirar), pulo (unidades para cima),
//     giro (espirais do tonto), inclinacao (rad), coracoes: [{x, y, s, a}]}; campos ausentes = parado.
export function desenharNexo(cr, largura, altura, e) {
    e = {...PARADO, ...e};
    const {expr, dx, dy, abertura} = e;
    const escala = Math.min(largura / LARGURA, altura / ALTURA);
    cr.save();
    cr.translate((largura - LARGURA * escala) / 2, (altura - ALTURA * escala) / 2);
    cr.scale(escala, escala);
    cr.setLineCap(1); // ROUND

    cr.save();
    cr.translate(48, BASE - e.pulo);
    cr.rotate(e.inclinacao);
    cr.scale(e.sx, e.sy);
    cr.translate(-48, -BASE);

    // pinos de tomada: o "link" com o celular
    cr.setSourceRGB(...PINO);
    for (const x of [39, 57]) {
        cr.newPath();
        cr.arc(x, 12, 2.5, Math.PI, 0);
        cr.arc(x, 21, 2.5, 0, Math.PI);
        cr.closePath();
        cr.fill();
    }
    // corpo em gota
    cr.newPath();
    cr.moveTo(48, 20);
    cr.curveTo(72, 20, 84, 42, 84, 60);
    cr.curveTo(84, 78, 68, 86, 48, 86);
    cr.curveTo(28, 86, 12, 78, 12, 60);
    cr.curveTo(12, 42, 24, 20, 48, 20);
    cr.closePath();
    cr.setSourceRGB(...(expr === 'dormindo' ? APAGADO : AZUL));
    cr.fill();
    cr.setSourceRGBA(1, 1, 1, 0.35);
    elipse(cr, 32, 40, 6, 9);
    cr.fill();
    cr.setSourceRGBA(...BOCHECHA, expr === 'irritado' ? 0.85 : 0.55);
    elipse(cr, 25, 68, 5.5, 3.3);
    elipse(cr, 71, 68, 5.5, 3.3);
    cr.fill();

    // olhos
    const [ox, oy] = [dx * 3, dy * 2];
    cr.setSourceRGB(...ESCURO);
    cr.setLineWidth(4);
    const abertos = (rx, ry) => {
        for (const x of [35, 61])
            elipse(cr, x + ox, 56 + oy, rx, ry * abertura);
        cr.fill();
        if (abertura > 0.5) {
            cr.setSourceRGB(1, 1, 1);
            for (const x of [35, 61])
                elipse(cr, x + ox + rx * 0.35, 56 + oy - ry * 0.4, rx * 0.32, rx * 0.32);
            cr.fill();
            cr.setSourceRGB(...ESCURO);
        }
    };
    switch (expr) {
    case 'feito':
    case 'curtindo':
        arco(cr, 35, 59, 6.5, 1.15, 1.85);
        arco(cr, 61, 59, 6.5, 1.15, 1.85);
        break;
    case 'dormindo':
        arco(cr, 35, 55, 6, 0.15, 0.85);
        arco(cr, 61, 55, 6, 0.15, 0.85);
        break;
    case 'tonto':
        cr.setLineWidth(2.4);
        for (const x of [35, 61]) {
            cr.newPath();
            for (let a = 0; a < 4 * Math.PI; a += 0.3) {
                const r = 0.6 * a;
                cr.lineTo(x + r * Math.cos(a + e.giro), 56 + r * Math.sin(a + e.giro));
            }
            cr.stroke();
        }
        break;
    case 'atento':
        abertos(8, 10);
        break;
    case 'surpreso':
        abertos(6.5, 6.5);
        break;
    default: // conectado, preocupado, irritado
        abertos(7, 9);
    }
    if (expr === 'preocupado' || expr === 'irritado') {
        // sobrancelhas: preocupado cai para fora, irritado desce para o meio
        cr.setLineWidth(2.8);
        const s = expr === 'irritado' ? 1 : -1;
        linha(cr, 28, 44 - 2 * s, 40, 44 + 2 * s);
        linha(cr, 56, 44 + 2 * s, 68, 44 - 2 * s);
    }

    // boca
    cr.setLineWidth(2.6);
    switch (expr) {
    case 'feito':
    case 'curtindo':
        arco(cr, 48, 66, 4.5, 0.2, 0.8);
        break;
    case 'surpreso':
    case 'atento':
        elipse(cr, 48, 70, 2.6, expr === 'surpreso' ? 3.4 : 2.2);
        cr.fill();
        break;
    case 'preocupado':
        arco(cr, 48, 74, 4, 1.25, 1.75);
        break;
    case 'irritado':
        linha(cr, 44, 71, 52, 71);
        break;
    case 'tonto':
        cr.newPath();
        cr.moveTo(42, 71);
        cr.curveTo(45, 68, 47, 74, 50, 71);
        cr.curveTo(52, 69, 53, 70, 54, 71);
        cr.stroke();
        break;
    case 'dormindo':
        elipse(cr, 48, 70, 1.6, 1.6);
        cr.fill();
        break;
    default:
        arco(cr, 48, 67.5, 2.8, 0.25, 0.75);
    }
    cr.restore();

    // enfeites fora do corpo (não achatam)
    if (expr === 'curtindo') {
        cr.setSourceRGB(...NOTA);
        cr.setLineWidth(2.4);
        linha(cr, 84, 6 - e.pulo, 84, 18 - e.pulo);
        elipse(cr, 81.5, 19 - e.pulo, 3, 2.6);
        cr.fill();
    } else if (expr === 'dormindo') {
        cr.setSourceRGB(...ZZ);
        cr.setLineWidth(2.4);
        cr.newPath();
        cr.moveTo(76, 8);
        cr.lineTo(84, 8);
        cr.lineTo(76, 17);
        cr.lineTo(84, 17);
        cr.stroke();
    }
    for (const c of e.coracoes) {
        cr.setSourceRGBA(...CORACAO, c.a);
        coracao(cr, c.x, c.y, c.s);
    }
    cr.restore();
}

// Interpola quadros-chave [[valor, ms], …] a partir de 1, com saída suave; null quando acabou.
function quadros(chaves, ms) {
    let de = 1;
    for (const [v, dur] of chaves) {
        if (ms < dur) {
            const p = ms / dur;
            return de + (v - de) * (1 - (1 - p) ** 3);
        }
        ms -= dur;
        de = v;
    }
    return null;
}

const agora = () => GLib.get_monotonic_time() / 1000; // ms

export class Mascote {
    // expressao(): expressão de base; olhar(): {dx, dy} vindo de quem sabe onde está o mouse.
    // interativo: carinho ao deixar o mouse parado em cima; cutucavel: clique irrita, 3 rápidos deixam tonto.
    constructor(largura, altura, expressao, {olhar = () => null, interativo = false, cutucavel = false} = {}) {
        this._expressao = expressao;
        this._olhar = olhar;
        this._t0 = agora();
        this._piscarEm = this._t0 + 1500 + Math.random() * 2000;
        this._achatarEm = null;
        this._puloEm = null;
        this._humor = null;
        this._coracoes = [];
        this._cliques = [];
        this.area = new St.DrawingArea({width: largura, height: altura, x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER, reactive: interativo || cutucavel, track_hover: interativo});
        this.area.connect('repaint', a => {
            const cr = a.get_context();
            const [w, h] = a.get_surface_size();
            desenharNexo(cr, w, h, this.estado());
            cr.$dispose();
        });
        // O relógio só anda com o mascote na tela (mapped): escondido, CPU zero.
        this._tl = new Clutter.Timeline({actor: this.area, duration: 1000, repeat_count: -1});
        this._tl.connect('new-frame', () => this.area.queue_repaint());
        this.area.connect('notify::mapped', () => (this.area.mapped ? this._tl.start() : this._tl.stop()));
        if (interativo) {
            this.area.connect('notify::hover', () => this._carinhoDepois());
            this.area.connect('motion-event', () => {
                this._carinhoDepois();
                return Clutter.EVENT_PROPAGATE;
            });
        }
        if (cutucavel) {
            this.area.connect('button-press-event', () => {
                this.cutucar();
                return Clutter.EVENT_STOP;
            });
        }
        this.area.connect('destroy', () => {
            this._tl.stop();
            this._cancelarCarinho();
        });
    }

    get animando() {
        return this._tl.is_playing();
    }

    // Mouse parado ~2 s em cima → corações (qualquer movimento recomeça a contagem).
    _carinhoDepois() {
        this._cancelarCarinho();
        if (!this.area.hover)
            return;
        this._idCarinho = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._idCarinho = 0;
            if (this.area.hover)
                this.carinho();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelarCarinho() {
        if (this._idCarinho)
            GLib.source_remove(this._idCarinho);
        this._idCarinho = 0;
    }

    reagir(expr, ms) {
        this._humor = {expr, ate: agora() + ms};
    }

    achatar(atraso = 0) {
        this._achatarEm = agora() + atraso;
    }

    // Pulinho feliz: dois saltos e pousa achatando.
    pular() {
        this._puloEm = agora();
    }

    carinho() {
        const t = agora();
        this._coracoes = [0, 250, 500].map((d, i) => ({nasce: t + d, x: [30, 66, 48][i]}));
        this.reagir('feito', 1600);
    }

    cutucar() {
        const t = agora();
        this._cliques = [...this._cliques.filter(c => t - c < 1700), t];
        this.achatar();
        if (this._cliques.length >= 3) {
            this._cliques = [];
            this.reagir('tonto', 2500);
        } else {
            this.reagir('irritado', 1200);
        }
    }

    // Estado do quadro atual, para desenharNexo.
    estado() {
        const t = agora();
        const s = (t - this._t0) / 1000;
        if (this._humor && t > this._humor.ate)
            this._humor = null;
        const expr = this._humor?.expr ?? this._expressao();
        const e = {expr, ...(this._olhar() ?? {}), coracoes: []};
        if (expr === 'dormindo' || expr === 'feito' || expr === 'curtindo' || expr === 'tonto')
            e.dx = e.dy = 0;

        // respirar: devagar, mais fundo dormindo
        const periodo = expr === 'dormindo' ? 4.2 : 3.2;
        const r = Math.sin(2 * Math.PI * s / periodo) * (expr === 'dormindo' ? 0.035 : 0.022);
        e.sy = 1 + r;
        e.sx = 1 - r * 0.6;

        // piscar (Coucou: fecha em 70 ms, abre em 130 ms)
        if (t >= this._piscarEm) {
            const p = quadros([[0.06, 70], [1, 130]], t - this._piscarEm);
            if (p === null)
                this._piscarEm = t + 2000 + Math.random() * 3000;
            else
                e.abertura = p;
        }

        // achatar ao pousar (1,16 × 0,78 → 0,95 × 1,1 → 1)
        if (this._achatarEm !== null && t >= this._achatarEm) {
            const ms = t - this._achatarEm;
            const sy = quadros([[0.78, 70], [1.1, 130], [1, 170]], ms);
            const sx = quadros([[1.16, 70], [0.95, 130], [1, 170]], ms);
            if (sy === null)
                this._achatarEm = null;
            else
                [e.sx, e.sy] = [e.sx * sx, e.sy * sy];
        }

        if (this._puloEm !== null) {
            const p = (t - this._puloEm) / 800;
            if (p >= 1) {
                this._puloEm = null;
                this.achatar();
            } else {
                e.pulo = 9 * Math.abs(Math.sin(2 * Math.PI * p));
            }
        }

        if (expr === 'tonto') {
            e.giro = s * 6;
            e.inclinacao = Math.sin(s * 9) * 0.12;
        }

        for (const c of this._coracoes) {
            const a = (t - c.nasce) / 1400;
            if (a >= 0 && a < 1)
                e.coracoes.push({x: c.x + Math.sin(a * 8) * 2, y: 26 - a * 22, s: 7 + a * 3, a: 1 - a});
        }
        if (this._coracoes.every(c => t - c.nasce > 1400))
            this._coracoes = [];
        return e;
    }
}
