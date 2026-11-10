-- =========================================================
-- Miaumigo: "beta aberto" (todo mundo é Premium durante os testes)
-- Rode DEPOIS de conta.sql. Roda numa transação; idempotente.
-- Liga/desliga pelo Painel de uso (só administradores).
-- =========================================================

begin;

-- Configurações gerais do app (uma linha por chave). Sem acesso direto pela API.
create table if not exists public.app_config (
  chave         text        primary key,
  valor         jsonb       not null,
  atualizado_em timestamptz not null default now()
);
alter table public.app_config enable row level security;

-- Começa LIGADO: enquanto o app está em testes, ninguém vê paywall.
insert into public.app_config (chave, valor) values ('beta_aberto', 'true'::jsonb) on conflict (chave) do nothing;

create or replace function public.beta_aberto()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (valor #>> '{}')::boolean from public.app_config where chave = 'beta_aberto'), false);
$$;
grant execute on function public.beta_aberto() to authenticated;

-- Premium = beta aberto OU assinatura própria OU de alguém da família
create or replace function public.premium_de(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.beta_aberto() or exists (
    select 1 from public.assinaturas a
    where (a.fim is null or a.fim > now())
      and (a.user_id = p_user
           or a.user_id in (select m2.user_id
                              from public.familia_membros m1
                              join public.familia_membros m2 on m2.familia_id = m1.familia_id
                             where m1.user_id = p_user and not m1.pessoal and not m2.pessoal)));
$$;
revoke all on function public.premium_de(uuid) from public, anon, authenticated;

-- O plano que o app mostra: assinatura (própria ou da família) ou, sem ela, o beta
create or replace function public.meu_plano()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  a public.assinaturas;
begin
  select * into a from public.assinaturas where user_id = eu and (fim is null or fim > now());
  if a.user_id is null then
    select x.* into a from public.assinaturas x
     where (x.fim is null or x.fim > now())
       and x.user_id in (select m2.user_id from public.familia_membros m1
                           join public.familia_membros m2 on m2.familia_id = m1.familia_id
                          where m1.user_id = eu and not m1.pessoal and not m2.pessoal)
     order by x.fim desc nulls first limit 1;
  end if;
  return jsonb_build_object(
    'premium', a.user_id is not null or public.beta_aberto(),
    'origem', case when a.user_id is not null then a.origem when public.beta_aberto() then 'beta' end,
    'fim', a.fim,
    'pela_familia', a.user_id is not null and a.user_id <> eu,
    'titular', case when a.user_id is not null and a.user_id <> eu then
      (select coalesce(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', split_part(email, '@', 1)) from auth.users where id = a.user_id) end,
    'pets_criados', (select count(*) from public.registros where user_id = eu and tipo = 'pet' and not excluido),
    'limite_pets', 1
  );
end;
$$;

-- ---------------- Administração ----------------
create or replace function public.admin_definir_beta(p_ligado boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  insert into public.app_config (chave, valor, atualizado_em) values ('beta_aberto', to_jsonb(p_ligado), now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
end;
$$;

-- Agradecimento no lançamento: quem tem conta e ainda não tem Premium vira fundador.
create or replace function public.admin_testadores_viram_fundadores()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  insert into public.assinaturas (user_id, origem)
  select u.id, 'fundador' from auth.users u
   where not exists (select 1 from public.assinaturas a where a.user_id = u.id and (a.fim is null or a.fim > now()))
  on conflict (user_id) do update set origem = 'fundador', inicio = now(), fim = null;
  get diagnostics n = row_count;
  return n;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array['public.meu_plano()', 'public.admin_definir_beta(boolean)', 'public.admin_testadores_viram_fundadores()'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

commit;
