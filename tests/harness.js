// Mini framework de testes sem dependências (roda no navegador e no Node >= 18).
export const registry = [];
let currentSuite = '';

export function suite(name, fn) {
  currentSuite = name;
  fn();
  currentSuite = '';
}

export function test(name, fn) {
  registry.push({ suite: currentSuite, name, fn });
}

function fmt(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const assert = {
  ok(v, msg = 'esperava valor verdadeiro') {
    if (!v) throw new Error(msg);
  },
  equal(a, b, msg = '') {
    if (a !== b) throw new Error(`${msg} esperado ${fmt(b)}, obtido ${fmt(a)}`.trim());
  },
  deepEqual(a, b, msg = '') {
    if (fmt(a) !== fmt(b)) throw new Error(`${msg} esperado ${fmt(b)}, obtido ${fmt(a)}`.trim());
  },
  throws(fn, re, msg = 'esperava exceção') {
    try {
      fn();
    } catch (e) {
      if (re && !re.test(e.message)) throw new Error(`${msg}: mensagem "${e.message}" não casa com ${re}`);
      return;
    }
    throw new Error(msg);
  },
  close(a, b, tol, msg = '') {
    if (Math.abs(a - b) > tol) throw new Error(`${msg} esperado ${b}±${tol}, obtido ${a}`.trim());
  },
};

export async function runAll() {
  const results = [];
  for (const t of registry) {
    const t0 = performance.now();
    try {
      await t.fn();
      results.push({ suite: t.suite, name: t.name, ok: true, ms: performance.now() - t0 });
    } catch (e) {
      results.push({ suite: t.suite, name: t.name, ok: false, error: e.message, stack: e.stack, ms: performance.now() - t0 });
    }
  }
  return results;
}
