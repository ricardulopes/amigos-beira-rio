// Janelas modais (apresentação). Estado do modal fica em app.ui.modal.
import { app, activeSession } from './state.js';
import { esc, fmt, stars, roleBadge, positionsBadges, starPicker, posBadge, vestIcon } from './dom.js';
import {
  ROLE_NAMES, REMOVAL_REASONS, filterPlayers, allTeamsInOrder, queueLabel, simulateTransfer, teamStats, linePositions, PIN_RULES, ADMIN_ACTIONS, rosterPlanSummary,
  vestOf, vestPreview, financeSettings, resetPreview, formatMoney, currentCycle, cycleRanking, reopenInfo, resetWord,
  usesGkQueue, goalkeeperLineup,
} from '../domain/index.js';
import { pixBlock } from './views.js';

function shell(title, body, footer = '', cls = '') {
  return `<div class="modal-back" data-act="modal-close-bg">
    <div class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h2>${esc(title)}</h2><button class="icon-btn" data-act="modal-close" aria-label="Fechar">✕</button></header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer>${footer}</footer>` : ''}
    </div></div>`;
}

export function renderModal() {
  const m = app.ui.modal;
  if (!m) return '';
  const s = activeSession();
  switch (m.type) {
    case 'player':
      return playerForm(m);
    case 'finish': {
      // RN-146: campo de horário começa vazio; "Usar horário atual" é só um atalho opcional.
      const s = activeSession();
      const start = s?.startedAt ? new Date(s.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
      return shell('Encerrar pelada', `<p>A sequência de jogos ficará salva no histórico${s ? ` (${s.games.length} jogo(s)${start ? `, início às ${start}` : ''})` : ''}.</p>
        <label class="field"><span>Horário de encerramento</span><input id="m-finish" type="time" data-input="m:time" value="${esc(m.time || '')}" required></label>
        <button class="btn wide" data-act="finish-now">🕒 Usar horário atual</button>
        <p class="muted small">Confira o horário antes de encerrar. Se estiver encerrando depois, digite a hora em que o último jogo terminou.</p>`,
      `<button class="btn" data-act="modal-close">Cancelar</button><button class="btn danger" data-act="finish-ok">Encerrar</button>`);
    }
    case 'confirm':
      return shell(m.title, `<p>${m.html || esc(m.text)}</p>`, `<button class="btn" data-act="modal-close">Cancelar</button><button class="btn ${m.danger ? 'danger' : 'primary'}" data-act="confirm-ok">${esc(m.okText || 'Confirmar')}</button>`);
    case 'result':
      return resultModal(s, m);
    case 'late':
      return lateModal(s, m);
    case 'remove':
      return removeModal(s, m);
    case 'transfer':
      return transferModal(s, m);
    case 'order':
      return orderModal(s, m);
    case 'swap':
      return swapModal(s, m);
    case 'gk':
      return gkModal(s, m);
    case 'log':
      return shell('Registro de movimentações', `<ol class="log">${s.log.slice().reverse().map((l) => `<li><time>${new Date(l.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time> ${esc(l.text)}</li>`).join('')}</ol>`, '', 'tall');
    case 'more':
      return moreModal(s);
    case 'share':
      return shareModal(m);
    case 'pin':
      return pinModal(m);
    case 'playerInfo':
      return playerInfoModal(m);
    case 'roster':
      return rosterModal(m);
    case 'pix':
      return shell('Pix da tesouraria', pixBlock(financeSettings(app.db.settings)), '<button class="btn primary" data-act="modal-close">Fechar</button>');
    case 'pixEdit':
      return pixEditModal(m);
    case 'contrib':
      return contribModal(m);
    case 'reset':
      return resetModal(m);
    case 'cycle':
      return cycleModal(m);
    case 'info':
      if (m.after) return shell(m.title, `<p>${esc(m.text)}</p><ul class="warn-list">${m.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="muted small">${esc(m.after)}</p>`, '<button class="btn primary" data-act="modal-close">Entendi</button>');
      return shell(m.title, `${m.list ? `<ul class="warn-list">${m.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${m.text ? `<p>${esc(m.text)}</p>` : ''}`, '<button class="btn primary" data-act="modal-close">Entendi</button>');
    default:
      return '';
  }
}

// --------------------------------------------------------------- cadastro

