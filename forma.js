// SPDX-License-Identifier: GPL-2.0-or-later
// Forma e movimento da ilha do notch: caminho com orelhas côncavas que fundem com a borda do topo, mola e curva de fechar.
// Valores (mola 0,5 s/0,72, fechar .45,0,.2,1 em 340 ms, orelha 14 px) e o caminho seguem o Coucou
// (https://github.com/Louis-CFM/coucou, código sob licença MIT, © Louis Raillé): IslandShape e core/anim.ts.

export const ORELHA = 14;
export const CRESCER_MS = 800; // a mola assenta (<1 px) em ~0,75 s
export const ENCOLHER_MS = 340;

// Mola amortecida (SwiftUI spring(response, dampingFraction)) em forma fechada: 0 → 1, passa ~4% do alvo e volta.
export function mola(t, resposta = 0.5, amortecimento = 0.72) {
    const w0 = 2 * Math.PI / resposta;
    const wd = w0 * Math.sqrt(1 - amortecimento * amortecimento);
    return 1 - Math.exp(-amortecimento * w0 * t) * (Math.cos(wd * t) + amortecimento * w0 / wd * Math.sin(wd * t));
}

// cubic-bezier(x1, y1, x2, y2) como no CSS: bisseção em x, 12 passos bastam a 60 quadros.
export function bezier(x1, y1, x2, y2) {
    const c = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
    return x => {
        let [lo, hi, t] = [0, 1, x];
        for (let i = 0; i < 12; i++) {
            if (c(t, x1, x2) < x)
                lo = t;
            else
                hi = t;
            t = (lo + hi) / 2;
        }
        return c(t, y1, y2);
    };
}

export const fechar = bezier(0.45, 0, 0.2, 1);

// Caminho da ilha numa área de largura w + 2·margem: o corpo (w × h) fica no meio, e as orelhas (raio até `margem`)
// ocupam as faixas laterais no topo. margem 0 → topo reto. rBaixo: raio dos cantos de baixo.
export function caminhoIlha(cr, w, h, margem, rBaixo) {
    const e = Math.max(0, Math.min(margem, h / 2));
    const r = Math.max(0, Math.min(rBaixo, h - e, w / 2));
    const [esq, dir] = [margem, margem + w];
    cr.newPath();
    cr.moveTo(esq - e, 0);
    cr.lineTo(dir + e, 0);
    if (e > 0)
        cr.arcNegative(dir + e, e, e, -Math.PI / 2, -Math.PI);
    cr.lineTo(dir, h - r);
    if (r > 0)
        cr.arc(dir - r, h - r, r, 0, Math.PI / 2);
    cr.lineTo(esq + r, h);
    if (r > 0)
        cr.arc(esq + r, h - r, r, Math.PI / 2, Math.PI);
    cr.lineTo(esq, e);
    if (e > 0)
        cr.arcNegative(esq - e, e, e, 0, -Math.PI / 2);
    cr.closePath();
}
