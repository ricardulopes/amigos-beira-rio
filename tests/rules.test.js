// Testes obrigatórios das regras de empate (seção 22) e do rodízio (seção 14).
import { suite, test, assert } from './harness.js';
import { mkSession, pids, lateSnap } from './helpers.js';
import { registerResult, analyzeResult, addLatePlayer, isComplete, queueLabel, linePositions, positionOf } from '../src/domain/index.js';

const R = (s, r, o) => registerResult(s, r, o).state;
const perm = (s, id) => s.teams[id].permanence;
/** Atletas por posição, de baixo para cima: [pos1, pos2, ...]. */
const byPos = (s, tid) => linePositions(s.teams[tid]).map((x) => x.pid);

suite('Empates — seção 22', () => {
  test('1. Primeiro jogo empatado (≤1 completo aguardando): par ou ímpar, vencedor fica', () => {
    const s = mkSession([5, 5, 5]);
    const an = analyzeResult(s, 'draw');
    assert.equal(an.scenario, 'DRAW_TOSS');
    assert.ok(an.needsToss);
    assert.throws(() => registerResult(s, 'draw'), /par ou ímpar/);
    const s2 = R(s, 'draw', { tossWinner: 't2' });
    assert.deepEqual(s2.field, ['t3', 't2'], 'vencedor do par/ímpar fica no slot, PRO entra');
    assert.ok(perm(s2, 't2'), 'vencedor do par/ímpar ganha permanência');
    assert.ok(!perm(s2, 't1'));
    assert.deepEqual(s2.queue, ['t1']);
    assert.equal(s2.teams.t2.stats.tossWins, 1);
    assert.equal(s2.teams.t2.stats.wins, 0, 'par ou ímpar não é vitória oficial');
  });

  test('1b. Primeiro jogo com PRO e RE completos: par ou ímpar obrigatório, saem os dois e o vencedor sobe antes', () => {
    const s = mkSession([5, 5, 5, 5]);
    const an = analyzeResult(s, 'draw');
    assert.equal(an.scenario, 'DRAW_TOSS_DOUBLE_EXIT');
    assert.ok(an.needsToss);
    assert.throws(() => registerResult(s, 'draw'), /par ou ímpar/);
    const s2 = R(s, 'draw', { tossWinner: 't2' });
    assert.deepEqual(s2.field, ['t3', 't4'], 'PRO e RE entram');
    assert.deepEqual(s2.queue, ['t2', 't1'], 'vencedor do par ou ímpar (t2) volta à fila na frente do perdedor');
    assert.ok(!perm(s2, 't1') && !perm(s2, 't2') && !perm(s2, 't3') && !perm(s2, 't4'));
    assert.equal(s2.teams.t2.stats.tossWins, 1);
    assert.equal(s2.teams.t1.stats.tossWins, 0);
    assert.equal(s2.games[0].toss, 't2');
    const s3 = R(s, 'draw', { tossWinner: 't1' });
    assert.deepEqual(s3.queue, ['t1', 't2']);
  });

  test('1c. Par ou ímpar do 1º jogo é automático: a antiga opção de Ajustes é ignorada', () => {
    const off = mkSession([5, 5, 5, 5], { config: { tossOnFirstGameEvenWithTwoWaiting: false } });
    const on = mkSession([5, 5, 5, 5], { config: { tossOnFirstGameEvenWithTwoWaiting: true } });
    assert.equal(analyzeResult(off, 'draw').scenario, 'DRAW_TOSS_DOUBLE_EXIT');
    assert.equal(analyzeResult(on, 'draw').scenario, 'DRAW_TOSS_DOUBLE_EXIT');
  });

  test('1d. Do 2º jogo em diante não há par ou ímpar: times que entraram juntos saem na ordem de entrada', () => {
    let s = mkSession([5, 5, 5, 5, 5, 5]);
    s = R(s, 'draw', { tossWinner: 't2' }); // 1º jogo: saem t1 e t2; entram t3 e t4
    assert.deepEqual(s.field, ['t3', 't4']);
    const an = analyzeResult(s, 'draw');
    assert.equal(an.scenario, 'DRAW_DOUBLE_EXIT');
    assert.ok(!an.needsToss);
    s = R(s, 'draw');
    assert.deepEqual(s.field, ['t5', 't6']);
    assert.deepEqual(s.queue, ['t2', 't1', 't3', 't4'], 't3 (entrou primeiro) antes de t4');
    assert.equal(s.games[1].toss, null);
  });

  test('1e. 2º jogo sem permanência e sem PRO e RE completos: quem entrou primeiro fica (sem par ou ímpar)', () => {
    let s = mkSession([5, 5, 5, 3]);
    s.games.push({ n: 1 }); // simula que o 1º jogo já aconteceu e ninguém tem permanência
    const an = analyzeResult(s, 'draw');
    assert.equal(an.scenario, 'DRAW_ENTRY_ORDER');
    assert.ok(!an.needsToss);
    assert.deepEqual(an.staying, ['t1']);
    s = R(s, 'draw');
    assert.deepEqual(s.field, ['t1', 't3']);
    assert.ok(perm(s, 't1'), 'quem fica passa a defender a permanência');
    assert.ok(!s.teams.t2, 't2 saiu e completou a fila (divisão)');
    assert.equal(s.teams.t1.stats.drawPermanences, 1);
  });

  test('1f. Defensor x desafiante com PRO e RE completos: saem os dois e o desafiante sobe primeiro', () => {
    let s = mkSession([5, 5, 5, 5, 5]);
    s = R(s, 'B'); // t2 vence t1; t3 entra no slot A
    assert.deepEqual(s.field, ['t3', 't2']);
    s = R(s, 'draw');
    assert.deepEqual(s.field, ['t4', 't5']);
    assert.deepEqual(s.queue.slice(-2), ['t3', 't2'], 'desafiante (t3) na frente do defensor (t2)');
    assert.equal(s.games[1].toss, null, 'sem par ou ímpar');
  });

  test('2. Vencedor x desafiante sem permanência: desafiante empata e permanece', () => {
    let s = mkSession([5, 5, 5]);
    s = R(s, 'A'); // t1 vence t2
    assert.deepEqual(s.field, ['t1', 't3']);
    assert.ok(perm(s, 't1'));
    assert.ok(!perm(s, 't3'));
    const an = analyzeResult(s, 'draw');
    assert.equal(an.scenario, 'DRAW_CHALLENGER_STAYS');
    s = R(s, 'draw');
    assert.deepEqual(s.field, ['t2', 't3'], 't3 fica; t2 (PRO) entra no slot de t1');
    assert.ok(perm(s, 't3'), 'permanência por empate conta como vitória');
    assert.equal(s.teams.t3.stats.drawPermanences, 1);
    assert.equal(s.teams.t3.stats.wins, 0, 'não é vitória oficial no placar');
    assert.ok(!perm(s, 't1'));
    assert.deepEqual(s.queue, ['t1']);
  });

  test('3. Quem permaneceu por empate passa a defender permanência na partida seguinte', () => {
    let s = mkSession([5, 5, 5]);
    s = R(s, 'A');
    s = R(s, 'draw');
    // t3 defende; t2 é o desafiante sem permanência
    assert.ok(perm(s, 't3'));
    assert.ok(!perm(s, 't2'));
    s = R(s, 'B'); // t3 (slot B) vence
    assert.ok(s.field.includes('t3'));
    assert.ok(perm(s, 't3'));
    assert.equal(s.teams.t3.stats.wins, 1);
  });

  test('4. Time que ficou por empate empata de novo: novo desafiante tem direito ao empate', () => {
    let s = mkSession([5, 5, 5]);
    s = R(s, 'A');
    s = R(s, 'draw'); // t3 fica por empate; field [t2, t3]
    const an = analyzeResult(s, 'draw');
    assert.equal(an.scenario, 'DRAW_CHALLENGER_STAYS');
    s = R(s, 'draw');
    assert.ok(s.field.includes('t2'), 'novo desafiante permanece');
    assert.ok(!s.field.includes('t3'), 'quem defendia sai');
    assert.ok(perm(s, 't2'));
    assert.ok(!perm(s, 't3'));
    assert.equal(s.queue[s.queue.length - 1], 't3');
  });

  test('5. Time com várias vitórias empata com dois completos na fila: saem os dois', () => {
    let s = mkSession([5, 5, 5, 5, 5]);
    s = R(s, 'A'); // t1 x t3
    s = R(s, 'A'); // t1 x t4
    s = R(s, 'A'); // t1 x t5
    assert.equal(s.teams.t1.stats.wins, 3);
    assert.deepEqual(s.field, ['t1', 't5']);
    assert.deepEqual(s.queue, ['t2', 't3', 't4']);
    s = R(s, 'draw');
    assert.deepEqual(s.field, ['t2', 't3'], 'PRO e RE entram');
    assert.deepEqual(s.queue, ['t4', 't5', 't1'], 'desafiante sem permanência (t5) antes do defensor (t1)');
    assert.ok(!perm(s, 't1') && !perm(s, 't5'));
  });

  test('6. Time que ficou por empate empata com dois completos na fila: saem os dois', () => {
    let s = mkSession([5, 5, 5]);
    s = R(s, 'A'); // t1 vence t2; field [t1,t3]; queue [t2]
    s = R(s, 'draw'); // t3 fica por empate; field [t2,t3]; queue [t1]
    for (let i = 1; i <= 5; i++) s = addLatePlayer(s, lateSnap(`L${i}`)).state; // forma t4 completo
    assert.deepEqual(s.queue, ['t1', 't4']);
    assert.ok(perm(s, 't3'));
    const an = analyzeResult(s, 'draw');
    assert.equal(an.scenario, 'DRAW_DOUBLE_EXIT');
    s = R(s, 'draw');
    assert.deepEqual(s.field, ['t1', 't4']);
    assert.deepEqual(s.queue, ['t2', 't3'], 'desafiante t2 antes do defensor t3');
    assert.ok(!perm(s, 't3') && !perm(s, 't2'));
  });

  test('7. Apenas um PRO completo: regra de direito ao empate', () => {
    let s = mkSession([5, 5, 5]);
    s = R(s, 'B'); // t2 vence t1; field [t3, t2]
    const an = analyzeResult(s, 'draw');
    assert.equal(an.completeWaiting, 1);
    assert.ok(an.proComplete && !an.reComplete);
    assert.equal(an.scenario, 'DRAW_CHALLENGER_STAYS');
    assert.deepEqual(an.staying, ['t3']);
    assert.deepEqual(an.leaving, ['t2']);
  });

  test('8. PRO completo e RE incompleto: RE não conta como segundo completo', () => {
    let s = mkSession([5, 5, 5, 3]);
    s = R(s, 'A'); // t2 sai e completa t4; restante forma t5
    assert.deepEqual(s.queue, ['t4', 't5']);
    assert.ok(isComplete(s, s.teams.t4));
    assert.ok(!isComplete(s, s.teams.t5));
    const an = analyzeResult(s, 'draw');
    assert.ok(an.proComplete && !an.reComplete);
    assert.equal(an.scenario, 'DRAW_CHALLENGER_STAYS');
  });

  test('8b. Goleiro obrigatório: PRO sem goleiro não é completo', () => {
    const s = mkSession([5, 5, 5, 5], { gks: [1, 1, 0, 1], config: { requireGkForComplete: true } });
    const an = analyzeResult(s, 'draw');
    assert.ok(!an.proComplete);
    assert.equal(an.scenario, 'DRAW_TOSS');
  });

  test('9. PRO e RE completos: saída dupla sempre (mesmo com permanência)', () => {
    let s = mkSession([5, 5, 5, 5, 5]);
    s = R(s, 'A');
    assert.ok(perm(s, 't1'));
    const an = analyzeResult(s, 'draw');
    assert.equal(an.scenario, 'DRAW_DOUBLE_EXIT');
    assert.deepEqual(an.leaving, ['t3', 't1']);
  });

  test('10. Ordem da fila após saída dupla no 1º jogo segue o par ou ímpar', () => {
    let s = mkSession([5, 5, 5, 5, 5, 5]);
    s = R(s, 'draw', { tossWinner: 't1' }); // primeiro jogo, PRO/RE completos → saída dupla com par ou ímpar
    assert.deepEqual(s.field, ['t3', 't4']);
    assert.deepEqual(s.queue, ['t5', 't6', 't1', 't2']);
    assert.deepEqual(['t5', 't6', 't1', 't2'].map((id) => queueLabel(s, id)), ['PRO', 'RE', 'TRI', '4º']);
  });

  test('11. Quem sai de campo perde a vantagem de permanência', () => {
    let s = mkSession([5, 5, 5]);
    s = R(s, 'A');
    assert.ok(perm(s, 't1'));
    s = R(s, 'B'); // t3 vence t1
    assert.ok(!perm(s, 't1'));
    assert.ok(perm(s, 't3'));
    assert.equal(s.teams.t1.stats.losses, 1);
  });

  test('12. Novo desafiante entra sem permanência', () => {
    let s = mkSession([5, 5, 5, 5]);
    s.teams.t3.permanence = true; // estado sujo proposital
    s = R(s, 'A');
    assert.ok(!perm(s, 't3'), 'entrada zera a permanência');
    assert.equal(s.teams.t3.stats.wins, 0);
    assert.equal(s.games.length, 1);
    assert.equal(s.games[0].scenario, 'WIN');
  });
});

