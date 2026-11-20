// Regras de resultado e EMPATE (PRD seção 9). Só DECIDE o que acontece — não altera o estado.
// A aplicação da movimentação fica em rotation.js.
//
// Ordem de decisão do empate (automática, sem opção em Ajustes):
//   1º jogo, sempre par ou ímpar (RN-56):
//     PRO e RE completos                → DRAW_TOSS_DOUBLE_EXIT  saem os dois; vencedor do par ou ímpar volta antes à fila
//     senão                              → DRAW_TOSS              vencedor do par ou ímpar fica, perdedor sai
//   Do 2º jogo em diante, nunca par ou ímpar (RN-138):
//     PRO e RE completos                → DRAW_DOUBLE_EXIT       (RN-54/55) saem os dois; desafiante (ou quem entrou 1º) volta antes
//     ninguém com permanência            → DRAW_ENTRY_ORDER       quem entrou primeiro (slot A) fica
//     alguém defende permanência         → DRAW_CHALLENGER_STAYS  (RN-57/58) desafiante fica
import { RuleError, isComplete } from './session.js';

export const SCENARIOS = {
  WIN: 'WIN',
  DRAW_DOUBLE_EXIT: 'DRAW_DOUBLE_EXIT',
  DRAW_TOSS: 'DRAW_TOSS',
  DRAW_TOSS_DOUBLE_EXIT: 'DRAW_TOSS_DOUBLE_EXIT',
  DRAW_ENTRY_ORDER: 'DRAW_ENTRY_ORDER',
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
  const both = `${A.label} e ${B.label}`;

  // RN-56: no 1º jogo o empate SEMPRE vai para o par ou ímpar (automático; a antiga opção de Ajustes saiu).
  if (isFirstGame) {
    if (doubleExit) {
      return {
        ...base,
        scenario: SCENARIOS.DRAW_TOSS_DOUBLE_EXIT,
        staying: [],
        leaving: null,
        needsToss: true,
        explanation:
          `Empate no primeiro jogo com PRO (${pro.label}) e RE (${re.label}) completos: ${both} saem e ${pro.label} e ${re.label} entram. ` +
          'O par ou ímpar decide só a ordem na fila: o vencedor volta à fila na frente do perdedor.',
      };
    }
    return {
      ...base,
      scenario: SCENARIOS.DRAW_TOSS,
      staying: null,
      leaving: null,
      needsToss: true,
      explanation: 'Empate no primeiro jogo: decidir no par ou ímpar. O vencedor permanece com vantagem de permanência; o perdedor sai.',
    };
  }

  // Do 2º jogo em diante não há par ou ímpar (RN-138).
  if (doubleExit) {
    // RN-55: desafiante sem permanência volta à fila antes do defensor; times que entraram juntos
    // voltam na ordem em que entraram (slot A entrou primeiro).
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
        `${s.teams[leaving[0]].label} e ${s.teams[leaving[1]].label} vão para o fim da fila nessa ordem` +
        (noAdvantage ? ' (ordem em que entraram).' : ' (preferência do desafiante).'),
    };
  }
  if (noAdvantage) {
    // RN-138 (decisão do dono): sem permanência e sem saída dupla, fica quem entrou primeiro (slot A).
    return {
      ...base,
      scenario: SCENARIOS.DRAW_ENTRY_ORDER,
      staying: [A.id],
      leaving: [B.id],
      needsToss: false,
      explanation:
        `Empate sem nenhum time com permanência e sem PRO e RE completos: não há par ou ímpar depois do 1º jogo. ` +
        `${A.label} entrou primeiro, permanece e passa a defender a permanência; ${B.label} sai para o fim da fila.`,
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
    const L = (id) => s.teams[id].label;
    if (an.scenario === SCENARIOS.DRAW_TOSS_DOUBLE_EXIT) return 'Se empatar: 1º jogo → par ou ímpar; PRO e RE completos → saem os dois e o vencedor volta antes à fila.';
    if (an.scenario === SCENARIOS.DRAW_TOSS) return 'Se empatar: 1º jogo → par ou ímpar; o vencedor fica.';
    if (an.scenario === SCENARIOS.DRAW_DOUBLE_EXIT) return `Se empatar: PRO e RE estão completos → saem os dois times (${L(an.leaving[0])} volta antes à fila).`;
    if (an.scenario === SCENARIOS.DRAW_ENTRY_ORDER) return `Se empatar: ${L(an.staying[0])} entrou primeiro e fica.`;
    return `Se empatar: ${L(an.staying[0])} (desafiante*) joga pelo empate e fica.`;
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
