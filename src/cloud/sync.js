// Sincronização com o banco unificado (Supabase) — RN-113 a RN-117.
// O aparelho guarda uma cópia local (cache) para funcionar sem sinal. Toda gravação de administrador
// vai para uma fila (outbox) e é enviada assim que houver internet; mudanças de outros aparelhos chegam
// em tempo real (Realtime). Regras de jogo continuam no domínio; aqui só se move dados.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { emptyOutbox, outboxSize, diffDb, isEmptyDiff, addToOutbox, mergeRemote, rowToPlayer, playerToRow, appStateOf } from './diff.js';

const K = { outbox: 'pelada.outbox', versions: 'pelada.versions', token: 'pelada.admin.token', codes: 'pelada.codigos' };
const RETRY_MS = 20000;

const read = (k, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k, v) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* armazenamento indisponível */
  }
};
const clone = (x) => JSON.parse(JSON.stringify(x));

let client = null;
let hooks = null; // { getDb, setDb, cache, onStatus }
let baseline = null;
let ob = emptyOutbox();
let versions = {};
let flushing = false;
let retryTimer = null;

export const cloud = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  connected: false, // dados da nuvem já recebidos nesta abertura
  realtime: false,
  pending: 0,
  lastSync: null,
  error: '',
  needLogin: false,
};

function status(patch = {}) {
  Object.assign(cloud, patch, { pending: outboxSize(ob) });
  hooks?.onStatus?.();
}

function persistQueue() {
  write(K.outbox, ob);
  write(K.versions, versions);
  status();
}

// ------------------------------------------------------------------ acesso de administrador (token)

/** Token de administrador deste aparelho: { token, expiresAt } ou null. */
export function adminSession() {
  const t = read(K.token, null);
  return t && t.token && Date.parse(t.expiresAt) > Date.now() ? t : null;
}

export function adminUntil() {
  const t = adminSession();
  return t ? Date.parse(t.expiresAt) : 0;
}

function rpcError(error) {
  const msg = error?.message || String(error);
  if (/ADMIN_EXPIRED/.test(msg)) {
    write(K.token, null);
    status({ needLogin: outboxSize(ob) > 0 });
    return new Error('O acesso de administrador expirou. Entre com o PIN de novo.');
  }
  if (/Failed to fetch|NetworkError|network|fetch failed|Load failed/i.test(msg)) return new Error('Sem conexão com a nuvem. Tente de novo com sinal.');
  if (/function .* does not exist|Could not find the function|relation .* does not exist|schema cache/i.test(msg)) {
    return new Error('O banco na nuvem ainda não foi configurado (rode supabase/schema.sql no Supabase).');
  }
  return new Error(msg.replace(/^ADMIN_\w+:\s*/, ''));
}

async function rpc(name, args) {
  if (!client) throw new Error('Sem conexão com a nuvem.');
  const { data, error } = await client.rpc(name, args);
  if (error) throw rpcError(error);
  return data;
}

/** Login com o PIN mestre (precisa de internet). Vale 12 h neste aparelho. */
export async function login(pin) {
  const res = await rpc('admin_login', { p_pin: pin });
  if (!res?.ok) throw new Error(res?.message || 'PIN incorreto.');
  write(K.token, { token: res.token, expiresAt: res.expires_at });
  status({ needLogin: false });
  flush();
  return adminUntil();
}

export async function logout() {
  const t = adminSession();
  write(K.token, null);
  status();
  if (t) rpc('admin_logout', { p_token: t.token }).catch(() => {});
}

export async function changePin(newPin) {
  const t = adminSession();
  if (!t) throw new Error('Entre com o PIN atual primeiro.');
  await rpc('admin_change_pin', { p_token: t.token, p_new_pin: newPin });
}

/** Gera um código novo de 4 números para o jogador (o anterior deixa de valer). */
export async function newPlayerCode(playerId) {
  const t = adminSession();
  if (!t) throw new Error('Entre com o PIN de administrador.');
  if (ob.players.includes(playerId)) await flush();
  return rpc('admin_new_player_code', { p_token: t.token, p_player_id: playerId });
}

// ------------------------------------------------------------------ própria posição (jogador comum)

export function rememberedCode(playerId) {
  return read(K.codes, {})[playerId] || '';
}

