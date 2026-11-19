// Conexão com o Supabase do ABR.
// A chave abaixo é a chave PUBLICÁVEL (feita para ficar no app, como a antiga "anon key"): ela só
// permite ler os dados e chamar as funções protegidas do banco. Quem decide o que pode ser gravado é o
// banco (RLS + funções que exigem o PIN mestre — supabase/schema.sql). Nunca coloque aqui a
// chave secreta (service_role / sb_secret_…).
// Equivale às variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY; como o app não tem etapa de build,
// os valores ficam neste arquivo e não é preciso configurar variáveis no Vercel.
export const SUPABASE_URL = 'https://ngdpceohzgouhujoenro.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_KKrp5NlT4OzMd65_3PY71Q_FGYaz7d2';
