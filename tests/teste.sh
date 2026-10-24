#!/usr/bin/env bash
# Casos de teste executados dentro do Shell aninhado via org.gnome.Shell.Eval.
# Rodado por tests/aninhado.sh (que exporta RAIZ, UUID e TMP).
set -u
source "$RAIZ/tests/comum.sh"

echo "== Fase 1: carga"
caso "extensão ativa" <<'JS'
const e = Main.extensionManager.lookup(U);
ok(e.state === 1, 'estado ' + e.state + ' erro ' + e.error);
return 'ativa';
JS

echo "== Funções puras"
caso "trechoSobCursor" <<'JS'
const {trechoSobCursor: t} = await import('file://' + RAIZ + '/entrada.js');
ok(json(t('foo caza bar', 6, 6)) === json({original: 'caza', deslocamento: -2, tamanho: 4}), 'meio da palavra');
ok(json(t('foo caza', 8, 8)) === json({original: 'caza', deslocamento: -4, tamanho: 4}), 'fim da palavra');
ok(json(t('foo ação x', 4, 4)) === json({original: 'ação', deslocamento: 0, tamanho: 4}), 'acento, início');
ok(json(t('um dois tres', 8, 3)) === json({original: 'dois ', deslocamento: -5, tamanho: 5}), 'seleção');
ok(t('a  b', 2, 2) === null, 'entre espaços');
return 'ok';
JS
caso "interpretar (ispell)" <<'JS'
const {interpretar: i} = await import('file://' + RAIZ + '/ortografia.js');
ok(json(i(['& caza 3 0: casa, caça, cara'])) === json({correta: false, sugestoes: ['casa', 'caça', 'cara']}), '&');
ok(i(['*']).correta && i(['+ casa']).correta, '* e +');
ok(json(i(['# xyzq 0'])) === json({correta: false, sugestoes: []}), '#');
return 'ok';
JS
caso "escolherFormato/descrever" <<'JS'
const {escolherFormato: e, descrever: d} = await import('file://' + RAIZ + '/historico.js');
const t = ['TARGETS', 'UTF8_STRING', 'text/plain;charset=utf-8', 'text/plain', 'text/html'];
ok(json(e(t)) === json(['text/plain;charset=utf-8', 'text/plain;charset=utf-8']), 'texto ' + json(e(t)));
ok(json(e(['UTF8_STRING', 'TARGETS'])) === json(['UTF8_STRING', 'text/plain;charset=utf-8']), 'UTF8_STRING');
ok(e([...t, 'image/jpeg', 'image/png'])[0] === 'image/png', 'png primeiro');
ok(e(['text/uri-list', 'x-special/gnome-copied-files', 'UTF8_STRING'])[0] === 'x-special/gnome-copied-files', 'arquivos');
ok(e([...t, 'x-kde-passwordManagerHint']) === null, 'senha');
ok(e(['TARGETS', 'TIMESTAMP']) === null, 'só atoms');
ok(json(e(['application/x-foo'])) === json(['application/x-foo', 'application/x-foo']), 'outro');
const enc = s => new TextEncoder().encode(s);
const a = d('x-special/gnome-copied-files', enc(`copy
file:///tmp/a%20b.txt
file:///tmp/c.pdf`));
ok(a.tipo === 'arquivo' && a.previa === 'a b.txt, c.pdf' && a.legenda === '2 arquivos', json(a));
ok(d('image/png', enc('x')).tipo === 'imagem', 'imagem');
ok(d('text/plain;charset=utf-8', enc(`  oi
  tudo `)).previa === 'oi tudo', 'texto');
return 'ok';
JS

echo "== Fase 3: histórico"
caso "importou Clipboard Indicator" <<'JS'
const h = x._historico.itens;
ok(h.length === 2, 'itens: ' + json(h.map(i => i.previa)));
ok(h.find(i => i.previa === 'antigo fixado').fixado, 'fixado');
ok(x._historico.listar()[0].previa === 'antigo fixado', 'fixado no topo');
return h.map(i => i.previa).join(' | ');
JS
caso "captura texto" <<'JS'
St.Clipboard.get_default().set_text(CB, 'olá mundo teste');
await esperar(500);
const i = x._historico.itens[0];
ok(i.previa === 'olá mundo teste' && i.tipo === 'texto', json(i));
return json(i.mimes);
JS
caso "captura imagem" <<'JS'
const pb = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 8, 8);
pb.fill(0xff0000ff);
const [, png] = pb.save_to_bufferv('png', [], []);
St.Clipboard.get_default().set_content(CB, 'image/png', new GLib.Bytes(png));
await esperar(500);
const i = x._historico.itens[0];
ok(i.tipo === 'imagem', json(i));
return i.previa + ' ' + i.legenda;
JS
caso "repetido sobe ao topo sem duplicar" <<'JS'
const n = x._historico.itens.length;
St.Clipboard.get_default().set_text(CB, 'olá mundo teste');
await esperar(500);
ok(x._historico.itens.length === n, 'duplicou');
ok(x._historico.itens[0].previa === 'olá mundo teste', 'não subiu');
return 'ok';
JS
caso "ignora gerenciador de senha" <<'JS'
const n = x._historico.itens.length;
const sel = global.display.get_selection();
sel.set_owner(Meta.SelectionType.SELECTION_CLIPBOARD,
    Meta.SelectionSourceMemory.new('x-kde-passwordManagerHint', new GLib.Bytes(new TextEncoder().encode('secret'))));
