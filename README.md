# ABR — Amigos Beira Rio (desde 2008)

PWA (instalável no Android) da pelada dos **Amigos Beira Rio**: cadastro permanente de jogadores, sorteio
otimizado, fila PRO/RE/TRI, rodízio, coletes Amarelo/Azul, regras de empate, atrasados, lesões, desfazer,
histórico e backup.
Sem etapa de build: HTML + CSS + JavaScript (ES modules). Dados unificados na nuvem (Supabase), com
cópia em cada aparelho para funcionar offline no campo.

## Como rodar

**No computador (Windows):**

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080
```

Abra `http://localhost:8080`. Testes automatizados: `http://localhost:8080/tests/index.html`.
Com Node instalado também dá para rodar: `node tests/run-node.mjs`.

**No celular Android (instalar como app):** o PWA precisa de HTTPS. A forma mais simples:
1. Publique esta pasta inteira num host estático gratuito (GitHub Pages, Netlify Drop — arrastar a pasta —, Cloudflare Pages).
2. Abra o endereço no Chrome do Android → menu ⋮ → **Instalar app** / **Adicionar à tela inicial**.
3. Depois de aberto uma vez, funciona sem internet (service worker).

Os dados ficam no **banco unificado (Supabase)** e são iguais em todos os celulares; cada aparelho guarda
uma cópia para abrir sem sinal. **Ajustes → Exportar backup** continua disponível para guardar uma cópia.

## Banco na nuvem (Supabase) — configuração única

1. No painel do Supabase do projeto, abra **SQL Editor → New query**, cole o conteúdo de
   `supabase/schema.sql` e clique em **Run**. Isso cria as tabelas, as permissões (RLS), as funções
   protegidas, liga o tempo real (Realtime) e carrega os 79 atletas da lista oficial.
2. Numa consulta separada, defina o **PIN mestre** (4 a 8 números) — não salve o PIN em arquivo:
   `select public.set_master_pin('SEU_PIN');`
3. Pronto: abra o app. Em **Ajustes → Banco na nuvem** deve aparecer "Conectado".

A conexão usa só a chave **publicável** do Supabase, gravada em `src/cloud/config.js` (ela é feita para
ficar no app). **Não é preciso configurar variáveis de ambiente no Vercel**: o app não tem etapa de
build. Nunca coloque a chave secreta (`sb_secret_…` / service_role) no app.

## Identidade visual e ícones

Escudo oficial no cabeçalho, na tela inicial e como ícone do app. Cores: Azul Royal `#002B7F` e Amarelo
Ouro `#FFD100`, fundo `#F4F6F9`. Para regenerar o escudo transparente (`img/escudo-abr.png`) e os ícones
(`icons/`) a partir de `Escudo Pelada Beira Rio.jpeg`:

```bash
powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
```

Se o celular já tinha o app instalado com o ícone antigo, pode ser preciso remover e instalar de novo
para o Android trocar o ícone da tela inicial (o visual e as regras atualizam sozinhos).

## Coletes Amarelo/Azul

O app mostra o colete (dupla-face) de cada equipe em campo:
- **1º jogo:** Time 1 de **Amarelo**, Time 2 de **Azul**.
- **Vitória:** o vencedor continua com a mesma cor; quem entra veste a cor de quem saiu.
- **Empate em que saem os dois:** o 1º que entra veste Amarelo, o 2º veste Azul.
- **Empate em que só um sai** (par ou ímpar ou desafiante que fica): quem fica mantém a cor.
- O time **PRO** mostra um colete metade amarelo/metade azul ("entra com o colete de quem sair") até o
  resultado; a confirmação do resultado já diz as cores da próxima partida.

## Administradores (PIN mestre) e visitantes

- **Visitantes (qualquer pessoa):** só leitura. Veem em tempo real todas as abas, a lista de jogadores,
  times, sorteios, resultados e o histórico, sem login, senha ou código. Podem compartilhar no WhatsApp
  e exportar backup. Tocar num jogador mostra a ficha dele, sem edição.
