// Goleiros: ordem de chegada, fila própria e rodízio isolado (RN-134 a RN-137). Dados fictícios de teste.
import { suite, test, assert } from './harness.js';
import { mkSession, mkPlayer, lateSnap } from './helpers.js';
import {
  prepareDraw, createSession, redraw, registerResult, addLatePlayer, removePlayer, moveGoalkeeperInLineup, validate,
  goalkeeperOrder, moveInGoalkeeperOrder, goalkeeperLineup, goalkeeperNote, balanceSummary, shareText,
  attendanceRecords, cycleCashback, setPayment, financeSettings, FIRST_CYCLE_ID,
} from '../src/domain/index.js';

const gkOf = (s, tid) => s.teams[tid].gks[0] || null;

suite('Goleiros — ordem de chegada e sorteio só de linha (RN-134)', () => {
  const line = Array.from({ length: 12 }, (_, i) => mkPlayer({ id: `L${i + 1}`, name: `Linha ${i + 1}` }));
  const gks = ['A', 'B', 'C'].map((n) => mkPlayer({ id: `g${n}`, name: `Goleiro ${n}`, type: 'gk', positions: [], stars: 3 }));
  const players = [...line, ...gks];
  const all = players.map((p) => p.id);

  test('Ordem do dia: a definida pelo admin; quem não está nela entra no fim, na ordem em que foi marcado', () => {
    assert.deepEqual(goalkeeperOrder(players, all, ['gC', 'gA']), ['gC', 'gA', 'gB']);
    assert.deepEqual(goalkeeperOrder(players, ['gB', 'L1', 'gA'], []), ['gB', 'gA'], 'sem ordem definida: ordem da marcação');
    assert.deepEqual(goalkeeperOrder(players, ['gA'], ['gC', 'gA']), ['gA'], 'goleiro desmarcado sai da ordem');
    assert.deepEqual(moveInGoalkeeperOrder(['gA', 'gB', 'gC'], 'gC', -1), ['gA', 'gC', 'gB']);
    assert.deepEqual(moveInGoalkeeperOrder(['gA', 'gB'], 'gA', -1), ['gA', 'gB'], 'o 1º não sobe mais');
  });

  test('Sorteio nunca mistura goleiros na linha; 1º goleiro no Time 1, 2º no Time 2, o resto aguarda', () => {
    const prep = prepareDraw({ players, selectedIds: all, config: { linePerTeam: 4, useGoalkeepers: false }, seed: 7, gkOrder: ['gC', 'gA'] });
    assert.ok(prep.draw.teams.every((t) => t.gks.length === 0 && t.line.every((x) => x.pid.startsWith('L'))), 'só linha no sorteio');
    assert.deepEqual(prep.gkOrder, ['gC', 'gA', 'gB']);
    assert.equal(prep.config.useGoalkeepers, true, 'opção antiga ignorada: goleiros sempre pela fila');
    const s = createSession({ title: 'T', config: prep.config, snapshots: prep.snapshots, draw: prep.draw, gkOrder: prep.gkOrder });
    assert.equal(gkOf(s, s.field[0]), 'gC');
    assert.equal(gkOf(s, s.field[1]), 'gA');
    assert.deepEqual(s.gkQueue, ['gB']);
    assert.ok(s.queue.every((id) => !s.teams[id].gks.length), 'times da fila não têm goleiro');
    assert.ok(s.active.includes('gB'), 'goleiro da fila participa da pelada');
    validate(s);
    const again = redraw(s, { draw: prepareDraw({ players, selectedIds: all, config: { linePerTeam: 4 }, seed: 9 }).draw });
    assert.deepEqual(goalkeeperLineup(again), ['gC', 'gA', 'gB'], 'novo sorteio mantém a ordem dos goleiros');
  });

  test('Aviso dos goleiros na tela de presença', () => {
    assert.ok(/1 goleiro/.test(goalkeeperNote(1, 3)));
    assert.ok(/1 aguarda/.test(goalkeeperNote(3, 4)));
    assert.ok(/sem goleiro/.test(goalkeeperNote(0, 2)));
  });
});

