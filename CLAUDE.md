# Balão

Extensão do GNOME Shell 46 (Wayland, Zorin OS 18.1) que abre um **balão flutuante interativo** perto do
cursor de digitação — ou do mouse, se não houver campo de texto em foco.

- **Ctrl+Alt+Espaço** — balão principal: sugestões ortográficas (enchant-2, pt_BR) para a palavra/seleção
  e "Pesquisar" no navegador padrão. Escolher uma sugestão troca a palavra direto no app.
- **Super+X** — histórico da área de transferência (texto, imagens, arquivos, qualquer formato).
  Escolher um item vira o conteúdo atual e é colado no campo em foco.

Plano e progresso: [PLANO.md](PLANO.md) — atualize os checkboxes ao concluir etapas.

## Arquivos
- `extension.js` — enable/disable, atalhos, monta os dois balões
- `balao.js` — componente de balão (campo + lista, teclado, arrastar, posicionamento)
- `entrada.js` — `Foco`: posição do cursor de texto, palavra sob o cursor, troca de texto, Ctrl+V virtual
- `historico.js` — captura/armazenamento/restauração da área de transferência
- `ortografia.js` — processo `enchant-2 -a` persistente
- `notch.js` — notch do Nexus no topo da tela (pílula + painel; o Nexo desenhado em Cairo)
- `nexus.js` — integração opcional com o Nexus (D-Bus `dev.nexus.Daemon1`); sem nexusd não faz nada
- `prefs.js` — preferências (libadwaita)
- `schemas/` — GSettings (`org.gnome.shell.extensions.balao`)
- `tests/` — Shell aninhado isolado + testes via `Eval`

## Convenções
- Código, comentários e UI em português.
- ESM (GNOME 45+): `import ... from 'gi://...'` e `resource:///org/gnome/shell/...`.
- Sem `add_actor` (removido no 46): use `add_child`.
- Depois de mexer no schema: `glib-compile-schemas schemas/`.
- Teste com `tests/aninhado.sh` (não precisa sair da sessão). No Wayland o Shell real só recarrega a extensão após logout.
  Casos novos vão em `tests/teste.sh` (`caso "nome" <<'JS' ... JS`, corpo async com `x` = instância da extensão).
- Nos testes **não envie teclas virtuais**: no Shell aninhado elas passam pelo X do host e podem vazar para apps reais.
- Leia bytes de `St.Clipboard.get_content` dentro do callback (o GBytes é liberado depois).
- Não dá para subclassear `Meta.SelectionSource` em JS (vfunc com callback): um formato por item.
