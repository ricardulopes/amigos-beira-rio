# ABR — Amigos Beira Rio (desde 2008)

PWA (instalável no Android) da pelada dos **Amigos Beira Rio**: cadastro permanente de jogadores, sorteio
otimizado, fila PRO/RE/TRI, rodízio, coletes Amarelo/Azul, regras de empate, atrasados, lesões, desfazer,
histórico e backup.
Sem dependências e sem etapa de build: HTML + CSS + JavaScript (ES modules). Funciona offline.

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

Os dados ficam no próprio aparelho (localStorage). Use **Ajustes → Exportar backup** com frequência; o
**Importar backup** restaura tudo (inclusive para passar de um celular para outro).

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

## Modo administrador (PIN)

Cadastrar, editar estrelas/posições, excluir jogadores, importar lista ou backup, apagar dados e
excluir peladas do histórico pedem um **PIN de 4 a 8 números** (criado na primeira vez). Sorteio,
presença, atrasados já cadastrados, resultados e ajustes de equipes ficam livres. A liberação dura
15 min (botão 🔒/🔓 em Jogadores e Ajustes). O PIN fica só no aparelho e não vai no backup.
É uma proteção contra alterações acidentais, não segurança forte.

## Importar lista de atletas

**Jogadores → ⬆ Importar lista de atletas**: cole ou abra um `.txt` com um atleta por linha,
`Nome; estrelas; posições` (ex.: `Branco; 2,5; D`, `Fabio; 2; G`, `Leo Baiano; X` para excluir).
**Conferir lista** mostra o que será criado/atualizado/excluído e os erros por linha; **Aplicar**
grava. "Mesclar" mantém o resto do cadastro; "Substituir" exclui quem não estiver na lista.
Modelo da lista do grupo: `dados/lista-oficial.txt`.

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
  admin.js        PIN de administrador         roster.js  Importação da base em lote
src/storage/      Persistência versionada, pilha de desfazer (40 passos), exportar/importar
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
- Goleiros: um por equipe (prioridade para as primeiras da fila), goleiro mais forte para o time de
  linha mais fraco; excedentes para as equipes mais fracas; aviso de quais ficam sem goleiro.
- Ordem interna: escalonamento fixo por estrelas (posições de baixo para cima). Com 5: posição 5 = 1º
  melhor, 4 = pior, 3 = 3º, 2 = 4º, 1 = 2º melhor; mesmo padrão generalizado para 2 a 15 atletas e para a
  equipe incompleta. Os mais fortes nunca ficam vizinhos.

## Regras de rodízio e empate (decisão em `src/domain/tieRules.js`, aplicação em `src/domain/rotation.js`)

| Situação no momento do resultado | Empate |
|---|---|
| PRO **e** RE completos | Saem os dois (sempre). PRO e RE entram. Na fila: desafiante sem permanência antes do defensor. |
| Só um completo aguardando (ou nenhum), um time defende permanência | Desafiante sem permanência fica (conta como vitória para a regra); defensor sai. |
| Ninguém em campo tem permanência (1º jogo, ou após saída dupla) | Par ou ímpar; vencedor fica com permanência. |

- Vitória: vencedor fica com permanência; perdedor vai ao fim da fila; PRO entra sem permanência.
- Quem sai de campo perde a permanência. Estatísticas separadas: vitórias oficiais, empates,
  permanências por empate, vitórias no par ou ímpar.
- Ao ir para o fim da fila, se a última equipe estiver incompleta, o time que saiu a completa
  **de baixo para cima** (preservando a sequência); o restante forma nova equipe. Não divide se não
  houver vagas. O goleiro acompanha o bloco se a equipe completada estiver sem goleiro.
- "Completa" = N jogadores de linha (+ goleiro se a opção "equipe só é completa com goleiro" estiver ligada).

### Conflito resolvido
"Par ou ímpar no primeiro jogo" × "PRO e RE completos: saem os dois, regra absoluta". Como a seção 18
declara prioridade, **por padrão a saída dupla prevalece**; o par ou ímpar vale quando há no máximo um
completo aguardando. Para quem prefere o contrário há a opção em **Ajustes → Par ou ímpar no 1º jogo
mesmo com PRO e RE completos**.

### Outras decisões
- Atrasado de linha entra na base da última equipe da fila se houver vaga; senão abre nova equipe.
  Goleiro atrasado vai para a primeira equipe (PRO, RE…, depois campo) sem goleiro.
- Saída por lesão, cansaço ou desistência: a vaga é reposta **automaticamente**, na mesma esteira de
  "subir a lista" do rodízio. A posição 1 do Próximo entra no topo do time que perdeu o jogador; a
  posição 1 do Ré vai para o topo do Próximo; a do Tri vai para o Ré, e assim por diante. A vaga termina
  no último time da fila. Se alguém da fila desiste, só os times de trás sobem. Goleiro é reposto pelo
  próximo goleiro da fila. Nenhuma escolha manual; dá para desfazer.
- Editar o cadastro nunca altera peladas anteriores (cada pelada guarda um snapshot dos jogadores).

## Previsto para o futuro
- Bloquear jogadores em equipes específicas antes de um novo sorteio.
- Sincronização entre aparelhos (hoje: exportar/importar backup).
