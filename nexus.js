// SPDX-License-Identifier: GPL-2.0-or-later
// Integração opcional com o Nexus (nexusd): o Balão vira o frontend do Shell. Toda a rede e a segurança ficam no nexusd;
// aqui só há D-Bus da sessão. Sem o nexusd (ou com a opção desligada) nada disto aparece.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const DAEMON = 'dev.nexus.Daemon';
const CAMINHO = '/dev/nexus/Daemon';
const INTERFACE = 'dev.nexus.Daemon1';
const SHELL = 'dev.nexus.Shell'; // avisa o nexusd que o Balão cuida da área de transferência e dos pedidos

export class Nexus {
    // aoParear(pedido): abre o balão de conferência do código.
    constructor(settings, {aoParear}) {
        this._settings = settings;
        this._aoParear = aoParear;
        this.disponivel = false;
        this.dispositivos = [];
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
            break;
        case 'pair.pending':
            this._avisarPareamento(ev);
            break;
        case 'pair.result':
            Main.notify('Nexus', ev.ok ? `Pareado com ${ev.name ?? 'dispositivo'}` : `Pareamento recusado (${ev.reason ?? ''})`);
            this.atualizar();
            break;
        case 'device.connected':
        case 'device.disconnected':
        case 'audio.changed':
            this.atualizar();
            break;
        }
    }

    // Pedido chega pela rede: só uma notificação. O balão (que pega o teclado) abre quando o usuário pede.
    _avisarPareamento(p) {
        const fonte = new MessageTray.Source({title: 'Nexus', iconName: 'phone-symbolic'});
        Main.messageTray.add(fonte);
        const n = new MessageTray.Notification({
            source: fonte,
            title: 'Pedido de pareamento',
            body: `${p.name} quer parear com este PC.`,
            urgency: MessageTray.Urgency.CRITICAL,
        });
        n.addAction('Conferir código', () => this._aoParear(p));
        fonte.addNotification(n);
    }
}

// "169469" → "169 469"
export function formatarCodigo(codigo) {
    return `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
}
