// SPDX-License-Identifier: GPL-2.0-or-later
// Sugestões ortográficas via `enchant-2 -a` (protocolo ispell), num processo que fica aberto.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class Ortografia {
    constructor(idioma) {
        this._idioma = idioma;
        this._fila = Promise.resolve();
        this._proc = null;
    }

    destroy() {
        this._proc?.force_exit();
        this._proc = null;
    }

    // → {correta: bool, sugestoes: string[]}
    sugerir(palavra) {
        const resposta = this._fila.then(() => this._consultar(palavra));
        this._fila = resposta.catch(() => {});
        return resposta;
    }

    _iniciar() {
        this._proc = Gio.Subprocess.new(['enchant-2', '-a', '-d', this._idioma],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        this._entrada = this._proc.get_stdin_pipe();
        this._saida = new Gio.DataInputStream({base_stream: this._proc.get_stdout_pipe()});
        this._pronto = this._linha(); // cabeçalho "@(#) International Ispell..."
    }

    _linha() {
        return new Promise((ok, erro) => {
            this._saida.read_line_async(GLib.PRIORITY_DEFAULT, null, (s, r) => {
                try {
                    const [linha] = s.read_line_finish_utf8(r);
                    if (linha === null)
                        throw new Error('enchant-2 encerrou');
                    ok(linha);
                } catch (e) {
                    erro(e);
                }
            });
        });
    }

    async _consultar(palavra) {
        palavra = palavra.replace(/\s+/g, ' ').trim();
        if (!palavra)
            return {correta: true, sugestoes: []};
        try {
            if (!this._proc)
                this._iniciar();
            await this._pronto;
            // "^" = linha de texto, nunca um comando ispell.
            this._entrada.write_all(new TextEncoder().encode(`^${palavra}\n`), null);
            const linhas = [];
            for (let l = await this._linha(); l !== ''; l = await this._linha())
                linhas.push(l);
            return interpretar(linhas);
        } catch (e) {
            this.destroy();
            throw e;
        }
    }
}

// Uma linha por palavra; considera correto se todas forem "*", "+" ou "-".
// Sugestões só fazem sentido para uma palavra: "& palavra N pos: s1, s2, ..."
export function interpretar(linhas) {
    const erradas = linhas.filter(l => l.startsWith('&') || l.startsWith('#'));
    if (!erradas.length)
        return {correta: true, sugestoes: []};
    const l = erradas[0];
    const sugestoes = l.startsWith('&') ? l.slice(l.indexOf(':') + 2).split(', ') : [];
    return {correta: false, sugestoes};
}
