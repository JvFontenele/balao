# Plano — Balão

Extensão do GNOME Shell que abre um **balão flutuante** junto do cursor de digitação (ou do mouse) com:
correção ortográfica, pesquisa no navegador padrão e histórico da área de transferência.

Legenda: `[x]` concluído · `[~]` feito, falta validar no uso real · `[ ]` pendente

## Sistema alvo

| Item | Valor |
|---|---|
| SO | Zorin OS 18.1 (base Ubuntu 24.04) |
| Shell | GNOME Shell 46, sessão **Wayland** |
| Entrada | IBus ativo, teclado `br` |
| Ortografia | `enchant-2` com hunspell pt_BR / en_US |
| Navegador | Google Chrome (padrão) |

**Por que extensão do Shell:** no Wayland um app comum não posiciona janela onde quer, não lê a posição
global do mouse nem o cursor de texto de outros apps. Dentro do Shell tudo isso está disponível.

## Decisões técnicas

| Necessidade | Como |
|---|---|
| Atalhos globais | `Main.wm.addKeybinding` + chaves GSettings (configuráveis) |
| Posição do cursor de texto | `Main.inputMethod._cursorRect` (apps Wayland) → sinal `set-cursor-location` do `IBusManager` (XWayland) → mouse (`global.get_pointer()`) |
| Texto sob o cursor | `Main.inputMethod.getSurroundingText()` (seleção ou palavra) |
| Trocar palavra no app | `Main.inputMethod.delete_surrounding()` + `commit()` depois que o foco volta ao app; se falhar, copia e avisa |
| Captura da área de transferência | sinal `owner-changed` de `global.display.get_selection()` + `St.Clipboard.get_content()` (copiar os bytes **dentro** do callback: o GBytes é liberado depois) |
| Restaurar item | `Meta.SelectionSourceMemory` com o **formato principal** (imagem PNG > arquivos copiados > texto > outro) |
| Colar direto no campo | teclado virtual do Clutter: Shift+Insert (o mesmo da Clipboard Indicator); Ctrl+Shift+V em terminal |
| Ortografia | processo `enchant-2 -a -d pt_BR` persistente (protocolo ispell) |
| Pesquisa | `Gio.AppInfo.launch_default_for_uri` com URL configurável |
| Armazenamento | `~/.local/share/balao/historico.json` + `itens/<sha1>` (pasta 700, arquivos 600) |
| Testes | `tests/aninhado.sh`: GNOME Shell aninhado, perfil isolado, roda `tests/teste.sh` via `Eval` |

### Descobertas durante a implementação
- **GJS não permite implementar `Meta.SelectionSource.read_async` em JS** ("VFunc accepts another callback").
  Por isso cada item volta só com o formato principal. Para vários formatos ao mesmo tempo (ex.: HTML + texto)
  seria preciso um helper em C. Texto rico copiado volta como texto puro.
- No Shell **aninhado**, o teclado virtual passa pelo XTest do X do host: os modificadores (Ctrl, Shift) não chegam
  e as teclas podem vazar para os apps reais. Os testes não enviam teclas, e a colagem automática fica desligada no perfil de teste.
- O terminal do VS Code (snap) injeta `GSETTINGS_SCHEMA_DIR`, `GTK_PATH`, `LOCPATH` etc. `tests/aninhado.sh` limpa tudo isso.
- Apps GTK no Shell aninhado travam esperando o portal: `GDK_DEBUG=no-portals`.

## Etapas

### Fase 0 — Documentação
- [x] `PLANO.md` (este arquivo)
- [x] `CLAUDE.md` com descrição do app

### Fase 1 — Esqueleto e prova de conceito
- [x] `metadata.json`, `schemas/*.gschema.xml`, `stylesheet.css`
- [x] `extension.js` com `enable/disable` e os dois atalhos
- [x] `entrada.js`: rastreio do cursor de texto (inputMethod + IBus) com reserva no mouse
- [x] Ambiente de teste aninhado (`tests/aninhado.sh`) isolado do perfil do usuário — 25 testes passando
- [x] Cursor de texto encontrado num app GTK4 Wayland (teste com `tests/editor.js`)
- [ ] **Validar no uso real** a posição do cursor em: Chrome, VS Code, Editor de Texto, LibreOffice, Terminal
      (Chrome/Electron podem precisar de `--enable-wayland-ime`; apps XWayland usam o caminho do IBus, ainda não testado)

### Fase 2 — Componente de balão (`balao.js`)
- [x] Campo de texto + lista com ícone e rótulo
- [x] ↑/↓, Tab, PgUp/PgDn, Enter, clique, mouse em movimento seleciona, Esc fecha, clique fora fecha
- [~] Arrastar pelo título (código pronto, sem teste automático)
- [x] Posiciona abaixo do cursor; vira para cima se faltar espaço; respeita o monitor
- [x] Lista assíncrona (sugestões chegam depois) sem condição de corrida
- [x] Novo balão fecha o anterior; atalho com balão aberto fecha

### Fase 3 — Histórico da área de transferência (`historico.js`)
- [x] Captura de qualquer conteúdo (texto, imagem, arquivos, outros) com limite por item
- [x] Ignora cópias de gerenciador de senha (`x-kde-passwordManagerHint`)
- [x] Deduplicação (item repetido sobe ao topo)
- [x] Armazenamento em disco + limite de itens (fixados não contam), arquivos privados (600)
- [x] Importação do histórico da Clipboard Indicator (primeira execução)
- [x] Balão do histórico: filtro sem acento, ícone genérico para não-texto, Del remove, Ctrl+P fixa
- [x] Ao escolher: vira o conteúdo atual (Ctrl+V continua funcionando)
- [~] Colar automático no campo em foco (Shift+Insert virtual) — **validar no uso real**
- [x] Desativar a Clipboard Indicator no uso real (conflito no Super+X)

