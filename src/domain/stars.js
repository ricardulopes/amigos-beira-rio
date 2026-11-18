// Cálculo e formatação de estrelas (nível técnico). Funções puras, sem dependências.
import { STAR_VALUES } from './constants.js';

/** RN-02: só 1, 1,5, 2, 2,5 ou 3. */
export function isValidStars(value) {
  return STAR_VALUES.includes(Number(value));
}

export function sumStars(players) {
  return players.reduce((acc, p) => acc + p.stars, 0);
}

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Amplitude (maior − menor). 0 para menos de dois valores. */
export function range(values) {
  return values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
}

/** Número no formato pt-BR (vírgula decimal, até 2 casas). */
export function formatStars(n) {
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** Texto com emojis para compartilhamento: 2,5 → "⭐⭐½". */
export function starsText(stars) {
  return '⭐'.repeat(Math.floor(stars)) + (stars % 1 ? '½' : '');
}
