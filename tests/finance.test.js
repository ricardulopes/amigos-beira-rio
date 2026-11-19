// Financeiro: presenças, cashback, pagamentos do dia, aportes, rankings por ciclo, Pix e reset (RN-118 a RN-128).
// Dados fictícios de teste. Datas sem "Z" (hora local) para não depender do fuso.
import { suite, test, assert } from './harness.js';
import { mkSession } from './helpers.js';
import {
  FINANCE_RULES, formatMoney, parseMoney, financeSettings, setPixConfig, setPixQr, attendanceRecords, cyclesAvailable,
  cycleRanking, cycleCashback, statement, groupCashback, paymentSummary, setPayment, addContribution, removeContribution,
  resetPreview, resetCycle, validate, cycleList, currentCycle, closeCycle, startCycle, suggestCycleLabel, FIRST_CYCLE_ID, NEXT_CYCLE,
} from '../src/domain/index.js';

/** Fecha o ciclo aberto e abre outro (datas explícitas). */
const turn = (f, end, start, label, resetCashback = false) => startCycle(closeCycle(f, {}, end).finance, { label, resetCashback }, start).finance;

const L = (id, name = id) => ({ id, name, stars: 2, type: 'line', positions: ['M'] });
const G = (id, name = id) => ({ id, name, stars: 2, type: 'gk', positions: [] });
const pel = (id, date, players, { status = 'finished', payments } = {}) => ({
  id, title: `Pelada ${id}`, status, createdAt: date, startedAt: status === 'draft' ? null : date,
  snapshot: Object.fromEntries(players.map((p) => [p.id, p])), ...(payments ? { payments } : {}),
});
const fin = (contributions = []) => ({ ...financeSettings({}), contributions });

suite('Financeiro — dinheiro e configuração', () => {
  test('Valores em centavos: formatação e leitura do que o admin digita', () => {
    assert.equal(formatMoney(123456), 'R$ 1.234,56');
    assert.equal(formatMoney(300), 'R$ 3,00');
    assert.equal(parseMoney('30'), 3000);
    assert.equal(parseMoney('30,50'), 3050);
    assert.equal(parseMoney('R$ 1.234,56'), 123456);
    assert.equal(parseMoney('30.5'), 3050);
    assert.equal(parseMoney('1.000'), 100000);
    assert.throws(() => parseMoney(''), /Informe/);
    assert.throws(() => parseMoney('abc'), /inválido/);
    assert.throws(() => parseMoney('0'), /maior que zero/);
    assert.throws(() => parseMoney('20000'), /limite/);
  });

  test('Regras de custo: R$ 18 = R$ 15 operacional + R$ 3 de cashback; festa R$ 300; Top 32 e Top 4', () => {
    assert.equal(FINANCE_RULES.lineFee, FINANCE_RULES.operational + FINANCE_RULES.cashbackPerGame);
    assert.equal(FINANCE_RULES.lineFee, 1800);
    assert.equal(FINANCE_RULES.partyFee, 30000);
    assert.equal(FINANCE_RULES.topLine, 32);
    assert.equal(FINANCE_RULES.topGk, 4);
  });

  test('Modo teste fica ligado até o primeiro "zerar"; padrões vazios', () => {
    const f = financeSettings({});
    assert.equal(f.mode, 'test');
    assert.deepEqual(f.contributions, []);
    assert.equal(financeSettings({ finance: { mode: 'official' } }).mode, 'official');
  });

  test('RN-125: chave Pix, recebedor, "Copia e Cola" e QR Code validados', () => {
    const f = setPixConfig(fin(), { pixKey: ' tesouraria@abr.com ', pixName: 'ABR', pixCopyPaste: '000201 0102ab' });
    assert.equal(f.pixKey, 'tesouraria@abr.com');
    assert.equal(f.pixCopyPaste, '0002010102ab', 'espaços e quebras de linha removidos');
    assert.throws(() => setPixConfig(fin(), { pixCopyPaste: 'abc' }), /000201/);
    assert.throws(() => setPixConfig(fin(), { pixKey: 'x'.repeat(78) }), /77/);
    assert.equal(setPixQr(fin(), 'data:image/png;base64,iVBORw0KGgo=').qrImage, 'data:image/png;base64,iVBORw0KGgo=');
    assert.equal(setPixQr(fin(), '').qrImage, '');
    assert.throws(() => setPixQr(fin(), 'javascript:alert(1)'), /inválida/);
    assert.throws(() => setPixQr(fin(), 'data:image/png;base64,' + 'A'.repeat(400000)), /grande/);
  });
});

