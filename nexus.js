// SPDX-License-Identifier: GPL-2.0-or-later
// Integração opcional com o Nexus (nexusd): o Balão vira o frontend do Shell. Toda a rede e a segurança ficam no nexusd;
// aqui só há D-Bus da sessão. Sem o nexusd (ou com a opção desligada) nada disto aparece.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DAEMON = 'dev.nexus.Daemon';
const CAMINHO = '/dev/nexus/Daemon';
const INTERFACE = 'dev.nexus.Daemon1';
const SHELL = 'dev.nexus.Shell'; // avisa o nexusd que o Balão cuida da área de transferência e dos pedidos

export class Nexus {
    constructor(settings) {
        this._settings = settings;
        this.disponivel = false;
        this.dispositivos = [];
        this.ultimo = {arquivo: null, texto: null};
        this.pareamento = null;     // pedido pendente mostrado no notch
        this.transferencia = null;  // arquivo indo/vindo: {id, direction, name, device_name, done, total, inicio}
        this._reacao = null;        // expressão passageira do Nexo: {expr, ate}
        this._ouvintes = new Set();
        this._idAtivo = settings.connect('changed::nexus-ativo', () => this._aplicar());
        this._aplicar();
    }

    destroy() {
        this._settings.disconnect(this._idAtivo);
        this._desligar();
    }

    _aplicar() {
        if (this._settings.get_boolean('nexus-ativo'))
            this._ligar();
        else
            this._desligar();
    }

    _ligar() {
        if (this._idNome)
            return;
        this._idNome = Gio.bus_own_name(Gio.BusType.SESSION, SHELL, Gio.BusNameOwnerFlags.DO_NOT_QUEUE, null, null, null);
        this._idSinal = Gio.DBus.session.signal_subscribe(DAEMON, INTERFACE, 'Event', CAMINHO, null,
            Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, params) => {
                try {
                    this._evento(JSON.parse(params.deepUnpack()[0]));
                } catch (e) {
                    logError(e, 'balao: evento do nexus');
                }
            });
        this._idVigia = Gio.bus_watch_name(Gio.BusType.SESSION, DAEMON, Gio.BusNameWatcherFlags.NONE,
            () => {
                this.disponivel = true;
                this.atualizar();
                // pedidos que chegaram antes de o Balão ver o daemon
                this.comando({cmd: 'pair.pending'}).then(r => (r.pending ?? []).forEach(p => this._avisarPareamento(p)));
            },
            () => {
                this.disponivel = false;
                this.dispositivos = [];
                this.pareamento = null;
                this._avisar();
            });
    }

    _desligar() {
        if (!this._idNome)
            return;
        Gio.bus_unown_name(this._idNome);
        Gio.DBus.session.signal_unsubscribe(this._idSinal);
        Gio.bus_unwatch_name(this._idVigia);
        this._idNome = this._idSinal = this._idVigia = 0;
        this.disponivel = false;
        this.dispositivos = [];
        this.pareamento = null;
        this._avisar();
    }

    // Chama dev.nexus.Daemon1.Command; nunca rejeita: erro vira {ok: false, error}.
    comando(pedido) {
        return new Promise(ok => {
            Gio.DBus.session.call(DAEMON, CAMINHO, INTERFACE, 'Command', new GLib.Variant('(s)', [JSON.stringify(pedido)]),
                new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE, 10000, null, (c, res) => {
                    try {
                        ok(JSON.parse(c.call_finish(res).deepUnpack()[0]));
                    } catch (e) {
                        ok({ok: false, error: e.message});
                    }
                });
        });
    }

    async atualizar() {
        const r = await this.comando({cmd: 'devices.list'});
        this.dispositivos = r.ok ? r.devices.map(d => ({...d, conectado: r.connected.includes(d.device_id),
            audio: r.audio === d.device_id})) : [];
        this._avisar();
    }

    // O notch se redesenha quando algo muda.
    conectar(fn) {
        this._ouvintes.add(fn);
        return () => this._ouvintes.delete(fn);
    }

    _avisar() {
        for (const fn of this._ouvintes) {
            try {
                fn();
            } catch (e) {
                logError(e, 'balao: ouvinte do nexus');
            }
        }
    }

    // Expressão do Nexo agora: pareando > reação recente > áudio > conectado > dormindo.
    get expressao() {
        if (this.pareamento)
            return 'atento';
        if (this._reacao && this._reacao.ate > Date.now())
            return this._reacao.expr;
        if (this.dispositivos.some(d => d.audio))
            return 'curtindo';
        return this.dispositivos.some(d => d.conectado) ? 'conectado' : 'dormindo';
    }

    reagir(expr, ms = 3000) {
        this._reacao = {expr, ate: Date.now() + ms};
        this._avisar();
        setTimeout(() => this._avisar(), ms + 50);
    }

    confirmar(pid, aceitar) {
        return this.comando({cmd: 'pair.confirm', pid, accept: aceitar});
    }

    _evento(ev) {
        switch (ev.event) {
        case 'text.received':
            // vira a área de transferência atual; o Histórico captura pelo owner-changed como qualquer cópia
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, String(ev.text ?? ''));
            Main.notify('Nexus', `Texto de ${ev.name ?? 'dispositivo'} copiado`);
            this.ultimo.texto = String(ev.text ?? '');
            this.reagir('surpreso');
            break;
        case 'file.received':
            this.ultimo.arquivo = String(ev.path ?? '').split('/').pop();
            this.reagir('surpreso', 4000);
            break;
        case 'pair.pending':
            this._mostrarPareamento(ev);
            break;
        case 'file.progress':
            this.transferencia = {...ev, inicio: this.transferencia?.id === ev.id ? this.transferencia.inicio : Date.now()};
            this._avisar();
            break;
        case 'file.done':
            if (this.transferencia?.id !== ev.id)
                break;
            this.transferencia = {...this.transferencia, fim: ev.ok ? 'ok' : 'cancelado'};
            if (ev.ok)
                this.reagir('feito', 2000);
            this._avisar();
            setTimeout(() => {
                if (this.transferencia?.id === ev.id) {
                    this.transferencia = null;
                    this._avisar();
                }
            }, 2000);
            break;
        case 'pair.result':
            Main.notify('Nexus', ev.ok ? `Pareado com ${ev.name ?? 'dispositivo'}` : `Pareamento recusado (${ev.reason ?? ''})`);
            this.pareamento = null;
            if (ev.ok)
                this.reagir('feito');
            this.atualizar();
            break;
        case 'device.connected':
        case 'device.disconnected':
        case 'audio.changed':
            this.atualizar();
            break;
        }
    }

    // Pedido chega pela rede: o notch mostra o código sem pegar o teclado; some ao expirar ou ao responder.
    _mostrarPareamento(p) {
        this.pareamento = p;
        this._avisar();
        const pid = p.pid;
        setTimeout(() => {
            if (this.pareamento?.pid === pid) {
                this.pareamento = null;
                this._avisar();
            }
        }, Math.max(1, p.expires_in ?? 60) * 1000);
    }
}

// "169469" → "169 469"
export function formatarCodigo(codigo) {
    return `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
}
