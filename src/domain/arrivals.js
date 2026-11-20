// Jogadores atrasados (PRD seção 10): ordem de chegada, sem novo sorteio e sem reorganizar equipes.
import { RuleError, transact, clone, nowIso, makeTeam, refreshRoles, fillField, addLog, usesGkQueue } from './session.js';
import { balanceWarnings } from './balance.js';

/**
 * Linha (RN-69): estritamente por ordem de chegada, sem considerar estrelas nem posições.
 * Se a última equipe da fila tem R atletas (posições 1..R, de baixo para cima), o atrasado ocupa a
 * posição R+1; quem já estava não muda de posição. Equipe completa → abre nova equipe na posição 1.
 * Goleiro (RN-70): primeira equipe sem goleiro (PRO, RE..., depois campo); sem goleiros → reserva.
 * @param {object} snap snapshot do jogador (ver snapshotPlayer)
 */
export function addLatePlayer(state, snap) {
  return transact(state, (s) => {
    if (s.status === 'finished') throw new RuleError('Pelada encerrada.');
    if (s.active.includes(snap.id)) throw new RuleError(`${snap.name} já está participando.`);
    s.snapshot[snap.id] = clone(snap);
    s.active.push(snap.id);
    for (const r of s.removed) if (r.pid === snap.id) r.returned = true; // RN-73
    const order = s.arrivals.length + 1;
    s.arrivals.push({ pid: snap.id, at: nowIso(), order });
    const warnings = [];
    let text;
    if (snap.type === 'gk' && usesGkQueue(s)) {
      // RN-137: goleiro atrasado vai para o fim da fila de goleiros; se um time em campo está sem
      // goleiro, ele assume na hora (syncGoalkeepers, no fim da transação).
      s.gkQueue.push(snap.id);
      const pos = s.gkQueue.length;
      const fieldWithout = s.field.find((id) => !s.teams[id].gks.length);
      text = fieldWithout && pos === 1
        ? `${snap.name} (goleiro) chegou (${order}º atrasado) e assumiu o gol do ${s.teams[fieldWithout].label}.`
        : `${snap.name} (goleiro) chegou (${order}º atrasado) e entrou no fim da fila de goleiros (${pos}º da fila).`;
    } else if (snap.type === 'gk') {
      if (!s.config.useGoalkeepers) {
        s.bench.push(snap.id);
        text = `${snap.name} (goleiro) chegou e ficou como reserva (sorteio sem goleiros).`;
      } else {
        const candidates = [...s.queue, ...s.field].map((id) => s.teams[id]);
        let target = candidates.find((t) => t.gks.length === 0);
        if (!target) target = s.teams[s.queue[s.queue.length - 1] ?? s.field[s.field.length - 1]];
        if (!target) {
          target = makeTeam(s, { origin: 'late' });
          s.queue.push(target.id);
        }
        target.gks.push(snap.id);
        text = `${snap.name} (goleiro) chegou (${order}º atrasado) e foi para ${target.label}.`;
      }
    } else {
      const n = s.config.linePerTeam;
      const lastId = s.queue.length ? s.queue[s.queue.length - 1] : s.field.length < 2 ? s.field[s.field.length - 1] : null;
      let target = lastId ? s.teams[lastId] : null;
      if (target && target.line.length < n) {
        target.line.unshift({ pid: snap.id, role: null }); // próxima vaga de cima: posição R+1
        text = `${snap.name} chegou (${order}º atrasado) e ocupou a posição ${target.line.length} do ${target.label}.`;
      } else {
        target = makeTeam(s, { line: [{ pid: snap.id, role: null }], origin: 'late' });
        s.queue.push(target.id);
        text = `${snap.name} chegou (${order}º atrasado) e abriu o ${target.label} (em formação) na posição 1.`;
      }
      refreshRoles(s, target);
      warnings.push(...balanceWarnings(s, target));
    }
    if (s.status === 'draft') fillField(s);
    addLog(s, 'late', text, { pid: snap.id, order });
    return { message: text, warnings };
  });
}
