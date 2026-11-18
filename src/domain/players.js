// Regras do cadastro permanente de jogadores.
import { ROLES } from './constants.js';
import { isValidStars } from './stars.js';

export function newId(prefix = 'p') {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export function normalizeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/** Chave de comparação de nomes: ignora maiúsculas, acentos e espaços extras (RN-05). */
export function nameKey(name) {
  return normalizeName(name)
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Valida e normaliza os dados de um jogador. Lança Error com mensagem amigável.
 * @param {object} input {id?, name, stars, type:'line'|'gk', positions:[]}
 * @param {object[]} existing cadastro atual (para checar duplicidade)
 */
export function validatePlayer(input, existing = []) {
  const name = normalizeName(input.name);
  if (!name) throw new Error('Informe o nome do jogador.');
  if (name.length > 40) throw new Error('Nome muito longo (máx. 40 caracteres).');
  const stars = Number(input.stars);
  if (!isValidStars(stars)) throw new Error('Classificação deve ser 1, 1,5, 2, 2,5 ou 3 estrelas.');
  const type = input.type === 'gk' ? 'gk' : 'line';
  let positions = [];
  if (type === 'line') {
    positions = ROLES.filter((r) => (input.positions || []).includes(r));
    if (positions.length === 0) throw new Error('Selecione ao menos uma posição (Defesa, Meio-campo ou Ataque).');
  }
  const key = nameKey(name);
  const dup = existing.find((p) => p.id !== input.id && nameKey(p.name) === key);
  if (dup) throw new Error(`Já existe um jogador chamado "${dup.name}".`);
  return {
    id: input.id || newId('p'),
    name,
    stars,
    type,
    positions,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Snapshot imutável dos dados do jogador no momento em que entra numa pelada. */
export function snapshotPlayer(p) {
  return { id: p.id, name: p.name, stars: p.stars, type: p.type, positions: [...(p.positions || [])] };
}

export function filterPlayers(players, { query = '', position = '', stars = '', type = '' } = {}) {
  const q = nameKey(query);
  return players
    .filter((p) => !q || nameKey(p.name).includes(q))
    .filter((p) => !type || p.type === type)
    .filter((p) => !position || (p.type === 'line' && p.positions.includes(position)))
    .filter((p) => !stars || p.stars === Number(stars))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** Rascunho vazio para o formulário de cadastro, ou cópia editável de um jogador existente. */
export function playerDraft(p = null) {
  return p ? { name: p.name, stars: p.stars, type: p.type, positions: [...p.positions] } : { name: '', stars: 2, type: 'line', positions: [] };
}

/** Liga/desliga uma posição num rascunho de cadastro (retorna nova lista). */
export function togglePosition(positions, role) {
  return positions.includes(role) ? positions.filter((r) => r !== role) : [...positions, role];
}
