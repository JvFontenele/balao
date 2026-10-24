// SPDX-License-Identifier: GPL-2.0-or-later
// Só carregada pelo tests/aninhado.sh, num Shell aninhado com perfil isolado.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class Inseguro extends Extension {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
