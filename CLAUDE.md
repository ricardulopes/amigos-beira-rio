# CLAUDE.md — Pelada Organizada

Instruções de arquitetura e padrões técnicos para trabalhar neste projeto. Leia também o `PRD.md`:
ele é a fonte das regras de negócio (identificadas como `RN-xx`). O `README.md` é para o usuário final.

## Contexto

- PWA mobile-first para organizar peladas (cadastro, sorteio otimizado, fila, rodízio, empates).
  Usado principalmente em celulares Android, **durante** os jogos: a operação precisa ser rápida e à prova de erro.
- O dono do projeto se comunica em **português do Brasil**. Toda interface, mensagem de erro,
  comentário de código, documentação e resposta deve ser em pt-BR.
- Não publicar/hospedar o app nem enviar nada para serviços externos sem pedido explícito do dono.
- A pasta do projeto é `App Pelada Beira Rio` (dentro da Área de Trabalho, que fica sob o OneDrive).
  Essa localização foi confirmada pelo dono: trabalhe e salve normalmente nela.

## Ambiente

- Windows, PowerShell 5.1. **Não há Node, npm nem Python instalados.** Não presuma que existam.
- Servidor local (sem dependências): `powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080`
  → app em `http://localhost:8080`, testes em `http://localhost:8080/tests/index.html`.
- Para o preview do navegador do app Claude, use `.claude/launch.json` com a configuração `pelada`
  (runtime `powershell`, args `-NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080`, porta 8080).
  Recrie esse arquivo se ele não existir.
- Escudo e ícones PNG: `powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1` (System.Drawing + C# via
  Add-Type). Lê `Escudo Pelada Beira Rio.jpeg` (fundo branco), remove o fundo e gera `img/escudo-abr.png` e `icons/*`.
- Se um dia houver Node: `node tests/run-node.mjs` roda a mesma suíte.

## Stack e restrições

- HTML + CSS + JavaScript puro com **ES modules**. **Sem frameworks, sem build, sem CDN.** Única dependência:
  `@supabase/supabase-js` 2.118.0 guardado em `vendor/supabase.js` (UMD, `window.supabase`), carregado no `index.html`.
  O app precisa funcionar offline no campo; tudo é servido localmente.
- Dados oficiais no **Supabase** (RN-113 a RN-117): `supabase/schema.sql` (tabelas, RLS só leitura, funções
  `admin_*` com token do PIN mestre, Realtime; visitante só lê, RN-116). O app usa só a chave
  publicável (`src/cloud/config.js`); nunca coloque a chave secreta no app. Cópia local em `localStorage`
  via `src/storage/storage.js` (cache offline). `save()` em `state.js` grava o cache e chama `track()` de
  `src/cloud/sync.js`, que enfileira e envia; não grave na nuvem por outro caminho. Mudou o SQL? Atualize
  `supabase/schema.sql` de forma reexecutável e avise o dono para rodá-lo no SQL Editor.
- Alvo: Chrome Android recente. Pode usar JS moderno (`??`, `?.`, `structuredClone` não é necessário — o projeto usa clone JSON).

## Arquitetura (camadas — respeite as fronteiras)

