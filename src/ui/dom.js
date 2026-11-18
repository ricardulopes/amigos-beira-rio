// Utilitários de interface (escape, componentes pequenos).
import { ROLE_SHORT, ROLE_NAMES, STAR_VALUES, formatStars, VESTS, vestName } from '../domain/index.js';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const fmt = formatStars;

export function stars(n, cls = '') {
  const full = Math.floor(n);
  const half = n % 1 !== 0;
  let s = '';
  for (let i = 0; i < full; i++) s += '<i class="st"></i>';
  if (half) s += '<i class="st half"></i>';
  return `<span class="stars ${cls}" aria-label="${fmt(n)} estrelas" title="${fmt(n)} estrelas">${s}</span>`;
}

/**
 * Número da posição do jogador (de baixo para cima: 1 = base, sai primeiro).
 * As posições 1 a 3 (próximas a sair) ficam destacadas.
 */
export function posBadge(position, highlight = true) {
  const cls = highlight && position <= 3 ? ` pos e${position}` : '';
  const title = position === 1 ? 'Posição 1 — sai primeiro' : `Posição ${position}`;
  return `<span class="ord${cls}" title="${title}">${position}</span>`;
}

export function roleBadge(role) {
  if (!role) return '';
  return `<span class="role role-${role}" title="${ROLE_NAMES[role] || 'Goleiro'}">${ROLE_SHORT[role]}</span>`;
}

export function positionsBadges(p) {
  if (p.type === 'gk') return '<span class="role role-G">GOL</span>';
  return p.positions.map((r) => `<span class="role role-${r} soft">${ROLE_SHORT[r]}</span>`).join('');
}

export function starPicker(name, value) {
  return `<div class="seg star-seg" role="radiogroup" aria-label="Classificação">${STAR_VALUES.map(
    (v) => `<button type="button" class="${v === Number(value) ? 'on' : ''}" data-act="pick" data-name="${name}" data-value="${v}" role="radio" aria-checked="${v === Number(value)}">${fmt(v)}<small>★</small></button>`,
  ).join('')}</div>`;
}

// Colete esportivo (regata). vest: 'yellow' | 'blue' | null (null = dupla-face, cor ainda indefinida).
const VEST_PATH = 'M7 2h3.2c.5 1.9 1.4 2.9 1.8 2.9s1.3-1 1.8-2.9H17c.3 3.2 1.3 5 3 6v12.2c0 .5-.4.8-.8.8H4.8c-.4 0-.8-.3-.8-.8V8c1.7-1 2.7-2.8 3-6z';

export function vestIcon(vest, size = '') {
  const known = vest === 'yellow' || vest === 'blue';
  const title = known ? `Colete ${vestName(vest)}` : 'Colete: cor definida pelo resultado';
  const split = known
    ? ''
    : `<clipPath id="vh"><rect x="0" y="0" width="12" height="24"/></clipPath>
       <path class="half-y" d="${VEST_PATH}" fill="${VESTS.yellow.color}" stroke="none" clip-path="url(#vh)"/>`;
  return `<svg class="vest ${known ? `vest-${vest}` : 'vest-dual'} ${size}" viewBox="0 0 24 24" role="img" aria-label="${title}"><title>${title}</title>
    ${known ? `<path class="body" d="${VEST_PATH}"/>` : `<path d="${VEST_PATH}" fill="${VESTS.blue.color}"/>${split}<path d="${VEST_PATH}" fill="none"/>`}
  </svg>`;
}

/** Etiqueta "colete + nome da cor" para cabeçalhos de equipe. */
export function vestTag(vest, text = '') {
  if (vest === 'yellow' || vest === 'blue') return `<span class="vest-tag vest-${vest}">${vestIcon(vest, 'sm')}${esc(text || vestName(vest))}</span>`;
  return `<span class="vest-tag vest-next">${vestIcon(null, 'sm')}${esc(text)}</span>`;
}

export function icon(name) {
  const paths = {
    home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    users: 'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM8 12a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm8 2c-3 0-7 1.5-7 4v2h14v-2c0-2.5-4-4-7-4zM8 14c-.6 0-1.3 0-2 .2C3.6 14.7 1 15.8 1 18v2h6v-2c0-1.5.6-2.8 1.8-3.8z',
    ball: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 3.3 2.9 2.1-1.1 3.4h-3.6L9.1 7.4zM5 9.6l2.2-.7 1.1 3.4-2.9 2.1L4 13.2a8 8 0 0 1 1-3.6zm2.4 8.1.5-2.6h3.6l1.1 3.4-1.6 1.4a8 8 0 0 1-3.6-2.2zm9.2 0a8 8 0 0 1-3.6 2.2l-1.6-1.4 1.1-3.4h3.6zm1-4.4-2.9-2.1 1.1-3.4 2.2.7a8 8 0 0 1 1 3.6z',
    clock: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.4 3.3 3.3-1.4 1.4L11 13.2V6h2z',
    gear: 'M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4L10.7 6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}

export function initialsColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 42%)`;
}
