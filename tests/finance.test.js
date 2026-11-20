// Financeiro: presenças, cashback, pagamentos do dia, aportes, rankings por ciclo, Pix e reset (RN-118 a RN-128).
// Dados fictícios de teste. Datas sem "Z" (hora local) para não depender do fuso.
import { suite, test, assert } from './harness.js';
import { mkSession } from './helpers.js';
import {
  FINANCE_RULES, formatMoney, parseMoney, financeSettings, setPixConfig, setPixQr, attendanceRecords, cyclesAvailable,
  cycleRanking, cycleCashback, statement, groupCashback, paymentSummary, setPayment, addContribution, removeContribution,
  resetPreview, resetCycle, validate, cycleList, currentCycle, closeCycle, startCycle, suggestCycleLabel, FIRST_CYCLE_ID, NEXT_CYCLE,
  isPaid, closedCycleOf, assertSessionDeletable, reopenInfo, reopenCycle, settleParty, unsettleParty, financeAthletes, resetWord,
  CALL_PAYMENT_METHODS, toggleCallPayment, keepCallPayments, drawPayments, cashReport, callPaymentOf, createSession, redraw,
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
    const paid = { payments: { rog: 'pix' } };
    const s = [
      pel('a', '2025-12-20T09:00:00', [L('rog', 'Rogério')], paid),
      pel('b', '2026-01-10T09:00:00', [L('rog', 'Rogério'), G('jp', 'JP')], paid),
      pel('c', '2026-08-10T09:00:00', [L('rog', 'Rogério'), G('jp', 'JP')], paid),
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
    assert.deepEqual(st.previousCashbacks.map((p) => p.total), [300], 'extrato mostra o cashback do período zerado, para o acerto da festa');
    assert.deepEqual(statement('rog', s, fin()).previousCashbacks, []);
  });

  test('RN-123: festa de R$ 300 — paga só a diferença; quitada quando o cashback chega a R$ 300', () => {
    const many = Array.from({ length: 100 }, (_, i) => pel(`p${i}`, `2026-0${1 + (i % 9)}-0${1 + (i % 9)}T09:00:00`, [L('erik', 'Erik')], { payments: { erik: i % 2 ? 'card' : 'cash' } }));
    const r = cycleCashback('erik', many, fin(), FIRST_CYCLE_ID);
    assert.equal(r.total, 30000);
    assert.ok(r.partyPaid);
    assert.equal(r.partyRemaining, 0);
  });

  test('RN-124/RN-128: na folga o extrato mostra o ciclo encerrado e avisa o que vai para o próximo', () => {
    const s = [pel('a', '2026-11-15T09:00:00', [L('erik', 'Erik')], { payments: { erik: 'pix' } }), pel('b', '2026-11-29T09:00:00', [L('erik', 'Erik')])];
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
    assert.equal(st.cashback.total, 300 + 1000, 'só a pelada paga ("a") gera R$ 3; "d" está pendente');
    assert.equal(st.cashback.uncredited, 1);
    assert.equal(st.pending, 1, 'pelada "d" sem pagamento registrado');
    assert.equal(st.entries.length, 4);
    assert.equal(st.entries[0].kind, 'contribution', 'mais recente primeiro');
    assert.deepEqual(st.entries.filter((e) => e.kind === 'game').map((e) => e.cents), [0, 0, 300], 'd pendente, c no gol, a paga');
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
    assert.equal(setPayment(s, pid, 'cash').state.payments[pid], 'cash', 'Dinheiro é forma de pagamento');
    assert.deepEqual(s.payments, {}, 'o estado recebido não muda (pelada nova começa sem pagamentos)');
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
    s = setPayment(s, ids[4], 'cash').state;
    const p = paymentSummary(s);
    assert.deepEqual([p.pix, p.card, p.cash, p.pending, p.exempt], [2, 1, 1, 5, 1 + 2]);
    assert.equal(p.collected, 4 * 1800);
    assert.equal(p.operational, 4 * 1500);
    assert.equal(p.cashbackRetained, 4 * 300);
    assert.equal(p.expected, 9 * 1800, 'linha isenta não entra no esperado');
    assert.equal(p.rows.find((r) => r.pid === 'T1G1').method, 'exempt');
  });

  test('RN-127: zerar apaga peladas e aportes, mantém Pix e cadastro, e inicia o ciclo oficial', () => {
    const draft = pel('b', '2026-08-09T09:00:00', [L('x')], { status: 'draft' });
    const s = [pel('a', '2026-08-02T09:00:00', [L('x')])];
    let f = setPixConfig(fin(), { pixKey: 'chave' });
    f = addContribution(f, { pid: 'x', amount: '30' }).finance;
    assert.deepEqual(resetPreview([...s, draft], f), { peladas: 2, started: 1, contributions: 1, live: false, draft: true, official: false });
    assert.throws(() => resetCycle({ sessions: [...s, draft], finance: f, confirm: 'ZERAR' }), /rascunho/, 'RN-132: rascunho bloqueia o zerar');
    assert.throws(() => resetCycle({ sessions: s, finance: f, confirm: 'zera' }), /Digite ZERAR/);
    const r = resetCycle({ sessions: s, finance: f, confirm: ' zerar ' }, '2027-01-01T00:00:00');
    assert.deepEqual(r.sessions, []);
    assert.deepEqual(r.finance.contributions, []);
    assert.equal(r.finance.pixKey, 'chave');
    assert.equal(r.finance.mode, 'official');
    assert.equal(r.finance.cycleStart, '2027-01-01T00:00:00');
    assert.deepEqual(cycleList(r.finance).map((c) => [c.id, c.start, c.open]), [[FIRST_CYCLE_ID, '2027-01-01T00:00:00', true]], 'ciclos voltam ao 1º');
    assert.throws(() => resetCycle({ sessions: [pel('c', '2026-08-02T09:00:00', [L('x')], { status: 'live' })], finance: f, confirm: 'ZERAR' }), /andamento/);
    // RN-132: no ciclo oficial a palavra é mais forte
    assert.equal(resetWord(r.finance), 'APAGAR TUDO');
    assert.throws(() => resetCycle({ sessions: s, finance: r.finance, confirm: 'ZERAR' }), /APAGAR TUDO/);
    assert.equal(resetCycle({ sessions: s, finance: r.finance, confirm: 'apagar tudo' }).sessions.length, 0);
  });
});

