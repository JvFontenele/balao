// SPDX-License-Identifier: GPL-2.0-or-later
// Balão: extensão do GNOME Shell com balão flutuante de correção, pesquisa e histórico da área de transferência.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Balao} from './balao.js';
import {Foco} from './entrada.js';
import {Historico, ICONES} from './historico.js';
import {Nexus} from './nexus.js';
import {Notch} from './notch.js';
import {Ortografia} from './ortografia.js';

const MODOS = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP;

export default class PesquisaLinux extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._foco = new Foco();
        this._historico = new Historico(this._settings);
        this._ortografia = new Ortografia(this._settings.get_string('idioma'));
        this._idIdioma = this._settings.connect('changed::idioma', () => {
            this._ortografia.destroy();
            this._ortografia = new Ortografia(this._settings.get_string('idioma'));
        });
        this._nexus = new Nexus(this._settings);
        this._notch = new Notch(this._nexus, {abrirPrincipal: () => this.abrirPrincipal()});
        Main.wm.addKeybinding('atalho-balao', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, MODOS,
            () => this._alternar(() => this.abrirPrincipal()));
        Main.wm.addKeybinding('atalho-historico', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, MODOS,
            () => this._alternar(() => this.abrirHistorico()));
        Main.wm.addKeybinding('atalho-espelhar', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, MODOS,
            () => this.espelhar());
        Main.wm.addKeybinding('atalho-notch', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, MODOS,
            () => this._nexus.disponivel ? this._notch.alternar() : Main.notify('Nexus', 'Ative "Usar o Nexus" nas preferências do Balão'));
    }

    disable() {
        Main.wm.removeKeybinding('atalho-balao');
        Main.wm.removeKeybinding('atalho-historico');
        Main.wm.removeKeybinding('atalho-espelhar');
        Main.wm.removeKeybinding('atalho-notch');
        this._balao?.fechar();
        this._settings.disconnect(this._idIdioma);
        this._ortografia.destroy();
        this._notch.destroy();
        this._nexus.destroy();
        this._historico.destroy();
        this._foco.destroy();
        this._balao = this._settings = this._foco = this._historico = this._ortografia = this._nexus = this._notch = null;
    }

    // Atalho com o balão aberto fecha o balão.
    _alternar(abrir) {
        if (this._balao?.aberto)
            this._balao.fechar();
        else
            abrir();
    }

    _abrir(alvo, opcoes) {
        this._balao?.fechar();
        this._foco.congelado = true;
        this._balao = new Balao({
            ...opcoes,
            ponto: alvo.ponto,
            aoFechar: () => {
                this._foco.congelado = false;
                this._balao = null;
            },
        });
    }

    async abrirPrincipal() {
        const alvo = this._foco.capturar();
        // Fora de um campo de texto, aproveita o que estiver selecionado (seleção PRIMARY).
        const texto = alvo.origem?.original ?? (alvo.noTexto ? '' : await lerPrimaria());
        this._abrir(alvo, {
            titulo: alvo.origem ? 'Correção e pesquisa' : 'Pesquisa',
            dica: 'Digite para pesquisar ou corrigir…',
            texto: texto.trim().slice(0, 500),
            vazio: 'Digite algo',
            rodape: '↑↓ escolher · Enter confirmar · Esc fechar',
            itens: filtro => this._itensPrincipal(filtro, alvo),
            aoEscolher: item => {
                if (item.acao === 'pesquisar')
                    this._pesquisar(item.termo);
                else if (item.acao === 'nexus')
                    this._enviarNexus(item.pedido, item.dispositivo);
                else if (alvo.origem)
                    this._foco.substituir(alvo.origem, item.rotulo);
                else
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, item.rotulo);
            },
        });
    }

    async _itensPrincipal(filtro, alvo) {
        const termo = filtro.trim();
        if (!termo)
            return this._itensNexus('');
        const pesquisa = {icone: 'system-search-symbolic', rotulo: `Pesquisar “${termo}”`, acao: 'pesquisar', termo};
        let sugestoes = [];
        if (!/\s/.test(termo)) {
            try {
                const r = await this._ortografia.sugerir(termo);
                sugestoes = r.sugestoes.slice(0, 8).map(s => ({
                    icone: 'tools-check-spelling-symbolic',
                    rotulo: s,
                    legenda: alvo.origem ? 'Trocar no texto' : 'Copiar',
                }));
            } catch (e) {
                logError(e, 'balao: enchant');
            }
        }
        // Digitando num campo, a correção vem primeiro; fora dele, a pesquisa.
        const itens = alvo.origem ? [...sugestoes, pesquisa] : [pesquisa, ...sugestoes];
        return [...itens, ...this._itensNexus(termo)];
    }

    // Itens do Nexus (vazio sem o Nexus): espelhar qualquer pareado; com texto, enviar/pesquisar nos conectados.
    _itensNexus(termo) {
        if (!this._nexus.disponivel)
            return [];
        const espelhar = this._nexus.dispositivos.flatMap(d => [
            {icone: 'video-display-symbolic', rotulo: `Espelhar tela do ${d.name}`,
                legenda: 'scrcpy (USB ou depuração sem fio)', acao: 'nexus', dispositivo: d, pedido: {cmd: 'mirror', device_id: d.device_id}},
            ...d.conectado ? [{icone: d.audio ? 'audio-volume-muted-symbolic' : 'audio-speakers-symbolic',
                rotulo: d.audio ? `Parar áudio no ${d.name}` : `Áudio do PC no ${d.name}`, legenda: 'O som do PC sai pelo dispositivo',
                acao: 'nexus', dispositivo: d, pedido: {cmd: d.audio ? 'audio.stop' : 'audio.start', device_id: d.device_id}}] : [],
        ]);
        if (!termo)
            return espelhar;
        const url = this._settings.get_string('url-pesquisa').replace('%s', encodeURIComponent(termo));
        return [...this._nexus.dispositivos.filter(d => d.conectado).flatMap(d => [
            {icone: 'phone-symbolic', rotulo: `Enviar para ${d.name}`, legenda: 'Copia no dispositivo', acao: 'nexus',
                dispositivo: d, pedido: {cmd: 'send.text', device_id: d.device_id, text: termo}},
            {icone: 'system-search-symbolic', rotulo: `Pesquisar no ${d.name}`, legenda: 'Toque na notificação para abrir',
                acao: 'nexus', dispositivo: d, pedido: {cmd: 'open.url', device_id: d.device_id, url}},
        ]), ...espelhar];
    }

    // Atalho: espelha o primeiro dispositivo conectado (ou o primeiro pareado).
    espelhar() {
        if (!this._nexus.disponivel) {
            Main.notify('Nexus', 'Ative "Usar o Nexus" nas preferências do Balão e inicie o nexusd');
            return;
        }
        const ds = this._nexus.dispositivos;
        const d = ds.find(x => x.conectado) ?? ds[0];
        if (!d) {
            Main.notify('Nexus', 'Nenhum dispositivo pareado');
            return;
        }
        this._enviarNexus({cmd: 'mirror', device_id: d.device_id}, d);
    }

    async _enviarNexus(pedido, dispositivo) {
        const r = await this._nexus.comando(pedido);
        if (!r.ok)
            Main.notifyError('Nexus', `${dispositivo.name}: ${r.error ?? 'falhou'}`);
    }

    _pesquisar(termo) {
        const url = this._settings.get_string('url-pesquisa').replace('%s', encodeURIComponent(termo));
        try {
            Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
        } catch (e) {
            Main.notifyError('Balão', `Não abriu o navegador: ${e.message}`);
        }
    }

    abrirHistorico() {
        const alvo = this._foco.capturar();
        this._abrir(alvo, {
            titulo: 'Área de transferência',
            dica: 'Filtrar…',
            vazio: 'Nada copiado ainda',
            rodape: `Enter colar · Del remover · Ctrl+P fixar${this._nexus.dispositivos.some(d => d.conectado) ? ' · Ctrl+E enviar' : ''} · Esc fechar`,
            itens: filtro => this._historico.listar(filtro).map(e => ({
                icone: e.fixado ? 'view-pin-symbolic' : ICONES[e.tipo],
                rotulo: e.previa || '(vazio)',
                legenda: e.legenda,
                entrada: e,
            })),
            aoEscolher: item => {
                if (this._historico.restaurar(item.entrada) && this._settings.get_boolean('colar-automatico'))
                    this._foco.colar();
            },
            aoTecla: (item, simbolo, estado) => {
                if (!item)
                    return false;
                if (simbolo === Clutter.KEY_Delete) {
                    this._historico.remover(item.entrada);
                    return true;
                }
                if ((estado & Clutter.ModifierType.CONTROL_MASK) && (simbolo === Clutter.KEY_p || simbolo === Clutter.KEY_P)) {
                    this._historico.fixar(item.entrada);
                    return true;
                }
                // Ctrl+E: envia o item de texto ao primeiro dispositivo conectado ao Nexus
                if ((estado & Clutter.ModifierType.CONTROL_MASK) && (simbolo === Clutter.KEY_e || simbolo === Clutter.KEY_E)) {
                    const d = this._nexus.disponivel && this._nexus.dispositivos.find(x => x.conectado);
                    if (d && item.entrada.tipo === 'texto')
                        this._enviarNexus({cmd: 'send.text', device_id: d.device_id, text: this._historico.texto(item.entrada)}, d);
                    else if (d && item.entrada.tipo === 'arquivo')  // arquivos copiados no Arquivos (Ctrl+C)
                        for (const uri of this._historico.texto(item.entrada).split(/\r?\n/).filter(l => l.startsWith('file://')))
                            this._enviarNexus({cmd: 'send.file', device_id: d.device_id, path: GLib.filename_from_uri(uri)[0]}, d);
                    return true;
                }
                return false;
            },
        });
    }
}

function lerPrimaria() {
    return new Promise(ok => {
        St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (_c, texto) => ok(texto ?? ''));
    });
}
