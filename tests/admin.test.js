// Permissões com PIN mestre (RN-113 a RN-117) e importação da base em lote (RN-103 a RN-107).
import { suite, test, assert } from './harness.js';
import {
  validatePinFormat, requiresAdmin, adminExpiry, isAdminActive, PIN_RULES, ADMIN_ACTIONS, PUBLIC_ACTIONS,
  parseRosterLine, parseRoster, planRosterImport, applyRosterImport, rosterPlanSummary, rosterText, validatePlayer, seedPlayers,
} from '../src/domain/index.js';
import { OFFICIAL_ROSTER } from '../src/data/lista-oficial.js';
import { createStore } from '../src/storage/storage.js';

/** Armazenamento falso em memória (não toca no localStorage do navegador). */
function memBackend() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

suite('Permissões: PIN mestre e visitante só leitura (RN-113 a RN-117)', () => {
  test('Formato do PIN: só números, 4 a 8 dígitos', () => {
    assert.equal(validatePinFormat('1234'), '1234');
    assert.equal(validatePinFormat('12345678'), '12345678');
    assert.throws(() => validatePinFormat('123'), /4 a 8/);
    assert.throws(() => validatePinFormat('123456789'), /4 a 8/);
    assert.throws(() => validatePinFormat('12a4'), /só números/);
    assert.throws(() => validatePinFormat(''), /só números/);
  });

  test('Visitante só vê, compartilha e exporta; qualquer alteração exige o PIN mestre (RN-116)', () => {
    assert.deepEqual(Object.keys(PUBLIC_ACTIONS).sort(), ['export', 'share', 'view']);
    for (const a of ['view', 'share', 'export']) assert.ok(!requiresAdmin(a), `${a} deveria ser livre`);
    for (const a of ['draw', 'pelada', 'result', 'player-create', 'player-edit', 'player-delete', 'own-positions', 'player-code',
      'roster-import', 'backup-import', 'settings', 'history-delete', 'pin-change', 'qualquer-coisa', 'toString']) {
      assert.ok(requiresAdmin(a), `${a} deveria exigir o PIN mestre`);
    }
    for (const a of Object.keys(ADMIN_ACTIONS)) assert.ok(requiresAdmin(a));
  });

  test('Não existe mais código do jogador nem troca da própria posição', () => {
    assert.ok(!('codeLength' in PIN_RULES));
    assert.ok(!('player-code' in ADMIN_ACTIONS));
    assert.ok(!Object.values(PUBLIC_ACTIONS).some((t) => /posi|código/i.test(t)));
  });

  test('Acesso de administrador vale 12 horas', () => {
    const until = adminExpiry(0);
    assert.equal(PIN_RULES.sessionHours, 12);
    assert.ok(isAdminActive(until, 12 * 3600 * 1000 - 1));
    assert.ok(!isAdminActive(until, 12 * 3600 * 1000 + 1));
    assert.ok(!isAdminActive(undefined, 0));
  });
});

suite('Lista oficial embutida (RN-112)', () => {
  test('A lista oficial é lida sem erros: 79 atletas, 5 goleiros, valores conferidos (auditoria 2026-11-19)', () => {
    const players = seedPlayers(OFFICIAL_ROSTER);
    assert.equal(players.length, 79);
    assert.deepEqual(players.filter((p) => p.type === 'gk').map((p) => p.name).sort((a, b) => a.localeCompare(b, 'pt-BR')), ['Fabio', 'Jarbas', 'João Marcos', 'Johnin', 'Paulão']);
    const by = Object.fromEntries(players.map((p) => [p.name, p]));
    assert.equal(by.Jarbas.stars, 2);
    assert.equal(by.Fabio.stars, 1.5);
    assert.equal(by.Vagner.stars, 1.5);
    assert.deepEqual(by.Ricardo.positions, ['D', 'M', 'A']);
    assert.ok(by.Udsney && by.Van && by['Jonathan (Cabeção)'] && by['Kauã'] && by['Maurício Pai'] && by.Cantor);
    assert.ok(!by.Wagner && !by.Humberto && !by['Cabeção'], 'unificados/excluídos não voltam');
    assert.equal(new Set(players.map((p) => p.id)).size, 79, 'ids únicos');
    assert.throws(() => seedPlayers('Fulano; 9; M'), /Lista inicial com erro/);
  });

  test('Primeira abertura semeia o cadastro e salva; depois não semeia de novo', () => {
    const be = memBackend();
    const db1 = createStore(be).load();
    assert.equal(db1.players.length, 79);
    assert.ok(be.getItem('pelada.db'), 'gravado na primeira abertura');
    const db2 = createStore(be).load();
    assert.deepEqual(db2.players.map((p) => p.id), db1.players.map((p) => p.id), 'mesmos ids ao reabrir');
    const store = createStore(be);
    store.save({ ...db2, players: [] }); // como "Apagar todos os dados"
    assert.equal(createStore(be).load().players.length, 0, 'banco vazio salvo continua vazio');
  });
});

const P = (name, stars, type = 'line', positions = ['M']) => validatePlayer({ name, stars, type, positions: type === 'gk' ? [] : positions });

