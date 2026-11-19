// Permissões no banco unificado (RN-98 a RN-102, revisadas na migração para a nuvem — RN-113 a RN-117).
// Regras puras: quem pode fazer o quê, formato do PIN mestre e do código do jogador, validade do acesso
// e validação da troca de posição feita pelo próprio jogador. A conferência do PIN e do código acontece
// no servidor (Supabase); aqui não há hash nem segredo.

import { ROLES } from './constants.js';

export const PIN_RULES = { minLength: 4, maxLength: 8, sessionHours: 12, codeLength: 4 };

/**
 * Únicas operações livres para quem não é administrador (RN-114): ver tudo, compartilhar, exportar
 * backup e alterar a PRÓPRIA posição (com o código do jogador). Todo o resto exige o PIN mestre.
 */
export const PUBLIC_ACTIONS = {
  view: 'ver todas as abas',
  share: 'compartilhar no WhatsApp',
  export: 'exportar backup',
  'own-positions': 'alterar a própria posição (com o código do jogador)',
};

/** O que o PIN mestre libera (texto da tela de Ajustes). */
export const ADMIN_ACTIONS = {
  draw: 'selecionar presentes e sortear',
  pelada: 'iniciar, registrar resultados, atrasados, retiradas, ajustes, desfazer e encerrar',
  'player-create': 'cadastrar jogador',
  'player-edit': 'editar nome, estrelas, tipo ou posições de qualquer jogador',
  'player-delete': 'excluir jogador',
  'player-code': 'gerar o código de um jogador',
  'roster-import': 'importar lista de atletas',
  'backup-import': 'importar backup',
  settings: 'alterar os ajustes do grupo',
  'history-delete': 'excluir pelada do histórico',
  'pin-change': 'alterar o PIN mestre',
};

export function requiresAdmin(action) {
  return !Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS, action);
}

/** Valida o formato do PIN: só dígitos, de 4 a 8. Lança Error com mensagem amigável. */
export function validatePinFormat(pin) {
  const p = String(pin ?? '').trim();
  if (!/^\d+$/.test(p)) throw new Error('O PIN deve conter só números.');
  if (p.length < PIN_RULES.minLength || p.length > PIN_RULES.maxLength) {
    throw new Error(`O PIN deve ter de ${PIN_RULES.minLength} a ${PIN_RULES.maxLength} dígitos.`);
  }
  return p;
}

/** Código do jogador: exatamente 4 dígitos (RN-116). */
export function validatePlayerCode(code) {
  const c = String(code ?? '').trim();
  if (!new RegExp(`^\\d{${PIN_RULES.codeLength}}$`).test(c)) throw new Error(`O código do jogador tem ${PIN_RULES.codeLength} números.`);
  return c;
}

/** Acesso de administrador vale 12 h a partir do login (o servidor também confere). */
export function adminExpiry(now = Date.now()) {
  return now + PIN_RULES.sessionHours * 60 * 60 * 1000;
}

export function isAdminActive(until, now = Date.now()) {
  return Number(until) > now;
}

/**
 * Troca de posição feita pelo próprio jogador (RN-116): só jogador de linha, ao menos uma posição,
 * apenas D/M/A. Retorna as posições na ordem D, M, A. Lança Error com mensagem amigável.
 */
export function validateOwnPositions(player, positions) {
  if (!player) throw new Error('Jogador não encontrado.');
  if (player.type !== 'line') throw new Error('Goleiro não tem posição de linha para alterar.');
  const set = new Set(positions || []);
  for (const p of set) if (!ROLES.includes(p)) throw new Error(`Posição inválida: ${p}.`);
  const out = ROLES.filter((p) => set.has(p));
  if (!out.length) throw new Error('Escolha ao menos uma posição.');
  return out;
}
