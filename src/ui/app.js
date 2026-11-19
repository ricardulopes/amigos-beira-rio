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
  shareText, validatePinFormat, validatePlayerCode, validateOwnPositions, parseRoster, planRosterImport, applyRosterImport, rosterPlanSummary,
  rosterText,
} from '../domain/index.js';
import { OFFICIAL_ROSTER } from '../data/lista-oficial.js';
import { initCloud, login, logout, changePin, newPlayerCode, setOwnPositions, rememberedCode, pullAll, flush, cloud } from '../cloud/sync.js';

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

// ------------------------------------------------------------------ administrador: PIN mestre no servidor (RN-113, RN-114)

/** Executa `then` só com acesso de administrador; senão pede o PIN mestre (precisa de internet). */
function withAdmin(action, then) {
  if (adminActive()) return then();
  openModal('pin', { mode: 'enter', action, pin: '', pin2: '', then });
}

async function pinOk() {
  const m = app.ui.modal;
  if (!m || m.busy) return;
  try {
    const pin = validatePinFormat(m.pin);
    if (m.mode === 'change' && String(m.pin2 ?? '').trim() !== pin) throw new Error('A confirmação não confere com o PIN digitado.');
    m.busy = true;
    m.error = '';
    render();
    if (m.mode === 'change') await changePin(pin);
    else await login(pin);
  } catch (e) {
    Object.assign(m, { busy: false, error: e.message, pin: '', pin2: '' });
    if (app.ui.modal === m) render();
    return;
  }
  if (app.ui.modal === m) app.ui.modal = null;
  toast(m.mode === 'change' ? 'PIN mestre alterado. Os outros aparelhos precisam entrar de novo.' : 'Administrador liberado neste aparelho por 12 horas.', 'ok', 5000);
  if (m.then) m.then();
}

/**
 * Ações livres para qualquer pessoa (RN-114): navegar, ver, filtrar, compartilhar, exportar e a ficha
 * do jogador (própria posição, com código). Também as que só mexem em janelas já liberadas.
 * Qualquer outra ação pede o PIN mestre antes de rodar.
 */
const FREE_ACTIONS = new Set([
  'go', 'go-history', 'modal-close', 'modal-close-bg', 'pfilter', 'toggle-invert', 'toggle-queue', 'dismiss-exp', 'htab',
  'share', 'share-copy', 'share-wa', 'share-native', 'export', 'share-backup', 'open-log', 'open-more',
  'admin-toggle', 'pin-ok', 'player-edit', 'self-pos', 'self-save', 'cloud-sync', 'wipe', 'confirm-ok',
  'm-set', 'm-qty', 'm-pos', 'm-type', 'pick', 'roster-official', 'roster-current', 'roster-preview',
]);

/** Ajustes e seleção de presentes (campos de formulário) também são do administrador. */
const ADMIN_FIELDS = new Set(['stitle', 'ssched', 'setup-gk', 'setup-reqgk', 'set-group', 'set-tol', 'set-n', 'set-gk', 'set-reqgk', 'set-toss', 'import']);

