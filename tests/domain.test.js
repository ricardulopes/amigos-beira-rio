// Estrelas, preparação da pelada, dicas de empate e resumos — funções puras do domínio.
import { suite, test, assert } from './harness.js';
import { mkSession } from './helpers.js';
import {
  isValidStars, sumStars, mean, median, range, formatStars, starsText,
  planParticipation, goalkeeperNote, toleranceInfo, clampLinePerTeam, clampTolerance, clampTransferQty, prepareDraw, defaultTitle,
  drawHint, advantageStatus, registerResult, balanceSummary, teamExitGroups, gamesSummary,
  playerDraft, togglePosition, RuleError, linePositions, positionOf, outGallery, drawLineup, redraw, startSession, finishSession, historyRanking, rankingSessions, gameBoard, createSession, kickoffTime, clockOf, resolveFinishTime, KICKOFF_DELAY_MIN,
} from '../src/domain/index.js';

suite('Numeração de posições (de baixo para cima)', () => {
  test('Posição 1 é a base (último da lista); posição N é o topo', () => {
    const team = { line: [{ pid: 'topo', role: 'A' }, { pid: 'meio', role: 'M' }, { pid: 'base', role: 'D' }] };
    assert.deepEqual(linePositions(team).map((x) => [x.position, x.pid]), [[1, 'base'], [2, 'meio'], [3, 'topo']]);
    assert.equal(positionOf(team, 'base'), 1);
    assert.equal(positionOf(team, 'topo'), 3);
    assert.equal(positionOf(team, 'outro'), 0);
  });
});

suite('Estrelas (stars.js)', () => {
  test('Valores válidos de estrelas (RN-02)', () => {
    for (const v of [1, 1.5, 2, 2.5, 3, '2.5']) assert.ok(isValidStars(v), `${v} deveria ser válido`);
    for (const v of [0, 0.5, 3.5, 2.2, 'x']) assert.ok(!isValidStars(v), `${v} deveria ser inválido`);
  });

  test('Soma, média, mediana e amplitude', () => {
    assert.equal(sumStars([{ stars: 3 }, { stars: 2 }, { stars: 2.5 }, { stars: 1.5 }, { stars: 2 }]), 11);
    assert.equal(mean([1, 2, 3]), 2);
    assert.equal(mean([]), 0);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 2.5, 3]), 2.25);
    assert.equal(range([10, 11, 9.5]), 1.5);
    assert.equal(range([10]), 0);
  });

  test('Formatação pt-BR e texto com emojis', () => {
    assert.equal(formatStars(2.5), '2,5');
    assert.equal(formatStars(10), '10');
    assert.equal(starsText(2.5), '⭐⭐½');
    assert.equal(starsText(3), '⭐⭐⭐');
  });
});