### Fase 4 — Pesquisa
- [x] Balão principal com campo preenchido pela palavra/seleção (ou seleção PRIMARY no modo mouse)
- [~] Item "Pesquisar …" abre o navegador padrão com a URL configurada (não testado no aninhado para não abrir o Chrome)

### Fase 5 — Correção ortográfica (`ortografia.js`)
- [x] Processo `enchant-2` persistente com fila de consultas
- [x] Sugestões no balão principal para a palavra digitada/selecionada
- [x] Troca da palavra direto no app (`delete_surrounding` + `commit`) — testado: "caza" → "casa" no editor GTK4
- [~] Reserva na área de transferência quando o app não colabora (código pronto, sem teste)

### Fase 6 — Preferências (`prefs.js`)
- [x] Atalhos, idioma, URL de pesquisa, tamanho do histórico, limite por item, colar automático

### Fase 7 — Instalação e uso real
- [~] Instalar (symlink + habilitada em `enabled-extensions`), desativar Clipboard Indicator — falta sair e entrar na sessão
- [ ] Rodar o roteiro de validação abaixo e anotar o que falhar

### Fase 9 — Integração com o Nexus (opcional, `nexus.js`)
Nexus = projeto separado (`~/Documentos/projetos/Nexus: integracao-pc-mobile`, ADR-0003): o `nexusd` cuida da rede, do
TLS e do pareamento; o Balão é só o frontend no Shell, falando pelo D-Bus da sessão (`dev.nexus.Daemon1`: `Command`/`Event`).
- [x] Preferência "Usar o Nexus" (`nexus-ativo`, desligada por padrão); sem nexusd, nada aparece
- [x] Ocupa `dev.nexus.Shell` só quando ligado (o nexusd sabe que o Balão cuida da área de transferência)
- [x] Texto recebido do dispositivo → área de transferência (`St.Clipboard`) → entra no histórico pelo `owner-changed`
- [x] Pedido de pareamento → notificação "Conferir código" → balão com o código ("Recusar" primeiro; não abre sozinho para não pegar o teclado)
- [x] nexusd some ou volta: o Balão segue normal — 5 testes com `tests/nexus_falso.py` no barramento privado
- [x] Balão principal: "Enviar para <dispositivo>" e "Pesquisar no <dispositivo>" para cada dispositivo conectado
- [x] "Espelhar tela do <dispositivo>" (scrcpy via nexusd), também com o campo vazio; atalho Super+Shift+M (`atalho-espelhar`)
- [x] "Áudio do PC no <dispositivo>" / "Parar áudio" (som do PC sai no celular, Nexus A04)
- [x] Notch do Nexus (`notch.js`): pílula sob o relógio (rosto do Nexo, conexão, áudio) que abre painel com o dispositivo e 6 controles; Super+Shift+N; pedido de pareamento abre o notch sem pegar o teclado (Recusar primeiro), substituindo a notificação
- [x] (validado no uso real 2026-10-24) Notch escondido por padrão: desce com animação ao empurrar o mouse no topo (barreira de pressão, sem roubar cliques) ou pelo atalho; encosta na borda quando a barra do Zorin está embaixo (`topoLivre`)
- [x] Notch: transferência de arquivo com barra, velocidade e cancelar (eventos `file.progress`/`file.done` do Nexus)
- [ ] Arrastar arquivos até o notch (precisa de prova de conceito no Wayland)
- [x] Histórico: Ctrl+E envia o item ao primeiro dispositivo conectado: texto completo ou arquivos copiados (Nexus A06)
- [x] Uso real com o nexusd e o POCO (2026-10-24): pareamento pela notificação, Enviar/Pesquisar no dispositivo, Ctrl+E, texto recebido no histórico

### Fase 8 — Opcional
- [ ] Miniatura das imagens na lista
- [ ] Vários formatos por item (helper em C para `Meta.SelectionSource`)
- [ ] Gramática com LanguageTool local (Java 17 já instalado)
- [ ] Correção de frases inteiras (várias palavras)
- [ ] Empacotar (`gnome-extensions pack`)

## Como testar

```bash
tests/aninhado.sh            # abre um GNOME Shell aninhado (janela) com a extensão e roda os testes automáticos
tests/aninhado.sh --manual   # só abre o Shell aninhado para uso manual (Ctrl+Alt+Espaço / Super+X)
```

## Instalar no uso real

```bash
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/balao@jvfontenele.github.io
glib-compile-schemas schemas/
gnome-extensions disable clipboard-indicator@tudmotu.com
# sair e entrar na sessão (Wayland não recarrega o Shell), depois:
gnome-extensions enable balao@jvfontenele.github.io
journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i balao   # erros
```

### Roteiro de validação no uso real
1. Em cada app (Chrome, VS Code, Editor de Texto, LibreOffice, Terminal), escreva "caza", Ctrl+Alt+Espaço:
   o balão abre junto da palavra? Enter em "casa" troca no texto?
2. Na área de trabalho, sem campo de texto: Ctrl+Alt+Espaço abre no mouse? "Pesquisar" abre o Chrome?
3. Copie texto, uma imagem (Chrome: "Copiar imagem") e um arquivo (Arquivos): aparecem no Super+X?
4. Escolha cada um com o cursor num campo: cola direto? Depois, Ctrl+V comum também cola?
5. Copie uma senha do gerenciador de senhas: não deve aparecer no histórico.

## Riscos em aberto
- Apps sem IBus/text-input (alguns Electron antigos, Java/Swing): balão abre no mouse; troca de palavra cai na área de transferência.
- `Main.inputMethod._cursorRect` é campo interno do Shell — isolado em `entrada.js` (`Foco.capturar`).