function blockField() {
  render(); // devolve o valor que estava
  if (!app.ui.modal) withAdmin('settings', () => toast('Administrador liberado. Faça a alteração de novo.', 'ok'));
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
      logout();
      toast('Saiu do modo administrador neste aparelho.', 'ok');
    } else openModal('pin', { mode: 'enter', pin: '', pin2: '' });
  },
  'pin-change': () => withAdmin('pin-change', () => openModal('pin', { mode: 'change', pin: '', pin2: '' })),
  'cloud-sync': async () => {
    toast('Sincronizando…');
    await pullAll();
    await flush();
    toast(cloud.error ? cloud.error : 'Dados sincronizados com a nuvem.', cloud.error ? 'error' : 'ok', 5000);
  },

  // ---------- ficha do jogador: a própria posição, com o código (RN-116)
  'self-pos': (d) => {
    const m = app.ui.modal;
    m.positions = togglePosition(m.positions, d.r);
    m.error = '';
    m.ok = '';
    render();
  },
  'self-save': async () => {
    const m = app.ui.modal;
    if (!m || m.busy) return;
    const p = app.db.players.find((x) => x.id === m.id);
    try {
      const positions = validateOwnPositions(p, m.positions);
      const code = validatePlayerCode(m.code);
      Object.assign(m, { busy: true, error: '', ok: '' });
      render();
      const saved = await setOwnPositions(p.id, code, positions);
      Object.assign(m, { busy: false, positions: saved, ok: 'Posições salvas para todos os aparelhos.' });
    } catch (e) {
      Object.assign(m, { busy: false, error: e.message });
    }
    if (app.ui.modal === m) render();
  },
  'player-code': async () => {
    const m = app.ui.modal;
    if (!m?.id || m.busy) return;
    try {
      Object.assign(m, { busy: true, error: '' });
      render();
      m.code = await newPlayerCode(m.id);
    } catch (e) {
      m.error = e.message;
    }
    m.busy = false;
    if (app.ui.modal === m) render();
  },

  // ---------- importação em lote (RN-103 a RN-107)
  'open-roster': () => withAdmin('roster-import', () => openModal('roster', { text: '', mode: 'merge', plan: null })),
  // Lista oficial do grupo, embutida no app (src/data/lista-oficial.js). Só preenche o campo:
  // o usuário ainda confere e aplica (RN-107).
  'roster-official': () => {
    app.ui.modal.text = OFFICIAL_ROSTER;
    app.ui.modal.mode = 'replace';
    app.ui.modal.plan = null;
    render();
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
  // Admin abre o cadastro completo; os demais, a ficha (ver dados e trocar a própria posição).
  'player-edit': (d) => {
    const p = app.db.players.find((x) => x.id === d.id);
    if (!p) return;
    if (adminActive()) openModal('player', { id: p.id, draft: playerDraft(p) });
    else openModal('self', { id: p.id, positions: [...p.positions], code: rememberedCode(p.id), error: '', ok: '' });
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
      text: 'Esta pelada será removida permanentemente do histórico de todos os aparelhos. Exporte um backup antes se quiser guardá-la.',
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
  // Limpa só a cópia deste aparelho; os dados da nuvem continuam e são baixados de novo.
  wipe: () =>
    openModal('confirm', {
      title: 'Limpar dados deste aparelho',
      text: `Apaga a cópia local (e o acesso de administrador) deste aparelho e baixa tudo de novo da nuvem. Nada é apagado para os outros.${cloud.pending ? ` Atenção: ${cloud.pending} alteração(ões) ainda não enviada(s) serão perdidas.` : ''}`,
      okText: 'Limpar e recarregar',
      danger: true,
      onOk: () => {
        store.clearLocal();
        location.reload();
      },
    }),
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
  const act = el.dataset.act;
  const fn = actions[act];
  if (!fn) return;
  if (el.tagName === 'A') ev.preventDefault();
  if (!FREE_ACTIONS.has(act) && !adminActive()) {
    const data = { ...el.dataset };
    return withAdmin('pelada', () => fn(data, el, ev));
  }
  fn(el.dataset, el, ev);
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  const key = el.dataset.input;
  if (!key) return;
  if (ADMIN_FIELDS.has(key) && !adminActive()) return blockField();
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
  if (ADMIN_FIELDS.has(key) && !adminActive()) {
    if (key === 'import') el.value = '';
    return blockField();
  }
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
          text: `O backup tem ${parsed.players.length} jogadores e ${parsed.sessions.length} peladas. Os dados atuais serão substituídos na nuvem, para TODOS os aparelhos (uma cópia de segurança do que havia fica neste aparelho).`,
          okText: 'Importar',
          danger: true,
          onOk: () => {
            app.db = store.importData(text, app.db);
            save(); // envia para a nuvem
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

// Banco unificado na nuvem (RN-113 a RN-117): baixa os dados, escuta mudanças e envia a fila.
let statusFrame = 0;
initCloud({
  getDb: () => app.db,
  setDb: (db) => {
    app.db = db;
    render();
  },
  cache: (db) => {
    try {
      store.save(db);
    } catch {
      /* armazenamento cheio: a nuvem continua valendo */
    }
  },
  onStatus: () => {
    cancelAnimationFrame(statusFrame);
    statusFrame = requestAnimationFrame(() => render());
  },
  onConflict: (msg) => toast(msg, 'error', 9000),
});

onRoute();