suite('Rodízio e divisão — seção 14', () => {
  test('Exemplo de divisão: perdedor completa o antigo RE (2 jogadores) de baixo para cima', () => {
    let s = mkSession([5, 5, 5, 2]);
    const t2 = byPos(s, 't2'); // [pos1..pos5]
    const t4 = byPos(s, 't4'); // [pos1, pos2]
    s = R(s, 'A');
    assert.deepEqual(s.field, ['t1', 't3']);
    assert.equal(s.queue[0], 't4', 'antigo RE vira PRO');
    assert.deepEqual(byPos(s, 't4'), [t4[0], t4[1], t2[0], t2[1], t2[2]], 'pos. 1–3 do t2 ocupam as vagas 3–5 do t4');
    assert.deepEqual(byPos(s, 't5'), [t2[3], t2[4]], 'pos. 4–5 do t2 viram pos. 1–2 do novo time');
    assert.deepEqual(s.queue, ['t4', 't5']);
    assert.ok(!s.teams.t2, 'time perdedor desfeito');
  });

  test('Numeração posicional: Time 4 com pos. 1–3 recebe pos. 1–2 do Time 2 nas vagas 4–5; pos. 3–5 do Time 2 formam novo time', () => {
    let s = mkSession([5, 5, 5, 3]);
    const t2 = byPos(s, 't2'); // posições 1..5 do perdedor
    const t4 = byPos(s, 't4'); // posições 1..3 da equipe incompleta
    s = R(s, 'A'); // Time 1 vence; Time 2 cede jogadores
    const novo = s.queue[s.queue.length - 1];
    // 1) vagas abertas eram as posições 4 e 5; quem já estava não muda de posição
    assert.equal(s.teams.t4.line.length, 5);
    assert.equal(positionOf(s.teams.t4, t4[0]), 1);
    assert.equal(positionOf(s.teams.t4, t4[1]), 2);
    assert.equal(positionOf(s.teams.t4, t4[2]), 3);
    // 2) e 3) posição 1 do Time 2 → posição 4 do Time 4; posição 2 → posição 5
    assert.equal(positionOf(s.teams.t4, t2[0]), 4);
    assert.equal(positionOf(s.teams.t4, t2[1]), 5);
    assert.deepEqual(byPos(s, 't4'), [t4[0], t4[1], t4[2], t2[0], t2[1]]);
    // 4) posições 3, 4 e 5 do Time 2 formam o novo time como posições 1, 2 e 3
    assert.equal(novo, 't5');
    assert.equal(s.teams.t5.note, 'restante do Time 2');
    assert.equal(positionOf(s.teams.t5, t2[2]), 1);
    assert.equal(positionOf(s.teams.t5, t2[3]), 2);
    assert.equal(positionOf(s.teams.t5, t2[4]), 3);
    assert.deepEqual(byPos(s, 't5'), [t2[2], t2[3], t2[4]]);
    // fila: Time 3 entrou, Time 4 (agora completo) é PRO, novo time é RE
    assert.deepEqual(s.field, ['t1', 't3']);
    assert.deepEqual(s.queue, ['t4', 't5']);
    // registro descreve as vagas ocupadas
    assert.ok(s.games[0].moves[0].includes('as posições 4 a 5 de Time 4'), s.games[0].moves[0]);
  });

  test('Numeração posicional: uma única vaga (pos. 5) recebe a pos. 1 do perdedor', () => {
    let s = mkSession([5, 5, 5, 4]);
    const t2 = byPos(s, 't2');
    const t4 = byPos(s, 't4');
    s = R(s, 'A');
    assert.deepEqual(byPos(s, 't4'), [...t4, t2[0]]);
    assert.deepEqual(byPos(s, 't5'), [t2[1], t2[2], t2[3], t2[4]], 'pos. 2–5 viram 1–4');
    assert.ok(s.games[0].moves[0].includes('a posição 5 de Time 4'), s.games[0].moves[0]);
  });

  test('Numeração posicional em cadeia (saída dupla): cada perdedor preenche as vagas de cima', () => {
    let s = mkSession([5, 5, 5, 5, 2]);
    const t1 = byPos(s, 't1');
    const t2 = byPos(s, 't2');
    const t5 = byPos(s, 't5');
    s = R(s, 'draw', { tossWinner: 't1' }); // 1º jogo, PRO e RE completos → saem t1 e t2, nessa ordem
    // t1 completa o t5 (vagas 3–5) com suas posições 1–3; restante (pos. 4–5) forma t6
    assert.deepEqual(byPos(s, 't5'), [t5[0], t5[1], t1[0], t1[1], t1[2]]);
    // t2 completa o t6 (vagas 3–5) com suas posições 1–3; restante (pos. 4–5) forma t7
    assert.deepEqual(byPos(s, 't6'), [t1[3], t1[4], t2[0], t2[1], t2[2]]);
    assert.deepEqual(byPos(s, 't7'), [t2[3], t2[4]]);
    assert.deepEqual(s.queue, ['t5', 't6', 't7']);
  });

  test('Goleiro acompanha o bloco que completa equipe sem goleiro', () => {
    let s = mkSession([5, 5, 5, 1], { gks: [1, 1, 1, 0] });
    s = R(s, 'A');
    assert.deepEqual(s.teams.t4.gks, ['T2G1'], 'equipe completada recebe o goleiro');
    assert.equal(s.teams.t5.gks.length, 0);
    assert.equal(s.teams.t5.line.length, 1);
  });

  test('Não divide quando a última equipe da fila está completa', () => {
    let s = mkSession([5, 5, 5, 5]);
    const t2 = pids(s, 't2');
    s = R(s, 'A');
    assert.deepEqual(s.queue, ['t4', 't2']);
    assert.deepEqual(pids(s, 't2'), t2);
  });

  test('Perdedor completa equipe incompleta que vira PRO quando a fila só tem ela', () => {
    let s = mkSession([5, 5, 2]);
    s = R(s, 'A'); // t2 completa t3 (3 jogadores), resto (2) forma t4; t3 entra
    assert.deepEqual(s.field, ['t1', 't3']);
    assert.equal(s.teams.t3.line.length, 5);
    assert.deepEqual(s.queue, ['t4']);
    assert.equal(s.teams.t4.line.length, 2);
  });

  test('Vitória básica: vencedor fica, PRO entra, perdedor vai ao fim, fila avança', () => {
    let s = mkSession([5, 5, 5, 5, 5]);
    s = R(s, 'A');
    assert.deepEqual(s.field, ['t1', 't3']);
    assert.deepEqual(s.queue, ['t4', 't5', 't2']);
    assert.equal(queueLabel(s, 't4'), 'PRO');
    assert.equal(queueLabel(s, 't5'), 'RE');
    assert.equal(queueLabel(s, 't2'), 'TRI');
  });

  test('Total de jogadores preservado ao longo de vários jogos', () => {
    let s = mkSession([5, 5, 5, 3]);
    const total = s.active.length;
    const results = ['A', 'B', 'draw', 'A', 'draw', 'B', 'A', 'draw', 'draw', 'B'];
    for (const r of results) {
      const an = analyzeResult(s, r);
      s = R(s, r, an.needsToss ? { tossWinner: s.field[0] } : {});
      const count = Object.values(s.teams).reduce((a, t) => a + t.line.length + t.gks.length, 0);
      assert.equal(count, total);
    }
  });
});
