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

/**
 * RN-142: escalação do sorteio que VALEU (o último antes do 1º jogo; os anteriores foram refeitos), para a aba
 * Sorteio do histórico. Nome e estrelas vêm, nesta ordem: do retrato congelado no sorteio; do snapshot da pelada;
 * das escalações salvas nos jogos (recupera peladas antigas cujo sorteio guardava só os ids).
 * @returns {{total, at, teams: {id, label, gks: {pid,name,stars}[], line: {pid,role,name,stars,position}[]}[], missing}|null}
 */
export function drawLineup(s) {
  const draws = s.draws || [];
  if (!draws.length) return null;
  const d = draws[draws.length - 1];
  const fromGames = new Map();
  for (const g of s.games || []) {
    for (const t of [g.teamA, g.teamB]) {
      for (const x of [...(t?.line || []), ...(t?.gks || [])]) if (x?.pid && x.name && !fromGames.has(x.pid)) fromGames.set(x.pid, x);
    }
  }
  let missing = 0;
  const who = (pid, frozen) => {
    const src = (frozen?.name && frozen) || (s.snapshot?.[pid]?.name && s.snapshot[pid]) || fromGames.get(pid);
    if (!src) missing++;
    return { pid, name: src?.name || null, stars: src?.stars ?? null };
  };
  const teams = d.teams.map((t) => {
    const info = new Map((t.gkInfo || []).map((g) => [g.pid, g]));
    return {
      id: t.id,
      label: t.label,
      gks: (t.gks || []).map((pid) => who(pid, info.get(pid))),
      // topo primeiro (como nos cards); posição contada de baixo para cima (RN-33a)
      line: t.line.map((x, i) => ({ ...who(x.pid, x), role: x.role, position: t.line.length - i })),
    };
  });
  return { total: draws.length, at: d.at, teams, missing };
}

// ---------------------------------------------------------------- ranking acumulado (RN-143)

export const RANKING_PERIODS = { all: 'Geral', semester: 'Este semestre', month: 'Últimos 30 dias' };
export const RANKING_SORTS = { points: 'Pontos', pct: 'Aproveitamento', presence: 'Presença' };
/** Mínimo de jogos para disputar o topo do ranking por aproveitamento (evita 100% com 1 jogo). */
export const RANKING_MIN_GAMES = 3;

const peladaDate = (s) => s.startedAt || s.createdAt || '';

/** Peladas do período (iniciadas: ao vivo ou encerradas), da mais antiga para a mais recente. */
export function rankingSessions(sessions = [], period = 'all', now = new Date().toISOString()) {
  const t = new Date(now);
  const inPeriod = (iso) => {
    if (period === 'month') return t - new Date(iso) <= 30 * 86400000;
    if (period === 'semester') {
      const d = new Date(iso);
      return d.getFullYear() === t.getFullYear() && (d.getMonth() < 6) === (t.getMonth() < 6);
    }
    return true;
  };
  return sessions
    .filter((s) => s && (s.status === 'live' || s.status === 'finished') && s.snapshot && inPeriod(peladaDate(s)))
    .sort((a, b) => peladaDate(a).localeCompare(peladaDate(b)));
}

/**
 * RN-143: ranking acumulado a partir do histórico salvo (só leitura; nada é alterado).
 * Linha e goleiros em tabelas separadas, pelo papel no jogo (`game.teamX.line` × `game.teamX.gks`); presença pelo tipo
 * do atleta no snapshot de cada pelada. Pontos 3-1-0; aproveitamento = pontos ÷ (3 × jogos), arredondado.
 * @param {{type?: 'line'|'gk', period?: string, sort?: string, now?: string}} opts
 */
export function historyRanking(sessions = [], { type = 'line', period = 'all', sort = 'points', now } = {}) {
  const list = rankingSessions(sessions, period, now);
  const st = new Map();
  const get = (pid, p) => {
    if (!st.has(pid)) st.set(pid, { pid, name: p?.name || pid, stars: p?.stars ?? null, presences: 0, games: 0, wins: 0, draws: 0, losses: 0, streak: 0, bestStreak: 0 });
    const x = st.get(pid);
    if (p?.name) x.name = p.name; // nome e estrelas da pelada mais recente (referência)
    if (p?.stars != null) x.stars = p.stars;
    return x;
  };
  for (const s of list) {
    for (const p of Object.values(s.snapshot)) if ((p.type === 'gk' ? 'gk' : 'line') === type) get(p.id, p).presences++;
    for (const g of s.games || []) {
      const sides = [[g.teamA, g.result === 'A' ? 'w' : g.result === 'B' ? 'l' : 'd'], [g.teamB, g.result === 'B' ? 'w' : g.result === 'A' ? 'l' : 'd']];
      for (const [t, r] of sides) {
        for (const p of (type === 'gk' ? t?.gks : t?.line) || []) {
          const x = get(p.pid, { name: p.name, stars: p.stars });
          x.games++;
          if (r === 'w') {
            x.wins++;
            x.streak++;
            x.bestStreak = Math.max(x.bestStreak, x.streak);
          } else {
            x.streak = 0;
            if (r === 'l') x.losses++;
            else x.draws++;
          }
        }
      }
    }
  }
  const rows = [...st.values()].map(({ streak, ...x }) => {
    const points = 3 * x.wins + x.draws;
    return { ...x, points, unbeaten: x.wins + x.draws, pct: x.games ? Math.round((100 * points) / (3 * x.games)) : 0 };
  });
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  const cmp = {
    points: (a, b) => b.points - a.points || b.pct - a.pct || b.games - a.games || byName(a, b),
    pct: (a, b) => (b.games >= RANKING_MIN_GAMES) - (a.games >= RANKING_MIN_GAMES) || b.pct - a.pct || b.points - a.points || byName(a, b),
    presence: (a, b) => b.presences - a.presences || b.games - a.games || b.points - a.points || byName(a, b),
  }[sort] || ((a, b) => b.points - a.points || byName(a, b));
  return { peladas: list.length, games: list.reduce((n, s) => n + (s.games?.length || 0), 0), rows: rows.sort(cmp) };
}
