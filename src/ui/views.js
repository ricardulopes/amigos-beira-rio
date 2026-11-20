// Telas (somente apresentação). Ações são disparadas por data-act e tratadas em app.js.
import { app, activeSession, setupState, adminActive } from './state.js';
import { esc, fmt, stars, roleBadge, positionsBadges, icon, posBadge, vestIcon, vestTag } from './dom.js';
import { cloud, adminUntil } from '../cloud/sync.js';
import {
  filterPlayers, ROLE_NAMES, REMOVAL_REASONS, STAR_VALUES, LIMITS, planParticipation, toleranceInfo, defaultTitle as domainDefaultTitle,
  ADMIN_ACTIONS, PUBLIC_ACTIONS, allTeamsInOrder, queueLabel, teamStats, isComplete, linePositions, playerStats, balanceSummary, gamesSummary, teamExitGroups, drawHint, advantageStatus,
  vestOf, vestName, incomingVest,
  financeSettings, cyclesAvailable, cycleRanking, cycleList, NEXT_CYCLE, statement, paymentSummary, formatMoney, PAYMENT_METHODS, FINANCE_RULES,
  groupCashback, closedCycleOf, reopenInfo, financeAthletes,
} from '../domain/index.js';

export const CLUB_NAME = 'Amigos Beira Rio';
const CREST = 'img/escudo-abr.png';

// ------------------------------------------------------------------ layout

export function header(title, { back = null, right = '' } = {}) {
  return `<header class="topbar">
    ${back ? `<button class="icon-btn" data-act="go" data-to="${back}" aria-label="Voltar">‹</button>` : `<img class="brand-logo" src="${CREST}" alt="Escudo ABR">`}
    <h1>${esc(title)}</h1>
    <div class="topbar-right">${right}</div>
  </header>${cloudBar()}`;
}

export function tabbar() {
  const s = activeSession();
  const r = app.ui.route;
  const tab = (to, ic, label, extra = '') =>
    `<a href="#${to}" class="tab ${r === to || (to !== '/' && r.startsWith(to)) ? 'on' : ''}">${icon(ic)}<span>${label}</span>${extra}</a>`;
  return `<nav class="tabbar">
    ${tab('/', 'home', 'Início')}
    ${tab('/jogadores', 'users', 'Jogadores')}
    ${tab(s ? '/partida' : '/nova', 'ball', 'Pelada', s && s.status === 'live' ? '<i class="live-dot"></i>' : '')}
    ${tab('/caixa', 'coin', 'Caixa')}
    ${tab('/historico', 'clock', 'Histórico')}
    ${tab('/ajustes', 'gear', 'Ajustes')}
  </nav>`;
}

// ------------------------------------------------------------------ início

export function homeView() {
  const s = activeSession();
  const db = app.db;
  const lines = db.players.filter((p) => p.type === 'line').length;
  const gks = db.players.length - lines;
  const finished = db.sessions.filter((x) => x.status === 'finished');
  let current = '';
  if (s) {
    const field = s.field.map((id) => `${vestIcon(vestOf(s, id), 'sm')} ${esc(s.teams[id].label)}`).join(' <span>x</span> ');
    current = `<a class="card hero-card" href="#/partida">
      <div class="eyebrow">${s.status === 'live' ? '● AO VIVO' : 'SORTEIO PRONTO'}</div>
      <div class="hero-title">${esc(s.title)}</div>
      <div class="muted vest-match">${s.status === 'live' ? `Jogo ${s.games.length + 1}: ${field}` : `${Object.keys(s.teams).length} equipes sorteadas — toque para revisar e iniciar`}</div>
      <div class="hero-cta">${s.status === 'live' ? 'Abrir partida ›' : 'Ver sorteio ›'}</div>
    </a>`;
  }
  return `${header(CLUB_NAME)}
  <main class="page">
    <section class="welcome">
      <img class="crest" src="${CREST}" alt="Escudo da ABR — Amigos Beira Rio">
      <div class="club">
        <b>ABR<br>Amigos Beira Rio</b>
        <span class="since">DESDE 2008</span>
        <p>Cadastro, sorteio equilibrado, coletes e controle da pelada em tempo real.</p>
      </div>
    </section>
    ${current}
    <div class="grid2">
      <a class="tile" href="#/nova"><b>${s ? 'Novo sorteio' : 'Nova pelada'}</b><span>Selecionar presentes e sortear</span></a>
      <a class="tile" href="#/jogadores"><b>${db.players.length}</b><span>jogadores cadastrados (${lines} linha · ${gks} goleiros)</span></a>
      <a class="tile" href="#/historico"><b>${finished.length}</b><span>peladas no histórico</span></a>
      <a class="tile" href="#/ajustes"><b>Backup</b><span>Exportar / importar dados</span></a>
      <a class="tile" href="#/caixa" data-act="ftab" data-tab="ranking"><b>🏆 Ranking</b><span>Presenças, extrato e cashback</span></a>
      <button class="tile" data-act="pix-open"><b>💠 Pix</b><span>Chave e QR Code da tesouraria</span></button>
    </div>
    ${db.players.length === 0 ? `<div class="card empty"><b>Comece cadastrando os jogadores.</b><p>Cada jogador tem nome, estrelas (1 a 3) e posições. Goleiros ficam numa categoria separada.</p><button class="btn primary" data-act="player-new">Cadastrar primeiro jogador</button></div>` : ''}
  </main>`;
}

// ------------------------------------------------------------------ jogadores

export function playersView() {
  const f = app.ui.playerFilter;
  const list = filterPlayers(app.db.players, f);
  const chip = (key, val, text) => `<button class="chip ${f[key] === val ? 'on' : ''}" data-act="pfilter" data-key="${key}" data-value="${val}">${text}</button>`;
  const admin = adminActive();
  const lock = `<button class="btn small admin-chip ${admin ? 'on' : ''}" data-act="admin-toggle" aria-label="${admin ? 'Bloquear modo administrador' : 'Entrar no modo administrador'}">${admin ? '🔓' : '🔒'}</button>`;
  return `${header('Jogadores', { right: `${lock}<button class="btn small primary" data-act="player-new">+ Novo</button>` })}
  <main class="page">
    <input id="psearch" class="search" type="search" placeholder="Pesquisar pelo nome" value="${esc(f.query)}" data-input="psearch" autocomplete="off">
    <div class="filters">
      <div class="chips">${chip('type', '', 'Todos')}${chip('type', 'line', 'Linha')}${chip('type', 'gk', 'Goleiros')}</div>
      <div class="chips">${chip('position', 'D', 'Defesa')}${chip('position', 'M', 'Meio')}${chip('position', 'A', 'Ataque')}</div>
      <div class="chips stars-row">${chip('stars', '', 'Todas')}${STAR_VALUES.map((v) => chip('stars', String(v), `${fmt(v)}★`)).join('')}</div>
    </div>
    <div class="muted small">${list.length} de ${app.db.players.length} jogador(es)</div>
    <ul class="list">
      ${list.map((p) => `<li class="row" data-act="player-edit" data-id="${p.id}">
          <div class="avatar ${p.type === 'gk' ? 'gk' : ''}">${p.type === 'gk' ? '🧤' : esc(p.name[0])}</div>
          <div class="grow"><div class="name">${esc(p.name)}</div><div class="badges">${positionsBadges(p)}</div></div>
          ${stars(p.stars)}
        </li>`).join('') || '<li class="empty-row">Nenhum jogador encontrado.</li>'}
    </ul>
    ${admin ? '<button class="btn ghost wide" data-act="open-roster">⬆ Importar lista de atletas</button>' : ''}
    <p class="muted small center">${admin ? '🔓 Administrador: toque num jogador para editar.' : '👀 Toque num jogador para ver a ficha. Cadastro, estrelas e posições: só administradores 🔒.'}</p>
  </main>`;
}

