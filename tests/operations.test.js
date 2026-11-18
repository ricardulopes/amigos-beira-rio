// Atrasados, retiradas, reposição, transferências, integridade, desfazer e persistência.
import { suite, test, assert } from './harness.js';
import { mkSession, pids, lateSnap } from './helpers.js';
import {
  addLatePlayer, removePlayer, simulateTransfer, transferPlayers,
  validate, registerResult, isComplete, movePlayerInOrder, moveGoalkeeper, playerStats, linePositions, positionOf,
} from '../src/domain/index.js';
import { createStore } from '../src/storage/storage.js';
import { validatePlayer } from '../src/domain/index.js';
import { shareText } from '../src/domain/index.js';

/** Atletas por posição, de baixo para cima: [pos1, pos2, ...]. */
const byPos = (s, tid) => linePositions(s.teams[tid]).map((x) => x.pid);

suite('Atrasados — seção 11', () => {
  test('23 jogadores (4 completos + 1 com 3): 4 atrasados completam e abrem nova equipe', () => {
    let s = mkSession([5, 5, 5, 5, 3]);
    const before = JSON.stringify([pids(s, 't1'), pids(s, 't2'), pids(s, 't3'), pids(s, 't4')]);
    const t5 = byPos(s, 't5');
    for (const id of ['A1', 'A2', 'A3', 'A4']) s = addLatePlayer(s, lateSnap(id)).state;
    assert.deepEqual(byPos(s, 't5'), [...t5, 'A1', 'A2'], 'dois primeiros ocupam as posições 4 e 5 do t5');
    assert.ok(isComplete(s, s.teams.t5));
    assert.deepEqual(byPos(s, 't6'), ['A3', 'A4'], 'seguintes abrem nova equipe nas posições 1 e 2');
    assert.equal(before, JSON.stringify([pids(s, 't1'), pids(s, 't2'), pids(s, 't3'), pids(s, 't4')]), 'times existentes intactos');
    assert.deepEqual(s.arrivals.map((a) => a.order), [1, 2, 3, 4]);
    s = addLatePlayer(s, lateSnap('A5')).state;
    assert.deepEqual(byPos(s, 't6'), ['A3', 'A4', 'A5'], 'continua completando a equipe atual (posição 3)');
  });

  test('Pelada em andamento: Time 5 com pos. 1–2 recebe atrasados nas pos. 3, 4, 5, por ordem de chegada; o 4º abre o Time 6', () => {
    // pelada ao vivo: Time 1 x Time 2 em campo; fila PRO Time 3, RE Time 4, Time 5 em formação (pos. 1 e 2)
    let s = mkSession([5, 5, 5, 5, 2]);
    assert.equal(s.status, 'live');
    assert.equal(s.queue[s.queue.length - 1], 't5');
    const t5 = byPos(s, 't5');
    const others = JSON.stringify(Object.values(s.teams).filter((t) => t.id !== 't5').map((t) => byPos(s, t.id)));
    // atrasados com estrelas/posições "desequilibradas": a ordem de chegada é a única regra
    const arrivals = [
      lateSnap('C1', { stars: 3, positions: ['A'] }),
      lateSnap('C2', { stars: 3, positions: ['A'] }),
      lateSnap('C3', { stars: 1, positions: ['D'] }),
      lateSnap('C4', { stars: 3, positions: ['A'] }),
    ];
    const msgs = [];
    for (const a of arrivals) {
      const r = addLatePlayer(s, a);
      s = r.state;
      msgs.push(r.message);
    }
    assert.equal(positionOf(s.teams.t5, t5[0]), 1, 'quem estava na posição 1 continua na 1');
    assert.equal(positionOf(s.teams.t5, t5[1]), 2, 'quem estava na posição 2 continua na 2');
    assert.equal(positionOf(s.teams.t5, 'C1'), 3, '1º atrasado → posição 3');
    assert.equal(positionOf(s.teams.t5, 'C2'), 4, '2º atrasado → posição 4');
    assert.equal(positionOf(s.teams.t5, 'C3'), 5, '3º atrasado → posição 5');
    assert.ok(isComplete(s, s.teams.t5));
    const t6 = s.queue[s.queue.length - 1];
    assert.equal(t6, 't6');
    assert.equal(positionOf(s.teams.t6, 'C4'), 1, '4º atrasado abre o Time 6 na posição 1');
    assert.equal(
      JSON.stringify(Object.values(s.teams).filter((t) => !['t5', 't6'].includes(t.id)).map((t) => byPos(s, t.id))),
      others,
      'nenhuma outra equipe foi reorganizada',
    );
    assert.ok(msgs[0].includes('ocupou a posição 3 do Time 5'), msgs[0]);
    assert.ok(msgs[3].includes('abriu o Time 6') && msgs[3].includes('posição 1'), msgs[3]);
  });

  test('Atrasado já participando é rejeitado', () => {
    const s = mkSession([5, 5]);
    assert.throws(() => addLatePlayer(s, lateSnap('T1P1')), /já está participando/);
  });

  test('Goleiro atrasado vai para a primeira equipe da fila sem goleiro', () => {
    let s = mkSession([5, 5, 5, 5], { gks: [1, 1, 1, 0] });
    s = addLatePlayer(s, lateSnap('G9', { type: 'gk', positions: [] })).state;
    assert.deepEqual(s.teams.t4.gks, ['G9']);
  });

  test('Aviso de desequilíbrio quando atrasados deixam equipe muito forte', () => {
    let s = mkSession([5, 5, 2]);
    s = addLatePlayer(s, lateSnap('X1', { stars: 3 })).state;
    s = addLatePlayer(s, lateSnap('X2', { stars: 3 })).state;
    const r = addLatePlayer(s, lateSnap('X3', { stars: 3 }));
    assert.ok(r.warnings.length > 0, 'deve avisar');
    assert.equal(r.state.teams.t3.line.length, 5);
  });
});