suite('Preparação da pelada (setup.js)', () => {
  const players = [];
  for (let i = 0; i < 21; i++) players.push({ id: `l${i}`, name: `L${i}`, stars: 2, type: 'line', positions: ['M'] });
  for (let i = 0; i < 3; i++) players.push({ id: `g${i}`, name: `G${i}`, stars: 2, type: 'gk', positions: [] });

  test('Plano: 21 de linha e 3 goleiros com 5 por time', () => {
    const p = planParticipation(players, players.map((x) => x.id), { linePerTeam: 5, useGoalkeepers: true });
    assert.equal(p.lineCount, 21);
    assert.equal(p.gkCount, 3);
    assert.equal(p.total, 24);
    assert.deepEqual(p.sizes, [5, 5, 5, 5, 1]);
    assert.equal(p.fullCount, 4);
    assert.equal(p.remainder, 1);
    assert.ok(p.goalkeeperNote.includes('do Time 1 ao Time 3; 2 time(s) aguardando goleiro'), 'RN-135: um goleiro por time, na ordem');
  });

  test('Seleção não altera o cadastro e ignora ids desconhecidos', () => {
    const before = JSON.stringify(players);
    const p = planParticipation(players, ['l1', 'l2', 'nao-existe'], { linePerTeam: 5, useGoalkeepers: true });
    assert.equal(p.total, 2);
    assert.equal(JSON.stringify(players), before);
  });

  test('Aviso de goleiros (RN-135)', () => {
    assert.equal(goalkeeperNote(2, 0), '');
    assert.equal(goalkeeperNote(0, 4), 'Nenhum goleiro presente: os times ficam aguardando goleiro.');
    assert.equal(goalkeeperNote(4, 4), 'Um goleiro para cada time, pela ordem de chegada.');
    assert.ok(goalkeeperNote(6, 4).endsWith('2 aguarda(m) time.'));
  });

  test('Tolerância: horário recomendado e contagem regressiva (RN-11)', () => {
    const now = new Date(2026, 10, 18, 19, 55);
    const t = toleranceInfo('20:00', 10, now);
    assert.equal(t.drawAt.getHours(), 20);
    assert.equal(t.drawAt.getMinutes(), 10);
    assert.equal(t.minutesLeft, 15);
    assert.ok(!t.released);
    assert.ok(toleranceInfo('20:00', 10, new Date(2026, 10, 18, 20, 30)).released);
    assert.equal(toleranceInfo('', 10, now), null);
  });

  test('Limites de configuração', () => {
    assert.equal(clampLinePerTeam(1), 2);
    assert.equal(clampLinePerTeam(16), 15);
    assert.equal(clampLinePerTeam('x'), 5);
    assert.equal(clampTolerance(-3), 0);
    assert.equal(clampTolerance(500), 120);
    assert.equal(clampTransferQty(0), 1);
  });

  test('prepareDraw monta sorteio, snapshots e configuração final', () => {
    const r = prepareDraw({
      players,
      selectedIds: players.map((x) => x.id),
      config: { linePerTeam: 5, useGoalkeepers: true, requireGkForComplete: false },
      settings: { toleranceMin: 15, tossOnFirstGameEvenWithTwoWaiting: true }, // opção antiga: ignorada
      seed: 3,
    });
    assert.equal(Object.keys(r.snapshots).length, 24);
    assert.equal(r.config.toleranceMin, 15);
    assert.ok(!('tossOnFirstGameEvenWithTwoWaiting' in r.config), 'par ou ímpar do 1º jogo é automático (sem opção)');
    assert.equal(r.draw.teams.length, 5);
    assert.ok(r.draw.teams.every((t) => !t.gks.length), 'RN-134: goleiros fora do sorteio de linha');
    assert.equal(r.gkOrder.length, 3, 'os 3 goleiros vão para a ordem de chegada');
    r.snapshots.l0.stars = 3;
    assert.equal(players[0].stars, 2, 'snapshot é cópia, não referência');
  });

  test('prepareDraw sem jogadores de linha lança erro de regra', () => {
    assert.throws(() => prepareDraw({ players, selectedIds: ['g0'], config: { linePerTeam: 5, useGoalkeepers: true } }), /linha/);
    try {
      prepareDraw({ players, selectedIds: [], config: { linePerTeam: 5, useGoalkeepers: true } });
    } catch (e) {
      assert.ok(e instanceof RuleError);
    }
  });

  test('Título padrão usa o nome do grupo e o dia da semana', () => {
    assert.ok(defaultTitle('Beira Rio', new Date(2026, 10, 18)).startsWith('Beira Rio de '));
  });
});

suite('Dicas de empate e vantagem (tieRules.js)', () => {
  test('Dica muda conforme o cenário', () => {
    let s = mkSession([5, 5, 5]);
    assert.ok(drawHint(s).includes('par ou ímpar'));
    s = registerResult(s, 'A').state;
    assert.ok(drawHint(s).includes('Time 3'));
    assert.ok(drawHint(mkSession([5, 5, 5, 5])).includes('saem os dois'));
    assert.equal(drawHint(mkSession([5])), '');
  });

  test('Situação de vantagem em campo', () => {
    let s = mkSession([5, 5, 5]);
    assert.equal(advantageStatus(s, 't1'), 'none');
    s = registerResult(s, 'A').state;
    assert.equal(advantageStatus(s, 't1'), 'defending');
    assert.equal(advantageStatus(s, 't3'), 'challenger');
    assert.equal(advantageStatus(s, 't2'), null, 'fora de campo');
  });
});

