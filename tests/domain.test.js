// Estrelas, preparação da pelada, dicas de empate e resumos — funções puras do domínio.
import { suite, test, assert } from './harness.js';
import { mkSession } from './helpers.js';
import {
  isValidStars, sumStars, mean, median, range, formatStars, starsText,
  planParticipation, goalkeeperNote, toleranceInfo, clampLinePerTeam, clampTolerance, clampTransferQty, prepareDraw, defaultTitle,
  drawHint, advantageStatus, registerResult, balanceSummary, teamExitGroups, gamesSummary,
  playerDraft, togglePosition, RuleError, linePositions, positionOf,
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
    assert.ok(p.goalkeeperNote.includes('2 ficará(ão) sem goleiro'));
  });

  test('Seleção não altera o cadastro e ignora ids desconhecidos', () => {
    const before = JSON.stringify(players);
    const p = planParticipation(players, ['l1', 'l2', 'nao-existe'], { linePerTeam: 5, useGoalkeepers: true });
    assert.equal(p.total, 2);
    assert.equal(JSON.stringify(players), before);
  });

  test('Aviso de goleiros (RN-20)', () => {
    assert.equal(goalkeeperNote(false, 0, 4), '');
    assert.equal(goalkeeperNote(true, 0, 4), 'Nenhum goleiro presente.');
    assert.equal(goalkeeperNote(true, 4, 4), 'Um goleiro por equipe.');
    assert.ok(goalkeeperNote(true, 6, 4).startsWith('2 goleiro(s) excedente'));
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
      settings: { toleranceMin: 15, tossOnFirstGameEvenWithTwoWaiting: true },
      seed: 3,
    });
    assert.equal(Object.keys(r.snapshots).length, 24);
    assert.equal(r.config.toleranceMin, 15);
    assert.equal(r.config.tossOnFirstGameEvenWithTwoWaiting, true);
    assert.equal(r.draw.teams.length, 5);
    assert.deepEqual(r.draw.withoutGk, [3, 4]);
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
