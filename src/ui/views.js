// Telas (somente apresentação). Ações são disparadas por data-act e tratadas em app.js.
import { app, activeSession, setupState, adminActive } from './state.js';
import { esc, fmt, stars, roleBadge, positionsBadges, icon, posBadge, vestIcon, vestTag } from './dom.js';
import { cloud, adminUntil } from '../cloud/sync.js';
import {
  filterPlayers, ROLE_NAMES, REMOVAL_REASONS, STAR_VALUES, LIMITS, planParticipation, toleranceInfo, defaultTitle as domainDefaultTitle,
  ADMIN_ACTIONS, PUBLIC_ACTIONS, allTeamsInOrder, queueLabel, teamStats, isComplete, linePositions, playerStats, balanceSummary, gamesSummary, teamExitGroups, drawHint, advantageStatus,
  vestOf, vestName, incomingVest,
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
