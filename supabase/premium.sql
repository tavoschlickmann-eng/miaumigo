-- =========================================================
-- Miaumigo, Fase 4A: planos e limites (ainda sem cobrança)
-- Rode DEPOIS de notas.sql. Roda numa transação; idempotente.
--
-- Premium é da FAMÍLIA: quem tem uma assinatura ativa é Premium, e
-- todos da família compartilhada dela também (inclusive nos pets
-- "Só meus"). No plano grátis:
--   * cada pessoa cria 1 pet (pets que vieram de outras pessoas da
--     família não contam; quem já tinha mais continua com eles);
--   * fotos e anexos (receitas, exames, fotos de notas) são do Premium.
--     Quem deixa de ser Premium continua vendo e pode apagar os que tem.
-- A foto de perfil do pet é grátis. Nada é apagado ao sair do Premium.
-- As regras valem NO BANCO; o app só mostra os avisos.
-- =========================================================

begin;

create table if not exists public.assinaturas (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  plano      text        not null default 'premium' check (plano in ('premium')),
  origem     text        not null check (origem in ('fundador', 'cortesia', 'teste', 'mercadopago', 'stripe')),
  inicio     timestamptz not null default now(),
  fim        timestamptz,                       -- null = sem data para acabar
  criado_em  timestamptz not null default now()
);
-- RLS ligado e nenhuma regra: ninguém lê ou altera pela API (só pelas funções).
alter table public.assinaturas enable row level security;

-- A pessoa é Premium? (assinatura própria ou de alguém da família dela)
create or replace function public.premium_de(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assinaturas a
    where (a.fim is null or a.fim > now())
      and (a.user_id = p_user
           or a.user_id in (select m2.user_id
                              from public.familia_membros m1
                              join public.familia_membros m2 on m2.familia_id = m1.familia_id
                             where m1.user_id = p_user and not m1.pessoal and not m2.pessoal)));
$$;
revoke all on function public.premium_de(uuid) from public, anon, authenticated;

-- ---------------- Limites (no banco) ----------------
create or replace function public.registros_limites()
returns trigger language plpgsql security definer set search_path = '' as $$
declare eu uuid := auth.uid();
begin
  if eu is null or new.excluido then return new; end if;            -- SQL do painel / exclusões: livres
  if tg_op = 'INSERT' and exists (select 1 from public.registros r where r.familia_id = new.familia_id and r.id = new.id) then
    return new;                                                       -- é uma edição (upsert de algo que já existe)
  end if;
  if tg_op = 'UPDATE' and not old.excluido then return new; end if;  -- edição normal
  -- daqui para baixo: registro novo (ou um apagado voltando)
  if new.tipo = 'pet' and not public.premium_de(eu)
     and (select count(*) from public.registros r
           where r.user_id = eu and r.tipo = 'pet' and not r.excluido and r.id <> new.id) >= 1 then
    raise exception 'limite do plano grátis: 1 pet' using errcode = 'P0001';
  end if;
  if new.tipo = 'anexo' and not public.premium_de(eu) then
    raise exception 'fotos e anexos são do Premium' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists registros_limites on public.registros;
create trigger registros_limites
  before insert or update on public.registros
  for each row execute function public.registros_limites();

-- Arquivos novos no Storage: só Premium (ler e apagar continuam liberados)
drop policy if exists "anexos: família envia" on storage.objects;
create policy "anexos: família envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos'
              and (storage.foldername(name))[1] in (select f::text from public.minhas_familias() f)
              and public.premium_de((select auth.uid())));

-- ---------------- O app pergunta o plano junto com os espaços ----------------
create or replace function public.meu_plano()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  a public.assinaturas;
  quem uuid;
begin
  select * into a from public.assinaturas where user_id = eu and (fim is null or fim > now());
  if a.user_id is null then  -- Premium por alguém da família?
    select x.* into a from public.assinaturas x
     where (x.fim is null or x.fim > now())
       and x.user_id in (select m2.user_id from public.familia_membros m1
                           join public.familia_membros m2 on m2.familia_id = m1.familia_id
                          where m1.user_id = eu and not m1.pessoal and not m2.pessoal)
     order by x.fim desc nulls first limit 1;
  end if;
  return jsonb_build_object(
    'premium', a.user_id is not null,
    'origem', a.origem,
    'fim', a.fim,
    'pela_familia', a.user_id is not null and a.user_id <> eu,
    'titular', case when a.user_id is not null and a.user_id <> eu then
      (select coalesce(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', split_part(email, '@', 1)) from auth.users where id = a.user_id) end,
    'pets_criados', (select count(*) from public.registros where user_id = eu and tipo = 'pet' and not excluido),
    'limite_pets', 1
  );
end;
$$;

create or replace function public.meus_espacos()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  p uuid;
  f uuid;
  meu_papel text;
begin
  if eu is null then raise exception 'sem login' using errcode = '42501'; end if;
  p := public._garantir_familia(eu);
  select familia_id, papel into f, meu_papel from public.familia_membros where user_id = eu and not pessoal;
  return jsonb_build_object('pessoal', p, 'plano', public.meu_plano(), 'familia', case when f is null then null else jsonb_build_object(
    'id', f,
    'nome', (select nome from public.familias where id = f),
    'papel', meu_papel,
    'membros', (
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'papel', m.papel, 'entrou_em', m.entrou_em,
        'nome', coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
        'email', u.email,
        'foto', coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
      ) order by m.entrou_em)
      from public.familia_membros m join auth.users u on u.id = m.user_id
      where m.familia_id = f),
    'convites', case when meu_papel = 'responsavel' then (
      select coalesce(jsonb_agg(jsonb_build_object('token', token, 'criado_em', criado_em, 'expira_em', expira_em) order by criado_em desc), '[]'::jsonb)
      from public.convites
      where familia_id = f and revogado_em is null and usado_em is null and expira_em > now()) else '[]'::jsonb end
  ) end);
end;
$$;

-- ---------------- Administração (painel; só administradores) ----------------
create or replace function public.admin_premium_listar()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'email', u.email, 'origem', a.origem, 'inicio', a.inicio, 'fim', a.fim, 'ativo', a.fim is null or a.fim > now()
    ) order by a.inicio), '[]'::jsonb)
    from public.assinaturas a join auth.users u on u.id = a.user_id);
end;
$$;

create or replace function public.admin_premium_dar(p_email text, p_origem text default 'cortesia', p_dias int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  if not public.is_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'conta não encontrada' using errcode = 'P0001'; end if;
  insert into public.assinaturas (user_id, origem, inicio, fim)
  values (u, p_origem, now(), case when p_dias is null then null else now() + make_interval(days => p_dias) end)
  on conflict (user_id) do update set origem = excluded.origem, inicio = excluded.inicio, fim = excluded.fim;
end;
$$;

create or replace function public.admin_premium_remover(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'acesso negado' using errcode = '42501'; end if;
  delete from public.assinaturas where user_id = (select id from auth.users where lower(email) = lower(trim(p_email)));
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array['public.meu_plano()', 'public.meus_espacos()', 'public.admin_premium_listar()',
                             'public.admin_premium_dar(text, text, int)', 'public.admin_premium_remover(text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ---------------- Fundadores: quem já tem conta ganha Premium sem prazo ----------------
insert into public.assinaturas (user_id, origem) select id, 'fundador' from auth.users on conflict do nothing;

commit;

select (select count(*) from auth.users) as contas, (select count(*) from public.assinaturas) as premium;
