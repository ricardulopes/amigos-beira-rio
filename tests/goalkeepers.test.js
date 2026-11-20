// Goleiros: ordem de chegada, um goleiro por time (inclusive na fila) e rodízio (RN-134 a RN-137). Dados fictícios.
import { suite, test, assert } from './harness.js';
import { mkSession, mkPlayer, lateSnap } from './helpers.js';
import {
  prepareDraw, createSession, redraw, startSession, registerResult, addLatePlayer, removePlayer, moveGoalkeeperInLineup, validate,
  goalkeeperOrder, moveInGoalkeeperOrder, goalkeeperPreview, goalkeeperLineup, goalkeeperNote, balanceSummary, shareText,
  attendanceRecords, cycleCashback, setPayment, financeSettings, FIRST_CYCLE_ID,
} from '../src/domain/index.js';

const gkOf = (s, tid) => s.teams[tid]?.gks[0] || null;
const gkMap = (s, ids) => ids.map((id) => gkOf(s, id));
const gkSnap = (id) => lateSnap(id, { name: `Goleiro ${id.slice(1)}`, type: 'gk', positions: [] });

suite('Goleiros — chamada no sorteio e sorteio só de linha (RN-134)', () => {
  const line = Array.from({ length: 12 }, (_, i) => mkPlayer({ id: `L${i + 1}`, name: `Linha ${i + 1}` }));
  const gks = ['A', 'B', 'C'].map((n) => mkPlayer({ id: `g${n}`, name: `Goleiro ${n}`, type: 'gk', positions: [], stars: 3 }));
  const players = [...line, ...gks];
  const all = players.map((p) => p.id);

  test('Ordem de chegada: a definida na chamada; quem não está nela entra no fim, na ordem em que foi marcado', () => {
    assert.deepEqual(goalkeeperOrder(players, all, ['gC', 'gA']), ['gC', 'gA', 'gB']);
    assert.deepEqual(goalkeeperOrder(players, ['gB', 'L1', 'gA'], []), ['gB', 'gA'], 'sem ordem definida: ordem da marcação');
    assert.deepEqual(goalkeeperOrder(players, ['gA'], ['gC', 'gA']), ['gA'], 'goleiro desmarcado sai da ordem');
    assert.deepEqual(moveInGoalkeeperOrder(['gA', 'gB', 'gC'], 'gC', -1), ['gA', 'gC', 'gB']);
    assert.deepEqual(moveInGoalkeeperOrder(['gA', 'gB'], 'gA', -1), ['gA', 'gB'], 'o 1º não sobe mais');
  });

  test('Sorteio só de linha; 1º goleiro no Time 1, 2º no Time 2, 3º no Time 3; Time 4 aguarda goleiro', () => {
    const prep = prepareDraw({ players, selectedIds: all, config: { linePerTeam: 3, useGoalkeepers: false }, seed: 7, gkOrder: ['gC', 'gA'] });
    assert.ok(prep.draw.teams.every((t) => t.gks.length === 0 && t.line.every((x) => x.pid.startsWith('L'))), 'goleiro nunca no sorteio');
    assert.deepEqual(prep.gkOrder, ['gC', 'gA', 'gB']);
    const s = createSession({ title: 'T', config: prep.config, snapshots: prep.snapshots, draw: prep.draw, gkOrder: prep.gkOrder });
    assert.deepEqual(gkMap(s, ['t1', 't2', 't3', 't4']), ['gC', 'gA', 'gB', null]);
    assert.deepEqual(s.gkQueue, []);
    assert.deepEqual(balanceSummary(s).withoutGk, ['Time 4'], 'aviso: Time 4 aguardando goleiro');
    validate(s);
    const again = redraw(s, { draw: prepareDraw({ players, selectedIds: all, config: { linePerTeam: 3 }, seed: 9 }).draw });
    assert.deepEqual(goalkeeperLineup(again), ['gC', 'gA', 'gB'], 'novo sorteio mantém a ordem dos goleiros');
  });

  test('Prévia na chamada: 1º goleiro → Time 1, 2º → Time 2…; quem passa do número de times aguarda', () => {
    assert.deepEqual(goalkeeperPreview(['a', 'b', 'c'], 2).map((x) => [x.position, x.team]), [[1, 1], [2, 2], [3, null]]);
    assert.deepEqual(goalkeeperPreview([], 4), []);
  });

  test('Aviso dos goleiros', () => {
    assert.ok(/do Time 1 ao Time 3; 2 time\(s\) aguardando goleiro/.test(goalkeeperNote(3, 5)));
    assert.ok(/1 aguarda/.test(goalkeeperNote(4, 3)));
    assert.ok(/aguardando goleiro/.test(goalkeeperNote(0, 2)));
  });
});

