// Sorteio inteligente, equilíbrio técnico/tático, equipe incompleta e ordem estratégica.
import { suite, test, assert } from './harness.js';
import { drawTeams, planTeamSizes, orderCost, optimizeOrder, exitGroups, assignGoalkeepers, median, staggerPattern, incompleteTarget } from '../src/domain/index.js';
import { assignRoles, tacticalDeviation } from '../src/domain/index.js';
import { createRng } from '../src/domain/index.js';
import { createSession } from '../src/domain/index.js';

const POS = [['D'], ['M'], ['A'], ['D', 'M'], ['M', 'A'], ['D', 'M', 'A'], ['D', 'A']];
function group(n, seed = 7) {
  const rng = createRng(seed);
  const stars = [1, 1.5, 2, 2.5, 3];
  return Array.from({ length: n }, (_, i) => ({ id: `x${i}`, name: `X${i}`, type: 'line', stars: stars[rng.int(5)], positions: POS[rng.int(POS.length)] }));
}

suite('Tática — atribuição de função', () => {
  test('Cada jogador recebe exatamente uma função dentre as suas', () => {
    const ps = [
      { id: 'a', positions: ['D', 'M'] },
      { id: 'b', positions: ['D', 'M'] },
      { id: 'c', positions: ['M'] },
      { id: 'd', positions: ['A', 'M'] },
      { id: 'e', positions: ['D'] },
    ];
    const r = assignRoles(ps);
    assert.equal(Object.keys(r.roles).length, 5);
    for (const p of ps) assert.ok(p.positions.includes(r.roles[p.id]));
    assert.deepEqual(r.counts, { D: 2, M: 2, A: 1 });
    assert.equal(r.misplaced, 0);
  });

  test('Sem jogadores suficientes para a formação: melhor composição possível, ninguém excluído', () => {
    const ps = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, positions: ['A'] }));
    const r = assignRoles(ps);
    assert.deepEqual(r.counts, { D: 0, M: 0, A: 5 });
    assert.equal(tacticalDeviation(r.counts, 5), 4);
  });
});