- **Administradores** entram com o **PIN mestre** único da ABR (botão 🔒 em Jogadores ou Ajustes; precisa
  de internet). O acesso dura 12 horas no aparelho, inclusive sem sinal no campo. Só eles alteram
  qualquer coisa: cadastrar e excluir jogadores, estrelas, posições, presentes, sorteio, iniciar e
  encerrar a pelada, resultados, coletes, atrasados, lesões, ajustes e importações.
- **Atualizar o banco:** se o `supabase/schema.sql` já foi rodado numa versão anterior, rode-o de novo
  (ele remove o antigo código do jogador; o PIN mestre e os dados continuam).
- **Sem sinal:** o admin continua usando o app; as alterações ficam na fila (barra no topo) e sobem
  sozinhas quando o sinal voltar. Se outro admin mexeu na mesma pelada antes, vale a versão dele e você
  é avisado.
- **Trocar o PIN mestre:** Ajustes → Alterar PIN mestre (admin), ou no SQL Editor com `set_master_pin`.

## Caixa: presenças, pagamentos, cashback e rankings (modo teste)

Aba **Caixa** (💲 na barra de baixo). Está em **modo teste**: tudo já funciona e grava na nuvem, mas
será zerado antes do ciclo oficial.
- **Presença:** quem está na pelada ganha uma presença quando ela é **iniciada** (sorteio não iniciado não conta).
- **Linha:** R$ 18 por pelada (R$ 15 operacional + R$ 3 de cashback). Cada presença **paga** (Pix, Cartão ou
  Dinheiro) soma **R$ 3** ao cashback; pendente ou Isento não soma (o crédito aparece quando o pagamento é marcado).
- **Goleiros:** contam presença (ranking Top 4), são isentos da taxa e **nunca** geram os R$ 3 automáticos; o
  cashback deles vem só de **aportes livres** (ex.: R$ 30, R$ 50) lançados pelo admin.
- **Festa (R$ 300):** o cashback abate a taxa; paga-se só a diferença. O cashback só zera quando o admin inicia
  um ciclo novo marcando "Zerar (novo ano da festa)".
- **Ranking de Linha** (Top 32 com vaga prioritária) e **Goleiros** (Top 4), por **ciclo/semestre**, com % sobre os
  jogos realizados. Os ciclos encerrados continuam no seletor do ranking para consulta.
- **Ciclos manuais (admin, Ajustes → Financeiro e Pix):** **🏁 Encerrar ciclo/semestre atual** (fecha o ranking
  para o sorteio do campeonato) e **▶️ Iniciar novo ciclo/semestre** (ranking recomeça). Pedem para digitar
  ENCERRAR / INICIAR. Pelada feita na folga, entre o encerramento e o novo início, conta no próximo ciclo.
  Ao encerrar, o ranking fica **guardado (🔒)**: não muda mais, e as peladas desse ciclo não podem ser excluídas.
  Encerrou por engano? **↩️ Reabrir último ciclo encerrado** (digitar REABRIR); se um ciclo novo já foi iniciado,
  só dá enquanto ele estiver vazio.
- **Extrato (qualquer pessoa):** escolha seu nome e veja jogos, %, cashback, quanto falta para a festa, pendências e
  o cashback de todos os períodos anteriores. O admin registra ali o **acerto da festa** de cada período.
- **Pix:** chave, "Copia e Cola" e QR Code da tesouraria, com botão de copiar (também no atalho 💠 da tela inicial).
- **Admin (PIN mestre):** **Caixa do dia** (marcar Pix, Cartão, Dinheiro ou Isento de cada atleta; atalho
  "💰 Pagamentos" no sorteio e em "⋯ Mais" na partida), **Aportes** e, em **Ajustes → Financeiro e Pix**,
  configurar o Pix/QR Code e **🧹 Zerar lançamentos de teste** (apaga peladas, presenças, pagamentos e aportes;
  mantém cadastro e Pix; pede para digitar ZERAR; recusa com pelada em andamento ou rascunho). Depois de zerar,
  começa o ciclo oficial, e o botão vira **⚠️ Apagar todo o histórico**, que pede APAGAR TUDO.
