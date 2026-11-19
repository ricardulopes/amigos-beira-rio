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

// ---------------------------------------------------------------- semestres e presenças

const dateOf = (s) => s.startedAt || s.createdAt;

/** RN-121: 1º semestre = janeiro a junho; 2º = julho a dezembro. */
export function semesterOf(iso) {
  const d = new Date(iso);
  return { year: d.getFullYear(), half: d.getMonth() < 6 ? 1 : 2 };
}

export function semesterLabel({ year, half }) {
  return `${half}º semestre de ${year}`;
}

const sameSem = (a, b) => a.year === b.year && a.half === b.half;

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

/** RN-118: uma presença por atleta por pelada iniciada, com o tipo do snapshot daquela pelada. */
export function attendanceRecords(sessions = []) {
  const out = [];
  for (const s of countedPeladas(sessions)) {
    const date = dateOf(s);
    const sem = semesterOf(date);
    for (const p of Object.values(s.snapshot)) {
      out.push({ sid: s.id, title: s.title, date, ...sem, pid: p.id, name: p.name, type: p.type === 'gk' ? 'gk' : 'line', payment: paymentOf(s, p.id) });
    }
  }
  return out;
}

/** Semestres com peladas registradas, mais o semestre atual, do mais recente para o mais antigo. */
export function semestersAvailable(sessions = [], now = new Date().toISOString()) {
  const map = new Map();
  for (const s of [...countedPeladas(sessions).map((x) => semesterOf(dateOf(x))), semesterOf(now)]) map.set(`${s.year}-${s.half}`, s);
  return [...map.values()].sort((a, b) => b.year - a.year || b.half - a.half);
}

/**
 * RN-121/RN-122: ranking de presença do semestre por tipo ('line' ou 'gk').
 * Total de jogos = peladas iniciadas no semestre. Ordem: mais presenças; empate, ordem alfabética.
 * Os `top` primeiros (32 na linha, 4 no gol) têm vaga prioritária no campeonato.
 */
export function semesterRanking(sessions, sem, type = 'line') {
  const top = type === 'gk' ? FINANCE_RULES.topGk : FINANCE_RULES.topLine;
  const peladas = countedPeladas(sessions).filter((s) => sameSem(semesterOf(dateOf(s)), sem));
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
  return { ...sem, type, total, top, rows, cutTie };
}

// ---------------------------------------------------------------- cashback e extrato

const yearOf = (iso) => new Date(iso).getFullYear();

/**
 * RN-120/RN-123: cashback do ano = R$ 3 por presença como linha + aportes livres (goleiros e quem
 * quiser). Abate a festa de R$ 300; zera na virada do ano (conta só o ano pedido).
 */
export function yearCashback(pid, sessions, finance, year) {
  const recs = attendanceRecords(sessions).filter((r) => r.pid === pid && r.year === year);
  const lineGames = recs.filter((r) => r.type === 'line').length;
  const gkGames = recs.length - lineGames;
  const lineCents = lineGames * FINANCE_RULES.cashbackPerGame;
  const contributions = (finance?.contributions || []).filter((c) => c.pid === pid && yearOf(c.at) === year);
  const contribCents = contributions.reduce((t, c) => t + c.cents, 0);
  const total = lineCents + contribCents;
  return {
    year, lineGames, gkGames, lineCents, contribCents, total, contributions,
    partyFee: FINANCE_RULES.partyFee,
    partyRemaining: Math.max(0, FINANCE_RULES.partyFee - total),
    partyPaid: total >= FINANCE_RULES.partyFee,
  };
}

/** RN-124: extrato do atleta — frequência do semestre, cashback do ano, festa e lançamentos. */
export function statement(pid, sessions, finance, now = new Date().toISOString()) {
  const sem = semesterOf(now);
  const recs = attendanceRecords(sessions).filter((r) => r.pid === pid);
  const total = countedPeladas(sessions).filter((s) => sameSem(semesterOf(dateOf(s)), sem)).length;
  const inSem = recs.filter((r) => sameSem(r, sem));
  const line = inSem.filter((r) => r.type === 'line').length;
  const gk = inSem.length - line;
  const cash = yearCashback(pid, sessions, finance, sem.year);
  const entries = [
    ...recs.filter((r) => r.year === sem.year).map((r) => ({
      date: r.date, kind: 'game', type: r.type, title: r.title, payment: r.payment,
      cents: r.type === 'line' ? FINANCE_RULES.cashbackPerGame : 0,
    })),
    ...cash.contributions.map((c) => ({ date: c.at, kind: 'contribution', title: c.note || 'Aporte livre', cents: c.cents, id: c.id })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const name = recs.length ? recs[recs.length - 1].name : (finance?.contributions || []).find((c) => c.pid === pid)?.name || '';
  return {
    pid, name, semester: { ...sem, total, line, gk, linePct: total ? Math.round((line / total) * 100) : 0, gkPct: total ? Math.round((gk / total) * 100) : 0 },
    cashback: cash, entries,
    pending: recs.filter((r) => r.type === 'line' && !r.payment).length,
  };
}

/** Total de cashback do grupo no ano (linha + aportes), para o resumo do caixa. */
export function groupCashback(sessions, finance, year) {
  const games = attendanceRecords(sessions).filter((r) => r.year === year && r.type === 'line').length;
  const line = games * FINANCE_RULES.cashbackPerGame;
  const contrib = (finance?.contributions || []).filter((c) => yearOf(c.at) === year).reduce((t, c) => t + c.cents, 0);
  return { line, contrib, total: line + contrib };
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
    finance: { ...finance, contributions: [], mode: 'official', cycleStart: now },
    removed: resetPreview(sessions, finance),
  };
}