suite('Financeiro — proteções (RN-120, RN-129 a RN-132)', () => {
  test('RN-120: R$ 3 só com pelada paga (Pix, Cartão, Dinheiro); pendente e isento não geram; caixa e cashback batem', () => {
    const ps = [L('pix'), L('card'), L('cash'), L('pend'), L('isen'), G('gol')];
    const s = [pel('a', '2026-08-02T09:00:00', ps, { payments: { pix: 'pix', card: 'card', cash: 'cash', isen: 'exempt' } })];
    const recs = attendanceRecords(s);
    assert.deepEqual(recs.filter((r) => r.credited).map((r) => r.pid), ['pix', 'card', 'cash']);
    assert.equal(cycleCashback('pend', s, fin(), FIRST_CYCLE_ID).total, 0);
    assert.equal(cycleCashback('isen', s, fin(), FIRST_CYCLE_ID).total, 0);
    assert.equal(cycleCashback('gol', s, fin(), FIRST_CYCLE_ID).total, 0, 'goleiro continua só com aportes');
    assert.equal(cycleCashback('cash', s, fin(), FIRST_CYCLE_ID).total, 300);
    assert.equal(groupCashback(s, fin(), FIRST_CYCLE_ID).line, paymentSummary(s[0]).cashbackRetained, 'o que o caixa reteve = cashback prometido');
    assert.ok(isPaid('cash') && !isPaid('exempt') && !isPaid(null));
  });

  test('RN-129: ranking guardado no encerramento não muda se uma pelada for excluída depois; exclusão bloqueada', () => {
    const s = [
      pel('a', '2026-08-02T09:00:00', [L('ana', 'Ana'), L('bia', 'Bia'), G('gu', 'Gu')]),
      pel('b', '2026-08-09T09:00:00', [L('ana', 'Ana')]),
      pel('c', '2026-12-01T09:00:00', [L('bia', 'Bia')]), // folga
      pel('d', '2026-12-08T09:00:00', [L('bia', 'Bia')], { status: 'draft' }),
    ];
    const f = closeCycle(fin(), { sessions: s }, '2026-11-20T12:00:00').finance;
    const r = cycleRanking(s.filter((x) => x.id !== 'b'), f, FIRST_CYCLE_ID, 'line');
    assert.ok(r.frozen);
    assert.equal(r.total, 2);
    assert.deepEqual(r.rows.map((x) => [x.name, x.count]), [['Ana', 2], ['Bia', 1]], 'blindado contra a exclusão');
    assert.deepEqual(cycleRanking([], f, FIRST_CYCLE_ID, 'gk').rows.map((x) => x.name), ['Gu']);
    assert.equal(closedCycleOf(s[0], f).id, FIRST_CYCLE_ID);
    assert.throws(() => assertSessionDeletable(s[1], f), /já encerrado/);
    assert.equal(closedCycleOf(s[2], f), null, 'pelada da folga pode ser excluída');
    assert.equal(closedCycleOf(s[3], f), null, 'rascunho não é bloqueado');
    assert.equal(closedCycleOf(s[0], fin()), null, 'ciclo aberto: livre');
  });

  test('RN-130: reabrir o último ciclo encerrado (na folga ou desfazendo um ciclo novo ainda vazio)', () => {
    const s = [pel('a', '2026-08-02T09:00:00', [L('ana')]), pel('b', '2026-12-01T09:00:00', [L('ana')])];
    assert.equal(reopenInfo(fin(), s), null);
    assert.throws(() => reopenCycle(fin(), s), /Não há ciclo encerrado/);
    let f = closeCycle(fin(), { label: '2º semestre de 2026', sessions: s }, '2026-11-20T12:00:00').finance;
    const back = reopenCycle(f, s).finance;
    assert.equal(currentCycle(back).id, FIRST_CYCLE_ID);
    assert.equal(back.cycles[0].frozen, undefined, 'ranking guardado é descartado');
    assert.equal(cycleRanking(s, back, FIRST_CYCLE_ID, 'line').total, 2, 'a pelada da folga volta a contar');
    // ciclo novo vazio é desfeito; com pelada, não dá mais
    const started = startCycle(f, { label: '1º semestre de 2027' }, '2027-01-05T08:00:00').finance;
    const info = reopenInfo(started, s);
    assert.equal(info.drop.label, '1º semestre de 2027');
    assert.equal(info.blocked, '');
    const undone = reopenCycle(started, s).finance;
    assert.deepEqual(cycleList(undone).map((c) => [c.label, c.open]), [['2º semestre de 2026', true]]);
    const used = [...s, pel('c', '2027-01-10T09:00:00', [L('ana')])];
    assert.throws(() => reopenCycle(started, used), /já tem peladas/);
    f = addContribution(started, { pid: 'g', name: 'G', amount: '30', at: '2027-01-06T10:00:00' }).finance;
    assert.ok(reopenInfo(f, s).blocked, 'aporte no ciclo novo também bloqueia');
  });

  test('RN-131: extrato mostra todos os períodos anteriores e o acerto da festa registrado', () => {
    const paid = { payments: { rog: 'pix' } };
    const s = [
      pel('a', '2025-03-01T09:00:00', [L('rog', 'Rogério')], paid),
      pel('b', '2026-03-01T09:00:00', [L('rog', 'Rogério')], paid),
      pel('c', '2027-03-01T09:00:00', [L('rog', 'Rogério')], paid),
    ];
    let f = turn(fin(), '2026-01-01T00:00:00', '2026-01-02T00:00:00', '2026', true);
    f = turn(f, '2027-01-01T00:00:00', '2027-01-02T00:00:00', '2027', true);
    let st = statement('rog', s, f);
    assert.deepEqual(st.previousCashbacks.map((p) => [p.sinceLabel, p.total]), [['2026', 300], ['1º ciclo', 300]], 'dois períodos zerados, mais recente primeiro');
    const key = st.previousCashbacks[1].periodKey;
    f = settleParty(f, { pid: 'rog', name: 'Rogério', periodKey: key, cents: 300, note: 'pagou a diferença' }, '2026-01-10T10:00:00').finance;
    assert.throws(() => settleParty(f, { pid: 'rog', periodKey: key }), /já foi registrado/);
    st = statement('rog', s, f);
    assert.equal(st.previousCashbacks[1].settlement.note, 'pagou a diferença');
    assert.equal(st.previousCashbacks[1].total, 300, 'o acerto não altera o cashback');
    assert.equal(st.previousCashbacks[0].settlement, null);
    const id = st.previousCashbacks[1].settlement.id;
    assert.equal(unsettleParty(f, id).partySettlements.length, 0);
  });

  test('Goleiro excluído do cadastro que só tem aportes continua com extrato acessível', () => {
    const f = addContribution(fin(), { pid: 'gk-x', name: 'Goleiro X', amount: '50' }).finance;
    const list = financeAthletes([{ id: 'ana', name: 'Ana' }], [pel('a', '2026-08-02T09:00:00', [L('bia', 'Bia')])], f);
    assert.deepEqual(list.map((x) => [x.name, x.removed]), [['Ana', false], ['Bia', true], ['Goleiro X', true]]);
    assert.equal(statement('gk-x', [], f).cashback.total, 5000);
  });
});

