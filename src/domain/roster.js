// Importação da base de atletas em lote (RN-103 a RN-107): leitura de uma lista em texto,
// plano de mudanças (criar / atualizar / excluir) e aplicação pura sobre o cadastro.
import { normalizeName, nameKey, validatePlayer } from './players.js';
import { isValidStars, formatStars } from './stars.js';

const COLUMN_SEP = /[;\t|]/;
const STARS_RE = /^\(?(\d(?:[.,]\d+)?)\s*(★|\*|estrelas?)?\)?,?$/i;
const POS_RE = /^[([]?[DMAGX](?:\s*[,/+]?\s*[DMAGX])*[)\]]?,?$/;
const WORDS = { goleiro: 'G', gol: 'G', excluir: 'X', excluido: 'X', 'excluído': 'X', fora: 'X' };

/** Classifica um pedaço de texto como estrelas, posições/letras, "?" ou nada reconhecível. */
function readAttribute(token) {
  const t = token.trim();
  if (!t || t === '★' || t === '?' || t === '-' || t === ',') return { kind: 'skip' };
  const word = WORDS[t.toLowerCase().replace(/[()]/g, '')];
  if (word) return { kind: 'letters', letters: [word] };
  const s = t.match(STARS_RE);
  if (s) return { kind: 'stars', value: Number(s[1].replace(',', '.')), explicit: !!s[2] || /[.,]/.test(s[1]) };
  if (POS_RE.test(t)) return { kind: 'letters', letters: t.match(/[DMAGX]/g) };
  return null;
}

function buildEntry(lineNo, raw, name, attrs) {
  const entry = { lineNo, raw, name: normalizeName(name), stars: null, type: null, positions: null, exclude: false, error: null };
  const letters = new Set();
  for (const a of attrs) {
    if (a.kind === 'stars') entry.stars = a.value;
    if (a.kind === 'letters') a.letters.forEach((l) => letters.add(l));
  }
  if (!entry.name) entry.error = 'Linha sem nome.';
  else if (letters.has('X')) entry.exclude = true;
  else {
    const roles = ['D', 'M', 'A'].filter((r) => letters.has(r));
    if (letters.has('G')) {
      entry.type = 'gk';
      if (roles.length) entry.error = 'Goleiro (G) não tem posições de linha (D, M, A).';
    } else if (roles.length) {
      entry.type = 'line';
      entry.positions = roles;
    }
    if (entry.stars !== null && !isValidStars(entry.stars)) entry.error = `Estrelas inválidas (${formatStars(entry.stars)}): use 1, 1,5, 2, 2,5 ou 3.`;
  }
  return entry;
}

/**
 * Lê uma linha. Formatos aceitos (RN-103):
 *   "Nome; 2,5; D,M"   (colunas separadas por ; | ou tabulação — recomendado)
 *   "Nome 2,5★ D,M"    "Nome (G) 2"    "Nome X"    "Nome ? D"
 * Em texto livre, um número sem ★ e sem casa decimal só vira estrelas se "Nome número" não for o
 * nome de um jogador já cadastrado (ex.: "Felipe 2").
 */
export function parseRosterLine(raw, lineNo = 1, knownKeys = new Set()) {
  const line = String(raw).trim().replace(/^(\d+[.)]\s+|[-*•–]\s+)/, '');
  if (COLUMN_SEP.test(line)) {
    const [name, ...rest] = line.split(COLUMN_SEP);
    const attrs = [];
    for (const tok of rest.join(' ').split(/\s+/).filter(Boolean)) {
      const a = readAttribute(tok);
      if (!a) return { ...buildEntry(lineNo, raw, name, []), error: `Não entendi "${tok}".` };
      attrs.push(a);
    }
    return buildEntry(lineNo, raw, name, attrs);
  }
  const tokens = line.split(/\s+/).filter(Boolean);
  const attrs = [];
  let gotStars = false;
  while (tokens.length > 1) {
    const a = readAttribute(tokens[tokens.length - 1]);
    if (!a) break;
    if (a.kind === 'stars') {
      if (gotStars) break; // segundo número fica no nome ("Felipe 2 2,5★")
      if (!a.explicit && knownKeys.has(nameKey(tokens.join(' ')))) break;
      gotStars = true;
    }
    attrs.unshift(a);
    tokens.pop();
  }
  return buildEntry(lineNo, raw, tokens.join(' '), attrs);
}

