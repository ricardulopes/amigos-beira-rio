// Rodízio: aplica o resultado decidido em tieRules.js (PRD seções 8 e 9).
// Atualiza estatísticas e permanência, envia quem sai ao fim da fila (com divisão/recomposição)
// e coloca em campo os próximos da fila.
import { RuleError, transact, label, nowIso, teamSnapshot, addLog, refreshRoles, makeTeam, usesGkQueue, syncGoalkeepers } from './session.js';
import { analyzeResult, SCENARIOS } from './tieRules.js';
import { syncVests, vestOf, vestsText } from './vests.js';

/**
 * Registra o resultado e processa toda a movimentação.
 * @param {'A'|'B'|'draw'} result
 * @param {{tossWinner?: string}} opts id do time vencedor do par ou ímpar (quando necessário)
 */
export function registerResult(state, result, opts = {}) {
  return transact(state, (s) => {
    const an = analyzeResult(s, result);
    let { staying, leaving } = an;
    let explanation = an.explanation;
    const [a, b] = s.field;
    if (an.needsToss) {
      if (!opts.tossWinner || ![a, b].includes(opts.tossWinner)) throw new RuleError('Informe quem venceu o par ou ímpar.');
      staying = [opts.tossWinner];
      leaving = [opts.tossWinner === a ? b : a];
      explanation += ` ${label(s, staying[0])} venceu o par ou ímpar e permanece; ${label(s, leaving[0])} sai.`;
    }
    const game = {
      n: s.games.length + 1,
      at: nowIso(),
      teamA: teamSnapshot(s, a),
      teamB: teamSnapshot(s, b),
      result,
      winner: result === 'A' ? a : result === 'B' ? b : null,
      scenario: an.scenario,
      toss: an.needsToss ? opts.tossWinner : null,
      staying: staying.map((id) => label(s, id)),
      leaving: leaving.map((id) => label(s, id)),
      completeWaiting: an.completeWaiting,
      explanation,
    };

    // 1) estatísticas e permanência (RN-50 a RN-52)
    if (result === 'draw') {
      s.teams[a].stats.draws++;
      s.teams[b].stats.draws++;
    }
    if (an.scenario === SCENARIOS.WIN) {
      const w = s.teams[staying[0]];
      w.stats.wins++;
      w.permanence = true;
      s.teams[leaving[0]].stats.losses++;
    } else if (an.scenario === SCENARIOS.DRAW_TOSS) {
      const w = s.teams[staying[0]];
      w.stats.tossWins++;
      w.permanence = true;
    } else if (an.scenario === SCENARIOS.DRAW_CHALLENGER_STAYS) {
      const c = s.teams[staying[0]];
      c.stats.drawPermanences++;
      c.permanence = true;
    }
    for (const id of leaving) s.teams[id].permanence = false;

    // 2) quem fica mantém o slot; quem sai vai ao fim da fila (RN-45, RN-47, RN-48)
    const fieldBefore = [...s.field];
    s.field = s.field.filter((id) => staying.includes(id));
    const moves = [];
    // RN-136: o goleiro de quem sai vai para o fim da fila de goleiros (quem fica mantém o seu).
    const gkOut = [];
    if (usesGkQueue(s)) {
      for (const id of leaving) {
        for (const g of s.teams[id].gks.splice(0)) {
          s.gkQueue.push(g);
          gkOut.push(`${s.snapshot[g].name} (${label(s, id)})`);
        }
      }
    }
    for (const id of leaving) moves.push(...enqueueLeavingTeam(s, id));

    // 3) entram os próximos da fila no slot vago, sem permanência (RN-43, RN-44)
    const newField = fieldBefore.map((id) => (staying.includes(id) ? id : null));
    for (let i = 0; i < 2; i++) {
      if (newField[i] === null && s.queue.length) {
        const entering = s.queue.shift();
        s.teams[entering].permanence = false;
        newField[i] = entering;
      }
    }
    s.field = newField.filter(Boolean);

    // 3b) goleiros: quem entra recebe o próximo da fila de goleiros (RN-136)
    if (usesGkQueue(s)) {
      syncGoalkeepers(s);
      const gkIn = s.field.filter((id) => !staying.includes(id) && s.teams[id].gks.length)
        .map((id) => `${s.snapshot[s.teams[id].gks[0]].name} assume o gol do ${label(s, id)}`);
      if (gkOut.length || gkIn.length) {
        const parts = [];
        if (gkOut.length) parts.push(`${gkOut.join(' e ')} ${gkOut.length > 1 ? 'vão' : 'vai'} para o fim da fila de goleiros`);
        if (gkIn.length) parts.push(gkIn.join('; '));
        explanation += ` Goleiros: ${parts.join('; ')}.`;
      }
    }

    // 4) coletes: quem fica mantém a cor; quem entra veste a cor de quem saiu (RN-109 a RN-111)
    syncVests(s);
    const vestLine = vestsText(s);
    if (vestLine) explanation += ` ${vestLine}`;
    game.explanation = explanation;
    game.vestsAfter = Object.fromEntries(s.field.map((id) => [label(s, id), vestOf(s, id)]));

    game.entered = s.field.filter((id) => !staying.includes(id)).map((id) => label(s, id));
    game.moves = moves;
    s.games.push(game);
    addLog(s, 'result', `Jogo ${game.n}: ${resultText(game)}. ${explanation}`, { game: game.n, moves });
    for (const m of moves) addLog(s, 'move', m);
    return { analysis: an, game, explanation };
  });
}