suite('Resumos (stats.js) e cadastro', () => {
  test('Resumo de equilíbrio do sorteio', () => {
    const s = mkSession([5, 5, 5, 2], { gks: [1, 0, 1, 0], stars: (t) => (t === 1 ? 2.5 : 2) });
    const b = balanceSummary(s);
    assert.equal(b.teamCount, 4);
    assert.equal(b.completeCount, 3);
    assert.equal(b.fullRange, 2.5);
    assert.deepEqual(b.withoutGk, ['Time 2', 'Time 4']);
  });

  test('Grupos de saída de uma equipe da pelada', () => {
    const s = mkSession([5, 5]);
    const g = teamExitGroups(s, s.teams.t1);
    assert.equal(g.length, 3);
    assert.equal(g[0].players[0].id, 'T1P5', 'base sai primeiro');
  });

  test('Resumo de jogos', () => {
    let s = mkSession([5, 5, 5]);
    s = registerResult(s, 'A').state;
    s = registerResult(s, 'draw').state;
    assert.deepEqual(gamesSummary(s), { games: 2, wins: 1, draws: 1 });
  });

  test('Rascunho de cadastro e alternância de posição', () => {
    assert.deepEqual(playerDraft(), { name: '', stars: 2, type: 'line', positions: [] });
    const p = { name: 'Ana', stars: 3, type: 'line', positions: ['D'] };
    const d = playerDraft(p);
    d.positions.push('M');
    assert.deepEqual(p.positions, ['D'], 'rascunho não altera o original');
    assert.deepEqual(togglePosition(['D', 'M'], 'D'), ['M']);
    assert.deepEqual(togglePosition(['M'], 'A'), ['M', 'A']);
  });
});

suite('Galeria dos times que saíram (RN-141)', () => {
  const R = (s, r, o) => registerResult(s, r, o).state;

  test('Derrota: o perdedor entra com a escalação do apito, colete, estrelas e "Perdeu p/"', () => {
    let s = mkSession([5, 5, 5], { goalkeepers: 2, stars: (ti, i) => (ti === 1 ? i + 1 : 2) });
    const t2Line = s.teams.t2.line.map((x) => x.pid);
    s = R(s, 'A'); // Time 1 vence o Time 2
    const g = outGallery(s);
    assert.equal(g.length, 1);
    const m = g[0];
    assert.equal(m.kind, 'loss');
    assert.equal(m.label, 'Time 2');
    assert.equal(m.outcome, 'Perdeu p/ Time 1');
    assert.equal(m.vest, 'blue', 'colete que vestia no jogo');
    assert.equal(m.sum, 15, '1+2+3+4+5 estrelas de linha');
    assert.deepEqual(m.gks.map((x) => x.name), ['Goleiro 2']);
    assert.deepEqual(m.line.map((x) => x.name), t2Line.map((pid) => s.snapshot[pid].name));
    assert.deepEqual(m.line.map((x) => x.position), [5, 4, 3, 2, 1], 'topo primeiro, posição de baixo para cima');
    assert.ok(m.line.every((x) => ['D', 'M', 'A'].includes(x.role)));
  });

  test('Empate com saída dupla: os dois sobem como empate; empate em que um fica: só quem saiu', () => {
    let s = mkSession([5, 5, 5, 5]);
    s = R(s, 'draw', { tossWinner: 't2' }); // 1º jogo, PRO e RE completos: saem os dois
    let g = outGallery(s);
    assert.deepEqual(g.map((x) => [x.label, x.kind, x.outcome]), [['Time 1', 'draw', 'Empatou c/ Time 2'], ['Time 2', 'draw', 'Empatou c/ Time 1']]);
    let s3 = mkSession([5, 5, 5]);
    s3 = R(s3, 'A'); // Time 2 perde
    s3 = R(s3, 'draw'); // Time 3 (desafiante) fica; Time 1 sai
    g = outGallery(s3);
    assert.deepEqual(g.map((x) => [x.game, x.label, x.kind]), [[1, 'Time 2', 'loss'], [2, 'Time 1', 'draw']], 'ordem cronológica');
    assert.equal(g[1].outcome, 'Empatou c/ Time 3');
  });

  test('A miniatura não muda quando os jogadores se misturam depois (retrato fiel do jogo)', () => {
    let s = mkSession([5, 5, 5, 2]);
    s = R(s, 'A'); // Time 2 perde, cede jogadores ao Time 4 e o restante vira Time 5
    const before = JSON.stringify(outGallery(s)[0]);
    assert.ok(!s.teams.t2, 'Time 2 foi desfeito na fila');
    s = R(s, 'B');
    s = R(s, 'A');
    assert.equal(JSON.stringify(outGallery(s)[0]), before);
    assert.equal(outGallery(s)[0].line.length, 5, 'escalação completa do apito');
    assert.equal(outGallery(s).length, 3);
  });

  test('Sem jogos: galeria vazia; desfazer o resultado remove a miniatura', () => {
    const s0 = mkSession([5, 5, 5]);
    assert.deepEqual(outGallery(s0), []);
    const s1 = R(s0, 'A');
    assert.equal(outGallery(s1).length, 1);
    assert.equal(outGallery(s0).length, 0, 'o estado anterior (desfazer) continua sem miniatura');
  });
});

