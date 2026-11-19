// Lista oficial de atletas do grupo, embutida no app (RN-112).
// É o cadastro inicial de quem abre o app pela primeira vez (armazenamento vazio) e também o texto do
// botão "⭐ Usar lista oficial do grupo" na importação em lote.
// Formato: Nome; estrelas; posições — estrelas 1 a 3 (de 0,5 em 0,5); posições D, M, A; G = goleiro.
// Origem: lista enviada pelo dono (exportada do app Time Equilibrado), revisada na auditoria de 2026-11-19:
// Wagner unificado em Vagner, Humberto excluído, Cabeção → Jonathan (Cabeção), Mauricio → Maurício Pai,
// grafias e acentos padronizados e 3 goleiros novos (Johnin, João Marcos, Paulão).
// 79 atletas: 74 de linha + 5 goleiros. Para atualizar, edite as linhas abaixo.
export const OFFICIAL_ROSTER = `
Alves; 2; D
Ari; 2,5; D,M
Balão; 2,5; M,A
Branco; 2,5; D
Cantor; 2,5; M,A
Chico; 1,5; D
Danilo; 3; M,A
Eliak; 2; M,A
Erik; 2,5; D,M
Fabiano; 2; A
Fabio; 1,5; G
Fabrício; 2,5; D,M
Felipe; 2; M
Felipe II; 2; M
Fernando; 2,5; A
Fonti; 2,5; D,A
Gabriel; 2,5; M
Gardênio; 2; D,M
Gustavo; 2; M
Igor; 3; M,A
Isaías; 2,5; D,M
Ivan; 1,5; M,A
Izio; 2; M,A
Jabá; 2; D
Japa; 3; D,M
Jarbas; 2; G
Jarlesson; 3; D,M
Jiló; 2,5; M,A
João; 2,5; D,M
João Marcos; 1,5; G
João Vitor; 2; D,M
Johnin; 1,5; G
Joilton; 2,5; D
Jonathan (Cabeção); 1,5; D,M
JP; 2,5; D
Júlio; 2,5; M,A
Kaká; 2; M
Kauã; 2; M,A
Kleuber; 2,5; M
Leiçon; 1,5; D
Leo Baiano; 1,5; D,M
Leozinho; 2,5; M,A
Ligeiro; 2; M
Lucas Lobo; 1,5; D
Luizão; 1,5; D
Luizinho; 1,5; D
Marcelo; 2; D
Marcos; 2; D,M
Marra; 1; A
Matheus; 1,5; D,A
Maurício Filho; 1,5; D,M
Maurício Pai; 1; D
Natan; 2; D,M
Neto; 1; D
Nilson; 1; D
Paulão; 1,5; G
Pedro; 1,5; D,A
Phablo; 1,5; D
Rafael; 2,5; M,A
Renato; 2; D,M
Ribeiro; 2; M
Ricardo; 2,5; D,M,A
Roger; 2; D,A
Rogério; 1,5; A
Ryan; 1,5; D,M
Sandro; 1,5; D,M
Thiago; 3; M,A
Tuquinha; 3; M,A
Udsney; 1,5; A
Ulisses; 1,5; D,M
Vagner; 1,5; D,M
Van; 2; M,A
Vandame; 2; D,M
Viana; 2,5; D
Vicente; 2,5; D,M
Vinícius; 2; M
Waguinho; 2; D,M
Wender; 2,5; D,A
Wesley; 1,5; D
`.trim();
