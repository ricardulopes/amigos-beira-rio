// Coletes dupla-face (Amarelo / Azul) das equipes em campo — RN-108 a RN-111.
//
// A cor é guardada em `session.vests` ({ idDaEquipe: 'yellow' | 'blue' }) somente para as equipes em campo.
// A regra é uma só, aplicada sempre que o campo muda (sorteio, resultado, retiradas, transferências):
// - quem continua em campo mantém o colete que já vestia;
// - quem entra assume a cor que ficou livre (a do time que saiu);
// - se as duas entram juntas (início ou saída dupla), a 1ª em campo veste Amarelo e a 2ª veste Azul.

export const VEST_ORDER = ['yellow', 'blue'];

export const VESTS = {
  yellow: { key: 'yellow', name: 'Amarelo', color: '#FFD100', emoji: '🟡' },
  blue: { key: 'blue', name: 'Azul', color: '#002B7F', emoji: '🔵' },
};

const otherVest = (v) => (v === 'yellow' ? 'blue' : 'yellow');

/**
 * Recalcula os coletes do campo no próprio estado (uso interno do domínio, dentro de transações).
 * Mantém a cor de quem já estava em campo e dá a cor livre a quem entrou.
 */
export function syncVests(s) {
  const prev = s.vests || {};
  const next = {};
  for (const id of s.field) if (VESTS[prev[id]]) next[id] = prev[id];
  // Duas equipes com a mesma cor (dado inconsistente): a segunda perde a cor e recebe a livre.
  const kept = s.field.filter((id) => next[id]);
  if (kept.length === 2 && next[kept[0]] === next[kept[1]]) delete next[kept[1]];
  for (const id of s.field) {
    if (next[id]) continue;
    const used = new Set(Object.values(next));
    next[id] = VEST_ORDER.find((v) => !used.has(v));
  }
  s.vests = next;
  return s;
}

/** Cópia da pelada com os coletes registrados (migração de peladas salvas antes desta regra). */
export function ensureVests(session) {
  const v = session.vests;
  const ok = v && session.field.every((id) => VESTS[v[id]]) && Object.keys(v).every((id) => session.field.includes(id));
  if (ok) return session;
  return syncVests(JSON.parse(JSON.stringify(session)));
}

/** Cor do colete de uma equipe em campo ('yellow' | 'blue'), ou null se ela não estiver jogando. */
export function vestOf(s, tid) {
  const i = s.field.indexOf(tid);
  if (i < 0) return null;
  if (s.vests && VESTS[s.vests[tid]]) return s.vests[tid];
  // Pelada antiga, sem cores registradas: mesma regra de abertura (1ª Amarelo, 2ª Azul).
  return syncVests({ field: [...s.field], vests: s.vests ? { ...s.vests } : {} }).vests[tid];
}

/** Nome da cor ('Amarelo' / 'Azul'). */
export function vestName(v) {
  return VESTS[v]?.name ?? '';
}

/**
 * Indicação para a equipe PRO (próxima a entrar), antes do resultado.
 * Com duas equipes em campo a cor depende de quem sair; com uma só, a cor livre já está definida.
 * @returns {{vest: 'yellow'|'blue'|null, text: string}|null}
 */
export function incomingVest(s, tid) {
  if (s.queue[0] !== tid) return null;
  if (s.field.length === 2) return { vest: null, text: 'Entra com o colete de quem sair' };
  if (s.field.length === 1) {
    const v = otherVest(vestOf(s, s.field[0]));
    return { vest: v, text: `Entra de ${vestName(v)}` };
  }
  return { vest: 'yellow', text: `Entra de ${vestName('yellow')}` };
}

/** Frase com os coletes do campo, ex.: "Coletes: Time 1 de Amarelo, Time 3 de Azul." */
export function vestsText(s) {
  if (!s.field.length) return '';
  const parts = s.field.map((id) => `${s.teams[id]?.label ?? '?'} de ${vestName(vestOf(s, id))}`);
  return `Coletes: ${parts.join(', ')}.`;
}
