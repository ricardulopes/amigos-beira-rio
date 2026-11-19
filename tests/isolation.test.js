// Garante que src/domain é independente da interface: nenhuma referência a DOM, navegador,
// armazenamento ou a outras camadas. A lista de módulos vem do próprio src/domain/index.js,
// então todo módulo novo exportado pelo domínio é verificado automaticamente.
import { suite, test, assert } from './harness.js';

const isBrowser = typeof document !== 'undefined';

async function readSource(rel) {
  const url = new URL(rel, import.meta.url);
  if (isBrowser) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Não foi possível ler ${rel} (${res.status})`);
    return res.text();
  }
  const fs = await import('node:fs/promises');
  return fs.readFile(url, 'utf8');
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const FORBIDDEN = [
  { re: /\bdocument\b/, what: 'document (DOM)' },
  { re: /\bwindow\b/, what: 'window' },
  { re: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, what: 'armazenamento do navegador' },
  { re: /\bnavigator\b/, what: 'navigator' },
  { re: /\bfetch\s*\(/, what: 'fetch (rede)' },
  { re: /\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/, what: 'diálogos do navegador' },
  { re: /\bHTMLElement\b|\binnerHTML\b|\baddEventListener\b/, what: 'API de interface' },
];

async function domainModules() {
  const index = await readSource('../src/domain/index.js');
  const files = [...index.matchAll(/from '\.\/([a-zA-Z]+\.js)'/g)].map((m) => m[1]);
  return ['index.js', ...new Set(files)];
}

// Ações que só leem, navegam ou mexem em janelas já liberadas pelo PIN. Botão novo que ALTERA dados
// nunca entra aqui: fica fora de FREE_ACTIONS e o app pede o PIN mestre (RN-114, RN-116).
const READ_ONLY_ACTIONS = new Set([
  'go', 'go-history', 'modal-close', 'modal-close-bg', 'pfilter', 'toggle-invert', 'toggle-queue', 'dismiss-exp', 'htab',
  'share', 'share-copy', 'share-wa', 'share-native', 'export', 'share-backup', 'open-log', 'open-more',
  'admin-toggle', 'pin-ok', 'player-edit', 'player-admin-edit', 'cloud-sync', 'wipe', 'confirm-ok',
  'm-set', 'm-qty', 'm-pos', 'm-type', 'pick', 'roster-official', 'roster-current', 'roster-preview',
  // caixa: trocar aba/semestre, ver extrato, ver e copiar o Pix, abrir a aba de pagamentos (só leitura)
  'ftab', 'fsem', 'frank', 'fpay-pick', 'stmt-pick', 'stmt-clear', 'pix-open', 'pix-copy', 'go-caixa',
]);
// Campos livres: busca, campos de janelas (abertas só pelo admin) e opções do texto do WhatsApp.
const FREE_FIELD = /^(psearch|ssearch|fsearch|share-opt|roster-file|m:.*)$/;

suite('Visitante só lê (RN-116)', () => {
  test('Nenhuma ação livre altera dados: a lista FREE_ACTIONS do app só tem leitura/navegação', async () => {
    const code = await readSource('../src/ui/app.js');
    const block = code.match(/const FREE_ACTIONS = new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(block, 'FREE_ACTIONS não encontrado em app.js');
    const free = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const a of free) assert.ok(READ_ONLY_ACTIONS.has(a), `"${a}" está livre em app.js mas não é ação só de leitura`);
  });

  test('Todo campo que altera ajustes ou a pelada está em ADMIN_FIELDS', async () => {
    const app = await readSource('../src/ui/app.js');
    const block = app.match(/const ADMIN_FIELDS = new Set\(\[([\s\S]*?)\]\)/);
    const admin = new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    for (const f of ['../src/ui/views.js', '../src/ui/modals.js']) {
      const code = await readSource(f);
      const keys = [...code.matchAll(/data-(?:input|change)="([^"$]+)/g)].map((m) => m[1]);
      for (const k of keys) assert.ok(FREE_FIELD.test(k) || admin.has(k), `campo "${k}" em ${f} não exige o PIN mestre`);
    }
  });

  test('Sem código do jogador: nada no app nem no banco permite ao visitante gravar', async () => {
    for (const f of ['../src/ui/app.js', '../src/ui/modals.js', '../src/cloud/sync.js']) {
      const code = stripComments(await readSource(f));
      assert.ok(!/player_set_positions|setOwnPositions|newPlayerCode|self-save|player-code/.test(code), `${f} ainda tem o código do jogador`);
    }
    const sql = await readSource('../supabase/schema.sql');
    const granted = [...sql.matchAll(/grant execute on function public\.(\w+)/g)].map((m) => m[1]);
    assert.ok(granted.length > 0);
    for (const fn of granted) assert.ok(/^admin_/.test(fn), `função ${fn} liberada ao app sem ser de administrador`);
    assert.ok(/drop function if exists public\.player_set_positions/.test(sql), 'o SQL deve apagar a função antiga');
    assert.ok(!/grant (insert|update|delete)/i.test(sql), 'nenhuma tabela pode aceitar gravação direta');
  });
});

suite('Isolamento do domínio', () => {
  test('Nenhuma chave secreta do Supabase no app (só a publicável)', async () => {
    const code = await readSource('../src/cloud/config.js');
    assert.ok(/sb_publishable_/.test(code), 'deve usar a chave publicável');
    assert.ok(!/sb_secret_|service_role/.test(stripComments(code)), 'chave secreta nunca pode ir para o app');
  });

  test('index.js exporta todos os módulos do domínio', async () => {
    const files = await domainModules();
    for (const f of ['stars.js', 'draw.js', 'tieRules.js', 'rotation.js', 'setup.js', 'session.js']) {
      assert.ok(files.includes(f), `${f} não está exportado em index.js`);
    }
  });

  test('Nenhum módulo do domínio usa DOM, navegador ou armazenamento', async () => {
    for (const f of await domainModules()) {
      const code = stripComments(await readSource(`../src/domain/${f}`));
      for (const { re, what } of FORBIDDEN) assert.ok(!re.test(code), `src/domain/${f} usa ${what}`);
    }
  });

  test('Domínio só importa módulos do próprio domínio', async () => {
    for (const f of await domainModules()) {
      const code = await readSource(`../src/domain/${f}`);
      const imports = [...code.matchAll(/(?:import|export)[^'"]*from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const imp of imports) assert.ok(/^\.\/[a-zA-Z]+\.js$/.test(imp), `src/domain/${f} importa "${imp}" (fora do domínio)`);
    }
  });

  test('Interface e persistência importam o domínio somente via index.js', async () => {
    const files = [
      '../src/ui/app.js', '../src/ui/views.js', '../src/ui/modals.js', '../src/ui/dom.js', '../src/ui/state.js', '../src/storage/storage.js',
      '../src/cloud/sync.js', '../src/cloud/diff.js', '../src/cloud/config.js',
    ];
    for (const f of files) {
      const code = await readSource(f);
      const deep = [...code.matchAll(/from\s+'([^']*domain\/[^']+)'/g)].map((m) => m[1]).filter((p) => !p.endsWith('/domain/index.js'));
      assert.equal(deep.length, 0, `${f} importa módulo interno do domínio: ${deep.join(', ')}`);
    }
  });
});