// ------------------------------------------------------------------ nova pelada / seleção

export function setupView() {
  const st = setupState();
  const sel = new Set(st.selected.filter((id) => app.db.players.some((p) => p.id === id)));
  const players = filterPlayers(app.db.players, { query: app.ui.setupQuery });
  const n = st.config.linePerTeam;
  const plan = planParticipation(app.db.players, [...sel], st.config);
  const { lineCount: nLine, gkCount: nGk, total, teamCount, fullCount: full, remainder: rem, goalkeeperNote: gkText } = plan;
  const s = activeSession();
  const tol = app.db.settings.toleranceMin;
  const ti = toleranceInfo(st.scheduled, tol);
  const tolText = ti
    ? `Sorteio recomendado a partir de <b>${ti.drawAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b> (tolerância de ${tol} min)${ti.released ? ' — liberado' : ` — faltam ${ti.minutesLeft} min`}.`
    : '';
  const blocked = s && s.status === 'live';
  return `${header(s && s.status === 'draft' ? 'Refazer sorteio' : 'Nova pelada', { back: s ? '/partida' : '/' })}
  <main class="page with-cta">
    ${blocked ? `<div class="alert warn">Há uma pelada em andamento. Encerre-a na tela da partida antes de sortear uma nova.</div>` : ''}
    <section class="card">
      <label class="field"><span>Nome da pelada</span><input id="stitle" data-input="stitle" value="${esc(st.title)}" placeholder="${esc(defaultTitle())}"></label>
      <div class="field-row">
        <label class="field"><span>Horário combinado</span><input id="ssched" type="time" data-input="ssched" value="${esc(st.scheduled)}"></label>
        <div class="field"><span>Linha por time</span>
          <div class="stepper">
            <button data-act="setup-n" data-d="-1" ${n <= LIMITS.linePerTeam.min ? 'disabled' : ''} aria-label="Menos">−</button>
            <b>${n}</b>
            <button data-act="setup-n" data-d="1" ${n >= LIMITS.linePerTeam.max ? 'disabled' : ''} aria-label="Mais">+</button>
          </div>
        </div>
      </div>
      ${tolText ? `<p class="muted small">${tolText}</p>` : ''}
      <label class="switch"><input type="checkbox" data-change="setup-gk" ${st.config.useGoalkeepers ? 'checked' : ''}><span>Sortear com goleiros</span></label>
      <label class="switch ${st.config.useGoalkeepers ? '' : 'disabled'}"><input type="checkbox" data-change="setup-reqgk" ${st.config.requireGkForComplete ? 'checked' : ''} ${st.config.useGoalkeepers ? '' : 'disabled'}><span>Equipe só é completa com goleiro</span></label>
    </section>

    <section class="counters">
      <div><b>${nLine}</b><span>linha</span></div>
      <div><b>${nGk}</b><span>goleiros</span></div>
      <div><b>${total}</b><span>total</span></div>
      <div><b>${teamCount}</b><span>equipes</span></div>
    </section>
    <p class="plan-text">${nLine ? `${full} equipe(s) completa(s) de ${n}${rem ? ` + 1 em formação com ${rem}` : ''}.` : 'Marque os jogadores presentes.'} ${gkText}</p>

    <div class="list-head">
      <input id="ssearch" class="search" type="search" placeholder="Buscar presente" value="${esc(app.ui.setupQuery)}" data-input="ssearch" autocomplete="off">
      <button class="btn small ghost" data-act="setup-all">Todos</button>
      <button class="btn small ghost" data-act="setup-none">Limpar</button>
    </div>
    <ul class="list check-list">
      ${players.map((p) => `<li class="row ${sel.has(p.id) ? 'checked' : ''}" data-act="setup-toggle" data-id="${p.id}">
          <span class="check" role="checkbox" aria-checked="${sel.has(p.id)}"></span>
          <div class="grow"><div class="name">${esc(p.name)} ${p.type === 'gk' ? '<span class="gk-tag">🧤 Goleiro</span>' : ''}</div><div class="badges">${positionsBadges(p)}</div></div>
          ${stars(p.stars)}
        </li>`).join('') || `<li class="empty-row">Nenhum jogador. <button class="btn small" data-act="player-new" data-select="1">Cadastrar</button></li>`}
    </ul>
    <button class="btn ghost wide" data-act="player-new" data-select="1">+ Cadastrar jogador e marcar presença</button>
  </main>
  <div class="cta-bar"><button class="btn primary big wide" data-act="do-draw" ${!nLine || blocked ? 'disabled' : ''}>SORTEAR ${teamCount ? `${teamCount} EQUIPES` : ''}</button></div>`;
}

export function defaultTitle() {
  return domainDefaultTitle(app.db.settings.groupName);
}

// ------------------------------------------------------------------ componentes de equipe

/** Linhas dos jogadores de linha: topo (posição N) em cima, base (posição 1) embaixo; invertido ao contrário. */
function positionedRows(s, team, render) {
  const rows = linePositions(team).map((x) => render(s.snapshot[x.pid], x)); // posição 1 primeiro
  return app.ui.inverted ? rows : rows.reverse();
}

function playerRow(p, x, highlight) {
  return `<li class="prow">
    ${posBadge(x.position, highlight)}
    <span class="pname">${esc(p.name)}</span>
    ${roleBadge(x.role)}
    ${stars(p.stars, 'sm')}
  </li>`;
}

const PERM_PILLS = {
  defending: '<span class="pill perm">🛡 defende</span>',
  challenger: '<span class="pill chall">desafiante*</span>',
  none: '<span class="pill">sem vantagem</span>',
};

function permPill(s, team) {
  return PERM_PILLS[advantageStatus(s, team.id)] || '';
}