suite('Financeiro — pagamento na chamada e fechamento de caixa (RN-139, RN-140)', () => {
  const fee = FINANCE_RULES.lineFee;

  test('Chamada: tocar marca, tocar de novo desmarca (pendente); trocar de forma substitui', () => {
    assert.deepEqual(CALL_PAYMENT_METHODS, ['pix', 'card', 'cash']);
    let p = toggleCallPayment({}, 'a', 'pix');
    assert.deepEqual(p, { a: 'pix' });
    p = toggleCallPayment(p, 'a', 'cash');
    assert.deepEqual(p, { a: 'cash' }, 'troca de forma');
    const before = { ...p };
    const off = toggleCallPayment(p, 'a', 'cash');
    assert.deepEqual(off, {}, 'toque no botão ativo volta para pendente');
    assert.deepEqual(p, before, 'não altera o mapa recebido');
    assert.throws(() => toggleCallPayment({}, 'a', 'exempt'), /inválida/);
    assert.throws(() => toggleCallPayment({}, 'a', 'boleto'), /inválida/);
  });

  test('Chamada: desmarcar a presença descarta o pagamento marcado', () => {
    assert.deepEqual(keepCallPayments({ a: 'pix', b: 'card', c: 'cash' }, ['a', 'c']), { a: 'pix', c: 'cash' });
    assert.deepEqual(keepCallPayments({ a: 'lixo' }, ['a']), {}, 'valor inválido é descartado');
  });

  test('Sorteio leva os pagamentos da chamada para a pelada (só linha presente; goleiro segue isento)', () => {
    const base = mkSession([5, 5], { goalkeepers: 1 });
    const call = { T1P1: 'pix', T1P2: 'card', T2P1: 'cash', G1: 'pix', fora: 'pix' };
    const pay = drawPayments(base.snapshot, call);
    assert.deepEqual(pay, { T1P1: 'pix', T1P2: 'card', T2P1: 'cash' });
    const draw = { teams: Object.values(base.teams).map((t) => ({ line: t.line, gks: [] })), seed: 1, metrics: {}, ref: 2, withoutGk: [], unusedGoalkeepers: [] };
    const s = createSession({ title: 'X', config: base.config, snapshots: base.snapshot, draw, gkOrder: ['G1'], payments: pay });
    validate(s);
    assert.deepEqual(s.payments, pay);
    const r = paymentSummary(s);
    assert.equal(r.pix, 1);
    assert.equal(r.card, 1);
    assert.equal(r.cash, 1);
    assert.equal(r.pending, 7);
    // refazer sorteio: o que a pelada já tinha prevalece sobre a chamada
    const merged = drawPayments(s.snapshot, { T1P1: 'cash', T1P3: 'pix' }, s.payments);
    assert.equal(merged.T1P1, 'pix');
    assert.equal(merged.T1P3, 'pix');
    const s2 = redraw(s, { draw, payments: merged });
    assert.deepEqual(s2.payments, merged);
    assert.deepEqual(createSession({ title: 'Y', config: base.config, snapshots: base.snapshot, draw }).payments, {}, 'sem chamada: todos pendentes');
  });

  test('Chamada: atleta já na pelada em rascunho/ao vivo usa o pagamento da pelada; encerrada não', () => {
    let s = mkSession([5, 5]);
    s = setPayment(s, 'T1P1', 'card').state;
    assert.deepEqual(callPaymentOf({ T1P1: 'pix' }, s, 'T1P1'), { sid: s.id, method: 'card' });
    assert.deepEqual(callPaymentOf({ X: 'pix' }, s, 'X'), { sid: null, method: 'pix' }, 'fora da pelada: chamada');
    assert.deepEqual(callPaymentOf({}, { ...s, status: 'draft' }, 'T1P2'), { sid: s.id, method: null });
    assert.deepEqual(callPaymentOf({}, { ...s, status: 'finished' }, 'T1P1'), { sid: null, method: null }, 'encerrada: só pela aba Caixa');
    assert.deepEqual(callPaymentOf({}, null, 'T1P1'), { sid: null, method: null });
  });

  test('Fechamento de caixa: por forma, pendentes listados e soma geral batendo com o esperado', () => {
    let s = mkSession([5, 5], { goalkeepers: 2 });
    const marks = { T1P1: 'pix', T1P2: 'pix', T1P3: 'pix', T1P4: 'card', T1P5: 'card', T2P1: 'cash', T2P2: 'exempt' };
    for (const [pid, m] of Object.entries(marks)) s = setPayment(s, pid, m).state;
    const r = cashReport(s);
    assert.deepEqual(r.methods.map((m) => [m.method, m.count, m.cents]), [['pix', 3, 3 * fee], ['card', 2, 2 * fee], ['cash', 1, fee]]);
    assert.deepEqual(r.pending.map((x) => x.pid).sort(), ['T2P3', 'T2P4', 'T2P5']);
    assert.equal(r.pendingCents, 3 * fee);
    assert.equal(r.lineCount, 10);
    assert.equal(r.exemptLine, 1);
    assert.equal(r.goalkeepers, 2, 'goleiros fora do esperado');
    assert.equal(r.total, 6 * fee);
    assert.equal(r.expected, 9 * fee, '10 de linha − 1 isento');
    assert.equal(r.difference, 3 * fee);
    assert.ok(!r.balanced);
    assert.equal(r.total + r.pendingCents, r.expected, 'recebido + pendente = esperado');
    for (const pid of ['T2P3', 'T2P4', 'T2P5']) s = setPayment(s, pid, 'pix').state;
    const done = cashReport(s);
    assert.ok(done.balanced);
    assert.equal(done.pending.length, 0);
    assert.equal(done.total, done.expected);
    assert.equal(done.methods[0].count, 6);
    assert.equal(formatMoney(done.total), formatMoney(9 * fee));
  });

  test('Fechamento de caixa segue a regra do cashback: só pago gera os R$ 3 (RN-120 intacta)', () => {
    let s = mkSession([5]);
    s = setPayment(s, 'T1P1', 'cash').state;
    s = setPayment(s, 'T1P2', 'exempt').state;
    const recs = attendanceRecords([{ ...s, createdAt: '2026-11-20T20:00:00' }], {});
    assert.equal(recs.filter((x) => x.credited).length, 1);
    assert.equal(cashReport(s).total, fee);
  });
});
