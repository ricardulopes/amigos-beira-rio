// Controlador da interface: roteamento, renderização e ações.
// Toda regra de negócio é delegada ao domínio (src/domain, via index.js). Aqui só orquestramos.
import { app, store, save, activeSession, replaceSession, setupState, openModal, closeModal, toast, navigate, adminActive } from './state.js';
import { homeView, playersView, setupView, draftView, liveView, historyView, historyDetailView, settingsView, financeView, tabbar, defaultTitle } from './views.js';
import { renderModal } from './modals.js';
import { esc } from './dom.js';
import {
  validatePlayer, snapshotPlayer, playerDraft, togglePosition, prepareDraw, clampLinePerTeam, clampTolerance, clampTransferQty,
  createSession, redraw, startSession, finishSession, clockOf, resolveFinishTime, analyzeResult, registerResult, addLatePlayer, removePlayer,
  transferPlayers, movePlayerInOrder, swapPlayers, moveGoalkeeper, moveGoalkeeperInLineup, setPermanence, RuleError,
  goalkeeperOrder, moveInGoalkeeperOrder, goalkeeperLineup,
  shareText, validatePinFormat, parseRoster, planRosterImport, applyRosterImport, rosterPlanSummary,
  rosterText, financeSettings, setPayment, toggleCallPayment, keepCallPayments, drawPayments, callPaymentOf, addContribution, removeContribution, setPixConfig, setPixQr, resetCycle, QR_MAX_CHARS, formatMoney,
  currentCycle, closeCycle, startCycle, suggestCycleLabel, reopenCycle, closedCycleOf, assertSessionDeletable, settleParty, unsettleParty,
  PAYMENT_METHODS,
} from '../domain/index.js';
import { OFFICIAL_ROSTER } from '../data/lista-oficial.js';
import { initCloud, login, logout, changePin, pullAll, flush, cloud } from '../cloud/sync.js';

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

  const html = view() + tabbar() + renderModal() + (app.ui.toast ? `<div id="toast" class="toast ${app.ui.toast.kind}" role="status">${esc(app.ui.toast.text)}</div>` : '');
  if (patchRender(html)) return;
  root.innerHTML = html;
  app.ui._anchor = null;
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

/** Esqueleto da tela: o HTML com cada região [data-patch] trocada por um marcador com o id dela. */
function skeletonOf(container) {
  const c = document.createElement('div');
  for (const n of container.childNodes) c.append(n.cloneNode(true)); // serve para elemento e para template.content
  for (const n of c.querySelectorAll('[data-patch]')) n.replaceWith(document.createComment(n.id));
  return c.innerHTML;
}

/**
 * Atualização local (sem "pulo" na tela de chamada): se só mudaram regiões marcadas com data-patch (linha do jogador,
 * goleiros, resumo, botão Sortear), troca apenas essas regiões, sem recriar a página. O item tocado fica parado sob o
 * dedo: a rolagem compensa qualquer mudança de altura acima dele. Qualquer outra diferença → render completo.
 */
function patchRender(html) {
  if (!root.querySelector('[data-patch]')) return false;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  if (skeletonOf(tpl.content) !== skeletonOf(root)) return false;
  // Âncora: a região tocada; sem toque (ex.: mudança vinda da nuvem), o primeiro item visível abaixo do cabeçalho.
  if (!app.ui._anchor) {
    const headerBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const first = [...root.querySelectorAll('[data-patch]')].find((n) => n.id !== 'cloud-bar' && n.getBoundingClientRect().top >= headerBottom);
    if (first) app.ui._anchor = { id: first.id };
  }
  const anchor = app.ui._anchor && document.getElementById(app.ui._anchor.id);
  const top = anchor ? anchor.getBoundingClientRect().top : null;
  for (const next of [...tpl.content.querySelectorAll('[data-patch]')]) {
    const cur = document.getElementById(next.id);
    if (!cur) return false;
    if (cur.outerHTML !== next.outerHTML) cur.replaceWith(next);
  }
  if (top !== null) {
    const now = document.getElementById(app.ui._anchor.id);
    if (now) window.scrollBy(0, now.getBoundingClientRect().top - top);
  }
  app.ui._anchor = null;
  return true;
}

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
  if (r === '/caixa') return financeView();
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

