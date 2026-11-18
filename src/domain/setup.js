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
export function planParticipation(players, selectedIds, config) {
  const sel = new Set(selectedIds);
  const chosen = players.filter((p) => sel.has(p.id));
  const line = chosen.filter((p) => p.type === 'line');
  const goalkeepers = chosen.filter((p) => p.type === 'gk');
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
    goalkeeperNote: goalkeeperNote(config.useGoalkeepers, goalkeepers.length, sizes.length),
  };
}

/** Texto sobre a distribuição de goleiros prevista (RN-20). */
export function goalkeeperNote(useGoalkeepers, gkCount, teamCount) {
  if (!useGoalkeepers || !teamCount) return '';
  if (gkCount === 0) return 'Nenhum goleiro presente.';
  if (gkCount < teamCount) return `${gkCount} goleiro(s) para ${teamCount} equipes: ${teamCount - gkCount} ficará(ão) sem goleiro.`;
  if (gkCount > teamCount) return `${gkCount - teamCount} goleiro(s) excedente(s) serão distribuídos de forma equilibrada.`;
  return 'Um goleiro por equipe.';
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
export function prepareDraw({ players, selectedIds, config, settings = {}, seed }) {
  const plan = planParticipation(players, selectedIds, config);
  if (!plan.lineCount) throw new RuleError('Selecione jogadores de linha.');
  const finalConfig = {
    ...config,
    linePerTeam: clampLinePerTeam(config.linePerTeam),
    toleranceMin: clampTolerance(settings.toleranceMin ?? DEFAULT_TOLERANCE_MIN),
    tossOnFirstGameEvenWithTwoWaiting: !!settings.tossOnFirstGameEvenWithTwoWaiting,
  };
  const snapshots = Object.fromEntries(plan.chosen.map((p) => [p.id, snapshotPlayer(p)]));
  const draw = drawTeams({
    line: plan.line,
    goalkeepers: plan.goalkeepers,
    linePerTeam: finalConfig.linePerTeam,
    useGoalkeepers: finalConfig.useGoalkeepers,
    seed,
  });
  return { draw, snapshots, config: finalConfig, plan };
}
