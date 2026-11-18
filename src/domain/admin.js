// Modo administrador por PIN (RN-98 a RN-102). Regras puras: formato do PIN, hash, bloqueio por
// tentativas, validade da liberação e quais operações exigem PIN. Nada aqui grava ou lê do navegador:
// a persistência do registro do PIN fica em src/storage e a UI só chama estas funções.

export const PIN_RULES = { minLength: 4, maxLength: 8, maxFreeAttempts: 5, lockBaseSeconds: 30, lockMaxSeconds: 300, sessionMinutes: 15 };

/** Operações protegidas (RN-99). Rotina da pelada (sorteio, presença, atrasados já cadastrados,
 * resultados, ajustes de equipes, visualização) fica livre. */
export const ADMIN_ACTIONS = {
  'player-create': 'cadastrar jogador',
  'player-edit': 'editar nome, estrelas, tipo ou posições',
  'player-delete': 'excluir jogador do cadastro',
  'roster-import': 'importar lista de atletas em lote',
  'backup-import': 'importar backup (substitui os dados)',
  'data-wipe': 'apagar todos os dados',
  'history-delete': 'excluir pelada do histórico',
  'pin-change': 'alterar o PIN',
};

export function requiresAdmin(action) {
  return Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS, action);
}

/** Valida o formato do PIN: só dígitos, de 4 a 8. Lança Error com mensagem amigável. */
export function validatePinFormat(pin) {
  const p = String(pin ?? '');
  if (!/^\d+$/.test(p)) throw new Error('O PIN deve conter só números.');
  if (p.length < PIN_RULES.minLength || p.length > PIN_RULES.maxLength) {
    throw new Error(`O PIN deve ter de ${PIN_RULES.minLength} a ${PIN_RULES.maxLength} dígitos.`);
  }
  return p;
}

/** Cria o registro guardado no aparelho. O PIN nunca é salvo em texto: só sal + hash SHA-256. */
export function createPinRecord(pin, salt) {
  const p = validatePinFormat(pin);
  if (!salt || String(salt).length < 8) throw new Error('Sal inválido para o PIN.');
  return { salt: String(salt), hash: sha256(`${salt}:${p}`), failures: 0, lockedUntil: 0 };
}

/** Define um PIN novo a partir de digitação + confirmação. */
export function definePin(pin, confirmation, salt) {
  if (String(pin ?? '') !== String(confirmation ?? '')) throw new Error('A confirmação não confere com o PIN digitado.');
  return createPinRecord(pin, salt);
}

/** Segundos de espera exigidos depois de `failures` erros seguidos (RN-101). */
export function pinLockSeconds(failures) {
  const extra = failures - PIN_RULES.maxFreeAttempts;
  if (extra < 0) return 0;
  return Math.min(PIN_RULES.lockMaxSeconds, PIN_RULES.lockBaseSeconds * 2 ** extra);
}

/**
 * Confere uma tentativa. Retorna { ok, record (atualizado), waitSeconds, message }.
 * Não muta o registro recebido.
 */
export function checkPin(record, pin, now = Date.now()) {
  if (!record) return { ok: false, record, waitSeconds: 0, message: 'Nenhum PIN definido.' };
  const rec = { ...record };
  if (rec.lockedUntil && now < rec.lockedUntil) {
    const waitSeconds = Math.ceil((rec.lockedUntil - now) / 1000);
    return { ok: false, record: rec, waitSeconds, message: `Muitas tentativas erradas. Aguarde ${waitSeconds} s.` };
  }
  if (sha256(`${rec.salt}:${String(pin ?? '')}`) === rec.hash) {
    return { ok: true, record: { ...rec, failures: 0, lockedUntil: 0 }, waitSeconds: 0, message: 'Modo administrador liberado.' };
  }
  rec.failures = (rec.failures || 0) + 1;
  const lock = pinLockSeconds(rec.failures);
  rec.lockedUntil = lock ? now + lock * 1000 : 0;
  const left = PIN_RULES.maxFreeAttempts - rec.failures;
  const message = lock ? `PIN incorreto. Aguarde ${lock} s para tentar de novo.` : `PIN incorreto. ${left} tentativa(s) antes de um bloqueio temporário.`;
  return { ok: false, record: rec, waitSeconds: lock, message };
}

/** Liberação vale por PIN_RULES.sessionMinutes desde a última ação de administrador (RN-100). */
export function adminExpiry(now = Date.now()) {
  return now + PIN_RULES.sessionMinutes * 60 * 1000;
}

export function isAdminActive(until, now = Date.now()) {
  return Number(until) > now;
}

// ---------------------------------------------------------------- SHA-256 (puro, sem crypto.subtle)
// Implementação própria para funcionar também fora de HTTPS (ex.: celular acessando o PC pela rede).

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8(text) {
  const out = [];
  for (const ch of String(text)) {
    let c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function sha256(text) {
  const bytes = utf8(text);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  for (const v of [hi, bitLen >>> 0]) bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      const j = i + t * 4;
      w[t] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}
