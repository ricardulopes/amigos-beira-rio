// Constantes de domínio compartilhadas por todo o app.

export const ROLES = ['D', 'M', 'A'];
export const ROLE_NAMES = { D: 'Defesa', M: 'Meio-campo', A: 'Ataque' };
export const ROLE_SHORT = { D: 'DEF', M: 'MEI', A: 'ATA', G: 'GOL' };

export const STAR_VALUES = [1, 1.5, 2, 2.5, 3];

export const MIN_LINE_PER_TEAM = 2;
export const MAX_LINE_PER_TEAM = 15;
export const DEFAULT_LINE_PER_TEAM = 5;
export const DEFAULT_TOLERANCE_MIN = 10;

// Composição tática preferencial (Defesa, Meio, Ataque) por nº de jogadores de linha.
export const FORMATIONS = {
  2: [1, 1, 0],
  3: [1, 1, 1],
  4: [2, 1, 1],
  5: [2, 2, 1],
  6: [2, 3, 1],
  7: [3, 3, 1],
  8: [3, 3, 2],
  9: [3, 4, 2],
  10: [4, 4, 2],
  11: [4, 5, 2],
  12: [4, 5, 3],
  13: [5, 5, 3],
  14: [5, 6, 3],
  15: [5, 6, 4],
};

/** Formação-alvo para um time com n jogadores de linha. Retorna null para n<=1 (sem alvo). */
export function formationFor(n) {
  if (n <= 1) return null;
  const f = FORMATIONS[Math.min(n, 15)];
  return { D: f[0], M: f[1], A: f[2] };
}

export const REMOVAL_REASONS = {
  injury: 'Lesão',
  early: 'Saída antecipada',
  quit: 'Desistência',
  other: 'Outro motivo',
};