suite('Retiradas e reposição automática em cascata — seção 11', () => {
  test('Lesão em campo: pos. 1 do PRO entra no topo; RE completa o PRO, TRI completa o RE; vaga fica no último', () => {
    // campo Time 1 × Time 2; PRO Time 3; RE Time 4; TRI Time 5 (3 atletas)
    let s = mkSession([5, 5, 5, 5, 3]);
    const t2 = byPos(s, 't2');
    const r = removePlayer(s, 'T1P2', 'injury', 'tornozelo'); // T1P2 estava na pos. 4 do Time 1
    s = r.state;
    assert.ok(!s.active.includes('T1P2'));
    assert.equal(s.removed[0].reason, 'injury');
    assert.equal(r.removal.position, 4);
    assert.deepEqual(byPos(s, 't1'), ['T1P5', 'T1P4', 'T1P3', 'T1P1', 'T3P5'], 'quem estava acima desce; pos. 1 do PRO entra na pos. 5');
    assert.deepEqual(byPos(s, 't3'), ['T3P4', 'T3P3', 'T3P2', 'T3P1', 'T4P5'], 'o 2º do PRO vira o 1º; pos. 1 do RE entra no fim do PRO');
    assert.deepEqual(byPos(s, 't4'), ['T4P4', 'T4P3', 'T4P2', 'T4P1', 'T5P3'], 'pos. 1 do TRI completa o RE');
    assert.deepEqual(byPos(s, 't5'), ['T5P2', 'T5P1'], 'a vaga termina no último da fila, renumerado a partir de 1');
    assert.deepEqual(byPos(s, 't2'), t2, 'o adversário em campo não muda');
    assert.deepEqual(s.field, ['t1', 't2']);
    assert.deepEqual(s.queue, ['t3', 't4', 't5']);
    assert.ok(isComplete(s, s.teams.t1) && isComplete(s, s.teams.t3) && isComplete(s, s.teams.t4));
    assert.ok(s.log.some((l) => l.text.includes('T3-5') && l.text.includes('Time 1')), 'movimentação registrada no histórico');
  });

  test('Desistência na fila (RE): só as equipes de trás sobem; campo e PRO intactos', () => {
    let s = mkSession([5, 5, 5, 5, 3]);
    const before = JSON.stringify(['t1', 't2', 't3'].map((t) => byPos(s, t)));
    s = removePlayer(s, 'T4P5', 'quit').state; // pos. 1 do RE desistiu antes de entrar
    assert.equal(before, JSON.stringify(['t1', 't2', 't3'].map((t) => byPos(s, t))));
    assert.deepEqual(byPos(s, 't4'), ['T4P4', 'T4P3', 'T4P2', 'T4P1', 'T5P3']);
    assert.deepEqual(byPos(s, 't5'), ['T5P2', 'T5P1']);
  });

  test('Saída no último da fila ou sem fila: a vaga fica aberta, ninguém mais se mexe', () => {
    let s = mkSession([5, 5, 5, 3]);
    const before = JSON.stringify(['t1', 't2', 't3'].map((t) => byPos(s, t)));
    s = removePlayer(s, 'T4P1', 'early').state;
    assert.equal(before, JSON.stringify(['t1', 't2', 't3'].map((t) => byPos(s, t))));
    assert.deepEqual(byPos(s, 't4'), ['T4P3', 'T4P2']);
    const r = removePlayer(mkSession([5, 5]), 'T1P1', 'quit');
    assert.equal(r.state.teams.t1.line.length, 4);
    assert.ok(r.message.includes('vaga fica aberta'), r.message);
  });

  test('Último da fila com 1 atleta é esvaziado pela cascata e desfeito', () => {
    let s = mkSession([5, 5, 5, 1]);
    s = removePlayer(s, 'T2P1', 'injury').state;
    assert.deepEqual(byPos(s, 't2').slice(-1), ['T3P5']);
    assert.deepEqual(byPos(s, 't3').slice(-1), ['T4P1']);
    assert.equal(s.teams.t4, undefined);
    assert.deepEqual(s.queue, ['t3']);
  });

  test('Permanência e estatísticas não mudam; o rodízio continua igual depois da retirada', () => {
    let s = mkSession([5, 5, 5, 5]);
    s = registerResult(s, 'A').state; // Time 1 vence; Time 3 entra; Time 2 vai para o fim
    assert.deepEqual(s.field, ['t1', 't3']);
    s = removePlayer(s, 'T1P1', 'injury').state;
    assert.equal(s.teams.t1.permanence, true);
    assert.equal(s.teams.t1.stats.wins, 1);
    assert.deepEqual(byPos(s, 't1').slice(-1), ['T4P5'], 'pos. 1 do PRO (Time 4) completou o Time 1');
    assert.deepEqual(byPos(s, 't4').slice(-1), ['T2P5'], 'pos. 1 do Time 2 subiu para o fim do Time 4');
    assert.equal(s.teams.t2.line.length, 4);
    s = registerResult(s, 'B').state; // Time 3 vence; Time 1 sai e completa o Time 2 (último, com 4)
    assert.deepEqual(s.field, ['t4', 't3']);
    assert.equal(s.teams.t2.line.length, 5);
    validate(s);
  });

  test('Goleiro retirado: o próximo goleiro da esteira sobe, em cascata entre equipes com goleiro', () => {
    let s = mkSession([5, 5, 5, 5, 5], { gks: [1, 1, 1, 0, 1], config: { useGoalkeepers: true } });
    s = removePlayer(s, 'T1G1', 'injury').state;
    assert.deepEqual(s.teams.t1.gks, ['T3G1'], 'goleiro do PRO vai para o Time 1');
    assert.deepEqual(s.teams.t3.gks, ['T5G1'], 'Time 4 sem goleiro é pulado; o do Time 5 sobe para o PRO');
    assert.deepEqual(s.teams.t5.gks, []);
    assert.deepEqual(s.teams.t2.gks, ['T2G1']);
    assert.equal(s.teams.t1.line.length, 5, 'linha não é mexida');
  });
});

