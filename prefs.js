// SPDX-License-Identifier: GPL-2.0-or-later
// Preferências: atalhos, idioma, pesquisa e histórico.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Preferencias extends ExtensionPreferences {
    fillPreferencesWindow(janela) {
        const s = this.getSettings();
        const pagina = new Adw.PreferencesPage();
        janela.add(pagina);

        const atalhos = new Adw.PreferencesGroup({
            title: 'Atalhos',
            description: 'Formato GTK, ex.: &lt;Control&gt;&lt;Alt&gt;space, &lt;Super&gt;x. Confirme com Enter.',
        });
        pagina.add(atalhos);
        atalhos.add(linhaTexto(s, 'atalho-balao', 'Correção e pesquisa', t => Gtk.accelerator_parse(t)[0], true));
        atalhos.add(linhaTexto(s, 'atalho-historico', 'Área de transferência', t => Gtk.accelerator_parse(t)[0], true));
        atalhos.add(linhaTexto(s, 'atalho-espelhar', 'Espelhar dispositivo (Nexus)', t => Gtk.accelerator_parse(t)[0], true));
        atalhos.add(linhaTexto(s, 'atalho-notch', 'Notch do Nexus', t => Gtk.accelerator_parse(t)[0], true));

        const texto = new Adw.PreferencesGroup({title: 'Correção e pesquisa'});
        pagina.add(texto);
        texto.add(linhaTexto(s, 'idioma', 'Dicionário (enchant)', t => /^[a-z]{2,3}(_[A-Z]{2})?$/.test(t)));
        texto.add(linhaTexto(s, 'url-pesquisa', 'URL de pesquisa (%s = texto)', t => t.includes('%s')));

        const historico = new Adw.PreferencesGroup({title: 'Área de transferência'});
        pagina.add(historico);
        const tamanho = Adw.SpinRow.new_with_range(5, 1000, 5);
        tamanho.title = 'Itens guardados (fixados não contam)';
        s.bind('tamanho-historico', tamanho, 'value', Gio.SettingsBindFlags.DEFAULT);
        historico.add(tamanho);
        const limite = Adw.SpinRow.new_with_range(1, 500, 1);
        limite.title = 'Tamanho máximo de um item (MB)';
        s.bind('limite-item-mb', limite, 'value', Gio.SettingsBindFlags.DEFAULT);
        historico.add(limite);
        const colar = new Adw.SwitchRow({title: 'Colar direto no campo em foco', subtitle: 'Desligado: só copia o item'});
        s.bind('colar-automatico', colar, 'active', Gio.SettingsBindFlags.DEFAULT);
        historico.add(colar);

        const nexus = new Adw.PreferencesGroup({
            title: 'Integração com o Nexus',
            description: 'Dispositivos pareados pelo Nexus: texto recebido vai para a área de transferência, pedidos de pareamento abrem um balão.',
        });
        pagina.add(nexus);
        const ativo = new Adw.SwitchRow({title: 'Usar o Nexus', subtitle: nexusRodando() ? 'nexusd encontrado' : 'nexusd não está rodando'});
        s.bind('nexus-ativo', ativo, 'active', Gio.SettingsBindFlags.DEFAULT);
        nexus.add(ativo);
        const passando = new Adw.SwitchRow({title: 'Abrir o notch ao passar o mouse',
            subtitle: 'Sem clicar; fecha quando o mouse sai e não pega o teclado'});
        s.bind('notch-abrir-passando', passando, 'active', Gio.SettingsBindFlags.DEFAULT);
        nexus.add(passando);
    }
}

function nexusRodando() {
    try {
        return Gio.DBus.session.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'NameHasOwner', new GLib.Variant('(s)', ['dev.nexus.Daemon']), null, Gio.DBusCallFlags.NONE, 1000, null).deepUnpack()[0];
    } catch {
        return false;
    }
}

// Campo que só grava ao confirmar (Enter/botão) e se `valido(texto)`.
function linhaTexto(s, chave, titulo, valido, lista = false) {
    const ler = () => lista ? s.get_strv(chave)[0] ?? '' : s.get_string(chave);
    const linha = new Adw.EntryRow({title: titulo, text: ler(), show_apply_button: true});
    linha.connect('apply', () => {
        const t = linha.text.trim();
        if (!valido(t)) {
            linha.add_css_class('error');
            return;
        }
        linha.remove_css_class('error');
        if (lista)
            s.set_strv(chave, [t]);
        else
            s.set_string(chave, t);
    });
    linha.connect('changed', () => linha.remove_css_class('error'));
    return linha;
}
