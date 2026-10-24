#!/usr/bin/env python3
"""nexusd falso para os testes do módulo Nexus: ocupa dev.nexus.Daemon no barramento privado do dbus-run-session.
Command responde com dados fixos e guarda o último pedido; Emitir(s) dispara o sinal Event (só existe aqui)."""
import json

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

XML = """<node><interface name="dev.nexus.Daemon1">
  <method name="Command"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
  <method name="Emitir"><arg type="s" direction="in"/></method>
  <signal name="Event"><arg type="s"/></signal>
</interface></node>"""
POCO = {"device_id": "7b" * 32, "name": "POCO", "kind": "phone", "paired_at": "x", "permissions": []}
ultimo = {}


def responder(req):
    cmd = req.get("cmd")
    if cmd == "ultimo":
        return ultimo
    ultimo.clear()
    ultimo.update(req)
    if cmd == "devices.list":
        return {"ok": True, "devices": [POCO], "connected": [POCO["device_id"]], "audio": None}
    if cmd == "pair.pending":
        return {"ok": True, "pending": []}
    if cmd in ("send.text", "open.url", "mirror", "audio.start", "audio.stop", "send.file"):
        return {"ok": True}
    if cmd == "pair.confirm":
        return {"ok": True, "paired": bool(req.get("accept"))}
    return {"ok": False, "error": "comando desconhecido"}


def chamada(conn, _sender, path, iface, metodo, params, inv):
    if metodo == "Command":
        resp = responder(json.loads(params.unpack()[0]))
        inv.return_value(GLib.Variant("(s)", (json.dumps(resp),)))
    else:
        conn.emit_signal(None, path, iface, "Event", GLib.Variant("(s)", (params.unpack()[0],)))
        inv.return_value(None)


def adquirido(conn, _nome):  # bus_acquired
    conn.register_object("/dev/nexus/Daemon", Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], chamada, None, None)


# registra o objeto antes de ocupar o nome: quem vê o nome já consegue chamar
Gio.bus_own_name(Gio.BusType.SESSION, "dev.nexus.Daemon", Gio.BusNameOwnerFlags.NONE, adquirido, None, None)
GLib.MainLoop().run()
