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

suite('Isolamento do domínio', () => {
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
    const files = ['../src/ui/app.js', '../src/ui/views.js', '../src/ui/modals.js', '../src/ui/dom.js', '../src/ui/state.js', '../src/storage/storage.js'];
    for (const f of files) {
      const code = await readSource(f);
      const deep = [...code.matchAll(/from\s+'([^']*domain\/[^']+)'/g)].map((m) => m[1]).filter((p) => !p.endsWith('/domain/index.js'));
      assert.equal(deep.length, 0, `${f} importa módulo interno do domínio: ${deep.join(', ')}`);
    }
  });
});
