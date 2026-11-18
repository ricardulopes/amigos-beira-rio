// Coletes dupla-face Amarelo/Azul (RN-108 a RN-111): testa o estado interno (session.vests), não só textos.
import { suite, test, assert } from './harness.js';
import { mkSession } from './helpers.js';
import { registerResult, analyzeResult, vestOf, incomingVest, vestPreview, ensureVests, validate, shareText } from '../src/domain/index.js';

const R = (s, r, o) => registerResult(s, r, o).state;
const vests = (s) => Object.fromEntries(s.field.map((id) => [id, vestOf(s, id)]));

suite('Coletes Amarelo/Azul', () => {
  test('RN-108: na abertura, Time 1 veste Amarelo e Time 2 veste Azul', () => {
    const s = mkSession([5, 5, 5]);
    assert.deepEqual(s.vests, { t1: 'yellow', t2: 'blue' });
    assert.equal(vestOf(s, 't3'), null, 'equipe da fila não tem colete definido');
  });

  test('RN-109: vitória do Amarelo — vencedor segue de Amarelo, PRO entra de Azul', () => {
    const s = R(mkSession([5, 5, 5]), 'A');
    assert.deepEqual(s.field, ['t1', 't3']);
    assert.deepEqual(vests(s), { t1: 'yellow', t3: 'blue' });
    assert.deepEqual(s.vests, { t1: 'yellow', t3: 'blue' }, 'quem saiu não guarda colete');
  });

  test('RN-109: vitória do Azul — vencedor segue de Azul, PRO entra de Amarelo', () => {
    const s = R(mkSession([5, 5, 5]), 'B');
    assert.deepEqual(s.field, ['t3', 't2']);
    assert.deepEqual(vests(s), { t3: 'yellow', t2: 'blue' });
  });

  test('RN-109: sequência de vitórias mantém a cor de quem fica', () => {
    let s = mkSession([5, 5, 5]);
    s = R(s, 'A'); // t1 (Amarelo) vence; t3 entra de Azul
    s = R(s, 'B'); // t3 (Azul) vence; t2 entra de Amarelo no lugar de t1
    assert.deepEqual(s.field, ['t2', 't3']);
    assert.deepEqual(vests(s), { t2: 'yellow', t3: 'blue' });
    s = R(s, 'A'); // t2 (Amarelo) vence; t1 entra de Azul
    assert.deepEqual(vests(s), { t2: 'yellow', t1: 'blue' });
  });

  test('RN-110: empate com saída dupla — 1º que sobe veste Amarelo, 2º veste Azul', () => {
    const s0 = mkSession([5, 5, 5, 5]);
    assert.equal(analyzeResult(s0, 'draw').scenario, 'DRAW_DOUBLE_EXIT');
    const s = R(s0, 'draw');
    assert.deepEqual(s.field, ['t3', 't4']);
    assert.deepEqual(vests(s), { t3: 'yellow', t4: 'blue' });
  });

  test('RN-111: empate com um só saindo — quem fica mantém a cor, quem entra veste a de quem saiu', () => {
    // par ou ímpar: t2 (Azul) vence e fica; t3 entra com o Amarelo de t1
    const s = R(mkSession([5, 5, 5]), 'draw', { tossWinner: 't2' });
    assert.deepEqual(vests(s), { t3: 'yellow', t2: 'blue' });
    // desafiante permanece no empate: t3 (Azul) fica; t2 entra com o Amarelo de t1
    let s2 = R(mkSession([5, 5, 5]), 'A');
    s2 = R(s2, 'draw');
    assert.deepEqual(s2.field, ['t2', 't3']);
    assert.deepEqual(vests(s2), { t2: 'yellow', t3: 'blue' });
  });

  test('Indicador da fila: PRO fica neutro até o resultado; demais equipes sem indicação', () => {
    const s = mkSession([5, 5, 5, 5]);
    const pro = incomingVest(s, 't3');
    assert.equal(pro.vest, null);
    assert.ok(/quem sair/.test(pro.text));
    assert.equal(incomingVest(s, 't4'), null);
  });

  test('Prévia e explicação do resultado informam os coletes da próxima partida', () => {
    const s = mkSession([5, 5, 5]);
    assert.equal(vestPreview(s, 'A'), 'Próxima partida: Time 1 de Amarelo, Time 3 de Azul.');
    assert.equal(vestPreview(s, 'draw'), null, 'par ou ímpar pendente: sem prévia');
    const res = registerResult(s, 'B');
    assert.ok(res.explanation.includes('Coletes: Time 3 de Amarelo, Time 2 de Azul.'));
    assert.deepEqual(res.game.vestsAfter, { 'Time 3': 'yellow', 'Time 2': 'blue' });
    assert.equal(res.game.teamA.vest, 'yellow', 'registro do jogo guarda a cor de cada equipe');
    assert.equal(res.game.teamB.vest, 'blue');
  });

  test('Texto do WhatsApp indica o colete das equipes em campo', () => {
    const t = shareText(R(mkSession([5, 5, 5]), 'B'));
    assert.ok(t.includes('*TIME 3* — EM JOGO 🟡 colete Amarelo'));
    assert.ok(t.includes('*TIME 2* — EM JOGO 🔵 colete Azul'));
    assert.ok(t.includes('*TIME 1* — PRO') && !/TIME 1\* — PRO 🟡|TIME 1\* — PRO 🔵/.test(t), 'fila sem cor definida');
  });

  test('Integridade: as duas equipes em campo nunca vestem a mesma cor', () => {
    const s = mkSession([5, 5, 5]);
    s.vests = { t1: 'yellow', t2: 'yellow' };
    assert.throws(() => validate(s), /mesma cor/);
  });

  test('Migração: pelada salva sem coletes recebe Amarelo/Azul pela ordem do campo', () => {
    const s = R(mkSession([5, 5, 5]), 'B');
    delete s.vests;
    assert.equal(vestOf(s, 't3'), 'yellow', 'consulta funciona mesmo sem registro');
    const m = ensureVests(s);
    assert.deepEqual(m.vests, { t3: 'yellow', t2: 'blue' });
    assert.ok(!s.vests, 'não altera o objeto original');
    assert.ok(validate(m));
  });
});
