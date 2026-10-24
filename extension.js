// SPDX-License-Identifier: GPL-2.0-or-later
// Balão: extensão do GNOME Shell com balão flutuante de correção, pesquisa e histórico da área de transferência.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Balao} from './balao.js';
import {Foco} from './entrada.js';
import {Historico, ICONES} from './historico.js';
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
        Main.wm.addKeybinding('atalho-balao', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, MODOS,
            () => this._alternar(() => this.abrirPrincipal()));
        Main.wm.addKeybinding('atalho-historico', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, MODOS,
            () => this._alternar(() => this.abrirHistorico()));
    }

    disable() {
        Main.wm.removeKeybinding('atalho-balao');
        Main.wm.removeKeybinding('atalho-historico');
        this._balao?.fechar();
        this._settings.disconnect(this._idIdioma);
        this._ortografia.destroy();
        this._historico.destroy();
        this._foco.destroy();
        this._balao = this._settings = this._foco = this._historico = this._ortografia = null;
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
            return [];
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
        return alvo.origem ? [...sugestoes, pesquisa] : [pesquisa, ...sugestoes];
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
            rodape: 'Enter colar · Del remover · Ctrl+P fixar · Esc fechar',
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