suite('Aba Sorteio do histórico (RN-142)', () => {
  const R = (s, r, o) => registerResult(s, r, o).state;
  /** Sorteio fictício montado a partir de um snapshot: equipes de 5 na ordem das chaves. */
  const drawOf = (snap) => {
    const line = Object.values(snap).filter((p) => p.type !== 'gk').map((p) => ({ pid: p.id, role: 'M' }));
    const teams = [];
    for (let i = 0; i < line.length; i += 5) teams.push({ line: line.slice(i, i + 5), gks: [] });
    return { teams, seed: 1, metrics: {}, ref: 2, withoutGk: [], unusedGoalkeepers: [] };
  };
  const names = (d) => d.teams.flatMap((t) => [...t.gks, ...t.line].map((x) => x.name));

  test('Sorteio refeito com outros participantes: mostra o último (o que valeu), todos com nome', () => {
    const first = mkSession([5, 5, 5], { goalkeepers: 2 }); // 1º sorteio: T1…T3
    const snap2 = {};
    for (let i = 1; i <= 10; i++) snap2[`N${i}`] = { id: `N${i}`, name: `Novo ${i}`, stars: 2, type: 'line', positions: ['M'] };
    snap2.G1 = first.snapshot.G1;
    let s = redraw({ ...first, status: 'draft' }, { draw: drawOf(snap2), snapshots: snap2, gkOrder: ['G1'] });
    assert.equal(s.draws.length, 2);
    s = startSession(s);
    s = R(s, 'A');
    s = finishSession(s, new Date().toISOString());
    const d = drawLineup(s);
    assert.equal(d.total, 2);
    assert.equal(d.missing, 0);
    assert.deepEqual(d.teams.map((t) => t.label), ['Time 1', 'Time 2']);
    assert.ok(names(d).every(Boolean), 'nenhuma vaga em branco');
    assert.deepEqual(d.teams[0].gks.map((g) => g.name), ['Goleiro 1'], 'goleiro aparece');
    assert.deepEqual(d.teams[0].line.map((x) => x.name), ['Novo 1', 'Novo 2', 'Novo 3', 'Novo 4', 'Novo 5']);
    assert.deepEqual(d.teams[0].line.map((x) => x.position), [5, 4, 3, 2, 1]);
  });

  test('Retrato congelado: jogos, divisões e encerramento não mudam o sorteio registrado', () => {
    let s = mkSession([5, 5, 5, 3], { goalkeepers: 3 });
    const before = JSON.stringify(drawLineup(s));
    for (const r of ['A', 'B', 'draw', 'A', 'B']) {
      const an = analyzeResultSafe(s, r);
      s = R(s, r, an);
    }
    s = finishSession(s, new Date().toISOString());
    assert.equal(JSON.stringify(drawLineup(s)), before);
    assert.equal(drawLineup(s).teams.length, 4);
    assert.equal(drawLineup(s).teams[3].line.length, 3);
  });

  test('Pelada antiga (sorteio só com ids, participante fora do snapshot): recupera nome pelos jogos', () => {
    let s = mkSession([5, 5, 5]);
    s = R(s, 'A');
    // simula o formato antigo: o sorteio guardava só ids e o snapshot perdeu o atleta
    s.draws[0].teams.forEach((t) => {
      t.line = t.line.map(({ pid, role }) => ({ pid, role }));
      delete t.gkInfo;
    });
    delete s.snapshot.T2P3;
    const d = drawLineup(s);
    assert.equal(d.teams[1].line.find((x) => x.pid === 'T2P3').name, 'T2-3', 'veio da escalação do 1º jogo');
    assert.equal(d.missing, 0);
    delete s.snapshot.T3P1; // Time 3 não jogou ainda: sem fonte
    const d2 = drawLineup(s);
    assert.equal(d2.missing, 1);
    assert.equal(d2.teams[2].line.find((x) => x.pid === 'T3P1').name, null);
  });

  test('Pelada sem sorteio: null', () => {
    assert.equal(drawLineup({ draws: [] }), null);
  });
});

