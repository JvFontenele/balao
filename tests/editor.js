// SPDX-License-Identifier: GPL-2.0-or-later
// Mini editor GTK4 (Wayland nativo) usado pelos testes de ponta a ponta.
// gjs -m tests/editor.js "texto inicial" posicao_do_cursor
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import System from 'system';

const [inicial = '', cursor] = System.programArgs;
Gtk.init();
const janela = new Gtk.Window({title: 'Editor de teste', default_width: 640, default_height: 320});
const texto = new Gtk.TextView({wrap_mode: Gtk.WrapMode.WORD, top_margin: 40, left_margin: 40});
texto.buffer.set_text(inicial, -1);
texto.buffer.place_cursor(texto.buffer.get_iter_at_offset(Number(cursor ?? inicial.length)));
janela.set_child(texto);
janela.present();
texto.grab_focus();
const laco = new GLib.MainLoop(null, false);
janela.connect('close-request', () => laco.quit());
laco.run();