suite('Goleiros — rodízio e atrasado (exemplo do dono: 5 times, 3 goleiros) (RN-135 a RN-137)', () => {
  test('Vencedor mantém o goleiro; o do perdedor vai para o 1º time sem goleiro; atrasado vai para o próximo sem goleiro', () => {
    let s = mkSession([5, 5, 5, 5, 5], { goalkeepers: 3 });
    assert.deepEqual(gkMap(s, ['t1', 't2', 't3', 't4', 't5']), ['G1', 'G2', 'G3', null, null]);
    let r = registerResult(s, 'A'); // Time 1 vence Time 2
    s = r.state;
    assert.deepEqual(s.field, ['t1', 't3']);
    assert.deepEqual(gkMap(s, ['t1', 't3', 't4', 't5', 't2']), ['G1', 'G3', 'G2', null, null], 'Goleiro 2 foi para o Time 4');
    assert.ok(/Goleiro 2 \(goleiro do Time 2\) foi para o Time 4/.test(r.explanation), r.explanation);
    r = addLatePlayer(s, gkSnap('G4'));
    s = r.state;
    assert.equal(gkOf(s, 't5'), 'G4', '4º goleiro atrasado vai para o Time 5');
    assert.ok(/foi para o gol do Time 5/.test(r.message));
    r = addLatePlayer(s, gkSnap('G5'));
    s = r.state;
    assert.equal(gkOf(s, 't2'), 'G5', 'o Time 2 (fim da fila) também estava sem goleiro');
    r = addLatePlayer(s, gkSnap('G6'));
    assert.deepEqual(r.state.gkQueue, ['G6'], 'todos com goleiro: aguarda no fim da fila de goleiros');
    assert.ok(/aguarda no fim da fila de goleiros/.test(r.message));
    validate(r.state);
  });

  test('Empate com saída dupla: os goleiros soltos vão para os primeiros times sem goleiro (campo, depois fila)', () => {
    let s = mkSession([5, 5, 5, 5], { goalkeepers: 3 });
    s = registerResult(s, 'draw').state; // 1º jogo com PRO e RE completos: saem os dois
    assert.deepEqual(s.field, ['t3', 't4']);
    assert.deepEqual(gkMap(s, ['t3', 't4', 't1', 't2']), ['G3', 'G1', 'G2', null]);
  });

  test('Empate em que o desafiante permanece: ele mantém o goleiro; com um goleiro por time, cada um fica no seu', () => {
    let s = mkSession([5, 5, 5], { goalkeepers: 3 });
    s = registerResult(s, 'A').state; // Time 1 vence; Goleiro 2 volta para o próprio Time 2 (único sem goleiro)
    assert.equal(gkOf(s, 't2'), 'G2');
    s = registerResult(s, 'draw').state; // Time 3 empata e permanece; Time 1 sai
    assert.ok(s.field.includes('t3') && !s.field.includes('t1'));
    assert.deepEqual(gkMap(s, ['t1', 't2', 't3']), ['G1', 'G2', 'G3']);
    validate(s);
  });

  test('Só 1 goleiro: vai para o primeiro time sem goleiro em campo (o que entrou no lugar do perdedor)', () => {
    let s = mkSession([5, 5, 5], { goalkeepers: 1 });
    assert.deepEqual(gkMap(s, ['t1', 't2', 't3']), ['G1', null, null]);
    s = registerResult(s, 'B').state; // Time 2 (sem goleiro) vence o Time 1; Time 3 entra no lugar do Time 1
    assert.deepEqual(s.field, ['t3', 't2']);
    assert.deepEqual(gkMap(s, ['t3', 't2', 't1']), ['G1', null, null], 'campo antes da fila, lado A antes do B');
  });

  test('Mais goleiros que times: quem aguardava entra primeiro; o goleiro de quem perdeu aguarda', () => {
    let s = mkSession([5, 5], { goalkeepers: 3 });
    assert.deepEqual(s.gkQueue, ['G3']);
    const r = registerResult(s, 'A');
    s = r.state;
    assert.equal(gkOf(s, 't2'), 'G3');
    assert.deepEqual(s.gkQueue, ['G2']);
    assert.ok(/Goleiro 3, que aguardava, foi para o Time 2/.test(r.explanation), r.explanation);
  });
});

