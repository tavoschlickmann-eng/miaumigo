-- =========================================================
-- Miaumigo: lembretes com o app fechado (Web Push) — Premium
-- Rode DEPOIS de beta.sql. Roda numa transação; idempotente.
--
-- Cada aparelho que ativa os lembretes vira uma "inscrição" (endereço de
-- push do navegador + horário do aviso). A cada 15 minutos o agendador
-- chama a função lembretes (supabase/functions/lembretes), que pergunta
-- ao banco o que está na hora de avisar e manda as notificações.
-- =========================================================

begin;

create table if not exists public.push_inscricoes (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  endpoint      text        not null unique,
  p256dh        text        not null,
  auth          text        not null,
  horario       text        not null default '09:00' check (horario ~ '^[0-2][0-9]:[0-5][0-9]$'),
  fuso          text        not null default 'America/Sao_Paulo',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists push_inscricoes_user_idx on public.push_inscricoes (user_id);
alter table public.push_inscricoes enable row level security;  -- sem regras: só pelas funções

-- Lembretes já enviados (para não repetir). Chave: pessoa|cuidado|data|antecedência
create table if not exists public.push_enviados (
  chave      text        primary key,
  enviado_em timestamptz not null default now()
);
alter table public.push_enviados enable row level security;

-- O app registra (ou atualiza) a inscrição deste aparelho
create or replace function public.registrar_push(p_endpoint text, p_p256dh text, p_auth text, p_horario text, p_fuso text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  if p_fuso is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_fuso) then p_fuso := 'America/Sao_Paulo'; end if;
  -- o mesmo aparelho pode ter sido de outra conta: a inscrição passa para quem está logado
  insert into public.push_inscricoes (user_id, endpoint, p256dh, auth, horario, fuso)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_horario, '09:00'), p_fuso)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        horario = excluded.horario, fuso = excluded.fuso, atualizado_em = now();
end;
$$;

create or replace function public.remover_push(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_inscricoes where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- O que está na hora de avisar (usada só pela função do servidor)
create or replace function public.lembretes_para_enviar()
returns table (inscricao uuid, endpoint text, p256dh text, auth text, titulo text, corpo text, chave text, tag text)
language sql stable security definer set search_path = '' as $$
  with cuid as (
    select i.id as inscricao, i.endpoint, i.p256dh, i.auth, i.user_id, c.id as care_id,
           c.dados, (c.dados->>'data')::date as dia,
           coalesce((c.dados->>'lembrete')::int, 0) as antes,
           (((c.dados->>'data')::date - coalesce((c.dados->>'lembrete')::int, 0)) + i.horario::time) at time zone i.fuso as momento,
           p.dados->>'nome' as pet
      from public.push_inscricoes i
      join public.familia_membros m on m.user_id = i.user_id
      join public.registros c on c.familia_id = m.familia_id and c.tipo = 'cuidado' and not c.excluido
      left join public.registros p on p.familia_id = c.familia_id and p.id = c.dados->>'petId' and p.tipo = 'pet' and not p.excluido
     where coalesce((c.dados->>'feito')::boolean, false) = false
       and coalesce((c.dados->>'lembrete')::int, 0) >= 0
       and (c.dados->>'data') ~ '^\d{4}-\d{2}-\d{2}$'
       and p.id is not null
       and public.premium_de(i.user_id)
  )
  select inscricao, endpoint, p256dh, auth,
         pet || ': ' || coalesce(nullif(dados->>'titulo', ''),
           case dados->>'tipo' when 'vacina' then 'Vacina' when 'vermifugo' then 'Vermífugo' when 'antipulgas' then 'Antipulgas'
             when 'remedio' then 'Remédio' when 'consulta' then 'Consulta' when 'banho' then 'Banho e tosa' else 'Cuidado' end),
         case when dia = (now() at time zone 'America/Sao_Paulo')::date then 'É hoje'
              when dia = (now() at time zone 'America/Sao_Paulo')::date + 1 then 'É amanhã'
              else 'Em ' || (dia - (now() at time zone 'America/Sao_Paulo')::date) || ' dias, ' || to_char(dia, 'DD/MM') end,
         user_id || '|' || care_id || '|' || dia || '|' || antes,
         care_id
    from cuid
   where momento <= now() and momento > now() - interval '1 day'
     and not exists (select 1 from public.push_enviados e where e.chave = cuid.user_id || '|' || cuid.care_id || '|' || cuid.dia || '|' || cuid.antes);
$$;

create or replace function public.lembretes_marcar(p_chaves text[], p_mortas uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_enviados (chave) select unnest(p_chaves) on conflict do nothing;
  delete from public.push_inscricoes where id = any (p_mortas);           -- aparelhos que desinstalaram
  delete from public.push_enviados where enviado_em < now() - interval '30 days';
end;
$$;

-- Permissões: o app só registra/remove a própria inscrição; o resto é só do servidor
revoke all on function public.registrar_push(text, text, text, text, text) from public, anon;
grant execute on function public.registrar_push(text, text, text, text, text) to authenticated;
revoke all on function public.remover_push(text) from public, anon;
grant execute on function public.remover_push(text) to authenticated;
revoke all on function public.lembretes_para_enviar() from public, anon, authenticated;
revoke all on function public.lembretes_marcar(text[], uuid[]) from public, anon, authenticated;
grant execute on function public.lembretes_para_enviar() to service_role;
grant execute on function public.lembretes_marcar(text[], uuid[]) to service_role;

commit;
