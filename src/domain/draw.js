// Sorteio inteligente: otimização combinatória (simulated annealing com reinícios)
// considerando simultaneamente equilíbrio técnico, tático, equipe incompleta e goleiros.
// Convenção de ORDEM: line[0] = topo (último a sair); line[line.length-1] = base (primeiro a sair).
import { formationFor } from './constants.js';
import { assignRoles } from './tactics.js';
import { createRng } from './rng.js';
import { mean, median, sumStars, range } from './stars.js';

export const WEIGHTS = {
  range: 3, // diferença entre o time completo mais forte e o mais fraco
  sqdev: 1, // soma dos quadrados dos desvios em relação à média
  tactical: 1.2, // por jogador fora da formação desejada (times completos)
  incTarget: 4, // RN-29: |soma da equipe incompleta − Alvo_Incompleto| (por estrela)
  incSpread: 0.5, // desempate: jogadores da equipe incompleta distantes da mediana do grupo
  incTactical: 0.8, // composição tática da equipe incompleta
  incVersatility: 0.5, // equipe de 1 jogador: preferência por versatilidade
};

/**
 * RN-29 — Equilíbrio preditivo da equipe incompleta.
 * Alvo_Incompleto = M_time − (N − k) × M_atleta
 * onde M_time = média de estrelas dos times completos, M_atleta = média de estrelas por atleta de linha
 * da pelada, N = atletas por time e k = atletas da equipe incompleta. Assim, quando os N − k reforços
 * médios chegarem, a equipe atinge o patamar dos times completos.
 * Ex.: completos com 9★, faltam 2 vagas, média 2★/atleta → alvo = 9 − 2 × 2 = 5★.
 */
export function incompleteTarget(mTime, n, k, mAthlete) {
  return mTime - (n - k) * mAthlete;
}

export function planTeamSizes(lineCount, n) {
  if (lineCount <= 0) return [];
  const full = Math.floor(lineCount / n);
  const rem = lineCount % n;
  const sizes = Array(full).fill(n);
  if (rem) sizes.push(rem);
  return sizes;
}

/** Métricas de um time (lista de jogadores de linha). */
export function teamInfo(players, n) {
  const size = players.length;
  const sum = sumStars(players);
  const { roles, counts, misplaced } = assignRoles(players, formationFor(size));
  return { size, sum, avg: size ? sum / size : 0, roles, counts, misplaced, complete: size >= n };
}

/**
 * Parte do custo da equipe incompleta que só depende dela: dispersão em torno da mediana (desempate)
 * e composição tática. O termo do alvo de estrelas (RN-29) depende dos times completos e é
 * somado em `incompleteTargetCost`.
 */
export function incompleteBaseCost(players, info, ref) {
  const r = players.length;
  if (!r) return 0;
  let c = (WEIGHTS.incSpread * players.reduce((a, p) => a + Math.abs(p.stars - ref), 0)) / r;
  if (r >= 2) c += WEIGHTS.incTactical * info.misplaced;
  else c += WEIGHTS.incVersatility * (3 - (players[0].positions?.length || 3));
  return c;
}

/** Custo do desvio da soma da equipe incompleta em relação ao Alvo_Incompleto (RN-29). */
export function incompleteTargetCost(sum, k, fullSums, n, mAthlete) {
  if (!fullSums.length || !k) return 0;
  return WEIGHTS.incTarget * Math.abs(sum - incompleteTarget(mean(fullSums), n, k, mAthlete));
}

export function technicalCost(sums) {
  if (sums.length < 2) return 0;
  const m = mean(sums);
  return WEIGHTS.range * range(sums) + WEIGHTS.sqdev * sums.reduce((a, s) => a + (s - m) ** 2, 0);
}

/**
 * Avalia uma divisão completa (lista de times de jogadores).
 * @param {{ref:number, mAthlete:number}} ctx mediana e média de estrelas dos atletas de linha da pelada
 */