export function teamCard(s, team, { compact = false, dense = false, showOrder = true, actions = '' } = {}) {
  const st = teamStats(s, team);
  const tag = queueLabel(s, team.id);
  const n = s.config.linePerTeam;
  const rows = positionedRows(s, team, (p, x) => playerRow(p, x, showOrder));
  const gks = team.gks.map((g) => `<li class="prow gkrow"><span class="ord">🧤</span><span class="pname">${esc(s.snapshot[g].name)}</span><span class="role role-G">GOL</span>${stars(s.snapshot[g].stars, 'sm')}</li>`).join('');
  const noGk = s.config.useGoalkeepers && !team.gks.length ? `<li class="prow gkrow missing"><span class="ord">🧤</span><span class="pname">sem goleiro</span></li>` : '';
  const perm = permPill(s, team);
  if (dense) {
    const letter = { D: 'D', M: 'M', A: 'A' };
    const drows = positionedRows(
      s,
      team,
      (p, x) =>
        `<li class="prow">${posBadge(x.position)}<span class="rl role-${x.role}" title="${ROLE_NAMES[x.role] || ''}">${letter[x.role] || '?'}</span><span class="pname">${esc(p.name)}</span><span class="nst">${fmt(p.stars)}</span></li>`,
    );
    const dg = team.gks.map((g) => `<li class="prow gkrow"><span class="ord">🧤</span><span class="rl role-G">G</span><span class="pname">${esc(s.snapshot[g].name)}</span><span class="nst">${fmt(s.snapshot[g].stars)}</span></li>`).join('');
    const v = vestOf(s, team.id);
    return `<article class="team dense onfield ${v ? `v-${v}` : ''} ${st.complete ? '' : 'incomplete'}">
      <span class="vest-caption">Colete ${esc(vestName(v))}</span>
      <header>${vestIcon(v, 'lg')}<b class="tname">${esc(team.label)}</b><span class="tsum">${fmt(st.sum)}★</span></header>
      <div class="tmeta">${perm}<span class="${st.complete ? 'ok' : 'warn'}">${st.size}/${n}</span><span>${st.counts.D}-${st.counts.M}-${st.counts.A}</span></div>
      <ul class="plist">${dg}${noGk}${drows.join('')}</ul>
    </article>`;
  }
  // Colete: equipes em campo mostram a cor; a PRO mostra o colete dupla-face até o resultado definir a cor.
  const v = vestOf(s, team.id);
  const inc = incomingVest(s, team.id);
  const vest = v ? vestTag(v) : inc ? vestTag(inc.vest, inc.text) : '';
  return `<article class="team ${tag === 'EM JOGO' ? 'onfield' : ''} ${v ? `v-${v}` : ''} ${st.complete ? '' : 'incomplete'}">
    <header>
      <span class="qtag q-${tag.replace('º', '')}">${tag}</span>
      <b class="tname">${esc(team.label)}</b>
      ${vest}
      ${team.note ? `<small class="muted">${esc(team.note)}</small>` : ''}
      <span class="tsum">${fmt(st.sum)}★</span>
    </header>
    <div class="tmeta">
      <span class="${st.complete ? 'ok' : 'warn'}">${st.size}/${n}${st.complete ? ' completo' : ' em formação'}</span>
      <span>Média ${fmt(st.avg.toFixed(2))}</span>
      <span title="Defesa-Meio-Ataque">${st.counts.D}-${st.counts.M}-${st.counts.A}</span>
      ${perm}
    </div>
    ${compact ? '' : `<ul class="plist">${gks}${noGk}${rows.join('')}</ul>`}
    ${compact ? `<div class="mini-names">${linePositions(team).map((x) => `<b>${x.position}</b> ${esc(s.snapshot[x.pid].name)}`).join(' · ')}${team.gks.length ? ` · 🧤 ${team.gks.map((g) => esc(s.snapshot[g].name)).join(', ')}` : ''}</div>` : ''}
    ${!compact && showOrder && app.ui.showExits ? exitSummary(s, team) : ''}
    ${actions}
  </article>`;
}

function exitSummary(s, team) {
  const groups = teamExitGroups(s, team);
  if (!groups.length) return '';
  return `<div class="exits">${groups
    .map((g) => `<span>${g.k === 1 ? 'Sai a pos. 1' : `Saem pos. 1–${g.k}`}: <b>${fmt(g.sum)}★</b> <small>(${g.roles.map((r) => (r ? r : '?')).join('/')})</small></span>`)
    .join('')}</div>`;
}

// ------------------------------------------------------------------ resultado do sorteio (rascunho)

export function draftView(s) {
  const teams = allTeamsInOrder(s);
  const sum = balanceSummary(s);
  const noGk = sum.withoutGk;
  return `${header('Resultado do sorteio', { back: '/', right: `<button class="btn small ghost" data-act="toggle-invert">${app.ui.inverted ? '⇅ Ordem real' : '⇅ Inverter'}</button>` })}
  <main class="page with-cta">
    <section class="card summary">
      <div class="sum-grid">
        <div><b>${sum.teamCount}</b><span>equipes</span></div>
        <div><b>${fmt(sum.fullRange)}★</b><span>dif. entre completos</span></div>
        <div><b>${fmt(sum.median)}</b><span>mediana do grupo</span></div>
        <div><b>${sum.outOfFormation}</b><span>fora da formação</span></div>
      </div>
      ${sum.forming ? `<p class="small forming-line">Em formação (${esc(sum.forming.label)}, ${sum.forming.size} atleta(s)): <b>${fmt(sum.forming.sum)}★</b> · alvo <b>${fmt(sum.forming.target)}★</b>
        <span class="muted">= ${fmt(sum.forming.mTime)}★ dos completos − ${sum.forming.missing} vaga(s) × ${fmt(sum.forming.mAthlete.toFixed(2))}★ de média</span></p>` : ''}
      ${noGk.length ? `<div class="alert warn small">Sem goleiro: ${noGk.map(esc).join(', ')}.</div>` : ''}
      ${s.bench.length ? `<div class="alert small">Goleiros fora do sorteio: ${s.bench.map((g) => esc(s.snapshot[g].name)).join(', ')}.</div>` : ''}
      <p class="muted small">Posições numeradas de baixo para cima: a <span class="ord pos e1">1</span> é a base e sai primeiro se o time perder; quem chega ocupa a próxima posição livre acima. As duas primeiras equipes começam — a 1ª de colete <b>Amarelo</b> e a 2ª de <b>Azul</b>; as demais formam a fila.</p>
    </section>
    <div class="actions-row scroll-x">
      <button class="btn" data-act="redraw">🎲 Novo sorteio</button>
      <button class="btn" data-act="go" data-to="/nova">⚙️ Participantes / config.</button>
      <button class="btn" data-act="open-order">↕ Editar ordem</button>
      <button class="btn" data-act="open-swap">⇄ Trocar jogadores</button>
      <button class="btn" data-act="open-gk">🧤 Goleiros</button>
      <button class="btn" data-act="open-transfer">Simular transferência</button>
      <button class="btn" data-act="open-late">+ Atrasado</button>
      <button class="btn" data-act="share">Compartilhar</button>
      <button class="btn" data-act="go-caixa">💰 Pagamentos</button>
      <button class="btn danger-ghost" data-act="discard-draft">Descartar</button>
    </div>
    ${teams.map((t) => teamCard(s, t)).join('')}
  </main>
  <div class="cta-bar"><button class="btn primary big wide" data-act="start" ${s.field.length < 2 ? 'disabled' : ''}>▶ INICIAR PELADA</button></div>`;
}

