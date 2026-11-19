// Financeiro: presenças, cashback, pagamentos do dia, aportes, rankings semestrais, Pix e reset (RN-118 a RN-127).
// Dados fictícios de teste. Datas sem "Z" (hora local) para o semestre não depender do fuso.
import { suite, test, assert } from './harness.js';
import { mkSession } from './helpers.js';
import {
  FINANCE_RULES, formatMoney, parseMoney, financeSettings, setPixConfig, setPixQr, semesterOf, attendanceRecords, semestersAvailable,
  semesterRanking, yearCashback, statement, groupCashback, paymentSummary, setPayment, addContribution, removeContribution,
  resetPreview, resetCycle, validate,
} from '../src/domain/index.js';

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

suite('Financeiro — presenças e rankings semestrais', () => {
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

  test('RN-121: semestres jan–jun e jul–dez; ranking reinicia a cada semestre', () => {
    assert.deepEqual(semesterOf('2026-06-30T20:00:00'), { year: 2026, half: 1 });
    assert.deepEqual(semesterOf('2026-07-01T08:00:00'), { year: 2026, half: 2 });
    const s = [
      pel('a', '2026-06-28T09:00:00', [L('erik', 'Erik'), L('joao', 'João')]),
      pel('b', '2026-07-05T09:00:00', [L('erik', 'Erik')]),
      pel('c', '2026-07-12T09:00:00', [L('erik', 'Erik'), L('joao', 'João')]),
    ];
    const s1 = semesterRanking(s, { year: 2026, half: 1 }, 'line');
    const s2 = semesterRanking(s, { year: 2026, half: 2 }, 'line');
    assert.equal(s1.total, 1);
    assert.equal(s2.total, 2);
    assert.deepEqual(s2.rows.map((r) => [r.name, r.count, r.pct]), [['Erik', 2, 100], ['João', 1, 50]]);
    assert.deepEqual(s1.rows.map((r) => r.count), [1, 1], 'o 1º semestre não soma no 2º');
    const sems = semestersAvailable(s, '2026-11-19T10:00:00').map((x) => `${x.year}-${x.half}`);
    assert.deepEqual(sems, ['2026-2', '2026-1']);
  });

  test('RN-122: Top 32 na linha e Top 4 no gol têm vaga; empates por ordem alfabética; aviso de empate no corte', () => {
    const lines = Array.from({ length: 35 }, (_, i) => L(`l${String(i + 1).padStart(2, '0')}`));
    const gks = ['Bruno', 'Ana', 'Caio', 'Davi', 'Eli'].map((n) => G(n.toLowerCase(), n));
    const s = [
      pel('a', '2026-08-02T09:00:00', [...lines, ...gks]),
      pel('b', '2026-08-09T09:00:00', [...lines.slice(0, 32), ...gks.slice(0, 3)]),
    ];
    const rl = semesterRanking(s, { year: 2026, half: 2 }, 'line');
    assert.equal(rl.rows.length, 35);
    assert.equal(rl.rows.filter((r) => r.qualified).length, 32);
    assert.ok(rl.rows.slice(0, 32).every((r) => r.count === 2) && !rl.cutTie, 'os 32 com 2 presenças ficam dentro');
    assert.ok(rl.rows.every((r) => r.pid.startsWith('l')), 'linha não mistura goleiros');
    const rg = semesterRanking(s, { year: 2026, half: 2 }, 'gk');
    assert.deepEqual(rg.rows.map((r) => r.name), ['Ana', 'Bruno', 'Caio', 'Davi', 'Eli'], 'empate em 2 (Ana, Bruno, Caio) por nome');
    assert.deepEqual(rg.rows.map((r) => r.qualified), [true, true, true, true, false]);
    assert.ok(rg.cutTie, 'Davi e Eli empatados na linha de corte');
    assert.equal(rg.rows[0].pct, 100);
  });
});

suite('Financeiro — cashback, extrato e aportes', () => {
  test('RN-120: linha soma R$ 3 por presença; goleiro só por aportes; zera na virada do ano', () => {
    const s = [
      pel('a', '2025-12-20T09:00:00', [L('rog', 'Rogério')]),
      pel('b', '2026-01-10T09:00:00', [L('rog', 'Rogério'), G('jp', 'JP')]),
      pel('c', '2026-08-10T09:00:00', [L('rog', 'Rogério'), G('jp', 'JP')]),
    ];
    let f = fin();
    f = addContribution(f, { pid: 'jp', name: 'JP', amount: '30', at: '2026-09-01T10:00:00' }).finance;
    f = addContribution(f, { pid: 'jp', name: 'JP', amount: '50,00', at: '2025-11-01T10:00:00' }).finance;
    const r = yearCashback('rog', s, f, 2026);
    assert.equal(r.lineGames, 2);
    assert.equal(r.total, 600, 'presença de 2025 não entra em 2026');
    assert.equal(r.partyRemaining, 29400);
    const g = yearCashback('jp', s, f, 2026);
    assert.equal(g.gkGames, 2);
    assert.equal(g.lineCents, 0, 'goleiro não acumula R$ 3 por jogo');
    assert.equal(g.total, 3000, 'só o aporte de 2026');
    assert.equal(groupCashback(s, f, 2026).total, 600 + 3000);
  });

  test('RN-123: festa de R$ 300 — paga só a diferença; quitada quando o cashback chega a R$ 300', () => {
    const many = Array.from({ length: 100 }, (_, i) => pel(`p${i}`, `2026-0${1 + (i % 9)}-0${1 + (i % 9)}T09:00:00`, [L('erik', 'Erik')]));
    const r = yearCashback('erik', many, fin(), 2026);
    assert.equal(r.total, 30000);
    assert.ok(r.partyPaid);
    assert.equal(r.partyRemaining, 0);
  });

  test('RN-124: extrato traz frequência do semestre, cashback do ano, pendências e lançamentos', () => {
    const s = [
      pel('a', '2026-08-02T09:00:00', [L('erik', 'Erik'), L('x')], { payments: { erik: 'pix' } }),
      pel('b', '2026-08-09T09:00:00', [L('x')]),
      pel('c', '2026-08-16T09:00:00', [G('erik', 'Erik'), L('x')]),
      pel('d', '2026-08-23T09:00:00', [L('erik', 'Erik'), L('x')]),
    ];
    const f = addContribution(fin(), { pid: 'erik', name: 'Erik', amount: '10', note: 'Aporte', at: '2026-08-24T10:00:00' }).finance;
    const st = statement('erik', s, f, '2026-11-19T10:00:00');
    assert.equal(st.name, 'Erik');
    assert.deepEqual([st.semester.total, st.semester.line, st.semester.gk, st.semester.linePct], [4, 2, 1, 50]);
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
    assert.throws(() => resetCycle({ sessions: [pel('c', '2026-08-02T09:00:00', [L('x')], { status: 'live' })], finance: f }), /andamento/);
  });
});
