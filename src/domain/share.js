// Texto para compartilhamento (WhatsApp).
import { ROLE_SHORT } from './constants.js';
import { allTeamsInOrder, queueLabel, teamStats, linePositions, usesGkQueue } from './session.js';
import { starsText, formatStars } from './stars.js';
import { vestOf, VESTS } from './vests.js';

export function shareText(s, { includeOrder = true, includeStars = true, includeRoles = false } = {}) {
  const lines = [];
  lines.push(`*${s.title.toUpperCase()}*`);
  lines.push(new Date(s.createdAt).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }));
  lines.push(`${s.config.linePerTeam} na linha${s.config.useGoalkeepers ? ' + goleiro' : ''}`);
  for (const t of allTeamsInOrder(s)) {
    const st = teamStats(s, t);
    lines.push('');
    const tag = queueLabel(s, t.id);
    const v = vestOf(s, t.id);
    const vest = v ? ` ${VESTS[v].emoji} colete ${VESTS[v].name}` : '';
    lines.push(`*${t.label.toUpperCase()}* — ${tag}${vest}${st.complete ? '' : ` (em formação: ${st.size}/${s.config.linePerTeam})`}${includeStars ? ` · ${formatStars(st.sum)}⭐` : ''}`);
    for (const g of t.gks) {
      const p = s.snapshot[g];
      lines.push(`🧤 ${p.name}${includeStars ? ` ${starsText(p.stars)}` : ''}`);
    }
    // Mesma disposição das telas: topo (posição N) em cima, posição 1 (base) embaixo.
    for (const x of linePositions(t).reverse()) {
      const p = s.snapshot[x.pid];
      const prefix = includeOrder ? `${x.position}. ` : '- ';
      const role = includeRoles && x.role ? ` (${ROLE_SHORT[x.role]})` : '';
      const exit = includeOrder && x.position === 1 ? ' ⬅ sai 1º' : '';
      lines.push(`${prefix}${p.name}${includeStars ? ` ${starsText(p.stars)}` : ''}${role}${exit}`);
    }
    if (usesGkQueue(s) && !t.gks.length) lines.push('🧤 (aguardando goleiro)');
    else if (!usesGkQueue(s) && s.config.useGoalkeepers && !t.gks.length) lines.push('🧤 (sem goleiro)');
  }
  // RN-135: goleiros que sobraram (todos os times já têm goleiro), em ordem.
  if (usesGkQueue(s) && s.gkQueue.length) {
    lines.push('');
    lines.push(`🧤 *GOLEIROS AGUARDANDO TIME:* ${s.gkQueue.map((g, i) => `${i + 1}º ${s.snapshot[g].name}`).join(', ')}`);
  }
  if (includeOrder) {
    lines.push('');
    lines.push('_Posições de baixo para cima: a 1 sai primeiro se o time perder; quem chega ocupa a próxima posição livre._');
  }
  return lines.join('\n');
}
