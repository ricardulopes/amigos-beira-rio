// Sincronização com a nuvem — parte pura (sem rede, sem navegador), testada em tests/cloud.test.js.
// - diffDb: o que mudou entre duas versões do banco local (jogadores, peladas, configurações);
// - addToOutbox: acumula mudanças pendentes de envio (fila offline, RN-115);
// - mergeRemote: aplica dados vindos da nuvem sem apagar o que ainda está pendente neste aparelho;
// - conversões entre as linhas do Supabase e os objetos do app.

const json = (x) => JSON.stringify(x ?? null);

export function emptyOutbox() {
  return { players: [], playersDeleted: [], peladas: {}, peladasDeleted: [], appState: false };
}

export function outboxSize(ob) {
  return ob.players.length + ob.playersDeleted.length + Object.keys(ob.peladas).length + ob.peladasDeleted.length + (ob.appState ? 1 : 0);
}

/** Configurações sincronizadas (uma linha só no Supabase). */
export function appStateOf(db) {
  return { settings: db.settings ?? {}, setup: db.setup ?? null, activeSessionId: db.activeSessionId ?? null };
}

/**
 * Diferenças entre `prev` e `next`.
 * @returns {{players: string[], playersDeleted: string[], peladas: string[], peladasDeleted: string[], appState: boolean}}
 */
export function diffDb(prev, next) {
  const out = { players: [], playersDeleted: [], peladas: [], peladasDeleted: [], appState: false };
  const prevP = new Map((prev.players || []).map((p) => [p.id, json(p)]));
  const nextP = new Map((next.players || []).map((p) => [p.id, json(p)]));
  for (const [id, j] of nextP) if (prevP.get(id) !== j) out.players.push(id);
  for (const id of prevP.keys()) if (!nextP.has(id)) out.playersDeleted.push(id);
  const prevS = new Map((prev.sessions || []).map((s) => [s.id, json(s)]));
  const nextS = new Map((next.sessions || []).map((s) => [s.id, json(s)]));
  for (const [id, j] of nextS) if (prevS.get(id) !== j) out.peladas.push(id);
  for (const id of prevS.keys()) if (!nextS.has(id)) out.peladasDeleted.push(id);
  out.appState = json(appStateOf(prev)) !== json(appStateOf(next));
  return out;
}

export function isEmptyDiff(d) {
  return !d.players.length && !d.playersDeleted.length && !d.peladas.length && !d.peladasDeleted.length && !d.appState;
}

/**
 * Acrescenta um diff à fila de envio (não muta). Para cada pelada guarda a versão da nuvem em que a
 * mudança se baseou (a PRIMEIRA, para detectar conflito com outro admin). O conteúdo enviado é sempre
 * o estado atual do aparelho no momento do envio.
 */
export function addToOutbox(ob, d, versions = {}) {
  const o = JSON.parse(JSON.stringify(ob));
  for (const id of d.players) {
    if (!o.players.includes(id)) o.players.push(id);
    o.playersDeleted = o.playersDeleted.filter((x) => x !== id);
  }
  for (const id of d.playersDeleted) {
    o.players = o.players.filter((x) => x !== id);
    if (!o.playersDeleted.includes(id)) o.playersDeleted.push(id);
  }
  for (const id of d.peladas) {
    if (!(id in o.peladas)) o.peladas[id] = versions[id] ?? 0;
    o.peladasDeleted = o.peladasDeleted.filter((x) => x !== id);
  }
  for (const id of d.peladasDeleted) {
    delete o.peladas[id];
    if (!o.peladasDeleted.includes(id)) o.peladasDeleted.push(id);
  }
  if (d.appState) o.appState = true;
  return o;
}

// ------------------------------------------------------------------ linhas do Supabase ↔ app

export function rowToPlayer(r) {
  return {
    id: r.id,
    name: r.name,
    stars: Number(r.stars),
    type: r.type,
    positions: Array.isArray(r.positions) ? [...r.positions] : [],
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null,
  };
}

export function playerToRow(p) {
  return { id: p.id, name: p.name, stars: p.stars, type: p.type, positions: p.type === 'gk' ? [] : p.positions, createdAt: p.createdAt || null };
}

/**
 * Junta o que veio da nuvem com o banco local, respeitando o que está pendente na fila (`ob`):
 * item pendente fica com a versão local; o resto passa a ser igual à nuvem (inclusive exclusões).
 * @param {object} local banco local
 * @param {{players?: object[], peladas?: {id, version, state}[], appState?: object|null}} remote só as partes recebidas
 * @returns {{db: object, versions: object}}
 */
export function mergeRemote(local, remote, ob, versions = {}) {
  const db = { ...local };
  const v = { ...versions };
  if (remote.players) {
    const up = new Set(ob.players);
    const del = new Set(ob.playersDeleted);
    db.players = dedupeById([
      ...remote.players.filter((r) => !up.has(r.id) && !del.has(r.id)),
      ...(local.players || []).filter((p) => up.has(p.id)),
    ]);
  }
  if (remote.peladas) {
    const up = new Set(Object.keys(ob.peladas));
    const del = new Set(ob.peladasDeleted);
    db.sessions = dedupeById([
      ...remote.peladas.filter((r) => !up.has(r.id) && !del.has(r.id)).map((r) => r.state),
      ...(local.sessions || []).filter((s) => up.has(s.id)),
    ]);
    // Versão conhecida da nuvem: só a das peladas que existem lá (a base dos pendentes não muda aqui).
    for (const id of Object.keys(v)) if (!remote.peladas.some((r) => r.id === id)) delete v[id];
    for (const r of remote.peladas) v[r.id] = r.version;
  }
  if (remote.appState && !ob.appState) {
    db.settings = { ...(local.settings || {}), ...(remote.appState.settings || {}) };
    db.setup = remote.appState.setup ?? null;
    db.activeSessionId = remote.appState.activeSessionId ?? null;
  }
  return { db, versions: v };
}

function dedupeById(list) {
  const seen = new Set();
  return list.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
}
