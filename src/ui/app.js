// Controlador da interface: roteamento, renderização e ações.
// Toda regra de negócio é delegada ao domínio (src/domain, via index.js). Aqui só orquestramos.
import { app, store, save, activeSession, replaceSession, setupState, openModal, closeModal, toast, navigate, adminActive } from './state.js';
import { homeView, playersView, setupView, draftView, liveView, historyView, historyDetailView, settingsView, tabbar, defaultTitle } from './views.js';
import { renderModal } from './modals.js';
import { esc } from './dom.js';
import {
  validatePlayer, snapshotPlayer, playerDraft, togglePosition, prepareDraw, clampLinePerTeam, clampTolerance, clampTransferQty,
  createSession, redraw, startSession, finishSession, analyzeResult, registerResult, addLatePlayer, removePlayer,
  transferPlayers, movePlayerInOrder, swapPlayers, moveGoalkeeper, setPermanence, RuleError,
  shareText, requiresAdmin, adminExpiry, definePin, checkPin, parseRoster, planRosterImport, applyRosterImport, rosterPlanSummary, rosterText,
} from '../domain/index.js';

// ------------------------------------------------------------------ renderização

const root = document.getElementById('app');

function render() {
  const focus = document.activeElement;
  const fid = focus && focus.id;
  const sel = fid && 'selectionStart' in focus ? [focus.selectionStart, focus.selectionEnd] : null;
  const scrollY = window.scrollY;
  const modalBody = document.querySelector('.modal-body');
  const modalScroll = modalBody ? modalBody.scrollTop : 0;
  const prevModalType = app.ui._renderedModal;

  root.innerHTML = view() + tabbar() + renderModal() + (app.ui.toast ? `<div id="toast" class="toast ${app.ui.toast.kind}" role="status">${esc(app.ui.toast.text)}</div>` : '');
  document.body.classList.toggle('modal-open', !!app.ui.modal);

  if (fid) {
    const el = document.getElementById(fid);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* tipos sem seleção */ }
    }
  }
  if (app.ui._keepScroll) window.scrollTo(0, scrollY);
  app.ui._keepScroll = true;
  const mb = document.querySelector('.modal-body');
  if (mb && app.ui.modal && prevModalType === app.ui.modal.type) mb.scrollTop = modalScroll;
  app.ui._renderedModal = app.ui.modal?.type || null;
}
app.render = render;

function view() {
  const r = app.ui.route;
  const s = activeSession();
  if (r === '/jogadores') return playersView();
  if (r === '/nova') return setupView();
  if (r === '/partida') {
    if (!s) return setupView();
    return s.status === 'draft' ? draftView(s) : liveView(s);
  }
  if (r === '/historico') return historyView();
  if (r.startsWith('/historico/')) return historyDetailView(r.split('/')[2]);
  if (r === '/ajustes') return settingsView();
  return homeView();
}