/** Opções de par ou ímpar quando o resultado exige (1º jogo empatado). */
function analyzeResultSafe(s, r) {
  return r === 'draw' && s.games.length === 0 ? { tossWinner: s.field[0] } : {};
}

suite('Ranking acumulado do histórico (RN-143)', () => {
  const R = (s, r, o) => registerResult(s, r, o).state;
  const row = (rk, pid) => rk.rows.find((x) => x.pid === pid);
  /** Pelada encerrada com data: 3 times de 5 e 3 goleiros; Time 1 vence 2, Time 3 vence 1, empate T2 x T3. */
  const pelada = (iso) => {
    let s = mkSession([5, 5, 5], { goalkeepers: 3 });
    s = R(s, 'A'); // T1 (G1) vence T2 (G2)
    s = R(s, 'B'); // T3 (G3) vence T1
    s = R(s, 'draw'); // T2 x T3: desafiante T2 fica
    s = finishSession(s, new Date().toISOString());
    return { ...s, id: `s-${iso}`, createdAt: iso, startedAt: iso };
  };

  test('Linha: jogos, V/E/D, pontos 3-1-0, aproveitamento e presença vêm dos jogos salvos', () => {
    const s = pelada('2026-11-10T20:00:00');
    const rk = historyRanking([s], { type: 'line' });
    assert.equal(rk.peladas, 1);
    assert.equal(rk.games, 3);
    const a = row(rk, 'T1P1'); // V, D
    assert.deepEqual([a.presences, a.games, a.wins, a.draws, a.losses, a.points, a.pct], [1, 2, 1, 0, 1, 3, 50]);
    const c = row(rk, 'T3P1'); // V, E
    assert.deepEqual([c.games, c.wins, c.draws, c.losses, c.points, c.pct, c.bestStreak], [2, 1, 1, 0, 4, 67, 1]);
    const b = row(rk, 'T2P1'); // D, E
    assert.deepEqual([b.games, b.points, b.pct], [2, 1, 17]);
    assert.equal(rk.rows[0].pid.startsWith('T3'), true, 'mais pontos primeiro');
    assert.ok(!rk.rows.some((x) => x.pid.startsWith('G')), 'goleiro fora da tabela de linha');
  });

  test('Goleiros: tabela própria, com jogos sem perder', () => {
    const rk = historyRanking([pelada('2026-11-10T20:00:00')], { type: 'gk' });
    assert.deepEqual(rk.rows.map((x) => x.pid).sort(), ['G1', 'G2', 'G3']);
    const g3 = row(rk, 'G3');
    assert.deepEqual([g3.games, g3.wins, g3.draws, g3.unbeaten, g3.presences], [2, 1, 1, 2, 1]);
    assert.equal(row(rk, 'G2').unbeaten, 1);
  });

  test('Acumula várias peladas, sequência de vitórias e filtros de período', () => {
    const old = pelada('2026-03-01T20:00:00');
    const mid = pelada('2026-10-01T20:00:00');
    const recent = pelada('2026-11-15T20:00:00');
    const all = [recent, old, mid, { ...mid, id: 'rascunho', status: 'draft' }];
    const now = '2026-11-21T12:00:00';
    assert.equal(historyRanking(all, { now }).peladas, 3, 'rascunho não conta');
    assert.equal(row(historyRanking(all, { now }), 'T1P1').presences, 3);
    assert.equal(row(historyRanking(all, { now }), 'T1P1').games, 6);
    assert.equal(historyRanking(all, { period: 'semester', now }).peladas, 2, 'mar/2026 é do 1º semestre');
    assert.equal(historyRanking(all, { period: 'month', now }).peladas, 1);
    assert.deepEqual(rankingSessions(all, 'all', now).map((s) => s.createdAt.slice(0, 7)), ['2026-03', '2026-10', '2026-11']);
    // T3P1: V, E em cada pelada → a maior sequência de vitórias seguidas é 1
    assert.equal(row(historyRanking(all, { now }), 'T3P1').bestStreak, 1);
  });

  test('Ordenações: aproveitamento exige mínimo de jogos; presença; não altera o histórico', () => {
    const s = pelada('2026-11-10T20:00:00');
    const late = { id: 'LATE', name: 'Atrasado', stars: 2, type: 'line', positions: ['M'] };
    const s2 = { ...s, snapshot: { ...s.snapshot, LATE: late }, games: [...s.games, { n: 4, result: 'A', teamA: { line: [{ pid: 'LATE', name: 'Atrasado', stars: 2 }], gks: [] }, teamB: { line: [], gks: [] } }] };
    const before = JSON.stringify(s2);
    const other = pelada('2026-11-12T20:00:00'); // os demais passam a ter 3 ou mais jogos
    const pct = historyRanking([s2, other], { sort: 'pct' });
    assert.equal(row(pct, 'LATE').pct, 100);
    assert.ok(pct.rows[0].pid !== 'LATE', 'com 1 jogo não lidera o aproveitamento');
    assert.equal(pct.rows[pct.rows.length - 1].pid, 'LATE');
    const pres = historyRanking([s2, other], { sort: 'presence' });
    assert.equal(pres.rows[0].presences, 2);
    assert.equal(pres.rows[pres.rows.length - 1].pid, 'LATE', 'quem veio a menos peladas fica embaixo');
    assert.equal(JSON.stringify(s2), before, 'leitura pura');
    assert.deepEqual(historyRanking([]).rows, []);
  });
});

