// Núcleo do estado da pelada: criação, consultas, integridade e utilitários de transação.
// Usado pelos demais módulos do domínio (rotation, arrivals, removals, adjustments).
//
// Convenções:
// - team.line[0] = topo (último a sair); team.line[último] = base (primeiro a sair).
// - session.field = [idSlotA, idSlotB]; session.queue = [PRO, RE, TRI, ...].
// - Comandos são transacionais: operam numa cópia, validam invariantes e só então retornam o novo estado.
import { formationFor } from './constants.js';
import { assignRoles, tacticalDeviation } from './tactics.js';
import { median, mean, sumStars } from './stars.js';
import { newId } from './players.js';
import { syncVests, vestOf, VESTS } from './vests.js';

export const DEFAULT_CONFIG = {
  linePerTeam: 5,
  useGoalkeepers: true,
  requireGkForComplete: false,
  toleranceMin: 10,
};

/** Erro de regra de negócio (mensagem amigável, exibida ao usuário). */
export class RuleError extends Error {}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- criação

/** Cria uma equipe nova na sessão (número sequencial) e calcula as funções. */
export function makeTeam(s, { line = [], gks = [], origin = 'draw', note = '' } = {}) {
  const num = s.nextTeamNum++;
  const team = {
    id: `t${num}`,
    num,
    label: `Time ${num}`,
    line,
    gks,
    permanence: false,
    stats: { wins: 0, draws: 0, losses: 0, drawPermanences: 0, tossWins: 0 },
    origin,
    note,
  };
  s.teams[team.id] = team;
  refreshRoles(s, team);
  return team;
}

/**
 * Cria a sessão (pelada) a partir de um resultado de sorteio.
 * @param {{title, config, snapshots: Record<string,object>, draw, scheduledAt?, id?}} p
 */
export function createSession({ title, config, snapshots, draw, gkOrder = [], scheduledAt = null, id, payments = {} }) {
  const s = {
    id: id || newId('s'),
    title: title || 'Pelada',
    createdAt: nowIso(),
    scheduledAt,
    status: 'draft',
    startedAt: null,
    finishedAt: null,
    config: { ...DEFAULT_CONFIG, ...config },
    snapshot: clone(snapshots),
    active: [],
    bench: [],
    teams: {},
    field: [],
    queue: [],
    nextTeamNum: 1,
    arrivals: [],
    removed: [],
    games: [],
    log: [],
    draws: [],
    seq: 0,
    gkQueue: [],
    payments: { ...payments }, // RN-139: pagamentos marcados na chamada antes do sorteio
  };
  applyDraw(s, draw, gkOrder);
  validate(s);
  return s;
}

function applyDraw(s, draw, gkOrder = []) {
  s.teams = {};
  s.field = [];
  s.queue = [];
  s.nextTeamNum = 1;
  s.bench = [...(draw.unusedGoalkeepers || [])];
  const ids = [];
  for (const t of draw.teams) {
    // RN-134: o sorteio é só de linha; os goleiros entram pela fila de goleiros (ordem de chegada).
    const team = makeTeam(s, { line: t.line.map((x) => ({ pid: x.pid, role: x.role })), gks: [], origin: 'draw' });
    ids.push(team.id);
  }
  s.field = ids.slice(0, 2);
  s.queue = ids.slice(2);
  s.gkQueue = gkOrder.filter((pid) => s.snapshot[pid]?.type === 'gk');
  syncGoalkeepers(s); // 1º goleiro no Time 1, 2º no Time 2, 3º no Time 3…; sobra aguarda time
  s.vests = {};
  syncVests(s); // RN-108: Time 1 começa de Amarelo e Time 2 de Azul
  s.active = [...ids.flatMap((id) => teamPids(s.teams[id])), ...s.gkQueue, ...s.bench];
  s.draws.push({ at: nowIso(), seed: draw.seed, metrics: draw.metrics, ref: draw.ref, teams: snapshotTeams(s) });
  addLog(s, 'draw', `Sorteio realizado: ${ids.length} equipe(s).`, { withoutGk: draw.withoutGk?.map((i) => `Time ${i + 1}`) });
}