await esperar(500);
ok(x._historico.itens.length === n, 'guardou senha');
return 'ok';
JS
caso "restaura texto" <<'JS'
const item = x._historico.itens.find(i => i.previa === 'antigo comum');
ok(x._historico.restaurar(item), 'restaurar');
const t = await lerTexto();
ok(t === 'antigo comum', 'leu: ' + t);
ok(x._historico.itens[0] === item, 'não subiu');
await esperar(300);
ok(x._historico.itens.filter(i => i.previa === 'antigo comum').length === 1, 'recapturou a própria restauração');
return 'ok';
JS
caso "restaura imagem" <<'JS'
const item = x._historico.itens.find(i => i.tipo === 'imagem');
const tamanho = GLib.file_get_contents(GLib.get_user_data_dir() + '/balao/itens/' + item.id)[1].length;
x._historico.restaurar(item);
const b = await lerBytes('image/png');
ok(b && b.get_size() === tamanho, 'bytes ' + b?.get_size() + ' != ' + tamanho);
return 'png ' + tamanho + ' bytes';
JS
caso "índice gravado em disco" <<'JS'
await esperar(700);
const [, c] = GLib.file_get_contents(GLib.get_user_data_dir() + '/balao/historico.json');
const salvo = JSON.parse(new TextDecoder().decode(c));
ok(salvo.length === x._historico.itens.length, 'tamanhos diferentes');
const modo = Gio.File.new_for_path(GLib.get_user_data_dir() + '/balao/historico.json').query_info('unix::mode', 0, null).get_attribute_uint32('unix::mode') & 0o777;
ok(modo === 0o600, 'permissão ' + modo.toString(8));
return salvo.length + ' itens';
JS

echo "== Fase 5: ortografia"
caso "enchant pt_BR" <<'JS'
const r = await x._ortografia.sugerir('caza');
ok(!r.correta && r.sugestoes.includes('casa'), json(r));
ok((await x._ortografia.sugerir('casa')).correta, 'casa deveria estar correta');
ok((await x._ortografia.sugerir('ação')).correta, 'ação deveria estar correta');
return r.sugestoes.slice(0, 5).join(', ');
JS

echo "== Fase 2/3/4: balões"
caso "balão do histórico: abre, navega, filtra, fecha" <<'JS'
x.abrirHistorico();
await esperar(300);
const b = x._balao;
ok(b?.aberto, 'não abriu');
ok(b._itens.length === x._historico.itens.length, 'itens ' + b._itens.length);
b._mover(1);
ok(b._indice === 1, 'seta');
await foto('historico.png');
b._entrada.set_text('ola');
await esperar(200);
ok(b._itens.length === 1 && b._itens[0].rotulo === 'olá mundo teste', 'filtro sem acento: ' + json(b._itens.map(i => i.rotulo)));
b.fechar();
ok(!x._balao, 'não fechou');
return 'ok';
JS
caso "balão do histórico: Ctrl+P fixa, Del remove" <<'JS'
x.abrirHistorico();
await esperar(300);
const b = x._balao;
b._entrada.set_text('ola');
await esperar(200);
const alvo = b._itens[0].entrada;
b._o.aoTecla(b._itens[0], Clutter.KEY_p, Clutter.ModifierType.CONTROL_MASK);
ok(alvo.fixado, 'não fixou');
b._o.aoTecla(b._itens[0], Clutter.KEY_p, Clutter.ModifierType.CONTROL_MASK);
const n = x._historico.itens.length;
b._o.aoTecla(b._itens[0], Clutter.KEY_Delete, 0);
ok(x._historico.itens.length === n - 1 && !x._historico.itens.includes(alvo), 'não removeu');
b.fechar();
return 'ok';
JS
caso "balão do histórico: Enter restaura o item" <<'JS'
x.abrirHistorico();
await esperar(300);
const b = x._balao;
b._entrada.set_text('fixado');
await esperar(200);
b._ativar();
ok(!x._balao, 'não fechou');
const t = await lerTexto();
ok(t === 'antigo fixado', 'área de transferência: ' + t);
await esperar(600); // deixa o Ctrl+V automático acontecer antes do próximo teste
return 'ok';
JS
caso "balão principal: sugestões e pesquisa" <<'JS'
await x.abrirPrincipal();
await esperar(200);
const b = x._balao;
ok(b?.aberto, 'não abriu');
b._entrada.set_text('caza');
await esperar(600);
const r = b._itens.map(i => i.rotulo);
ok(r[0] === 'Pesquisar “caza”', 'pesquisa primeiro fora de campo: ' + json(r));
ok(r.includes('casa'), 'sem casa: ' + json(r));
await foto('principal.png');
b.fechar();
return r.slice(0, 4).join(' | ');
JS
caso "balão principal: sugestão fora de campo vai para a área de transferência" <<'JS'
await x.abrirPrincipal();
await esperar(200);
const b = x._balao;
b._entrada.set_text('caza');
await esperar(600);
b._indice = b._itens.findIndex(i => i.rotulo === 'casa');
b._ativar();
ok((await lerTexto()) === 'casa', 'não copiou');
return 'ok';
JS
caso "atalho com balão aberto fecha" <<'JS'
x.abrirHistorico();
await esperar(200);
x._alternar(() => x.abrirHistorico());
ok(!x._balao, 'continuou aberto');
return 'ok';
JS
echo "== Com app real (mini editor GTK4): cursor, troca de palavra e colar"
caso "abre o editor com o cursor depois de caza" <<'JS'
// GDK_DEBUG=no-portals: no Shell aninhado não há portal, e o GTK travaria esperando.
// Sem teclado virtual: no aninhado ele passa pelo X do host e poderia digitar nos apps reais.
GLib.spawn_async(null, ['bash', '-c', `GDK_DEBUG=no-portals exec gjs -m ${RAIZ}/tests/editor.js 'eu moro numa caza bonita' 17 2>/dev/null`],
    null, GLib.SpawnFlags.SEARCH_PATH, null);