suite('Financeiro — presenças e rankings por ciclo', () => {
  test('RN-118: só pelada iniciada conta presença; o tipo vem do snapshot daquela pelada', () => {
    const s = [
      pel('a', '2026-08-02T09:00:00', [L('wender', 'Wender'), L('x')]),
      pel('b', '2026-08-09T09:00:00', [G('wender', 'Wender'), L('x')], { status: 'live' }),
      pel('c', '2026-08-16T09:00:00', [L('wender', 'Wender'), L('x')], { status: 'draft' }),
    ];
    const recs = attendanceRecords(s).filter((r) => r.pid === 'wender');
    assert.equal(recs.length, 2, 'rascunho (sorteio não iniciado) não conta');
    assert.deepEqual(recs.map((r) => r.type), ['line', 'gk'], 'mesmo atleta: uma vez na linha, outra no gol');
  });

  test('RN-128: sem ciclo cadastrado há um 1º ciclo aberto; o ranking não depende do calendário', () => {
    const f = fin();
    assert.deepEqual(cycleList(f).map((c) => [c.id, c.open]), [[FIRST_CYCLE_ID, true]]);
    const s = [pel('a', '2026-06-28T09:00:00', [L('erik', 'Erik')]), pel('b', '2026-07-05T09:00:00', [L('erik', 'Erik')])];
    const r = cycleRanking(s, f, FIRST_CYCLE_ID, 'line');
    assert.equal(r.total, 2, 'junho e julho no mesmo ciclo: a virada do semestre não zera mais nada sozinha');
    assert.deepEqual(r.rows.map((x) => x.count), [2]);
    assert.equal(suggestCycleLabel('2026-12-10T10:00:00'), '1º semestre de 2027');
  });

  test('RN-128: encerrar e iniciar ciclo manualmente; o ciclo encerrado continua consultável', () => {
    let f = fin();
    f = closeCycle(f, { label: '2º semestre de 2026' }, '2026-11-20T12:00:00').finance;
    assert.equal(currentCycle(f), null, 'na folga não há ciclo aberto');
    assert.throws(() => closeCycle(f, {}, '2026-11-21T12:00:00'), /Não há ciclo aberto/);
    assert.throws(() => startCycle(f, { label: '2º semestre de 2026' }, '2027-01-05T08:00:00'), /mesmo nome|Já existe/);
    assert.throws(() => startCycle(f, { label: '' }, '2027-01-05T08:00:00'), /nome/);
    assert.throws(() => startCycle(f, { label: 'Antes' }, '2026-11-19T08:00:00'), /depois do encerramento/);
    f = startCycle(f, { label: '1º semestre de 2027' }, '2027-01-05T08:00:00').finance;
    assert.throws(() => startCycle(f, { label: 'Outro' }, '2027-01-06T08:00:00'), /Encerre o ciclo atual/);
    assert.equal(currentCycle(f).label, '1º semestre de 2027');
    const s = [
      pel('a', '2026-11-15T09:00:00', [L('erik', 'Erik'), L('joao', 'João')]), // antes do encerramento
      pel('b', '2026-11-29T09:00:00', [L('erik', 'Erik')]), // na folga: conta no próximo ciclo
      pel('c', '2027-01-10T09:00:00', [L('joao', 'João')]),
    ];
    const [novo, velho] = cyclesAvailable(s, f);
    assert.equal(novo.label, '1º semestre de 2027', 'mais recente primeiro');
    const r1 = cycleRanking(s, f, velho.id, 'line');
    const r2 = cycleRanking(s, f, novo.id, 'line');
    assert.equal(r1.total, 1);
    assert.deepEqual(r1.rows.map((x) => x.name), ['Erik', 'João'], 'ranking do ciclo encerrado guardado para o campeonato');
    assert.equal(r2.total, 2, 'a pelada da folga entrou no ciclo novo');
    assert.deepEqual(r2.rows.map((x) => [x.name, x.count]), [['Erik', 1], ['João', 1]]);
    assert.equal(r1.cycle.end, '2026-11-20T12:00:00');
  });

  test('RN-128: pelada na folga aparece como "próximo ciclo" até o admin iniciá-lo', () => {
    const f = closeCycle(fin(), {}, '2026-11-20T12:00:00').finance;
    const s = [pel('a', '2026-11-15T09:00:00', [L('x')]), pel('b', '2026-11-29T09:00:00', [L('x'), L('y')])];
    const list = cyclesAvailable(s, f);
    assert.deepEqual(list.map((c) => c.id), [NEXT_CYCLE, FIRST_CYCLE_ID]);
    assert.equal(cycleRanking(s, f, NEXT_CYCLE, 'line').total, 1);
    assert.equal(cycleRanking(s, f, FIRST_CYCLE_ID, 'line').total, 1);
    assert.deepEqual(attendanceRecords(s, f).map((r) => r.cycleId), [FIRST_CYCLE_ID, NEXT_CYCLE, NEXT_CYCLE]);
  });

  test('RN-122: Top 32 na linha e Top 4 no gol têm vaga; empates por ordem alfabética; aviso de empate no corte', () => {
    const lines = Array.from({ length: 35 }, (_, i) => L(`l${String(i + 1).padStart(2, '0')}`));
    const gks = ['Bruno', 'Ana', 'Caio', 'Davi', 'Eli'].map((n) => G(n.toLowerCase(), n));
    const s = [
      pel('a', '2026-08-02T09:00:00', [...lines, ...gks]),
      pel('b', '2026-08-09T09:00:00', [...lines.slice(0, 32), ...gks.slice(0, 3)]),
    ];
    const rl = cycleRanking(s, fin(), FIRST_CYCLE_ID, 'line');
    assert.equal(rl.rows.length, 35);
    assert.equal(rl.rows.filter((r) => r.qualified).length, 32);
    assert.ok(rl.rows.slice(0, 32).every((r) => r.count === 2) && !rl.cutTie, 'os 32 com 2 presenças ficam dentro');
    assert.ok(rl.rows.every((r) => r.pid.startsWith('l')), 'linha não mistura goleiros');
    const rg = cycleRanking(s, fin(), FIRST_CYCLE_ID, 'gk');
    assert.deepEqual(rg.rows.map((r) => r.name), ['Ana', 'Bruno', 'Caio', 'Davi', 'Eli'], 'empate em 2 (Ana, Bruno, Caio) por nome');
    assert.deepEqual(rg.rows.map((r) => r.qualified), [true, true, true, true, false]);
    assert.ok(rg.cutTie, 'Davi e Eli empatados na linha de corte');
    assert.equal(rg.rows[0].pct, 100);
  });
});