function playerForm(m) {
  const d = m.draft;
  const posBtn = (r) => `<button type="button" class="chip big ${d.positions.includes(r) ? 'on' : ''}" data-act="m-pos" data-r="${r}">${ROLE_NAMES[r]}</button>`;
  const body = `
    ${m.error ? `<div class="alert error">${esc(m.error)}</div>` : ''}
    <label class="field"><span>Nome</span><input id="m-name" data-input="m:name" value="${esc(d.name)}" maxlength="40" autocomplete="off" enterkeyhint="done"></label>
    <div class="field"><span>Tipo</span>
      <div class="seg">
        <button type="button" class="${d.type === 'line' ? 'on' : ''}" data-act="m-type" data-v="line">Jogador de linha</button>
        <button type="button" class="${d.type === 'gk' ? 'on' : ''}" data-act="m-type" data-v="gk">🧤 Goleiro</button>
      </div>
    </div>
    <div class="field"><span>Classificação técnica</span>${starPicker('stars', d.stars)}<div class="center">${stars(d.stars)}</div></div>
    ${d.type === 'line' ? `<div class="field"><span>Posições (uma ou mais)</span><div class="chips">${posBtn('D')}${posBtn('M')}${posBtn('A')}</div></div>` : '<p class="muted small">Goleiros não precisam de posições de linha.</p>'}
  `;
  const footer = `${m.id ? '<button class="btn danger-ghost" data-act="player-delete">Excluir</button>' : ''}
    <button class="btn" data-act="modal-close">Cancelar</button>
    <button class="btn primary" data-act="player-save">${m.late ? 'Salvar e adicionar' : 'Salvar'}</button>`;
  return shell(m.id ? 'Editar jogador' : m.late ? 'Novo jogador atrasado' : 'Novo jogador', body, footer);
}

// --------------------------------------------------------------- modo administrador

function pinModal(m) {
  const pinInput = (id, field, label) =>
    `<label class="field"><span>${label}</span><input id="${id}" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="${PIN_RULES.maxLength}" autocomplete="off" data-input="m:${field}" value="${esc(m[field] || '')}" enterkeyhint="done" ${m.busy ? 'disabled' : ''}></label>`;
  const what = m.action && ADMIN_ACTIONS[m.action] ? `<p class="muted small">Para <b>${esc(ADMIN_ACTIONS[m.action])}</b> é preciso o PIN mestre de administrador.</p>` : '';
  const changing = m.mode === 'change';
  const body = `
    ${m.error ? `<div class="alert error">${esc(m.error)}</div>` : ''}
    ${what}
    ${pinInput('m-pin', 'pin', changing ? 'Novo PIN mestre' : 'PIN mestre da ABR')}
    ${changing ? pinInput('m-pin2', 'pin2', 'Repita o novo PIN') : ''}
    <p class="muted small">${changing
    ? 'O novo PIN vale para todos os administradores; os outros aparelhos precisarão entrar de novo.'
    : 'PIN único dos administradores, conferido no servidor (precisa de internet). O acesso vale 12 horas neste aparelho, inclusive sem sinal no campo.'}</p>`;
  const title = changing ? 'Alterar PIN mestre' : 'Entrar como administrador';
  const ok = m.busy ? 'Conferindo…' : changing ? 'Salvar PIN' : 'Entrar';
  return shell(title, body, `<button class="btn" data-act="modal-close">Cancelar</button><button class="btn primary" data-act="pin-ok" ${m.busy ? 'disabled' : ''}>${ok}</button>`);
}

// --------------------------------------------------------------- ficha do jogador (só leitura, RN-116)

function playerInfoModal(m) {
  const p = app.db.players.find((x) => x.id === m.id);
  if (!p) return shell('Jogador', '<p>Jogador não encontrado.</p>');
  const what = p.type === 'line' ? `Posições: ${p.positions.map((r) => ROLE_NAMES[r]).join(', ')}` : '🧤 Goleiro';
  const body = `
    <p><b>${esc(p.name)}</b> ${stars(p.stars, 'sm')}</p>
    <p>${esc(what)}</p>
    <p class="muted small">Cadastro, estrelas e posições só são alterados por administradores (PIN mestre).</p>`;
  return shell('Ficha do jogador', body,
    `<button class="btn" data-act="player-admin-edit" data-id="${esc(p.id)}">🔒 Editar (admin)</button><button class="btn primary" data-act="modal-close">Fechar</button>`);
}

// --------------------------------------------------------------- financeiro (RN-118 a RN-127)

function pixEditModal(m) {
  const body = `
    ${m.error ? `<div class="alert error">${esc(m.error)}</div>` : ''}
    <label class="field"><span>Chave Pix da tesouraria</span><input id="m-pixkey" data-input="m:pixKey" value="${esc(m.pixKey || '')}" maxlength="77" autocomplete="off" placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória"></label>
    <label class="field"><span>Nome do recebedor (opcional)</span><input id="m-pixname" data-input="m:pixName" value="${esc(m.pixName || '')}" maxlength="60" autocomplete="off"></label>
    <label class="field"><span>Pix Copia e Cola (opcional)</span><textarea id="m-pixcc" rows="3" data-input="m:pixCopyPaste" spellcheck="false" autocapitalize="off" placeholder="000201…">${esc(m.pixCopyPaste || '')}</textarea></label>
    <div class="field"><span>QR Code (imagem)</span>
      ${m.qrImage ? `<img class="pix-qr" src="${esc(m.qrImage)}" alt="Prévia do QR Code">` : '<p class="muted small">Nenhuma imagem. Use um print do QR Code gerado pelo app do banco.</p>'}
      <div class="row-btns">
        <label class="btn small file-btn">🖼 Escolher imagem<input type="file" accept="image/png,image/jpeg,image/webp" data-change="pix-qr"></label>
        ${m.qrImage ? '<button class="btn small danger-ghost" data-act="pix-qr-clear">Remover imagem</button>' : ''}
      </div>
    </div>
    <p class="muted small">Fica visível para todos os atletas na aba Caixa → Pix e no atalho 💠 da tela inicial.</p>`;
  return shell('Configurar Pix', body, '<button class="btn" data-act="modal-close">Cancelar</button><button class="btn primary" data-act="pix-save">Salvar</button>', 'tall');
}