// ------------------------------------------------------------------ partida em andamento

export function liveView(s) {
  const [a, b] = s.field.map((id) => s.teams[id]);
  const queue = s.queue.map((id) => s.teams[id]);
  const last = s.games[s.games.length - 1];
  const exp = app.ui.lastExplanation && app.ui.lastExplanation.sid === s.id ? app.ui.lastExplanation : null;
  return `${header(s.title, { back: '/', right: `<button class="btn small ghost" data-act="toggle-invert" title="Inverter visualização da ordem">⇅</button>` })}
  <main class="page live">
    <div class="game-head"><span class="live-pill">● Jogo ${s.games.length + 1}</span><span class="muted small">${s.games.length} jogo(s) registrados · ${s.active.length} participantes</span></div>
    ${exp ? `<div class="alert info small explain"><b>Último resultado:</b> ${esc(exp.text)} <button class="link" data-act="dismiss-exp">ok</button></div>` : ''}
    ${a && b ? `<div class="result-bar sticky-result">
        <button class="btn win v-${vestOf(s, a.id)}" data-act="result" data-r="A">Vitória<br><b>${vestIcon(vestOf(s, a.id), 'sm')}${esc(a.label)}</b></button>
        <button class="btn draw" data-act="result" data-r="draw">Empate</button>
        <button class="btn win v-${vestOf(s, b.id)}" data-act="result" data-r="B">Vitória<br><b>${vestIcon(vestOf(s, b.id), 'sm')}${esc(b.label)}</b></button>
      </div>
      <section class="field">
      <div class="vs">
        ${teamCard(s, a, { dense: true })}
        ${teamCard(s, b, { dense: true })}
      </div>
      <p class="muted tiny">${esc(drawHint(s))}</p>
    </section>` : `<div class="alert warn">É preciso ter duas equipes para jogar. Adicione atrasados ou faça transferências.</div>`}
    <div class="quick">
      <button class="qbtn" data-act="open-late"><span>➕</span>Atrasado</button>
      <button class="qbtn" data-act="open-remove"><span>🚑</span>Retirar</button>
      <button class="qbtn" data-act="open-transfer"><span>⇆</span>Transferir</button>
      <button class="qbtn" data-act="open-order"><span>↕</span>Ordem</button>
      <button class="qbtn" data-act="undo"><span>↶</span>Desfazer</button>
      <button class="qbtn" data-act="share"><span>📤</span>Compartilhar</button>
      <button class="qbtn" data-act="open-log"><span>📋</span>Registro</button>
      <button class="qbtn" data-act="open-more"><span>⋯</span>Mais</button>
    </div>
    <h2 class="section-title">Fila <small>(${queue.filter((t) => isComplete(s, t)).length} completo(s) aguardando)</small></h2>
    ${queue.length ? queue.map((t, i) => teamCard(s, t, { compact: i > 2 && !app.ui.expandQueue })).join('') : '<p class="muted">Nenhuma equipe aguardando.</p>'}
    ${queue.length > 3 ? `<button class="btn ghost wide" data-act="toggle-queue">${app.ui.expandQueue ? 'Recolher fila' : 'Expandir toda a fila'}</button>` : ''}
    ${last ? `<h2 class="section-title">Último jogo</h2><div class="card small">${gameLine(last)}</div>` : ''}
    <button class="btn danger-ghost wide" data-act="finish">Encerrar pelada</button>
  </main>`;
}

