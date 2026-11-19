// Banco unificado (RN-113 a RN-117): o que muda, fila offline e mescla com a nuvem — sem rede.
import { suite, test, assert } from './harness.js';
import { emptyOutbox, outboxSize, diffDb, isEmptyDiff, addToOutbox, mergeRemote, rowToPlayer, playerToRow } from '../src/cloud/diff.js';

const pl = (id, name, stars = 2, positions = ['M']) => ({ id, name, stars, type: 'line', positions });
const ses = (id, games = 0) => ({ id, title: id, status: 'live', games: Array.from({ length: games }, (_, n) => ({ n: n + 1 })) });
const db = (over = {}) => ({ players: [], sessions: [], settings: { linePerTeam: 5 }, setup: null, activeSessionId: null, ...over });

suite('Nuvem — visitante não grava (RN-116)', () => {
  test('Mudança feita sem acesso de administrador é recusada e não entra na fila', async () => {
    const sync = await import('../src/cloud/sync.js');
    // Num navegador com admin logado (mesmo endereço do app), a regra não se aplica: não há o que testar.
    if (sync.adminSession()) return;
    const base = db({ players: [pl('a', 'Ari')] });
    assert.ok(sync.track(base), 'a primeira cópia vira a referência');
    const changed = db({ players: [pl('a', 'Ari', 3, ['A'])], settings: { linePerTeam: 7 } });
    assert.equal(sync.track(changed), false, 'visitante não pode alterar');
    assert.equal(sync.cloud.pending, 0, 'nada vai para a fila de envio');
    assert.deepEqual(sync.baselineCopy(), base, 'a referência continua a de antes (o app desfaz a mudança)');
  });
});

suite('Nuvem — diferenças e fila offline', () => {
  test('Detecta jogador novo, alterado e excluído; pelada nova, alterada e excluída; configurações', () => {
    const prev = db({ players: [pl('a', 'Ari'), pl('b', 'Branco')], sessions: [ses('s1'), ses('s2')] });
    const next = db({
      players: [pl('a', 'Ari', 2.5), pl('c', 'Chico')],
      sessions: [ses('s1', 1), ses('s3')],
      settings: { linePerTeam: 6 },
      activeSessionId: 's3',
    });
    const d = diffDb(prev, next);
    assert.deepEqual(d.players.sort(), ['a', 'c']);
    assert.deepEqual(d.playersDeleted, ['b']);
    assert.deepEqual(d.peladas.sort(), ['s1', 's3']);
    assert.deepEqual(d.peladasDeleted, ['s2']);
    assert.equal(d.appState, true);
    assert.ok(isEmptyDiff(diffDb(next, JSON.parse(JSON.stringify(next)))), 'sem mudança, nada a enviar');
  });

  test('Fila acumula sem duplicar e guarda a PRIMEIRA versão-base de cada pelada', () => {
    let ob = emptyOutbox();
    ob = addToOutbox(ob, { players: ['a'], playersDeleted: [], peladas: ['s1'], peladasDeleted: [], appState: false }, { s1: 4 });
    ob = addToOutbox(ob, { players: ['a', 'b'], playersDeleted: [], peladas: ['s1'], peladasDeleted: [], appState: true }, { s1: 9 });
    assert.deepEqual(ob.players, ['a', 'b']);
    assert.equal(ob.peladas.s1, 4, 'base de quando a primeira mudança offline foi feita');
    assert.equal(ob.appState, true);
    assert.equal(outboxSize(ob), 4);
    ob = addToOutbox(ob, { players: [], playersDeleted: ['b'], peladas: [], peladasDeleted: ['s1'], appState: false });
    assert.deepEqual(ob.players, ['a']);
    assert.deepEqual(ob.playersDeleted, ['b']);
    assert.ok(!('s1' in ob.peladas) && ob.peladasDeleted.includes('s1'), 'exclusão substitui a gravação pendente');
    const before = JSON.stringify(ob);
    addToOutbox(ob, { players: ['z'], playersDeleted: [], peladas: [], peladasDeleted: [], appState: false });
    assert.equal(JSON.stringify(ob), before, 'não muta a fila recebida');
  });

  test('Pelada nova (nunca enviada) vai com versão-base 0', () => {
    const ob = addToOutbox(emptyOutbox(), { players: [], playersDeleted: [], peladas: ['nova'], peladasDeleted: [], appState: false }, {});
    assert.equal(ob.peladas.nova, 0);
  });
});

suite('Nuvem — mescla com o que chega do servidor', () => {
  test('Sem pendências, o aparelho fica igual à nuvem (inclusive exclusões)', () => {
    const local = db({ players: [pl('a', 'Ari'), pl('x', 'Velho')], sessions: [ses('s1'), ses('sx')], activeSessionId: 'sx' });
    const remote = {
      players: [pl('a', 'Ari', 3), pl('b', 'Branco')],
      peladas: [{ id: 's1', version: 7, state: ses('s1', 2) }],
      appState: { settings: { linePerTeam: 6 }, setup: { selected: ['a'] }, activeSessionId: 's1' },
    };
    const { db: out, versions } = mergeRemote(local, remote, emptyOutbox(), { sx: 3 });
    assert.deepEqual(out.players.map((p) => p.id).sort(), ['a', 'b']);
    assert.equal(out.players.find((p) => p.id === 'a').stars, 3);
    assert.deepEqual(out.sessions.map((s) => s.id), ['s1']);
    assert.equal(out.sessions[0].games.length, 2);
    assert.deepEqual(versions, { s1: 7 });
    assert.equal(out.settings.linePerTeam, 6);
    assert.equal(out.activeSessionId, 's1');
    assert.deepEqual(out.setup, { selected: ['a'] });
  });

  test('Mudança pendente deste aparelho (offline) não é sobrescrita pela nuvem', () => {
    const local = db({ players: [pl('a', 'Ari', 2.5), pl('n', 'Novo')], sessions: [ses('s1', 5)], settings: { linePerTeam: 7 } });
    let ob = emptyOutbox();
    ob = addToOutbox(ob, { players: ['a', 'n'], playersDeleted: ['b'], peladas: ['s1'], peladasDeleted: [], appState: true }, { s1: 2 });
    const remote = {
      players: [pl('a', 'Ari', 1), pl('b', 'Branco')],
      peladas: [{ id: 's1', version: 2, state: ses('s1', 1) }],
      appState: { settings: { linePerTeam: 5 }, setup: null, activeSessionId: null },
    };
    const { db: out } = mergeRemote(local, remote, ob, { s1: 2 });
    assert.equal(out.players.find((p) => p.id === 'a').stars, 2.5, 'edição local pendente vale');
    assert.ok(out.players.some((p) => p.id === 'n'), 'jogador criado offline continua');
    assert.ok(!out.players.some((p) => p.id === 'b'), 'exclusão pendente continua');
    assert.equal(out.sessions[0].games.length, 5, 'jogos registrados offline continuam');
    assert.equal(out.settings.linePerTeam, 7);
  });

  test('Conversão de linha do banco ↔ jogador do app', () => {
    const p = rowToPlayer({ id: 'x', name: 'Japa', stars: '3.0', type: 'line', positions: ['D', 'M'], created_at: '2026-01-01T00:00:00Z' });
    assert.equal(p.stars, 3);
    assert.deepEqual(p.positions, ['D', 'M']);
    assert.deepEqual(playerToRow({ ...p, type: 'gk' }).positions, [], 'goleiro vai sem posições');
  });
});