function contribModal(m) {
  const q = (m.query || '').trim().toLowerCase();
  const players = app.db.players
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'pt-BR') : a.type === 'gk' ? -1 : 1));
  const sel = app.db.players.find((p) => p.id === m.pid);
  const body = `
    ${m.error ? `<div class="alert error">${esc(m.error)}</div>` : ''}
    <div class="field"><span>Atleta${sel ? `: <b>${esc(sel.name)}</b>` : ''}</span>
      <input id="m-cq" class="search" type="search" placeholder="Buscar atleta" data-input="m:query" value="${esc(m.query || '')}" autocomplete="off">
      <div class="chips wrap pick-box">${players.map((p) => `<button class="chip ${m.pid === p.id ? 'on' : ''}" data-act="m-set" data-k="pid" data-v="${esc(p.id)}">${p.type === 'gk' ? '🧤 ' : ''}${esc(p.name)}</button>`).join('') || '<span class="muted small">Nenhum atleta.</span>'}</div>
    </div>
    <label class="field"><span>Valor (R$)</span><input id="m-amount" data-input="m:amount" value="${esc(m.amount || '')}" inputmode="decimal" placeholder="30,00" autocomplete="off"></label>
    <label class="field"><span>Observação (opcional)</span><input id="m-note" data-input="m:note" value="${esc(m.note || '')}" maxlength="80" placeholder="Aporte livre"></label>
    <p class="muted small">Soma ao cashback do ano do atleta e abate a festa de fim de ano.</p>`;
  return shell('Aporte livre de cashback', body, `<button class="btn" data-act="modal-close">Cancelar</button><button class="btn primary" data-act="contrib-save" ${m.pid ? '' : 'disabled'}>Lançar aporte</button>`, 'tall');
}

function resetModal(m) {
  const f = financeSettings(app.db.settings);
  const pv = resetPreview(app.db.sessions, f);
  const total = f.contributions.reduce((t, c) => t + c.cents, 0);
  const word = resetWord(f);
  const body = `
    ${m.error ? `<div class="alert error">${esc(m.error)}</div>` : ''}
    ${pv.official ? '<div class="alert error">⚠️ O app já está no <b>ciclo oficial</b>: isto apaga o histórico <b>real</b> do grupo (rankings, presenças, pagamentos, cashback e acertos da festa). Use só se tiver certeza absoluta.</div>' : ''}
    ${pv.live ? '<div class="alert warn">Há uma pelada em andamento: encerre-a antes de zerar.</div>' : ''}
    ${pv.draft ? '<div class="alert warn">Há um sorteio em rascunho: inicie ou descarte o rascunho antes de zerar.</div>' : ''}
    <p>Apaga <b>de todos os aparelhos e da nuvem</b>:</p>
    <ul class="warn-list">
      <li>${pv.peladas} pelada(s) com histórico, presenças e pagamentos (${pv.started} iniciada(s));</li>
      <li>${pv.contributions} aporte(s) de cashback (${formatMoney(total)}).</li>
    </ul>
    <p class="small">Continuam: cadastro de atletas (${app.db.players.length}), configuração do Pix e ajustes. Depois disso o app sai do modo teste e começa o <b>ciclo oficial</b> do zero.</p>
    <p class="small">Não dá para desfazer. Se quiser guardar uma cópia, exporte o backup antes: <button class="btn small" data-act="export">⬇ Exportar backup</button></p>
    <label class="field"><span>Digite <b>${word}</b> para confirmar</span><input id="m-confirm" data-input="m:confirm" value="${esc(m.confirm || '')}" autocomplete="off" autocapitalize="characters"></label>`;
  return shell(pv.official ? 'Apagar todo o histórico' : 'Zerar lançamentos de teste', body,
    `<button class="btn" data-act="modal-close">Cancelar</button><button class="btn danger" data-act="reset-ok" ${pv.live || pv.draft ? 'disabled' : ''}>${pv.official ? 'Apagar tudo' : 'Zerar tudo'}</button>`, 'tall');
}

