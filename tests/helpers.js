// Fábricas de cenários para os testes (dados de teste, não reais).
import { createSession } from '../src/domain/index.js';

let counter = 0;

export function mkPlayer(over = {}) {
  counter++;
  return { id: over.id || `j${counter}`, name: over.name || `Jogador ${counter}`, stars: 2, type: 'line', positions: ['D', 'M', 'A'], ...over };
}

/**
 * Cria uma sessão com times de tamanhos definidos, sem passar pelo otimizador
 * (para testar regras de rodízio de forma determinística).
 * sizes: [5,5,5,2] → Time 1..4 com esses tamanhos de linha.
 */
export function mkSession(sizes, { n = 5, gks = [], config = {}, stars } = {}) {
  const snapshots = {};
  const teams = sizes.map((size, ti) => {
    const line = [];
    for (let i = 0; i < size; i++) {
      const p = mkPlayer({ id: `T${ti + 1}P${i + 1}`, name: `T${ti + 1}-${i + 1}`, stars: stars ? stars(ti, i) : 2 });
      snapshots[p.id] = p;
      line.push({ pid: p.id, role: 'M' });
    }
    const g = [];
    for (let k = 0; k < (gks[ti] || 0); k++) {
      const gk = mkPlayer({ id: `T${ti + 1}G${k + 1}`, name: `Gol${ti + 1}-${k + 1}`, type: 'gk', positions: [] });
      snapshots[gk.id] = gk;
      g.push(gk.id);
    }
    return { line, gks: g };
  });
  const draw = { teams, seed: 1, metrics: {}, ref: 2, withoutGk: [], unusedGoalkeepers: [] };
  const s = createSession({ title: 'Teste', config: { linePerTeam: n, ...config }, snapshots, draw });
  s.status = 'live';
  return s;
}

export function pids(s, tid) {
  return s.teams[tid].line.map((x) => x.pid);
}

export function lateSnap(id, over = {}) {
  return { id, name: id, stars: 2, type: 'line', positions: ['D', 'M', 'A'], ...over };
}