suite('Goleiros — rodízio isolado (RN-135, RN-136)', () => {
  test('Vitória: o goleiro do vencedor fica; o do perdedor vai para o fim da fila; o próximo assume quem entra (5 times, 3 goleiros)', () => {
    let s = mkSession([5, 5, 5, 5, 5], { goalkeepers: 3 });
    assert.deepEqual([gkOf(s, 't1'), gkOf(s, 't2'), s.gkQueue], ['G1', 'G2', ['G3']]);
    let r = registerResult(s, 'A'); // Time 1 vence Time 2
    s = r.state;
    assert.deepEqual(s.field, ['t1', 't3']);
    assert.equal(gkOf(s, 't1'), 'G1', 'vencedor mantém o goleiro');
    assert.equal(gkOf(s, 't3'), 'G3', 'o 1º da fila assume o time que entrou');
    assert.deepEqual(s.gkQueue, ['G2'], 'goleiro do perdedor no fim da fila');
    assert.equal(s.teams.t2.gks.length, 0, 'time que saiu fica sem goleiro na fila');
    assert.ok(/Goleiro 2 \(Time 2\) vai para o fim da fila de goleiros; Goleiro 3 assume o gol do Time 3/.test(r.explanation), r.explanation);
    r = registerResult(s, 'B'); // Time 3 vence Time 1
    s = r.state;
    assert.deepEqual([gkOf(s, 't3'), gkOf(s, 't4'), s.gkQueue], ['G3', 'G2', ['G1']], 'a fila de goleiros gira na própria ordem');
    validate(s);
    assert.deepEqual(s.games[1].teamA.gks.map((g) => g.pid), ['G1'], 'o registro do jogo guarda quem defendeu cada time');
  });

  test('Empate com saída dupla: os dois goleiros vão para o fim da fila (slot A antes do B)', () => {
    let s = mkSession([5, 5, 5, 5], { goalkeepers: 3 });
    s = registerResult(s, 'draw').state; // 1º jogo com PRO e RE completos: saem os dois
    assert.deepEqual(s.field, ['t3', 't4']);
    assert.deepEqual([gkOf(s, 't3'), gkOf(s, 't4'), s.gkQueue], ['G3', 'G1', ['G2']]);
  });

  test('Empate em que um time permanece: ele mantém o goleiro; o goleiro de quem sai vai para o fim da fila', () => {
    let s = mkSession([5, 5, 5], { goalkeepers: 3 });
    s = registerResult(s, 'A').state; // t1 (G1) vence t2; t3 entra com G3; fila de goleiros: G2
    s = registerResult(s, 'draw').state; // desafiante (t3) empata e permanece; t1 sai
    assert.ok(s.field.includes('t3') && !s.field.includes('t1'));
    assert.equal(gkOf(s, 't3'), 'G3', 'quem permanece fica com o mesmo goleiro');
    assert.equal(gkOf(s, 't2'), 'G2', 'quem entra recebe o 1º da fila de goleiros');
    assert.deepEqual(s.gkQueue, ['G1'], 'goleiro de quem saiu no fim da fila');
    assert.equal(s.teams.t1.gks.length, 0);
    validate(s);
  });

  test('Só 1 goleiro: ele acompanha o campo (vai para o fim da fila e volta logo para o time que entra)', () => {
    let s = mkSession([5, 5, 5], { goalkeepers: 1 });
    assert.deepEqual([gkOf(s, 't1'), gkOf(s, 't2')], ['G1', null]);
    s = registerResult(s, 'B').state; // Time 2 (sem goleiro) vence; Time 1 sai
    assert.equal(gkOf(s, 't2'), null);
    assert.equal(gkOf(s, 't3'), 'G1', 'o único goleiro assume o time que entrou');
    assert.deepEqual(s.gkQueue, []);
    assert.deepEqual(balanceSummary(s).withoutGk, ['Time 2'], 'aviso só para time em campo sem goleiro');
  });
});

