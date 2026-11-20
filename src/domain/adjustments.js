// Ajustes manuais do organizador: transferência, ordem, troca, goleiros e correção de permanência.
// (PRD seções 6 e 12; RN-37, RN-66, RN-79, RN-80)
import { RuleError, transact, clone, refreshRoles, removeTeam, fillField, addLog, teamStats, allTeamsInOrder, usesGkQueue, goalkeeperLineup } from './session.js';
import { balanceWarnings } from './balance.js';

/**
 * Move os `k` jogadores das posições 1..k (base) de `from` para as vagas de cima de `to`
 * (posições R+1..R+k, onde R = atletas atuais do destino). A posição 1 da origem vira R+1, a 2 vira R+2...
 * Quem fica na origem é renumerado a partir de 1; quem já estava no destino não muda (RN-79).
 * @returns {object[]} itens movidos, em ordem topo → base
 */
function moveBlock(from, to, k) {
  const moved = from.line.splice(from.line.length - k, k);
  to.line.unshift(...moved);
  return moved;
}

/** Simula (sem aplicar) a transferência dos `qty` jogadores da base de `fromId` para `toId`. */
export function simulateTransfer(s, fromId, toId, qty) {
  const from = s.teams[fromId];
  const to = s.teams[toId];
  if (!from || !to || fromId === toId) throw new RuleError('Escolha equipes diferentes.');
  const k = Math.max(0, Math.min(qty, from.line.length));
  const firstTarget = to.line.length + 1;
  // de baixo para cima: posição 1 da origem primeiro
  const moving = from.line.slice(from.line.length - k).reverse().map((x, i) => ({ ...x, fromPosition: i + 1, toPosition: firstTarget + i }));
  const tmp = clone(s);
  const tf = tmp.teams[fromId];
  const tt = tmp.teams[toId];
  moveBlock(tf, tt, k);
  refreshRoles(tmp, tf);
  refreshRoles(tmp, tt);
  const n = s.config.linePerTeam;
  return {
    k,
    moving: moving.map((x) => ({ ...x, name: s.snapshot[x.pid].name, stars: s.snapshot[x.pid].stars })),
    from: { label: from.label, before: teamStats(s, from), after: teamStats(tmp, tf) },
    to: { label: to.label, before: teamStats(s, to), after: teamStats(tmp, tt) },
    overflow: tt.line.length > n ? tt.line.length - n : 0,
    warnings: [...(tt.line.length > n ? [`${to.label} ficará com ${tt.line.length} jogadores de linha (acima de ${n}).`] : []), ...balanceWarnings(tmp, tt)],
  };
}

export function transferPlayers(state, fromId, toId, qty) {
  return transact(state, (s) => {
    const sim = simulateTransfer(s, fromId, toId, qty);
    if (!sim.k) throw new RuleError('Nenhum jogador para transferir.');
    const from = s.teams[fromId];
    const to = s.teams[toId];
    moveBlock(from, to, sim.k);
    refreshRoles(s, from);
    refreshRoles(s, to);
    const detail = sim.moving.map((x) => `${x.name} pos. ${x.fromPosition} → ${x.toPosition}`).join(', ');
    const moved = sim.moving;
    const text = `Transferência ${from.label} → ${to.label}: ${detail}.`;
    if (from.line.length === 0 && usesGkQueue(s)) s.gkQueue.push(...from.gks.splice(0)); // goleiro fica solto (RN-135)
    if (from.line.length === 0 && from.gks.length === 0) {
      removeTeam(s, fromId);
      fillField(s);
    }
    addLog(s, 'transfer', text, { fromId, toId, pids: moved.map((x) => x.pid) });
    return { message: text };
  });
}

/**
 * Troca o jogador de posição com o vizinho. `positionDelta` em posições (de baixo para cima):
 * +1 = sobe (posição 2 → 3, sai mais tarde); -1 = desce (posição 2 → 1, sai mais cedo).
 */
export function movePlayerInOrder(state, tid, pid, positionDelta) {
  return transact(state, (s) => {
    const t = s.teams[tid];
    const i = t.line.findIndex((x) => x.pid === pid);
    const j = i - positionDelta; // array é topo → base: subir de posição = índice menor
    if (i < 0 || j < 0 || j >= t.line.length) return { message: '' };
    [t.line[i], t.line[j]] = [t.line[j], t.line[i]];
    const from = t.line.length - i;
    const to = t.line.length - j;
    addLog(s, 'order', `Ordem do ${t.label}: ${s.snapshot[pid].name} passou da posição ${from} para a ${to}.`);
    return { message: '' };
  });
}