suite('Sorteio — seções 4 a 7', () => {
  test('Planejamento: 21 com 5 por time → 4 completos + 1 com 1', () => {
    assert.deepEqual(planTeamSizes(21, 5), [5, 5, 5, 5, 1]);
    assert.deepEqual(planTeamSizes(23, 5), [5, 5, 5, 5, 3]);
    assert.deepEqual(planTeamSizes(3, 5), [3]);
  });

  test('Todos aproveitados, sem duplicidade, incompleta no fim', () => {
    const line = group(21);
    const d = drawTeams({ line, linePerTeam: 5, seed: 1 });
    const ids = d.teams.flatMap((t) => t.line.map((x) => x.pid));
    assert.equal(ids.length, 21);
    assert.equal(new Set(ids).size, 21);
    assert.deepEqual(d.teams.map((t) => t.size), [5, 5, 5, 5, 1]);
    assert.ok(!d.teams[4].complete);
  });

  test('Equilíbrio técnico: diferença entre completos ≤ 0,5 estrela', () => {
    for (const seed of [3, 11, 19]) {
      const line = group(25, seed);
      const d = drawTeams({ line, linePerTeam: 5, seed });
      assert.ok(d.metrics.range <= 0.5, `seed ${seed}: range ${d.metrics.range}`);
    }
  });

  test('Otimizador supera divisão aleatória', () => {
    const line = group(30, 5);
    const d = drawTeams({ line, linePerTeam: 5, seed: 2 });
    const rng = createRng(9);
    let worse = 0;
    for (let k = 0; k < 20; k++) {
      const sh = rng.shuffle(line.slice());
      const sums = [0, 1, 2, 3, 4, 5].map((i) => sh.slice(i * 5, i * 5 + 5).reduce((a, p) => a + p.stars, 0));
      if (Math.max(...sums) - Math.min(...sums) > d.metrics.range) worse++;
    }
    assert.ok(worse >= 15, `aleatório pior em ${worse}/20`);
  });

  test('Equilíbrio tático: times completos próximos da formação 2-2-1 quando possível', () => {
    const line = [];
    for (let i = 0; i < 8; i++) line.push({ id: `d${i}`, stars: 2, positions: ['D'] });
    for (let i = 0; i < 8; i++) line.push({ id: `m${i}`, stars: 2, positions: ['M'] });
    for (let i = 0; i < 4; i++) line.push({ id: `a${i}`, stars: 2, positions: ['A'] });
    const d = drawTeams({ line, linePerTeam: 5, seed: 4 });
    for (const t of d.teams) assert.deepEqual(t.counts, { D: 2, M: 2, A: 1 });
  });

  test('Equipe incompleta recebe nível intermediário (não os melhores nem os piores)', () => {
    const line = [];
    const stars = [3, 3, 3, 3, 1, 1, 1, 1, 2, 2, 2, 2, 2.5, 1.5, 2, 2.5, 1.5, 3, 1, 2, 2];
    stars.forEach((s, i) => line.push({ id: `p${i}`, stars: s, positions: ['D', 'M', 'A'] }));
    const ref = median(stars);
    for (const seed of [1, 2, 3]) {
      const d = drawTeams({ line, linePerTeam: 5, seed });
      const inc = d.teams[d.teams.length - 1];
      const st = line.find((p) => p.id === inc.line[0].pid).stars;
      assert.ok(Math.abs(st - ref) <= 0.5, `seed ${seed}: incompleta com ${st} (mediana ${ref})`);
    }
  });

  test('Equipe incompleta de 3 tende a ter defesa, meio e ataque', () => {
    const line = [];
    for (let i = 0; i < 9; i++) line.push({ id: `d${i}`, stars: 2, positions: ['D'] });
    for (let i = 0; i < 9; i++) line.push({ id: `m${i}`, stars: 2, positions: ['M'] });
    for (let i = 0; i < 5; i++) line.push({ id: `a${i}`, stars: 2, positions: ['A'] });
    const d = drawTeams({ line, linePerTeam: 5, seed: 8 });
    const inc = d.teams[4];
    assert.equal(inc.size, 3);
    assert.deepEqual(inc.counts, { D: 1, M: 1, A: 1 });
  });

  test('RN-29: Alvo_Incompleto = M_time − (N − k) × M_atleta (exemplo do PRD: 9 − 2 × 2 = 5)', () => {
    assert.equal(incompleteTarget(9, 5, 3, 2), 5);
    assert.equal(incompleteTarget(10, 5, 1, 2), 2);
    assert.equal(incompleteTarget(12, 6, 4, 2.5), 7);
  });

  test('RN-29: soma da equipe incompleta fica próxima do alvo projetado', () => {
    for (const seed of [2, 5, 9, 13, 21]) {
      const line = group(23, seed); // 4 completos + 1 incompleto com 3
      const d = drawTeams({ line, linePerTeam: 5, seed });
      const inc = d.teams[4];
      assert.equal(inc.size, 3);
      const mAthlete = line.reduce((a, p) => a + p.stars, 0) / line.length;
      const fullSums = d.teams.slice(0, 4).map((t) => t.sum);
      const mTime = fullSums.reduce((a, b) => a + b, 0) / 4;
      const target = incompleteTarget(mTime, 5, 3, mAthlete);
      assert.ok(Math.abs(inc.sum - target) <= 0.5, `seed ${seed}: soma ${inc.sum}, alvo ${target.toFixed(2)}`);
      assert.close(d.metrics.forming.target, target, 1e-9, 'métrica exposta no resultado do sorteio');
      assert.equal(d.metrics.forming.sum, inc.sum);
    }
  });

  test('RN-29: equipe incompleta não fica com os piores quando isso foge do alvo', () => {
    const line = [];
    for (let i = 0; i < 3; i++) line.push({ id: `w${i}`, stars: 1, positions: ['D', 'M', 'A'] });
    for (let i = 0; i < 20; i++) line.push({ id: `s${i}`, stars: 2.5, positions: ['D', 'M', 'A'] });
    const d = drawTeams({ line, linePerTeam: 5, seed: 4 });
    const inc = d.teams[4];
    const worstInInc = inc.line.filter((x) => x.pid.startsWith('w')).length;
    assert.ok(worstInInc < 3, 'não concentra os três piores');
    assert.ok(Math.abs(inc.sum - d.metrics.forming.target) <= 0.75, `soma ${inc.sum}, alvo ${d.metrics.forming.target}`);
  });

  test('RN-29: sem times completos não há alvo (equipe única em formação)', () => {
    const d = drawTeams({ line: group(3), linePerTeam: 5, seed: 1 });
    assert.equal(d.teams.length, 1);
    assert.equal(d.metrics.forming.target, null);
  });

  test('Goleiros: um por equipe; faltando, informa quais ficam sem', () => {
    const r = assignGoalkeepers([10, 11, 9, 2], [{ id: 'g1', stars: 3 }, { id: 'g2', stars: 1 }], createRng(1));
    assert.equal(r.byTeam[0].length + r.byTeam[1].length, 2, 'primeiros times da fila recebem');
    assert.deepEqual(r.withoutGk, [2, 3]);
    assert.deepEqual(r.byTeam[0], ['g1'], 'goleiro mais forte vai para o time mais fraco entre os que recebem');
    const r2 = assignGoalkeepers([10, 10], [{ id: 'a', stars: 2 }, { id: 'b', stars: 2 }, { id: 'c', stars: 2 }], createRng(1));
    assert.equal(r2.byTeam.flat().length, 3, 'excedentes distribuídos');
    assert.deepEqual(r2.withoutGk, []);
  });

  test('Sorteio sem goleiros deixa goleiros fora da distribuição', () => {
    const d = drawTeams({ line: group(10), goalkeepers: [{ id: 'g', stars: 2 }], linePerTeam: 5, useGoalkeepers: false, seed: 1 });
    assert.deepEqual(d.unusedGoalkeepers, ['g']);
    assert.ok(d.teams.every((t) => t.gks.length === 0));
  });

  test('Sessão criada a partir do sorteio é íntegra (campo, fila, ativos)', () => {
    const line = group(23);
    const snapshots = Object.fromEntries(line.map((p) => [p.id, p]));
    const d = drawTeams({ line, linePerTeam: 5, seed: 1 });
    const s = createSession({ title: 'x', config: { linePerTeam: 5 }, snapshots, draw: d });
    assert.equal(s.field.length, 2);
    assert.equal(s.queue.length, 3);
    assert.equal(s.active.length, 23);
  });
});