- **Dois admins ao mesmo tempo:** aportes, ciclos e acertos lançados por admins diferentes (mesmo um deles sem
  sinal) são juntados, sem um apagar o do outro.

## Importar lista de atletas

**Jogadores → ⬆ Importar lista de atletas**: cole ou abra um `.txt` com um atleta por linha,
`Nome; estrelas; posições` (ex.: `Branco; 2,5; D`, `Fabio; 2; G`, `Leo Baiano; X` para excluir).
**Conferir lista** mostra o que será criado/atualizado/excluído e os erros por linha; **Aplicar**
grava. "Mesclar" mantém o resto do cadastro; "Substituir" exclui quem não estiver na lista.
**Lista do grupo já vem no app:** na primeira vez que o app é aberto num aparelho, o cadastro já começa
com os 79 atletas da lista oficial, sem precisar importar, e logo depois passa a mostrar o cadastro da
nuvem. A lista também é carregada no Supabase pelo `supabase/schema.sql`.

## Arquitetura

```
src/domain/       Regras de negócio puras — sem interface, sem navegador, testáveis isoladamente
  index.js        API pública (a interface e a persistência só importam daqui)
  stars.js        Cálculo de estrelas: soma, média, mediana, amplitude, formatação
  players.js      Cadastro: validação, filtros, snapshot
  tactics.js      Atribuição de função (b-matching): 1 função por jogador
  draw.js         Sorteio: simulated annealing + goleiros + ordem estratégica de saída
  setup.js        Plano da pelada, tolerância, limites, preparação do sorteio
  session.js      Estado da pelada, consultas, integridade e transações
  tieRules.js     Decisão de vitória/empate (saída dupla, par ou ímpar, direito ao empate)
  rotation.js     Aplicação do resultado: permanência, fila, divisão/recomposição
  vests.js        Coletes Amarelo/Azul das equipes em campo
  arrivals.js     Atrasados          removals.js    Lesões e reposição em cascata
  adjustments.js  Transferência, ordem, troca, goleiros
  balance.js      Avisos de desequilíbrio      stats.js  Desempenho e resumos
  share.js        Texto para WhatsApp          constants.js / rng.js
  admin.js        Permissões: visitante só lê × PIN mestre para alterar
  roster.js       Importação da base em lote
  finance.js      Presenças, pagamentos, cashback, aportes, rankings, Pix e reset de testes
src/storage/      Cópia local versionada, pilha de desfazer (40 passos), exportar/importar
src/cloud/        Supabase: carga, Realtime, fila offline, login de admin (sync.js); parte pura (diff.js)
supabase/         schema.sql: tabelas, RLS, funções protegidas, Realtime e lista oficial
vendor/           supabase-js 2.118.0 (guardado no app, sem CDN)
src/ui/           Interface (views, modais, controlador). Nenhuma regra de negócio aqui.
tests/            Testes (harness próprio, roda no navegador e no Node), incluindo
                  isolation.test.js, que garante que src/domain não depende da interface
```

Toda operação da partida é **transacional**: o motor trabalha numa cópia, valida as invariantes
(nenhum jogador duplicado ou desaparecido, campo/fila consistentes, tipos corretos) e só então o
novo estado é gravado. Se algo falhar, nada muda. Antes de cada operação o estado anterior vai para a
pilha de desfazer.

## Sorteio

- Equipes completas = ⌊linha / N⌋; sobras ficam concentradas numa equipe **em formação** no fim da fila.
- Custo minimizado globalmente: diferença (amplitude + desvio quadrático) da soma de estrelas entre
  completos, jogadores fora da formação desejada (tabela 2–15), e para a equipe incompleta com k atletas:
  soma próxima de **Alvo = M_time − (N − k) × M_atleta** (média dos completos menos as vagas que faltam
  preenchidas por atletas médios) + diversidade de posições (versatilidade se for 1 jogador).