suite('Mural da aba Jogos do histórico (RN-144)', () => {
  const R = (s, r, o) => registerResult(s, r, o).state;

  test('Cada jogo traz os dois times: vencedor limpo, perdedor vermelho; empate: os dois turquesa', () => {
    let s = mkSession([5, 5, 5, 5], { goalkeepers: 4 });
    s = R(s, 'draw', { tossWinner: 't2' }); // 1º jogo: empate com par ou ímpar
    s = R(s, 'B'); // Time 4 vence o Time 3
    const b = gameBoard(finishSession(s, new Date().toISOString()));
    assert.equal(b.length, 2);
    assert.deepEqual([b[0].n, b[0].title, b[0].note], [1, 'Empate', 'par ou ímpar: Time 2']);
    assert.deepEqual(b[0].teams.map((t) => [t.label, t.kind]), [['Time 1', 'draw'], ['Time 2', 'draw']]);
    assert.deepEqual([b[1].title, b[1].note], ['Vitória Time 4', '']);
    assert.deepEqual(b[1].teams.map((t) => [t.label, t.kind]), [['Time 3', 'loss'], ['Time 4', 'win']]);
    const t4 = b[1].teams[1];
    assert.equal(t4.vest, 'blue');
    assert.equal(t4.gks.length, 1, 'goleiro do jogo');
    assert.equal(t4.line.length, 5);
    assert.deepEqual(t4.line.map((x) => x.position), [5, 4, 3, 2, 1]);
    assert.equal(t4.sum, 10);
  });

  test('Empate em que um time fica: só quem saiu leva o X; quem permaneceu fica limpo; retrato não muda', () => {
    let s = mkSession([5, 5, 5, 2]);
    s = R(s, 'A');
    s = R(s, 'draw'); // desafiante fica
    const first = JSON.stringify(gameBoard(s)[0]);
    s = R(s, 'A');
    s = R(s, 'B');
    assert.deepEqual(gameBoard(s)[1].teams.map((t) => [t.label, t.kind]), [['Time 1', 'draw'], ['Time 3', 'drawStay']], 'desafiante Time 3 ficou');
    assert.equal(JSON.stringify(gameBoard(s)[0]), first);
    assert.deepEqual(gameBoard({ games: [] }), []);
  });
});

