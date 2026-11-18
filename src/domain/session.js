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
  tossOnFirstGameEvenWithTwoWaiting: false,
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
export function createSession({ title, config, snapshots, draw, scheduledAt = null, id }) {
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
  };
  applyDraw(s, draw);
  validate(s);
  return s;
}

function applyDraw(s, draw) {
  s.teams = {};
  s.field = [];
  s.queue = [];
  s.nextTeamNum = 1;
  s.bench = [...(draw.unusedGoalkeepers || [])];
  const ids = [];
  for (const t of draw.teams) {
    const team = makeTeam(s, { line: t.line.map((x) => ({ pid: x.pid, role: x.role })), gks: [...t.gks], origin: 'draw' });
    ids.push(team.id);
  }
  s.field = ids.slice(0, 2);
  s.queue = ids.slice(2);
  s.vests = {};
  syncVests(s); // RN-108: Time 1 começa de Amarelo e Time 2 de Azul
  s.active = [...ids.flatMap((id) => teamPids(s.teams[id])), ...s.bench];
  s.draws.push({ at: nowIso(), seed: draw.seed, metrics: draw.metrics, ref: draw.ref, teams: snapshotTeams(s) });
  addLog(s, 'draw', `Sorteio realizado: ${ids.length} equipe(s).`, { withoutGk: draw.withoutGk?.map((i) => `Time ${i + 1}`) });
}

/** Refaz o sorteio de uma pelada ainda não iniciada (RN-38, RN-40). */
export function redraw(state, { draw, config, snapshots }) {
  if (state.games.length) throw new RuleError('Não é possível sortear de novo depois que a pelada começou.');
  const s = clone(state);
  if (config) s.config = { ...s.config, ...config };
  if (snapshots) s.snapshot = clone(snapshots);
  s.arrivals = [];
  s.removed = [];
  applyDraw(s, draw);
  validate(s);
  return s;
}

export function startSession(state) {
  const s = clone(state);
  if (s.status !== 'draft') return s;
  if (s.field.length < 2) throw new RuleError('São necessárias ao menos duas equipes para começar.');
  s.status = 'live';
  s.startedAt = nowIso();
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

/** RN-59/RN-60: N de linha e, se configurado, goleiro. */
export function isComplete(s, team) {
  if (!team) return false;
  if (team.line.length < s.config.linePerTeam) return false;
  if (s.config.useGoalkeepers && s.config.requireGkForComplete && team.gks.length === 0) return false;
  return true;
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
