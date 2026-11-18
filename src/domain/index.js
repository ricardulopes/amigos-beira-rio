// API pública do domínio. A interface (src/ui) e a persistência (src/storage) importam SOMENTE daqui.
// Nada nesta pasta pode depender de DOM, window, localStorage ou da interface (verificado em testes).
//
// Mapa dos módulos:
//   constants   posições, formações, estrelas, limites
//   stars       cálculo e formatação de estrelas (soma, média, mediana, amplitude)
//   players     cadastro: validação, filtros, snapshot
//   tactics     atribuição de função (D/M/A) e desvio tático
//   draw        sorteio otimizado, goleiros, ordem estratégica de saída
//   setup       plano da pelada, tolerância, limites e preparação do sorteio
//   session     estado da pelada, consultas, integridade e transação
//   tieRules    DECISÃO de vitória/empate (saída dupla, par ou ímpar, direito ao empate)
//   rotation    APLICAÇÃO do resultado: permanência, fila, divisão/recomposição
//   vests       coletes dupla-face (Amarelo/Azul) das equipes em campo
//   arrivals    atrasados
//   removals    lesões/saídas e reposição automática em cascata
//   adjustments transferência, ordem, troca, goleiros, correção de permanência
//   balance     avisos de desequilíbrio
//   stats       desempenho e resumos
//   share       texto para WhatsApp
//   admin       modo administrador: PIN (hash), bloqueio por tentativas, operações protegidas
//   roster      importação da base de atletas em lote (lista em texto)

export * from './constants.js';
export { isValidStars, sumStars, mean, median, range, formatStars, starsText } from './stars.js';
export { newId, normalizeName, nameKey, validatePlayer, snapshotPlayer, filterPlayers, playerDraft, togglePosition } from './players.js';
export { assignRoles, tacticalDeviation, formationText } from './tactics.js';
export { createRng } from './rng.js';
export { drawTeams, planTeamSizes, exitGroups, optimizeOrder, orderCost, staggerPattern, incompleteTarget, assignGoalkeepers, WEIGHTS } from './draw.js';
export { LIMITS, clampLinePerTeam, clampTolerance, clampTransferQty, planParticipation, goalkeeperNote, toleranceInfo, defaultTitle, prepareDraw } from './setup.js';
export {
  DEFAULT_CONFIG, RuleError, createSession, redraw, startSession, finishSession,
  teamPids, linePositions, positionOf, label, isComplete, queueLabel, player, teamStats, lineStarsRef, allTeamsInOrder, validate,
} from './session.js';
export { SCENARIOS, fieldSituation, analyzeResult, drawHint, advantageStatus } from './tieRules.js';
export { registerResult, vestPreview } from './rotation.js';
export { VESTS, VEST_ORDER, vestOf, vestName, incomingVest, vestsText, ensureVests } from './vests.js';
export { addLatePlayer } from './arrivals.js';
export { removePlayer } from './removals.js';
export { simulateTransfer, transferPlayers, movePlayerInOrder, swapPlayers, moveGoalkeeper, setPermanence } from './adjustments.js';
export { balanceWarnings, BALANCE_THRESHOLDS } from './balance.js';
export { playerStats, balanceSummary, gamesSummary, teamExitGroups } from './stats.js';
export { shareText } from './share.js';
export {
  PIN_RULES, ADMIN_ACTIONS, requiresAdmin, validatePinFormat, createPinRecord, definePin, pinLockSeconds, checkPin, adminExpiry, isAdminActive, sha256,
} from './admin.js';
export { parseRosterLine, parseRoster, planRosterImport, applyRosterImport, rosterPlanSummary, rosterText } from './roster.js';