suite('Mural: X só em quem saiu no empate (RN-144)', () => {
  const R = (s, r, o) => registerResult(s, r, o).state;
  test('1º jogo empatado sem saída dupla: vencedor do par ou ímpar fica limpo, o outro leva o X', () => {
    const s = R(mkSession([5, 5, 5]), 'draw', { tossWinner: 't2' });
    assert.deepEqual(gameBoard(s)[0].teams.map((t) => [t.label, t.kind]), [['Time 1', 'draw'], ['Time 2', 'drawStay']]);
  });
  test('Empate com saída dupla (2º jogo em diante): X nos dois', () => {
    let s = mkSession([5, 5, 5, 5, 5, 5]);
    s = R(s, 'draw', { tossWinner: 't1' });
    s = R(s, 'draw'); // Time 3 x Time 4 com PRO e RE completos
    assert.deepEqual(gameBoard(s)[1].teams.map((t) => t.kind), ['draw', 'draw']);
  });
  test('Jogo antigo sem registro de quem saiu: empate marca os dois (comportamento anterior)', () => {
    const s = R(mkSession([5, 5, 5]), 'draw', { tossWinner: 't2' });
    delete s.games[0].leaving;
    assert.deepEqual(gameBoard(s)[0].teams.map((t) => t.kind), ['draw', 'draw']);
  });
});