export function evaluateTeams(teams, n, ctx) {
  const infos = teams.map((t) => teamInfo(t, n));
  const fullIdx = infos.map((inf, i) => (inf.size >= n ? i : -1)).filter((i) => i >= 0);
  const sums = fullIdx.map((i) => infos[i].sum);
  const technical = technicalCost(sums);
  const tactical = fullIdx.reduce((a, i) => a + WEIGHTS.tactical * infos[i].misplaced, 0);
  let incomplete = 0;
  let forming = null;
  infos.forEach((inf, i) => {
    if (inf.size >= n) return;
    incomplete += incompleteBaseCost(teams[i], inf, ctx.ref) + incompleteTargetCost(inf.sum, inf.size, sums, n, ctx.mAthlete);
    forming = {
      index: i,
      size: inf.size,
      sum: inf.sum,
      target: sums.length ? incompleteTarget(mean(sums), n, inf.size, ctx.mAthlete) : null,
    };
  });
  return {
    total: technical + tactical + incomplete,
    technical,
    tactical,
    incomplete,
    infos,
    range: range(sums),
    fullSums: sums,
    forming,
  };
}

/** Distribui os jogadores de linha nos times (tamanhos fixos) minimizando o custo global. */
export function optimizeTeams(players, n, rng, opts = {}) {
  const sizes = planTeamSizes(players.length, n);
  const stars = players.map((p) => p.stars);
  const ref = median(stars);
  const ctx = { ref, mAthlete: mean(stars) };
  if (sizes.length <= 1) {
    return { teams: sizes.length ? [players.slice()] : [], ref, evaluation: evaluateTeams(sizes.length ? [players] : [], n, ctx) };
  }
  const restarts = opts.restarts ?? 5;
  const iters = opts.iterations ?? 2500 + 120 * players.length;
  let best = null;
  let bestCost = Infinity;

  for (let r = 0; r < restarts; r++) {
    const pool = rng.shuffle(players.slice());
    const teams = [];
    let k = 0;
    for (const s of sizes) {
      teams.push(pool.slice(k, k + s));
      k += s;
    }
    const cache = teams.map((t) => teamCache(t));
    let cost = totalFromCache(cache);
    let localBest = cost;
    let localTeams = teams.map((t) => t.slice());
    const T0 = 2;
    const Tend = 0.003;
    for (let it = 0; it < iters; it++) {
      const T = T0 * (Tend / T0) ** (it / iters);
      const i = rng.int(teams.length);
      let j = rng.int(teams.length - 1);
      if (j >= i) j++;
      const a = rng.int(teams[i].length);
      const b = rng.int(teams[j].length);
      const pa = teams[i][a];
      const pb = teams[j][b];
      if (pa.stars === pb.stars && samePositions(pa, pb)) continue;
      teams[i][a] = pb;
      teams[j][b] = pa;
      const ci = cache[i];
      const cj = cache[j];
      cache[i] = teamCache(teams[i]);
      cache[j] = teamCache(teams[j]);
      const nc = totalFromCache(cache);
      if (nc <= cost || rng() < Math.exp((cost - nc) / T)) {
        cost = nc;
        if (cost < localBest - 1e-9) {
          localBest = cost;
          localTeams = teams.map((t) => t.slice());
        }
      } else {
        teams[i][a] = pa;
        teams[j][b] = pb;
        cache[i] = ci;
        cache[j] = cj;
      }
    }
    if (localBest < bestCost - 1e-9) {
      bestCost = localBest;
      best = localTeams;
    }
  }
  return { teams: best, ref, evaluation: evaluateTeams(best, n, ctx) };

  function teamCache(t) {
    const info = teamInfo(t, n);
    return { full: t.length >= n, size: t.length, sum: info.sum, misplaced: info.misplaced, inc: t.length < n ? incompleteBaseCost(t, info, ref) : 0 };
  }
  function totalFromCache(c) {
    const sums = [];
    let tac = 0;
    let inc = 0;
    for (const x of c) {
      if (x.full) {
        sums.push(x.sum);
        tac += WEIGHTS.tactical * x.misplaced;
      } else inc += x.inc;
    }
    // o alvo da equipe incompleta depende da média atual dos completos (otimização global, RN-31)
    for (const x of c) if (!x.full) inc += incompleteTargetCost(x.sum, x.size, sums, n, ctx.mAthlete);
    return technicalCost(sums) + tac + inc;
  }
}

function samePositions(a, b) {
  const pa = a.positions || [];
  const pb = b.positions || [];
  return pa.length === pb.length && pa.every((x) => pb.includes(x));
}

/**
 * Distribui goleiros: um por equipe (prioridade às primeiras equipes da fila),
 * goleiro mais forte para o time de linha mais fraco; excedentes para os times mais fracos.
 * @returns {{byTeam: string[][], withoutGk: number[]}}
 */