/** RN-128: encerrar o ciclo aberto ou iniciar o próximo, com palavra de confirmação. */
function cycleModal(m) {
  const closing = m.mode === 'close';
  const reopening = m.mode === 'reopen';
  const word = closing ? 'ENCERRAR' : reopening ? 'REABRIR' : 'INICIAR';
  let body;
  if (reopening) {
    // RN-130: desfaz um encerramento feito por engano.
    const info = reopenInfo(financeSettings(app.db.settings), app.db.sessions);
    body = info ? `
      <p>Reabre <b>${esc(info.target.label)}</b> como se não tivesse sido encerrado.</p>
      <ul class="warn-list">
        <li>O ranking guardado no encerramento é descartado e volta a ser calculado pelas peladas.</li>
        <li>Peladas e aportes feitos depois do encerramento (na folga) voltam a contar neste ciclo.</li>
        ${info.drop ? `<li>O ciclo "${esc(info.drop.label)}", iniciado depois e ainda vazio, é desfeito.</li>` : ''}
      </ul>
      ${info.blocked ? `<div class="alert warn">${esc(info.blocked)}</div>` : ''}` : '<p>Não há ciclo encerrado para reabrir.</p>';
  } else if (closing) {
    const f = financeSettings(app.db.settings);
    const cur = currentCycle(f);
    const total = cur ? cycleRanking(app.db.sessions, f, cur.id, 'line').total : 0;
    body = `
      <p>Encerra o ciclo aberto agora. O ranking dele (${total} jogo(s)) fica <b>fechado e guardado</b> para o sorteio do campeonato e o acerto do cashback/festa.</p>
      <label class="field"><span>Nome do ciclo que está sendo encerrado</span><input id="m-clabel" data-input="m:label" value="${esc(m.label || '')}" maxlength="40" autocomplete="off"></label>
      <p class="small">Peladas feitas depois do encerramento (na folga) entram no <b>próximo ciclo</b>, quando ele for iniciado.</p>`;
  } else {
    body = `
      <p>Começa um ciclo novo a partir de agora: o ranking de presença (Top 32 linha / Top 4 goleiros) volta a contar do zero.</p>
      <label class="field"><span>Nome do novo ciclo</span><input id="m-clabel" data-input="m:label" value="${esc(m.label || '')}" maxlength="40" autocomplete="off" placeholder="1º semestre de 2027"></label>
      <div class="field"><span>Cashback</span><div class="seg">
        <button type="button" class="${m.reset ? '' : 'on'}" data-act="m-set" data-k="reset" data-v="">Continua acumulando</button>
        <button type="button" class="${m.reset ? 'on' : ''}" data-act="m-set" data-k="reset" data-v="1">Zerar (novo ano da festa)</button>
      </div></div>
      <p class="small">${m.reset ? 'O cashback de todos recomeça do zero neste ciclo. O do período anterior continua aparecendo no extrato de cada atleta para o acerto da festa.' : 'O cashback continua somando com o do ciclo anterior (ex.: do 1º para o 2º semestre).'}</p>`;
  }
  body = `${m.error ? `<div class="alert error">${esc(m.error)}</div>` : ''}${body}
    <label class="field"><span>Digite <b>${word}</b> para confirmar</span><input id="m-confirm" data-input="m:confirm" value="${esc(m.confirm || '')}" autocomplete="off" autocapitalize="characters"></label>`;
  const title = closing ? 'Encerrar ciclo/semestre' : reopening ? 'Reabrir último ciclo' : 'Iniciar novo ciclo/semestre';
  const ok = closing ? 'Encerrar ciclo' : reopening ? 'Reabrir ciclo' : 'Iniciar ciclo';
  return shell(title, body,
    `<button class="btn" data-act="modal-close">Cancelar</button><button class="btn ${closing || reopening ? 'danger' : 'primary'}" data-act="cycle-ok">${ok}</button>`, 'tall');
}

// --------------------------------------------------------------- importação em lote