suite('Importação da base em lote', () => {
  test('Lê formatos em colunas e em texto livre', () => {
    const a = parseRosterLine('Branco; 2,5; D');
    assert.deepEqual([a.name, a.stars, a.type, a.positions], ['Branco', 2.5, 'line', ['D']]);
    const b = parseRosterLine('Thiaguinho 3★ M,A');
    assert.deepEqual([b.name, b.stars, b.positions], ['Thiaguinho', 3, ['M', 'A']]);
    const c = parseRosterLine('Fabio (G) 2');
    assert.deepEqual([c.name, c.stars, c.type], ['Fabio', 2, 'gk']);
    const d = parseRosterLine('Udisnei/Walt Disney 2 M, A');
    assert.deepEqual([d.name, d.stars, d.positions], ['Udisnei/Walt Disney', 2, ['M', 'A']]);
    const e = parseRosterLine('Leo Baiano X');
    assert.equal(e.exclude, true);
    assert.equal(e.name, 'Leo Baiano');
    const f = parseRosterLine('- Ari ? D');
    assert.deepEqual([f.name, f.stars, f.positions], ['Ari', null, ['D']]);
  });

  test('Número que faz parte do nome ("Felipe 2") não vira estrela', () => {
    const withStars = parseRosterLine('Felipe 2 2,5★ M');
    assert.deepEqual([withStars.name, withStars.stars], ['Felipe 2', 2.5]);
    const cols = parseRosterLine('Felipe 2; 3; A');
    assert.deepEqual([cols.name, cols.stars], ['Felipe 2', 3]);
    const known = parseRoster('Felipe 2', [P('Felipe 2', 2)]);
    assert.deepEqual([known[0].name, known[0].stars], ['Felipe 2', null]);
  });

  test('Erros de linha: estrelas inválidas, goleiro com posição, texto desconhecido, nome repetido', () => {
    assert.ok(/Estrelas inválidas/.test(parseRosterLine('Ivan; 4; D').error));
    assert.ok(/Goleiro/.test(parseRosterLine('Jarbas; 2; G, D').error));
    assert.ok(/Não entendi/.test(parseRosterLine('Igor; 2; zagueiro').error));
    const list = parseRoster('Igor; 2; D\n# comentário\n\nígor; 3; M');
    assert.equal(list.length, 2);
    assert.ok(/repetido/.test(list[1].error));
  });

  test('Mesclar: cria, atualiza só o informado, exclui com X e mantém o resto', () => {
    const base = [P('Branco', 2, 'line', ['M']), P('Fabio', 1.5, 'line', ['A']), P('Leo Baiano', 2), P('Marra', 2)];
    const entries = parseRoster('Branco 2,5★ D\nFabio (G)\nLeo Baiano X\nTuquinha 3★ M,A\nMarra 2 M\nCantor X');
    const plan = planRosterImport(base, entries);
    assert.deepEqual(plan.create.map((p) => p.name), ['Tuquinha']);
    assert.deepEqual(plan.update.map((u) => u.after.name), ['Branco', 'Fabio']);
    assert.deepEqual(plan.remove.map((p) => p.name), ['Leo Baiano']);
    assert.deepEqual(plan.unchanged.map((p) => p.name), ['Marra']);
    assert.equal(plan.ignored.length, 1, 'Cantor X sem cadastro é só ignorado');
    const out = applyRosterImport(base, plan);
    const by = Object.fromEntries(out.map((p) => [p.name, p]));
    assert.deepEqual([by.Branco.stars, by.Branco.positions], [2.5, ['D']]);
    assert.deepEqual([by.Fabio.type, by.Fabio.stars, by.Fabio.positions], ['gk', 1.5, []], 'Fabio vira goleiro e mantém as estrelas');
    assert.equal(by.Branco.id, base[0].id, 'atualização preserva o id (histórico continua ligado)');
    assert.ok(!by['Leo Baiano']);
    assert.equal(out.length, 4);
    assert.equal(base.length, 4, 'cadastro original não é alterado');
  });

  test('Jogador novo sem estrelas ou sem posição é recusado; os válidos seguem', () => {
    const plan = planRosterImport([], parseRoster('Ari ? D\nCabeção 2\nChico 1,5 A'));
    assert.deepEqual(plan.create.map((p) => p.name), ['Chico']);
    assert.equal(plan.errors.length, 2);
    assert.ok(plan.errors.some((e) => /estrelas/.test(e.message)));
    assert.ok(plan.errors.some((e) => /posição/.test(e.message)));
    assert.ok(/1 novo/.test(rosterPlanSummary(plan)));
  });

  test('Lista exportada volta igual na importação (ida e volta)', () => {
    const base = [P('Thiaguinho', 3, 'line', ['M', 'A']), P('Jarbas', 2.5, 'gk'), P('Felipe 2', 1.5, 'line', ['D'])];
    const text = rosterText(base);
    assert.equal(text.split('\n')[0], 'Felipe 2; 1,5; D');
    assert.ok(text.includes('Jarbas; 2,5; G'));
    const plan = planRosterImport(base, parseRoster(text, base));
    assert.equal(plan.unchanged.length, 3);
    assert.equal(plan.create.length + plan.update.length + plan.remove.length + plan.errors.length, 0);
  });

  test('Substituir: exclui quem não está na lista e qualquer erro bloqueia', () => {
    const base = [P('Alves', 2), P('Balão', 2), P('Japa', 3)];
    const ok = planRosterImport(base, parseRoster('Alves 2 M\nJapa 3 M'), { mode: 'replace' });
    assert.deepEqual(ok.remove.map((p) => p.name), ['Balão']);
    assert.deepEqual(applyRosterImport(base, ok).map((p) => p.name), ['Alves', 'Japa']);
    const bad = planRosterImport(base, parseRoster('Alves 2 M\nJapa 9 M'), { mode: 'replace' });
    assert.equal(bad.blocked, true);
    assert.throws(() => applyRosterImport(base, bad), /Corrija/);
  });
});
