// Lesões, saídas antecipadas e reposição automática em cascata (PRD seção 11).
import { REMOVAL_REASONS } from './constants.js';
import { RuleError, transact, nowIso, allTeamsInOrder, refreshRoles, removeTeam, fillField, addLog } from './session.js';

/**
 * Retira jogador somente da pelada atual (RN-74, RN-75) e repõe a vaga automaticamente (RN-76 a RN-78).
 * Não mexe no cadastro.
 */
export function removePlayer(state, pid, reason = 'other', note = '') {
  return transact(state, (s) => {
    if (!s.active.includes(pid)) throw new RuleError('Jogador não está participando.');
    let fromTeam = null;
    let index = -1;
    let position = null;
    let role = null;
    let wasGk = false;
    for (const t of allTeamsInOrder(s)) {
      const i = t.line.findIndex((x) => x.pid === pid);
      if (i >= 0) {
        fromTeam = t;
        index = i;
        position = t.line.length - i; // numeração de baixo para cima
        role = t.line[i].role;
        t.line.splice(i, 1);
        break;
      }
      const g = t.gks.indexOf(pid);
      if (g >= 0) {
        fromTeam = t;
        wasGk = true;
        t.gks.splice(g, 1);
        break;
      }
    }
    if (!fromTeam) s.bench = s.bench.filter((b) => b !== pid);
    s.active = s.active.filter((x) => x !== pid);
    const p = s.snapshot[pid];
    const info = {
      pid, name: p.name, stars: p.stars, reason, note, at: nowIso(),
      teamId: fromTeam?.id || null, teamLabel: fromTeam?.label || 'reserva', index, position, role, wasGk,
    };
    s.removed.push(info);
    const motivo = `${REMOVAL_REASONS[reason] || reason}${note ? `: ${note}` : ''}`;
    const text = `${p.name} saiu da pelada (${motivo})${fromTeam ? ` — ${fromTeam.label}${wasGk ? ', goleiro' : `, pos. ${position}`}` : ''}.`;
    addLog(s, 'remove', text, info);
    let moves = [];
    if (fromTeam) {
      refreshRoles(s, fromTeam);
      moves = wasGk ? cascadeGoalkeeper(s, fromTeam.id) : cascadeLine(s, fromTeam.id);
      for (const m of moves) addLog(s, 'move', m);
    }
    return { message: [text, ...moves].join(' '), summary: text, removal: info, moves };
  });
}

/**
 * Esteira de "subir a lista" para jogador de linha (RN-76, RN-77).
 * A vaga em `teamId` é suprida pela posição 1 (próximo a sair) da equipe seguinte na ordem
 * campo → PRO → RE → TRI…; quem entra ocupa a vaga de cima (mesma regra do rodízio, RN-45).
 * A vaga passa então para a equipe que cedeu, e assim por diante até a última da fila, que fica
 * com uma vaga a menos. Equipe em campo é reposta pelo PRO; equipe da fila, pela seguinte.
 * Se a vaga é na última equipe da fila (ou não há fila), ela fica aberta.
 * @returns {string[]} descrição das movimentações
 */
function cascadeLine(s, teamId) {
  const moves = [];
  let target = s.teams[teamId];
  for (const src of nextTeams(s, teamId)) {
    if (!src.line.length) continue;
    const item = src.line.pop(); // posição 1 da origem
    target.line.unshift(item); // vaga de cima do destino
    refreshRoles(s, target);
    refreshRoles(s, src);
    moves.push(`${s.snapshot[item.pid].name} (pos. 1 do ${src.label}) entrou no ${target.label} na pos. ${target.line.length}.`);
    target = src;
  }
  if (moves.length) moves.push(`A vaga ficou no ${target.label}, último da fila.`);
  else moves.push(`Sem fila depois do ${target.label}: a vaga fica aberta.`);
  cleanupEmpty(s, moves);
  return moves;
}

/**
 * Goleiro retirado: a mesma esteira, só entre equipes com goleiro (RN-78).
 * A próxima equipe na ordem que tem goleiro cede um; se ainda ficar com goleiro, a cascata para.
 */
function cascadeGoalkeeper(s, teamId) {
  const moves = [];
  if (!s.config.useGoalkeepers) return moves;
  let target = s.teams[teamId];
  if (target.gks.length) return moves; // ainda tem goleiro: nada a repor
  for (const src of nextTeams(s, teamId)) {
    if (!src.gks.length) continue;
    const g = src.gks.shift();
    target.gks.push(g);
    moves.push(`Goleiro ${s.snapshot[g].name} saiu do ${src.label} e foi para o ${target.label}.`);
    if (src.gks.length) return moves;
    target = src;
  }
  moves.push(moves.length ? `O ${target.label} ficou sem goleiro.` : `Nenhuma equipe seguinte tem goleiro: ${target.label} fica sem goleiro.`);
  cleanupEmpty(s, moves);
  return moves;
}

/** Equipes depois de `teamId` na esteira: campo → fila (PRO, RE…); da fila, só as seguintes. */
function nextTeams(s, teamId) {
  const ids = s.field.includes(teamId) ? [...s.queue] : s.queue.slice(s.queue.indexOf(teamId) + 1);
  return ids.map((id) => s.teams[id]);
}

/** Remove equipes que ficaram vazias; se o campo ficar com menos de dois, a próxima da fila entra (RN-75). */
function cleanupEmpty(s, moves) {
  for (const t of allTeamsInOrder(s)) {
    if (t.line.length === 0 && t.gks.length === 0) {
      removeTeam(s, t.id);
      moves.push(`${t.label} ficou vazio e foi desfeito.`);
    }
  }
  fillField(s);
}