function rosterModal(m) {
  const plan = m.plan;
  const pl = (p) => `${esc(p.name)} <span class="muted">${fmt(p.stars)}★ ${p.type === 'gk' ? 'G' : p.positions.join(',')}</span>`;
  const group = (title, items, cls = '') => (items.length ? `<h4 class="${cls}">${title} (${items.length})</h4><ul class="plain small">${items.join('')}</ul>` : '');
  const preview = plan
    ? `<div class="roster-preview">
        <p class="${plan.blocked ? 'alert error' : 'alert ok'}">${esc(rosterPlanSummary(plan))}${plan.blocked ? '. No modo substituir, corrija todas as linhas antes.' : ''}</p>
        ${group('Linhas com erro', plan.errors.map((e) => `<li>Linha ${e.lineNo}${e.name ? ` — ${esc(e.name)}` : ''}: ${esc(e.message)}</li>`), 'danger-text')}
        ${group('Novos', plan.create.map((p) => `<li>${pl(p)}</li>`))}
        ${group('Atualizados', plan.update.map((u) => `<li>${pl(u.before)} → ${pl(u.after)}</li>`))}
        ${group('Excluídos do cadastro', plan.remove.map((p) => `<li>${pl(p)}</li>`), 'danger-text')}
        ${group('Ignorados', plan.ignored.map((e) => `<li>${esc(e.name)}: ${esc(e.message)}</li>`))}
      </div>`
    : '';
  const body = `
    <p class="small">Um atleta por linha: <code>Nome; estrelas; posições</code>. Ex.: <code>Branco; 2,5; D</code> · <code>Thiaguinho; 3; M,A</code> · <code>Fabio; 2; G</code> (goleiro) · <code>Leo Baiano; X</code> (excluir).</p>
    <p class="muted small">Também aceita <code>Nome 2,5★ D,M</code>. Em quem já está cadastrado, o que não for informado fica como está. Linhas com # são ignoradas.</p>
    <div class="seg">
      <button type="button" class="${m.mode === 'merge' ? 'on' : ''}" data-act="m-set" data-k="mode" data-v="merge">Mesclar com o cadastro</button>
      <button type="button" class="${m.mode === 'replace' ? 'on' : ''}" data-act="m-set" data-k="mode" data-v="replace">Substituir a base</button>
    </div>
    ${m.mode === 'replace' ? '<p class="alert warn small">Substituir exclui do cadastro quem não estiver na lista.</p>' : ''}
    <textarea id="m-roster" class="roster-text" rows="9" data-input="m:text" placeholder="Branco; 2,5; D&#10;Thiaguinho; 3; M,A&#10;Fabio; 2; G" spellcheck="false" autocapitalize="off">${esc(m.text || '')}</textarea>
    <div class="row-btns">
      <button class="btn small primary" data-act="roster-official">⭐ Usar lista oficial do grupo</button>
      <label class="btn small file-btn">📄 Abrir arquivo<input type="file" accept=".txt,.csv,text/plain,text/csv" data-change="roster-file"></label>
      <button class="btn small" data-act="roster-current">Carregar cadastro atual</button>
    </div>
    ${preview}`;
  const footer = `<button class="btn" data-act="modal-close">Cancelar</button>
    ${plan && !plan.blocked ? '<button class="btn primary" data-act="roster-apply">Aplicar</button>' : '<button class="btn primary" data-act="roster-preview">Conferir lista</button>'}`;
  return shell('Importar lista de atletas', body, footer, 'tall');
}

// --------------------------------------------------------------- resultado

function resultModal(s, m) {
  const an = m.analysis;
  const [a, b] = s.field.map((id) => s.teams[id]);
  const head = m.r === 'draw' ? 'Empate' : `Vitória do ${m.r === 'A' ? a.label : b.label}`;
  const checks = `<ul class="checks">
    <li>Primeiro jogo da sequência: <b>${an.isFirstGame ? 'sim' : 'não'}</b></li>
    <li>Times completos aguardando: <b>${an.completeWaiting}</b> (PRO ${an.proComplete ? 'completo' : 'incompleto/ausente'}, RE ${an.reComplete ? 'completo' : 'incompleto/ausente'})</li>
    <li>Defende permanência: <b>${[a, b].filter((t) => t.permanence).map((t) => esc(t.label)).join(', ') || 'nenhum'}</b></li>
  </ul>`;
  if (an.needsToss) {
    return shell(`${head} — par ou ímpar`, `<p>${esc(an.explanation)}</p>${checks}<p><b>Quem venceu o par ou ímpar?</b></p>
      <div class="toss">
        <button class="btn win big v-${vestOf(s, a.id)}" data-act="toss" data-t="${a.id}">${vestIcon(vestOf(s, a.id), 'sm')}${esc(a.label)}</button>
        <button class="btn win big v-${vestOf(s, b.id)}" data-act="toss" data-t="${b.id}">${vestIcon(vestOf(s, b.id), 'sm')}${esc(b.label)}</button>
      </div>
      <p class="muted small">${an.staying && an.staying.length === 0
    ? 'Os dois times saem; quem vencer o par ou ímpar sobe na fila na frente do outro. Quem entra veste a cor de quem saiu.'
    : 'Quem vencer o par ou ímpar continua com o colete que está vestindo; quem entrar veste a cor de quem saiu.'}</p>`, '<button class="btn" data-act="modal-close">Cancelar</button>');
  }
  const preview = vestPreview(s, m.r);
  return shell(
    head,
    `<p class="explain-big">${esc(an.explanation)}</p>${preview ? `<div class="vest-preview">${vestIcon(null)}${esc(preview)}</div>` : ''}${m.r === 'draw' ? checks : ''}`,
    `<button class="btn" data-act="modal-close">Cancelar</button><button class="btn primary big" data-act="result-ok">Confirmar</button>`,
  );
}

// --------------------------------------------------------------- atrasados