function onRoute() {
  const r = location.hash.replace(/^#/, '') || '/';
  if (r !== app.ui.route) {
    app.ui._keepScroll = false;
    window.scrollTo(0, 0);
  }
  app.ui.route = r;
  app.ui.modal = null;
  render();
}

// ------------------------------------------------------------------ execução transacional de comandos

/** Executa um comando de domínio na pelada ativa com desfazer e persistência. */
function exec(labelText, fn, { silent = false } = {}) {
  const s = activeSession();
  if (!s) return null;
  try {
    const res = fn(s);
    store.pushUndo(s.id, labelText, s);
    replaceSession(res.state);
    save();
    if (res.warnings?.length) {
      app.ui.modal = { type: 'info', title: 'Atenção: possível desequilíbrio', list: res.warnings, text: 'Nada foi reorganizado automaticamente. Use transferência ou troca se quiser ajustar.' };
    }
    if (!silent && res.message) toast(res.message, 'ok');
    else render();
    return res;
  } catch (e) {
    toast(e instanceof RuleError ? e.message : `Operação cancelada: ${e.message}`, 'error', 5000);
    if (!(e instanceof RuleError)) console.error(e);
    return null;
  }
}

// ------------------------------------------------------------------ modo administrador (RN-98 a RN-102)

function newSalt() {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/** Executa `then` só com o modo administrador liberado; pede (ou cria) o PIN quando preciso. */
function withAdmin(action, then) {
  if (!requiresAdmin(action)) return then();
  if (adminActive()) {
    app.ui.adminUntil = adminExpiry();
    return then();
  }
  openModal('pin', { mode: store.loadAdmin() ? 'enter' : 'create', action, pin: '', pin2: '', then });
}

function pinOk() {
  const m = app.ui.modal;
  if (m.mode === 'enter') {
    const res = checkPin(store.loadAdmin(), m.pin);
    store.saveAdmin(res.record);
    if (!res.ok) {
      m.error = res.message;
      m.pin = '';
      return render();
    }
  } else {
    try {
      store.saveAdmin(definePin(m.pin, m.pin2, newSalt()));
    } catch (e) {
      Object.assign(m, { error: e.message, pin: '', pin2: '' });
      return render();
    }
  }
  app.ui.adminUntil = adminExpiry();
  app.ui.modal = null;
  const msg = m.mode === 'create' ? 'PIN criado. Modo administrador liberado por 15 min.' : m.mode === 'change' ? 'PIN alterado.' : 'Modo administrador liberado por 15 min.';
  if (m.then) m.then();
  toast(msg, 'ok');
}

function cleanSelection() {
  const st = setupState();
  st.selected = st.selected.filter((id) => app.db.players.some((p) => p.id === id));
}

// ------------------------------------------------------------------ ações

const actions = {
  'pin-ok': () => pinOk(),
  'admin-toggle': () => {
    if (adminActive()) {
      app.ui.adminUntil = 0;
      toast('Modo administrador bloqueado.', 'ok');
    } else openModal('pin', { mode: store.loadAdmin() ? 'enter' : 'create', pin: '', pin2: '' });
  },
  'pin-change': () => withAdmin('pin-change', () => openModal('pin', { mode: 'change', pin: '', pin2: '' })),

  // ---------- importação em lote (RN-103 a RN-107)
  'open-roster': () => withAdmin('roster-import', () => openModal('roster', { text: '', mode: 'merge', plan: null })),
  // Lista oficial do grupo, distribuída junto com o app (dados/lista-oficial.txt). Só preenche o campo:
  // o usuário ainda confere e aplica (RN-107).
  'roster-official': async () => {
    try {
      const res = await fetch('dados/lista-oficial.txt', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      if (!app.ui.modal) return;
      app.ui.modal.text = await res.text();
      app.ui.modal.mode = 'replace';
      app.ui.modal.plan = null;
      render();
    } catch {
      toast('Não foi possível carregar a lista oficial.', 'error');
    }
  },
  'roster-current': () => {
    app.ui.modal.text = rosterText(app.db.players);
    app.ui.modal.plan = null;
    render();
  },
  'roster-preview': () => {
    const m = app.ui.modal;
    const entries = parseRoster(m.text, app.db.players);
    if (!entries.length) return toast('Cole ou carregue a lista primeiro.', 'error');
    m.plan = planRosterImport(app.db.players, entries, { mode: m.mode });
    render();
  },
  'roster-apply': () => {
    const m = app.ui.modal;
    const plan = m.plan;
    if (!plan || plan.blocked) return;
    const go = () =>
      withAdmin('roster-import', () => {
        app.db.players = applyRosterImport(app.db.players, plan);
        cleanSelection();
        save();
        app.ui.modal = null;
        toast(`Lista importada: ${rosterPlanSummary(plan)}.`, 'ok', 6000);
      });
    if (!plan.remove.length) return go();
    openModal('confirm', {
      title: 'Confirmar importação',
      text: `${plan.remove.length} jogador(es) serão excluídos do cadastro: ${plan.remove.map((p) => p.name).join(', ')}. O histórico das peladas continua preservado.`,
      okText: 'Importar e excluir',
      danger: true,
      onOk: go,
    });
  },

  go: (d) => navigate(d.to),
  'go-history': () => {
    const s = activeSession();
    if (s) navigate(`/historico/${s.id}`);
  },
  'modal-close': () => closeModal(),
  'modal-close-bg': (d, el, ev) => {
    if (ev.target === el) closeModal();
  },

  // ---------- cadastro
  'player-new': (d) => withAdmin('player-create', () => openModal('player', { draft: playerDraft(), select: d.select === '1' })),
  'player-edit': (d) => {
    const p = app.db.players.find((x) => x.id === d.id);
    if (p) withAdmin('player-edit', () => openModal('player', { id: p.id, draft: playerDraft(p) }));
  },
  pick: (d) => {
    app.ui.modal.draft[d.name] = Number(d.value);
    render();
  },
  'm-type': (d) => {
    app.ui.modal.draft.type = d.v;
    render();
  },
  'm-pos': (d) => {
    const draft = app.ui.modal.draft;
    draft.positions = togglePosition(draft.positions, d.r);
    render();
  },
  'player-save': () => {
    const m = app.ui.modal;
    try {
      const existing = app.db.players.find((p) => p.id === m.id);
      const p = validatePlayer({ ...m.draft, id: m.id, createdAt: existing?.createdAt }, app.db.players);
      app.ui.adminUntil = Math.max(app.ui.adminUntil, adminExpiry()); // ação de administrador renova a liberação
      if (existing) Object.assign(existing, p);
      else app.db.players.push(p);
      if (m.select) {
        const st = setupState();
        if (!st.selected.includes(p.id)) st.selected.push(p.id);
      }
      save();
      if (m.late) {
        app.ui.modal = null;
        exec('Atrasado', (s) => addLatePlayer(s, snapshotPlayer(p)));
        return;
      }
      app.ui.modal = null;
      toast(existing ? 'Cadastro atualizado. Peladas anteriores preservam os dados originais.' : `${p.name} cadastrado.`, 'ok');
    } catch (e) {
      m.error = e.message;
      render();
    }
  },
  'player-delete': () => {
    const m = app.ui.modal;
    const p = app.db.players.find((x) => x.id === m.id);
    withAdmin('player-delete', () => openModal('confirm', {
      title: 'Excluir jogador',
      text: `Excluir ${p.name} do cadastro? O histórico das peladas já disputadas continua preservado.`,
      okText: 'Excluir',
      danger: true,
      onOk: () => {
        app.db.players = app.db.players.filter((x) => x.id !== p.id);
        const st = setupState();
        st.selected = st.selected.filter((id) => id !== p.id);
        save();
        closeModal();
        toast(`${p.name} excluído do cadastro.`);
      },
    }));
  },
  pfilter: (d) => {
    const f = app.ui.playerFilter;
    f[d.key] = f[d.key] === d.value ? '' : d.value;
    render();
  },

  // ---------- seleção / configuração
  'setup-toggle': (d) => {
    const st = setupState();
    const i = st.selected.indexOf(d.id);
    if (i >= 0) st.selected.splice(i, 1);
    else st.selected.push(d.id);
    save();
    render();
  },
  'setup-all': () => {
    const st = setupState();
    st.selected = app.db.players.map((p) => p.id);
    save();
    render();
  },
  'setup-none': () => {
    setupState().selected = [];
    save();
    render();
  },
  'setup-n': (d) => {
    const c = setupState().config;
    c.linePerTeam = clampLinePerTeam(c.linePerTeam + Number(d.d));
    save();
    render();
  },
  'do-draw': () => doDraw(),
  redraw: () => {
    const s = activeSession();
    const st = setupState();
    st.selected = [...s.active];
    st.config = { linePerTeam: s.config.linePerTeam, useGoalkeepers: s.config.useGoalkeepers, requireGkForComplete: s.config.requireGkForComplete };
    doDraw();
  },
  'discard-draft': () =>
    openModal('confirm', {
      title: 'Descartar sorteio',
      text: 'Descartar este sorteio? Os participantes marcados continuam selecionados.',
      okText: 'Descartar',
      danger: true,
      onOk: () => {
        const s = activeSession();
        app.db.sessions = app.db.sessions.filter((x) => x.id !== s.id);
        app.db.activeSessionId = null;
        store.clearUndo(s.id);
        save();
        app.ui.modal = null;
        navigate('/nova');
      },
    }),
  start: () => {
    if (exec('Início', (s) => ({ state: startSession(s), message: 'Pelada iniciada! Boa partida.' }))) window.scrollTo(0, 0);
  },
  'toggle-invert': () => {
    app.ui.inverted = !app.ui.inverted;
    render();
  },
  'toggle-queue': () => {
    app.ui.expandQueue = !app.ui.expandQueue;
    render();
  },
  'dismiss-exp': () => {
    app.ui.lastExplanation = null;
    render();
  },

  // ---------- resultado
  result: (d) => {
    const s = activeSession();
    try {
      const analysis = analyzeResult(s, d.r);
      openModal('result', { r: d.r, analysis });
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  'result-ok': () => applyResult(app.ui.modal.r, {}),
  toss: (d) => applyResult('draw', { tossWinner: d.t }),

  // ---------- atrasados
  'open-late': () => openModal('late', { query: '' }),
  'late-add': (d) => {
    const p = app.db.players.find((x) => x.id === d.id);
    app.ui.modal = null;
    exec('Atrasado', (s) => addLatePlayer(s, snapshotPlayer(p)));
  },
  'late-new': () => {
    const name = app.ui.modal?.query || '';
    withAdmin('player-create', () => openModal('player', { draft: { ...playerDraft(), name }, late: true }));
  },

  // ---------- retirada
  'open-remove': () => openModal('remove', { reason: 'injury', note: '', pid: null }),
  'm-set': (d) => {
    const m = app.ui.modal;
    m[d.k] = d.v;
    if (m.type === 'roster') m.plan = null;
    if (m.type === 'transfer' && (d.k === 'from' || d.k === 'to')) m.qty = clampTransferQty(m.qty || 1);
    render();
  },
  'remove-ok': () => {
    const m = app.ui.modal;
    app.ui.modal = null;
    // A reposição é automática, em cascata pela fila (RN-76 a RN-78).
    const res = exec('Retirada', (s) => removePlayer(s, m.pid, m.reason, m.note), { silent: true });
    if (!res) return;
    if (res.moves.length) {
      app.ui.modal = { type: 'info', title: 'Saída aplicada', text: res.summary, list: res.moves, after: 'Se foi engano, use "Desfazer".' };
      render();
    } else toast(res.message, 'ok');
  },

  // ---------- transferência, ordem, troca, goleiros
  'open-transfer': () => {
    const s = activeSession();
    openModal('transfer', { from: s.queue[0] || s.field[0], to: s.queue[s.queue.length - 1] || s.field[1], qty: 1 });
  },
  'm-qty': (d) => {
    const m = app.ui.modal;
    m.qty = clampTransferQty(m.qty + Number(d.d));
    render();
  },
  'transfer-ok': () => {
    const m = app.ui.modal;
    app.ui.modal = null;
    exec('Transferência', (s) => transferPlayers(s, m.from, m.to, m.qty));
  },
  'open-order': () => {
    const s = activeSession();
    openModal('order', { tid: s.field[0] || s.queue[0] });
  },
  'order-move': (d) => {
    const m = app.ui.modal;
    exec('Ordem', (s) => movePlayerInOrder(s, m.tid, d.pid, Number(d.d)), { silent: true });
  },
  'open-swap': () => openModal('swap', { a: null, b: null }),
  'swap-ok': () => {
    const m = app.ui.modal;
    app.ui.modal = null;
    exec('Troca', (s) => swapPlayers(s, m.a, m.b));
  },
  'open-gk': () => openModal('gk', {}),
  'gk-move': (d) => exec('Goleiro', (s) => moveGoalkeeper(s, d.pid, d.t || null), { silent: true }),
  'open-log': () => openModal('log', {}),
  'open-more': () => openModal('more', {}),
  perm: (d) => {
    const s = activeSession();
    exec('Ajuste de permanência', (st) => setPermanence(st, d.t, !s.teams[d.t].permanence));
  },

  // ---------- desfazer / encerrar
  undo: () => {
    const s = activeSession();
    const item = store.popUndo(s.id);
    if (!item) return toast('Nada para desfazer.');
    replaceSession(item.state);
    save();
    app.ui.lastExplanation = null;
    toast(`Desfeito: ${item.label}.`, 'ok');
  },
  finish: () =>
    openModal('confirm', {
      title: 'Encerrar pelada',
      text: 'Encerrar a sequência de jogos? Ela ficará salva no histórico.',
      okText: 'Encerrar',
      danger: true,
      onOk: () => {
        const s = activeSession();
        replaceSession(finishSession(s));
        app.db.activeSessionId = null;
        store.clearUndo(s.id);
        save();
        app.ui.modal = null;
        navigate(`/historico/${s.id}`);
      },
    }),
  'confirm-ok': () => app.ui.modal.onOk(),

  // ---------- compartilhar
  share: () => {
    const opts = { includeStars: true, includeOrder: true, includeRoles: false };
    openModal('share', { opts, text: shareText(activeSession(), opts) });
  },
  'share-copy': async () => {
    await copy(app.ui.modal.text);
  },
  'share-wa': () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(app.ui.modal.text)}`, '_blank', 'noopener');
  },
  'share-native': async () => {
    const text = app.ui.modal.text;
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        /* cancelado */
      }
    } else await copy(text);
  },

  // ---------- histórico
  htab: (d) => {
    app.ui.historyTab = d.tab;
    render();
  },
  'delete-session': (d) =>
    withAdmin('history-delete', () => openModal('confirm', {
      title: 'Excluir do histórico',
      text: 'Esta pelada será removida permanentemente do histórico deste aparelho. Exporte um backup antes se quiser guardá-la.',
      okText: 'Excluir',
      danger: true,
      onOk: () => {
        app.db.sessions = app.db.sessions.filter((x) => x.id !== d.id);
        save();
        app.ui.modal = null;
        navigate('/historico');
      },
    })),

  // ---------- backup
  export: () => {
    const blob = new Blob([store.exportData(app.db)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pelada-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup exportado.', 'ok');
  },
  'share-backup': async () => {
    const name = `pelada-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([store.exportData(app.db)], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Backup da pelada' });
      } catch {
        /* cancelado */
      }
    } else actions.export();
  },
  wipe: () =>
    withAdmin('data-wipe', () => openModal('confirm', {
      title: 'Apagar todos os dados',
      text: 'Isto apaga jogadores, peladas e histórico deste aparelho e não pode ser desfeito. Exporte um backup antes.',
      okText: 'Apagar tudo',
      danger: true,
      onOk: () => {
        const sid = app.db.activeSessionId;
        if (sid) store.clearUndo(sid);
        app.db = { schema: 1, players: [], sessions: [], settings: app.db.settings, activeSessionId: null };
        save();
        app.ui.modal = null;
        navigate('/');
      },
    })),
};

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Texto copiado.', 'ok');
  } catch {
    const ta = document.querySelector('.share-text');
    if (ta) {
      ta.removeAttribute('readonly');
      ta.select();
      document.execCommand('copy');
      ta.setAttribute('readonly', '');
      toast('Texto copiado.', 'ok');
    } else toast('Não foi possível copiar.', 'error');
  }
}