/**
 * Executa um comando de domínio na pelada ativa (ou na pelada `sid`) com desfazer e persistência.
 * `undo: false` para registros que não são movimentação de jogo (pagamento do dia).
 */
function exec(labelText, fn, { silent = false, sid = null, undo = true } = {}) {
  const s = sid ? app.db.sessions.find((x) => x.id === sid) : activeSession();
  if (!s) return null;
  try {
    const res = fn(s);
    if (undo) store.pushUndo(s.id, labelText, s);
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
 * Ações livres para qualquer pessoa (RN-114, RN-116): navegar, ver, filtrar, compartilhar, exportar e
 * abrir a ficha do jogador (só leitura). Também as que só mexem em janelas já liberadas pelo PIN.
 * Visitante não altera nada: qualquer outra ação pede o PIN mestre antes de rodar.
 */
const FREE_ACTIONS = new Set([
  'go', 'go-history', 'modal-close', 'modal-close-bg', 'pfilter', 'toggle-invert', 'toggle-queue', 'toggle-gallery', 'htab', 'hist-view', 'rk-type', 'rk-period', 'rk-sort',
  'share', 'share-copy', 'share-wa', 'share-native', 'export', 'share-backup', 'open-log', 'open-more',
  'admin-toggle', 'pin-ok', 'player-edit', 'player-admin-edit', 'cloud-sync', 'wipe', 'confirm-ok',
  'm-set', 'm-qty', 'm-pos', 'm-type', 'pick', 'roster-official', 'roster-current', 'roster-preview',
  'ftab', 'fsem', 'frank', 'fpay-pick', 'stmt-pick', 'stmt-clear', 'pix-open', 'pix-copy', 'go-caixa',
]);

/** Ajustes e seleção de presentes (campos de formulário) também são do administrador. */
const ADMIN_FIELDS = new Set(['stitle', 'ssched', 'set-group', 'set-tol', 'set-n', 'import', 'pix-qr']);

// ------------------------------------------------------------------ financeiro (RN-118 a RN-127)

const MY_ATHLETE = 'pelada.meuAtleta'; // escolha do extrato, só neste aparelho
try {
  app.ui.stmtPid = localStorage.getItem(MY_ATHLETE) || null;
} catch {
  app.ui.stmtPid = null;
}

function rememberAthlete(pid) {
  try {
    if (pid) localStorage.setItem(MY_ATHLETE, pid);
    else localStorage.removeItem(MY_ATHLETE);
  } catch {
    /* sem armazenamento: vale só nesta abertura */
  }
}

/** Aplica uma mudança do domínio em settings.finance e grava (aportes, Pix). */
function updateFinance(fn, okMsg) {
  try {
    const res = fn(financeSettings(app.db.settings));
    app.db.settings.finance = res.finance || res;
    if (save()) {
      toast(res.message || okMsg, 'ok');
      return true;
    }
  } catch (e) {
    toast(e instanceof RuleError ? e.message : `Operação cancelada: ${e.message}`, 'error', 5000);
  }
  return false;
}

/** Reduz a imagem do QR Code para caber nos ajustes da nuvem (máx. 480 px). */
async function readQrImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new RuleError('Use uma imagem PNG, JPG ou WEBP.');
  if (file.size > 8 * 1024 * 1024) throw new RuleError('Imagem muito grande (máximo 8 MB).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new RuleError('Não foi possível abrir a imagem.'));
      i.src = url;
    });
    const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false; // QR Code nítido
    ctx.drawImage(img, 0, 0, c.width, c.height);
    let data = c.toDataURL('image/png');
    if (data.length > QR_MAX_CHARS * 0.75) data = c.toDataURL('image/jpeg', 0.85);
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
  // Admin abre o cadastro completo; visitante, a ficha só de leitura (RN-116).
  'player-edit': (d) => {
    const p = app.db.players.find((x) => x.id === d.id);
    if (!p) return;
    if (adminActive()) openModal('player', { id: p.id, draft: playerDraft(p) });
    else openModal('playerInfo', { id: p.id });
  },
  // Botão "Editar" da ficha: pede o PIN mestre e só então abre o cadastro.
  'player-admin-edit': (d) => withAdmin('player-edit', () => {
    const p = app.db.players.find((x) => x.id === d.id);
    if (p) openModal('player', { id: p.id, draft: playerDraft(p) });
  }),
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
    if (st.payments) st.payments = keepCallPayments(st.payments, st.selected);
    save();
    render();
  },
  'setup-all': () => {
    const st = setupState();
    // RN-134: "Todos" marca só a linha; goleiros são chamados na janela do sorteio
    const gks = st.selected.filter((id) => app.db.players.find((p) => p.id === id)?.type === 'gk');
    st.selected = [...app.db.players.filter((p) => p.type === 'line').map((p) => p.id), ...gks];
    save();
    render();
  },
  'setup-none': () => {
    // "Limpar" da lista de linha não desmarca os goleiros (eles têm a seção própria no topo)
    const st = setupState();
    st.selected = st.selected.filter((id) => app.db.players.find((p) => p.id === id)?.type === 'gk');
    if (st.payments) st.payments = keepCallPayments(st.payments, st.selected);
    save();
    render();
  },
  // RN-139: Pix / Cartão / Dinheiro na chamada. Atleta já na pelada (rascunho ou ao vivo) → pagamento da pelada;
  // senão fica na chamada e passa para a pelada no sorteio. Tocar de novo desmarca (pendente).
  'call-pay': (d) => {
    const st = setupState();
    const target = callPaymentOf(st.payments, activeSession(), d.pid);
    if (target.sid) return actions['pay-set']({ sid: target.sid, pid: d.pid, m: target.method === d.m ? '' : d.m });
    st.payments = toggleCallPayment(st.payments || {}, d.pid, d.m);
    save();
    render();
  },
  // RN-134: ordem de chegada dos goleiros, no topo da chamada (marcar, ordenar, desmarcar)
  'gk-add': (d) => {
    const st = setupState();
    const order = goalkeeperOrder(app.db.players, st.selected, st.gkOrder || []);
    if (!st.selected.includes(d.pid)) st.selected.push(d.pid);
    st.gkOrder = order.includes(d.pid) ? order : [...order, d.pid];
    save();
    render();
  },
  'gk-del': (d) => {
    const st = setupState();
    st.selected = st.selected.filter((id) => id !== d.pid);
    st.gkOrder = (st.gkOrder || []).filter((id) => id !== d.pid);
    save();
    render();
  },
  'gk-order': (d) => {
    const st = setupState();
    st.gkOrder = moveInGoalkeeperOrder(goalkeeperOrder(app.db.players, st.selected, st.gkOrder || []), d.pid, Number(d.d));
    save();
    render();
  },
  'setup-n': (d) => {
    const c = setupState().config;
    c.linePerTeam = clampLinePerTeam(c.linePerTeam + Number(d.d));
    save();
    render();
  },
  // RN-134: antes de sortear, a chamada dos goleiros (pré-marcados com a ordem da última vez)
  // RN-134: sem goleiro marcado no topo, confirma antes de sortear (há dias sem goleiro)
  'do-draw': () => {
    const st = setupState();
    if (goalkeeperOrder(app.db.players, st.selected, st.gkOrder || []).length) return doDraw();
    openModal('confirm', {
      title: 'Sem goleiro hoje?',
      text: 'Uai, nenhum goleiro foi marcado para hoje! Quer sortear assim mesmo? Os times ficam "aguardando goleiro" e quem chegar depois entra por "+ Atrasado".',
      okText: 'Sortear sem goleiros',
      onOk: () => {
        closeModal();
        doDraw();
      },
    });
  },
  redraw: () => {
    const s = activeSession();
    const st = setupState();
    st.selected = [...s.active];
    st.gkOrder = goalkeeperLineup(s); // novo sorteio mantém a ordem dos goleiros
    st.config = { linePerTeam: s.config.linePerTeam };
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
  // RN-143: ranking acumulado do histórico (só leitura)
  'hist-view': (d) => {
    app.ui.histView = d.v;
    render();
  },
  'rk-type': (d) => {
    app.ui.rkType = d.v;
    render();
  },
  'rk-period': (d) => {
    app.ui.rkPeriod = d.v;
    render();
  },
  'rk-sort': (d) => {
    app.ui.rkSort = d.v;
    render();
  },
  'toggle-gallery': () => {
    app.ui.galleryAll = !app.ui.galleryAll;
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
  'gk-line': (d) => exec('Goleiro', (s) => moveGoalkeeperInLineup(s, d.pid, d.to === 'end' ? 'end' : Number(d.to)), { silent: true }),
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
    // Pagamentos do dia não são movimentação de jogo: desfazer um resultado não apaga pagamento.
    replaceSession(s.payments ? { ...item.state, payments: s.payments } : item.state);
    save();
    app.ui.lastExplanation = null;
    toast(`Desfeito: ${item.label}.`, 'ok');
  },
  // RN-146: encerrar pede o horário de encerramento; o campo começa VAZIO (nada pré-selecionado).
  finish: () => openModal('finish', { time: '' }),
  'finish-now': () => {
    app.ui.modal.time = clockOf(new Date().toISOString());
    render();
  },
  'finish-ok': () => {
    const s = activeSession();
    try {
      const at = resolveFinishTime(s, app.ui.modal.time);
      replaceSession(finishSession(s, at));
    } catch (e) {
      return toast(e instanceof RuleError ? e.message : `Não foi possível encerrar: ${e.message}`, 'error', 5000);
    }
    app.db.activeSessionId = null;
    store.clearUndo(s.id);
    save();
    app.ui.modal = null;
    navigate(`/historico/${s.id}`);
  },
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
    withAdmin('history-delete', () => {
      // RN-129: pelada de ciclo encerrado fica blindada (o ranking do campeonato e o acerto dependem dela).
      try {
        assertSessionDeletable(app.db.sessions.find((x) => x.id === d.id), financeSettings(app.db.settings));
      } catch (e) {
        return toast(e.message, 'error', 6000);
      }
      openModal('confirm', {
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
    });
    }),

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

  // ---------- caixa: ranking, extrato, Pix (livres) e pagamentos, aportes, reset (admin)
  ftab: (d) => {
    app.ui.financeTab = d.tab;
    if (app.ui.route !== '/caixa') navigate('/caixa');
    else render();
  },
  fsem: (d) => {
    app.ui.rankCycle = d.v;
    render();
  },
  frank: (d) => {
    app.ui.rankType = d.v;
    render();
  },
  'stmt-pick': (d) => {
    app.ui.stmtPid = d.id;
    app.ui.financeTab = 'extrato';
    app.ui.financeQuery = '';
    rememberAthlete(d.id);
    window.scrollTo(0, 0);
    if (app.ui.route !== '/caixa') navigate('/caixa');
    else render();
  },
  'stmt-clear': () => {
    app.ui.stmtPid = null;
    rememberAthlete(null);
    render();
  },
  'pix-open': () => openModal('pix', {}),
  'pix-copy': (d) => {
    const f = financeSettings(app.db.settings);
    copy(d.k === 'cc' ? f.pixCopyPaste : f.pixKey, d.k === 'cc' ? 'Pix Copia e Cola copiado.' : 'Chave Pix copiada.');
  },
  'go-caixa': () => {
    app.ui.financeTab = 'caixa';
    app.ui.paySid = activeSession()?.id || null;
    app.ui.modal = null;
    navigate('/caixa');
  },
  'fpay-pick': (d) => {
    app.ui.paySid = d.id;
    render();
  },
  'pay-set': (d) => {
    const run = () => exec('Pagamento', (s) => setPayment(s, d.pid, d.m || null), { sid: d.sid, undo: false, silent: true });
    const s = app.db.sessions.find((x) => x.id === d.sid);
    const closed = closedCycleOf(s, financeSettings(app.db.settings));
    if (!closed) return run();
    // RN-129: pelada de ciclo encerrado — mudar o pagamento muda o cashback do acerto; pede confirmação.
    const name = s?.snapshot?.[d.pid]?.name || 'o atleta';
    openModal('confirm', {
      title: 'Pelada de ciclo encerrado',
      text: `Esta pelada é do ciclo "${closed.label}", já encerrado. Marcar ${name} como ${d.m ? PAYMENT_METHODS[d.m] : 'pendente'} muda o cashback dele nesse período (o ranking guardado não muda). Confirmar?`,
      okText: 'Confirmar',
      onOk: () => {
        closeModal();
        run();
      },
    });
  },
  'contrib-new': (d) => openModal('contrib', { pid: d.pid || null, query: '', amount: '', note: '' }),
  'contrib-save': () => {
    const m = app.ui.modal;
    const p = app.db.players.find((x) => x.id === m.pid);
    try {
      const res = addContribution(financeSettings(app.db.settings), { pid: m.pid, name: p?.name || '', amount: m.amount, note: m.note });
      app.db.settings.finance = res.finance;
      if (save()) {
        app.ui.modal = null;
        toast(res.message, 'ok');
      }
    } catch (e) {
      m.error = e.message;
      render();
    }
  },
  'contrib-del': (d) => {
    const c = financeSettings(app.db.settings).contributions.find((x) => x.id === d.id);
    if (!c) return;
    openModal('confirm', {
      title: 'Excluir aporte',
      text: `Excluir o aporte de ${c.name} (${formatMoney(c.cents)})? O cashback do atleta diminui na hora.`,
      okText: 'Excluir',
      danger: true,
      onOk: () => {
        app.ui.modal = null;
        updateFinance((f) => removeContribution(f, d.id), 'Aporte excluído.');
      },
    });
  },
  'pix-edit': () => {
    const f = financeSettings(app.db.settings);
    openModal('pixEdit', { pixKey: f.pixKey, pixName: f.pixName, pixCopyPaste: f.pixCopyPaste, qrImage: f.qrImage });
  },
  'pix-qr-clear': () => {
    app.ui.modal.qrImage = '';
    render();
  },
  'pix-save': () => {
    const m = app.ui.modal;
    try {
      const f = setPixQr(setPixConfig(financeSettings(app.db.settings), m), m.qrImage);
      app.db.settings.finance = f;
      if (save()) {
        app.ui.modal = null;
        toast('Pix da tesouraria salvo para todos os aparelhos.', 'ok');
      }
    } catch (e) {
      m.error = e.message;
      render();
    }
  },
  // RN-128: ciclos manuais (encerrar / iniciar), com palavra de confirmação
  'cycle-close': () => openModal('cycle', { mode: 'close', label: currentCycle(financeSettings(app.db.settings))?.label || '', confirm: '' }),
  'cycle-start': () => openModal('cycle', { mode: 'start', label: suggestCycleLabel(), reset: '', confirm: '' }),
  'cycle-reopen': () => openModal('cycle', { mode: 'reopen', confirm: '' }),
  'cycle-ok': () => {
    const m = app.ui.modal;
    const word = { close: 'ENCERRAR', start: 'INICIAR', reopen: 'REABRIR' }[m.mode];
    if (String(m.confirm || '').trim().toUpperCase() !== word) {
      m.error = `Digite ${word} para confirmar.`;
      return render();
    }
    try {
      const f = financeSettings(app.db.settings);
      const res = m.mode === 'close' ? closeCycle(f, { label: m.label, sessions: app.db.sessions })
        : m.mode === 'reopen' ? reopenCycle(f, app.db.sessions)
          : startCycle(f, { label: m.label, resetCashback: !!m.reset });
      app.db.settings.finance = res.finance;
      if (save()) {
        app.ui.modal = null;
        app.ui.rankCycle = null;
        toast(res.message, 'ok', 6000);
      }
    } catch (e) {
      m.error = e.message;
      render();
    }
  },
  'reset-open': () => openModal('reset', { confirm: '' }),
  // RN-131: acerto da festa por período (registro para a tesouraria conferir; não altera o cashback)
  'party-settle': (d) => {
    const name = app.db.players.find((p) => p.id === d.pid)?.name || d.name || 'o atleta';
    openModal('confirm', {
      title: 'Registrar acerto da festa',
      text: `Registrar que a festa de ${name} (cashback desde ${d.label}: ${formatMoney(Number(d.cents) || 0)}) foi acertada? Fica guardado com a data de hoje.`,
      okText: 'Registrar',
      onOk: () => {
        closeModal();
        updateFinance((f) => settleParty(f, { pid: d.pid, name, periodKey: d.key, cents: Number(d.cents) || 0 }));
      },
    });
  },
  'party-unsettle': (d) => openModal('confirm', {
    title: 'Desfazer acerto da festa',
    text: 'Apagar o registro de acerto da festa deste período? O cashback não muda.',
    okText: 'Desfazer',
    danger: true,
    onOk: () => {
      closeModal();
      updateFinance((f) => unsettleParty(f, d.id), 'Registro de acerto apagado.');
    },
  }),
  'reset-ok': () => {
    const m = app.ui.modal;
    try {
      // RN-132: a palavra (ZERAR no teste, APAGAR TUDO no oficial), a pelada ao vivo e o rascunho são conferidos no domínio.
      const r = resetCycle({ sessions: app.db.sessions, finance: financeSettings(app.db.settings), confirm: m.confirm });
      for (const s of app.db.sessions) store.clearUndo(s.id);
      app.db.sessions = r.sessions;
      app.db.activeSessionId = null;
      app.db.setup = null;
      app.db.settings.finance = r.finance;
      if (save()) {
        app.ui.modal = null;
        app.ui.paySid = null;
        toast(`Lançamentos zerados: ${r.removed.peladas} pelada(s) e ${r.removed.contributions} aporte(s). Ciclo oficial iniciado.`, 'ok', 7000);
        navigate('/caixa');
      }
    } catch (e) {
      m.error = e.message;
      render();
    }
  },
};