suite('Goleiros — atrasado, lesão e ajuste manual (RN-137)', () => {
  test('Goleiro atrasado vai para o fim da fila; se um time em campo está sem goleiro, assume na hora', () => {
    let s = mkSession([5, 5, 5], { goalkeepers: 3 });
    let r = addLatePlayer(s, lateSnap('G9', { name: 'Atrasado', type: 'gk', positions: [] }));
    assert.deepEqual(r.state.gkQueue, ['G3', 'G9']);
    assert.ok(/fim da fila de goleiros \(2º da fila\)/.test(r.message));
    s = mkSession([5, 5, 5], { goalkeepers: 1 });
    r = addLatePlayer(s, lateSnap('G9', { name: 'Atrasado', type: 'gk', positions: [] }));
    assert.equal(gkOf(r.state, 't2'), 'G9', 'Time 2 estava sem goleiro');
    assert.ok(/assumiu o gol do Time 2/.test(r.message));
  });

  test('Goleiro em campo machucado: o 1º da fila assume; sem ninguém na fila, o time fica sem goleiro', () => {
    let s = mkSession([5, 5, 5], { goalkeepers: 3 });
    let r = removePlayer(s, 'G1', 'injury');
    assert.equal(gkOf(r.state, 't1'), 'G3');
    assert.deepEqual(r.state.gkQueue, []);
    assert.ok(/Goleiro 3 \(1º da fila de goleiros\) assumiu o gol do Time 1/.test(r.message), r.message);
    r = removePlayer(r.state, 'G2', 'early');
    assert.equal(gkOf(r.state, 't2'), null);
    assert.ok(/fica sem goleiro/.test(r.message));
    s = mkSession([5, 5, 5], { goalkeepers: 3 });
    r = removePlayer(s, 'G3', 'early');
    assert.deepEqual(r.state.gkQueue, [], 'goleiro da fila só sai da fila');
    assert.equal(r.state.removed[0].teamLabel, 'fila de goleiros');
    validate(r.state);
  });

  test('Admin reordena os goleiros: os dois primeiros ficam no gol, os demais na fila; "fim da fila"', () => {
    let s = mkSession([5, 5, 5], { goalkeepers: 3 });
    s = moveGoalkeeperInLineup(s, 'G3', 1).state;
    assert.deepEqual([gkOf(s, 't1'), gkOf(s, 't2'), s.gkQueue], ['G3', 'G1', ['G2']]);
    s = moveGoalkeeperInLineup(s, 'G3', 'end').state;
    assert.deepEqual([gkOf(s, 't1'), gkOf(s, 't2'), s.gkQueue], ['G1', 'G2', ['G3']]);
  });

  test('Integridade: time da fila com goleiro é recusado', () => {
    const s = mkSession([5, 5, 5], { goalkeepers: 3 });
    s.teams.t3.gks = ['G3'];
    s.gkQueue = [];
    assert.throws(() => validate(s), /na fila com goleiro/);
  });

  test('WhatsApp lista a fila de goleiros', () => {
    const s = mkSession([5, 5, 5], { goalkeepers: 3 });
    assert.ok(/FILA DE GOLEIROS:\* 1º Goleiro 3/.test(shareText(s, { includeStars: false, includeOrder: false })));
  });
});

suite('Goleiros — presença e financeiro (RN-118 a RN-120, reforço)', () => {
  test('Goleiro conta presença (inclusive quem só esperou na fila) e nunca gera R$ 3, mesmo marcado como pago', () => {
    const s = { ...mkSession([5, 5, 5], { goalkeepers: 3 }), status: 'finished', startedAt: '2026-11-20T09:00:00' };
    s.payments = { G1: 'pix' }; // dado forçado: a tela nem permite
    const recs = attendanceRecords([s]).filter((r) => r.type === 'gk');
    assert.deepEqual(recs.map((r) => r.pid).sort(), ['G1', 'G2', 'G3'], 'os 3 goleiros têm presença (ranking Top 4)');
    assert.ok(recs.every((r) => !r.credited));
    assert.equal(cycleCashback('G1', [s], financeSettings({}), FIRST_CYCLE_ID).total, 0, 'cashback do goleiro só por aportes');
    assert.throws(() => setPayment(mkSession([5, 5], { goalkeepers: 2 }), 'G1', 'cash'), /isento/);
  });
});
