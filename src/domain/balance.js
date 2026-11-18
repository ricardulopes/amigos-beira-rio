// Avisos de desequilíbrio (RN-72). Apenas informam — nunca reorganizam equipes.
import { teamStats, allTeamsInOrder, isComplete, lineStarsRef } from './session.js';
import { mean, formatStars } from './stars.js';

export const BALANCE_THRESHOLDS = {
  completeSumDiff: 1.5, // equipe completa vs média das demais completas (estrelas)
  formingAvgDiff: 0.75, // média da equipe em formação vs mediana do grupo
  tacticalDeviation: 2, // jogadores fora da formação
};

export function balanceWarnings(s, team) {
  const st = teamStats(s, team);
  const out = [];
  const others = allTeamsInOrder(s).filter((t) => t.id !== team.id && isComplete(s, t));
  if (st.complete && others.length) {
    const avgSum = mean(others.map((t) => teamStats(s, t).sum));
    const diff = st.sum - avgSum;
    if (Math.abs(diff) >= BALANCE_THRESHOLDS.completeSumDiff) {
      out.push(`${team.label} ficou ${diff > 0 ? 'mais forte' : 'mais fraco'} que a média dos completos (${formatStars(st.sum)} vs ${formatStars(avgSum)} estrelas).`);
    }
  } else if (!st.complete && st.size >= 2) {
    const ref = lineStarsRef(s).median;
    if (Math.abs(st.avg - ref) >= BALANCE_THRESHOLDS.formingAvgDiff) {
      out.push(`${team.label} (em formação) está com média ${formatStars(st.avg)}, distante da mediana do grupo (${formatStars(ref)}).`);
    }
  }
  if (st.size >= 2 && st.deviation >= BALANCE_THRESHOLDS.tacticalDeviation) {
    out.push(`${team.label} está taticamente desbalanceado (${st.counts.D}-${st.counts.M}-${st.counts.A}).`);
  }
  return out;
}
