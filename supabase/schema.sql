-- =====================================================================================================
-- ABR — Amigos Beira Rio · banco unificado no Supabase (RN-113 a RN-117)
--
-- COMO USAR: no painel do Supabase, abra "SQL Editor" → "New query", cole este arquivo inteiro e clique
-- em "Run". Pode rodar de novo sem perder dados (tudo é "se não existir" / "substituir função").
-- Depois, defina o PIN mestre numa consulta SEPARADA (não salve o PIN neste arquivo nem no GitHub):
--
--     select public.set_master_pin('SEU_PIN_AQUI');   -- 4 a 8 números
--
-- Segurança:
--  * Qualquer pessoa com o app pode LER jogadores, peladas e ajustes (chave publicável).
--  * Ninguém grava direto nas tabelas (RLS sem política de escrita). Toda gravação passa por funções
--    que conferem o acesso de administrador (token obtido com o PIN mestre). Visitante só lê.
--  * O PIN fica só como hash bcrypt (pgcrypto), em tabelas que o app não consegue ler.
-- =====================================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------------------------- tabelas públicas

create table if not exists public.players (
  id          text primary key default gen_random_uuid()::text,
  name        text not null unique,
  stars       numeric(2,1) not null check (stars between 1 and 3 and stars * 2 = floor(stars * 2)),
  type        text not null check (type in ('line', 'gk')),
  positions   text[] not null default '{}' check (positions <@ array['D','M','A']::text[]),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint players_positions_by_type check (
    (type = 'gk' and cardinality(positions) = 0) or (type = 'line' and cardinality(positions) > 0)
  )
);

