-- =========================================================
-- Miaumigo: painel de uso (somente administradores)
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
--
-- Segurança: as métricas saem de uma função que confere, NO BANCO,
-- se quem pede está na tabela app_admins. Esconder o botão no app é só
-- conveniência; mesmo que alguém chame a função, ela recusa.
-- Só números agregados: nenhum e-mail, nome ou dado de pet é exposto.
-- =========================================================

create table if not exists public.app_admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

-- RLS ligado e nenhuma regra: ninguém lê ou altera esta tabela pela API.
alter table public.app_admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()));
$$;

create or replace function public.painel_metricas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  resultado jsonb;
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'gerado_em', now(),

    'usuarios', jsonb_build_object(
      'total',       (select count(*) from auth.users),
      'confirmados', (select count(*) from auth.users where email_confirmed_at is not null),
      'novos_7d',    (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'novos_30d',   (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'por_provedor', (
        select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb)
        from (select provider, count(distinct user_id) as n from auth.identities group by provider) x
      )
    ),

    -- "ativo" = a conta sincronizou alguma alteração no período
    'ativos', jsonb_build_object(
      'd1',  (select count(distinct user_id) from public.registros where updated_at > now() - interval '1 day'),
      'd7',  (select count(distinct user_id) from public.registros where updated_at > now() - interval '7 days'),
      'd30', (select count(distinct user_id) from public.registros where updated_at > now() - interval '30 days'),
      'login_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days')
    ),

    'conteudo', jsonb_build_object(
      'pets',     (select count(*) from public.registros where tipo = 'pet'     and not excluido),
      'cuidados', (select count(*) from public.registros where tipo = 'cuidado' and not excluido),
      'pesos',    (select count(*) from public.registros where tipo = 'peso'    and not excluido),
      'gastos',   (select count(*) from public.registros where tipo = 'gasto'   and not excluido),
      'racoes',   (select count(*) from public.registros where tipo = 'racao'   and not excluido),
      'anexos',   (select count(*) from public.registros where tipo = 'anexo'   and not excluido),
      'contas_com_pet', (select count(distinct user_id) from public.registros where tipo = 'pet' and not excluido),
      'pets_por_especie', (
        select coalesce(jsonb_object_agg(especie, n), '{}'::jsonb)
        from (select coalesce(dados->>'especie', 'outro') as especie, count(*) as n
              from public.registros where tipo = 'pet' and not excluido group by 1) x
      ),
      'cuidados_por_tipo', (
        select coalesce(jsonb_object_agg(t, n), '{}'::jsonb)
        from (select coalesce(dados->>'tipo', 'outro') as t, count(*) as n
              from public.registros where tipo = 'cuidado' and not excluido group by 1) x
      )
    ),

    'armazenamento', jsonb_build_object(
      'arquivos', (select count(*) from storage.objects where bucket_id = 'anexos'),
      'bytes',    (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'anexos')
    ),

    -- últimos 30 dias, no horário de Brasília
    'serie_30d', (
      select jsonb_agg(jsonb_build_object(
        'dia', d::date,
        'ativos', (select count(distinct g.user_id) from public.registros g
                   where (g.updated_at at time zone 'America/Sao_Paulo')::date = d::date),
        'cadastros', (select count(*) from auth.users u
                      where (u.created_at at time zone 'America/Sao_Paulo')::date = d::date)
      ) order by d)
      from generate_series(hoje - 29, hoje, interval '1 day') as d
    )
  ) into resultado;

  return resultado;
end;
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.painel_metricas() from public, anon;
grant execute on function public.painel_metricas() to authenticated;

-- Administrador: a conta do Otavio (identificada pelo e-mail, gravada pelo id)
insert into public.app_admins (user_id)
select id from auth.users where email = 'tavoschlickmann@gmail.com'
on conflict do nothing;

-- Conferência
select (select count(*) from public.app_admins) as administradores;