/** O jogador altera só as próprias posições, com o código dele (RN-116). Precisa de internet. */
export async function setOwnPositions(playerId, code, positions) {
  const res = await rpc('player_set_positions', { p_player_id: playerId, p_code: code, p_positions: positions });
  if (!res?.ok) throw new Error(res?.message || 'Não foi possível salvar.');
  const codes = read(K.codes, {});
  codes[playerId] = code;
  write(K.codes, codes);
  applyRemote((db) => {
    const p = db.players.find((x) => x.id === playerId);
    if (p) p.positions = res.positions;
  });
  return res.positions;
}

// ------------------------------------------------------------------ gravação local → fila

/**
 * Chamado depois de cada gravação local. Administrador: enfileira e tenta enviar.
 * Não administrador: devolve false (quem chamou desfaz a mudança local).
 */
export function track(db) {
  if (!baseline) {
    baseline = clone(db);
    return true;
  }
  const d = diffDb(baseline, db);
  if (isEmptyDiff(d)) return true;
  if (!adminSession()) return false;
  ob = addToOutbox(ob, d, versions);
  baseline = clone(db);
  persistQueue();
  flush();
  return true;
}

/** Cópia do banco como estava na última gravação aceita (para desfazer uma mudança negada). */
export function baselineCopy() {
  return baseline ? clone(baseline) : null;
}

function applyRemote(fn) {
  const db = clone(hooks.getDb());
  fn(db);
  hooks.setDb(db);
  baseline = clone(db);
  hooks.cache(db);
}

// ------------------------------------------------------------------ envio da fila

export async function flush() {
  if (flushing || !client || !hooks) return;
  if (!outboxSize(ob)) return status();
  const t = adminSession();
  if (!t) return status({ needLogin: true });
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return status({ online: false });
  flushing = true;
  try {
    const db = hooks.getDb();
    if (ob.playersDeleted.length) {
      const ids = [...ob.playersDeleted];
      await rpc('admin_delete_players', { p_token: t.token, p_ids: ids });
      ob.playersDeleted = ob.playersDeleted.filter((id) => !ids.includes(id));
      persistQueue();
    }
    if (ob.players.length) {
      const sent = db.players.filter((p) => ob.players.includes(p.id));
      const sentJson = new Map(sent.map((p) => [p.id, JSON.stringify(p)]));
      await rpc('admin_upsert_players', { p_token: t.token, p_players: sent.map(playerToRow) });
      const now = hooks.getDb();
      ob.players = ob.players.filter((id) => {
        const cur = now.players.find((p) => p.id === id);
        return cur && sentJson.has(id) && sentJson.get(id) !== JSON.stringify(cur);
      });
      persistQueue();
    }
    for (const id of [...ob.peladasDeleted]) {
      await rpc('admin_delete_pelada', { p_token: t.token, p_id: id });
      ob.peladasDeleted = ob.peladasDeleted.filter((x) => x !== id);
      delete versions[id];
      persistQueue();
    }
    for (const id of Object.keys(ob.peladas)) {
      const s = hooks.getDb().sessions.find((x) => x.id === id);
      if (!s) {
        delete ob.peladas[id];
        continue;
      }
      const sentJson = JSON.stringify(s);
      const res = await rpc('admin_save_pelada', { p_token: t.token, p_pelada: s, p_base_version: ob.peladas[id] });
      if (res?.ok) {
        versions[id] = res.version;
        const cur = hooks.getDb().sessions.find((x) => x.id === id);
        if (cur && JSON.stringify(cur) !== sentJson) ob.peladas[id] = res.version; // mudou durante o envio
        else delete ob.peladas[id];
      } else if (res?.conflict) {
        await resolveConflict(id, s, res.message);
      }
      persistQueue();
    }
    if (ob.appState) {
      ob.appState = false;
      const st = appStateOf(hooks.getDb());
      try {
        await rpc('admin_save_app_state', { p_token: t.token, p_settings: st.settings, p_setup: st.setup, p_active_id: st.activeSessionId });
      } catch (e) {
        ob.appState = true;
        throw e;
      }
      persistQueue();
    }
    status({ lastSync: new Date().toISOString(), error: '', online: true, needLogin: false });
  } catch (e) {
    status({ error: e.message });
  } finally {
    flushing = false;
    scheduleRetry();
  }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (outboxSize(ob)) retryTimer = setTimeout(() => flush(), RETRY_MS);
}

/**
 * Outro admin gravou a pelada antes (RN-115): vale a versão da nuvem. A versão deste aparelho é
 * guardada em `pelada.conflito.<id>` (dá para exportar no backup) e o usuário é avisado.
 */
