// Preparação da pelada (PRD seções 3, 4 e 7): plano de equipes, goleiros, tolerância,
// limites de configuração e montagem dos dados do sorteio a partir da seleção de presentes.
import { MIN_LINE_PER_TEAM, MAX_LINE_PER_TEAM, DEFAULT_LINE_PER_TEAM, DEFAULT_TOLERANCE_MIN } from './constants.js';
import { snapshotPlayer } from './players.js';
import { drawTeams, planTeamSizes } from './draw.js';
import { RuleError } from './session.js';

export const LIMITS = {
  linePerTeam: { min: MIN_LINE_PER_TEAM, max: MAX_LINE_PER_TEAM },
  toleranceMin: { min: 0, max: 120 },
  transferQty: { min: 1, max: MAX_LINE_PER_TEAM },
};

function clamp(value, { min, max }, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export const clampLinePerTeam = (v) => clamp(v, LIMITS.linePerTeam, DEFAULT_LINE_PER_TEAM);
export const clampTolerance = (v) => clamp(v, LIMITS.toleranceMin, DEFAULT_TOLERANCE_MIN);
export const clampTransferQty = (v) => clamp(v, LIMITS.transferQty, 1);

/**
 * Plano da pelada a partir dos presentes (RN-09, RN-14 a RN-16, RN-20).
 * @param {object[]} players cadastro completo
 * @param {string[]} selectedIds presentes marcados
 * @param {{linePerTeam:number, useGoalkeepers:boolean}} config
 */
export function planParticipation(players, selectedIds, config, gkOrder = []) {
  const sel = new Set(selectedIds);
  const chosen = players.filter((p) => sel.has(p.id));
  const line = chosen.filter((p) => p.type === 'line');
  const byId = new Map(players.map((p) => [p.id, p]));
  const goalkeepers = goalkeeperOrder(players, selectedIds, gkOrder).map((id) => byId.get(id));
  const n = config.linePerTeam;
  const sizes = planTeamSizes(line.length, n);
  const fullCount = sizes.filter((x) => x === n).length;
  const remainder = sizes.find((x) => x < n) || 0;
  return {
    chosen,
    line,
    goalkeepers,
    lineCount: line.length,
    gkCount: goalkeepers.length,
    total: chosen.length,
    sizes,
    teamCount: sizes.length,
    fullCount,
    remainder,
    goalkeeperNote: goalkeeperNote(goalkeepers.length, sizes.length),
  };
}

/**
 * RN-134: ordem de chegada dos goleiros presentes. Usa a ordem definida pelo admin (`gkOrder`) e coloca
 * no fim, na ordem em que foram marcados, os goleiros presentes que ainda não estão nela.
 */
export function goalkeeperOrder(players, selectedIds, gkOrder = []) {
  const gk = new Set(players.filter((p) => p.type === 'gk').map((p) => p.id));
  const sel = selectedIds.filter((id) => gk.has(id));
  const present = new Set(sel);
  const out = gkOrder.filter((id) => present.has(id));
  for (const id of sel) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * RN-135: para onde vai cada goleiro da ordem de chegada no sorteio — o 1º para o Time 1, o 2º para o Time 2…
 * Quem passa do número de times aguarda time (team = null).
 */
export function goalkeeperPreview(order, teamCount) {
  return order.map((pid, i) => ({ pid, position: i + 1, team: i < teamCount ? i + 1 : null }));
}

/** Sobe (delta = -1) ou desce (+1) um goleiro na ordem de chegada. Puro. */
export function moveInGoalkeeperOrder(order, pid, delta) {
  const list = [...order];
  const i = list.indexOf(pid);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/** Texto sobre os goleiros do dia (RN-135): o 1º vai para o Time 1, o 2º para o Time 2, e assim por diante. */
export function goalkeeperNote(gkCount, teamCount) {
  if (!teamCount) return '';
  if (gkCount === 0) return 'Nenhum goleiro presente: os times ficam aguardando goleiro.';
  if (gkCount < teamCount) return `${gkCount} goleiro(s): do Time 1 ao Time ${gkCount}; ${teamCount - gkCount} time(s) aguardando goleiro.`;
  if (gkCount === teamCount) return 'Um goleiro para cada time, pela ordem de chegada.';
  return `Um goleiro para cada time; ${gkCount - teamCount} aguarda(m) time.`;
}

/**
 * Horário recomendado para o sorteio: horário combinado + tolerância (RN-11). Apenas informativo.
 * @param {string} scheduled 'HH:MM' (vazio = sem horário)
 * @returns {null | {drawAt: Date, minutesLeft: number, released: boolean}}
 */
export function toleranceInfo(scheduled, toleranceMin, now = new Date()) {
  if (!scheduled || !/^\d{1,2}:\d{2}$/.test(scheduled)) return null;
  const [h, m] = scheduled.split(':').map(Number);
  const drawAt = new Date(now);
  drawAt.setHours(h, m + clampTolerance(toleranceMin), 0, 0);
  const minutesLeft = Math.round((drawAt - now) / 60000);
  return { drawAt, minutesLeft, released: minutesLeft <= 0 };
}

export function defaultTitle(groupName, date = new Date()) {
  return `${groupName || 'Pelada'} de ${date.toLocaleDateString('pt-BR', { weekday: 'long' })}`;
}

/**
 * Monta tudo o que é preciso para criar/refazer a pelada: sorteio, snapshots e configuração final.
 * @param {{players, selectedIds, config, settings, seed?}} p
 * @returns {{draw, snapshots, config, plan}}
 */
export function prepareDraw({ players, selectedIds, config, settings = {}, seed, gkOrder = [] }) {
  const plan = planParticipation(players, selectedIds, config, gkOrder);
  if (!plan.lineCount) throw new RuleError('Selecione jogadores de linha.');
  const finalConfig = {
    ...config,
    // RN-134: as opções "sortear com/sem goleiros" e "só é completa com goleiro" saíram; goleiros sempre pela fila.
    useGoalkeepers: true,
    requireGkForComplete: false,
    linePerTeam: clampLinePerTeam(config.linePerTeam),
    toleranceMin: clampTolerance(settings.toleranceMin ?? DEFAULT_TOLERANCE_MIN),
  };
  const snapshots = Object.fromEntries(plan.chosen.map((p) => [p.id, snapshotPlayer(p)]));
  // RN-134: o sorteio é estritamente de linha; goleiros nunca entram nele.
  const draw = drawTeams({ line: plan.line, goalkeepers: [], linePerTeam: finalConfig.linePerTeam, useGoalkeepers: false, seed });
  return { draw, snapshots, config: finalConfig, plan, gkOrder: plan.goalkeepers.map((p) => p.id) };
}