suite('Horários: início no sorteio + 3 min e encerramento confirmado (RN-145, RN-146)', () => {
  const draw = (s) => ({ teams: Object.values(s.teams).map((t) => ({ line: t.line, gks: [] })), seed: 1, metrics: {}, ref: 2, withoutGk: [], unusedGoalkeepers: [] });
  const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).toISOString();

  test('Sortear: início oficial = agora + 3 minutos; refazer o sorteio recalcula; começar usa esse horário', () => {
    assert.equal(KICKOFF_DELAY_MIN, 3);
    assert.equal(kickoffTime(local(2026, 11, 21, 20, 0)), local(2026, 11, 21, 20, 3));
    assert.equal(kickoffTime(local(2026, 11, 21, 23, 58)), local(2026, 11, 22, 0, 1), 'vira o dia');
    const base = mkSession([5, 5]);
    let s = createSession({ title: 'X', config: base.config, snapshots: base.snapshot, draw: draw(base), drawnAt: local(2026, 11, 21, 20, 0) });
    assert.equal(s.kickoffAt, local(2026, 11, 21, 20, 3));
    assert.equal(s.startedAt, null, 'rascunho ainda não começou');
    s = redraw(s, { draw: draw(base), drawnAt: local(2026, 11, 21, 20, 10) });
    assert.equal(s.kickoffAt, local(2026, 11, 21, 20, 13), 'novo sorteio, novo início');
    s = startSession(s);
    assert.equal(s.startedAt, local(2026, 11, 21, 20, 13), 'início oficial é o do sorteio + 3 min');
  });

  test('Encerrar exige horário confirmado: sem valor (vazio/nulo) não encerra; nada é pré-preenchido', () => {
    const s = { ...mkSession([5, 5]), startedAt: local(2026, 11, 21, 20, 3) };
    assert.throws(() => finishSession(s), /horário de encerramento/);
    assert.throws(() => finishSession(s, ''), /horário de encerramento/);
    assert.throws(() => finishSession(s, 'lixo'), /horário de encerramento/);
    assert.throws(() => resolveFinishTime(s, '', local(2026, 11, 21, 23, 0)), /Informe o horário/);
    assert.throws(() => resolveFinishTime(s, null, local(2026, 11, 21, 23, 0)), /Informe o horário/);
    assert.throws(() => resolveFinishTime(s, '25:00', local(2026, 11, 21, 23, 0)), /inválido/);
    assert.equal(s.status, 'live', 'tentativas recusadas não mudam a pelada');
  });

  test('Horário digitado vira data/hora a partir do início; meia-noite; futuro e mais de 12 h são recusados', () => {
    const s = { ...mkSession([5, 5]), startedAt: local(2026, 11, 21, 20, 3) };
    const now = local(2026, 11, 22, 0, 40);
    assert.equal(resolveFinishTime(s, '22:30', now), local(2026, 11, 21, 22, 30));
    assert.equal(resolveFinishTime(s, '00:15', now), local(2026, 11, 22, 0, 15), 'depois da meia-noite = dia seguinte');
    assert.throws(() => resolveFinishTime(s, '00:50', now), /futuro/);
    const s2 = { ...s, startedAt: local(2026, 11, 21, 8, 0) };
    assert.throws(() => resolveFinishTime(s2, '21:00', local(2026, 11, 21, 23, 0)), /12 horas/);
    const done = finishSession(s, resolveFinishTime(s, '22:30', now));
    assert.equal(done.status, 'finished');
    assert.equal(done.finishedAt, local(2026, 11, 21, 22, 30));
    assert.ok(done.log.some((x) => /encerrada às 22:30/.test(x.text)));
    assert.equal(clockOf(local(2026, 11, 21, 7, 5)), '07:05', 'atalho "Usar horário atual" preenche HH:MM');
  });
});

suite('Horários: casos de borda do encerramento (auditoria 2026-11-21)', () => {
  const local = (h, mi, d = 21) => new Date(2026, 10, d, h, mi).toISOString();
  const s = { ...mkSession([5, 5]), startedAt: local(20, 3) }; // início oficial 20:03 (sorteio às 20:00)

  test('Começou e desistiu antes do início oficial: encerra no próprio início, sem travar 3 minutos', () => {
    assert.equal(resolveFinishTime(s, '20:01', local(20, 1)), local(20, 3));
    assert.equal(resolveFinishTime(s, '20:02', local(20, 2)), local(20, 3));
  });

  test('Hora digitada antes do início (engano): a mensagem cita o início da pelada', () => {
    assert.throws(() => resolveFinishTime(s, '19:00', local(22, 0)), /19:00 está no futuro ou antes do início da pelada \(20:03\)/);
    assert.throws(() => resolveFinishTime(s, '23:00', local(22, 0)), /futuro/, 'depois do início e ainda não chegou');
    assert.equal(resolveFinishTime(s, '00:10', local(0, 20, 22)), local(0, 10, 22), 'meia-noite continua valendo');
  });
});
