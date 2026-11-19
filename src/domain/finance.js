// Financeiro, presenças e cashback (RN-118 a RN-127). Regras puras: sem DOM, sem armazenamento.
//
// Onde os dados ficam (sem tabela nova no banco):
// - presença: quem está no `snapshot` de uma pelada iniciada (ao vivo ou encerrada) esteve presente;
//   o tipo (linha/goleiro) é o do snapshot daquela pelada (o mesmo atleta pode ter os dois históricos);
// - pagamento do dia: `session.payments[pid]` = 'pix' | 'card' | 'exempt' (sem registro = pendente);
// - aportes livres, chave Pix, QR Code e modo teste: `settings.finance` (ajustes do grupo na nuvem).
// Valores em centavos (inteiros) para não haver erro de arredondamento.
import { RuleError, clone, validate } from './session.js';
import { newId } from './players.js';

export const FINANCE_RULES = {
  lineFee: 1800, // R$ 18 por pelada (linha)
  operational: 1500, // R$ 15 operacional
  cashbackPerGame: 300, // R$ 3 retidos para o cashback anual
  partyFee: 30000, // festa de fim de ano: R$ 300
  topLine: 32, // vaga prioritária no campeonato (linha)
  topGk: 4, // vaga prioritária no campeonato (goleiros)
  maxContribution: 1000000, // R$ 10.000 por aporte (proteção contra digitação errada)
};

export const PAYMENT_METHODS = { pix: 'Pix', card: 'Cartão', exempt: 'Isento' };

const COUNTED = new Set(['live', 'finished']);

// ---------------------------------------------------------------- dinheiro

