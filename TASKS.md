# TASKS — Pelada Organizada

Acompanhamento do desenvolvimento. As regras citadas (`RN-xx`) estão no [PRD.md](PRD.md); os padrões
técnicos, no [CLAUDE.md](CLAUDE.md).

**Como usar este arquivo**
- Cada tarefa é pequena (cabe numa sessão de trabalho) e só é marcada `[x]` quando está implementada,
  coberta por teste (se mexer em regra) e conferida no navegador em largura de celular.
- 🔶 = depende de uma decisão do dono do projeto antes de implementar.
- Tarefas que mudam regra também atualizam o PRD.md (nova `RN-xx` ou ajuste da existente).
- Nada é publicado/hospedado sem pedido explícito do dono.

---

## ✅ Já feito

### Base e arquitetura
- [x] PWA sem dependências (HTML + CSS + JS, ES modules), funcionando offline (service worker, manifesto, ícones PNG).
- [x] Código organizado em `src/domain` (regras puras), `src/storage` (persistência) e `src/ui` (telas).
- [x] Domínio dividido por assunto (estrelas, sorteio, preparação, sessão, decisão de empate, rodízio,
      atrasados, retiradas, ajustes, avisos, estatísticas, compartilhamento) com API única em `index.js`.
- [x] Teste de isolamento: o domínio não usa DOM/navegador/armazenamento e a interface só o acessa por `index.js`.
- [x] Servidor local em PowerShell (`tools/serve.ps1`) e geração de ícones (`tools/make-icons.ps1`).
- [x] Documentação: README.md, PRD.md (137 regras), CLAUDE.md, TASKS.md.
- [x] 185 testes automatizados passando (navegador e Node).
- [x] Goleiros fora do sorteio; seção "Ordem de chegada dos goleiros" no topo da presença (aviso se sortear sem goleiro); um goleiro por
      time (campo e fila); perdedor leva o goleiro ao 1º time sem goleiro (RN-134 a RN-137, 2026-11-20).
- [ ] Usar numa pelada real e revisar com o dono (5 times × 3 goleiros, atrasado, lesão, mais goleiros que times).
- [x] Banco unificado no Supabase com PIN mestre, fila offline e Realtime (RN-113 a RN-117).
- [x] Visitante só lê; toda alteração exige o PIN mestre; código do jogador removido (RN-116, 2026-11-19).
- [x] Rodar `supabase/schema.sql` no Supabase e definir o PIN mestre (dono).
- [x] Conferido no Supabase real: login, gravação de ajustes, Realtime, recusa sem PIN.
- [x] Rodar de novo o `supabase/schema.sql` para remover o código do jogador do banco (dono).
- [x] Pelada inteira gravada no Supabase real (sorteio, resultados, histórico) — 2026-11-19.
- [ ] Teste com dois celulares: sem sinal e conflito entre dois admins.

### Financeiro em modo teste (RN-118 a RN-127)
- [x] Presença por pelada iniciada, cashback de linha (R$ 3), goleiro isento com aportes livres, festa de R$ 300.
- [x] Caixa do dia (Pix, Cartão, Isento), aportes, extrato livre, Pix/QR Code configurável, rankings Top 32/Top 4.
- [x] Zerar lançamentos de teste (Ajustes → Financeiro e Pix) para iniciar o ciclo oficial.
- [x] Ciclos manuais (RN-128): encerrar/iniciar semestre no painel admin, folga conta no próximo ciclo,
      cashback zera só quando o admin manda, ciclos encerrados consultáveis no ranking.
