// Banco unificado (RN-113 a RN-117): o que muda, fila offline e mescla com a nuvem — sem rede.
import { suite, test, assert } from './harness.js';
import {
  emptyOutbox, outboxSize, diffDb, isEmptyDiff, addToOutbox, mergeRemote, mergeAppState, merge3, rowToPlayer, playerToRow,
  stableStringify, stateFingerprint, isOwnLostWrite,
} from '../src/cloud/diff.js';

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

suite('Nuvem — dois admins nas configurações (RN-133)', () => {
  const st = (finance, setup = null) => ({ settings: { groupName: 'ABR', finance }, setup, activeSessionId: null });
  const c = (id, cents) => ({ id, pid: 'g1', name: 'Goleiro', cents, note: '', at: '2027-03-01T10:00:00' });

  test('A fila guarda a base das configurações só na primeira mudança pendente', () => {
    const d = { players: [], playersDeleted: [], peladas: [], peladasDeleted: [], appState: true };
    let ob = addToOutbox(emptyOutbox(), d, {}, st({ contributions: [] }));
    ob = addToOutbox(ob, d, {}, st({ contributions: [c('x', 1)] }));
    assert.deepEqual(ob.appStateBase.settings.finance.contributions, [], 'base = como estava antes da 1ª mudança offline');
  });

  test('Aporte do admin A não some quando o admin B (que estava sem sinal) envia as configurações dele', () => {
    const base = st({ contributions: [c('c0', 1000)], cycles: [] }, { selected: ['a'] });
    const remote = st({ contributions: [c('c0', 1000), c('cA', 5000)], cycles: [] }, { selected: ['a'] }); // A lançou R$ 50
    const local = st({ contributions: [c('c0', 1000), c('cB', 3000)], cycles: [] }, { selected: ['a', 'b'] }); // B lançou R$ 30 e mexeu na seleção
    const m = mergeAppState(base, local, remote);
    assert.deepEqual(m.settings.finance.contributions.map((x) => x.id), ['c0', 'cA', 'cB'], 'os dois aportes ficam');
    assert.deepEqual(m.setup.selected, ['a', 'b'], 'a mudança de B na seleção também fica');
  });

  test('Exclusão de aporte por um admin e encerramento de ciclo pelo outro sobrevivem à mescla', () => {
    const open = { id: 'cy1', label: '1º semestre', start: '2027-01-01T00:00:00', end: null, resetCashback: true };
    const base = st({ contributions: [c('c0', 1000), c('c1', 2000)], cycles: [open] });
    const remote = st({ contributions: [c('c0', 1000), c('c1', 2000)], cycles: [{ ...open, end: '2027-06-30T00:00:00' }] }); // A encerrou
    const local = st({ contributions: [c('c0', 1000)], cycles: [open] }); // B excluiu c1
    const m = mergeAppState(base, local, remote);
    assert.deepEqual(m.settings.finance.contributions.map((x) => x.id), ['c0']);
    assert.equal(m.settings.finance.cycles[0].end, '2027-06-30T00:00:00', 'o encerramento do ciclo não é desfeito');
    assert.equal(m.settings.groupName, 'ABR');
  });

  test('Sem base conhecida (fila antiga) envia o que está no aparelho, como antes', () => {
    const local = st({ contributions: [] });
    assert.equal(mergeAppState(null, local, st({ contributions: [c('z', 1)] })), local);
    assert.equal(merge3(1, 2, 3), 2, 'conflito real no mesmo campo: vale quem está enviando');
    assert.equal(merge3(1, 1, 3), 3, 'só a nuvem mudou: vale a nuvem');
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

suite('Nuvem — sinal caiu depois de a nuvem gravar (auditoria 2026-11-21)', () => {
  test('JSON canônico: a ordem das chaves (jsonb do Postgres) não muda a comparação', () => {
    const a = { id: 's1', teams: { t2: { line: [1, 2] }, t1: { gks: [] } }, x: undefined, games: [{ n: 1, r: 'A' }] };
    const b = { games: [{ r: 'A', n: 1 }], teams: { t1: { gks: [] }, t2: { line: [1, 2] } }, id: 's1' };
    assert.equal(stableStringify(a), stableStringify(b));
    assert.equal(stateFingerprint(a), stateFingerprint(b));
    assert.ok(stateFingerprint(a) !== stateFingerprint({ ...b, games: [{ r: 'B', n: 1 }] }), 'conteúdo diferente, impressão diferente');
    assert.ok(stableStringify([2, 1]) !== stableStringify([1, 2]), 'ordem de listas importa');
  });

  test('Nuvem igual a um envio nosso sem resposta: não é conflito; nuvem diferente: conflito de verdade', () => {
    const sent1 = { id: 's1', status: 'live', removed: ['A'] };
    const sent2 = { id: 's1', status: 'live', removed: ['A', 'B'] }; // mexeu de novo antes do reenvio
    const fps = [stateFingerprint(sent1), stateFingerprint(sent2)];
    const cloud = JSON.parse(JSON.stringify({ removed: ['A'], status: 'live', id: 's1' })); // como volta do jsonb
    assert.ok(isOwnLostWrite(fps, cloud), 'a nuvem tem o 1º envio, cuja resposta se perdeu');
    assert.ok(isOwnLostWrite(stateFingerprint(sent1), cloud), 'aceita uma impressão só (formato antigo)');
    assert.ok(!isOwnLostWrite(fps, { id: 's1', status: 'live', removed: ['Z'] }), 'outro admin gravou: conflito real');
    assert.ok(!isOwnLostWrite([], cloud));
    assert.ok(!isOwnLostWrite(fps, null));
  });
});