export function assignGoalkeepers(teamSums, goalkeepers, rng = createRng()) {
  const k = teamSums.length;
  const byTeam = Array.from({ length: k }, () => []);
  if (!k) return { byTeam, withoutGk: [] };
  const gks = rng.shuffle(goalkeepers.slice()).sort((a, b) => b.stars - a.stars);
  const receivers = [...Array(Math.min(k, gks.length)).keys()];
  const bySum = receivers.slice().sort((a, b) => teamSums[a] - teamSums[b]);
  const totals = teamSums.slice();
  bySum.forEach((ti, idx) => {
    byTeam[ti].push(gks[idx].id);
    totals[ti] += gks[idx].stars;
  });
  for (let g = receivers.length; g < gks.length; g++) {
    // excedentes: equipe com menor total (linha + goleiros) e menos goleiros
    let target = 0;
    for (let t = 1; t < k; t++) {
      if (byTeam[t].length < byTeam[target].length || (byTeam[t].length === byTeam[target].length && totals[t] < totals[target])) target = t;
    }
    byTeam[target].push(gks[g].id);
    totals[target] += gks[g].stars;
  }
  const withoutGk = byTeam.map((g, i) => (g.length ? -1 : i)).filter((i) => i >= 0);
  return { byTeam, withoutGk };
}

/**
 * Custo de uma ordem de saída. exitSeq[0] é o primeiro a sair (base).
 * Simula as saídas de 1, 2 e 3 jogadores (e demais prefixos com peso menor).
 */
export function orderCost(exitSeq, roles = {}) {
  const m = exitSeq.length;
  if (m <= 1) return 0;
  const mu = mean(exitSeq.map((p) => p.stars));
  let cost = 0;
  let prefix = 0;
  for (let k = 1; k < m; k++) {
    prefix += exitSeq[k - 1].stars;
    cost += (k <= 3 ? 3 : 1) * Math.abs(prefix - k * mu);
  }
  for (let i = 0; i < Math.min(m - 1, 4); i++) {
    const d1 = exitSeq[i].stars - mu;
    const d2 = exitSeq[i + 1].stars - mu;
    if (d1 * d2 > 0 && Math.abs(d1) >= 0.5 && Math.abs(d2) >= 0.5) cost += 1;
  }
  for (const k of [2, 3]) {
    if (m < k) break;
    const rs = exitSeq.slice(0, k).map((p) => roles[p.id]).filter(Boolean);
    cost += 0.8 * (rs.length - new Set(rs).size);
  }
  return cost;
}

/**
 * RN-34 — Escalonamento interno das posições (padrão fixo, não aleatório).
 * Retorna, para cada posição de baixo para cima (índice 0 = posição 1), o ranking do atleta que a ocupa
 * (0 = melhor do time, n−1 = pior). Preenche "camadas" de fora para dentro, alternando fortes e fracos:
 *   camada 1 (topo e base): 1º melhor no topo, 2º melhor na base;
 *   camada 2 (logo abaixo do topo e logo acima da base): o pior abaixo do topo, o 2º pior acima da base;
 *   camada 3: próximos mais fortes (3º perto do topo, 4º perto da base); camada 4: próximos mais fracos...;
 *   posição central (n ímpar): quem sobrar.
 * Com 5: pos5 = 1º, pos4 = 5º, pos3 = 3º, pos2 = 4º, pos1 = 2º. Com 3: pos3 = 1º, pos2 = 3º, pos1 = 2º.
 * Resultado: os mais fortes nunca ficam em posições vizinhas e ficam o mais distantes possível entre si.
 */
export function staggerPattern(n) {
  const rankAt = new Array(n);
  let lo = 1;
  let hi = n;
  let strong = 0;
  let weak = n - 1;
  for (let layer = 0; lo <= hi; layer++, lo++, hi--) {
    const isStrong = layer % 2 === 0;
    if (lo === hi) {
      rankAt[lo - 1] = isStrong ? strong++ : weak--;
      break;
    }
    if (isStrong) {
      rankAt[hi - 1] = strong++;
      rankAt[lo - 1] = strong++;
    } else {
      rankAt[hi - 1] = weak--;
      rankAt[lo - 1] = weak--;
    }
  }
  return rankAt;
}

