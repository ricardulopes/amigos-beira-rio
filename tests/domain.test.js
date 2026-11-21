// Estrelas, preparação da pelada, dicas de empate e resumos — funções puras do domínio.
import { suite, test, assert } from './harness.js';
import { mkSession } from './helpers.js';
import {
  isValidStars, sumStars, mean, median, range, formatStars, starsText,
  planParticipation, goalkeeperNote, toleranceInfo, clampLinePerTeam, clampTolerance, clampTransferQty, prepareDraw, defaultTitle,
  drawHint, advantageStatus, registerResult, balanceSummary, teamExitGroups, gamesSummary,
  playerDraft, togglePosition, RuleError, linePositions, positionOf, outGallery, drawLineup, redraw, startSession, finishSession,
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
    s = finishSession(s);
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
    s = finishSession(s);
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
