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
  gera a lista no mesmo formato (ida e volta sem alterações). Exige PIN de administrador (RN-99).
- **RN-112** Lista oficial do grupo **embutida no app** (`src/data/lista-oficial.js`, 78 atletas). Na
  **primeira abertura** num aparelho (nada salvo ainda), o cadastro já começa com ela, sem importação
  manual, e é salvo na hora (ids fixos). Aparelho que já tem dados não é alterado. Depois de "Apagar
  todos os dados" o cadastro fica vazio (a lista não volta sozinha). O botão "Usar lista oficial do
  grupo" na importação preenche o campo com a mesma lista e seleciona "Substituir"; ainda é preciso
  conferir e aplicar. Lista com qualquer linha inválida não é semeada (testado).

---

## 3. Seleção de participantes e configuração

- **RN-08** Antes do sorteio, o usuário marca os presentes. A seleção é da pelada e **não** altera o cadastro.
  Fica salva entre aberturas do app até o próximo sorteio.
- **RN-09** A tela mostra em tempo real: total de linha, total de goleiros, total geral, nº de equipes e
  o plano ("X equipes completas de N + 1 em formação com R").
- **RN-10** Configurações por pelada: N (2 a 15, padrão 5), sortear com ou sem goleiros, e "equipe só é
  completa com goleiro".
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

### 4.1 Goleiros no sorteio

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
- **RN-46** Goleiro na divisão: o goleiro de quem saiu acompanha o bloco transferido quando a recebedora
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

- **RN-54 — Cenário A/D (saída dupla).** Se **PRO e RE estão completos**: os **dois** times em campo
  saem, **sempre**, não importa quantas vitórias, permanência, se acabou de ficar por empate ou quem
  era desafiante. Essa regra é absoluta.
- **RN-55** Na saída dupla, a ordem de volta à fila é: **desafiante sem permanência primeiro**, depois o
  defensor (prioridade do desafiante). Se nenhum tinha permanência, mantém a ordem dos slots (A, depois B).
  O PRO entra no slot A e o RE no slot B. Ambos saem sem permanência.
- **RN-56 — Regra do par ou ímpar.** Se não é saída dupla e **nenhuma** equipe em campo tem permanência
  (primeiro jogo, ou logo após uma saída dupla): o app pede o par ou ímpar. O vencedor fica, no mesmo
  slot, e ganha permanência; o perdedor vai para o fim da fila. O resultado registrado é "empate".
- **RN-57 — Cenários B/C (direito ao empate).** Se não é saída dupla e uma equipe defende permanência
  (ou seja, há no máximo um completo entre PRO e RE): o **desafiante sem permanência fica** em campo e
  passa a defender permanência (permanências por empate +1); o defensor perde a permanência e vai para
  o fim da fila; o PRO entra.
- **RN-58** O direito ao empate não é imunidade: no jogo seguinte, quem ficou por empate é o defensor
  e precisa vencer. Se empatar de novo (sem saída dupla), o novo desafiante é que fica.

### 9.3 Completude da fila

- **RN-59** Para as regras de empate, conta apenas se **PRO** e **RE** estão completos (ver glossário).
  Equipe incompleta nunca conta como completa. Ex.: PRO completo + RE incompleto → só um completo →
  RN-57. PRO e RE completos → RN-54.
- **RN-60** Com a opção "equipe só é completa com goleiro", uma equipe com N de linha mas sem goleiro
  é incompleta para essas regras.

### 9.4 Conflito resolvido: primeiro jogo × saída dupla

O pedido original diz que empate no primeiro jogo vai para par ou ímpar **e** que a saída dupla com PRO
e RE completos é absoluta e tem prioridade. Decisão:

- **RN-61** Por padrão, a **saída dupla prevalece** (a seção de empates declara prioridade). O par ou
  ímpar vale no primeiro jogo quando há no máximo um completo entre PRO e RE.
- **RN-62** Configuração opcional (Ajustes): "Par ou ímpar no 1º jogo mesmo com PRO e RE completos".
  Vale só para o primeiro jogo e só se ninguém tiver permanência.

### 9.5 Interface do resultado

- **RN-63** Três botões sempre visíveis no topo da tela da partida: Vitória do time A, Empate, Vitória do time B.
- **RN-64** Antes de confirmar, o app mostra a explicação do que vai acontecer e, no empate, a checagem:
  é o primeiro jogo? quantos completos aguardam (PRO/RE)? quem defende permanência?
- **RN-65** Depois de confirmar, mostra "Último resultado" com a explicação e todas as movimentações
  (divisões, novas equipes). A tela também indica, antes do jogo, o que acontece se empatar.
- **RN-66** Ajuste manual de permanência existe apenas para correção de registro ("Mais opções").

### 9.6 Tabela-resumo

| Situação no momento do empate | Resultado |
|---|---|
| PRO e RE completos | Saem os dois. PRO e RE entram. Fila: desafiante, depois defensor. |
| Ninguém com permanência, ≤ 1 completo | Par ou ímpar. Vencedor fica com permanência. |
| Alguém defende permanência, ≤ 1 completo | Desafiante fica e ganha permanência; defensor sai. |

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
- **RN-70** Goleiro atrasado: vai para a primeira equipe sem goleiro, na ordem PRO, RE, …, depois campo;
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
- **RN-78** Goleiro retirado: mesma esteira, só entre equipes com goleiro. A próxima equipe na ordem que
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

