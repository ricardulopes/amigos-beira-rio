# PRD — Pelada Organizada

Documento de requisitos consolidado. Ele descreve **o comportamento atualmente implementado** e as
decisões tomadas onde as regras originais eram ambíguas ou conflitantes. Em caso de dúvida, este
documento é a referência de regra de negócio; o código de referência está em `src/domain/`
(empates: `tieRules.js` e `rotation.js`; sorteio: `draw.js` e `setup.js`; estrelas: `stars.js`).

Cada regra tem um identificador (`RN-xx`) para ser citada em discussões, commits e testes.

---

## 1. Visão geral

Aplicativo mobile-first (PWA instalável no Android, funciona offline) para organizar peladas de
futebol entre amigos — personalizado para a pelada **ABR — Amigos Beira Rio (desde 2008)** —, do
cadastro dos jogadores até o encerramento da sequência de jogos:

1. Cadastro permanente de jogadores.
2. Seleção dos presentes e configuração da pelada.
3. Sorteio otimizado (equilíbrio técnico e tático, equipe em formação, goleiros, ordem de saída).
4. Partida em andamento: campo, fila (PRO, RE, TRI…), resultados, rodízio e regras de empate.
5. Atrasados, lesões/saídas com reposição automática em cascata, transferências, ajustes de ordem, desfazer.
6. Histórico imutável, estatísticas, compartilhamento no WhatsApp, backup e restauração.

### Glossário

| Termo | Significado |
|---|---|
| **N** | Jogadores de linha por equipe (configurável de 2 a 15; padrão 5). Não inclui o goleiro. |
| **Equipe completa** | Tem N jogadores de linha (e goleiro, se a opção "só é completa com goleiro" estiver ligada). |
| **Equipe em formação** | Equipe incompleta, normalmente a última da fila, que recebe atrasados e sobras. |
| **Campo** | As duas equipes jogando (slot A e slot B). |
| **Fila** | Equipes aguardando, em ordem: PRO (próximo), RE (seguinte), TRI (terceiro), 4º, 5º… |
| **Ordem interna** | Sequência dos jogadores de uma equipe, de cima (topo) para baixo (base). |
| **Base / sai 1º** | O último jogador da lista: é o primeiro a ser transferido quando a equipe é dividida. |
| **Posição** | Numeração de baixo para cima: posição 1 = base (sai primeiro), posição N = topo (RN-33a). |
| **Permanência** | Estado de uma equipe em campo que conquistou o direito de ficar (por vitória, por empate como desafiante ou por par ou ímpar) e agora o **defende**. |
| **Desafiante** | Equipe em campo sem permanência, enfrentando quem defende permanência. |
| **Pelada / sessão** | Uma sequência de jogos de um dia, com seus participantes, sorteio, jogos e movimentações. |

---

## 2. Cadastro permanente de jogadores

- **RN-01** Cada jogador tem: nome, classificação técnica, tipo (`linha` ou `goleiro`) e posições.
- **RN-02** Classificação: 1, 1,5, 2, 2,5 ou 3 estrelas. Nenhum outro valor é aceito.
- **RN-03** Posições de linha: Defesa (D), Meio-campo (M), Ataque (A). Um jogador de linha tem **uma,
  duas ou três** posições (mínimo uma). Posições não são exclusivas.
- **RN-04** Goleiros são categoria separada, com classificação própria e **sem** posições de linha
  (ao virar goleiro, as posições são descartadas; ao virar linha, é obrigatório escolher ao menos uma).
- **RN-05** Nome obrigatório, até 40 caracteres, espaços extras removidos. Não pode haver dois jogadores
  com o mesmo nome, ignorando maiúsculas/minúsculas e acentos ("João" = "joao").
- **RN-06** Operações: adicionar, editar (todos os campos, incluindo trocar o tipo), excluir, pesquisar
  por nome (ignora acentos), filtrar por posição, por estrelas e por tipo (goleiros).
- **RN-07** Editar ou excluir um jogador **nunca** altera peladas já registradas: cada pelada guarda um
  *snapshot* (nome, estrelas, tipo, posições) de cada participante no momento em que ele entrou.

### 2.1 Importação da base em lote (`src/domain/roster.js`)

- **RN-103** A base pode ser importada colando uma lista (ou abrindo um `.txt`/`.csv`), um atleta por
  linha. Formato recomendado: `Nome; estrelas; posições` (colunas separadas por `;`, `|` ou tabulação).
  Também aceito em texto livre: `Nome 2,5★ D,M`, `Nome (G) 2`, `Nome X`. Letras: D/M/A = posições,
  **G** = goleiro, **X** = excluir do cadastro; `?` = não informado; linhas com `#` são comentários.
  Em texto livre, número sem ★ e sem casa decimal não vira estrela quando "Nome número" já é um
  jogador cadastrado (ex.: "Felipe 2"); com `;` não há ambiguidade.
- **RN-104** Modo **mesclar** (padrão): o nome identifica o atleta (ignorando maiúsculas e acentos, RN-05).
  Atleta existente é atualizado só no que a linha informar (o resto fica como está) e mantém o mesmo
  id, então o histórico continua ligado a ele. Atleta novo precisa de estrelas e, se for de linha, de
  ao menos uma posição — **nada é inventado**: linha incompleta é recusada e apontada na conferência.
- **RN-105** `X` exclui o atleta do cadastro (peladas já registradas continuam intactas, RN-07). X para
  nome que não existe é apenas ignorado.
- **RN-106** Modo **substituir**: além de mesclar, exclui do cadastro quem não está na lista. Como é
  destrutivo, qualquer linha com erro bloqueia a importação inteira.
- **RN-107** Fluxo: colar/abrir → **Conferir lista** (prévia com novos, atualizados, excluídos, sem
  mudança, ignorados e erros por linha) → **Aplicar** (confirmação extra quando houver exclusões). No
  modo mesclar, linhas com erro são ignoradas e as válidas são aplicadas. "Carregar cadastro atual"
  gera a lista no mesmo formato (ida e volta sem alterações). Exige o PIN mestre (RN-114).
- **RN-112** Lista oficial do grupo **embutida no app** (`src/data/lista-oficial.js`, 79 atletas). Na
  **primeira abertura** num aparelho (nada salvo ainda), o cadastro já começa com ela, sem importação
  manual, e é salvo na hora (ids fixos). Aparelho que já tem dados não é alterado. Depois de "Apagar
  todos os dados" o cadastro fica vazio (a lista não volta sozinha). O botão "Usar lista oficial do
  grupo" na importação preenche o campo com a mesma lista e seleciona "Substituir"; ainda é preciso
  conferir e aplicar. Lista com qualquer linha inválida não é semeada (testado). Com o banco unificado
  (RN-113), a mesma lista também é carregada no Supabase pelo `supabase/schema.sql`; a cópia embutida
  serve de reserva enquanto o aparelho ainda não baixou os dados da nuvem.
  *Auditoria de 2026-11-19 (decidida pelo dono):* Wagner unificado em Vagner (fica o cadastro do Vagner),
  Humberto excluído, Cabeção → "Jonathan (Cabeção)", Mauricio → "Maurício Pai", grafias padronizadas
  (Udsney, Jarlesson, Ryan, Isaías, Kauã, Waguinho, Thiago, JP; Fonti, Phablo e Kleuber mantidos), acentos
  (Gardênio, Luizão, Maurício Filho, Fabrício, Júlio, Rogério, Vinícius, Jabá) e goleiros novos Johnin,
  João Marcos e Paulão (1,5★). Pares confirmados como pessoas diferentes: Roger/Rogério, Felipe/Felipe II,
  João/João Vitor, Van/Vandame/Ivan, Jabá/Japa, Luizão/Luizinho, Maurício Pai/Maurício Filho.

---

## 3. Seleção de participantes e configuração

- **RN-08** Antes do sorteio, o usuário marca os presentes. A seleção é da pelada e **não** altera o cadastro.
  Fica salva entre aberturas do app até o próximo sorteio.
- **RN-09** A tela mostra em tempo real: total de linha, total de goleiros, total geral, nº de equipes e
  o plano ("X equipes completas de N + 1 em formação com R").
