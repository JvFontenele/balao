// SPDX-License-Identifier: GPL-2.0-or-later
// Abre a janela de preferências fora do app de Extensões (que demora/trava no Shell aninhado).
// Troca só a classe base ExtensionPreferences por um stub que lê o schema da pasta do projeto.
// gjs -m tests/prefs.js <raiz> <pasta-temporaria>
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const [raiz, tmp] = System.programArgs;
const base = `${tmp}/prefs-base.js`;
GLib.file_set_contents(base, `
import Gio from 'gi://Gio';
export class ExtensionPreferences {
    getSettings() {
        const fonte = Gio.SettingsSchemaSource.new_from_directory('${raiz}/schemas', Gio.SettingsSchemaSource.get_default(), false);
        return new Gio.Settings({settings_schema: fonte.lookup('org.gnome.shell.extensions.balao', true)});
    }
}`);
const [, codigo] = GLib.file_get_contents(`${raiz}/prefs.js`);
GLib.file_set_contents(`${tmp}/prefs-teste.js`, new TextDecoder().decode(codigo)
    .replace(/from 'resource:\/\/\/org\/gnome\/Shell\/Extensions\/js\/extensions\/prefs.js'/, `from 'file://${base}'`));

const {default: Preferencias} = await import(`file://${tmp}/prefs-teste.js`);
Adw.init();
const janela = new Adw.PreferencesWindow({title: 'Balão', default_height: 760});
new Preferencias().fillPreferencesWindow(janela);
janela.present();
const laco = new GLib.MainLoop(null, false);
janela.connect('close-request', () => laco.quit());
laco.run();