```
src/domain/    REGRAS DE NEGÓCIO PURAS. Sem DOM, sem navegador, sem armazenamento. Testáveis isoladamente.
  index.js       API PÚBLICA do domínio — a única porta de entrada para ui/ e storage/
  constants.js   posições, tabela de formações, estrelas, limites, motivos de retirada
  stars.js       cálculo de estrelas: validação, soma, média, mediana, amplitude, formatação
  players.js     cadastro: validação/normalização, filtros, snapshot, rascunho do formulário
  tactics.js     atribuição de função (1 função por jogador; b-matching) e desvio tático
  rng.js         gerador com semente (testes reprodutíveis)
  draw.js        sorteio (simulated annealing), goleiros, ordem estratégica, grupos de saída
  setup.js       plano da pelada, aviso de goleiros, tolerância, limites (clamp*), prepareDraw
  session.js     estado da pelada: criação, consultas, validate(), transact(), utilitários internos;
                 goleiros (RN-134 a RN-137): um por time pela ordem de chegada (campo → PRO → RE…), sobra em
                 `gkQueue`; `syncGoalkeepers` no transact põe goleiro solto no 1º time sem goleiro.
                 Pelada sem `gkQueue` = modelo antigo (goleiro sorteado e preso ao time)
  tieRules.js    DECISÃO de vitória/empate (analyzeResult, drawHint, advantageStatus) — não altera estado
  rotation.js    APLICAÇÃO do resultado (registerResult): permanência, fila, divisão/recomposição
  vests.js       coletes Amarelo/Azul do campo (RN-108 a RN-111); sincronizados em transact()
  arrivals.js    atrasados
  removals.js    lesões/saídas com reposição automática em cascata pela fila (RN-76 a RN-78)
  adjustments.js transferência, ordem, troca, goleiros, correção de permanência
  balance.js     avisos de desequilíbrio
  stats.js       desempenho por jogador, resumo do sorteio, grupos de saída da equipe
  share.js       texto para WhatsApp
  admin.js       permissões: visitante só lê × PIN mestre para qualquer alteração, formato do PIN
  roster.js      importação da base em lote: leitura da lista, plano (criar/atualizar/excluir), aplicação
  finance.js     presenças, pagamento do dia (session.payments), cashback, aportes/Pix/modo teste
                 (settings.finance), ciclos manuais e rankings por ciclo (Top 32/Top 4), extrato, reset (RN-118 a RN-128);
                 proteções: ranking guardado, reabrir ciclo, acerto da festa, zerar seguro (RN-129 a RN-132)
src/cloud/diff.js  mescla em três vias das configurações entre admins (RN-133, `mergeAppState`)
src/storage/   persistência (storage.js): esquema, pilha de desfazer, exportar/importar backup
src/ui/        APRESENTAÇÃO E ORQUESTRAÇÃO
  state.js       estado da UI, save(), sessão ativa, modal, toast, navegação
  views.js       telas (funções que retornam HTML)
  modals.js      janelas modais (funções que retornam HTML)
  dom.js         esc(), componentes pequenos (estrelas, badges, ícones)
  app.js         roteamento por hash, render(), tabela `actions`, eventos, exec()
tests/         harness próprio + suítes (*.test.js) + runner de navegador e de Node
```

### Regras inegociáveis

1. **Toda regra de negócio fica em `src/domain/`** — sorteio, cálculo de estrelas, formação,
   empate, rodízio, fila, divisão, atrasados, retiradas, completude, limites de configuração e textos
   que explicam regras. Telas nunca decidem nem calculam regra; chamam o domínio e exibem o resultado
   (ex.: a dica "se empatar…" vem de `drawHint`, o resumo do sorteio de `balanceSummary`).
   Se uma tela precisar de um número derivado de regra, crie a função no domínio e teste-a.
1a. **Fronteira:** `src/ui` e `src/storage` importam o domínio **somente** de `src/domain/index.js`.
   O domínio só importa a si mesmo (`./x.js`) e nunca usa `document`, `window`, `localStorage`,
   `navigator`, `fetch` etc. Isso é verificado por `tests/isolation.test.js`. Módulo novo no domínio
   deve ser exportado em `index.js` (o teste de isolamento lê a lista de lá) e incluído em `DOMAIN` no `sw.js`.
1b. Decidir × aplicar: `tieRules.js` só decide (puro, sem efeitos); `rotation.js` aplica. Mantenha a
   separação ao mexer em regras de resultado.
2. **Comandos do motor são puros e transacionais**: recebem o estado, operam numa cópia dentro de
   `transact()`, chamam `validate()` e retornam `{ state, message?, warnings?, ... }`. Nunca mutam o
   estado recebido. Erros de regra lançam `RuleError` (mensagem amigável em pt-BR); violação de
   invariante lança `Error` e a operação é descartada.