async function resolveConflict(id, localState, message) {
  write(`pelada.conflito.${id}`, { at: new Date().toISOString(), state: localState });
  delete ob.peladas[id];
  const { data } = await client.from('peladas').select('id,version,state').eq('id', id).maybeSingle();
  applyRemote((db) => {
    db.sessions = db.sessions.filter((s) => s.id !== id);
    if (data) {
      db.sessions.push(data.state);
      versions[id] = data.version;
    } else {
      delete versions[id];
      if (db.activeSessionId === id) db.activeSessionId = null;
    }
  });
  hooks.onConflict?.(`${message || 'Conflito na pelada.'} Ficou valendo a versão da nuvem; a deste aparelho foi guardada como cópia.`);
}

// ------------------------------------------------------------------ nuvem → aparelho

export async function pullAll() {
  if (!client) return;
  try {
    const [pl, pe, st] = await Promise.all([
      client.from('players').select('*').order('name'),
      client.from('peladas').select('id,version,state').order('created_at'),
      client.from('app_state').select('*').eq('id', 1).maybeSingle(),
    ]);
    const err = pl.error || pe.error || st.error;
    if (err) throw rpcError(err);
    const remote = {
      players: pl.data.map(rowToPlayer),
      peladas: pe.data,
      appState: st.data ? { settings: st.data.settings, setup: st.data.setup, activeSessionId: st.data.active_pelada_id } : null,
    };
    const { db, versions: v } = mergeRemote(hooks.getDb(), remote, ob, versions);
    versions = v;
    hooks.setDb(db);
    baseline = clone(db);
    hooks.cache(db);
    persistQueue();
    status({ connected: true, online: true, error: '', lastSync: new Date().toISOString() });
    flush();
  } catch (e) {
    status({ error: rpcError(e).message });
  }
}

function onPlayerChange(payload) {
  const id = payload.new?.id || payload.old?.id;
  if (!id || ob.players.includes(id) || ob.playersDeleted.includes(id)) return;
  applyRemote((db) => {
    db.players = db.players.filter((p) => p.id !== id);
    if (payload.eventType !== 'DELETE') db.players.push(rowToPlayer(payload.new));
  });
}

function onPeladaChange(payload) {
  const id = payload.new?.id || payload.old?.id;
  if (!id || id in ob.peladas || ob.peladasDeleted.includes(id)) return;
  if (payload.eventType !== 'DELETE' && versions[id] >= payload.new.version) return; // já temos esta versão
  applyRemote((db) => {
    db.sessions = db.sessions.filter((s) => s.id !== id);
    if (payload.eventType === 'DELETE') delete versions[id];
    else {
      db.sessions.push(payload.new.state);
      versions[id] = payload.new.version;
    }
  });
  write(K.versions, versions);
}

function onAppStateChange(payload) {
  if (ob.appState || payload.eventType === 'DELETE') return;
  const r = payload.new;
  applyRemote((db) => {
    db.settings = { ...(db.settings || {}), ...(r.settings || {}) };
    db.setup = r.setup ?? null;
    db.activeSessionId = r.active_pelada_id ?? null;
  });
}

/**
 * Liga a sincronização. `h`: { getDb, setDb(db), cache(db), onStatus(), onConflict(msg) }.
 * Sem a biblioteca do Supabase (ou sem rede), o app segue com a cópia local.
 */
export function initCloud(h) {
  hooks = h;
  ob = { ...emptyOutbox(), ...read(K.outbox, {}) };
  versions = read(K.versions, {});
  baseline = clone(h.getDb());
  status({ needLogin: outboxSize(ob) > 0 && !adminSession() });
  const lib = typeof window !== 'undefined' ? window.supabase : null;
  if (!lib?.createClient) {
    status({ error: 'Biblioteca do Supabase não carregou; usando só os dados deste aparelho.' });
    return;
  }
  client = lib.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  client
    .channel('abr-banco')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, onPlayerChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'peladas' }, onPeladaChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, onAppStateChange)
    .subscribe((s) => {
      status({ realtime: s === 'SUBSCRIBED' });
      if (s === 'SUBSCRIBED' && cloud.connected) pullAll(); // reconectou: pega o que perdeu
    });
  window.addEventListener('online', () => {
    status({ online: true });
    pullAll();
  });
  window.addEventListener('offline', () => status({ online: false }));
  pullAll();
}