- [x] Estrelas maiores (altura das etiquetas DEF/MEI/ATA) e meia estrela com a parte vazia em preto (#000).
- [x] Auditoria de ponto cego (2026-11-20): cashback só com pelada paga + Dinheiro (RN-120), ranking guardado e
      exclusão bloqueada em ciclo encerrado (RN-129), reabrir ciclo (RN-130), períodos anteriores e acerto da festa
      (RN-131), zerar seguro (RN-132), mescla entre admins nas configurações (RN-133).
- [ ] Rodar de novo o `supabase/schema.sql` no Supabase para criar `admin_save_app_state_v2` (dono).
- [ ] Usar nas próximas peladas e revisar com o dono: desempate na linha de corte?
- [ ] 🔶 Importar o saldo da planilha (15/11/2026) — adiado pelo dono; conciliação de nomes já levantada.

### Cadastro (RN-01 a RN-07)
- [x] Cadastro com nome, estrelas (1 a 3, de 0,5 em 0,5), tipo (linha/goleiro) e posições (D, M, A).
- [x] Editar tudo, inclusive trocar linha ↔ goleiro; excluir com confirmação.
- [x] Nome único (ignora maiúsculas e acentos), validações com mensagens em português.
- [x] Pesquisa por nome e filtros por tipo, posição e estrelas.
- [x] Snapshot por pelada: editar o cadastro não altera o histórico.
- [x] (substituído pelo PIN mestre, RN-113) Modo administrador por PIN no aparelho (RN-98 a RN-102): cadastro, estrelas, posições, exclusões e importações
      protegidos; rotina da pelada livre.
- [x] Importação da base em lote (RN-103 a RN-107): colar/abrir lista, conferir, mesclar ou substituir, X exclui.
- [x] Lista oficial do grupo embutida no app (`src/data/lista-oficial.js`, 79 atletas, sem os 21 marcados com X):
      já aparece na primeira abertura, sem importação manual (RN-112).

### Seleção e sorteio (RN-08 a RN-41)
- [x] Seleção de presentes com contadores, plano de equipes, aviso de goleiros e horário da tolerância.
- [x] N configurável (2 a 15), com ou sem goleiros, "equipe só é completa com goleiro".
- [x] Sobras concentradas numa equipe em formação no fim da fila.
- [x] Sorteio otimizado (simulated annealing): equilíbrio técnico entre completos, formação tática,
      equipe em formação próxima da mediana do grupo, goleiros distribuídos com equilíbrio.
- [x] Atribuição de uma função por jogador (b-matching), sem contar o mesmo jogador duas vezes.
- [x] Ordem estratégica de saída (simula saídas de 1, 2 e 3), marcadores ↓1º/↓2º/↓3º, inverter visualização.
- [x] Novo sorteio, alterar participantes/configuração, descartar; editar ordem, trocar jogadores, mover goleiros.

### Partida, fila e empates (RN-42 a RN-80)
- [x] Rodízio com vitória, divisão/recomposição da equipe em formação de baixo para cima.
- [x] Permanência separada de vitórias oficiais; saída dupla com PRO e RE completos; par ou ímpar;
      direito ao empate do desafiante — os 12 cenários exigidos testados.
- [x] Par ou ímpar obrigatório e automático só no 1º jogo (com saída dupla, decide a ordem na fila); do 2º jogo em diante, sem par ou ímpar e com preferência do desafiante (RN-56, RN-138). Opção de Ajustes removida.
- [x] Atrasados por ordem de chegada, aviso de desequilíbrio sem reorganizar.
- [x] Retirada (lesão, saída, desistência, outro) com reposição automática em cascata pela fila (RN-76 a RN-78).
- [x] Simulação e aplicação de transferência.
- [x] Operações transacionais com validação de integridade e desfazer (40 passos).

### Tela da partida, histórico e dados (RN-81 a RN-97)
- [x] Botões de resultado fixos no topo, times em campo lado a lado, fila com PRO/RE/TRI.
- [x] Explicação da regra antes e depois de cada resultado; dica "se empatar…".
- [x] Histórico: jogos, sorteio inicial, movimentações, desempenho por jogador, participantes.
- [x] Compartilhamento no WhatsApp (nativo, WhatsApp, copiar) com opções.
- [x] Backup: exportar, enviar, importar com validação; apagar tudo.

---

## Fase 1 — Ajustes no Cadastro

- [x] 1.1 Cadastro em lote — feito como importação com estrelas e posições obrigatórias para novos (RN-103 a RN-107).
- [ ] 1.2 Edição rápida de estrelas na própria lista (sem abrir o formulário).
- [ ] 1.3 Ordenação da lista: nome, estrelas, tipo; contador por filtro.
- [ ] 1.4 Aviso ao excluir um jogador que está na pelada ativa (ele continua na pelada pelo snapshot; deixar isso claro).
- [ ] 1.5 Ao trocar goleiro → linha, abrir as posições já destacadas e impedir salvar sem escolher (hoje só valida ao salvar).
- [ ] 1.6 🔶 Apelido opcional (nome curto para as telas estreitas e o WhatsApp). Decidir: apelido substitui o nome nas telas?
- [ ] 1.7 Histórico do jogador: peladas jogadas, J/V/E/D somados de todas as peladas (a partir dos snapshots).
- [ ] 1.8 🔶 Histórico de mudanças de estrelas do jogador (quando e de quanto para quanto). Decidir se vale guardar.
- [ ] 1.9 Lembrança de presentes: botão "marcar os mesmos da última pelada".
- [ ] 1.10 Testes: cadastro em lote (duplicados, nomes vazios), ordenação, estatísticas acumuladas.

## Fase 2 — Motor de Sorteio e Equilíbrio

- [ ] 2.1 Teste de varredura: N de 2 a 15 × grupos de 1 a 60 jogadores (todos aproveitados, nenhum duplicado, plano correto).
- [ ] 2.2 Casos extremos: só goleiros presentes, menos jogadores que N, todos com a mesma posição, todos com a mesma estrela.
- [ ] 2.3 Medir tempo do sorteio com 60 jogadores num celular e ajustar iterações se passar de ~300 ms.
- [ ] 2.4 Painel "por que este sorteio?": soma por time, formação, jogadores fora da formação, nível da equipe em formação vs mediana.
- [ ] 2.5 🔶 Bloquear jogadores em equipes antes de um novo sorteio (pedido original, seção 9). Definir: bloquear por time
      (Time 1, Time 2…) ou só "estes dois juntos / separados"?
- [ ] 2.6 🔶 Regras de afinidade: "nunca no mesmo time" / "sempre no mesmo time" para pares de jogadores. Decidir se entra.
- [ ] 2.7 🔶 Revisar os pesos do sorteio (`WEIGHTS`) com peladas reais: equilíbrio técnico × tático. Decidir prioridades.
- [ ] 2.8 Comparar 2 ou 3 sorteios lado a lado e escolher um (em vez de só "novo sorteio").
- [ ] 2.9 Testes de qualidade da ordem de saída em times de 2 a 15 (nenhum par forte/forte ou fraco/fraco nos 3 primeiros quando evitável).

## Fase 3 — Regras de Empate e Fila

- [ ] 3.1 Teste de propriedade: 500 sequências aleatórias de resultados, atrasados e retiradas, verificando sempre
      as invariantes (RN-53, RN-84) e a conservação de jogadores.
- [ ] 3.2 Testes de desfazer em cada tipo de operação (resultado com par ou ímpar, divisão em cadeia, reposição).
- [x] 3.3 Vagas em equipes que não são a última da fila (após lesão): resolvido pela cascata automática (RN-76).
- [x] 3.4 Reposição em cadeia: feita como cascata automática PRO ← RE ← TRI… (RN-76 a RN-78).
- [ ] 3.5 🔶 Saída dupla com nenhum time defendendo permanência: confirmar que a ordem na fila (slot A, depois B) é a desejada.
- [ ] 3.6 Nota "restante do Time X": atualizar ou remover quando a equipe for completada por outros jogadores.
- [ ] 3.7 🔶 Equipe em campo que fica sem jogadores (lesões): hoje a próxima da fila entra. Confirmar se é o esperado.
- [ ] 3.8 Revisar textos de explicação de cada cenário com o dono (linguagem da pelada).
- [ ] 3.9 Testes com goleiro obrigatório para completude em todos os cenários de empate (RN-60).

## Fase 4 — Tela de Partida em Andamento e PWA

- [ ] 4.1 Teste num Android real (Chrome): instalação, uso offline, botões no sol, rolagem, teclado.
- [ ] 4.2 🔶 Hospedagem HTTPS para instalar no celular (GitHub Pages, Netlify ou Cloudflare). Só quando o dono pedir.
- [ ] 4.3 Manter a tela ligada durante a partida (Wake Lock), com opção de desligar.
- [ ] 4.4 Aviso de nova versão do app ("atualizar agora") quando o service worker mudar.
- [ ] 4.5 Lembrete de backup (ex.: a cada pelada encerrada, oferecer exportar).
- [ ] 4.6 Cronômetro opcional do jogo (com alerta de fim), sem afetar regras.
- [ ] 4.7 Nomes longos nos times em campo: usar apelido (1.6) ou duas linhas quando não couber.
- [ ] 4.8 Modo "letras grandes" para uso ao ar livre.
- [ ] 4.9 Confirmação de resultado em um toque com "desfazer" visível por alguns segundos (opção para quem quer mais rapidez).
- [ ] 4.10 Revisão de acessibilidade: contraste no modo escuro, rótulos de leitores de tela, foco nos modais.
- [ ] 4.11 🔶 Compartilhar os times como imagem (além do texto). Decidir se vale o esforço.
- [x] 4.12 Sincronização entre celulares: feita com o banco unificado no Supabase (RN-113 a RN-117).