/** Penalidade de funções repetidas entre os primeiros a sair (posições 1–2 e 1–3). */
function exitRoleCost(bottomUp, roles) {
  let c = 0;
  for (const k of [2, 3]) {
    if (bottomUp.length < k) break;
    const rs = bottomUp.slice(0, k).map((p) => roles[p.id]).filter(Boolean);
    c += rs.length - new Set(rs).size;
  }
  return c;
}

/**
 * Ordena os atletas do time pelo escalonamento posicional (RN-34). Retorna array topo → base.
 * O ranking é por estrelas; entre atletas com as MESMAS estrelas (intercambiáveis para a regra),
 * escolhe a disposição que evita funções repetidas entre os primeiros a sair (RN-34, desempate tático).
 */
export function optimizeOrder(players, roles = {}, rng = createRng()) {
  const m = players.length;
  if (m <= 1) return players.slice();
  // empates de estrelas em ordem aleatória (novo sorteio pode variar), depois do melhor para o pior
  const ranked = rng.shuffle(players.slice()).sort((a, b) => b.stars - a.stars);
  const bottomUp = staggerPattern(m).map((rank) => ranked[rank]);
  // desempate: trocar apenas atletas com estrelas iguais, enquanto melhorar a diversidade de funções
  let cost = exitRoleCost(bottomUp, roles);
  for (let improved = true; improved && cost > 0; ) {
    improved = false;
    for (let i = 0; i < m && !improved; i++) {
      for (let j = i + 1; j < m && !improved; j++) {
        if (bottomUp[i].stars !== bottomUp[j].stars) continue;
        [bottomUp[i], bottomUp[j]] = [bottomUp[j], bottomUp[i]];
        const nc = exitRoleCost(bottomUp, roles);
        if (nc < cost) {
          cost = nc;
          improved = true;
        } else [bottomUp[i], bottomUp[j]] = [bottomUp[j], bottomUp[i]];
      }
    }
  }
  return bottomUp.reverse();
}

/** Grupos de saída (1, 2, 3 primeiros a sair) de uma lista topo→base. */
export function exitGroups(ordered, roles = {}) {
  const exit = ordered.slice().reverse();
  const all = mean(ordered.map((p) => p.stars));
  const groups = [];
  for (let k = 1; k <= Math.min(3, exit.length); k++) {
    const ps = exit.slice(0, k);
    const sum = sumStars(ps);
    groups.push({ k, players: ps, sum, avg: sum / k, deltaAvg: sum / k - all, roles: ps.map((p) => roles[p.id]) });
  }
  return groups;
}

/**
 * Sorteio completo.
 * @param {object} params {line: player[], goalkeepers: player[], linePerTeam, useGoalkeepers, seed}
 * @returns {{teams: {line:{pid,role}[], gks:string[], sum, counts, misplaced, size, complete}[], ref, metrics, withoutGk, seed}}
 */
export function drawTeams({ line, goalkeepers = [], linePerTeam, useGoalkeepers = true, seed, iterations, restarts }) {
  const rng = createRng(seed);
  const n = linePerTeam;
  const { teams, ref, evaluation } = optimizeTeams(line, n, rng, { iterations, restarts });
  const infos = evaluation.infos;
  const gk = useGoalkeepers ? assignGoalkeepers(infos.map((i) => i.sum), goalkeepers, rng) : { byTeam: teams.map(() => []), withoutGk: [] };
  const result = teams.map((t, i) => {
    const info = infos[i];
    const ordered = optimizeOrder(t, info.roles, rng);
    return {
      line: ordered.map((p) => ({ pid: p.id, role: info.roles[p.id] })),
      gks: gk.byTeam[i] || [],
      sum: info.sum,
      avg: info.avg,
      counts: info.counts,
      misplaced: info.misplaced,
      size: info.size,
      complete: info.size >= n,
    };
  });
  return {
    teams: result,
    ref,
    seed: rng.seed,
    withoutGk: useGoalkeepers ? gk.withoutGk : [],
    unusedGoalkeepers: useGoalkeepers ? [] : goalkeepers.map((g) => g.id),
    metrics: {
      total: evaluation.total,
      technical: evaluation.technical,
      tactical: evaluation.tactical,
      incomplete: evaluation.incomplete,
      range: evaluation.range,
      fullSums: evaluation.fullSums,
      forming: evaluation.forming, // equipe incompleta: soma e Alvo_Incompleto (RN-29)
    },
  };
}