---

## 15. Compartilhamento (WhatsApp)

- **RN-90** Texto com título, data, configuração e cada equipe na ordem (campo, depois fila), com rótulo
  (EM JOGO/PRO/RE…), colete das equipes em campo (🟡 Amarelo / 🔵 Azul, RN-108), soma de estrelas, goleiro (ou "sem goleiro") e jogadores numerados pela posição real
  (topo listado primeiro, posição 1 por último com a marca "sai 1º"), igual às telas.
- **RN-91** Opções: mostrar estrelas, mostrar ordem de saída, mostrar funções.
- **RN-92** Ações: compartilhamento nativo do celular, abrir WhatsApp, copiar texto.

---

## 16. Armazenamento, backup e restauração

- **RN-93** Os dados ficam no aparelho (localStorage), com esquema versionado e migração. O app pede
  armazenamento persistente ao navegador.
- **RN-94** Exportar backup (arquivo JSON) e enviar backup (compartilhamento de arquivo).
- **RN-95** Importar backup: valida o arquivo (jogadores pela mesma validação do cadastro; peladas pela
  validação de integridade), mostra o resumo, pede confirmação, substitui os dados e guarda uma cópia
  dos dados anteriores.
- **RN-96** "Apagar todos os dados" com confirmação (mantém apenas as configurações).
- **RN-97** Configurações padrão em Ajustes: nome do grupo, tolerância, N, goleiros, goleiro obrigatório,
  par ou ímpar no 1º jogo.

### 16.1 Modo administrador por PIN (`src/domain/admin.js`)

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

---

## 17. Requisitos não funcionais

- Mobile-first (referência: 360 px de largura), botões grandes (mín. ~44 px), alto contraste para uso
  ao ar livre, tema claro/escuro automático.
- Identidade visual da **ABR — Amigos Beira Rio (desde 2008)**: escudo oficial (`img/escudo-abr.png`,
  fundo transparente) no cabeçalho e em destaque na tela inicial; ícones do PWA gerados do escudo
  (`tools/make-icons.ps1`). Paleta: Azul Royal `#002B7F` (cabeçalho, filtros ativos, textos fortes),
  Amarelo Ouro `#FFD100` (ação principal, estrelas, destaques — sempre com texto azul ou preto), fundo
  `#F4F6F9` com cartões brancos e bordas sutis.
- PWA instalável (manifesto + ícones + service worker) e **funciona offline**. A instalação no Android
  exige hospedagem HTTPS.
- Sem dependências externas e sem etapa de build.
- Sorteio de um grupo típico (20–30 jogadores) em cerca de 100 ms.

---

## 18. Testes automatizados (cobertura atual: 119 testes)

Executar em `tests/index.html` (navegador) ou `node tests/run-node.mjs`.

| Arquivo | Cobre |
|---|---|
| `tests/rules.test.js` | Os 12 cenários de empate exigidos (1 a 12), variações (1b, 1c, 8b), rodízio básico, exemplo de divisão, não-divisão, goleiro na divisão, conservação de jogadores em 10 jogos seguidos |
| `tests/operations.test.js` | Atrasados (exemplo dos 23), goleiro atrasado, aviso de desequilíbrio, retirada com reposição em cascata (campo, fila, último da fila, sem fila, equipe esvaziada, goleiro, permanência e rodízio depois da retirada), transferência, ordem, goleiros, integridade, transação, desfazer, estatísticas, cadastro, snapshot, backup, texto de compartilhamento |
| `tests/draw.test.js` | Atribuição de função, planejamento de equipes, equilíbrio técnico e tático, equipe em formação, goleiros, ordem estratégica |
| `tests/domain.test.js` | Cálculo de estrelas (validação, soma, média, mediana, amplitude, formatação), plano da pelada, aviso de goleiros, tolerância, limites, preparação do sorteio, dicas de empate, situação de vantagem, resumos |
| `tests/admin.test.js` | SHA-256 (vetores oficiais), formato do PIN, hash com sal, acerto/erro, bloqueio por tentativas, operações protegidas × livres, expiração; leitura da lista em lote (formatos, "Felipe 2", erros), mesclar, X, jogador novo incompleto, ida e volta, substituir |
| `tests/vests.test.js` | Coletes Amarelo/Azul: abertura, vitória de cada cor, sequência de vitórias, empate com saída dupla, empate com um só saindo, indicador neutro da PRO, prévia e explicação, WhatsApp, integridade (cores diferentes), migração de peladas antigas |
| `tests/isolation.test.js` | O domínio não usa DOM/navegador/armazenamento, só importa a si mesmo, e interface/persistência só o acessam por `src/domain/index.js` |

---

## 19. Pendências e itens futuros

- **Não testado em um Android real** (só em emulação de tela no navegador).
- Bloquear jogadores em equipes específicas antes de um novo sorteio (previsto no pedido original).
- Sincronização entre aparelhos (hoje: exportar/importar backup).
- Divisão automática considera só a última equipe da fila (RN-49); a cascata de retirada (RN-76) garante
  que as vagas por lesão terminem nela.
