# Funções comuns dos testes: PRELUDIO (JS) e caso(). Use com `source tests/comum.sh`.
PASSOU=0; FALHOU=0
PRELUDIO="
const U = '$UUID', RAIZ = '$RAIZ', FOTOS = '$TMP/fotos';
const {default: St} = await import('gi://St');
const {default: GLib} = await import('gi://GLib');
const {default: Gio} = await import('gi://Gio');
const {default: Meta} = await import('gi://Meta');
const {default: Shell} = await import('gi://Shell');
const {default: Clutter} = await import('gi://Clutter');
const {default: GdkPixbuf} = await import('gi://GdkPixbuf');
const x = Main.extensionManager.lookup(U).stateObj;
const CB = St.ClipboardType.CLIPBOARD;
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const json = o => JSON.stringify(o);
const lerTexto = () => new Promise(r => St.Clipboard.get_default().get_text(CB, (_c, t) => r(t)));
const lerBytes = m => new Promise(r => St.Clipboard.get_default().get_content(CB, m, (_c, b) => r(b && new GLib.Bytes(b.get_data()))));
const foto = nome => new Promise((r, j) => {
    const f = Gio.File.new_for_path(FOTOS + '/' + nome);
    const s = f.replace(null, false, Gio.FileCreateFlags.NONE, null);
    new Shell.Screenshot().screenshot(false, s, (o, res) => {
        try { o.screenshot_finish(res); s.close(null); r(); } catch (e) { j(e); }
    });
});
"

caso() {
    local nome=$1 corpo saida
    corpo=$(cat)
    saida=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "(async () => { $PRELUDIO $corpo })()" 2>&1)
    if [[ $saida == "(true,"* ]]; then
        PASSOU=$((PASSOU + 1)); echo "  ok    $nome  ${saida:7:${CORTE:-160}}"
    else
        FALHOU=$((FALHOU + 1)); echo "  FALHA $nome  $saida"
    fi
}