- **RN-10** Configurações por pelada: N (2 a 15, padrão 5). *(Até 2026-11-20 havia também "sortear com ou sem
  goleiros" e "equipe só é completa com goleiro"; o dono decidiu removê-las com a fila de goleiros, RN-134.)*
- **RN-11** Horário combinado opcional + tolerância (configurável, padrão 10 min): a tela indica a partir
  de que horas o sorteio é recomendado. É apenas informativo; não bloqueia o sorteio.
- **RN-12** Pode-se cadastrar um jogador a partir da tela de seleção; ele já entra marcado.
- **RN-13** Só pode existir **uma** pelada ativa (rascunho ou ao vivo). Com uma pelada ao vivo, um novo
  sorteio é bloqueado até ela ser encerrada.

---

## 4. Formação das equipes

- **RN-14** Todos os presentes são aproveitados. Número de equipes = ⌊L / N⌋ completas + 1 equipe em
  formação com o resto (R = L mod N), se R > 0. Ex.: L = 21, N = 5 → 5, 5, 5, 5, 1.
- **RN-15** As sobras **não** são espalhadas: ficam concentradas na equipe em formação, sempre a última da fila.
- **RN-16** Se L < N, existe uma única equipe, em formação.
- **RN-17** Ordem inicial: Time 1 e Time 2 começam em campo; Time 3 é PRO, Time 4 é RE, e assim por diante.
  Os nomes "Time X" são identificadores temporários; equipes criadas depois recebem o próximo número.

### 4.1 Goleiros: chamada no sorteio, um goleiro por time e rodízio (RN-134 a RN-137, desde 2026-11-20)

Pedido do dono em 2026-11-20 (revisado no mesmo dia: a primeira versão deixava goleiro só nos dois times em
campo; o dono decidiu que os times da fila também recebem goleiro). **Substitui RN-19 a RN-21, RN-46, RN-60,
RN-70 e RN-78 em toda pelada nova**; peladas criadas antes continuam com o modelo antigo (descrito abaixo).

- **RN-134 — Goleiros separados da chamada de linha e fora do sorteio.** No **topo** da tela de presença fica a
  seção **"Ordem de chegada dos goleiros"** (separada da lista de linha): o admin toca nos goleiros cadastrados à
  medida que chegam (1º, 2º, 3º…), ajusta com ▲ ▼ e desmarca com ✕; cada um mostra para qual time vai
  (`goalkeeperPreview`). A lista de presença abaixo mostra **só jogadores de linha** ("Limpar" não desmarca
  goleiros) e o sorteio é só de linha. Ao tocar em **Sortear** sem nenhum goleiro marcado, o app pergunta antes
  ("Uai, nenhum goleiro foi marcado para hoje!…"), porque há dias sem goleiro. *(Revisado em 2026-11-20 a pedido
  do dono: antes a chamada dos goleiros era uma janela aberta só ao sortear.)* "Novo sorteio" mantém a ordem. As opções
  "sortear com/sem goleiros" e "equipe só é completa com goleiro" foram removidas: equipe completa = N de linha.
- **RN-135 — Um goleiro por time, pela ordem de chegada.** O 1º goleiro vai para o Time 1, o 2º para o Time 2,
  o 3º para o Time 3, e assim por diante, **inclusive times da fila**. Times sem goleiro ficam "aguardando goleiro".
  Se houver mais goleiros que times, os que sobram **aguardam time** (`session.gkQueue`). Todo card de time (em
  campo e na fila) mostra o goleiro dele ou "aguardando goleiro".
- **RN-136 — Rodízio.** Quem permanece em campo (vitória, empate do desafiante, par ou ímpar) mantém o goleiro.
  O goleiro de quem **sai** vai para o **primeiro time sem goleiro**, na sequência campo (lado A, lado B) → PRO →
  RE → … Ex.: 5 times e 3 goleiros — Time 1 vence o Time 2; o Goleiro 2 vai para o Time 4 (o Time 3 já tem o
  Goleiro 3). Na saída dupla, os dois goleiros soltos seguem a mesma sequência (o do lado A primeiro). Goleiro que
  aguardava time tem prioridade sobre o que acabou de sair (*decisão de implementação: quem esperou mais entra
  antes*). A explicação do resultado diz para onde foi cada goleiro. Empate segue a regra dos times.
- **RN-137 — Atrasado, lesão e ajuste.** Goleiro atrasado vai para o **próximo time da sequência sem goleiro**
  (no exemplo, o Time 5); se todos têm goleiro, aguarda no fim da fila de goleiros. Goleiro que se machuca ou vai
  embora é substituído pelo primeiro goleiro que aguarda time; sem ninguém aguardando, o time fica sem goleiro
  até chegar um (*decisão do dono*). Em 🧤 Goleiros (rascunho e partida), ▲ ▼ trocam goleiros de time e ⤓ manda
  um goleiro para a última posição. Rascunhos criados na primeira versão (goleiro aguardando com time sem
  goleiro) são corrigidos ao iniciar a pelada.
- Presença e financeiro não mudam (RN-118 a RN-120): todo goleiro da pelada ganha presença para o ranking de
  goleiros (Top 4); goleiro é isento da taxa e **nunca** gera os R$ 3 automáticos; o cashback dele vem só de
  aportes livres, que abatem a festa/campeonato pelo mesmo valor da linha.

**Modelo antigo (peladas anteriores a 2026-11-20):**

- **RN-18** N não inclui o goleiro.
- **RN-19** Sorteio **sem** goleiros: goleiros presentes ficam como *reserva* (participam, mas não são distribuídos).
- **RN-20** Sorteio **com** goleiros:
  - um goleiro por equipe, com prioridade para as primeiras da fila (as que jogam antes);
  - entre as equipes que recebem goleiro, o goleiro mais forte vai para a equipe de linha mais fraca;
  - goleiros excedentes vão para a equipe com menos goleiros e, em empate, com menor força total (linha + goleiros);
  - goleiros em falta: o app informa **quais equipes ficam sem goleiro**.
- **RN-21** O usuário pode mover goleiros entre equipes ou para a reserva a qualquer momento (controle separado).

---

## 5. Sorteio inteligente (otimização)

O sorteio **não** é aleatório simples: é uma otimização combinatória (simulated annealing com reinícios,
trocando jogadores entre equipes de tamanho fixo), que avalia o custo **global** de uma divisão.
Execuções diferentes produzem divisões diferentes de qualidade equivalente ("novo sorteio").

### 5.1 Atribuição de função (equilíbrio tático)

- **RN-22** Cada jogador de linha recebe **exatamente uma** função (D, M ou A), escolhida **entre as suas
  posições cadastradas**. Um jogador versátil nunca é contado em duas funções.
- **RN-23** Formação desejada por tamanho de equipe (preferência, não regra rígida):

| N | D | M | A | | N | D | M | A |
|---:|---:|---:|---:|---|---:|---:|---:|---:|
| 2 | 1 | 1 | 0 | | 9 | 3 | 4 | 2 |
| 3 | 1 | 1 | 1 | | 10 | 4 | 4 | 2 |
| 4 | 2 | 1 | 1 | | 11 | 4 | 5 | 2 |
| 5 | 2 | 2 | 1 | | 12 | 4 | 5 | 3 |
| 6 | 2 | 3 | 1 | | 13 | 5 | 5 | 3 |
| 7 | 3 | 3 | 1 | | 14 | 5 | 6 | 3 |
| 8 | 3 | 3 | 2 | | 15 | 5 | 6 | 4 |

- **RN-24** A atribuição maximiza quantos jogadores encaixam na formação (emparelhamento ótimo). Quem não
  encaixa recebe, dentre suas posições, a função menos sobrecarregada. Ninguém é excluído.
- **RN-25** "Fora da formação" = número de jogadores que não couberam no alvo (0 = formação ideal).
- **RN-26** Equipes com tamanho diferente de N usam o alvo do próprio tamanho. Equipe de 1 jogador não
  tem alvo (função preferida na ordem D > M > A, entre as posições dele).
- **RN-27** As funções são recalculadas sempre que a composição de uma equipe muda.

### 5.2 Função de custo

Custo total = técnico + tático (completas) + equipe em formação. Pesos atuais (`WEIGHTS` em `draw.js`):

| Componente | Cálculo | Peso |
|---|---|---|
| Técnico | amplitude (maior − menor soma de estrelas entre **completas**) | 3 |
| Técnico | soma dos quadrados dos desvios das somas em relação à média | 1 |
| Tático | jogadores fora da formação, por equipe completa | 1,2 |
| Em formação | \|soma da equipe − Alvo_Incompleto\| (RN-29) | 4 |
| Em formação (desempate) | média de \|estrelas do jogador − mediana do grupo\| | 0,5 |
| Em formação (≥ 2) | jogadores fora da formação do próprio tamanho | 0,8 |
| Em formação (= 1) | 3 − nº de posições do jogador (prefere versátil) | 0,5 |

- **RN-28** O equilíbrio técnico compara somas de estrelas **apenas entre equipes completas**.
- **RN-29 — Equilíbrio preditivo da equipe incompleta.** A equipe em formação (k atletas, faltando N − k
  vagas) **não** é comparada pela soma absoluta com as completas nem recebe "o que sobrou". O sorteio
  busca que a soma de estrelas dos k atletas fique próxima de:

  `Alvo_Incompleto = M_time − (N − k) × M_atleta`

  - `M_atleta` = média de estrelas por atleta de linha presente na pelada;
  - `M_time` = média da soma de estrelas dos times completos (do próprio sorteio em avaliação, por isso
    o alvo é recalculado a cada tentativa do otimizador).

  Assim, quando a equipe receber N − k reforços de nível médio, atinge o patamar dos completos.
  Ex.: completos com 9★, faltam 2 vagas e média de 2★/atleta → alvo = 9 − 2 × 2 = **5★**.
  Entre combinações igualmente próximas do alvo, prefere atletas próximos da mediana do grupo (desempate),
  evitando concentrar ali os melhores ou os piores. Sem times completos (só existe a equipe em formação),
  não há alvo. A tela de resultado do sorteio mostra a soma da equipe em formação, o alvo e o cálculo.
- **RN-30** A equipe em formação deve ter diversidade de posições (3 sobras → idealmente D, M, A;
  2 → D e M; 1 → jogador versátil). São preferências ponderadas, não regras rígidas.
- **RN-31** A equipe em formação entra na otimização global; não é preenchida "com o que sobrou".
- **RN-32** Critérios de qualidade verificados em teste: amplitude entre completas ≤ 0,5 estrela em
  grupos variados; resultado melhor que divisões aleatórias; formação 2-2-1 obtida quando possível;
  soma da equipe em formação a no máximo 0,5★ do Alvo_Incompleto (medição em 40 grupos aleatórios de
  21 a 29 atletas: desvio máximo 0,42★, médio 0,15★, sem piorar a amplitude entre completos).

---

## 6. Ordem estratégica dentro das equipes

- **RN-33** Cada equipe tem uma ordem de cima para baixo. Quando a equipe é dividida, **os jogadores
  saem pela base**: primeiro o último da lista, depois o penúltimo etc.
- **RN-33a** Numeração das posições, **de baixo para cima**: posição 1 é a base (primeiro a sair) e a
  posição N é o topo. Uma equipe com R atletas ocupa as posições 1..R; as vagas abertas são R+1..N.
- **RN-34 — Escalonamento interno das posições.** No sorteio, a ordem de cada equipe **não é aleatória**:
  os atletas são classificados do 1º melhor ao último (por estrelas) e distribuídos por um padrão fixo
  que intercala as forças, para que os mais fortes nunca fiquem em posições vizinhas e não subam juntos
  quando o time perder e for dividido. O padrão preenche "camadas" de fora para dentro:
  - camada 1: **1º melhor no topo** (posição N) e **2º melhor na base** (posição 1);
  - camada 2: o **pior** logo abaixo do topo (N − 1) e o **2º pior** logo acima da base (2);
  - camada 3: o 3º melhor em N − 2 e o 4º melhor em 3; camada 4: os próximos mais fracos; e assim por diante;
  - com N ímpar, a posição central fica com quem sobrar.

  | Atletas | Posições 1 → N (de baixo para cima), pelo ranking do time |
  |---:|---|
  | 2 | 2º, 1º |
  | 3 | 2º, 3º (pior), 1º |
  | 4 | 2º, 3º, 4º (pior), 1º |
  | 5 | 2º, 4º, 3º, 5º (pior), 1º |
  | 6 | 2º, 5º, 4º, 3º, 6º (pior), 1º |
  | 7 | 2º, 6º, 4º, 5º, 3º, 7º (pior), 1º |

  Vale para qualquer tamanho de 2 a 15 e para a equipe incompleta (com k atletas, o mesmo padrão com
  tamanho k). Garantia verificada em teste: os ⌈N/2⌉ melhores nunca ocupam posições vizinhas. Atletas com
  as **mesmas estrelas** são intercambiáveis no padrão; entre eles, o app escolhe a disposição que evita
  funções repetidas (D/M/A) entre os 2 e os 3 primeiros a sair.
- **RN-35** O número exibido ao lado de cada jogador é **sempre a sua posição real** (RN-33a): 1 = base,
  primeiro a sair. Vale para todas as telas (sorteio, partida, fila, editar ordem, histórico) e para o
  WhatsApp. As posições 1, 2 e 3 (próximas a sair) ficam destacadas em cores. A tela também mostra função
  atribuída, estrelas e a soma/funções de quem sairia nos grupos de posições 1, 1–2 e 1–3.
- **RN-36** Visualização padrão: topo (posição N) em cima e posição 1 embaixo, como a fila física. Existe
  "inverter visualização" (posição 1 em cima), que **não** altera a ordem armazenada nem a numeração.
- **RN-37** O usuário pode editar a ordem manualmente: ▲ sobe uma posição (sai mais tarde), ▼ desce uma
  posição (sai mais cedo), trocando de lugar com o vizinho. Também pode trocar dois jogadores de linha
  entre equipes (cada um assume a posição do outro).

---

## 7. Novo sorteio e reorganização

- **RN-38** Enquanto a pelada está em **rascunho** (nenhum jogo iniciado): novo sorteio com os mesmos
  participantes, alterar N, alterar configuração de goleiros, editar participantes e sortear de novo,
  ou descartar o sorteio. Cada sorteio recalcula composições, funções e ordens.
- **RN-39** Novo sorteio usa os dados **atuais** do cadastro dos participantes.
- **RN-40** Depois de iniciada (primeiro jogo em andamento), não é possível sortear de novo; ajustes
  são feitos por atrasados, retiradas, reposições, transferências, trocas e edição de ordem.
- **RN-41** Atrasados também podem ser adicionados durante o rascunho (mesma regra da seção 10).

---

## 8. Rodízio (resultado com vitória)

- **RN-42** Ao registrar um resultado, a situação da fila é avaliada **antes** de qualquer movimentação.
- **RN-43** Vitória: o vencedor fica em campo, **no mesmo slot**, e passa a defender permanência
  (vitórias oficiais +1). O perdedor sai, perde a permanência (derrotas +1) e vai para o fim da fila.
  O PRO entra no slot vago. A fila avança (RE vira PRO, TRI vira RE…).
- **RN-44** Toda equipe que **entra** em campo começa **sem permanência**.

### 8.1 Entrada na fila e divisão (recomposição)

- **RN-45** Quando uma equipe sai de campo e vai para o fim da fila:
  - se a **última equipe da fila tem vagas** (R atletas, vagas R+1..N), a equipe que saiu cede seus
    atletas **de baixo para cima**: sua posição 1 ocupa a vaga R+1, a posição 2 ocupa R+2, e assim por
    diante, até completar. Os atletas que já estavam na equipe incompleta **não mudam de posição**;
  - os jogadores que sobrarem formam **uma nova equipe** no fim da fila (novo número, anotada como
    "restante do Time X"), **renumerados a partir de 1** mantendo a sequência (se saíram k atletas, a
    antiga posição k+1 vira a 1, k+2 vira a 2…); a equipe original deixa de existir;
  - exemplo: Time 4 com posições 1–3 e Time 2 perdedor com 5 → posições 1 e 2 do Time 2 vão para as
    posições 4 e 5 do Time 4; posições 3, 4 e 5 do Time 2 formam o novo time como posições 1, 2 e 3;
  - se não sobrar ninguém, a equipe é desfeita (e goleiros remanescentes vão para a recebedora);
  - se a última equipe estiver completa (ou não houver fila), a equipe que saiu entra inteira no fim da
    fila, **sem divisão**.
- **RN-46** *(só peladas antigas; nas novas vale RN-134 a RN-137)* Goleiro na divisão: o goleiro de quem saiu acompanha o bloco transferido quando a recebedora
  está sem goleiro **e** (fica completa com o bloco, ou a equipe que saiu foi totalmente absorvida, ou
  a equipe que saiu tem mais de um goleiro). Caso contrário, o goleiro fica no restante.
- **RN-47** Ordem das operações: (1) quem sai vai para a fila, com divisão se necessário; (2) quem entra
  sai da frente da fila. Assim, uma equipe em formação na frente da fila é completada antes de entrar.
- **RN-48** Quando duas equipes saem (saída dupla), cada uma passa pela RN-45 na ordem definida em RN-55,
  podendo encadear divisões (a primeira completa a equipe em formação, o restante dela é completado pela segunda).
- **RN-49** Só a última equipe da fila recebe jogadores na divisão automática; vagas em outras equipes
  (por lesão, por exemplo) são resolvidas pela cascata automática (RN-76), que leva a vaga até a última.

**Exemplo de referência (teste automatizado):** N = 5; campo Time 1 × Time 2; PRO Time 3 (5); RE Time 4 (2).
Time 1 vence → Time 3 entra; Time 4 vira PRO e as posições 1, 2 e 3 do Time 2 ocupam as vagas 3, 4 e 5
do Time 4; as posições 4 e 5 do Time 2 formam o Time 5 (como posições 1 e 2), que vira RE.

---

## 9. Permanência e regras de empate (PRIORIDADE MÁXIMA)

### 9.1 Estado mantido por equipe

- **RN-50** Cada equipe mantém **separadamente**: vitórias oficiais, empates, derrotas, permanências
  conquistadas por empate, vitórias no par ou ímpar e o estado atual `permanência` (sim/não).
  Um contador de vitórias **não** é usado para decidir empates.
- **RN-51** Ganha permanência: quem vence; o desafiante que fica por empate (conta como vitória **para
  a regra**, mas não é vitória oficial no placar); o vencedor do par ou ímpar.
- **RN-52** Perde permanência: toda equipe que sai de campo, e toda equipe desfeita/redistribuída.
- **RN-53** Invariante: no máximo uma das equipes em campo tem permanência.

### 9.2 Decisão do empate (avaliada nesta ordem)

Definições no momento do empate: **PRO completo**, **RE completo** (RN-59) e "permanência em campo".
Tudo é automático; não há opção em Ajustes (revisado em 2026-11-20 a pedido do dono).

- **RN-56 — 1º jogo: par ou ímpar obrigatório.** Se a **primeira partida** da pelada (Time 1 x Time 2)
  empatar, **sempre** há par ou ímpar, haja ou não times completos na fila:
  - **Cenário A — PRO ou RE incompleto (ou ausente):** o vencedor do par ou ímpar fica, no mesmo slot, e
    ganha permanência; o perdedor vai para o fim da fila.
  - **Cenário B — PRO e RE completos:** os dois times em campo saem e entram PRO (slot A) e RE (slot B).
    O vencedor do par ou ímpar tem a **preferência na fila**: volta antes do perdedor. Ninguém fica com
    permanência. O resultado registrado é "empate" (vitória no par ou ímpar entra nas estatísticas).
- **RN-138 — Do 2º jogo em diante não existe par ou ímpar**, em hipótese alguma. As regras abaixo valem a
  partir do 2º jogo.
- **RN-54 — Saída dupla.** Se **PRO e RE estão completos**: os **dois** times em campo saem, **sempre**,
  não importa quantas vitórias, permanência, se acabou de ficar por empate ou quem era desafiante.
- **RN-55** Ordem de volta à fila na saída dupla: **desafiante sem permanência primeiro**, depois o defensor
  (preferência do desafiante). Se nenhum tinha permanência (times que entraram juntos, ex.: Time 3 x Time 4
  após a saída dupla do 1º jogo), voltam **na ordem em que entraram** (slot A, que entrou primeiro, depois
  slot B). O PRO entra no slot A e o RE no slot B. Ambos saem sem permanência.
- **RN-57 — Direito ao empate do desafiante.** Se não é saída dupla e uma equipe defende permanência: o
  **desafiante sem permanência fica** em campo e passa a defender permanência (permanências por empate +1);
  o defensor perde a permanência e vai para o fim da fila; o PRO entra.
- **RN-58** O direito ao empate não é imunidade: no jogo seguinte, quem ficou por empate é o defensor
  e precisa vencer. Se empatar de novo (sem saída dupla), o novo desafiante é que fica.
- **RN-138a** *(decisão do dono, 2026-11-20)* Caso raro: do 2º jogo em diante, empate entre dois times **sem**
  permanência e **sem** PRO e RE completos (ex.: após uma saída dupla, divisão ou lesão deixou a fila com
  time incompleto): sem par ou ímpar, **fica quem entrou primeiro** (slot A), que ganha permanência
  (permanências por empate +1); o outro vai para o fim da fila.

### 9.3 Completude da fila

- **RN-59** Para as regras de empate, conta apenas se **PRO** e **RE** estão completos (ver glossário).
  Equipe incompleta nunca conta como completa. Ex.: PRO completo + RE incompleto → só um completo →
  RN-57. PRO e RE completos → RN-54.
- **RN-60** *(só peladas antigas; nas novas vale RN-134 a RN-137)* Com a opção "equipe só é completa com goleiro", uma equipe com N de linha mas sem goleiro
  é incompleta para essas regras.

### 9.4 Conflito primeiro jogo × saída dupla — SUBSTITUÍDO

- **RN-61** e **RN-62** *(substituídas em 2026-11-20 por RN-56)*: antes a saída dupla prevalecia no 1º jogo e
  havia a opção "Par ou ímpar no 1º jogo mesmo com PRO e RE completos" em Ajustes. O dono decidiu que o
  par ou ímpar do 1º jogo é obrigatório e automático: com PRO e RE completos os dois saem e o par ou ímpar
  decide a ordem na fila. A opção foi removida (peladas antigas que tinham a opção gravada a ignoram).

### 9.5 Interface do resultado

- **RN-63** Três botões sempre visíveis no topo da tela da partida: Vitória do time A, Empate, Vitória do time B.
- **RN-64** Antes de confirmar, o app mostra a explicação do que vai acontecer e, no empate, a checagem:
  é o primeiro jogo? quantos completos aguardam (PRO/RE)? quem defende permanência? O vencedor do par ou
  ímpar só é pedido no empate do 1º jogo (RN-56).
- **RN-65** *(revisada em 2026-11-21)* A explicação e todas as movimentações de cada jogo (divisões, novas equipes,
  goleiros, coletes) ficam no **Registro** e em "Último jogo" no fim da tela; a caixa "Último resultado" acima dos
  botões saiu e deu lugar à galeria da RN-141. A tela também indica, antes do jogo, o que acontece se empatar.
- **RN-141 — Galeria dos times que saíram** *(2026-11-21)*. Acima dos botões de resultado, miniaturas (4 por linha no
  celular) de todos os times que **saíram de campo** por derrota ou empate, em ordem cronológica. Cada uma mostra o
  time, o colete e o total de estrelas daquele jogo, o goleiro e a linha (função G/D/M/A, nome e estrelas) e uma
  etiqueta "Perdeu p/ Time X" ou "Empatou c/ Time Y". Derrota: **borda e X vermelhos** semitransparentes; empate:
  **borda e X turquesa**. No empate em que um time fica (par ou ímpar, desafiante), só quem saiu aparece. A
  miniatura usa o retrato salvo no apito (`game.teamA/teamB`), então não muda quando os jogadores se misturam na
  fila; desfazer o resultado remove a miniatura. Com mais de 8, mostra as 8 mais recentes e o botão "Ver todos"
  (decisão de implementação, para os botões de resultado não descerem demais). Cálculo em `outGallery` (domínio).
- **RN-66** Ajuste manual de permanência existe apenas para correção de registro ("Mais opções").

### 9.6 Tabela-resumo

| Situação no momento do empate | Resultado |
|---|---|
| 1º jogo, PRO ou RE incompleto | Par ou ímpar. Vencedor fica com permanência; perdedor sai. |
| 1º jogo, PRO e RE completos | Par ou ímpar. Saem os dois; PRO e RE entram; vencedor do par ou ímpar volta antes à fila. |
| 2º jogo em diante, PRO e RE completos | Saem os dois. Fila: desafiante antes do defensor; sem permanência, na ordem em que entraram. |
| 2º jogo em diante, alguém defende permanência | Desafiante fica e ganha permanência; defensor sai. |
| 2º jogo em diante, ninguém com permanência (raro) | Quem entrou primeiro fica e ganha permanência; o outro sai. |

### 9.7 Coletes dupla-face Amarelo/Azul (`src/domain/vests.js`)

A ABR joga com coletes dupla-face (um lado **Amarelo `#FFD100`**, outro **Azul `#002B7F`**). O app indica
qual lado cada equipe em campo veste. A cor fica em `session.vests` (só para as equipes em campo) e é
recalculada em toda transação que muda o campo (resultado, retirada, transferência, atrasado).

- **RN-108** Abertura: a 1ª equipe em campo (Time 1) começa de **Amarelo** e a 2ª (Time 2) de **Azul**.
- **RN-109** Vitória: o vencedor **mantém** a cor; quem sobe da fila (PRO) veste a cor de quem saiu.
  Ex.: Amarelo vence → PRO entra de Azul; Azul vence → PRO entra de Amarelo.
- **RN-110** Empate com saída dupla: a 1ª equipe que sobe (PRO) veste **Amarelo** e a 2ª (RE) veste **Azul**.
- **RN-111** Empate em que só um sai (par ou ímpar, ou desafiante que permanece) e qualquer outra troca
  de campo (retirada que desfaz uma equipe, transferência): quem continua mantém a cor e quem entra veste
  a cor livre. *Decisão confirmada pelo dono (18/11/2026):* o pedido original definia vitória e empate com
  saída dupla; este caso segue a mesma lógica da vitória (a cor acompanha quem fica).
- Integridade: as duas equipes em campo nunca têm a mesma cor (verificado em `validate()`).
- Interface: ícone de colete colorido e faixa "Colete Amarelo/Azul" nos dois times em campo; os botões
  de vitória têm a cor do colete da equipe; a equipe **PRO** mostra o colete dupla-face neutro com
  "Entra com o colete de quem sair" (a cor só é definida pelo resultado); a confirmação do resultado
  mostra "Próxima partida: Time X de Amarelo, Time Y de Azul" e o "Último resultado" registra os coletes.
  Histórico de jogos e texto do WhatsApp (🟡/🔵) também indicam a cor.
- Peladas salvas antes desta regra (esquema 1) recebem as cores pela ordem do campo ao carregar (esquema 2).

---

## 10. Jogadores atrasados

- **RN-67** Botão "Adicionar jogador atrasado": escolher um cadastrado que não está participando, ou
  cadastrar um novo e adicioná-lo na hora.
- **RN-68** Atrasados entram **por ordem de chegada** (registrada com número e horário). Nunca há novo
  sorteio nem reorganização das equipes existentes.
- **RN-69** Jogador de linha atrasado: entra **estritamente por ordem de chegada**, sem considerar
  estrelas nem posições de jogo. Se a última equipe da fila tem R atletas (posições 1..R), o atrasado
  ocupa a **posição R+1**; quem já estava não muda de posição. Com a equipe completa, o próximo atrasado
  abre uma nova equipe em formação no fim da fila, na **posição 1**. Ex.: Time 5 com posições 1 e 2 → o
  1º atrasado entra na 3, o 2º na 4, o 3º na 5 e o 4º abre o Time 6 na posição 1. (Sem fila, considera a
  última equipe em campo apenas se houver menos de duas em campo.) Os avisos de RN-72 continuam apenas
  informativos e nunca mudam onde o atrasado entra.
- **RN-70** *(só peladas antigas; nas novas vale RN-134 a RN-137)* Goleiro atrasado: vai para a primeira equipe sem goleiro, na ordem PRO, RE, …, depois campo;
  se todas tiverem goleiro, vai para a última da fila. Em sorteio sem goleiros, vai para a reserva.
- **RN-71** Estrelas, funções, contagem e completude são atualizadas na hora.
- **RN-72** Aviso de desequilíbrio (sem reorganizar nada): equipe que fica completa com soma diferente
  em ≥ 1,5 estrela da média das demais completas; equipe em formação (≥ 2) com média distante ≥ 0,75 da
  mediana do grupo; equipe com 2 ou mais jogadores fora da formação.
- **RN-73** Um jogador retirado anteriormente pode voltar como atrasado (a retirada fica marcada como "retornou").

**Exemplo de referência (teste):** 23 de linha, N = 5 → 5, 5, 5, 5, 3. Quatro atrasados: os dois primeiros
completam o 5º time; os dois seguintes abrem o 6º; o quinto atrasado entra no 6º.

---

## 11. Lesões e saídas antecipadas

- **RN-74** Retirar jogador por: Lesão, Saída antecipada, Desistência ou Outro motivo (+ observação opcional).
- **RN-75** Afeta só a pelada atual; o cadastro não muda. Contagem, estrelas, funções e completude são
  atualizadas. Equipe que fica vazia é removida (se estava em campo, a próxima da fila entra).
- **RN-76 — Reposição automática em cascata ("subir a lista").** A saída de um jogador de linha segue a
  mesma esteira do rodízio, sem escolha manual e sem considerar posição de jogo ou estrelas:
  - a vaga é suprida pela **posição 1** (próximo a sair) da equipe seguinte na ordem campo → PRO → RE → TRI…:
    equipe em campo (qualquer uma das duas) é reposta pelo **PRO**; equipe da fila, pela equipe logo atrás dela;
  - quem entra ocupa a **vaga de cima** da equipe que recebe (como no rodízio, RN-45); quem estava acima de
    quem saiu desce uma posição; a equipe que cedeu é renumerada a partir de 1 (o 2º vira 1º…);
  - a vaga passa para a equipe que cedeu e a cascata se repete até a **última equipe da fila**, que fica
    com uma vaga a menos (e é desfeita se ficar vazia);
  - vale igualmente para quem sai de dentro da fila (desistência antes de entrar): só as equipes de trás sobem;
  - vaga na última equipe da fila, ou sem fila, fica aberta.
- **RN-77** A retirada não altera permanência, estatísticas, campo nem a ordem das equipes. A lógica de
  vitória/empate/derrota (seções 8 e 9) continua a mesma.
- **RN-78** *(só peladas antigas; nas novas vale RN-134 a RN-137)* Goleiro retirado: mesma esteira, só entre equipes com goleiro. A próxima equipe na ordem que
  tem goleiro cede um; se ela ainda ficar com goleiro, a cascata para; senão continua. Sem goleiro na
  sequência, a equipe fica sem goleiro. Retirada da reserva não move ninguém. Depois de aplicar, o app
  mostra todas as movimentações; tudo vai para o histórico e pode ser desfeito.

> **Decisão (2026-11-18, pedido do dono):** a sugestão manual de reposição por posição/estrelas foi
> substituída pela cascata automática. Interpretação adotada: "topo da fila" = posição 1 da equipe
> (próximo a sair) e "fim do Próximo" = vaga de cima, como no rodízio.

---

## 12. Transferências manuais

- **RN-79** Ferramenta de simulação: equipe de origem, equipe de destino e quantidade k. Saem as
  **posições 1..k** da origem (de baixo para cima) e ocupam as **vagas de cima** do destino: com R atletas
  no destino, a posição 1 da origem vira R+1, a 2 vira R+2, e assim por diante. Quem já estava no destino
  não muda de posição; quem fica na origem é renumerado a partir de 1. A simulação mostra, para cada
  jogador, "pos. X da origem → pos. Y do destino" (mesma lógica do rodízio, RN-45).
- **RN-80** Mostra antes → depois para as duas equipes: jogadores, estrelas e formação D-M-A, além de
  avisos (destino acima de N, desequilíbrio). Só aplica após confirmação.

---

## 13. Partida em andamento — operação e segurança

- **RN-81** Tela principal: botões de resultado (fixos no topo), as duas equipes em campo lado a lado
  (jogadores, função, estrelas, goleiro, marcadores de saída, estado de permanência), ações rápidas e a
  fila com rótulos dinâmicos (PRO, RE, TRI, 4º…). Equipes a partir do 4º lugar da fila aparecem resumidas.
- **RN-82** Ações rápidas: Atrasado, Retirar, Transferir, Ordem, Desfazer, Compartilhar, Registro (log),
  Mais (trocar jogadores, goleiros, ajuste de permanência, histórico). E "Encerrar pelada".
- **RN-83** Toda operação é **transacional**: aplicada numa cópia, validada e só então gravada. Se
  falhar, nada muda e o usuário vê a mensagem.
- **RN-84** Invariantes sempre verificadas: nenhum jogador em duas equipes; nenhum jogador ativo
  desaparecido; todo jogador em equipe é ativo; cada equipe está exatamente uma vez no campo ou na fila;
  no máximo duas em campo; goleiros só em vaga de goleiro e linha só em vaga de linha.
- **RN-85** Desfazer: restaura exatamente o estado anterior da última operação (até 40 passos por pelada).
- **RN-86** Encerrar pelada: move para o histórico (status encerrada) e libera um novo sorteio.

---

## 14. Histórico

- **RN-87** Cada pelada registra: data/hora, título, configuração, snapshot de todos os participantes,
  sorteio(s) realizados (composição e ordem), cada jogo (as duas escalações no momento, resultado,
  cenário aplicado, par ou ímpar, explicação, quem ficou/saiu/entrou, divisões), atrasados com ordem de
  chegada, retiradas com motivo e o log completo de movimentações.
- **RN-88** Telas do histórico: Jogos, Sorteio inicial, Movimentações, Desempenho (J/V/E/D por jogador,
  calculado dos registros dos jogos) e Participantes (dados da época, atrasados, retiradas).
- **RN-89** O histórico nunca é alterado por edições posteriores no cadastro. Pode ser excluído
  manualmente (com confirmação).
- **RN-142 — Aba Sorteio do histórico** *(correção de 2026-11-21)*. Mostra o **sorteio que valeu** (o último antes do
  1º jogo; os anteriores foram refeitos e só contam no rodapé). Causa do bug: a aba lia o 1º sorteio e buscava os
  nomes no snapshot da pelada, que é trocado a cada "Refazer sorteio" com outros participantes; quem só estava no
  1º sorteio ficava em branco (na "Pelada de sábado", 15 de 29 vagas). Agora cada sorteio guarda um retrato
  congelado com nome e estrelas de cada vaga (linha e goleiros). Peladas antigas são recuperadas na leitura: nome
  e estrelas vêm do retrato, senão do snapshot da pelada, senão das escalações salvas nos jogos; sem fonte, a
  vaga aparece como "(sem registro)". Cálculo em `drawLineup` (domínio).
- **RN-143 — Ranking acumulado** *(2026-11-21)*. Histórico → aba **🏅 Ranking** (ao lado de "Peladas"), só leitura, calculado
  das peladas salvas (ao vivo ou encerradas; rascunho não conta). Tabelas separadas de **Linha** e **Goleiros**, pelo
  papel em cada jogo (linha × gol); presença pelo tipo do atleta naquela pelada. Colunas: presenças, jogos,
  V-E-D, pontos (**vitória 3, empate 1, derrota 0**, decisão do dono), aproveitamento = pontos ÷ (3 × jogos) e, na
  linha, a maior sequência de vitórias; nos goleiros, jogos sem perder. Estrelas aparecem só como referência
  (cadastro da pelada mais recente). O app não registra gols, então não há artilharia nem gols sofridos (decisão do
  dono). Filtros: Geral, Este semestre, Últimos 30 dias; ordenar por Pontos, Aproveitamento ou Presença. No
  aproveitamento, quem tem menos de 3 jogos fica abaixo dos demais (aparece esmaecido). Cálculo em `historyRanking`.
- **RN-144 — Aba Jogos do histórico em mural** *(2026-11-21)*. Os textos técnicos de cada jogo saíram dessa aba (continuam
  em "Movimentações"). Cada jogo vira um **quadrante** com "Jogo N" e o desfecho curto ("Vitória Time X", "Empate" e,
  no 1º jogo, quem venceu o par ou ímpar) e as miniaturas dos **dois times** como jogaram (retrato do apito: colete,
  estrelas, goleiro, G/D/M/A, nomes e estrelas). 2 quadrantes por linha = 4 miniaturas na largura do celular.
  Vencedor: limpo, borda azul; perdedor: borda e X vermelhos. Empate *(ajuste de 2026-11-21)*: o X marca só quem **saiu de
  campo** — na saída dupla, os dois com borda e X turquesa; quando um time ficou (par ou ímpar, desafiante, quem entrou
  primeiro), ele aparece limpo e só o que saiu leva o X turquesa. Quem saiu vem do registro do jogo (`game.leaving`);
  jogo antigo sem esse registro marca os dois. Nomes não são cortados: quebram só entre palavras. Cálculo em `gameBoard` (domínio).

---

## 15. Compartilhamento (WhatsApp)

- **RN-90** Texto com título, data, configuração e cada equipe na ordem (campo, depois fila), com rótulo
  (EM JOGO/PRO/RE…), colete das equipes em campo (🟡 Amarelo / 🔵 Azul, RN-108), soma de estrelas, goleiro (ou "sem goleiro") e jogadores numerados pela posição real
  (topo listado primeiro, posição 1 por último com a marca "sai 1º"), igual às telas.
- **RN-91** Opções: mostrar estrelas, mostrar ordem de saída, mostrar funções.
- **RN-92** Ações: compartilhamento nativo do celular, abrir WhatsApp, copiar texto.

---

## 16. Armazenamento, backup e restauração

- **RN-93** Os dados oficiais ficam no **banco unificado na nuvem** (seção 16.2). Cada aparelho guarda
  uma cópia local (localStorage, esquema versionado e migração) para abrir rápido e funcionar sem sinal.
  O app pede armazenamento persistente ao navegador.
- **RN-94** Exportar backup (arquivo JSON) e enviar backup (compartilhamento de arquivo).
- **RN-95** Importar backup: valida o arquivo (jogadores pela mesma validação do cadastro; peladas pela
  validação de integridade), mostra o resumo, pede confirmação, substitui os dados e guarda uma cópia
  dos dados anteriores.
- **RN-96** "Limpar dados deste aparelho" com confirmação: apaga só a cópia local (e o acesso de admin
  do aparelho) e baixa tudo de novo da nuvem. Nada é apagado para os outros. Avisa se houver alterações
  ainda não enviadas. Importar backup (RN-95) substitui os dados na nuvem, para todos (só admin).
- **RN-97** Configurações padrão em Ajustes: nome do grupo, tolerância e N (goleiros e par ou ímpar são automáticos,
  RN-134 e RN-56).

### 16.1 Modo administrador por PIN no aparelho — SUBSTITUÍDO (histórico)

> **Substituído em 2026-11-19 pela seção 16.2 (RN-113 a RN-117).** O PIN criado em cada aparelho foi
> removido (o registro antigo `pelada.admin` é apagado ao abrir o app). Texto mantido só como histórico.

- **RN-98** Autenticação leve, só no aparelho (sem servidor): PIN de **4 a 8 números**. Guarda-se apenas
  sal aleatório + hash SHA-256 (`pelada.admin` no localStorage), nunca o PIN. O primeiro uso de uma
  ação protegida pede para **criar** o PIN (digitar e repetir).
- **RN-99** Exigem PIN: cadastrar jogador (inclusive "novo atrasado" não cadastrado), editar nome,
  estrelas, tipo ou posições, excluir jogador, importar lista em lote, importar backup, apagar todos os
  dados, excluir pelada do histórico, alterar o PIN. **Livres**: ver cadastro e telas, marcar presença,
  sortear, iniciar, registrar resultados, atrasados já cadastrados, lesões/reposições, transferências,
  ordem, trocas, goleiros, desfazer, compartilhar e exportar backup.
- **RN-100** A liberação vale **15 minutos** e renova a cada ação de administrador. Botão 🔒/🔓 em
  Jogadores e em Ajustes para entrar ou bloquear na hora. Recarregar o app bloqueia.
- **RN-101** Após **5 erros** seguidos, espera de 30 s, dobrando a cada novo erro até 5 min (persistente
  entre recargas). Acerto zera o contador.
- **RN-102** O PIN **não vai no backup** e importar um backup não o altera. Esqueceu o PIN: exportar
  backup → limpar os dados do site no Chrome → importar o backup → criar PIN novo.
  **Limite conhecido:** é uma proteção contra alterações acidentais ou casuais, não segurança forte —
  quem tem o aparelho e conhece o navegador consegue contorná-la (tudo roda localmente).

### 16.2 Banco unificado (Supabase) e PIN mestre (`supabase/schema.sql`, `src/cloud/`, `src/domain/admin.js`)

Decisões do dono (2026-11-19): sem sinal, o admin continua e o app envia depois; a nuvem começa só com
os 78 atletas da lista oficial (peladas antigas ficam no backup local). A primeira versão tinha código
por jogador para a própria posição; no mesmo dia o dono **simplificou**: visitante só lê, sem código,
login ou senha, e toda alteração passa a exigir o PIN mestre (RN-116 reescrita).

- **RN-113 — Banco unificado e PIN mestre.** Jogadores, peladas (atual e histórico, com equipes,
  campo, fila, coletes, jogos e registro), seleção de presentes, pelada ativa e ajustes ficam no
  Supabase, iguais para todos os aparelhos. Há **um único PIN mestre** (4 a 8 números) para os
  administradores da ABR, definido no próprio Supabase (`select set_master_pin('…')` no SQL Editor) e
  guardado só como hash bcrypt no servidor. Ninguém cria PIN no aparelho. O login (precisa de internet)
  devolve um acesso válido por **12 horas** naquele aparelho, inclusive sem sinal. 5 erros seguidos
  bloqueiam por 30 s, dobrando até 5 min. "Sair do modo administrador" encerra o acesso; trocar o PIN
  derruba o acesso dos outros aparelhos.
- **RN-114 — Quem pode o quê.** Sem PIN qualquer pessoa **vê todas as abas**, compartilha e exporta
  backup, e **não altera nada** (RN-116). Todo o resto exige o PIN mestre: selecionar
  presentes e sortear, iniciar, resultados, atrasados, retiradas, transferências, ordem, trocas,
  goleiros, coletes, permanência, desfazer, encerrar, cadastro, estrelas, posições de qualquer jogador,
  exclusões, importações, ajustes, excluir histórico e trocar o PIN. A regra vale no servidor: o banco não aceita
  gravação direta (RLS só de leitura) e as funções de gravação conferem o acesso de admin.
- **RN-115 — Sem sinal e conflitos.** O aparelho mantém uma cópia local. Gravação de admin vai para
  uma fila e sobe assim que houver internet (tentativas a cada 20 s e ao voltar o sinal); a barra no
  topo mostra "sem internet" e quantas alterações aguardam. Cada pelada tem número de versão: se dois
  admins alteraram a mesma pelada sem sinal, **vale a de quem enviou primeiro**; o outro é avisado e a
  versão dele fica guardada no aparelho (`pelada.conflito.<id>`). Jogadores e ajustes: vale a última
  gravação.
- **RN-116 — Visitante só lê.** (Reescrita em 2026-11-19; substitui o "código do jogador".) Quem
  abre o app sem PIN é **visitante**: vê em tempo real todas as abas, listas, times, sorteios, placares
  e histórico, **sem digitar nada, sem login e sem senha**, e não altera nada — nem a própria posição.
  Tocar num jogador abre a **ficha só de leitura**; o botão "Editar (admin)" pede o PIN mestre. Não há
  código nem cadastro para jogadores. No servidor, nenhuma função de gravação é liberada sem o acesso de
  admin; o `schema.sql` apaga a função e a tabela de códigos da versão anterior.
- **RN-117 — Tempo real.** Mudanças feitas por qualquer admin aparecem nos outros aparelhos conectados na hora (Supabase Realtime), sem recarregar. Ao reconectar,
  o app baixa tudo de novo para não perder nada. Mudança pendente deste aparelho nunca é sobrescrita
  pelo que chega.

**Chave do Supabase:** o app usa só a chave **publicável** (`src/cloud/config.js`), que permite ler e
chamar as funções protegidas. A chave secreta nunca vai para o app (verificado em teste). Como não há
etapa de build, não há variáveis de ambiente no Vercel.

### 16.3 Financeiro, presenças, cashback e rankings (`src/domain/finance.js`)

Pedido do dono em 2026-11-19: digitalizar o controle de presenças, pagamentos e cashback, começando em
**modo teste** (sem importar a planilha antiga), com uma ferramenta para zerar tudo antes do ciclo oficial.
Não exigiu mudança no banco: presença e pagamento ficam dentro de cada pelada (`peladas.state`) e aportes,
Pix e modo teste ficam nos ajustes do grupo (`app_state.settings.finance`), gravados pelas funções `admin_*` já existentes.

- **RN-118 — Presença.** Cada atleta que está na pelada (no `snapshot`: selecionados, atrasados, retirados
  por lesão e goleiros reserva) tem **uma presença** quando a pelada é **iniciada** (ao vivo ou encerrada).
  Sorteio não iniciado (rascunho) não conta. O tipo da presença (linha ou goleiro) é o daquela pelada: o mesmo
  atleta pode ter histórico como linha e como goleiro. "Jogos realizados" = peladas iniciadas no período.
- **RN-119 — Taxa e pagamento do dia.** Linha paga **R$ 18** por pelada (R$ 15 operacional + R$ 3 retidos para o
  cashback). Goleiro é **isento** (não aceita Pix/Cartão/Dinheiro; aparece como "Isento (goleiro)"). O admin marca,
  por pelada, **Pix**, **Cartão** (maquininha), **Dinheiro** (incluído em 2026-11-20) ou **Isento**; sem marcação = pendente. Tocar de novo na forma
  marcada volta a pendente. O pagamento não é movimentação de jogo: não vai para o desfazer e desfazer um
  resultado não apaga pagamentos.
- **RN-120 — Cashback.** Cada presença como linha **paga** (Pix, Cartão ou Dinheiro) soma **R$ 3** ao cashback do
  período do atleta (RN-128). Goleiros (e quem quiser) acumulam por **aportes livres** lançados pelo admin (ex.: R$ 30,
  R$ 50). *Decisão do dono (2026-11-20, substitui a anterior):* pagamento **pendente** ou marcado **Isento** não gera
  cashback; o crédito aparece assim que o pagamento é marcado. Assim o cashback prometido no extrato é igual ao que o
  caixa reteve (R$ 3 de cada pagante). O extrato mostra quantas presenças ficaram sem cashback por falta de pagamento.
- **RN-121 — Semestres (substituída por RN-128 em 2026-11-19).** Antes o ranking virava sozinho em 1º de
  janeiro/1º de julho e o cashback no fim do ano. Agora o semestre é um **ciclo manual** (RN-128); o calendário
  só serve para sugerir o nome do ciclo ("1º semestre de 2027").
- **RN-122 — Rankings.** "Ranking de Linha" e "Goleiros", por ciclo: presenças, % = presenças ÷ jogos
  realizados no ciclo. Ordem: mais presenças; empate por nome (só para exibir). **Top 32** (linha) e
  **Top 4** (goleiros) ficam destacados com a linha de corte da vaga prioritária no campeonato; empate exatamente
  na linha de corte é avisado (a decisão do desempate é dos organizadores).
- **RN-123 — Festa de fim de ano (R$ 300).** Todo atleta abate o cashback do período da taxa da festa e
  paga só a diferença; com R$ 300 ou mais, a festa aparece como quitada. O cashback **só zera quando o admin
  inicia um ciclo marcando "Zerar (novo ano da festa)"** (RN-128) — não zera mais sozinho na virada do ano.
- **RN-124 — Extrato (livre para todos).** O atleta escolhe o próprio nome (lembrado no aparelho) e vê jogos do
  ciclo aberto (na folga, do ciclo encerrado), com %, cashback do período (presenças × R$ 3 + aportes), quanto
  falta para a festa, pendências de pagamento, os lançamentos do período, o cashback de **todos** os períodos
  anteriores (RN-131) e quantos lançamentos da folga vão para o próximo ciclo. A lista de nomes inclui quem saiu do
  cadastro mas tem presenças, aportes ou acertos (marcado "fora do cadastro"), para o dinheiro continuar conferível.
- **RN-125 — Pix da tesouraria.** O admin configura chave Pix, nome do recebedor, código "Copia e Cola"
  (começa com `000201`) e a imagem do QR Code (reduzida no aparelho para até 480 px). Todos veem e copiam
  em Caixa → Pix e no atalho 💠 da tela inicial.
- **RN-126 — Permissões.** Ranking, extrato e Pix são livres (só leitura). Pagamentos do dia, aportes,
  encerrar/iniciar ciclos, configuração do Pix e o reset exigem o PIN mestre (RN-114).
- **RN-127 — Modo teste e reset.** O financeiro começa em **modo teste** (aviso na aba Caixa). Em Ajustes →
  Financeiro e Pix, o admin pode **zerar os lançamentos**: apaga todas as peladas (histórico, presenças,
  pagamentos) e os aportes, na nuvem e em todos os aparelhos; mantém cadastro, Pix e ajustes; exige digitar
  ZERAR e que nenhuma pelada esteja em andamento. Depois disso o app entra no **ciclo oficial** (os ciclos
  manuais recomeçam com um único ciclo aberto, RN-128).
- **RN-128 — Ciclos manuais (encerrar/iniciar semestre).** Pedido do dono em 2026-11-19: o fechamento real da
  pelada acontece semanas antes do campeonato/festa (sorteio dos times, cobrança de pendências, folga), então o
  período é controlado à mão em Ajustes → Financeiro e Pix (PIN mestre):
  - **Encerrar ciclo/semestre atual**: guarda a data de fim (pode renomear o ciclo, ex.: "2º semestre de 2026").
    O ranking desse ciclo fica fechado e continua consultável em Caixa → Ranking (seletor de ciclos).
  - **Iniciar novo ciclo/semestre**: só com o anterior encerrado; nome obrigatório e único (sugestão: o semestre
    de daqui a um mês). Ranking e contagem de jogos recomeçam a partir dele.
  - Ambos exigem digitar ENCERRAR / INICIAR para confirmar.
  - *Decisão do dono:* pelada (ou aporte) feita **na folga** — depois do encerramento e antes do novo início —
    **conta no próximo ciclo**. Até lá aparece como "⏳ Próximo" no ranking e como aviso no extrato.
  - *Decisão do dono:* o cashback **zera só quando o admin mandar**: ao iniciar o ciclo, escolhe "Continua
    acumulando" (ex.: do 1º para o 2º semestre) ou "Zerar (novo ano da festa)".
  - Sem nenhum ciclo cadastrado existe um ciclo aberto implícito desde o início do ciclo oficial. Os ciclos ficam
    em `settings.finance.cycles` (`{ id, label, start, end, resetCashback, frozen? }`).

Proteções da auditoria de ponto cego (pedido do dono em 2026-11-20):

- **RN-129 — Ciclo encerrado blindado.** Ao encerrar, o app guarda o ranking do ciclo (linha e gol: total de jogos e
  presenças de cada atleta, em `frozen`). Em ciclo encerrado o ranking exibido é o guardado ("🔒 Ranking guardado
  no encerramento") e não muda mais. Pelada de ciclo encerrado **não pode ser excluída** do histórico (é preciso
  reabrir o ciclo, RN-130). Mudar um pagamento de pelada de ciclo encerrado é permitido (pagamento atrasado), mas
  pede confirmação, porque muda o cashback daquele período (o ranking guardado não muda). Rascunhos e peladas da
  folga não são bloqueados.
- **RN-130 — Reabrir o último ciclo encerrado.** Para corrigir um encerramento feito por engano (PIN mestre +
  digitar REABRIR). Na folga, o último ciclo encerrado volta a ficar aberto; o ranking guardado é descartado e as
  peladas/aportes da folga voltam a contar nele. Se um ciclo novo já foi iniciado, ele só pode ser desfeito
  enquanto estiver **vazio** (nenhuma pelada nem aporte depois do início dele); senão o app recusa.
- **RN-131 — Períodos anteriores e acerto da festa.** O extrato lista o cashback de todos os períodos já zerados
  (mais recente primeiro). O admin pode **registrar o acerto da festa** de cada atleta em cada período (data,
  valor do cashback na hora, observação) e desfazer o registro; o acerto é só um registro para a tesouraria, não
  altera o cashback. Fica em `settings.finance.partySettlements`.
- **RN-132 — Zerar mais seguro.** O reset (RN-127) recusa se houver pelada em andamento **ou sorteio em
  rascunho**. No ciclo oficial o botão vira "⚠️ Apagar todo o histórico (recomeçar do zero)" e a palavra exigida
  passa de ZERAR para **APAGAR TUDO**, com aviso de que o histórico real será apagado. A conferência da palavra é
  feita no domínio (`resetCycle`).
- **RN-133 — Dois admins ao mesmo tempo nas configurações.** Aportes, ciclos, acertos, Pix e seleção ficam num
  registro único na nuvem. Para um admin que ficou sem sinal não apagar o que outro gravou, o aparelho guarda a
  versão em que se baseou e, ao enviar, lê a nuvem e **mescla em três vias**: aportes/acertos/ciclos item a item
  (o que cada um incluiu fica, o que um excluiu sai), demais campos pelo lado que mudou; conflito real no mesmo
  campo fica com quem está enviando. A gravação usa `admin_save_app_state_v2`, que só grava se a versão da nuvem
  não mudou no meio (senão o app lê e mescla de novo). Enquanto o `schema.sql` novo não for rodado no Supabase, o
  app mescla do mesmo jeito e grava pela função antiga. Pagamentos e resultados de jogo continuam com o controle
  por pelada (RN-115).
- **RN-139 — Pagamento na chamada** *(2026-11-20)*. Na tela de chamada/presença, cada atleta de **linha marcado** tem
  na frente do nome os botões **Pix**, **Cartão** e **Dinheiro** (goleiros não têm: são isentos, RN-119). Nada
  marcado = pendente; tocar marca (fica destacado); tocar de novo no ativo volta a pendente; tocar em outro troca.
  Antes do sorteio, a marcação fica com a chamada (`setup.payments`, sincronizada com as configurações, RN-133) e
  passa para a pelada no sorteio (só linha presente; desmarcar a presença descarta o pagamento). Com a pelada em
  rascunho ou ao vivo, o botão mexe direto no pagamento da pelada (o mesmo da aba Caixa), então dá para marcar no
  intervalo. Pelada encerrada só se ajusta pela aba Caixa (para não misturar com a chamada da próxima). Isento de
  linha continua só na aba Caixa. Exige o PIN mestre, como todo pagamento.
- **RN-140 — Fechamento de caixa** *(2026-11-20)*. A aba **Caixa do dia** mostra, para a pelada escolhida: por forma
  (Pix, Cartão, Dinheiro) a quantidade de atletas e o valor; os **pendentes** (quantidade, valor e nomes) e a
  **soma geral**, conferida com o esperado (linha presente × R$ 18, sem os isentos). Recebido + pendente = esperado;
  com zero pendentes aparece "Caixa fechado". Cálculo em `cashReport` (domínio), sempre em centavos.

---

## 17. Requisitos não funcionais

- Mobile-first (referência: 360 px de largura), botões grandes (mín. ~44 px), alto contraste para uso
  ao ar livre, tema claro/escuro automático.
- **Tela estável na chamada** *(2026-11-21)*: marcar presença, tocar em Pix/Cartão/Dinheiro e mexer na ordem dos goleiros
  atualizam só a linha/região tocada (linhas, seção de goleiros, resumo e botão Sortear são regiões `data-patch`), sem
  recriar a página; a rolagem compensa mudanças de altura acima, então o item tocado fica parado sob o dedo.
- Identidade visual da **ABR — Amigos Beira Rio (desde 2008)**: escudo oficial (`img/escudo-abr.png`,
  fundo transparente) no cabeçalho e em destaque na tela inicial; ícones do PWA gerados do escudo
  (`tools/make-icons.ps1`). Paleta: Azul Royal `#002B7F` (cabeçalho, filtros ativos, textos fortes),
  Amarelo Ouro `#FFD100` (ação principal, estrelas, destaques — sempre com texto azul ou preto), fundo
  `#F4F6F9` com cartões brancos e bordas sutis.
- PWA instalável (manifesto + ícones + service worker) e **funciona offline**. A instalação no Android
  exige hospedagem HTTPS.
- Sem etapa de build. Única dependência: `@supabase/supabase-js` 2.118.0, guardada no próprio app
  (`vendor/supabase.js`, sem CDN) para funcionar offline.
- Sorteio de um grupo típico (20–30 jogadores) em cerca de 100 ms.

---

## 18. Testes automatizados (cobertura atual: 194 testes)

Executar em `tests/index.html` (navegador) ou `node tests/run-node.mjs`.

| Arquivo | Cobre |
|---|---|
| `tests/rules.test.js` | Os 12 cenários de empate exigidos (1 a 12), variações (1b, 1c, 8b), rodízio básico, exemplo de divisão, não-divisão, goleiro na divisão, conservação de jogadores em 10 jogos seguidos |
| `tests/operations.test.js` | Atrasados (exemplo dos 23), goleiro atrasado, aviso de desequilíbrio, retirada com reposição em cascata (campo, fila, último da fila, sem fila, equipe esvaziada, goleiro, permanência e rodízio depois da retirada), transferência, ordem, goleiros, integridade, transação, desfazer, estatísticas, cadastro, snapshot, backup, texto de compartilhamento |
| `tests/draw.test.js` | Atribuição de função, planejamento de equipes, equilíbrio técnico e tático, equipe em formação, goleiros, ordem estratégica |
| `tests/domain.test.js` | Cálculo de estrelas (validação, soma, média, mediana, amplitude, formatação), plano da pelada, aviso de goleiros, tolerância, limites, preparação do sorteio, dicas de empate, situação de vantagem, resumos |
| `tests/cloud.test.js` | Visitante não grava (mudança sem admin é recusada e não entra na fila); banco unificado: diferenças entre versões, fila offline (sem duplicar, versão-base da primeira mudança, exclusões), pelada nova, mescla com a nuvem com e sem pendências, conversão de linhas |
| `tests/admin.test.js` | Formato do PIN mestre, visitante só vê/compartilha/exporta × PIN mestre para qualquer alteração, sem código do jogador, acesso de 12 h; lista oficial embutida; leitura da lista em lote (formatos, "Felipe 2", erros), mesclar, X, jogador novo incompleto, ida e volta, substituir |
| `tests/vests.test.js` | Coletes Amarelo/Azul: abertura, vitória de cada cor, sequência de vitórias, empate com saída dupla, empate com um só saindo, indicador neutro da PRO, prévia e explicação, WhatsApp, integridade (cores diferentes), migração de peladas antigas |
| `tests/goalkeepers.test.js` | Goleiros (RN-134 a RN-137): ordem de chegada, sorteio só de linha, 1º/2º em campo e fila, vitória/empate/saída dupla com 5 times e 3 goleiros, 1 goleiro só, atrasado, lesão, reordenar, integridade, WhatsApp, presença e cashback do goleiro |
| `tests/finance.test.js` | Financeiro (RN-118 a RN-132): cashback só com pelada paga (Pix/Cartão/Dinheiro), ranking guardado no encerramento e exclusão bloqueada, reabrir ciclo, períodos anteriores e acerto da festa, atleta excluído com aportes, zerar com rascunho/palavra forte no oficial; dinheiro em centavos, R$ 18 = 15 + 3, presença só em pelada iniciada e com o tipo do snapshot, ciclos manuais (encerrar/iniciar, folga conta no próximo, ciclo encerrado consultável), rankings com Top 32/Top 4 e empate no corte, cashback que só zera quando o admin manda e período anterior no extrato, aportes, festa quitada, extrato, pagamento puro (goleiro isento), resumo do caixa, Pix/QR validados, reset |
| `tests/isolation.test.js` | Visitante só lê: ações livres do app só de leitura/navegação, todo campo que altera dados exige PIN, nenhuma função do banco liberada sem ser de admin; o domínio não usa DOM/navegador/armazenamento, só importa a si mesmo, e interface/persistência/nuvem só o acessam por `src/domain/index.js`; nenhuma chave secreta do Supabase no app |

**Não coberto por teste automatizado:** a execução do SQL e a conversa real com o Supabase. Conferido
à mão em 2026-11-19: login com PIN mestre, gravação de ajustes, Realtime entre duas conexões e recusa de
gravação sem PIN e uma pelada inteira (sorteio, resultados, encerramento, histórico). Ainda não
conferidos: fila sem sinal, conflito entre dois admins e Android real.

---

## 19. Pendências e itens futuros

- **Não testado em um Android real** (só em emulação de tela no navegador).
- Bloquear jogadores em equipes específicas antes de um novo sorteio (previsto no pedido original).
- Teste ponta a ponta com o Supabase real e com dois celulares (Realtime, fila offline, conflito).
- Todas as peladas do histórico são baixadas a cada abertura; com muitos anos de histórico, paginar.
- Divisão automática considera só a última equipe da fila (RN-49); a cascata de retirada (RN-76) garante
  que as vagas por lesão terminem nela.