/** Refaz o sorteio de uma pelada ainda não iniciada (RN-38, RN-40). */
export function redraw(state, { draw, config, snapshots, gkOrder, payments }) {
  if (state.games.length) throw new RuleError('Não é possível sortear de novo depois que a pelada começou.');
  const s = clone(state);
  if (config) s.config = { ...s.config, ...config };
  if (snapshots) s.snapshot = clone(snapshots);
  if (payments) s.payments = { ...payments };
  s.arrivals = [];
  s.removed = [];
  // Novo sorteio sem mudar participantes: mantém a ordem de chegada dos goleiros (campo + fila).
  applyDraw(s, draw, gkOrder || goalkeeperLineup(s));
  validate(s);
  return s;
}

export function startSession(state) {
  const s = clone(state);
  if (s.status !== 'draft') return s;
  if (s.field.length < 2) throw new RuleError('São necessárias ao menos duas equipes para começar.');
  s.status = 'live';
  s.startedAt = nowIso();
  syncGoalkeepers(s); // rascunho em formato anterior: goleiro que aguardava vai para o time sem goleiro
  addLog(s, 'start', `Pelada iniciada: ${label(s, s.field[0])} x ${label(s, s.field[1])}.`);
  validate(s);
  return s;
}

export function finishSession(state) {
  const s = clone(state);
  s.status = 'finished';
  s.finishedAt = nowIso();
  addLog(s, 'finish', `Pelada encerrada após ${s.games.length} jogo(s).`);
  return s;
}

// ---------------------------------------------------------------- consultas

export function teamPids(team) {
  return [...team.line.map((x) => x.pid), ...team.gks];
}

/**
 * Jogadores de linha numerados de baixo para cima (RN-33a): índice 0 = posição 1 (base, primeiro a sair).
 * @returns {{position:number, pid:string, role:string}[]}
 */
export function linePositions(team) {
  const n = team.line.length;
  return team.line.map((x, i) => ({ position: n - i, pid: x.pid, role: x.role })).reverse();
}

/** Posição (de baixo para cima, 1 = base) de um jogador de linha na equipe, ou 0 se não estiver nela. */
export function positionOf(team, pid) {
  const i = team.line.findIndex((x) => x.pid === pid);
  return i < 0 ? 0 : team.line.length - i;
}

export function label(s, tid) {
  return s.teams[tid]?.label ?? '?';
}