suite('Financeiro — cashback, extrato e aportes', () => {
  test('RN-120/RN-128: linha soma R$ 3 por presença; goleiro só por aportes; zera só quando o admin manda', () => {
    const s = [
      pel('a', '2025-12-20T09:00:00', [L('rog', 'Rogério')]),
      pel('b', '2026-01-10T09:00:00', [L('rog', 'Rogério'), G('jp', 'JP')]),
      pel('c', '2026-08-10T09:00:00', [L('rog', 'Rogério'), G('jp', 'JP')]),
    ];
    let f = fin();
    f = addContribution(f, { pid: 'jp', name: 'JP', amount: '50,00', at: '2025-11-01T10:00:00' }).finance;
    f = addContribution(f, { pid: 'jp', name: 'JP', amount: '30', at: '2026-09-01T10:00:00' }).finance;
    assert.equal(cycleCashback('rog', s, f, FIRST_CYCLE_ID).total, 900, 'virada do ano não zera sozinha');
    // fecha em 2025 e inicia 2026 zerando o cashback (novo ano da festa); 1º → 2º semestre sem zerar
    f = turn(f, '2026-01-01T00:00:00', '2026-01-02T00:00:00', '1º semestre de 2026', true);
    f = turn(f, '2026-07-01T00:00:00', '2026-07-02T00:00:00', '2º semestre de 2026', false);
    const cur = currentCycle(f).id;
    const r = cycleCashback('rog', s, f, cur);
    assert.equal(r.lineGames, 2);
    assert.equal(r.total, 600, 'presença de antes do "zerar cashback" não entra');
    assert.equal(r.sinceLabel, '1º semestre de 2026', 'cashback soma desde o ciclo que zerou');
    assert.equal(r.partyRemaining, 29400);
    assert.equal(cycleCashback('rog', s, f, FIRST_CYCLE_ID).total, 300,'ciclo antigo guarda o próprio cashback para o acerto');
    const g = cycleCashback('jp', s, f, cur);
    assert.equal(g.gkGames, 2);
    assert.equal(g.lineCents, 0, 'goleiro não acumula R$ 3 por jogo');
    assert.equal(g.total, 3000, 'só o aporte do período atual');
    assert.equal(groupCashback(s, f, cur).total, 600 + 3000);
    const st = statement('rog', s, f);
    assert.equal(st.previousCashback.total, 300, 'extrato mostra o cashback do período zerado, para o acerto da festa');
    assert.equal(statement('rog', s, fin()).previousCashback, null);
  });

  test('RN-123: festa de R$ 300 — paga só a diferença; quitada quando o cashback chega a R$ 300', () => {
    const many = Array.from({ length: 100 }, (_, i) => pel(`p${i}`, `2026-0${1 + (i % 9)}-0${1 + (i % 9)}T09:00:00`, [L('erik', 'Erik')]));
    const r = cycleCashback('erik', many, fin(), FIRST_CYCLE_ID);
    assert.equal(r.total, 30000);
    assert.ok(r.partyPaid);
    assert.equal(r.partyRemaining, 0);
  });

  test('RN-124/RN-128: na folga o extrato mostra o ciclo encerrado e avisa o que vai para o próximo', () => {
    const s = [pel('a', '2026-11-15T09:00:00', [L('erik', 'Erik')]), pel('b', '2026-11-29T09:00:00', [L('erik', 'Erik')])];
    const f = closeCycle(fin(), { label: '2º semestre de 2026' }, '2026-11-20T12:00:00').finance;
    const st = statement('erik', s, f);
    assert.equal(st.cycle.label, '2º semestre de 2026');
    assert.deepEqual([st.cycle.total, st.cycle.line], [1, 1]);
    assert.equal(st.cashback.total, 300);
    assert.equal(st.waiting, 1, 'pelada da folga aguarda o próximo ciclo');
  });

  test('RN-124: extrato traz frequência do ciclo, cashback, pendências e lançamentos', () => {
    const s = [
      pel('a', '2026-08-02T09:00:00', [L('erik', 'Erik'), L('x')], { payments: { erik: 'pix' } }),
      pel('b', '2026-08-09T09:00:00', [L('x')]),
      pel('c', '2026-08-16T09:00:00', [G('erik', 'Erik'), L('x')]),
      pel('d', '2026-08-23T09:00:00', [L('erik', 'Erik'), L('x')]),
    ];
    const f = addContribution(fin(), { pid: 'erik', name: 'Erik', amount: '10', note: 'Aporte', at: '2026-08-24T10:00:00' }).finance;
    const st = statement('erik', s, f);
    assert.equal(st.name, 'Erik');
    assert.deepEqual([st.cycle.total, st.cycle.line, st.cycle.gk, st.cycle.linePct], [4, 2, 1, 50]);
    assert.equal(st.waiting, 0);
    assert.equal(st.cashback.total, 2 * 300 + 1000);
    assert.equal(st.pending, 1, 'pelada "d" sem pagamento registrado');
    assert.equal(st.entries.length, 4);
    assert.equal(st.entries[0].kind, 'contribution', 'mais recente primeiro');
  });

  test('Aportes: valida atleta, valor e observação; remove pelo id', () => {
    assert.throws(() => addContribution(fin(), { pid: '', amount: '10' }), /atleta/);
    assert.throws(() => addContribution(fin(), { pid: 'a', amount: '-5' }), /inválido/);
    assert.throws(() => addContribution(fin(), { pid: 'a', amount: '5', note: 'x'.repeat(81) }), /80/);
    const { finance, message } = addContribution(fin(), { pid: 'a', name: 'Ana', amount: '30', id: 'c1' });
    assert.ok(/R\$ 30,00/.test(message));
    assert.equal(removeContribution(finance, 'c1').contributions.length, 0);
    assert.throws(() => removeContribution(finance, 'zz'), /não encontrado/);
  });
});

