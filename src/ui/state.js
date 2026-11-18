// Estado compartilhado da interface (não contém regras de negócio).
import { createStore } from '../storage/storage.js';
import { isAdminActive } from '../domain/index.js';

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
    adminUntil: 0, // modo administrador: liberado até este instante (só em memória; recarregar bloqueia)
  },
  render: () => {},
};

export function save() {
  try {
    store.save(app.db);
  } catch (e) {
    alert('Não foi possível salvar os dados (armazenamento cheio?). Exporte um backup.\n' + e.message);
  }
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

export function adminActive() {
  return isAdminActive(app.ui.adminUntil);
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