/** RN-59: equipe completa = N de linha. (RN-60, "só é completa com goleiro", vale só para peladas antigas.) */
export function isComplete(s, team) {
  if (!team) return false;
  if (team.line.length < s.config.linePerTeam) return false;
  if (!usesGkQueue(s) && s.config.useGoalkeepers && s.config.requireGkForComplete && team.gks.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------- goleiros (RN-134 a RN-137)

/** Pelada com fila de goleiros (todas as criadas a partir de 2026-11-20). Peladas antigas seguem o modelo anterior. */
export const usesGkQueue = (s) => Array.isArray(s.gkQueue);

/**
 * RN-135/RN-136: cada equipe tem no máximo um goleiro (em campo ou na fila). Goleiros "soltos" ficam em
 * `gkQueue` (goleiros aguardando time) e vão, em ordem, para as equipes sem goleiro na sequência
 * campo (slot A, slot B) → PRO → RE → … (a primeira equipe sem goleiro recebe o primeiro da espera).
 */
export function syncGoalkeepers(s) {
  if (!usesGkQueue(s)) return;
  const order = [...s.field, ...s.queue];
  for (const id of order) {
    const t = s.teams[id];
    if (t.gks.length > 1) s.gkQueue.push(...t.gks.splice(1));
  }
  for (const id of order) {
    const t = s.teams[id];
    if (!t.gks.length && s.gkQueue.length) t.gks.push(s.gkQueue.shift());
  }
}

/** Ordem dos goleiros: os das equipes (campo, PRO, RE…) e depois os que aguardam time. */
export function goalkeeperLineup(s) {
  if (!usesGkQueue(s)) return Object.values(s.teams).flatMap((t) => t.gks);
  return [...[...s.field, ...s.queue].flatMap((id) => s.teams[id].gks), ...s.gkQueue];
}

/** Onde está cada goleiro agora: id da equipe, ou null se aguarda time (para textos de explicação). */
export function goalkeeperPlaces(s) {
  const out = {};
  for (const t of Object.values(s.teams)) for (const g of t.gks) out[g] = t.id;
  for (const g of s.gkQueue || []) out[g] = null;
  return out;
}

/** Rótulo dinâmico de cada equipe: EM JOGO, PRO, RE, TRI, 4º, 5º... */
export function queueLabel(s, tid) {
  if (s.field.includes(tid)) return 'EM JOGO';
  const i = s.queue.indexOf(tid);
  return ['PRO', 'RE', 'TRI'][i] ?? `${i + 1}º`;
}

export function player(s, pid) {
  return s.snapshot[pid];
}

/** Estrelas, formação e completude de uma equipe (sempre a partir do snapshot da pelada). */
export function teamStats(s, team) {
  const ps = team.line.map((x) => s.snapshot[x.pid]);
  const sum = sumStars(ps);
  const counts = { D: 0, M: 0, A: 0 };
  team.line.forEach((x) => x.role && counts[x.role]++);
  const gkStars = team.gks.reduce((a, g) => a + (s.snapshot[g]?.stars || 0), 0);
  return {
    size: ps.length,
    sum,
    avg: ps.length ? sum / ps.length : 0,
    counts,
    deviation: tacticalDeviation(counts, ps.length),
    gkStars,
    complete: isComplete(s, team),
    missing: Math.max(0, s.config.linePerTeam - ps.length),
  };
}

/** Mediana e média das estrelas de todos os jogadores de linha ativos. */
export function lineStarsRef(s) {
  const all = Object.values(s.teams).flatMap((t) => t.line.map((x) => s.snapshot[x.pid].stars));
  return { median: median(all), mean: mean(all) };
}

export function allTeamsInOrder(s) {
  return [...s.field, ...s.queue].map((id) => s.teams[id]);
}

function snapshotTeams(s) {
  return allTeamsInOrder(s).map((t) => ({ id: t.id, label: t.label, line: clone(t.line), gks: [...t.gks] }));
}

/** Escalação completa (com nome e estrelas) para registros de histórico. */
export function teamSnapshot(s, tid) {
  const t = s.teams[tid];
  return {
    id: t.id,
    label: t.label,
    permanence: t.permanence,
    vest: vestOf(s, tid),
    line: t.line.map((x) => ({ pid: x.pid, role: x.role, name: s.snapshot[x.pid].name, stars: s.snapshot[x.pid].stars })),
    gks: t.gks.map((g) => ({ pid: g, name: s.snapshot[g].name, stars: s.snapshot[g].stars })),
  };
}

// ---------------------------------------------------------------- integridade (RN-84)

/** Valida invariantes. Lança erro (e a transação é descartada) se algo estiver inconsistente. */
export function validate(s) {
  const seen = new Map();
  const fail = (m) => {
    throw new Error(`Integridade violada: ${m}`);
  };
  const order = [...s.field, ...s.queue];
  if (s.field.length > 2) fail('mais de duas equipes em campo.');
  if (new Set(order).size !== order.length) fail('equipe repetida entre campo e fila.');
  for (const id of order) if (!s.teams[id]) fail(`equipe ${id} inexistente.`);
  for (const id of Object.keys(s.teams)) if (!order.includes(id)) fail(`equipe ${id} fora do campo e da fila.`);
  const place = (pid, where) => {
    if (seen.has(pid)) fail(`jogador ${s.snapshot[pid]?.name || pid} duplicado (${seen.get(pid)} e ${where}).`);
    seen.set(pid, where);
  };
  for (const id of order) {
    const t = s.teams[id];
    for (const x of t.line) {
      if (!s.snapshot[x.pid]) fail(`jogador ${x.pid} sem snapshot.`);
      if (s.snapshot[x.pid].type !== 'line') fail(`${s.snapshot[x.pid].name} não é jogador de linha.`);
      place(x.pid, t.label);
    }
    for (const g of t.gks) {
      if (s.snapshot[g]?.type !== 'gk') fail(`${s.snapshot[g]?.name || g} não é goleiro.`);
      place(g, t.label);
    }
  }
  for (const b of s.bench) place(b, 'reserva');
  if (usesGkQueue(s)) {
    // RN-135: no máximo um goleiro por equipe; quem sobra aguarda time (e só se todas tiverem goleiro).
    for (const g of s.gkQueue) {
      if (s.snapshot[g]?.type !== 'gk') fail(`${s.snapshot[g]?.name || g} na fila de goleiros não é goleiro.`);
      place(g, 'fila de goleiros');
    }
    for (const id of order) if (s.teams[id].gks.length > 1) fail(`${label(s, id)} com mais de um goleiro.`);
    // (Goleiro aguardando com time sem goleiro não é erro: rascunhos de 2026-11-20 cedo usavam esse formato;
    // syncGoalkeepers corrige na próxima operação ou ao iniciar.)
  }
  if (s.vests) {
    // RN-109: as duas equipes em campo vestem lados diferentes do colete.
    for (const id of Object.keys(s.vests)) if (!s.field.includes(id)) fail(`colete registrado para ${id}, que não está em campo.`);
    const colors = s.field.map((id) => s.vests[id]);
    if (colors.some((c) => !VESTS[c])) fail('equipe em campo sem cor de colete.');
    if (new Set(colors).size !== colors.length) fail('as duas equipes em campo estão com a mesma cor de colete.');
  }
  const act = new Set(s.active);
  if (act.size !== s.active.length) fail('lista de ativos com duplicidade.');
  for (const pid of act) if (!seen.has(pid)) fail(`jogador ${s.snapshot[pid]?.name || pid} desapareceu da partida.`);
  for (const pid of seen.keys()) if (!act.has(pid)) fail(`jogador ${s.snapshot[pid]?.name || pid} não está entre os ativos.`);
  return true;
}

// ---------------------------------------------------------------- utilitários internos do domínio

export function addLog(s, type, text, data = {}) {
  s.seq = (s.seq || 0) + 1;
  s.log.push({ n: s.seq, at: nowIso(), type, text, data });
}

/** Recalcula a função de cada jogador da equipe (RN-27). */
export function refreshRoles(s, team) {
  const ps = team.line.map((x) => ({ id: x.pid, positions: s.snapshot[x.pid].positions }));
  const { roles } = assignRoles(ps, formationFor(ps.length));
  team.line.forEach((x) => (x.role = roles[x.pid]));
}

/** Executa `fn` numa cópia do estado, valida e retorna `{ state, ...resultado }` (RN-83). */
export function transact(state, fn) {
  const s = clone(state);
  const out = fn(s) || {};
  syncGoalkeepers(s); // goleiros acompanham qualquer mudança de campo (RN-135)
  syncVests(s); // coletes acompanham qualquer mudança de campo (RN-109 a RN-111)
  validate(s);
  return { state: s, ...out };
}

export function removeTeam(s, tid) {
  delete s.teams[tid];
  s.queue = s.queue.filter((x) => x !== tid);
  s.field = s.field.filter((x) => x !== tid);
}

/** Completa o campo com as primeiras da fila quando há menos de duas equipes jogando. */
export function fillField(s) {
  while (s.field.length < 2 && s.queue.length) s.field.push(s.queue.shift());
}