-- Pelada atual e histórico. `state` guarda a pelada completa como o motor do app a entende
-- (equipes, campo, fila, coletes, jogos, registro). `version` impede que um admin offline
-- sobrescreva sem querer o que outro admin já enviou.
create table if not exists public.peladas (
  id          text primary key,
  title       text not null default '',
  status      text not null check (status in ('draft', 'live', 'finished')),
  state       jsonb not null,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists peladas_status_idx on public.peladas (status, updated_at desc);

-- Configurações do grupo (uma linha só): ajustes, seleção de presentes e pelada ativa.
create table if not exists public.app_state (
  id                smallint primary key default 1 check (id = 1),
  settings          jsonb not null default '{}'::jsonb,
  setup             jsonb,
  active_pelada_id  text,
  version           integer not null default 1,
  updated_at        timestamptz not null default now()
);
insert into public.app_state (id) values (1) on conflict (id) do nothing;

-- Times e coletes, para consulta (derivados da pelada; o app grava só em `peladas`).
create or replace view public.pelada_times with (security_invoker = true) as
select p.id                                    as pelada_id,
       p.status,
       t.key                                   as team_id,
       t.value ->> 'label'                     as label,
       (t.value ->> 'num')::int                as num,
       case when p.state -> 'field' ? t.key then 'campo'
            when p.state -> 'queue' ? t.key then 'fila' end as onde,
       p.state -> 'vests' ->> t.key            as colete,
       (t.value ->> 'permanence')::boolean     as permanencia,
       t.value -> 'line'                       as linha,
       t.value -> 'gks'                        as goleiros,
       t.value -> 'stats'                      as estatisticas
from public.peladas p, jsonb_each(p.state -> 'teams') t;

create or replace view public.pelada_coletes with (security_invoker = true) as
select p.id as pelada_id, v.key as team_id, v.value as colete
from public.peladas p, jsonb_each_text(coalesce(p.state -> 'vests', '{}'::jsonb)) v;

-- ------------------------------------------------------------------------------------- tabelas privadas

create table if not exists public.admin_secret (
  id            smallint primary key default 1 check (id = 1),
  pin_hash      text,
  failures      integer not null default 0,
  locked_until  timestamptz
);

create table if not exists public.admin_tokens (
  token       uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- ------------------------------------------------------------------------------------- RLS

alter table public.players      enable row level security;
alter table public.peladas      enable row level security;
alter table public.app_state    enable row level security;
alter table public.admin_secret enable row level security;
alter table public.admin_tokens enable row level security;

drop policy if exists "leitura publica" on public.players;
drop policy if exists "leitura publica" on public.peladas;
drop policy if exists "leitura publica" on public.app_state;
create policy "leitura publica" on public.players   for select to anon, authenticated using (true);
create policy "leitura publica" on public.peladas   for select to anon, authenticated using (true);
create policy "leitura publica" on public.app_state for select to anon, authenticated using (true);

-- Tabelas públicas: só leitura. Privadas: nada (sem política = nada passa, e sem permissão).
revoke insert, update, delete, truncate on public.players, public.peladas, public.app_state from anon, authenticated;
revoke all on public.admin_secret, public.admin_tokens from anon, authenticated;
grant select on public.players, public.peladas, public.app_state, public.pelada_times, public.pelada_coletes to anon, authenticated;

-- ------------------------------------------------------------------------------------- Realtime

do $$
begin
  begin alter publication supabase_realtime add table public.players;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.peladas;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.app_state; exception when duplicate_object then null; end;
end $$;

-- ------------------------------------------------------------------------------------- PIN mestre

-- Define/troca o PIN mestre. Só pelo SQL Editor (o app não consegue chamar). Derruba todos os acessos.
create or replace function public.set_master_pin(new_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if new_pin is null or new_pin !~ '^\d{4,8}$' then raise exception 'O PIN deve ter de 4 a 8 números.'; end if;
  insert into admin_secret (id, pin_hash, failures, locked_until) values (1, crypt(new_pin, gen_salt('bf')), 0, null)
  on conflict (id) do update set pin_hash = excluded.pin_hash, failures = 0, locked_until = null;
  delete from admin_tokens;
end $$;

-- Confere o acesso de administrador; uso interno das funções abaixo.
create or replace function public._require_admin(p_token uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_token is null or not exists (select 1 from admin_tokens where token = p_token and expires_at > now()) then
    raise exception 'ADMIN_EXPIRED: o acesso de administrador expirou. Entre com o PIN de novo.';
  end if;
end $$;

-- Login com o PIN mestre. Erros voltam como {ok:false} (não como exceção) para o contador de
-- tentativas ser gravado: 5 erros seguidos bloqueiam por 30 s, dobrando até 5 min.
create or replace function public.admin_login(p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s admin_secret;
  lock_s integer;
  tok uuid;
  exp timestamptz := now() + interval '12 hours';
begin
  select * into s from admin_secret where id = 1 for update;
  if not found or s.pin_hash is null then
    return jsonb_build_object('ok', false, 'message', 'O PIN mestre ainda não foi definido no Supabase.');
  end if;
  if s.locked_until is not null and s.locked_until > now() then
    return jsonb_build_object('ok', false, 'message',
      format('Muitas tentativas erradas. Aguarde %s s.', ceil(extract(epoch from s.locked_until - now()))::int));
  end if;
  if crypt(coalesce(p_pin, ''), s.pin_hash) <> s.pin_hash then
    lock_s := case when s.failures + 1 >= 5 then least(300, 30 * power(2, s.failures + 1 - 5))::int end;
    update admin_secret set failures = s.failures + 1,
      locked_until = case when lock_s is not null then now() + make_interval(secs => lock_s) end
    where id = 1;
    return jsonb_build_object('ok', false, 'message',
      case when lock_s is not null then format('PIN incorreto. Aguarde %s s para tentar de novo.', lock_s)
           else format('PIN incorreto. %s tentativa(s) antes de um bloqueio temporário.', 5 - (s.failures + 1)) end);
  end if;
  update admin_secret set failures = 0, locked_until = null where id = 1;
  delete from admin_tokens where expires_at < now();
  insert into admin_tokens (expires_at) values (exp) returning token into tok;
  return jsonb_build_object('ok', true, 'token', tok, 'expires_at', exp);
end $$;

create or replace function public.admin_logout(p_token uuid)
returns void language sql security definer set search_path = public, extensions as $$
  delete from admin_tokens where token = p_token;
$$;

create or replace function public.admin_change_pin(p_token uuid, p_new_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_token);
  if p_new_pin is null or p_new_pin !~ '^\d{4,8}$' then raise exception 'O PIN deve ter de 4 a 8 números.'; end if;
  update admin_secret set pin_hash = crypt(p_new_pin, gen_salt('bf')), failures = 0, locked_until = null where id = 1;
  delete from admin_tokens where token <> p_token; -- outros aparelhos precisam entrar com o PIN novo
end $$;

-- ------------------------------------------------------------------------------------- gravações do admin

create or replace function public.admin_upsert_players(p_token uuid, p_players jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_token);
  insert into players (id, name, stars, type, positions, created_at, updated_at)
  select x ->> 'id', x ->> 'name', (x ->> 'stars')::numeric, x ->> 'type',
         coalesce(array(select jsonb_array_elements_text(x -> 'positions')), '{}'),
         coalesce((x ->> 'createdAt')::timestamptz, now()), now()
  from jsonb_array_elements(p_players) x
  on conflict (id) do update set name = excluded.name, stars = excluded.stars, type = excluded.type,
    positions = excluded.positions, updated_at = now();
end $$;

create or replace function public.admin_delete_players(p_token uuid, p_ids text[])
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_token);
  delete from players where id = any (p_ids);
end $$;

-- Grava a pelada só se ninguém mudou a versão desde que este aparelho a recebeu.
create or replace function public.admin_save_pelada(p_token uuid, p_pelada jsonb, p_base_version integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  pid text := p_pelada ->> 'id';
  cur integer;
begin
  perform _require_admin(p_token);
  if pid is null then raise exception 'Pelada sem id.'; end if;
  select version into cur from peladas where id = pid for update;
  if not found then
    if coalesce(p_base_version, 0) <> 0 then
      return jsonb_build_object('ok', false, 'conflict', true, 'message', 'Esta pelada foi excluída por outro administrador.');
    end if;
    insert into peladas (id, title, status, state, version)
    values (pid, coalesce(p_pelada ->> 'title', ''), p_pelada ->> 'status', p_pelada, 1);
    return jsonb_build_object('ok', true, 'version', 1);
  end if;
  if cur <> coalesce(p_base_version, 0) then
    return jsonb_build_object('ok', false, 'conflict', true, 'version', cur, 'message', 'Outro administrador alterou esta pelada antes.');
  end if;
  update peladas set title = coalesce(p_pelada ->> 'title', ''), status = p_pelada ->> 'status', state = p_pelada,
    version = cur + 1, updated_at = now()
  where id = pid;
  return jsonb_build_object('ok', true, 'version', cur + 1);
end $$;

create or replace function public.admin_delete_pelada(p_token uuid, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_token);
  delete from peladas where id = p_id;
end $$;

create or replace function public.admin_save_app_state(p_token uuid, p_settings jsonb, p_setup jsonb, p_active_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_token);
  update app_state set settings = coalesce(p_settings, '{}'::jsonb), setup = p_setup, active_pelada_id = p_active_id,
    version = version + 1, updated_at = now()
  where id = 1;
end $$;

-- RN-133: grava as configurações só se a versão da nuvem ainda for a que o aparelho leu e mesclou.
-- Se outro admin gravou no meio, devolve conflito e o app lê, mescla de novo e tenta outra vez
-- (assim um aporte ou um encerramento de ciclo feito por outro admin nunca é apagado sem aviso).
create or replace function public.admin_save_app_state_v2(p_token uuid, p_settings jsonb, p_setup jsonb, p_active_id text, p_base_version integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  cur integer;
begin
  perform _require_admin(p_token);
  select version into cur from app_state where id = 1 for update;
  if cur is not null and cur <> coalesce(p_base_version, 0) then
    return jsonb_build_object('ok', false, 'conflict', true, 'version', cur);
  end if;
  update app_state set settings = coalesce(p_settings, '{}'::jsonb), setup = p_setup, active_pelada_id = p_active_id,
    version = version + 1, updated_at = now()
  where id = 1;
  return jsonb_build_object('ok', true, 'version', coalesce(cur, 0) + 1);
end $$;

-- ------------------------------------------------------------------------------------- código do jogador (removido)

-- Visitante só lê (RN-116, decisão de 2026-11-19): o código do jogador foi removido. Apaga o que
-- versões anteriores deste arquivo criaram.
drop function if exists public.player_set_positions(text, text, text[]);
drop function if exists public.admin_new_player_code(uuid, text);
drop table if exists public.player_codes;

-- ------------------------------------------------------------------------------------- permissões das funções

revoke all on function public.set_master_pin(text)                                  from public, anon, authenticated;
revoke all on function public._require_admin(uuid)                                   from public, anon, authenticated;
revoke all on function public.admin_login(text)                                      from public;
revoke all on function public.admin_logout(uuid)                                     from public;
revoke all on function public.admin_change_pin(uuid, text)                           from public;
revoke all on function public.admin_upsert_players(uuid, jsonb)                      from public;
revoke all on function public.admin_delete_players(uuid, text[])                     from public;
revoke all on function public.admin_save_pelada(uuid, jsonb, integer)                from public;
revoke all on function public.admin_delete_pelada(uuid, text)                        from public;
revoke all on function public.admin_save_app_state(uuid, jsonb, jsonb, text)         from public;
revoke all on function public.admin_save_app_state_v2(uuid, jsonb, jsonb, text, integer) from public;

grant execute on function public.admin_login(text)                              to anon, authenticated;
grant execute on function public.admin_logout(uuid)                             to anon, authenticated;
grant execute on function public.admin_change_pin(uuid, text)                   to anon, authenticated;
grant execute on function public.admin_upsert_players(uuid, jsonb)              to anon, authenticated;
grant execute on function public.admin_delete_players(uuid, text[])             to anon, authenticated;
grant execute on function public.admin_save_pelada(uuid, jsonb, integer)        to anon, authenticated;
grant execute on function public.admin_delete_pelada(uuid, text)                to anon, authenticated;
grant execute on function public.admin_save_app_state(uuid, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.admin_save_app_state_v2(uuid, jsonb, jsonb, text, integer) to anon, authenticated;

-- ------------------------------------------------------------------------------------- lista oficial (79)

-- Atletas da lista oficial (src/data/lista-oficial.js), revisada na auditoria de 2026-11-19.
-- Quem já existe (mesmo nome) não é alterado; nomes antigos (ex.: Wagner, Humberto) não voltam.
insert into public.players (name, stars, type, positions) values
  ('Alves', 2, 'line', '{D}'),
  ('Ari', 2.5, 'line', '{D,M}'),
  ('Balão', 2.5, 'line', '{M,A}'),
  ('Branco', 2.5, 'line', '{D}'),
  ('Cantor', 2.5, 'line', '{M,A}'),
  ('Chico', 1.5, 'line', '{D}'),
  ('Danilo', 3, 'line', '{M,A}'),
  ('Eliak', 2, 'line', '{M,A}'),
  ('Erik', 2.5, 'line', '{D,M}'),
  ('Fabiano', 2, 'line', '{A}'),
  ('Fabio', 1.5, 'gk', '{}'),
  ('Fabrício', 2.5, 'line', '{D,M}'),
  ('Felipe', 2, 'line', '{M}'),
  ('Felipe II', 2, 'line', '{M}'),
  ('Fernando', 2.5, 'line', '{A}'),
  ('Fonti', 2.5, 'line', '{D,A}'),
  ('Gabriel', 2.5, 'line', '{M}'),
  ('Gardênio', 2, 'line', '{D,M}'),
  ('Gustavo', 2, 'line', '{M}'),
  ('Igor', 3, 'line', '{M,A}'),
  ('Isaías', 2.5, 'line', '{D,M}'),
  ('Ivan', 1.5, 'line', '{M,A}'),
  ('Izio', 2, 'line', '{M,A}'),
  ('Jabá', 2, 'line', '{D}'),
  ('Japa', 3, 'line', '{D,M}'),
  ('Jarbas', 2, 'gk', '{}'),
  ('Jarlesson', 3, 'line', '{D,M}'),
  ('Jiló', 2.5, 'line', '{M,A}'),
  ('João', 2.5, 'line', '{D,M}'),
  ('João Marcos', 1.5, 'gk', '{}'),
  ('João Vitor', 2, 'line', '{D,M}'),
  ('Johnin', 1.5, 'gk', '{}'),
  ('Joilton', 2.5, 'line', '{D}'),
  ('Jonathan (Cabeção)', 1.5, 'line', '{D,M}'),
  ('JP', 2.5, 'line', '{D}'),
  ('Júlio', 2.5, 'line', '{M,A}'),
  ('Kaká', 2, 'line', '{M}'),
  ('Kauã', 2, 'line', '{M,A}'),
  ('Kleuber', 2.5, 'line', '{M}'),
  ('Leiçon', 1.5, 'line', '{D}'),
  ('Leo Baiano', 1.5, 'line', '{D,M}'),
  ('Leozinho', 2.5, 'line', '{M,A}'),
  ('Ligeiro', 2, 'line', '{M}'),
  ('Lucas Lobo', 1.5, 'line', '{D}'),
  ('Luizão', 1.5, 'line', '{D}'),
  ('Luizinho', 1.5, 'line', '{D}'),
  ('Marcelo', 2, 'line', '{D}'),
  ('Marcos', 2, 'line', '{D,M}'),
  ('Marra', 1, 'line', '{A}'),
  ('Matheus', 1.5, 'line', '{D,A}'),
  ('Maurício Filho', 1.5, 'line', '{D,M}'),
  ('Maurício Pai', 1, 'line', '{D}'),
  ('Natan', 2, 'line', '{D,M}'),
  ('Neto', 1, 'line', '{D}'),
  ('Nilson', 1, 'line', '{D}'),
  ('Paulão', 1.5, 'gk', '{}'),
  ('Pedro', 1.5, 'line', '{D,A}'),
  ('Phablo', 1.5, 'line', '{D}'),
  ('Rafael', 2.5, 'line', '{M,A}'),
  ('Renato', 2, 'line', '{D,M}'),
  ('Ribeiro', 2, 'line', '{M}'),
  ('Ricardo', 2.5, 'line', '{D,M,A}'),
  ('Roger', 2, 'line', '{D,A}'),
  ('Rogério', 1.5, 'line', '{A}'),
  ('Ryan', 1.5, 'line', '{D,M}'),
  ('Sandro', 1.5, 'line', '{D,M}'),
  ('Thiago', 3, 'line', '{M,A}'),
  ('Tuquinha', 3, 'line', '{M,A}'),
  ('Udsney', 1.5, 'line', '{A}'),
  ('Ulisses', 1.5, 'line', '{D,M}'),
  ('Vagner', 1.5, 'line', '{D,M}'),
  ('Van', 2, 'line', '{M,A}'),
  ('Vandame', 2, 'line', '{D,M}'),
  ('Viana', 2.5, 'line', '{D}'),
  ('Vicente', 2.5, 'line', '{D,M}'),
  ('Vinícius', 2, 'line', '{M}'),
  ('Waguinho', 2, 'line', '{D,M}'),
  ('Wender', 2.5, 'line', '{D,A}'),
  ('Wesley', 1.5, 'line', '{D}')
on conflict (name) do nothing;