function lateModal(s, m) {
  const avail = filterPlayers(app.db.players, { query: m.query || '' }).filter((p) => !s.active.includes(p.id));
  const body = `
    <p class="muted small">Entram estritamente por ordem de chegada, sem considerar estrelas ou posições: cada um ocupa a próxima posição livre da última equipe da fila (se ela tem as posições 1 e 2, o próximo entra na 3); equipe completa abre outra na posição 1. ${s.arrivals.length} atrasado(s) até agora.</p>
    <input id="m-late-q" class="search" type="search" placeholder="Buscar jogador cadastrado" data-input="m:query" value="${esc(m.query || '')}" autocomplete="off">
    <ul class="list">
      ${avail.map((p) => `<li class="row" data-act="late-add" data-id="${p.id}"><div class="grow"><div class="name">${esc(p.name)}</div><div class="badges">${positionsBadges(p)}</div></div>${stars(p.stars)}<span class="btn small primary">Chegou</span></li>`).join('') || '<li class="empty-row">Nenhum jogador disponível.</li>'}
    </ul>`;
  return shell('Adicionar jogador atrasado', body, `<button class="btn wide" data-act="late-new">+ Cadastrar novo jogador</button>`, 'tall');
}

// --------------------------------------------------------------- retirada / reposição

function removeModal(s, m) {
  const teams = allTeamsInOrder(s);
  const picks = m.pids || [];
  const sel = new Set(picks); // RN-147: seleção múltipla
  const body = `
    <div class="field"><span>Motivo</span><div class="chips">${Object.entries(REMOVAL_REASONS).map(([k, v]) => `<button class="chip ${m.reason === k ? 'on' : ''}" data-act="m-set" data-k="reason" data-v="${k}">${v}</button>`).join('')}</div></div>
    <label class="field"><span>Observação (opcional)</span><input data-input="m:note" value="${esc(m.note || '')}" maxlength="80"></label>
    <div class="field"><span>Jogadores</span></div>
    <p class="muted small">Toque em todos que vão sair (de um ou de vários times); toque de novo para desmarcar.${picks.length ? ` <b>${picks.length} selecionado(s):</b> ${picks.map((p) => esc(s.snapshot[p]?.name || p)).join(', ')}.` : ''}</p>
    ${teams.map((t) => `<div class="pick-team"><div class="muted small">${esc(t.label)} · ${queueLabel(s, t.id)}</div><div class="chips">
        ${t.gks.map((g) => `<button class="chip ${sel.has(g) ? 'on' : ''}" data-act="rm-pick" data-v="${g}" aria-pressed="${sel.has(g)}">🧤 ${esc(s.snapshot[g].name)}</button>`).join('')}
        ${t.line.map((x) => `<button class="chip ${sel.has(x.pid) ? 'on' : ''}" data-act="rm-pick" data-v="${x.pid}" aria-pressed="${sel.has(x.pid)}">${esc(s.snapshot[x.pid].name)}</button>`).join('')}
      </div></div>`).join('')}
    ${s.bench.length ? `<div class="pick-team"><div class="muted small">Reserva</div><div class="chips">${s.bench.map((g) => `<button class="chip ${sel.has(g) ? 'on' : ''}" data-act="rm-pick" data-v="${g}" aria-pressed="${sel.has(g)}">🧤 ${esc(s.snapshot[g].name)}</button>`).join('')}</div></div>` : ''}
    ${s.gkQueue?.length ? `<div class="pick-team"><div class="muted small">Fila de goleiros</div><div class="chips">${s.gkQueue.map((g) => `<button class="chip ${sel.has(g) ? 'on' : ''}" data-act="rm-pick" data-v="${g}" aria-pressed="${sel.has(g)}">🧤 ${esc(s.snapshot[g].name)}</button>`).join('')}</div></div>` : ''}
    <p class="muted small">A vaga é reposta automaticamente pela esteira da fila: a posição 1 do Próximo entra no topo da equipe que perdeu o jogador, o Ré completa o Próximo, o Tri completa o Ré, e assim por diante; a vaga termina no último da fila. Goleiro é reposto pelo próximo goleiro da fila. Vale só para esta pelada; o cadastro não muda.</p>`;
  return shell('Retirar jogadores', body, `<button class="btn" data-act="modal-close">Cancelar</button><button class="btn danger" data-act="remove-ok" ${picks.length ? '' : 'disabled'}>Retirar${picks.length > 1 ? ` (${picks.length})` : ''}</button>`, 'tall');
}

// --------------------------------------------------------------- transferência