/**
 * Prévia dos coletes da próxima partida para um resultado ainda não confirmado (sem alterar o estado).
 * Retorna null quando a prévia depende de informação que ainda falta (ex.: vencedor do par ou ímpar).
 */
export function vestPreview(state, result, opts = {}) {
  try {
    const { state: next } = registerResult(state, result, opts);
    return vestsText(next).replace(/^Coletes:/, 'Próxima partida:') || null;
  } catch {
    return null;
  }
}

function resultText(g) {
  if (g.result === 'draw') return `${g.teamA.label} empatou com ${g.teamB.label}`;
  const w = g.result === 'A' ? g.teamA : g.teamB;
  const l = g.result === 'A' ? g.teamB : g.teamA;
  return `${w.label} venceu ${l.label}`;
}

/**
 * Coloca um time que saiu de campo no fim da fila (RN-45, RN-46, RN-49).
 *
 * Numeração de posições de baixo para cima (RN-33a): posição 1 = base (primeiro a sair),
 * posição N = topo. No array `line` (topo → base), a posição k fica em line[line.length - k].
 *
 * Se a última equipe da fila tem R atletas (posições 1..R), as vagas são as posições R+1..N.
 * O time que saiu cede atletas de baixo para cima: sua posição 1 ocupa a vaga R+1, a posição 2
 * ocupa R+2, e assim por diante. Os atletas que já estavam na equipe incompleta NÃO mudam de posição.
 * Os restantes do time que saiu formam uma nova equipe, renumerados a partir de 1
 * (a antiga posição k+1 vira a posição 1, k+2 vira a 2...). Só divide quando há vagas reais.
 * @returns {string[]} descrição das movimentações
 */
export function enqueueLeavingTeam(s, tid) {
  const team = s.teams[tid];
  const n = s.config.linePerTeam;
  const moves = [];
  team.permanence = false;
  const lastId = s.queue[s.queue.length - 1];
  const last = lastId ? s.teams[lastId] : null;
  const vacancies = last ? n - last.line.length : 0;
  if (!last || vacancies <= 0) {
    s.queue.push(tid);
    moves.push(`${team.label} foi para o fim da fila.`);
    return moves;
  }
  const take = Math.min(vacancies, team.line.length);
  const filledFrom = last.line.length + 1; // primeira vaga (de baixo para cima)
  // Base do time que saiu (posições 1..take), em ordem topo → base: [pos take, ..., pos 1].
  const moved = team.line.splice(team.line.length - take, take);
  // Entram ACIMA dos atuais: a pos. 1 do cedente fica logo acima do topo atual (vaga R+1).
  last.line.unshift(...moved);
  let gkMoved = null;
  const receiverComplete = last.line.length >= n;
  if (s.config.useGoalkeepers && last.gks.length === 0 && team.gks.length > 0 && (receiverComplete || team.line.length === 0 || team.gks.length > 1)) {
    gkMoved = team.gks.shift();
    last.gks.push(gkMoved);
  }
  refreshRoles(s, last);
  const names = moved
    .slice()
    .reverse()
    .map((x, i) => `${s.snapshot[x.pid].name} → pos. ${filledFrom + i}`)
    .join(', ');
  const vagas = take === 1 ? `a posição ${filledFrom}` : `as posições ${filledFrom} a ${filledFrom + take - 1}`;
  moves.push(`${take} jogador(es) da base de ${team.label} ocuparam ${vagas} de ${last.label} (${names})${gkMoved ? `, com o goleiro ${s.snapshot[gkMoved].name}` : ''}.`);
  if (team.line.length === 0) {
    if (team.gks.length) {
      last.gks.push(...team.gks);
      moves.push(`Goleiro(s) restante(s) de ${team.label} foram para ${last.label}.`);
      team.gks = [];
    }
    delete s.teams[tid];
    moves.push(`${team.label} foi desfeito (todos os jogadores realocados).`);
  } else {
    const rest = makeTeam(s, { line: team.line, gks: team.gks, origin: 'split', note: `restante do ${team.label}` });
    delete s.teams[tid];
    s.queue.push(rest.id);
    moves.push(`Restante do ${team.label} (${rest.line.length} jogador(es)) formou o ${rest.label} no fim da fila.`);
  }
  return moves;
}
