// SPDX-License-Identifier: GPL-2.0-or-later
// Histórico da área de transferência: captura qualquer conteúdo copiado, guarda em disco e restaura.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const CLIPBOARD = Meta.SelectionType.SELECTION_CLIPBOARD;
const TEXTO = 'text/plain;charset=utf-8';
const ARQUIVOS = 'x-special/gnome-copied-files';
const SENHA = 'x-kde-passwordManagerHint';
const DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'balao']);
const INDICE = GLib.build_filenamev([DIR, 'historico.json']);
const ANTIGO = GLib.build_filenamev([GLib.get_user_cache_dir(), 'clipboard-indicator@tudmotu.com', 'registry.txt']);

export const ICONES = {
    texto: 'text-x-generic-symbolic',
    imagem: 'image-x-generic-symbolic',
    arquivo: 'folder-documents-symbolic',
    outro: 'package-x-generic-symbolic',
};

export class Historico {
    constructor(settings) {
        this._settings = settings;
        this._selecao = global.display.get_selection();
        this._geracao = 0;
        this._minhaFonte = null;
        this._salvarId = 0;
        this.itens = this._carregar();
        this._idDono = this._selecao.connect('owner-changed', (_s, tipo, fonte) => {
            if (tipo === CLIPBOARD && fonte && fonte !== this._minhaFonte)
                this._capturar().catch(e => logError(e, 'balao: captura'));
        });
    }

    destroy() {
        this._selecao.disconnect(this._idDono);
        if (this._salvarId) {
            GLib.source_remove(this._salvarId);
            this._salvarIndice();
        }
    }

    // Fixados primeiro; filtro ignora maiúsculas e acentos.
    listar(filtro = '') {
        const f = semAcento(filtro.trim());
        const itens = f ? this.itens.filter(i => semAcento(`${i.previa} ${i.legenda ?? ''}`).includes(f)) : this.itens;
        return [...itens.filter(i => i.fixado), ...itens.filter(i => !i.fixado)];
    }

    remover(item) {
        this.itens = this.itens.filter(i => i !== item);
        apagar(arquivoItem(item.id));
        this._agendarSalvar();
    }

    fixar(item) {
        item.fixado = !item.fixado;
        this._agendarSalvar();
    }

    // Torna o item o conteúdo atual da área de transferência.
    // ponytail: só o formato principal volta (imagem, arquivos ou texto). O GJS não deixa implementar
    // Meta.SelectionSource.read_async em JS; vários formatos exigiriam um helper em C.
    restaurar(item) {
        let bytes;
        try {
            bytes = new GLib.Bytes(Gio.File.new_for_path(arquivoItem(item.id)).load_contents(null)[1]);
        } catch (e) {
            logError(e, 'balao: item sem arquivo');
            this.remover(item);
            Main.notify('Balão', 'Esse item não está mais no disco e foi removido.');
            return false;
        }
        this._minhaFonte = Meta.SelectionSourceMemory.new(item.mime, bytes);
        this._selecao.set_owner(CLIPBOARD, this._minhaFonte);
        this._paraTopo(item);
        return true;
    }

    async _capturar() {
        const geracao = ++this._geracao;
        const mimes = this._selecao.get_mimetypes(CLIPBOARD);
        const formato = escolherFormato(mimes);
        if (!formato)
            return;
        const bytes = await lerFormato(formato[0]);
        // Nova cópia chegou enquanto líamos esta: ela é que vale.
        if (geracao !== this._geracao)
            return;
        const tamanho = bytes?.get_size() ?? 0;
        if (tamanho && tamanho <= this._settings.get_int('limite-item-mb') * 1024 * 1024)
            this._adicionar(formato[1], bytes);
    }