suite('Transferência e ordem — seção 8/13', () => {
  test('Transferência: pos. 1–2 da origem ocupam as vagas 3–4 do destino; origem renumerada a partir de 1', () => {
    const s = mkSession([5, 5, 5, 2]);
    const t3 = byPos(s, 't3');
    const t4 = byPos(s, 't4');
    const sim = simulateTransfer(s, 't3', 't4', 2);
    assert.equal(sim.k, 2);
    assert.equal(s.teams.t4.line.length, 2, 'simulação não altera o estado');
    assert.equal(sim.to.after.size, 4);
    assert.deepEqual(
      sim.moving.map((x) => [x.pid, x.fromPosition, x.toPosition]),
      [[t3[0], 1, 3], [t3[1], 2, 4]],
      'simulação informa posição de origem e de destino',
    );
    const r = transferPlayers(s, 't3', 't4', 2);
    const s2 = r.state;
    assert.deepEqual(byPos(s2, 't4'), [t4[0], t4[1], t3[0], t3[1]], 'quem já estava no destino não muda');
    assert.deepEqual(byPos(s2, 't3'), [t3[2], t3[3], t3[4]], 'antigas pos. 3–5 viram 1–3');
    assert.ok(r.message.includes('pos. 1 → 3') && r.message.includes('pos. 2 → 4'), r.message);
  });

  test('Editar ordem: subir/descer em posições (de baixo para cima) sem perder ninguém', () => {
    const s = mkSession([5, 5]);
    const t1 = byPos(s, 't1');
    let s2 = movePlayerInOrder(s, 't1', t1[0], 1).state; // posição 1 sobe para a 2
    assert.deepEqual(byPos(s2, 't1'), [t1[1], t1[0], t1[2], t1[3], t1[4]]);
    s2 = movePlayerInOrder(s2, 't1', t1[0], -1).state; // volta para a 1
    assert.deepEqual(byPos(s2, 't1'), t1);
    assert.deepEqual(byPos(movePlayerInOrder(s, 't1', t1[0], -1).state, 't1'), t1, 'posição 1 não desce');
    assert.deepEqual(byPos(movePlayerInOrder(s, 't1', t1[4], 1).state, 't1'), t1, 'topo não sobe');
  });

  test('Mover goleiro entre equipes', () => {
    const s = mkSession([5, 5], { gks: [2, 0] });
    const s2 = moveGoalkeeper(s, 'T1G2', 't2').state;
    assert.deepEqual(s2.teams.t2.gks, ['T1G2']);
  });
});