- Goleiros **não entram no sorteio** (só linha). No **topo** da tela de presença fica a seção **"Ordem de chegada
  dos goleiros"**: toque em cada goleiro à medida que chega (▲ ▼ ajustam, ✕ desmarca); abaixo vem a lista só de
  linha. Se tocar em Sortear sem goleiro marcado, o app pergunta antes. O 1º goleiro vai para o Time 1, o 2º para o Time 2, o 3º para o Time 3… inclusive times da fila; times sem
  goleiro ficam "aguardando goleiro".
- Ordem interna: escalonamento fixo por estrelas (posições de baixo para cima). Com 5: posição 5 = 1º
  melhor, 4 = pior, 3 = 3º, 2 = 4º, 1 = 2º melhor; mesmo padrão generalizado para 2 a 15 atletas e para a
  equipe incompleta. Os mais fortes nunca ficam vizinhos.

## Regras de rodízio e empate (decisão em `src/domain/tieRules.js`, aplicação em `src/domain/rotation.js`)

| Situação no momento do resultado | Empate |
|---|---|
| **1º jogo**, PRO ou RE incompleto | **Par ou ímpar** (sempre no 1º jogo): o vencedor fica com permanência; o perdedor sai. |
| **1º jogo**, PRO **e** RE completos | **Par ou ímpar**: saem os dois, PRO e RE entram; o vencedor do par ou ímpar volta à fila na frente do perdedor. |
| 2º jogo em diante, PRO **e** RE completos | Saem os dois (sempre). Na fila: desafiante antes do defensor; se ninguém tinha permanência (ex.: Time 3 x Time 4), na ordem em que entraram. |
| 2º jogo em diante, um time defende permanência | Desafiante (quem entrou de fora) fica e passa a defender; quem defendia sai. |
| 2º jogo em diante, ninguém com permanência e sem PRO e RE completos (raro) | Quem entrou primeiro fica; o outro sai. |

Do 2º jogo em diante **não existe par ou ímpar**. Essas regras são automáticas (não há opção em Ajustes).

- Vitória: vencedor fica com permanência; perdedor vai ao fim da fila; PRO entra sem permanência.
- Quem sai de campo perde a permanência. Estatísticas separadas: vitórias oficiais, empates,
  permanências por empate, vitórias no par ou ímpar.
- Ao ir para o fim da fila, se a última equipe estiver incompleta, o time que saiu a completa
  **de baixo para cima** (preservando a sequência); o restante forma nova equipe. Não divide se não
  houver vagas.
- "Completa" = N jogadores de linha.
- **Goleiros (rodízio):** quem fica em campo mantém o goleiro; o goleiro de quem perde vai para o **primeiro
  time sem goleiro** (campo, PRO, RE…). Ex.: 5 times e 3 goleiros — Time 1 vence o Time 2 e o Goleiro 2 vai
  para o Time 4. Empate segue a regra dos times. Todo card (campo e fila) mostra o goleiro do time ou
  "aguardando goleiro"; 🧤 Goleiros troca goleiros de time (▲ ▼ ⤓).


### Outras decisões
- Atrasado de linha entra na base da última equipe da fila se houver vaga; senão abre nova equipe.
  Goleiro atrasado vai para o próximo time da sequência sem goleiro (se todos tiverem, aguarda time).
- Saída por lesão, cansaço ou desistência: a vaga é reposta **automaticamente**, na mesma esteira de
  "subir a lista" do rodízio. A posição 1 do Próximo entra no topo do time que perdeu o jogador; a
  posição 1 do Ré vai para o topo do Próximo; a do Tri vai para o Ré, e assim por diante. A vaga termina
  no último time da fila. Se alguém da fila desiste, só os times de trás sobem. Goleiro que sai é reposto
  pelo goleiro que aguarda time (sem ninguém aguardando, o time fica sem goleiro até chegar um). Nenhuma escolha
  manual; dá para desfazer.
- Editar o cadastro nunca altera peladas anteriores (cada pelada guarda um snapshot dos jogadores).

## Previsto para o futuro
- Bloquear jogadores em equipes específicas antes de um novo sorteio.