    _adicionar(mime, bytes) {
        const id = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA1, bytes);
        const existente = this.itens.find(i => i.id === id);
        if (existente) {
            this._paraTopo(existente);
            return;
        }
        GLib.mkdir_with_parents(GLib.path_get_dirname(arquivoItem(id)), 0o700);
        Gio.File.new_for_path(arquivoItem(id)).replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.PRIVATE, null, (f, r) => {
                try {
                    f.replace_contents_finish(r);
                } catch (e) {
                    logError(e, 'balao: gravar item');
                }
            });
        this.itens.unshift({id, mime, fixado: false, quando: Date.now(), ...descrever(mime, bytes.toArray())});
        this._podar();
        this._agendarSalvar();
    }

    _paraTopo(item) {
        item.quando = Date.now();
        this.itens = [item, ...this.itens.filter(i => i !== item)];
        this._agendarSalvar();
    }

    _podar() {
        const maximo = this._settings.get_int('tamanho-historico');
        const soltos = this.itens.filter(i => !i.fixado);
        soltos.slice(maximo).forEach(i => this.remover(i));
    }

    _agendarSalvar() {
        if (this._salvarId)
            return;
        this._salvarId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._salvarId = 0;
            this._salvarIndice();
            return GLib.SOURCE_REMOVE;
        });
    }

    _salvarIndice() {
        GLib.mkdir_with_parents(DIR, 0o700);
        // Prévias do que foi copiado: só o próprio usuário lê.
        GLib.file_set_contents_full(INDICE, JSON.stringify(this.itens), GLib.FileSetContentsFlags.CONSISTENT, 0o600);
    }

    _carregar() {
        try {
            const [, conteudo] = GLib.file_get_contents(INDICE);
            return JSON.parse(new TextDecoder().decode(conteudo));
        } catch (e) {
            if (!e.matches?.(GLib.FileError, GLib.FileError.NOENT))
                logError(e, 'balao: índice ilegível, começando vazio');
        }
        // Primeira execução: traz o histórico da Clipboard Indicator, se existir.
        this.itens = [];
        try {
            const [, conteudo] = GLib.file_get_contents(ANTIGO);
            const antigos = JSON.parse(new TextDecoder().decode(conteudo));
            for (const a of antigos.reverse()) {
                const mime = a.mimetype || TEXTO;
                const ehTexto = mime.startsWith('text/');
                if (!ehTexto && !GLib.file_test(a.contents, GLib.FileTest.EXISTS))
                    continue;
                const bytes = ehTexto
                    ? new GLib.Bytes(new TextEncoder().encode(a.contents))
                    : new GLib.Bytes(GLib.file_get_contents(a.contents)[1]);
                this._adicionar(ehTexto ? TEXTO : mime, bytes);
                this.itens[0].fixado = !!a.favorite;
            }
        } catch (e) {
            if (!e.matches?.(GLib.FileError, GLib.FileError.NOENT))
                logError(e, 'balao: importar Clipboard Indicator');
        }
        return this.itens;
    }
}

// Formato principal de uma cópia → [mime a ler, mime a guardar], ou null para não guardar.
// Imagem (PNG se houver) > arquivos copiados > texto > o primeiro tipo MIME de verdade.
// Atoms X11 (TARGETS, TIMESTAMP...) não têm "/" e ficam de fora.
export function escolherFormato(mimes) {
    if (mimes.includes(SENHA))
        return null;
    const imagens = mimes.filter(m => m.startsWith('image/'));
    const imagem = imagens.includes('image/png') ? 'image/png' : imagens[0];
    if (imagem)
        return [imagem, imagem];
    if (mimes.includes(ARQUIVOS))
        return [ARQUIVOS, ARQUIVOS];
    const texto = [TEXTO, 'UTF8_STRING', 'text/plain'].find(m => mimes.includes(m));
    if (texto)
        return [texto, TEXTO];
    const outro = mimes.find(m => m.includes('/'));
    return outro ? [outro, outro] : null;
}

// → {tipo, previa, legenda}
export function descrever(mime, conteudo) {
    const tamanho = GLib.format_size(conteudo.length);
    if (mime.startsWith('image/'))
        return {tipo: 'imagem', previa: `Imagem ${mime.split('/')[1].toUpperCase()}`, legenda: tamanho};

    const texto = new TextDecoder().decode(conteudo);
    if (mime === ARQUIVOS || mime === 'text/uri-list') {
        const uris = texto.split(/\r?\n/).filter(l => l.startsWith('file://'));
        const nomes = uris.map(u => GLib.uri_unescape_string(u.split('/').pop(), null) ?? u);
        return {tipo: 'arquivo', previa: nomes.join(', '), legenda: uris.length > 1 ? `${uris.length} arquivos` : 'Arquivo'};
    }
    if (mime === TEXTO)
        return {tipo: 'texto', previa: texto.replace(/\s+/g, ' ').trim().slice(0, 300), legenda: null};
    return {tipo: 'outro', previa: mime, legenda: tamanho};
}

// O GBytes do callback é liberado quando ele retorna: copia antes.
function lerFormato(mime) {
    return new Promise(ok => {
        St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, mime,
            (_c, bytes) => ok(bytes?.get_size() ? new GLib.Bytes(bytes.get_data()) : null));
    });
}

function arquivoItem(id) {
    return GLib.build_filenamev([DIR, 'itens', id]);
}

function apagar(caminho) {
    try {
        Gio.File.new_for_path(caminho).delete(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            logError(e, 'balao: apagar item');
    }
}

function semAcento(s) {
    return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