/** Lê a lista inteira. Ignora linhas vazias e comentários (#). Marca nomes repetidos como erro. */
export function parseRoster(text, existing = []) {
  const knownKeys = new Set(existing.map((p) => nameKey(p.name)));
  const seen = new Map();
  const entries = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const t = raw.trim();
      if (!t || t.startsWith('#')) return;
      const e = parseRosterLine(t, i + 1, knownKeys);
      const key = nameKey(e.name);
      if (!e.error && seen.has(key)) e.error = `Nome repetido na lista (linha ${seen.get(key)}).`;
      if (e.name && !seen.has(key)) seen.set(key, e.lineNo);
      entries.push(e);
    });
  return entries;
}

function samePlayer(a, b) {
  return a.name === b.name && a.stars === b.stars && a.type === b.type && a.positions.join() === b.positions.join();
}

/**
 * Monta o plano de importação (RN-104 a RN-106) sem alterar nada.
 * mode 'merge': cria/atualiza os listados; campos não informados mantêm o valor atual.
 * mode 'replace': além disso, exclui do cadastro quem não está na lista; qualquer erro bloqueia.
 * Linhas com X excluem o jogador do cadastro.
 */
export function planRosterImport(players, entries, { mode = 'merge' } = {}) {
  const plan = { mode, create: [], update: [], remove: [], unchanged: [], ignored: [], errors: [], blocked: false };
  const byKey = new Map(players.map((p) => [nameKey(p.name), p]));
  const listed = new Set();
  const pool = [...players];
  for (const e of entries) {
    if (e.error) {
      plan.errors.push({ lineNo: e.lineNo, name: e.name, message: e.error });
      continue;
    }
    const key = nameKey(e.name);
    listed.add(key);
    const current = byKey.get(key);
    if (e.exclude) {
      if (current) plan.remove.push(current);
      else plan.ignored.push({ lineNo: e.lineNo, name: e.name, message: 'Marcado com X, mas não está no cadastro.' });
      continue;
    }
    const type = e.type ?? current?.type ?? 'line';
    const input = {
      id: current?.id,
      createdAt: current?.createdAt,
      name: e.name,
      stars: e.stars ?? current?.stars,
      type,
      positions: e.positions ?? (current?.type === 'line' ? current.positions : []),
    };
    if (input.stars == null) {
      plan.errors.push({ lineNo: e.lineNo, name: e.name, message: 'Informe as estrelas (jogador novo).' });
      continue;
    }
    try {
      const p = validatePlayer(input, pool);
      if (current) {
        if (samePlayer(current, p)) plan.unchanged.push(current);
        else plan.update.push({ before: current, after: p });
      } else {
        plan.create.push(p);
        pool.push(p);
      }
    } catch (err) {
      plan.errors.push({ lineNo: e.lineNo, name: e.name, message: err.message });
    }
  }
  if (mode === 'replace') {
    for (const p of players) if (!listed.has(nameKey(p.name))) plan.remove.push(p);
    plan.blocked = plan.errors.length > 0;
  }
  return plan;
}

/** Aplica o plano e devolve o novo cadastro (não muta a lista recebida). */
export function applyRosterImport(players, plan) {
  if (plan.blocked) throw new Error('Corrija as linhas com erro antes de substituir a base inteira.');
  const removed = new Set(plan.remove.map((p) => p.id));
  const updated = new Map(plan.update.map((u) => [u.after.id, u.after]));
  return [...players.filter((p) => !removed.has(p.id)).map((p) => updated.get(p.id) || p), ...plan.create];
}

/** Cadastro atual no mesmo formato aceito pela importação ("Nome; 2,5; D,M"), em ordem alfabética. */
export function rosterText(players) {
  return [...players]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((p) => `${p.name}; ${formatStars(p.stars)}; ${p.type === 'gk' ? 'G' : p.positions.join(',')}`)
    .join('\n');
}

/** Resumo legível do plano para a tela de confirmação. */
export function rosterPlanSummary(plan) {
  const parts = [`${plan.create.length} novo(s)`, `${plan.update.length} atualizado(s)`, `${plan.remove.length} excluído(s)`, `${plan.unchanged.length} sem mudança`];
  if (plan.errors.length) parts.push(`${plan.errors.length} linha(s) com erro${plan.blocked ? '' : ' (serão ignoradas)'}`);
  return parts.join(' · ');
}