export function gameLine(g) {
  const r = g.result === 'draw' ? 'Empate' : `Vitória ${g.result === 'A' ? g.teamA.label : g.teamB.label}`;
  const v = (t) => (t.vest ? vestIcon(t.vest, 'sm') : '');
  return `<div class="gline"><b>Jogo ${g.n}</b> · ${v(g.teamA)}${esc(g.teamA.label)} x ${v(g.teamB)}${esc(g.teamB.label)} — <b>${esc(r)}</b>${g.toss ? ' (par ou ímpar)' : ''}
    <div class="muted small">${esc(g.explanation)}</div>
    ${g.moves?.length ? `<ul class="moves">${g.moves.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div>`;
}

// ------------------------------------------------------------------ histórico

export function historyView() {
  const list = app.db.sessions.filter((s) => s.status !== 'draft').slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `${header('Histórico')}
  <main class="page">
    ${list.length ? '' : '<div class="card empty">Nenhuma pelada registrada ainda.</div>'}
    <ul class="list">
      ${list.map((s) => `<li class="row" data-act="go" data-to="/historico/${s.id}">
        <div class="grow"><div class="name">${esc(s.title)} ${s.status === 'live' ? '<span class="pill live">ao vivo</span>' : ''}</div>
        <div class="muted small">${new Date(s.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${s.games.length} jogos · ${Object.keys(s.snapshot).length} participantes</div></div>
        <span class="chev">›</span></li>`).join('')}
    </ul>
  </main>`;
}

export function historyDetailView(id) {
  const s = app.db.sessions.find((x) => x.id === id);
  if (!s) return `${header('Histórico', { back: '/historico' })}<main class="page"><p>Pelada não encontrada.</p></main>`;
  const tab = app.ui.historyTab;
  const t = (k, l) => `<button class="chip ${tab === k ? 'on' : ''}" data-act="htab" data-tab="${k}">${l}</button>`;
  let body = '';
  if (tab === 'games') {
    const gs = gamesSummary(s);
    body = `<p class="muted small">${gs.games} jogos · ${gs.wins} vitórias · ${gs.draws} empates</p>` + (s.games.map((g) => `<div class="card small">${gameLine(g)}</div>`).join('') || '<p class="muted">Nenhum jogo registrado.</p>');
  } else if (tab === 'draw') {
    const d = s.draws[0];
    body = d
      ? d.teams.map((t) => `<div class="card small"><b>${esc(t.label)}</b>${t.gks.length ? ` · 🧤 ${t.gks.map((g) => esc(s.snapshot[g]?.name)).join(', ')}` : ''}<ul class="plist">${linePositions(t)
          .reverse()
          .map((x) => `<li class="prow">${posBadge(x.position)}<span class="pname">${esc(s.snapshot[x.pid]?.name)}</span> ${roleBadge(x.role)} ${stars(s.snapshot[x.pid]?.stars || 0, 'sm')}</li>`)
          .join('')}</ul></div>`).join('') + `<p class="muted small">Sorteios realizados antes do início: ${s.draws.length}.</p>`
      : '';
  } else if (tab === 'log') {
    body = `<ol class="log">${s.log.map((l) => `<li><time>${new Date(l.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time> ${esc(l.text)}</li>`).join('')}</ol>`;
  } else if (tab === 'players') {
    const st = playerStats(s);
    body = `<table class="tbl"><thead><tr><th>Jogador</th><th>J</th><th>V</th><th>E</th><th>D</th></tr></thead><tbody>${st
      .map((x) => `<tr><td>${esc(x.name)}</td><td>${x.games}</td><td>${x.wins}</td><td>${x.draws}</td><td>${x.losses}</td></tr>`)
      .join('')}</tbody></table>`;
  } else if (tab === 'people') {
    const ps = Object.values(s.snapshot).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const late = Object.fromEntries(s.arrivals.map((a) => [a.pid, a.order]));
    const removed = Object.fromEntries(s.removed.map((r) => [r.pid, r]));
    body = `<p class="muted small">Dados como estavam no momento da pelada (alterações posteriores no cadastro não afetam este registro).</p>
    <p class="small">Configuração: ${s.config.linePerTeam} na linha · ${s.config.useGoalkeepers ? 'com goleiros' : 'sem goleiros'}${s.config.requireGkForComplete ? ' · goleiro obrigatório' : ''}</p>
    <ul class="list">${ps.map((p) => `<li class="row"><div class="grow"><div class="name">${esc(p.name)}</div><div class="badges">${positionsBadges(p)}
      ${late[p.id] ? `<span class="pill">${late[p.id]}º atrasado</span>` : ''}
      ${removed[p.id] ? `<span class="pill warn">${esc(REMOVAL_REASONS[removed[p.id].reason] || '')}</span>` : ''}</div></div>${stars(p.stars)}</li>`).join('')}</ul>`;
  }
  return `${header(s.title, { back: '/historico' })}
  <main class="page">
    <p class="muted small">${new Date(s.createdAt).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}${s.finishedAt ? ` · encerrada às ${new Date(s.finishedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
    <div class="chips scroll-x">${t('games', 'Jogos')}${t('draw', 'Sorteio')}${t('log', 'Movimentações')}${t('players', 'Desempenho')}${t('people', 'Participantes')}</div>
    ${body}
    ${s.status === 'finished' ? `<button class="btn danger-ghost wide" data-act="delete-session" data-id="${s.id}">Excluir do histórico</button>` : ''}
  </main>`;
}

// ------------------------------------------------------------------ caixa: ranking, extrato, Pix, pagamentos, aportes (RN-118 a RN-127)

const dateShort = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

export function financeView() {
  const admin = adminActive();
  const f = financeSettings(app.db.settings);
  let tab = app.ui.financeTab || 'ranking';
  if (!admin && (tab === 'caixa' || tab === 'aportes')) tab = 'ranking';
  const t = (k, l) => `<button class="chip ${tab === k ? 'on' : ''}" data-act="ftab" data-tab="${k}">${l}</button>`;
  const lock = `<button class="btn small admin-chip ${admin ? 'on' : ''}" data-act="admin-toggle" aria-label="${admin ? 'Bloquear modo administrador' : 'Entrar no modo administrador'}">${admin ? '🔓' : '🔒'}</button>`;
  const body = { extrato: statementTab, pix: pixTab, caixa: cashTab, aportes: contributionsTab }[tab] || rankingTab;
  return `${header('Caixa e ranking', { right: lock })}
  <main class="page">
    ${f.mode === 'test' ? '<div class="alert warn small">🧪 Modo teste: presenças, pagamentos e aportes já valem para conferir, mas serão zerados antes do ciclo oficial.</div>' : ''}
    <div class="chips scroll-x">${t('ranking', '🏆 Ranking')}${t('extrato', '📄 Extrato')}${t('pix', '💠 Pix')}${admin ? t('caixa', '💰 Caixa do dia') + t('aportes', '➕ Aportes') : ''}</div>
    ${body(f, admin)}
  </main>`;
}

/** "desde 05/01/27 · encerrado em 20/11/26" (ou "em andamento"). */
function cyclePeriod(c) {
  if (c.pending) return 'peladas feitas depois do último encerramento; entram no próximo ciclo quando ele for iniciado';
  const from = c.start ? `desde ${dateShort(c.start)}` : 'desde o início';
  return `${from} · ${c.end ? `encerrado em ${dateShort(c.end)}` : 'em andamento'}`;
}

function rankingTab(f) {
  const cycles = cyclesAvailable(app.db.sessions, f);
  // Padrão: o ciclo aberto; na folga, o último encerrado (o do sorteio do campeonato).
  const cyc = cycles.find((x) => x.id === app.ui.rankCycle) || cycles.find((x) => x.open) || cycles.find((x) => !x.pending);
  const type = app.ui.rankType === 'gk' ? 'gk' : 'line';
  const r = cycleRanking(app.db.sessions, f, cyc.id, type);
  const seg = `<div class="seg"><button class="${type === 'line' ? 'on' : ''}" data-act="frank" data-v="line">Ranking de Linha</button><button class="${type === 'gk' ? 'on' : ''}" data-act="frank" data-v="gk">🧤 Goleiros</button></div>`;
  const semChips = cycles.length > 1
    ? `<div class="chips scroll-x">${cycles.map((x) => `<button class="chip ${x.id === cyc.id ? 'on' : ''}" data-act="fsem" data-v="${esc(x.id)}">${x.pending ? '⏳ Próximo' : esc(x.label)}${x.open ? ' ●' : ''}</button>`).join('')}</div>`
    : '';
  const rows = [];
  r.rows.forEach((x, i) => {
    if (i === r.top) rows.push(`<tr class="cut"><td colspan="4">✂ Linha de corte — Top ${r.top} com vaga prioritária no campeonato</td></tr>`);
    rows.push(`<tr class="${x.qualified ? 'q' : ''}" data-act="stmt-pick" data-id="${esc(x.pid)}"><td class="num">${x.position}º</td><td>${esc(x.name)}</td><td class="num">${x.count}</td><td class="num">${x.pct}%</td></tr>`);
  });
  return `${seg}${semChips}
    <p class="small rank-head"><b>${esc(cyc.pending ? 'Próximo ciclo' : cyc.label)}</b> · ${cyclePeriod(cyc)}.<br><b>${r.total}</b> jogo(s) realizados · <b>Top ${r.top}</b> ${type === 'gk' ? 'goleiros' : 'de linha'} com vaga prioritária.</p>
    ${!cycles.some((x) => x.open) ? `<p class="alert warn small">${cyc.pending
    ? 'Estas peladas foram feitas na folga e entram no próximo ciclo quando um administrador iniciá-lo.'
    : 'Ciclo encerrado: este ranking está fechado para o sorteio do campeonato. Um administrador inicia o próximo ciclo em Ajustes → Financeiro e Pix.'}</p>` : ''}
    ${r.frozen ? `<p class="small muted">🔒 Ranking guardado no encerramento (${dateShort(r.cycle.frozen.at)}): não muda mais.</p>` : ''}
    ${r.rows.length
    ? `<table class="tbl rank"><thead><tr><th class="num">#</th><th>Atleta</th><th class="num">Jogos</th><th class="num">%</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<div class="card empty">Nenhuma presença neste ciclo ainda. Contam as peladas iniciadas no app.</div>'}
    ${r.cutTie ? `<p class="alert warn small">Empate na linha de corte: o ${r.top}º e o ${r.top + 1}º têm o mesmo número de jogos (ordem alfabética só para exibir).</p>` : ''}
    <p class="muted small">% = presenças ÷ jogos realizados no ciclo. O ranking recomeça quando um administrador inicia um novo ciclo; os ciclos encerrados continuam aqui para consulta. Toque num atleta para ver o extrato.</p>`;
}

/** Situação da festa num período + botão do admin para registrar/desfazer o acerto (RN-131). */
function partyLine(pid, c, admin) {
  const done = c.settlement;
  const state = done
    ? `✅ Acerto registrado em ${dateShort(done.at)}${done.note ? ` · ${esc(done.note)}` : ''}`
    : c.partyPaid ? 'quitada com o cashback' : `faltava ${formatMoney(c.partyRemaining)}`;
  const btn = !admin ? ''
    : done ? `<button class="btn small ghost" data-act="party-unsettle" data-id="${esc(done.id)}">Desfazer acerto</button>`
      : `<button class="btn small" data-act="party-settle" data-pid="${esc(pid)}" data-key="${esc(c.periodKey)}" data-cents="${c.total}" data-label="${esc(c.sinceLabel)}">Registrar acerto</button>`;
  return `<li><div>Desde ${esc(c.sinceLabel)}: cashback <b>${formatMoney(c.total)}</b> — ${state}</div>${btn}</li>`;
}

function statementTab(f) {
  const pid = app.ui.stmtPid;
  const athletes = financeAthletes(app.db.players, app.db.sessions, f);
  const known = new Map(athletes.map((x) => [x.id, x.name]));
  if (!pid || !known.has(pid)) {
    const q = (app.ui.financeQuery || '').trim().toLowerCase();
    const list = athletes.filter((x) => !q || x.name.toLowerCase().includes(q));
    return `<p class="small">Escolha seu nome para ver jogos, cashback e quanto falta para a festa.</p>
      <input id="fsearch" class="search" type="search" placeholder="Pesquisar atleta" value="${esc(app.ui.financeQuery || '')}" data-input="fsearch" autocomplete="off">
      <ul class="list">${list.map((x) => `<li class="row" data-act="stmt-pick" data-id="${esc(x.id)}"><div class="grow name">${esc(x.name)}${x.removed ? ' <span class="muted small">(fora do cadastro)</span>' : ''}</div><span class="chev">›</span></li>`).join('') || '<li class="empty-row">Nenhum atleta encontrado.</li>'}</ul>`;
  }
  const admin = adminActive();
  const st = statement(pid, app.db.sessions, f);
  const c = st.cashback;
  const sem = st.cycle;
  const pay = (m) => (m ? PAYMENT_METHODS[m] : '<span class="warn-text">pendente</span>');
  const entries = st.entries.map((e) => e.kind === 'game'
    ? `<li><span class="muted">${dateShort(e.date)}</span> ${esc(e.title)} · ${e.type === 'gk' ? '🧤 gol' : 'linha'} · ${pay(e.payment)}<b class="amt">${e.cents ? `+${formatMoney(e.cents)}` : e.type === 'line' ? '<span class="muted small">sem cashback</span>' : '—'}</b></li>`
    : `<li><span class="muted">${dateShort(e.date)}</span> ${esc(e.title)}<b class="amt">+${formatMoney(e.cents)}</b></li>`).join('');
  return `<div class="card stmt">
      <div class="stmt-name"><b>${esc(known.get(pid))}</b><button class="btn small ghost" data-act="stmt-clear">Trocar</button></div>
      <div class="counters c3">
        <div><b>${sem.line}<small>/${sem.total}</small></b><span>jogos de linha · ${sem.linePct}%</span></div>
        <div><b>${sem.gk}</b><span>jogos no gol</span></div>
        <div><b>${formatMoney(c.total).replace('R$ ', '')}</b><span>cashback (R$)</span></div>
      </div>
      <p class="small"><b>${esc(sem.label)}</b> · ${cyclePeriod(sem)} · ${sem.total} jogo(s) realizados.</p>
      <p class="small">Cashback desde ${esc(c.sinceLabel)}: ${c.lineGames} presença(s) paga(s) × ${formatMoney(FINANCE_RULES.cashbackPerGame)} = <b>${formatMoney(c.lineCents)}</b>${c.contribCents ? ` + aportes <b>${formatMoney(c.contribCents)}</b>` : ''}.${c.uncredited ? ` <span class="warn-text">${c.uncredited} presença(s) sem pagamento quitado não gera(m) cashback.</span>` : ''}</p>
      <div class="party ${c.partyPaid ? 'paid' : ''}">🎉 Festa de fim de ano (${formatMoney(c.partyFee)}): ${c.partyPaid ? '<b>quitada com o cashback!</b>' : `falta <b>${formatMoney(c.partyRemaining)}</b>`}${c.settlement ? ` · ✅ acerto registrado em ${dateShort(c.settlement.at)}` : ''}</div>
      ${admin && (c.total || c.settlement) ? `<ul class="plain small party-hist">${partyLine(pid, c, admin)}</ul>` : ''}
      ${st.pending ? `<p class="alert warn small">${st.pending} pelada(s) sem pagamento registrado (sem cashback até quitar).</p>` : ''}
      ${st.previousCashbacks.length ? `<h3 class="small">Períodos anteriores (já zerados)</h3><ul class="plain small party-hist">${st.previousCashbacks.map((p) => partyLine(pid, p, admin)).join('')}</ul>` : ''}
      ${st.waiting ? `<p class="alert small">${st.waiting} lançamento(s) depois do encerramento do ciclo: entram no próximo ciclo quando ele for iniciado.</p>` : ''}
      <button class="btn primary wide" data-act="pix-open">💠 Pagar com Pix</button>
    </div>
    <h2 class="section-title">Lançamentos desde ${esc(c.sinceLabel)}</h2>
    ${entries ? `<ul class="plain small stmt-list">${entries}</ul>` : '<p class="muted">Nenhum lançamento neste período.</p>'}
    <p class="muted small">Linha: ${formatMoney(FINANCE_RULES.lineFee)} por pelada (${formatMoney(FINANCE_RULES.operational)} operacional + ${formatMoney(FINANCE_RULES.cashbackPerGame)} de cashback, creditado quando a pelada é paga por Pix, Cartão ou Dinheiro). Goleiro: isento, cashback por aportes livres. O cashback só zera quando a tesouraria inicia um ciclo novo marcando "zerar cashback".</p>`;
}

/** Bloco do Pix da tesouraria (aba e janela rápida). */
export function pixBlock(f) {
  if (!f.pixKey && !f.pixCopyPaste && !f.qrImage) return '<div class="card empty">A tesouraria ainda não cadastrou o Pix. Um administrador configura em Ajustes → Financeiro e Pix.</div>';
  return `<div class="card pix-card">
    ${f.qrImage ? `<img class="pix-qr" src="${esc(f.qrImage)}" alt="QR Code Pix da tesouraria">` : ''}
    ${f.pixName ? `<p class="center"><b>${esc(f.pixName)}</b></p>` : ''}
    ${f.pixKey ? `<div class="field"><span>Chave Pix</span><div class="copy-row"><code>${esc(f.pixKey)}</code><button class="btn small" data-act="pix-copy" data-k="key">Copiar</button></div></div>` : ''}
    ${f.pixCopyPaste ? `<div class="field"><span>Pix Copia e Cola</span><div class="copy-row"><code class="cc">${esc(f.pixCopyPaste)}</code><button class="btn small primary" data-act="pix-copy" data-k="cc">Copiar</button></div></div>` : ''}
    <p class="muted small">Pelada (linha): ${formatMoney(FINANCE_RULES.lineFee)}. Goleiros são isentos; aportes de cashback são livres.</p>
  </div>`;
}

function pixTab(f, admin) {
  return `${pixBlock(f)}${admin ? '<button class="btn wide" data-act="pix-edit">⚙️ Configurar Pix e QR Code</button>' : ''}`;
}

function cashTab() {
  const list = app.db.sessions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!list.length) return '<div class="card empty">Nenhuma pelada ainda. Faça o sorteio; os pagamentos do dia aparecem aqui.</div>';
  const s = list.find((x) => x.id === app.ui.paySid) || activeSession() || list[0];
  const p = paymentSummary(s);
  const chips = list.slice(0, 8).map((x) => `<button class="chip ${x.id === s.id ? 'on' : ''}" data-act="fpay-pick" data-id="${esc(x.id)}">${dateShort(x.createdAt)}${x.status === 'live' ? ' ●' : ''}</button>`).join('');
  const row = (r) => (r.type === 'gk'
    ? `<li class="pay-row"><span class="name">🧤 ${esc(r.name)}</span><span class="pill">Isento (goleiro)</span><button class="btn small" data-act="contrib-new" data-pid="${esc(r.pid)}">+ Aporte</button></li>`
    : `<li class="pay-row ${r.method ? '' : 'pending'}"><span class="name">${esc(r.name)}</span><div class="pay-chips">${Object.keys(PAYMENT_METHODS)
      .map((m) => `<button class="chip ${r.method === m ? 'on' : ''}" data-act="pay-set" data-sid="${esc(s.id)}" data-pid="${esc(r.pid)}" data-m="${r.method === m ? '' : m}">${PAYMENT_METHODS[m]}</button>`).join('')}</div></li>`);
  const closed = closedCycleOf(s, financeSettings(app.db.settings));
  return `<div class="chips scroll-x">${chips}</div>
    <p class="small"><b>${esc(s.title)}</b>${s.status === 'draft' ? ' · <span class="warn-text">sorteio ainda não iniciado (a presença conta quando a pelada começa)</span>' : ''}</p>
    ${closed ? `<p class="alert warn small">🔒 Pelada do ciclo "${esc(closed.label)}", já encerrado. Mudar um pagamento aqui altera o cashback desse período e pede confirmação.</p>` : ''}
    <section class="counters">
      <div><b>${p.pix}</b><span>Pix</span></div><div><b>${p.card}</b><span>Cartão</span></div>
      <div><b>${p.cash}</b><span>Dinheiro</span></div><div><b>${p.pending}</b><span>pendentes</span></div>
    </section>
    <p class="small">Recebido: <b>${formatMoney(p.collected)}</b> de ${formatMoney(p.expected)} · ${formatMoney(p.operational)} operacional + ${formatMoney(p.cashbackRetained)} de cashback · ${p.exempt} isento(s).</p>
    <ul class="list pay-list">${p.rows.map(row).join('')}</ul>
    <p class="muted small">Toque de novo na forma marcada para voltar a "pendente". Só a pelada paga (Pix, Cartão ou Dinheiro) soma ${formatMoney(FINANCE_RULES.cashbackPerGame)} ao cashback; pendente e isento não somam.</p>`;
}

function contributionsTab(f) {
  const cycles = cycleList(f);
  const cyc = cycles.find((c) => c.open) || cycles[cycles.length - 1];
  const g = groupCashback(app.db.sessions, f, cyc.id);
  const since = cycles.find((c) => c.period === cyc.period)?.label || cyc.label;
  // Na folga, os aportes novos aguardam o próximo ciclo: aparecem na lista para conferência e exclusão.
  const waiting = cyc.open ? [] : groupCashback(app.db.sessions, f, NEXT_CYCLE).contributions;
  const list = [...waiting, ...g.contributions].sort((a, b) => b.at.localeCompare(a.at));
  return `<section class="counters c3">
      <div><b>${formatMoney(g.line).replace('R$ ', '')}</b><span>cashback linha (R$)</span></div>
      <div><b>${formatMoney(g.contrib).replace('R$ ', '')}</b><span>aportes (R$)</span></div>
      <div><b>${formatMoney(g.total).replace('R$ ', '')}</b><span>total (R$)</span></div>
    </section>
    <p class="muted small">Período de cashback desde ${esc(since)}.${waiting.length ? ` ${waiting.length} aporte(s) feito(s) depois do encerramento entram no próximo ciclo.` : ''}</p>
    <button class="btn primary wide" data-act="contrib-new">➕ Lançar aporte livre</button>
    <h2 class="section-title">Aportes do período</h2>
    ${list.length ? `<ul class="list">${list.map((c) => `<li class="row"><div class="grow"><div class="name">${esc(c.name)} · ${formatMoney(c.cents)}</div><div class="muted small">${dateShort(c.at)}${c.note ? ` · ${esc(c.note)}` : ''}</div></div><button class="btn small danger-ghost" data-act="contrib-del" data-id="${esc(c.id)}" aria-label="Excluir aporte">✕</button></li>`).join('')}</ul>` : '<p class="muted">Nenhum aporte lançado neste período.</p>'}
    <p class="muted small">Aportes livres (ex.: R$ 30, R$ 50) somam ao cashback do atleta — usado principalmente pelos goleiros, isentos da taxa de jogo.</p>`;
}

function financeSection() {
  const f = financeSettings(app.db.settings);
  const mode = f.mode === 'test'
    ? '🧪 Modo teste ligado: presenças, pagamentos e aportes estão sendo registrados para conferência.'
    : `✅ Ciclo oficial${f.cycleStart ? ` desde ${dateShort(f.cycleStart)}` : ''}.`;
  const cycles = cycleList(f);
  const open = cycles.find((c) => c.open);
  const last = cycles[cycles.length - 1];
  const reopen = reopenInfo(f, app.db.sessions);
  const cycleInfo = open
    ? `🟢 Ciclo aberto: <b>${esc(open.label)}</b> · ${cyclePeriod(open)}.`
    : `⏸ Nenhum ciclo aberto. Último: <b>${esc(last.label)}</b> (${cyclePeriod(last)}). Peladas da folga entram no próximo ciclo.`;
  return `<p class="small">${mode}</p>
    <p class="small">${cycleInfo}</p>
    <p class="muted small">Pix: ${f.pixKey || f.pixCopyPaste ? 'configurado' : 'não configurado'}${f.qrImage ? ' · com QR Code' : ''}.</p>
    ${adminActive()
    ? `${open
      ? '<button class="btn wide" data-act="cycle-close">🏁 Encerrar ciclo/semestre atual</button>'
      : '<button class="btn primary wide" data-act="cycle-start">▶️ Iniciar novo ciclo/semestre</button>'}
       ${reopen && !reopen.blocked ? `<button class="btn wide" data-act="cycle-reopen">↩️ Reabrir último ciclo encerrado (${esc(reopen.target.label)})</button>` : ''}
       <button class="btn wide" data-act="pix-edit">⚙️ Configurar Pix e QR Code</button>
       ${f.mode === 'official'
    ? '<button class="btn danger-ghost wide" data-act="reset-open">⚠️ Apagar todo o histórico (recomeçar do zero)</button>'
    : '<button class="btn danger-ghost wide" data-act="reset-open">🧹 Zerar lançamentos de teste</button>'}`
    : '<p class="muted small">Só administradores encerram/iniciam ciclos, configuram o Pix e zeram os lançamentos.</p>'}`;
}

// ------------------------------------------------------------------ ajustes

export function settingsView() {
  const st = app.db.settings;
  const used = (() => {
    try {
      return Math.round((localStorage.getItem('pelada.db') || '').length / 1024);
    } catch {
      return 0;
    }
  })();
  return `${header('Ajustes')}
  <main class="page">
    <section class="card">
      <h3>Padrões</h3>
      <label class="field"><span>Nome do grupo</span><input data-change="set-group" value="${esc(st.groupName)}"></label>
      <div class="field-row">
        <label class="field"><span>Tolerância (min)</span><input type="number" min="0" max="120" inputmode="numeric" data-change="set-tol" value="${st.toleranceMin}"></label>
        <label class="field"><span>Linha por time</span><input type="number" min="${LIMITS.linePerTeam.min}" max="${LIMITS.linePerTeam.max}" inputmode="numeric" data-change="set-n" value="${st.linePerTeam}"></label>
      </div>
      <label class="switch"><input type="checkbox" data-change="set-gk" ${st.useGoalkeepers ? 'checked' : ''}><span>Sortear com goleiros</span></label>
      <label class="switch"><input type="checkbox" data-change="set-reqgk" ${st.requireGkForComplete ? 'checked' : ''}><span>Equipe só é completa com goleiro</span></label>
      <label class="switch"><input type="checkbox" data-change="set-toss" ${st.tossOnFirstGameEvenWithTwoWaiting ? 'checked' : ''}><span>Par ou ímpar no 1º jogo mesmo com PRO e RE completos</span></label>
      <p class="muted small">Por padrão, a regra de saída dupla (PRO e RE completos) prevalece sobre o par ou ímpar do primeiro jogo.</p>
    </section>
    <section class="card">
      <h3>Banco na nuvem</h3>
      ${cloudSection()}
    </section>
    <section class="card">
      <h3>Financeiro e Pix</h3>
      ${financeSection()}
    </section>
    <section class="card">
      <h3>Modo administrador</h3>
      ${adminSection()}
    </section>
    <section class="card">
      <h3>Backup e restauração</h3>
      <p class="muted small">${app.db.players.length} jogadores · ${app.db.sessions.length} peladas · ~${used} KB armazenados neste aparelho.</p>
      <button class="btn wide" data-act="export">⬇ Exportar backup (.json)</button>
      <button class="btn wide" data-act="share-backup">📤 Enviar backup</button>
      <label class="btn wide file-btn">⬆ Importar backup<input type="file" accept="application/json,.json" data-change="import"></label>
    </section>
    <section class="card">
      <h3>Sobre</h3>
      <p class="small">Regras de rodízio e empate centralizadas no motor de domínio. <a href="tests/index.html" target="_blank" rel="noopener">Executar testes automatizados</a>.</p>
      <button class="btn danger-ghost wide" data-act="wipe">Limpar dados deste aparelho</button>
    </section>
  </main>`;
}

function adminSection() {
  const active = adminActive();
  const until = active ? new Date(adminUntil()).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const status = active ? `🔓 Administrador neste aparelho até ${until}.` : '👀 Você está como visitante: vê tudo em tempo real, sem alterar nada.';
  return `<p class="small">${status}</p>
    <p class="muted small">O PIN mestre é único para os administradores da ABR e fica guardado no servidor. Ele libera: ${Object.values(ADMIN_ACTIONS).join('; ')}.
    Sem PIN: ${Object.values(PUBLIC_ACTIONS).join('; ')}.</p>
    <button class="btn wide" data-act="admin-toggle">${active ? 'Sair do modo administrador' : 'Entrar com o PIN mestre'}</button>
    ${active ? '<button class="btn wide" data-act="pin-change">Alterar PIN mestre</button><button class="btn wide" data-act="open-roster">⬆ Importar lista de atletas</button>' : ''}`;
}

function cloudSection() {
  const c = cloud;
  const when = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
  const line = !c.online
    ? '📴 Sem internet: mostrando a última cópia baixada.'
    : c.connected
      ? `☁️ Conectado ao banco unificado${c.realtime ? ' · atualização em tempo real ligada' : ''}.`
      : c.error
        ? '⚠️ Sem dados da nuvem: usando a cópia deste aparelho.'
        : '⏳ Conectando à nuvem…';
  return `<p class="small">${line}</p>
    <p class="muted small">Última sincronização: ${when(c.lastSync)} · Alterações aguardando envio: ${c.pending}</p>
    ${c.error ? `<p class="alert error small">${esc(c.error)}</p>` : ''}
    ${c.needLogin ? '<p class="alert warn small">Há alterações deste aparelho esperando para subir: entre com o PIN mestre para enviá-las.</p>' : ''}
    <button class="btn wide" data-act="cloud-sync">🔄 Sincronizar agora</button>`;
}

/** Aviso fino no topo quando algo da nuvem pede atenção (sem sinal, pendências, conflito). */
export function cloudBar() {
  const c = cloud;
  if (!c.online) return `<div class="cloud-bar off">📴 Sem internet${c.pending ? ` · ${c.pending} alteração(ões) aguardando sinal` : ' · dados da última sincronização'}</div>`;
  if (c.needLogin) return '<div class="cloud-bar warn" data-act="admin-toggle">⚠️ Alterações esperando envio: toque para entrar com o PIN mestre</div>';
  if (c.pending) return `<div class="cloud-bar">⏳ Enviando ${c.pending} alteração(ões)…</div>`;
  return '';
}

export { ROLE_NAMES };