suite('Financeiro — pagamentos do dia e reset', () => {
  test('RN-119: pagamento por Pix/Cartão/Isento é comando puro; goleiro isento por padrão e não paga taxa', () => {
    const s = mkSession([5, 5], { gks: [1, 0] });
    const pid = s.teams.t1.line[0].pid;
    const { state } = setPayment(s, pid, 'pix');
    assert.equal(state.payments[pid], 'pix');
    assert.equal(s.payments, undefined, 'o estado recebido não muda');
    validate(state);
    assert.throws(() => setPayment(s, 'T1G1', 'pix'), /isento/);
    assert.throws(() => setPayment(s, 'ninguem', 'pix'), /não participou/);
    assert.throws(() => setPayment(s, pid, 'boleto'), /inválida/);
    assert.equal(setPayment(state, pid, null).state.payments[pid], undefined, 'limpar volta a pendente');
  });

  test('RN-119: resumo do caixa do dia — R$ 18 por pagante (R$ 15 + R$ 3), isentos e pendentes', () => {
    let s = mkSession([5, 5], { gks: [1, 1] });
    const ids = Object.values(s.snapshot).filter((p) => p.type === 'line').map((p) => p.id);
    s = setPayment(s, ids[0], 'pix').state;
    s = setPayment(s, ids[1], 'pix').state;
    s = setPayment(s, ids[2], 'card').state;
    s = setPayment(s, ids[3], 'exempt').state;
    const p = paymentSummary(s);
    assert.deepEqual([p.pix, p.card, p.pending, p.exempt], [2, 1, 6, 1 + 2]);
    assert.equal(p.collected, 3 * 1800);
    assert.equal(p.operational, 3 * 1500);
    assert.equal(p.cashbackRetained, 3 * 300);
    assert.equal(p.expected, 9 * 1800, 'linha isenta não entra no esperado');
    assert.equal(p.rows.find((r) => r.pid === 'T1G1').method, 'exempt');
  });

  test('RN-127: zerar apaga peladas e aportes, mantém Pix e cadastro, e inicia o ciclo oficial', () => {
    const s = [pel('a', '2026-08-02T09:00:00', [L('x')]), pel('b', '2026-08-09T09:00:00', [L('x')], { status: 'draft' })];
    let f = setPixConfig(fin(), { pixKey: 'chave' });
    f = addContribution(f, { pid: 'x', amount: '30' }).finance;
    assert.deepEqual(resetPreview(s, f), { peladas: 2, started: 1, contributions: 1, live: false });
    const r = resetCycle({ sessions: s, finance: f }, '2027-01-01T00:00:00');
    assert.deepEqual(r.sessions, []);
    assert.deepEqual(r.finance.contributions, []);
    assert.equal(r.finance.pixKey, 'chave');
    assert.equal(r.finance.mode, 'official');
    assert.equal(r.finance.cycleStart, '2027-01-01T00:00:00');
    assert.deepEqual(cycleList(r.finance).map((c) => [c.id, c.start, c.open]), [[FIRST_CYCLE_ID, '2027-01-01T00:00:00', true]], 'ciclos voltam ao 1º');
    assert.throws(() => resetCycle({ sessions: [pel('c', '2026-08-02T09:00:00', [L('x')], { status: 'live' })], finance: f }), /andamento/);
  });
});
