// Persistência local (localStorage) com esquema versionado, desfazer, backup e restauração.
import { DEFAULT_CONFIG, validate, validatePlayer, ensureVests, seedPlayers } from '../domain/index.js';
import { OFFICIAL_ROSTER } from '../data/lista-oficial.js';

export const SCHEMA = 2;
const KEY = 'pelada.db';
const UNDO_PREFIX = 'pelada.undo.';
const PREV_BACKUP = 'pelada.backup.anterior';
const UNDO_LIMIT = 40;
const ADMIN_KEY = 'pelada.admin';

export const DEFAULT_SETTINGS = {
  ...DEFAULT_CONFIG,
  groupName: 'Pelada',
};

export function emptyDB() {
  return { schema: SCHEMA, players: [], sessions: [], settings: { ...DEFAULT_SETTINGS }, activeSessionId: null };
}

export function createStore(backend = globalThis.localStorage) {
  const mem = new Map();
  const ls = backend || { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };

  function migrate(db) {
    const out = { ...emptyDB(), ...db };
    out.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
    out.players = Array.isArray(db.players) ? db.players : [];
    // Esquema 2: peladas ganham o registro dos coletes (Amarelo/Azul) das equipes em campo.
    out.sessions = (Array.isArray(db.sessions) ? db.sessions : []).map((s) => (s && Array.isArray(s.field) ? ensureVests(s) : s));
    out.schema = SCHEMA;
    return out;
  }

  /**
   * Primeira abertura neste aparelho (nada salvo ainda): o cadastro já começa com a lista oficial (RN-112).
   * Salva na hora para os ids dos jogadores ficarem fixos. "Apagar todos os dados" grava um banco vazio,
   * então a lista não volta sozinha depois disso.
   */
  function firstRunDB() {
    const db = emptyDB();
    try {
      db.players = seedPlayers(OFFICIAL_ROSTER);
    } catch (e) {
      console.error('Falha ao montar a lista oficial', e);
    }
    try {
      save(db);
    } catch {
      // sem armazenamento disponível: segue só em memória
    }
    return db;
  }

  function load() {
    try {
      const raw = ls.getItem(KEY);
      if (!raw) return firstRunDB();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.error('Falha ao ler dados', e);
      return emptyDB();
    }
  }

  function save(db) {
    ls.setItem(KEY, JSON.stringify(db));
  }

  function undoKey(sid) {
    return UNDO_PREFIX + sid;
  }
  function readUndo(sid) {
    try {
      return JSON.parse(ls.getItem(undoKey(sid)) || '[]');
    } catch {
      return [];
    }
  }
  function pushUndo(sid, labelText, prevState) {
    const stack = readUndo(sid);
    stack.push({ label: labelText, at: new Date().toISOString(), state: prevState });
    while (stack.length > UNDO_LIMIT) stack.shift();
    try {
      ls.setItem(undoKey(sid), JSON.stringify(stack));
    } catch {
      // armazenamento cheio: mantém só as últimas 5 operações
      ls.setItem(undoKey(sid), JSON.stringify(stack.slice(-5)));
    }
  }
  function popUndo(sid) {
    const stack = readUndo(sid);
    const item = stack.pop();
    ls.setItem(undoKey(sid), JSON.stringify(stack));
    return item || null;
  }
  function clearUndo(sid) {
    ls.removeItem(undoKey(sid));
  }

  function exportData(db) {
    return JSON.stringify({ app: 'pelada-organizada', schema: SCHEMA, exportedAt: new Date().toISOString(), data: db }, null, 2);
  }

  /** Valida um backup e retorna o banco pronto para uso (lança erro se inválido). */
  function parseImport(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new Error('Arquivo não é um JSON válido.');
    }
    const data = obj?.data ?? obj;
    if (!data || !Array.isArray(data.players) || !Array.isArray(data.sessions)) throw new Error('Arquivo não parece ser um backup deste app.');
    const players = [];
    for (const p of data.players) players.push({ ...validatePlayer(p, players), createdAt: p.createdAt || new Date().toISOString() });
    for (const s of data.sessions) {
      if (!s.id || !s.teams || !s.snapshot) throw new Error('Backup com pelada inválida.');
      validate(s);
    }
    return migrate({ ...data, players });
  }

  function importData(text, currentDb) {
    const db = parseImport(text);
    ls.setItem(PREV_BACKUP, exportData(currentDb));
    save(db);
    return db;
  }

  // Registro do PIN de administrador (sal + hash + tentativas). Fica fora do banco principal para não
  // ir no backup nem ser trocado ao importar um (RN-102).
  function loadAdmin() {
    try {
      const rec = JSON.parse(ls.getItem(ADMIN_KEY) || 'null');
      return rec && rec.salt && rec.hash ? rec : null;
    } catch {
      return null;
    }
  }
  function saveAdmin(rec) {
    if (rec) ls.setItem(ADMIN_KEY, JSON.stringify(rec));
    else ls.removeItem(ADMIN_KEY);
  }

  return { load, save, pushUndo, popUndo, readUndo, clearUndo, exportData, parseImport, importData, loadAdmin, saveAdmin };
}