/** Troca dois jogadores de linha (cada um assume o lugar do outro na ordem). */
export function swapPlayers(state, pidA, pidB) {
  return transact(state, (s) => {
    const find = (pid) => {
      for (const t of allTeamsInOrder(s)) {
        const i = t.line.findIndex((x) => x.pid === pid);
        if (i >= 0) return { t, i };
      }
      throw new RuleError('Jogador não encontrado.');
    };
    const a = find(pidA);
    const b = find(pidB);
    [a.t.line[a.i], b.t.line[b.i]] = [b.t.line[b.i], a.t.line[a.i]];
    refreshRoles(s, a.t);
    if (b.t !== a.t) refreshRoles(s, b.t);
    const text = `Troca: ${s.snapshot[pidA].name} (${a.t.label}) ⇄ ${s.snapshot[pidB].name} (${b.t.label}).`;
    addLog(s, 'swap', text);
    return { message: text };
  });
}

/** Move um goleiro para outra equipe (ou para a reserva com toId = null). RN-21. */
export function moveGoalkeeper(state, pid, toId) {
  return transact(state, (s) => {
    let from = null;
    for (const t of Object.values(s.teams)) if (t.gks.includes(pid)) from = t;
    if (from) from.gks = from.gks.filter((g) => g !== pid);
    else if (s.bench.includes(pid)) s.bench = s.bench.filter((b) => b !== pid);
    else throw new RuleError('Goleiro não encontrado.');
    if (toId) s.teams[toId].gks.push(pid);
    else s.bench.push(pid);
    if (from && from.line.length === 0 && from.gks.length === 0) removeTeam(s, from.id);
    const text = `Goleiro ${s.snapshot[pid].name}: ${from ? from.label : 'reserva'} → ${toId ? s.teams[toId].label : 'reserva'}.`;
    addLog(s, 'gk', text);
    return { message: text };
  });
}

/**
 * RN-137: muda a posição de um goleiro na ordem do dia. A ordem segue as vagas de goleiro existentes
 * (times com goleiro: campo → PRO → RE…, depois quem aguarda time); mudar a posição troca os goleiros
 * de time, sem criar nem tirar vaga. `to` = nova posição 1, 2, 3… ou 'end' (última posição).
 */
export function moveGoalkeeperInLineup(state, pid, to) {
  return transact(state, (s) => {
    if (!usesGkQueue(s)) throw new RuleError('Esta pelada usa o modelo antigo de goleiros.');
    const slots = [...s.field, ...s.queue].filter((id) => s.teams[id].gks.length);
    const lineup = goalkeeperLineup(s);
    const from = lineup.indexOf(pid);
    if (from < 0) throw new RuleError('Goleiro não encontrado.');
    lineup.splice(from, 1);
    const idx = to === 'end' ? lineup.length : Math.max(0, Math.min(lineup.length, Number(to) - 1));
    lineup.splice(idx, 0, pid);
    for (const id of slots) s.teams[id].gks = [lineup.shift()];
    s.gkQueue = lineup;
    const place = slots.find((id) => s.teams[id].gks[0] === pid);
    const text = place
      ? `Goleiro ${s.snapshot[pid].name} passou para o gol do ${s.teams[place].label}.`
      : `Goleiro ${s.snapshot[pid].name} passou a ser o ${s.gkQueue.indexOf(pid) + 1}º aguardando time.`;
    addLog(s, 'gk', text);
    return { message: text };
  });
}

/** Correção manual de qual time defende permanência (RN-66). Mantém a RN-53. */
export function setPermanence(state, tid, value) {
  return transact(state, (s) => {
    if (!s.field.includes(tid)) throw new RuleError('Só times em campo podem defender permanência.');
    const other = s.field.find((x) => x !== tid);
    s.teams[tid].permanence = !!value;
    if (value && other) s.teams[other].permanence = false;
    const text = `Ajuste manual: ${s.teams[tid].label} ${value ? 'defende' : 'não defende'} permanência.`;
    addLog(s, 'adjust', text);
    return { message: text };
  });
}