3. **A UI aplica comandos só via `exec(label, fn)`** em `app.js`: ele empilha o estado anterior no
   desfazer, substitui a sessão, salva e mostra mensagem/avisos. Não grave sessão por outro caminho.
4. **Histórico é imutável**: dados de jogador dentro de uma pelada vêm de `session.snapshot`, nunca do
   cadastro atual. Registros de jogos guardam escalações completas (`teamSnapshot`).
5. **Toda movimentação gera entrada em `session.log`** (via `addLog`) com texto em pt-BR legível.
6. Analisar antes de mover: decisões de resultado usam o estado **antes** da movimentação (`analyzeResult`).

### Modelo de dados (resumo)

- Jogador: `{ id, name, stars, type: 'line'|'gk', positions: ['D'|'M'|'A'], createdAt, updatedAt }`.
- Sessão: `{ id, title, status: 'draft'|'live'|'finished', config, snapshot{pid→jogador}, active[pid],
  bench[pid], teams{tid→equipe}, field[tid,tid], queue[tid…], nextTeamNum, arrivals[], removed[],
  games[], log[], draws[] }`.
- Equipe: `{ id: 't<num>', num, label: 'Time <num>', line: [{pid, role}], gks: [pid], permanence,
  stats: { wins, draws, losses, drawPermanences, tossWins }, origin, note }`.
- **Convenção de ordem:** `team.line[0]` = topo (último a sair); último elemento = base (primeiro a sair).
  **Posições são numeradas de baixo para cima** (posição 1 = base = `line[line.length - 1]`); use
  `linePositions(team)` / `positionOf(team, pid)` em vez de calcular índices à mão.
  Quem sai de uma equipe sai sempre pela base (`splice` do final). No rodízio (`rotation.js`), quem
  completa uma equipe incompleta ocupa as vagas **de cima** (`unshift`), sem mover quem já estava.
  O mesmo vale para atrasados (`arrivals.js`, posição R+1) e transferências manuais (`adjustments.js`,
  `moveBlock`). Nas telas e no WhatsApp, o número mostrado é sempre a posição real (`posBadge` em
  `dom.js`), nunca o índice do array. `movePlayerInOrder` recebe o deslocamento em posições (+1 = sobe).
- Banco: `{ schema, players, sessions, settings, activeSessionId, setup }`. Ao mudar o formato, incremente
  `SCHEMA` em `src/storage/storage.js` e trate a migração em `migrate()` sem perder dados existentes.

## Padrões de código

- ES modules com imports relativos e extensão `.js`. Exportações nomeadas.
- Código e identificadores em inglês; **textos visíveis, comentários e mensagens em pt-BR**.
- Estilo: 2 espaços, aspas simples, ponto e vírgula, linhas até ~140 colunas.
- Funções pequenas e com nome claro; comentário só quando explica uma regra ou decisão não óbvia,
  citando a regra (`RN-xx`) quando fizer sentido.
- Números exibidos ao usuário com `formatStars()` do domínio (na UI, o atalho `fmt()` de `dom.js`).
- **Segurança de HTML:** todo texto vindo de dados (nomes, observações, títulos) passa por `esc()`
  antes de entrar em template. Nunca interpole nome de jogador sem `esc()`.
- Aleatoriedade sempre via `createRng(seed)` para que testes sejam reprodutíveis.

## Padrões de interface

- Renderização: funções que retornam strings HTML; `render()` redesenha a tela e restaura foco,
  seleção de texto e rolagem. **Atualização local:** regiões com `id` + `data-patch` (hoje, na chamada: cada linha
  `srow-<id>`, `gk-call`, `setup-sum`, `setup-cta`; em todas as telas, o selo `cloud-bar`) são trocadas sozinhas quando só elas mudaram; se o resto da tela
  mudar, o render é completo. Ao criar uma região assim, dê um `id` estável e não aninhe `data-patch`. Interações por **delegação de eventos** com `data-act` (cliques →
  tabela `actions`), `data-input` e `data-change`. Ao criar um botão, adicione a ação correspondente:
  **nenhum botão pode ficar sem funcionamento**.