for (let i = 0; i < 40 && !Main.inputMethod.currentFocus; i++)
    await esperar(250);
ok(Main.inputMethod.currentFocus, 'editor não abriu ou sem foco de texto');
await esperar(500);
return global.display.focus_window.get_wm_class() + ' foco=' + Main.inputMethod.currentFocus + ' sur=' + json(Main.inputMethod.getSurroundingText());
JS
caso "capturar acha o cursor de texto e a palavra" <<'JS'
const a = x._foco.capturar();
const [px, py] = global.get_pointer();
ok(a.noTexto, 'sem foco de texto');
ok(a.origem?.original === 'caza', 'palavra: ' + json(a.origem));
ok(a.ponto.x !== px || a.ponto.y !== py, 'caiu no mouse: ' + json(a.ponto));
const w = global.display.focus_window.get_frame_rect();
ok(a.ponto.x >= w.x && a.ponto.x <= w.x + w.width && a.ponto.y >= w.y && a.ponto.y <= w.y + w.height, 'fora da janela: ' + json(a.ponto));
return json(a);
JS
caso "balão principal troca caza por casa no editor" <<'JS'
await x.abrirPrincipal();
await esperar(700);
const b = x._balao;
ok(b._entrada.get_text() === 'caza', 'texto inicial: ' + b._entrada.get_text());
ok(b._itens[0].rotulo === 'casa', 'correção primeiro dentro do campo: ' + json(b._itens.map(i => i.rotulo)));
await foto('principal-no-editor.png');
b._ativar();
for (let i = 0; i < 30 && !(Main.inputMethod.getSurroundingText()[0] ?? '').includes('casa'); i++)
    await esperar(100);
const [texto] = Main.inputMethod.getSurroundingText();
ok(texto === 'eu moro numa casa bonita', 'texto: ' + json(texto));
return texto;
JS
caso "histórico restaura item com o editor em foco (colagem: validar no uso real)" <<'JS'
x.abrirHistorico();
await esperar(300);
x._balao._entrada.set_text('comum');
await esperar(200);
x._balao._ativar();
ok((await lerTexto()) === 'antigo comum', 'não restaurou');
await esperar(500);
ok(Main.inputMethod.currentFocus, 'o app não recuperou o foco de texto');
await foto('editor-final.png');
return 'ok';
JS

echo "== Fase 6: preferências"
caso "janela de preferências abre" <<'JS'
global.display.focus_window?.delete(global.get_current_time());
GLib.spawn_async(null, ['bash', '-c', `exec gjs -m ${RAIZ}/tests/prefs.js ${RAIZ} ${FOTOS} > ${FOTOS}/prefs.log 2>&1`],
    null, GLib.SpawnFlags.SEARCH_PATH, null);
let w;
for (let i = 0; i < 60 && !w; i++) {
    await esperar(250);
    w = global.get_window_actors().map(a => a.meta_window).find(m => m.get_title() === 'Balão');
}
ok(w, 'janela não abriu: ' + new TextDecoder().decode(GLib.file_get_contents(FOTOS + '/prefs.log')[1]).slice(0, 400));
await esperar(800);
await foto('preferencias.png');
w.delete(global.get_current_time());
return 'ok';
JS

caso "desativar e reativar" <<'JS'
Main.extensionManager.disableExtension(U);
await esperar(300);
ok(Main.extensionManager.lookup(U).state !== 1, 'não desativou');
Main.extensionManager.enableExtension(U);
await esperar(500);
const e = Main.extensionManager.lookup(U);
ok(e.state === 1, 'estado ' + e.state + ' ' + e.error);
ok(e.stateObj._historico.itens.length > 0, 'histórico não recarregou');
return 'ok';
JS

echo
echo "Passou: $PASSOU  Falhou: $FALHOU   (fotos em $TMP/fotos)"
[ "$FALHOU" -eq 0 ]
