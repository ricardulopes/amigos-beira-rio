// Permissões no banco unificado (RN-98 a RN-102, revisadas na migração para a nuvem — RN-113 a RN-117).
// Regras puras: quem pode fazer o quê, formato do PIN mestre e validade do acesso. Visitante só lê
// (RN-116); toda alteração exige o PIN mestre, conferido no servidor (Supabase). Aqui não há hash nem segredo.

export const PIN_RULES = { minLength: 4, maxLength: 8, sessionHours: 12 };

/**
 * Únicas operações livres para quem não é administrador (RN-114, RN-116): ver tudo, compartilhar e
 * exportar backup. Nenhuma alteração; todo o resto exige o PIN mestre.
 */
export const PUBLIC_ACTIONS = {
  view: 'ver todas as abas, times, sorteios, resultados e histórico',
  share: 'compartilhar no WhatsApp',
  export: 'exportar backup',
};

/** O que o PIN mestre libera (texto da tela de Ajustes). */
export const ADMIN_ACTIONS = {
  draw: 'selecionar presentes e sortear',
  pelada: 'iniciar, registrar resultados, atrasados, retiradas, coletes, ajustes, desfazer e encerrar',
  'player-create': 'cadastrar jogador',
  'player-edit': 'editar nome, estrelas, tipo ou posições de qualquer jogador',
  'player-delete': 'excluir jogador',
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

/** Acesso de administrador vale 12 h a partir do login (o servidor também confere). */
export function adminExpiry(now = Date.now()) {
  return now + PIN_RULES.sessionHours * 60 * 60 * 1000;
}

export function isAdminActive(until, now = Date.now()) {
  return Number(until) > now;
}