- Mobile-first: testar em 360 px de largura. Alvos de toque ≥ 44 px. Sem rolagem horizontal da página.
- Ações que destroem dados (excluir, encerrar, descartar, apagar, importar) passam por modal de confirmação.
- Permissões (RN-114): toda ação `data-act` exige o PIN mestre, exceto as listadas em `FREE_ACTIONS` em `app.js`
  (ver, filtrar, compartilhar, exportar, ficha do jogador só leitura). Campos de ajustes/seleção ficam em `ADMIN_FIELDS`.
  Visitante nunca altera nada (RN-116). Botão novo que só lê/navega entra em `FREE_ACTIONS` **e** em
  `READ_ONLY_ACTIONS` de `tests/isolation.test.js`; o resto fica protegido automaticamente. Função nova no
  SQL liberada ao app deve se chamar `admin_*` e conferir o token (o teste verifica).
  Para pedir o PIN dentro de uma ação, use `withAdmin(acao, fn)` em `app.js`.
  Botão novo que altere cadastro/estrelas/posições ou apague dados deve usar esse caminho; rotina da pelada não.
- Cores via variáveis CSS em `:root`, com variante escura em `prefers-color-scheme: dark`. Identidade ABR:
  Azul `#002B7F` (`--abr-blue`) e Amarelo `#FFD100` (`--abr-yellow`, sempre com texto azul/preto).
  Para texto na cor da marca use `--brand-fg` (vira amarelo no tema escuro). Colete: `vestIcon`/`vestTag` em `dom.js`.
- A tela da partida é a mais importante: resultado sempre acessível no topo, campo e fila visíveis
  com o mínimo de toques, explicação da regra aplicada após cada resultado.

## Testes (obrigatório)

- Toda mudança em regra de negócio exige teste novo ou atualizado em `tests/` **antes** de considerar
  pronto, e toda a suíte precisa passar (hoje: 197 testes). Testes do domínio importam de
  `../src/domain/index.js`, nunca da interface.
- Regras de empate/rodízio: testar o **estado interno** (field, queue, permanence, stats, composição
  das equipes), não só textos. Valores em dinheiro: sempre centavos inteiros (`formatMoney`/`parseMoney`). Use `mkSession(sizes, {goalkeepers, config, stars})` de `tests/helpers.js` (`goalkeepers: k` = fila de goleiros; `gks: [...]` = modelo antigo) para
  montar cenários determinísticos sem passar pelo otimizador.
- Sorteio: use semente fixa e critérios de qualidade (amplitude, formação, mediana), não composições exatas.
- Para rodar: abrir `tests/index.html` no servidor local; o resultado fica em `window.__results`.
- Novas suítes: crie `tests/<nome>.test.js` e importe-a em `tests/index.html` **e** em `tests/run-node.mjs`.
- Além dos testes, verifique fluxos de UI alterados no navegador (preview) em largura de celular e
  limpe dados de teste do `localStorage` do preview ao terminar. Nunca deixe dados fictícios como se fossem reais.

## PWA / service worker

- Ao criar, renomear ou remover arquivo servido pelo app, atualize a lista `ASSETS` em `sw.js`.
- Ao mudar arquivos do app shell de forma relevante, incremente `CACHE` em `sw.js` (`pelada-vN`).
- Estratégia atual: rede primeiro, cache como reserva (offline).

## Processo para mudanças

1. Ler a regra no `PRD.md`; se o pedido muda uma regra, **atualizar o PRD** (manter IDs; novas regras
   recebem o próximo número) e registrar conflitos/decisões na seção correspondente.
2. Implementar no domínio → testes → UI → verificação no navegador.
3. Regra ambígua ou conflitante: não simplificar nem escolher em silêncio. Propor a interpretação,
   perguntar ao dono quando a decisão for dele e documentar a decisão no PRD (como em RN-61/RN-62).
4. Atualizar `README.md` quando mudar algo visível ao usuário (como rodar, instalar, regras resumidas).
5. Relatar honestamente o que foi verificado e o que não foi (ex.: ainda não testado em Android real).
