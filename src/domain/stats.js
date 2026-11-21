// Estatísticas e resumos calculados a partir do estado da pelada (somente leitura).
import { allTeamsInOrder, isComplete, teamStats, lineStarsRef, usesGkQueue } from './session.js';
import { range, mean, sumStars } from './stars.js';
import { exitGroups, incompleteTarget } from './draw.js';

/** Grupos de saída (1, 2 e 3 primeiros a sair) de uma equipe da pelada (RN-35). */
export function teamExitGroups(s, team) {
  const ps = team.line.map((x) => ({ ...s.snapshot[x.pid], id: x.pid }));
  const roles = Object.fromEntries(team.line.map((x) => [x.pid, x.role]));
  return exitGroups(ps, roles);
}

/** Desempenho por jogador a partir dos registros de jogos (RN-88). */
export function playerStats(s) {
  const st = {};
  const touch = (pid, name) => (st[pid] ||= { pid, name, games: 0, wins: 0, draws: 0, losses: 0 });
  for (const g of s.games) {
    const sides = [
      [g.teamA, g.result === 'A' ? 'w' : g.result === 'B' ? 'l' : 'd'],
      [g.teamB, g.result === 'B' ? 'w' : g.result === 'A' ? 'l' : 'd'],
    ];
    for (const [t, r] of sides) {
      for (const p of [...t.line, ...t.gks]) {
        const x = touch(p.pid, p.name);
        x.games++;
        if (r === 'w') x.wins++;
        else if (r === 'l') x.losses++;
        else x.draws++;
      }
    }
  }
  return Object.values(st).sort((a, b) => b.wins - a.wins || b.draws - a.draws || a.name.localeCompare(b.name));
}

/** Resumo do equilíbrio atual das equipes (tela de resultado do sorteio). */
export function balanceSummary(s) {
  const teams = allTeamsInOrder(s);
  const full = teams.filter((t) => isComplete(s, t));
  const fullStats = full.map((t) => teamStats(s, t));
  const ref = lineStarsRef(s);
  const n = s.config.linePerTeam;
  // equipe em formação (a última com menos de N): soma atual × Alvo_Incompleto (RN-29)
  const formingTeam = [...teams].reverse().find((t) => t.line.length > 0 && t.line.length < n);
  let forming = null;
  if (formingTeam && fullStats.length) {
    const fs = teamStats(s, formingTeam);
    const mTime = mean(fullStats.map((x) => x.sum));
    forming = {
      label: formingTeam.label,
      size: fs.size,
      missing: n - fs.size,
      sum: fs.sum,
      mTime,
      mAthlete: ref.mean,
      target: incompleteTarget(mTime, n, fs.size, ref.mean),
    };
  }
  return {
    teamCount: teams.length,
    completeCount: full.length,
    fullRange: range(fullStats.map((x) => x.sum)),
    outOfFormation: fullStats.reduce((acc, x) => acc + x.deviation, 0),
    median: ref.median,
    mAthlete: ref.mean,
    forming,
    withoutGk: usesGkQueue(s) || s.config.useGoalkeepers ? teams.filter((t) => !t.gks.length).map((t) => t.label) : [],
  };
}

/** Resumo de resultados de uma pelada (histórico). */
export function gamesSummary(s) {
  const wins = s.games.filter((g) => g.result !== 'draw').length;
  return { games: s.games.length, wins, draws: s.games.length - wins };
}

/**
 * RN-141: galeria dos times que saíram de campo por derrota ou empate, em ordem cronológica.
 * Usa o retrato salvo no jogo (`game.teamA/teamB`, tirado no apito, antes de qualquer movimentação), então a
 * miniatura mantém a escalação que jogou mesmo depois que os jogadores se misturam na fila.
 * Só entra quem SAIU: no empate em que um fica (par ou ímpar, desafiante), só o que saiu aparece.
 * @returns {{key, game, kind: 'loss'|'draw', id, label, vest, outcome, sum, gks, line}[]}
 */
export function outGallery(s) {
  const out = [];
  for (const g of s.games || []) {
    if (!g.teamA || !g.teamB) continue;
    const winner = g.result === 'A' ? g.teamA : g.result === 'B' ? g.teamB : null;
    for (const t of [g.teamA, g.teamB]) {
      const other = t === g.teamA ? g.teamB : g.teamA;
      const left = Array.isArray(g.leaving) ? g.leaving.includes(t.label) : winner ? t !== winner : true;
      if (!left || t === winner) continue;
      const kind = g.result === 'draw' ? 'draw' : 'loss';
      out.push({
        key: `${g.n}-${t.id}`,
        game: g.n,
        kind,
        id: t.id,
        label: t.label,
        vest: t.vest || null,
        outcome: kind === 'loss' ? `Perdeu p/ ${other.label}` : `Empatou c/ ${other.label}`,
        sum: sumStars(t.line),
        gks: t.gks.map((x) => ({ name: x.name, stars: x.stars })),
        // topo primeiro (como no card); posição contada de baixo para cima (RN-33a)
        line: t.line.map((x, i) => ({ name: x.name, stars: x.stars, role: x.role, position: t.line.length - i })),
      });
    }
  }
  return out;
}
