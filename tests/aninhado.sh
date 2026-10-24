#!/usr/bin/env bash
# Abre um GNOME Shell aninhado (numa janela), com perfil isolado, e carrega a extensão.
#   tests/aninhado.sh           → roda tests/teste.sh e fecha
#   tests/aninhado.sh --manual  → deixa aberto para testar na mão (feche a janela para sair)
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/.." && pwd)
# Terminal do VS Code (snap) troca schemas/módulos GIO; volta para os do sistema.
for v in $(compgen -e | grep _VSCODE_SNAP_ORIG$); do
    orig=${v%_VSCODE_SNAP_ORIG}
    if [ -n "${!v}" ]; then export "$orig=${!v}"; else unset "$orig"; fi
done
unset GSETTINGS_SCHEMA_DIR GIO_MODULE_DIR GTK_IM_MODULE_FILE GTK_PATH GTK_EXE_PREFIX GTK_MODULES \
    GDK_PIXBUF_MODULE_FILE GDK_PIXBUF_MODULEDIR LOCPATH $(compgen -e | grep ^SNAP)
UUID=balao@jvfontenele.github.io
TMP=$(mktemp -d -t balao-XXXX)
export XDG_DATA_HOME=$TMP/data XDG_CONFIG_HOME=$TMP/config XDG_CACHE_HOME=$TMP/cache XDG_STATE_HOME=$TMP/state
# no-portals: não há portal no Shell aninhado, e apps GTK travariam esperando por ele.
export GSETTINGS_BACKEND=keyfile MUTTER_DEBUG_DUMMY_MODE_SPECS=${TAMANHO:-1280x800} GDK_DEBUG=no-portals
export RAIZ UUID TMP MODO=${1:-}

EXT=$XDG_DATA_HOME/gnome-shell/extensions
mkdir -p "$EXT" "$XDG_CONFIG_HOME/glib-2.0/settings" "$XDG_CACHE_HOME/clipboard-indicator@tudmotu.com" "$TMP/fotos"
ln -s "$RAIZ" "$EXT/$UUID"
ln -s "$RAIZ/tests/inseguro@balao" "$EXT/inseguro@balao"
glib-compile-schemas "$RAIZ/schemas"
cat > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile" <<KEY
[org/gnome/shell]
enabled-extensions=['$UUID', 'inseguro@balao']
disable-user-extensions=false
welcome-dialog-last-shown-version='999'

[org/gnome/shell/extensions/balao]
# No Shell aninhado o teclado virtual passa pelo X do host: teclas poderiam vazar para os apps reais.
colar-automatico=false
KEY
# Histórico falso da Clipboard Indicator, para testar a importação.
echo '[{"favorite":true,"mimetype":"text/plain;charset=utf-8","contents":"antigo fixado"},{"favorite":false,"mimetype":"text/plain;charset=utf-8","contents":"antigo comum"}]' \
    > "$XDG_CACHE_HOME/clipboard-indicator@tudmotu.com/registry.txt"

echo "Perfil isolado em $TMP"
dbus-run-session -- bash -c 2>"$TMP/dbus.log" '
    gnome-shell --nested --wayland > "$TMP/shell.log" 2>&1 &
    SHELL_PID=$!
    for _ in $(seq 60); do
        gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval 1 2>/dev/null | grep -q true && break
        sleep 0.5
    done
    if [ "$MODO" = --manual ]; then
        echo "Shell aninhado pronto. Ctrl+Alt+Espaço / Super+X dentro da janela."
        wait $SHELL_PID
    else
        bash "${TESTE:-$RAIZ/tests/teste.sh}"; STATUS=$?
        kill $SHELL_PID; wait $SHELL_PID 2>/dev/null
        echo "--- erros do Shell sobre a extensão:"
        grep -iE "balao|JS ERROR|Gjs-CRITICAL" "$TMP/shell.log" | grep -v "^$" | head -40 || echo "(nenhum)"
        exit $STATUS
    fi
'