suite('Integridade e transações — seção 13', () => {
  test('Validação detecta jogador duplicado', () => {
    const s = mkSession([5, 5]);
    s.teams.t2.line.push({ pid: 'T1P1', role: 'M' });
    assert.throws(() => validate(s), /duplicado/);
  });

  test('Validação detecta jogador desaparecido', () => {
    const s = mkSession([5, 5]);
    s.teams.t2.line.pop();
    assert.throws(() => validate(s), /desapareceu/);
  });

  test('Comando inválido não altera o estado original (transação)', () => {
    const s = mkSession([5, 5, 5]);
    const snap = JSON.stringify(s);
    assert.throws(() => registerResult(s, 'draw'));
    assert.equal(JSON.stringify(s), snap);
  });

  test('Desfazer restaura exatamente o estado anterior', () => {
    const store = createStore(null);
    let s = mkSession([5, 5, 5, 2]);
    const prev = JSON.parse(JSON.stringify(s));
    store.pushUndo(s.id, 'resultado', prev);
    s = registerResult(s, 'A').state;
    assert.ok(s.games.length === 1);
    const u = store.popUndo(s.id);
    assert.deepEqual(u.state, prev);
    assert.equal(store.popUndo(s.id), null);
  });

  test('Estatísticas por jogador derivadas dos jogos', () => {
    let s = mkSession([5, 5, 5]);
    s = registerResult(s, 'A').state;
    const st = playerStats(s);
    assert.equal(st.find((x) => x.pid === 'T1P1').wins, 1);
    assert.equal(st.find((x) => x.pid === 'T2P1').losses, 1);
  });
});

suite('Cadastro e persistência — seções 2, 3 e 24', () => {
  test('Validação de jogador', () => {
    assert.throws(() => validatePlayer({ name: '', stars: 2, type: 'line', positions: ['D'] }), /nome/);
    assert.throws(() => validatePlayer({ name: 'A', stars: 3.5, type: 'line', positions: ['D'] }), /Classificação/);
    assert.throws(() => validatePlayer({ name: 'A', stars: 2, type: 'line', positions: [] }), /posição/);
    const gk = validatePlayer({ name: 'Goleiro', stars: 1.5, type: 'gk', positions: ['D'] });
    assert.deepEqual(gk.positions, []);
    assert.throws(() => validatePlayer({ name: ' joão ', stars: 2, type: 'line', positions: ['D'] }, [{ id: 'x', name: 'João' }]), /Já existe/);
  });

  test('Editar cadastro não altera snapshot da pelada', () => {
    const players = [{ id: 'a', name: 'Ana', stars: 2, type: 'line', positions: ['D'] }];
    const s = mkSession([5, 5]);
    s.snapshot.a = { ...players[0] };
    players[0].stars = 3;
    assert.equal(s.snapshot.a.stars, 2);
  });

  test('Exportar e importar backup', () => {
    const store = createStore(null);
    const s = mkSession([5, 5, 2]);
    const db = { schema: 1, players: [{ id: 'a', name: 'Ana', stars: 2, type: 'line', positions: ['D'] }], sessions: [s], settings: {}, activeSessionId: s.id };
    const text = store.exportData(db);
    const db2 = store.importData(text, db);
    assert.equal(db2.players[0].name, 'Ana');
    assert.equal(db2.sessions[0].id, s.id);
    assert.deepEqual(store.load().sessions[0].field, s.field);
    assert.throws(() => store.parseImport('{"x":1}'), /backup/);
  });

  test('Texto de compartilhamento inclui times, goleiros e ordem', () => {
    const s = mkSession([5, 5], { gks: [1, 0] });
    const t = shareText(s);
    assert.ok(t.includes('*TIME 1*'));
    assert.ok(t.includes('🧤 Gol1-1'));
    assert.ok(t.includes('(sem goleiro)'));
    // numeração = posição real (1 = base), topo listado primeiro, como nas telas
    const lines = t.split('\n');
    const i5 = lines.findIndex((l) => l.startsWith('5. T1-1'));
    const i1 = lines.findIndex((l) => l.startsWith('1. T1-5'));
    assert.ok(i5 >= 0 && i1 > i5, 'Time 1: posição 5 (topo) antes da posição 1 (base)');
    assert.ok(lines[i1].includes('sai 1º'));
  });
});
