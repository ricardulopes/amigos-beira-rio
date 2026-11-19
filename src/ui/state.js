// Estado compartilhado da interface (não contém regras de negócio).
import { createStore } from '../storage/storage.js';
import { isAdminActive } from '../domain/index.js';
import { track, baselineCopy, adminUntil } from '../cloud/sync.js';

export const store = createStore();

export const app = {
  db: store.load(),
  ui: {
    route: '/',
    params: [],
    modal: null,
    toast: null,
    playerFilter: { query: '', position: '', stars: '', type: '' },
    setupQuery: '',
    inverted: false,
    showExits: true,
    historyTab: 'games',
    lastExplanation: null,
  },
  render: () => {},
};

/**
 * Grava no aparelho e enfileira o envio para a nuvem (RN-115). Só administrador grava (RN-114):
 * para os demais, a mudança local é desfeita e nada é enviado.
 */
export function save() {
  if (!track(app.db)) {
    const prev = baselineCopy();
    if (prev) app.db = prev;
    toast('Somente administradores podem alterar. Entre com o PIN mestre.', 'error');
    return false;
  }
  try {
    store.save(app.db);
  } catch (e) {
    alert('Não foi possível salvar os dados (armazenamento cheio?). Exporte um backup.\n' + e.message);
  }
  return true;
}

export function activeSession() {
  const id = app.db.activeSessionId;
  return id ? app.db.sessions.find((s) => s.id === id) || null : null;
}

export function replaceSession(s) {
  const i = app.db.sessions.findIndex((x) => x.id === s.id);
  if (i >= 0) app.db.sessions[i] = s;
  else app.db.sessions.push(s);
}

/** Este aparelho entrou com o PIN mestre e o acesso (12 h) ainda vale. */
export function adminActive() {
  return isAdminActive(adminUntil());
}

export function setupState() {
  const st = app.db.settings;
  app.db.setup ||= {
    selected: [],
    title: '',
    scheduled: '',
    config: { linePerTeam: st.linePerTeam, useGoalkeepers: st.useGoalkeepers, requireGkForComplete: st.requireGkForComplete },
  };
  return app.db.setup;
}

export function openModal(type, data = {}) {
  app.ui.modal = { type, ...data };
  app.render();
}

export function closeModal() {
  app.ui.modal = null;
  app.render();
}

let toastTimer = null;
export function toast(text, kind = 'info', ms = 3500) {
  app.ui.toast = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    app.ui.toast = null;
    const el = document.getElementById('toast');
    if (el) el.remove();
  }, ms);
  app.render();
}

export function navigate(path) {
  if (location.hash !== '#' + path) location.hash = path;
  else app.render();
}