suite('Ordem estratégica — seção 8', () => {
  test('Ordem otimizada intercala níveis (não ordena por força)', () => {
    const ps = [3, 3, 2, 1, 1].map((s, i) => ({ id: `o${i}`, stars: s }));
    const ord = optimizeOrder(ps, {}, createRng(1));
    const exit = ord.slice().reverse();
    assert.ok(!(exit[0].stars === 3 && exit[1].stars === 3), 'dois fortes não saem juntos');
    assert.ok(!(exit[0].stars === 1 && exit[1].stars === 1), 'dois fracos não saem juntos');
    const sorted = [...ps].sort((a, b) => b.stars - a.stars);
    assert.ok(orderCost(ord.slice().reverse()) < orderCost(sorted.slice().reverse()), 'melhor que ordem decrescente');
    assert.ok(orderCost(ord.slice().reverse()) < orderCost(sorted), 'melhor que ordem crescente');
  });

  test('RN-34: padrão com 5 — pos5 = 1º, pos4 = 5º (pior), pos3 = 3º, pos2 = 4º, pos1 = 2º', () => {
    // staggerPattern devolve o ranking (0 = melhor) de cada posição, de baixo para cima
    assert.deepEqual(staggerPattern(5), [1, 3, 2, 4, 0]);
    const ps = [3, 2.5, 2, 1.5, 1].map((s, i) => ({ id: `r${i}`, stars: s }));
    const bottomUp = optimizeOrder(ps, {}, createRng(1)).slice().reverse().map((p) => p.stars);
    assert.deepEqual(bottomUp, [2.5, 1.5, 2, 1, 3], 'pos1..pos5');
  });

  test('RN-34: equipe incompleta com 3 — pos3 = melhor, pos2 = pior, pos1 = 2º melhor', () => {
    assert.deepEqual(staggerPattern(3), [1, 2, 0]);
    const ps = [1, 3, 2].map((s, i) => ({ id: `r${i}`, stars: s }));
    const bottomUp = optimizeOrder(ps, {}, createRng(1)).slice().reverse().map((p) => p.stars);
    assert.deepEqual(bottomUp, [2, 1, 3]);
  });

  test('RN-34: padrão para N de 1 a 15 — permutação, extremos e fortes nunca vizinhos', () => {
    assert.deepEqual(staggerPattern(1), [0]);
    assert.deepEqual(staggerPattern(2), [1, 0], '2: pos2 = melhor, pos1 = 2º');
    for (let n = 2; n <= 15; n++) {
      const p = staggerPattern(n);
      assert.deepEqual([...p].sort((a, b) => a - b), [...Array(n).keys()], `n=${n}: cada ranking aparece uma vez`);
      assert.equal(p[n - 1], 0, `n=${n}: topo é o melhor`);
      assert.equal(p[0], 1, `n=${n}: base é o 2º melhor`);
      const strongest = Math.ceil(n / 2);
      const posOf = (rank) => p.indexOf(rank) + 1;
      for (let a = 0; a < strongest; a++) {
        for (let b = a + 1; b < strongest; b++) {
          assert.ok(Math.abs(posOf(a) - posOf(b)) >= 2, `n=${n}: ${a + 1}º e ${b + 1}º melhores em posições vizinhas`);
        }
      }
      if (n >= 3) assert.equal(p[n - 2], n - 1, `n=${n}: o pior fica logo abaixo do topo`);
    }
  });

  test('RN-34: o sorteio aplica o escalonamento em todas as equipes (completas e incompleta)', () => {
    for (const seed of [1, 7]) {
      const d = drawTeams({ line: group(23, seed), linePerTeam: 5, seed });
      const starsOf = Object.fromEntries(group(23, seed).map((p) => [p.id, p.stars]));
      for (const t of d.teams) {
        const bottomUp = t.line.slice().reverse().map((x) => starsOf[x.pid]);
        const desc = [...bottomUp].sort((a, b) => b - a);
        const expected = staggerPattern(bottomUp.length).map((rank) => desc[rank]);
        assert.deepEqual(bottomUp, expected, `seed ${seed}, time de ${bottomUp.length}`);
      }
    }
  });

  test('Grupos de saída de 1, 2 e 3 jogadores', () => {
    const ps = [3, 2, 1].map((s, i) => ({ id: `o${i}`, stars: s }));
    const g = exitGroups(ps);
    assert.equal(g.length, 3);
    assert.equal(g[0].players[0].id, 'o2', 'base sai primeiro');
    assert.equal(g[1].sum, 3);
  });

  test('Ordem considera posições: primeiros a sair com funções diferentes', () => {
    const ps = [
      { id: 'a', stars: 2 }, { id: 'b', stars: 2 }, { id: 'c', stars: 2 }, { id: 'd', stars: 2 }, { id: 'e', stars: 2 },
    ];
    const roles = { a: 'D', b: 'D', c: 'M', d: 'M', e: 'A' };
    const ord = optimizeOrder(ps, roles, createRng(3));
    const exit = ord.slice().reverse().slice(0, 3).map((p) => roles[p.id]);
    assert.equal(new Set(exit).size, 3, `funções ${exit}`);
  });
});