function applyResult(r, opts) {
  app.ui.modal = null;
  const res = exec('Resultado', (s) => registerResult(s, r, opts), { silent: true });
  if (res) {
    app.ui.lastExplanation = { sid: res.state.id, text: res.explanation + (res.game.moves.length ? ' ' + res.game.moves.join(' ') : '') };
    toast(`Jogo ${res.game.n} registrado.`, 'ok');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function doDraw() {
  const st = setupState();
  const current = activeSession();
  if (current && current.status === 'live') return toast('Há uma pelada em andamento. Encerre-a antes.', 'error');
  const title = st.title.trim() || defaultTitle();
  try {
    const t0 = performance.now();
    const { draw, snapshots, config } = prepareDraw({ players: app.db.players, selectedIds: st.selected, config: st.config, settings: app.db.settings });
    const ms = Math.round(performance.now() - t0);
    if (current && current.status === 'draft') {
      const next = redraw(current, { draw, config, snapshots });
      next.title = title;
      store.pushUndo(current.id, 'Sorteio', current);
      replaceSession(next);
    } else {
      const s = createSession({ title, config, snapshots, draw, scheduledAt: st.scheduled || null });
      app.db.sessions.push(s);
      app.db.activeSessionId = s.id;
    }
    save();
    app.ui.lastExplanation = null;
    const lack = draw.withoutGk.length ? ` Sem goleiro: ${draw.withoutGk.map((i) => `Time ${i + 1}`).join(', ')}.` : '';
    toast(`Sorteio otimizado em ${ms} ms.${lack}`, 'ok', 4500);
    navigate('/partida');
  } catch (e) {
    toast(e instanceof RuleError ? e.message : `Não foi possível sortear: ${e.message}`, 'error');
  }
}

// ------------------------------------------------------------------ eventos

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A') ev.preventDefault();
  fn(el.dataset, el, ev);
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  const key = el.dataset.input;
  if (!key) return;
  if (key === 'psearch') {
    app.ui.playerFilter.query = el.value;
    render();
  } else if (key === 'ssearch') {
    app.ui.setupQuery = el.value;
    render();
  } else if (key === 'stitle') {
    setupState().title = el.value;
    save();
  } else if (key === 'ssched') {
    setupState().scheduled = el.value;
    save();
    render();
  } else if (key.startsWith('m:') && app.ui.modal) {
    const field = key.slice(2);
    if (app.ui.modal.draft && field === 'name') app.ui.modal.draft.name = el.value;
    else app.ui.modal[field] = el.value;
    if (field === 'query') render();
    if (field === 'text' && app.ui.modal.plan) {
      app.ui.modal.plan = null; // a prévia deixa de valer quando a lista muda
      render();
    }
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  const key = el.dataset.change;
  if (!key) return;
  const st = app.db.settings;
  const setup = setupState();
  switch (key) {
    case 'setup-gk':
      setup.config.useGoalkeepers = el.checked;
      break;
    case 'setup-reqgk':
      setup.config.requireGkForComplete = el.checked;
      break;
    case 'set-group':
      st.groupName = el.value.trim() || 'Pelada';
      break;
    case 'set-tol':
      st.toleranceMin = clampTolerance(el.value);
      break;
    case 'set-n':
      st.linePerTeam = clampLinePerTeam(el.value);
      setup.config.linePerTeam = st.linePerTeam;
      break;
    case 'set-gk':
      st.useGoalkeepers = el.checked;
      setup.config.useGoalkeepers = el.checked;
      break;
    case 'set-reqgk':
      st.requireGkForComplete = el.checked;
      setup.config.requireGkForComplete = el.checked;
      break;
    case 'set-toss': {
      st.tossOnFirstGameEvenWithTwoWaiting = el.checked;
      const s = activeSession();
      if (s && s.games.length === 0) s.config.tossOnFirstGameEvenWithTwoWaiting = el.checked;
      break;
    }
    case 'share-opt': {
      const m = app.ui.modal;
      m.opts[el.dataset.k] = el.checked;
      m.text = shareText(activeSession(), m.opts);
      break;
    }
    case 'roster-file': {
      const file = el.files[0];
      if (!file || !app.ui.modal) return;
      app.ui.modal.text = await file.text();
      app.ui.modal.plan = null;
      el.value = '';
      render();
      return;
    }
    case 'import': {
      const file = el.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const parsed = store.parseImport(text);
        withAdmin('backup-import', () => openModal('confirm', {
          title: 'Importar backup',
          text: `O backup tem ${parsed.players.length} jogadores e ${parsed.sessions.length} peladas. Os dados atuais deste aparelho serão substituídos (uma cópia de segurança é guardada).`,
          okText: 'Importar',
          danger: true,
          onOk: () => {
            app.db = store.importData(text, app.db);
            app.ui.modal = null;
            toast('Backup importado.', 'ok');
            navigate('/');
          },
        }));
      } catch (e) {
        toast(e.message, 'error', 5000);
      }
      el.value = '';
      return;
    }
    default:
      return;
  }
  save();
  render();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && app.ui.modal) closeModal();
  if (ev.key === 'Enter' && app.ui.modal?.type === 'player' && ev.target.id === 'm-name') actions['player-save']();
  if (ev.key === 'Enter' && app.ui.modal?.type === 'pin' && ev.target.id?.startsWith('m-pin')) {
    if (ev.target.id === 'm-pin' && app.ui.modal.mode !== 'enter') document.getElementById('m-pin2')?.focus();
    else pinOk();
  }
});

window.addEventListener('hashchange', onRoute);
window.addEventListener('storage', (e) => {
  if (e.key === 'pelada.db') {
    app.db = store.load();
    render();
  }
});

// Armazenamento persistente (evita limpeza automática do navegador)
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

onRoute();