suite('Goleiros — lesão, ajuste manual e integridade (RN-137)', () => {
  test('Goleiro machucado: quem aguarda time assume; sem ninguém aguardando, o time fica sem goleiro', () => {
    let r = removePlayer(mkSession([5, 5, 5], { goalkeepers: 4 }), 'G1', 'injury');
    assert.equal(gkOf(r.state, 't1'), 'G4');
    assert.ok(/Goleiro 4 \(que aguardava time\) assumiu o gol do Time 1/.test(r.message), r.message);
    r = removePlayer(mkSession([5, 5, 5], { goalkeepers: 3 }), 'G3', 'early');
    assert.equal(gkOf(r.state, 't3'), null);
    assert.ok(/fica sem goleiro/.test(r.message));
    validate(r.state);
  });

  test('Admin reordena: os goleiros trocam de time sem criar nem tirar vaga', () => {
    let s = mkSession([5, 5, 5, 5, 5], { goalkeepers: 3 });
    s = moveGoalkeeperInLineup(s, 'G3', 1).state;
    assert.deepEqual(gkMap(s, ['t1', 't2', 't3', 't4']), ['G3', 'G1', 'G2', null]);
    s = moveGoalkeeperInLineup(s, 'G3', 'end').state;
    assert.deepEqual(gkMap(s, ['t1', 't2', 't3', 't4']), ['G1', 'G2', 'G3', null]);
  });

  test('Integridade: dois goleiros no mesmo time é recusado', () => {
    const a = mkSession([5, 5, 5, 5], { goalkeepers: 3 });
    a.teams.t1.gks.push('G3');
    a.teams.t3.gks = [];
    assert.throws(() => validate(a), /mais de um goleiro/);
  });

  test('Rascunho no formato anterior (goleiro aguardando, Time 3 sem goleiro) é aceito e corrigido ao iniciar', () => {
    const old = mkSession([5, 5, 5, 3], { goalkeepers: 3 });
    old.status = 'draft';
    old.teams.t3.gks = [];
    old.gkQueue = ['G3'];
    validate(old); // não trava pagamentos nem a abertura
    const live = startSession(old);
    assert.deepEqual(gkMap(live, ['t1', 't2', 't3', 't4']), ['G1', 'G2', 'G3', null]);
    assert.deepEqual(live.gkQueue, []);
    assert.equal(setPayment(old, 'T1P1', 'pix').state.payments.T1P1, 'pix', 'pagamento funciona no rascunho antigo');
  });

  test('WhatsApp mostra o goleiro de cada time e quem aguarda goleiro', () => {
    const txt = shareText(mkSession([5, 5, 5, 5], { goalkeepers: 3 }), { includeStars: false, includeOrder: false });
    assert.ok(/🧤 Goleiro 3/.test(txt));
    assert.ok(/aguardando goleiro/.test(txt));
  });
});

suite('Goleiros — presença e financeiro (RN-118 a RN-120, reforço)', () => {
  test('Goleiro conta presença e nunca gera R$ 3, mesmo marcado como pago', () => {
    const s = { ...mkSession([5, 5], { goalkeepers: 3 }), status: 'finished', startedAt: '2026-11-20T09:00:00' };
    s.payments = { G1: 'pix' }; // dado forçado: a tela nem permite
    const recs = attendanceRecords([s]).filter((r) => r.type === 'gk');
    assert.deepEqual(recs.map((r) => r.pid).sort(), ['G1', 'G2', 'G3'], 'os 3 goleiros têm presença (ranking Top 4), inclusive quem aguardou');
    assert.ok(recs.every((r) => !r.credited));
    assert.equal(cycleCashback('G1', [s], financeSettings({}), FIRST_CYCLE_ID).total, 0, 'cashback do goleiro só por aportes');
    assert.throws(() => setPayment(mkSession([5, 5], { goalkeepers: 2 }), 'G1', 'cash'), /isento/);
  });
});
