// Avaliação tática: atribuição de função (Defesa/Meio/Ataque) a cada jogador de linha.
// Cada jogador recebe exatamente UMA função, dentre as posições cadastradas.
import { ROLES, formationFor } from './constants.js';

function positionsOf(p) {
  return p.positions && p.positions.length ? p.positions : ROLES;
}

/**
 * Atribui funções maximizando o encaixe na formação-alvo (b-matching por caminhos aumentantes).
 * Jogadores que não cabem no alvo recebem a função (dentre as suas) menos sobrecarregada.
 * @param {{id:string, positions:string[]}[]} players
 * @param {{D:number,M:number,A:number}|null} target
 * @returns {{roles: Record<string,string>, counts:{D:number,M:number,A:number}, misplaced:number}}
 */
export function assignRoles(players, target = formationFor(players.length)) {
  const roles = {};
  const counts = { D: 0, M: 0, A: 0 };
  if (!target) {
    // Sem alvo (1 jogador): escolhe a função mais "útil" na ordem D > M > A.
    for (const p of players) {
      const pos = positionsOf(p);
      const r = ['D', 'M', 'A'].find((x) => pos.includes(x));
      roles[p.id] = r;
      counts[r]++;
    }
    return { roles, counts, misplaced: 0 };
  }
  const holders = { D: [], M: [], A: [] };
  // Jogadores menos versáteis primeiro (mais restritos), garante determinismo.
  const ordered = [...players].sort((a, b) => positionsOf(a).length - positionsOf(b).length);

  function tryPlace(p, visited) {
    for (const r of positionsOf(p)) {
      if (visited.has(r)) continue;
      visited.add(r);
      if (holders[r].length < target[r]) {
        holders[r].push(p);
        roles[p.id] = r;
        return true;
      }
      for (let i = 0; i < holders[r].length; i++) {
        const q = holders[r][i];
        holders[r].splice(i, 1);
        if (tryPlace(q, visited)) {
          holders[r].push(p);
          roles[p.id] = r;
          return true;
        }
        holders[r].splice(i, 0, q);
      }
    }
    return false;
  }

  const unplaced = [];
  for (const p of ordered) if (!tryPlace(p, new Set())) unplaced.push(p);
  for (const r of ROLES) counts[r] = holders[r].length;
  for (const p of unplaced) {
    const pos = positionsOf(p);
    // função com menor excesso relativo ao alvo
    let best = pos[0];
    for (const r of pos) if (counts[r] - target[r] < counts[best] - target[best]) best = r;
    roles[p.id] = best;
    counts[best]++;
  }
  return { roles, counts, misplaced: unplaced.length };
}

/** Desvio tático: número de jogadores fora da formação desejada (0 = formação ideal). */
export function tacticalDeviation(counts, n) {
  const t = formationFor(n);
  if (!t) return 0;
  return (Math.abs(counts.D - t.D) + Math.abs(counts.M - t.M) + Math.abs(counts.A - t.A)) / 2;
}

export function formationText(counts) {
  return `${counts.D}-${counts.M}-${counts.A}`;
}