async function copy(text, okText = 'Texto copiado.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okText, 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? okText : 'Não foi possível copiar.', ok ? 'ok' : 'error');
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
    const { draw, snapshots, config, gkOrder } = prepareDraw({
      players: app.db.players, selectedIds: st.selected, config: st.config, settings: app.db.settings, gkOrder: st.gkOrder || [],
    });
    const ms = Math.round(performance.now() - t0);
    // RN-139: o que foi marcado na chamada vai para a pelada (só linha presente); o que a pelada já tinha prevalece.
    const payments = drawPayments(snapshots, st.payments || {}, current?.status === 'draft' ? current.payments || {} : {});
    if (current && current.status === 'draft') {
      const next = redraw(current, { draw, config, snapshots, gkOrder, payments });
      next.title = title;
      store.pushUndo(current.id, 'Sorteio', current);
      replaceSession(next);
    } else {
      const s = createSession({ title, config, snapshots, draw, gkOrder, scheduledAt: st.scheduled || null, payments });
      app.db.sessions.push(s);
      app.db.activeSessionId = s.id;
    }
    st.payments = {};
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
  // região tocada (para manter o item parado sob o dedo na atualização local)
  const region = el.closest('[data-patch]');
  app.ui._anchor = region ? { id: region.id } : null;
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
  } else if (key === 'fsearch') {
    app.ui.financeQuery = el.value;
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
    case 'share-opt': {
      const m = app.ui.modal;
      m.opts[el.dataset.k] = el.checked;
      m.text = shareText(activeSession(), m.opts);
      break;
    }
    case 'pix-qr': {
      const file = el.files[0];
      el.value = '';
      if (!file || app.ui.modal?.type !== 'pixEdit') return;
      try {
        app.ui.modal.qrImage = await readQrImage(file);
        app.ui.modal.error = '';
      } catch (e) {
        app.ui.modal.error = e.message;
      }
      render();
      return;
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
