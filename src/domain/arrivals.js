// Jogadores atrasados (PRD seção 10): ordem de chegada, sem novo sorteio e sem reorganizar equipes.
import { RuleError, transact, clone, nowIso, makeTeam, refreshRoles, fillField, addLog, usesGkQueue, syncGoalkeepers, goalkeeperPlaces } from './session.js';
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
      // RN-137: goleiro atrasado vai para o próximo time da sequência (campo → PRO → RE…) sem goleiro;
      // se todos têm goleiro, aguarda no fim da fila de goleiros.
      s.gkQueue.push(snap.id);
      syncGoalkeepers(s);
      const at = goalkeeperPlaces(s)[snap.id];
      text = at
        ? `${snap.name} (goleiro) chegou (${order}º atrasado) e foi para o gol do ${s.teams[at].label}.`
        : `${snap.name} (goleiro) chegou (${order}º atrasado); todos os times já têm goleiro e ele aguarda no fim da fila de goleiros (${s.gkQueue.indexOf(snap.id) + 1}º).`;
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
