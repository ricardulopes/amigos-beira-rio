// Regras de resultado e EMPATE (PRD seção 9). Só DECIDE o que acontece — não altera o estado.
// A aplicação da movimentação fica em rotation.js.
//
// Ordem de decisão do empate:
//   1. PRO e RE completos               → DRAW_DOUBLE_EXIT     (RN-54/55)  saem os dois, sempre
//   2. ninguém em campo com permanência → DRAW_TOSS            (RN-56)     par ou ímpar
//   3. alguém defende permanência        → DRAW_CHALLENGER_STAYS (RN-57/58) desafiante fica
// Exceção configurável (RN-62): no 1º jogo, sem permanência, par ou ímpar mesmo com PRO e RE completos.
import { RuleError, isComplete } from './session.js';

export const SCENARIOS = {
  WIN: 'WIN',
  DRAW_DOUBLE_EXIT: 'DRAW_DOUBLE_EXIT',
  DRAW_TOSS: 'DRAW_TOSS',
  DRAW_CHALLENGER_STAYS: 'DRAW_CHALLENGER_STAYS',
};

/** Situação da fila e do campo no momento do resultado (RN-42, RN-59). */
export function fieldSituation(s) {
  if (s.field.length < 2) throw new RuleError('É preciso ter duas equipes em campo.');
  const [a, b] = s.field;
  const pro = s.queue[0] ? s.teams[s.queue[0]] : null;
  const re = s.queue[1] ? s.teams[s.queue[1]] : null;
  return {
    A: s.teams[a],
    B: s.teams[b],
    pro,
    re,
    proComplete: isComplete(s, pro),
    reComplete: isComplete(s, re),
    completeWaiting: s.queue.filter((id) => isComplete(s, s.teams[id])).length,
    isFirstGame: s.games.length === 0,
  };
}

/**
 * Analisa (sem alterar) o que acontecerá com o resultado informado.
 * @param {'A'|'B'|'draw'} result 'A' = vitória do slot 0, 'B' = vitória do slot 1.
 * @returns {{scenario, staying: string[]|null, leaving: string[]|null, needsToss, explanation, ...}}
 */
export function analyzeResult(s, result) {
  if (s.status === 'finished') throw new RuleError('Pelada encerrada.');
  const sit = fieldSituation(s);
  const { A, B, pro, re, proComplete, reComplete, completeWaiting, isFirstGame } = sit;
  const base = { result, isFirstGame, proComplete, reComplete, completeWaiting, fieldA: A.id, fieldB: B.id };

  if (result === 'A' || result === 'B') {
    const winner = result === 'A' ? A : B;
    const loser = result === 'A' ? B : A;
    return {
      ...base,
      scenario: SCENARIOS.WIN,
      staying: [winner.id],
      leaving: [loser.id],
      needsToss: false,
      explanation: `${winner.label} venceu e permanece em campo defendendo a permanência. ${loser.label} sai e vai para o fim da fila${pro ? `; ${pro.label} (PRO) entra` : ''}.`,
    };
  }
  if (result !== 'draw') throw new RuleError('Resultado inválido.');

  const doubleExit = proComplete && reComplete;
  const noAdvantage = !A.permanence && !B.permanence;
  const forceToss = isFirstGame && noAdvantage && s.config.tossOnFirstGameEvenWithTwoWaiting;

  if (doubleExit && !forceToss) {
    // RN-55: desafiante sem permanência volta à fila antes do defensor.
    const leaving = A.permanence && !B.permanence ? [B.id, A.id] : [A.id, B.id];
    return {
      ...base,
      scenario: SCENARIOS.DRAW_DOUBLE_EXIT,
      staying: [],
      leaving,
      needsToss: false,
      explanation:
        `Empate com PRO (${pro.label}) e RE (${re.label}) completos aguardando: os dois times em campo saem, ` +
        `independentemente de vitórias ou permanência anteriores. ${pro.label} e ${re.label} entram; ` +
        `${s.teams[leaving[0]].label} e ${s.teams[leaving[1]].label} vão para o fim da fila nessa ordem.`,
    };
  }
  if (noAdvantage) {
    return {
      ...base,
      scenario: SCENARIOS.DRAW_TOSS,
      staying: null,
      leaving: null,
      needsToss: true,
      explanation:
        (isFirstGame ? 'Empate no primeiro jogo' : 'Empate sem nenhum time com permanência estabelecida') +
        ': decidir no par ou ímpar. O vencedor permanece com vantagem de permanência; o perdedor sai.' +
        (doubleExit && forceToss ? ' (Configuração: par ou ímpar no 1º jogo mesmo com dois completos aguardando.)' : ''),
    };
  }
  const defender = A.permanence ? A : B;
  const challenger = A.permanence ? B : A;
  const why = !pro
    ? 'nenhum time aguardando'
    : !proComplete
      ? 'nenhum time completo aguardando'
      : `apenas o PRO (${pro.label}) completo aguardando${re ? `, RE (${re.label}) incompleto` : ''}`;
  return {
    ...base,
    scenario: SCENARIOS.DRAW_CHALLENGER_STAYS,
    staying: [challenger.id],
    leaving: [defender.id],
    needsToss: false,
    explanation:
      `Empate com ${why}: ${challenger.label} ainda não tinha permanência e joga pelo empate — permanece e passa a defender a permanência ` +
      `(conta como vitória para a regra). ${defender.label} perde a vantagem e sai para o fim da fila.`,
  };
}

/** Frase curta com o que acontece SE o jogo atual empatar (RN-65). Vazia se não houver jogo. */
export function drawHint(s) {
  try {
    const an = analyzeResult(s, 'draw');
    if (an.scenario === SCENARIOS.DRAW_DOUBLE_EXIT) return 'Se empatar: PRO e RE estão completos → saem os dois times.';
    if (an.scenario === SCENARIOS.DRAW_TOSS) return 'Se empatar: ninguém tem permanência → par ou ímpar.';
    return `Se empatar: ${s.teams[an.staying[0]].label} (desafiante*) joga pelo empate e fica.`;
  } catch {
    return '';
  }
}

/** Situação de vantagem de uma equipe em campo, para exibição: 'defending' | 'challenger' | 'none' | null. */
export function advantageStatus(s, tid) {
  if (!s.field.includes(tid) || s.status !== 'live') return null;
  if (s.teams[tid].permanence) return 'defending';
  const other = s.teams[s.field.find((id) => id !== tid)];
  return other && other.permanence ? 'challenger' : 'none';
}
