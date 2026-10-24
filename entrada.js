// SPDX-License-Identifier: GPL-2.0-or-later
// Onde o usuário está digitando, o que está sob o cursor, e como devolver texto ao app.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getIBusManager} from 'resource:///org/gnome/shell/misc/ibusManager.js';

const TERMINAIS = /term|ptyxis|kitty|alacritty|konsole|tilix|wezterm|foot|terminator|guake|tilda|blackbox/i;
const DIGITAR = [Clutter.KEY_Shift_L, Clutter.KEY_Insert];
const TERMINAL = [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v];
const LETRA = /[\p{L}\p{M}\p{N}'-]/u;

export class Foco {
    constructor() {
        // Cursor informado pelo IBus: cobre apps XWayland, que não passam por Main.inputMethod.
        this._cursorIbus = null;
        this.congelado = false;
        this._ibus = getIBusManager();
        this._ids = [
            this._ibus.connect('set-cursor-location', (_m, rect) => {
                if (!this.congelado)
                    this._cursorIbus = rect;
            }),
            this._ibus.connect('focus-out', () => {
                if (!this.congelado)
                    this._cursorIbus = null;
            }),
        ];
        const seat = Clutter.get_default_backend().get_default_seat();
        this._teclado = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._timeouts = new Set();
    }

    destroy() {
        this._ids.forEach(id => this._ibus.disconnect(id));
        this._timeouts.forEach(id => GLib.source_remove(id));
        this._teclado.run_dispose();
    }

    // Foto do estado antes de o balão roubar o foco.
    // → {ponto: {x, y, width, height}, noTexto, origem: {original, deslocamento, tamanho} | null}
    capturar() {
        const im = Main.inputMethod;
        const noTexto = !!im.currentFocus;
        // ponytail: _cursorRect é campo interno do Shell 46; se sumir, cai no IBus e depois no mouse.
        let ponto = noTexto ? im._cursorRect : null;
        if (!valido(ponto))
            ponto = this._cursorIbus;
        if (!valido(ponto)) {
            const [x, y] = global.get_pointer();
            ponto = {x, y, width: 0, height: 0};
        }

        let origem = null;
        if (noTexto) {
            const [texto, cursor, ancora] = im.getSurroundingText();
            if (texto)
                origem = trechoSobCursor(texto, cursor, ancora ?? cursor);
        }
        return {ponto: {...ponto}, noTexto, origem};
    }

    // Troca `origem.original` por `novo` no app, quando ele recuperar o foco de texto.
    // Se o app não colaborar em ~1 s, deixa o texto na área de transferência.
    substituir(origem, novo) {
        let tentativas = 0;
        this._depois(50, () => {
            const im = Main.inputMethod;
            if (im.currentFocus) {
                const [texto, cursor] = im.getSurroundingText();
                const ini = cursor + origem.deslocamento;
                if (texto?.slice(ini, ini + origem.tamanho) === origem.original) {
                    im.delete_surrounding(origem.deslocamento, origem.tamanho);
                    im.commit(novo);
                    return false;
                }
            }
            if (++tentativas < 20)
                return true;
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, novo);
            Main.notify('Balão', `“${novo}” copiado — cole com Ctrl+V`);
            return false;
        });
    }

    // Cola na janela em foco depois que o balão fechou: Shift+Insert (como a Clipboard Indicator),
    // Ctrl+Shift+V em terminal. Espera o app recuperar o foco de texto; fora de campo de texto, ~400 ms.
    colar() {
        let tentativas = 0;
        this._depois(50, () => {
            if (!Main.inputMethod.currentFocus && ++tentativas < 8)
                return true;
            const classe = global.display.focus_window?.get_wm_class() ?? '';
            const terminal = Main.inputMethod.content_purpose === Clutter.InputContentPurpose.TERMINAL || TERMINAIS.test(classe);
            const teclas = terminal ? TERMINAL : DIGITAR;
            const nota = (k, estado) => this._teclado.notify_keyval(GLib.get_monotonic_time(), k, estado);
            teclas.forEach(k => nota(k, Clutter.KeyState.PRESSED));
            [...teclas].reverse().forEach(k => nota(k, Clutter.KeyState.RELEASED));
            return false;
        });
    }

    // Repete `fn` a cada `ms` enquanto ela devolver true.
    _depois(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            if (fn())
                return GLib.SOURCE_CONTINUE;
            this._timeouts.delete(id);
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }
}

function valido(r) {
    return r && (r.x || r.y || r.width || r.height);
}

// Seleção, se houver; senão a palavra que contém (ou termina em) o cursor.
// Offsets em caracteres, relativos ao cursor — o formato de delete_surrounding.
// ponytail: índices de string JS (UTF-16); emoji antes do cursor desalinha. Converter com Array.from se incomodar.
export function trechoSobCursor(texto, cursor, ancora) {
    let ini = Math.min(cursor, ancora);
    let fim = Math.max(cursor, ancora);
    if (ini === fim) {
        while (ini > 0 && LETRA.test(texto[ini - 1]))
            ini--;
        while (fim < texto.length && LETRA.test(texto[fim]))
            fim++;
    }
    if (fim <= ini)
        return null;
    return {original: texto.slice(ini, fim), deslocamento: ini - cursor, tamanho: fim - ini};
}