/** 123456 → "R$ 1.234,56". */
export function formatMoney(cents) {
  const c = Math.round(Number(cents) || 0);
  const abs = Math.abs(c);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${c < 0 ? '−' : ''}R$ ${int},${String(abs % 100).padStart(2, '0')}`;
}

/** "30", "30,50", "R$ 1.234,56", "30.5" → centavos. Lança RuleError se inválido. */
export function parseMoney(text) {
  let t = String(text ?? '').replace(/R\$|\s/gi, '');
  if (!t) throw new RuleError('Informe o valor.');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(t) || (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new RuleError('Valor inválido. Use, por exemplo, 30 ou 30,50.');
  const cents = Math.round(Number(t) * 100);
  if (cents <= 0) throw new RuleError('O valor precisa ser maior que zero.');
  if (cents > FINANCE_RULES.maxContribution) throw new RuleError(`Valor acima do limite de ${formatMoney(FINANCE_RULES.maxContribution)} por lançamento.`);
  return cents;
}

// ---------------------------------------------------------------- configuração (settings.finance)

/** Configuração financeira com os padrões preenchidos. Modo teste ligado até o primeiro "zerar". */
export function financeSettings(settings = {}) {
  const f = settings?.finance || {};
  return {
    mode: f.mode === 'official' ? 'official' : 'test',
    pixKey: f.pixKey || '',
    pixName: f.pixName || '',
    pixCopyPaste: f.pixCopyPaste || '',
    qrImage: f.qrImage || '',
    contributions: Array.isArray(f.contributions) ? f.contributions : [],
    cycleStart: f.cycleStart || null,
    cycles: Array.isArray(f.cycles) ? f.cycles : [],
  };
}

/** RN-125: chave Pix, nome do recebedor e "Copia e Cola" da tesouraria (configurados pelo admin). */
export function setPixConfig(finance, { pixKey = '', pixName = '', pixCopyPaste = '' }) {
  const key = String(pixKey).trim();
  const name = String(pixName).trim();
  const cc = String(pixCopyPaste).replace(/\s+/g, '').trim();
  if (key.length > 77) throw new RuleError('A chave Pix tem no máximo 77 caracteres.');
  if (name.length > 60) throw new RuleError('O nome do recebedor tem no máximo 60 caracteres.');
  if (cc.length > 512) throw new RuleError('O código "Copia e Cola" está longo demais (máximo 512 caracteres).');
  if (cc && !/^000201/.test(cc)) throw new RuleError('O "Copia e Cola" do Pix começa com 000201. Copie o código inteiro do app do banco.');
  return { ...finance, pixKey: key, pixName: name, pixCopyPaste: cc };
}

export const QR_MAX_CHARS = 400000;

/** Imagem do QR Code (data URL já reduzida pela interface). Vazio remove. */
export function setPixQr(finance, dataUrl) {
  const v = String(dataUrl || '');
  if (v && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) throw new RuleError('Imagem do QR Code inválida. Use PNG ou JPG.');
  if (v.length > QR_MAX_CHARS) throw new RuleError('A imagem do QR Code ficou grande demais. Use um recorte só do QR Code.');
  return { ...finance, qrImage: v };
}

// ---------------------------------------------------------------- ciclos (RN-121, RN-128)

const dateOf = (s) => s.startedAt || s.createdAt;
const ms = (iso) => Date.parse(iso);

/** 1º semestre = janeiro a junho; 2º = julho a dezembro (só para sugerir o nome do ciclo). */
export function semesterOf(iso) {
  const d = new Date(iso);
  return { year: d.getFullYear(), half: d.getMonth() < 6 ? 1 : 2 };
}

export function semesterLabel({ year, half }) {
  return `${half}º semestre de ${year}`;
}

export const FIRST_CYCLE_ID = 'ciclo-1';
/** Chave das peladas/aportes feitos depois de um encerramento, antes de o admin iniciar o ciclo seguinte. */
export const NEXT_CYCLE = 'proximo';
const NEXT_LABEL = 'Próximo ciclo (ainda não iniciado)';
const MAX_LABEL = 40;

const plainCycle = ({ id, label, start, end, resetCashback }) => ({ id, label, start: start || null, end: end || null, resetCashback: !!resetCashback });

/**
 * RN-128: ciclos (semestres) abertos e encerrados manualmente pelo admin, em ordem.
 * Sem nenhum ciclo gravado existe o "1º ciclo", aberto, desde o início do ciclo oficial (cycleStart).
 * `period` agrupa os ciclos que somam o mesmo cashback: um ciclo com `resetCashback` começa período novo.
 */
export function cycleList(finance = {}) {
  const saved = Array.isArray(finance.cycles) && finance.cycles.length ? finance.cycles : null;
  const list = saved
    ? saved.map(plainCycle).sort((a, b) => (a.start || '').localeCompare(b.start || ''))
    : [{ id: FIRST_CYCLE_ID, label: finance.cycleStart ? semesterLabel(semesterOf(finance.cycleStart)) : '1º ciclo', start: finance.cycleStart || null, end: null, resetCashback: true }];
  let period = 0;
  return list.map((c, i) => {
    if (i > 0 && c.resetCashback) period++;
    return { ...c, index: i, period, open: !c.end };
  });
}

/**
 * Ciclo a que pertence uma data: o primeiro ainda aberto ou encerrado depois dela. Depois do último
 * encerramento (folga), devolve null — a pelada conta no próximo ciclo quando ele for iniciado.
 */
export function cycleOfDate(cycles, iso) {
  return cycles.find((c) => !c.end || ms(iso) < ms(c.end)) || null;
}

const cycleKey = (cycles, iso) => cycleOfDate(cycles, iso)?.id || NEXT_CYCLE;

/** Ciclo aberto agora (null na folga entre o encerramento e o novo início). */
export function currentCycle(finance) {
  return cycleList(finance).find((c) => c.open) || null;
}

/** Peladas que contam presença: iniciadas (ao vivo ou encerradas), em ordem de data. */
export function countedPeladas(sessions = []) {
  return sessions.filter((s) => s && COUNTED.has(s.status) && s.snapshot).sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
}

/** Situação de pagamento padrão: goleiro é isento (RN-119); linha sem registro está pendente. */
export function paymentOf(s, pid) {
  const m = s.payments?.[pid];
  if (m) return m;
  return s.snapshot?.[pid]?.type === 'gk' ? 'exempt' : null;
}

/** RN-118: uma presença por atleta por pelada iniciada, com o tipo do snapshot daquela pelada e o ciclo. */
export function attendanceRecords(sessions = [], finance = {}) {
  const cycles = cycleList(finance);
  const out = [];
  for (const s of countedPeladas(sessions)) {
    const date = dateOf(s);
    const cycleId = cycleKey(cycles, date);
    for (const p of Object.values(s.snapshot)) {
      out.push({ sid: s.id, title: s.title, date, cycleId, pid: p.id, name: p.name, type: p.type === 'gk' ? 'gk' : 'line', payment: paymentOf(s, p.id) });
    }
  }
  return out;
}

/** Ciclos para consulta do ranking, do mais recente ao mais antigo (com o "próximo ciclo" se houver pelada na folga). */
export function cyclesAvailable(sessions = [], finance = {}) {
  const cycles = cycleList(finance);
  const out = cycles.slice().reverse();
  if (countedPeladas(sessions).some((s) => !cycleOfDate(cycles, dateOf(s)))) {
    out.unshift({ id: NEXT_CYCLE, label: NEXT_LABEL, start: null, end: null, open: false, pending: true });
  }
  return out;
}

/**
 * RN-121/RN-122/RN-128: ranking de presença de um ciclo por tipo ('line' ou 'gk').
 * Total de jogos = peladas iniciadas no ciclo. Ordem: mais presenças; empate, ordem alfabética.
 * Os `top` primeiros (32 na linha, 4 no gol) têm vaga prioritária no campeonato.
 */
export function cycleRanking(sessions, finance, cycleId, type = 'line') {
  const cycles = cycleList(finance);
  const cycle = cycles.find((c) => c.id === cycleId) || { id: NEXT_CYCLE, label: NEXT_LABEL, start: null, end: null, open: false, pending: true };
  const top = type === 'gk' ? FINANCE_RULES.topGk : FINANCE_RULES.topLine;
  const peladas = countedPeladas(sessions).filter((s) => cycleKey(cycles, dateOf(s)) === cycle.id);
  const total = peladas.length;
  const counts = new Map();
  for (const s of peladas) {
    for (const p of Object.values(s.snapshot)) {
      if ((p.type === 'gk' ? 'gk' : 'line') !== type) continue;
      const c = counts.get(p.id) || { pid: p.id, name: p.name, count: 0 };
      c.count++;
      c.name = p.name; // nome mais recente
      counts.set(p.id, c);
    }
  }
  const rows = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'))
    .map((r, i) => ({ ...r, position: i + 1, pct: total ? Math.round((r.count / total) * 100) : 0, qualified: i < top }));
  const cutTie = rows.length > top && rows[top - 1].count === rows[top].count;
  return { cycle, type, total, top, rows, cutTie };
}

// ---------------------------------------------------------------- abrir e encerrar ciclos (RN-128)

/** Nome sugerido para o próximo ciclo: o semestre de daqui a um mês (o início costuma vir depois da folga). */
export function suggestCycleLabel(now = new Date().toISOString()) {
  return semesterLabel(semesterOf(new Date(ms(now) + 30 * 86400000).toISOString()));
}

function cleanLabel(label, cycles, exceptId) {
  const name = String(label ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new RuleError('Dê um nome ao ciclo (ex.: 1º semestre de 2027).');
  if (name.length > MAX_LABEL) throw new RuleError(`O nome do ciclo tem no máximo ${MAX_LABEL} caracteres.`);
  if (cycles.some((c) => c.id !== exceptId && c.label.toLowerCase() === name.toLowerCase())) throw new RuleError('Já existe um ciclo com esse nome.');
  return name;
}

/**
 * Encerra o ciclo aberto (o ranking dele fica guardado para conferência). Pode renomeá-lo ao encerrar.
 * Peladas feitas depois disso contam no próximo ciclo, quando o admin iniciá-lo.
 */
export function closeCycle(finance, { label } = {}, now = new Date().toISOString()) {
  const cycles = cycleList(finance);
  const cur = cycles.find((c) => c.open);
  if (!cur) throw new RuleError('Não há ciclo aberto para encerrar.');
  if (cur.start && ms(now) <= ms(cur.start)) throw new RuleError('A data de encerramento precisa ser depois do início do ciclo.');
  const name = label == null || label === '' ? cur.label : cleanLabel(label, cycles, cur.id);
  const list = cycles.map(plainCycle).map((c) => (c.id === cur.id ? { ...c, label: name, end: now } : c));
  return { finance: { ...finance, cycles: list }, message: `${name} encerrado. O ranking dele continua disponível para consulta.` };
}

/** Inicia um ciclo novo a partir de agora. `resetCashback` começa um período de cashback novo (novo ano da festa). */
export function startCycle(finance, { label, resetCashback = false } = {}, now = new Date().toISOString()) {
  const cycles = cycleList(finance);
  if (cycles.some((c) => c.open)) throw new RuleError('Encerre o ciclo atual antes de iniciar um novo.');
  const name = cleanLabel(label, cycles);
  const last = cycles[cycles.length - 1];
  if (ms(now) < ms(last.end)) throw new RuleError('O novo ciclo precisa começar depois do encerramento do anterior.');
  const c = { id: newId('cy'), label: name, start: now, end: null, resetCashback: !!resetCashback };
  return {
    finance: { ...finance, cycles: [...cycles.map(plainCycle), c] },
    message: `${name} iniciado.${resetCashback ? ' Cashback zerado para o novo período.' : ' O cashback continua acumulando.'}`,
  };
}

// ---------------------------------------------------------------- cashback e extrato

/** Ciclos que somam o mesmo cashback que `cycleId` (do último "zerar cashback" até o próximo). */
function periodIds(cycles, cycleId) {
  const c = cycles.find((x) => x.id === cycleId);
  return c ? new Set(cycles.filter((x) => x.period === c.period).map((x) => x.id)) : new Set([NEXT_CYCLE]);
}

/**
 * RN-120/RN-123/RN-128: cashback do período = R$ 3 por presença como linha + aportes livres (goleiros e
 * quem quiser). Abate a festa de R$ 300. Só zera quando o admin inicia um ciclo marcando "zerar cashback".
 */
export function cycleCashback(pid, sessions, finance, cycleId) {
  const cycles = cycleList(finance);
  const ids = periodIds(cycles, cycleId);
  const recs = attendanceRecords(sessions, finance).filter((r) => r.pid === pid && ids.has(r.cycleId));
  const lineGames = recs.filter((r) => r.type === 'line').length;
  const gkGames = recs.length - lineGames;
  const lineCents = lineGames * FINANCE_RULES.cashbackPerGame;
  const contributions = (finance?.contributions || []).filter((c) => c.pid === pid && ids.has(cycleKey(cycles, c.at)));
  const contribCents = contributions.reduce((t, c) => t + c.cents, 0);
  const total = lineCents + contribCents;
  const first = cycles.find((c) => ids.has(c.id));
  return {
    since: first?.start || null, sinceLabel: first?.label || NEXT_LABEL,
    lineGames, gkGames, lineCents, contribCents, total, contributions,
    partyFee: FINANCE_RULES.partyFee,
    partyRemaining: Math.max(0, FINANCE_RULES.partyFee - total),
    partyPaid: total >= FINANCE_RULES.partyFee,
  };
}

/**
 * RN-124: extrato do atleta — frequência do ciclo aberto (na folga, a do ciclo encerrado, para o
 * acerto), cashback do período, festa e lançamentos. `waiting` = lançamentos que irão para o próximo ciclo.
 */
export function statement(pid, sessions, finance) {
  const cycles = cycleList(finance);
  const cycle = cycles.find((c) => c.open) || cycles[cycles.length - 1];
  const recs = attendanceRecords(sessions, finance).filter((r) => r.pid === pid);
  const total = countedPeladas(sessions).filter((s) => cycleKey(cycles, dateOf(s)) === cycle.id).length;
  const inCycle = recs.filter((r) => r.cycleId === cycle.id);
  const line = inCycle.filter((r) => r.type === 'line').length;
  const gk = inCycle.length - line;
  const cash = cycleCashback(pid, sessions, finance, cycle.id);
  const ids = periodIds(cycles, cycle.id);
  const entries = [
    ...recs.filter((r) => ids.has(r.cycleId)).map((r) => ({
      date: r.date, kind: 'game', type: r.type, title: r.title, payment: r.payment,
      cents: r.type === 'line' ? FINANCE_RULES.cashbackPerGame : 0,
    })),
    ...cash.contributions.map((c) => ({ date: c.at, kind: 'contribution', title: c.note || 'Aporte livre', cents: c.cents, id: c.id })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const waiting = recs.filter((r) => r.cycleId === NEXT_CYCLE).length
    + (finance?.contributions || []).filter((c) => c.pid === pid && cycleKey(cycles, c.at) === NEXT_CYCLE).length;
  const name = recs.length ? recs[recs.length - 1].name : (finance?.contributions || []).find((c) => c.pid === pid)?.name || '';
  // Período de cashback anterior (já zerado), para o acerto da festa depois de iniciar o ciclo novo.
  const prevCycle = cycles.filter((c) => c.period === cycle.period - 1).pop();
  return {
    pid, name, cycle: { ...cycle, total, line, gk, linePct: total ? Math.round((line / total) * 100) : 0, gkPct: total ? Math.round((gk / total) * 100) : 0 },
    cashback: cash, entries, waiting,
    previousCashback: prevCycle ? cycleCashback(pid, sessions, finance, prevCycle.id) : null,
    pending: recs.filter((r) => r.type === 'line' && !r.payment).length,
  };
}

/** Total de cashback do grupo no período do ciclo (linha + aportes) e os aportes desse período. */
export function groupCashback(sessions, finance, cycleId) {
  const cycles = cycleList(finance);
  const ids = periodIds(cycles, cycleId);
  const games = attendanceRecords(sessions, finance).filter((r) => ids.has(r.cycleId) && r.type === 'line').length;
  const line = games * FINANCE_RULES.cashbackPerGame;
  const contributions = (finance?.contributions || []).filter((c) => ids.has(cycleKey(cycles, c.at)));
  const contrib = contributions.reduce((t, c) => t + c.cents, 0);
  return { line, contrib, total: line + contrib, contributions };
}

// ---------------------------------------------------------------- pagamentos do dia (RN-119)

/** Lista de pagamentos de uma pelada e totais do caixa do dia. */
export function paymentSummary(s) {
  const rows = Object.values(s.snapshot || {})
    .map((p) => {
      const type = p.type === 'gk' ? 'gk' : 'line';
      const method = paymentOf(s, p.id);
      return { pid: p.id, name: p.name, type, method, due: type === 'line' && method !== 'exempt' ? FINANCE_RULES.lineFee : 0 };
    })
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'line' ? -1 : 1) || (a.method ? 1 : 0) - (b.method ? 1 : 0) || a.name.localeCompare(b.name, 'pt-BR'));
  const line = rows.filter((r) => r.type === 'line');
  const count = (m) => line.filter((r) => r.method === m).length;
  const paid = count('pix') + count('card');
  return {
    rows,
    pix: count('pix'),
    card: count('card'),
    exempt: count('exempt') + rows.filter((r) => r.type === 'gk').length,
    pending: line.filter((r) => !r.method).length,
    paid,
    collected: paid * FINANCE_RULES.lineFee,
    operational: paid * FINANCE_RULES.operational,
    cashbackRetained: paid * FINANCE_RULES.cashbackPerGame,
    expected: line.filter((r) => r.method !== 'exempt').length * FINANCE_RULES.lineFee,
  };
}

/**
 * Registra (ou limpa, com method = null) o pagamento de um participante da pelada. Comando puro:
 * devolve uma cópia validada. Goleiro é sempre isento da taxa de jogo (RN-119).
 */
export function setPayment(state, pid, method) {
  const p = state.snapshot?.[pid];
  if (!p) throw new RuleError('Este atleta não participou desta pelada.');
  if (method !== null && !PAYMENT_METHODS[method]) throw new RuleError('Forma de pagamento inválida.');
  if (p.type === 'gk' && method && method !== 'exempt') throw new RuleError('Goleiro é isento da taxa de jogo. Use "Aporte" para o cashback dele.');
  const s = clone(state);
  s.payments = { ...(s.payments || {}) };
  if (method) s.payments[pid] = method;
  else delete s.payments[pid];
  validate(s);
  return { state: s, message: `${p.name}: ${method ? PAYMENT_METHODS[method] : 'pendente'}.` };
}

// ---------------------------------------------------------------- aportes livres (RN-120)

export function addContribution(finance, { pid, name, amount, note = '', at = new Date().toISOString(), id }) {
  if (!pid) throw new RuleError('Escolha o atleta.');
  const cents = typeof amount === 'number' ? amount : parseMoney(amount);
  if (!Number.isInteger(cents) || cents <= 0 || cents > FINANCE_RULES.maxContribution) throw new RuleError('Valor inválido.');
  const n = String(note || '').trim();
  if (n.length > 80) throw new RuleError('A observação tem no máximo 80 caracteres.');
  const c = { id: id || newId('c'), pid, name: String(name || '').trim(), cents, note: n, at };
  return { finance: { ...finance, contributions: [...(finance.contributions || []), c] }, message: `Aporte de ${formatMoney(cents)} para ${c.name || 'o atleta'} registrado.` };
}

export function removeContribution(finance, id) {
  const list = finance.contributions || [];
  if (!list.some((c) => c.id === id)) throw new RuleError('Aporte não encontrado.');
  return { ...finance, contributions: list.filter((c) => c.id !== id) };
}

// ---------------------------------------------------------------- reset dos testes (RN-127)

/** O que o "zerar" apagaria: peladas (histórico e presenças) e aportes. Cadastro e Pix ficam. */
export function resetPreview(sessions = [], finance = {}) {
  return {
    peladas: sessions.length,
    started: countedPeladas(sessions).length,
    contributions: (finance.contributions || []).length,
    live: sessions.some((s) => s.status === 'live'),
  };
}

/**
 * RN-127: apaga peladas, presenças, pagamentos e aportes para começar o ciclo oficial do zero.
 * Mantém o cadastro de atletas e a configuração do Pix. Exige que nenhuma pelada esteja em andamento.
 */
export function resetCycle({ sessions = [], finance = {} }, now = new Date().toISOString()) {
  if (sessions.some((s) => s.status === 'live')) throw new RuleError('Encerre a pelada em andamento antes de zerar os lançamentos.');
  return {
    sessions: [],
    finance: { ...finance, contributions: [], mode: 'official', cycleStart: now, cycles: [] },
    removed: resetPreview(sessions, finance),
  };
}