function transferModal(s, m) {
  const teams = allTeamsInOrder(s);
  const sel = (key) => `<div class="chips">${teams.map((t) => `<button class="chip ${m[key] === t.id ? 'on' : ''}" data-act="m-set" data-k="${key}" data-v="${t.id}">${esc(t.label)} <small>${queueLabel(s, t.id)}</small></button>`).join('')}</div>`;
  let sim = '';
  let ok = false;
  if (m.from && m.to && m.from !== m.to) {
    try {
      const r = simulateTransfer(s, m.from, m.to, m.qty);
      ok = r.k > 0;
      const row = (x) => `<tr><td>${esc(x.label)}</td><td>${x.before.size} → <b>${x.after.size}</b></td><td>${fmt(x.before.sum)} → <b>${fmt(x.after.sum)}</b></td><td>${x.before.counts.D}-${x.before.counts.M}-${x.before.counts.A} → <b>${x.after.counts.D}-${x.after.counts.M}-${x.after.counts.A}</b></td></tr>`;
      sim = `<div class="card small"><div>Movimento (de baixo para cima):</div><ul class="moves">${r.moving
        .map((x) => `<li><b>${esc(x.name)}</b> ${stars(x.stars, 'sm')} — pos. ${x.fromPosition} do ${esc(r.from.label)} → pos. ${x.toPosition} do ${esc(r.to.label)}</li>`)
        .join('') || '<li>—</li>'}</ul>
        <table class="tbl"><thead><tr><th>Equipe</th><th>Jog.</th><th>★</th><th>D-M-A</th></tr></thead><tbody>${row(r.from)}${row(r.to)}</tbody></table>
        ${r.warnings.length ? `<ul class="warn-list">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>`;
    } catch (e) {
      sim = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }
  const body = `<div class="field"><span>Origem</span>${sel('from')}</div>
    <div class="field"><span>Destino</span>${sel('to')}</div>
    <div class="field"><span>Quantidade (de baixo para cima)</span><div class="stepper"><button data-act="m-qty" data-d="-1">−</button><b>${m.qty}</b><button data-act="m-qty" data-d="1">+</button></div></div>
    ${sim}`;
  return shell('Simular transferência', body, `<button class="btn" data-act="modal-close">Fechar</button><button class="btn primary" data-act="transfer-ok" ${ok ? '' : 'disabled'}>Aplicar transferência</button>`, 'tall');
}

// --------------------------------------------------------------- ordem

function orderModal(s, m) {
  const teams = allTeamsInOrder(s);
  const t = s.teams[m.tid] || teams[0];
  const total = t ? t.line.length : 0;
  // posição 1 primeiro; na visualização padrão o topo (posição N) aparece em cima
  let rows = t
    ? linePositions(t).map((x) => `<li class="prow">
      ${posBadge(x.position)}<span class="pname">${esc(s.snapshot[x.pid].name)}</span>${roleBadge(x.role)}${stars(s.snapshot[x.pid].stars, 'sm')}
      <button class="mini" data-act="order-move" data-pid="${x.pid}" data-d="1" ${x.position === total ? 'disabled' : ''} aria-label="Subir para a posição ${x.position + 1}">▲</button>
      <button class="mini" data-act="order-move" data-pid="${x.pid}" data-d="-1" ${x.position === 1 ? 'disabled' : ''} aria-label="Descer para a posição ${x.position - 1}">▼</button></li>`)
    : [];
  if (!app.ui.inverted) rows = rows.reverse();
  const body = `<div class="chips">${teams.map((x) => `<button class="chip ${t && x.id === t.id ? 'on' : ''}" data-act="m-set" data-k="tid" data-v="${x.id}">${esc(x.label)}</button>`).join('')}</div>
    <p class="muted small">Posições de baixo para cima: a posição 1 sai primeiro. ▲ sobe uma posição (sai mais tarde); ▼ desce (sai mais cedo).${app.ui.inverted ? ' Visualização invertida: posição 1 em cima.' : ''}</p>
    <ul class="plist editable">${rows.join('')}</ul>`;
  return shell('Editar ordem', body, `<button class="btn" data-act="toggle-invert">⇅ Inverter visualização</button><button class="btn primary" data-act="modal-close">Pronto</button>`, 'tall');
}

function swapModal(s, m) {
  const teams = allTeamsInOrder(s);
  const pick = (key) => teams.map((t) => `<div class="pick-team"><div class="muted small">${esc(t.label)}</div><div class="chips">${t.line.map((x) => `<button class="chip ${m[key] === x.pid ? 'on' : ''}" data-act="m-set" data-k="${key}" data-v="${x.pid}">${esc(s.snapshot[x.pid].name)} <small>${fmt(s.snapshot[x.pid].stars)}★</small></button>`).join('')}</div></div>`).join('');
  const body = `<p class="muted small">Troca manual de dois jogadores de linha (cada um assume o lugar do outro na ordem).</p>
    <div class="field"><span>Jogador 1</span>${pick('a')}</div><div class="field"><span>Jogador 2</span>${pick('b')}</div>`;
  return shell('Trocar jogadores', body, `<button class="btn" data-act="modal-close">Cancelar</button><button class="btn primary" data-act="swap-ok" ${m.a && m.b && m.a !== m.b ? '' : 'disabled'}>Trocar</button>`, 'tall');
}

function gkModal(s, m) {
  if (usesGkQueue(s)) {
    // RN-137: ordem dos goleiros do dia — pelos times que têm goleiro (campo, PRO, RE…), depois quem aguarda time.
    const lineup = goalkeeperLineup(s);
    const where = (g) => {
      const t = [...s.field, ...s.queue].find((id) => s.teams[id].gks[0] === g);
      return t ? `no gol do <b>${esc(s.teams[t].label)}</b> · ${queueLabel(s, t)}` : `aguardando time (${s.gkQueue.indexOf(g) + 1}º)`;
    };
    const rows = lineup.map((g, i) => `<li class="prow">
        <span class="ord pos">${i + 1}º</span><div class="grow gk-who"><div class="pname">🧤 ${esc(s.snapshot[g].name)}</div><div class="muted small">${where(g)}</div></div>
        <button class="mini" data-act="gk-line" data-pid="${g}" data-to="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
        <button class="mini" data-act="gk-line" data-pid="${g}" data-to="${i + 2}" ${i === lineup.length - 1 ? 'disabled' : ''} aria-label="Descer">▼</button>
        <button class="mini" data-act="gk-line" data-pid="${g}" data-to="end" ${i === lineup.length - 1 ? 'disabled' : ''} aria-label="Fim da fila">⤓</button></li>`).join('');
    const body = lineup.length
      ? `<p class="muted small">Quem vence mantém o goleiro; o goleiro de quem perde vai para o primeiro time sem goleiro (campo, PRO, RE…). ▲▼ trocam os goleiros de time; ⤓ manda para a última posição.</p>
        <ul class="plist editable">${rows}</ul>`
      : '<p>Nenhum goleiro participando. Goleiro que chegar atrasado entra por "+ Atrasado".</p>';
    return shell('Goleiros', body, '<button class="btn primary" data-act="modal-close">Pronto</button>', 'tall');
  }
  const teams = allTeamsInOrder(s);
  const all = [...teams.flatMap((t) => t.gks.map((g) => ({ g, t }))), ...s.bench.map((g) => ({ g, t: null }))];
  const body = all.length
    ? `<p class="muted small">Distribuição dos goleiros (controle separado dos jogadores de linha).</p>
    ${all.map(({ g, t }) => `<div class="pick-team"><div><b>🧤 ${esc(s.snapshot[g].name)}</b> ${stars(s.snapshot[g].stars, 'sm')} <span class="muted small">em ${t ? esc(t.label) : 'reserva'}</span></div>
      <div class="chips">${teams.map((x) => `<button class="chip ${t && t.id === x.id ? 'on' : ''}" data-act="gk-move" data-pid="${g}" data-t="${x.id}">${esc(x.label)}${x.gks.length ? '' : ' ⚠'}</button>`).join('')}
      <button class="chip ${!t ? 'on' : ''}" data-act="gk-move" data-pid="${g}" data-t="">Reserva</button></div></div>`).join('')}`
    : '<p>Nenhum goleiro participando.</p>';
  return shell('Goleiros', body, '<button class="btn primary" data-act="modal-close">Pronto</button>', 'tall');
}

function moreModal(s) {
  const field = s.field.map((id) => s.teams[id]);
  const body = `
    <div class="field"><span>Ajuste manual de permanência (correção)</span>
    <div class="chips">${field.map((t) => `<button class="chip ${t.permanence ? 'on' : ''}" data-act="perm" data-t="${t.id}">${t.permanence ? '🛡 ' : ''}${esc(t.label)}</button>`).join('')}</div>
    <p class="muted small">Use apenas para corrigir um registro. O motor normalmente define isso sozinho.</p></div>
    <button class="btn wide" data-act="open-swap">⇄ Trocar jogadores</button>
    <button class="btn wide" data-act="open-gk">🧤 Goleiros</button>
    <button class="btn wide" data-act="go-caixa">💰 Pagamentos do dia</button>
    <button class="btn wide" data-act="go-history">📚 Histórico desta pelada</button>
    <div class="card small"><b>Equipes</b>${allTeamsInOrder(s).map((t) => { const st = teamStats(s, t); return `<div class="small">${esc(t.label)} · ${queueLabel(s, t.id)} · ${st.size} linha · ${fmt(st.sum)}★ · V${t.stats.wins} E${t.stats.draws} D${t.stats.losses}${t.stats.drawPermanences ? ` · ${t.stats.drawPermanences} perm. por empate` : ''}</div>`; }).join('')}</div>`;
  return shell('Mais opções', body, '<button class="btn primary" data-act="modal-close">Fechar</button>');
}

function shareModal(m) {
  const o = m.opts;
  const opt = (k, l) => `<label class="switch"><input type="checkbox" data-change="share-opt" data-k="${k}" ${o[k] ? 'checked' : ''}><span>${l}</span></label>`;
  const body = `${opt('includeStars', 'Mostrar estrelas')}${opt('includeOrder', 'Mostrar ordem de saída')}${opt('includeRoles', 'Mostrar funções')}
    <textarea class="share-text" readonly rows="12">${esc(m.text)}</textarea>`;
  return shell('Compartilhar times', body, `<button class="btn" data-act="share-copy">Copiar</button><button class="btn whatsapp" data-act="share-wa">WhatsApp</button><button class="btn primary" data-act="share-native">Compartilhar…</button>`, 'tall');
}
