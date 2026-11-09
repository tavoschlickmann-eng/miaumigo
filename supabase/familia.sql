-- =========================================================
-- Miaumigo, Fase 2: Família (pets compartilhados)
-- Rode DEPOIS de schema.sql. Roda numa transação: se algo falhar,
-- nada muda. Pode rodar de novo sem problema (idempotente).
--
-- Modelo: cada pessoa está em UMA família por vez. Todos os registros
-- (pets, cuidados, pesos, gastos, ração, anexos) pertencem à família.
-- Papéis: responsavel (convida, remove, renomeia) e membro (edita tudo).
-- As tabelas de família não têm regras de acesso pela API: tudo passa
-- por funções que conferem, no banco, quem pode fazer o quê.
-- =========================================================

begin;

-- ---------------- Tabelas ----------------

create table if not exists public.familias (
  id        uuid        primary key default gen_random_uuid(),
  nome      text        not null default 'Minha família' check (char_length(nome) between 1 and 60),
  criada_em timestamptz not null default now()
);

create table if not exists public.familia_membros (
  familia_id uuid        not null references public.familias (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  papel      text        not null default 'membro' check (papel in ('responsavel', 'membro')),
  entrou_em  timestamptz not null default now(),
  primary key (familia_id, user_id),
  unique (user_id)                                   -- uma família por pessoa
);

create table if not exists public.convites (
  token       text        primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  familia_id  uuid        not null references public.familias (id) on delete cascade,
  criado_por  uuid        references auth.users (id) on delete set null,
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null default now() + interval '7 days',
  revogado_em timestamptz,
  usado_por   uuid        references auth.users (id) on delete set null,
  usado_em    timestamptz
);
create index if not exists convites_familia_idx on public.convites (familia_id);

-- RLS ligado e nenhuma regra: ninguém lê ou altera estas tabelas direto pela API.
alter table public.familias        enable row level security;
alter table public.familia_membros enable row level security;
alter table public.convites        enable row level security;

-- ---------------- Funções internas ----------------

-- Família de quem está logado (usada nas regras de acesso).
create or replace function public.minha_familia_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select familia_id from public.familia_membros where user_id = (select auth.uid());
$$;

-- Garante que a pessoa tem uma família (cria uma só dela, como responsável).
create or replace function public._garantir_familia(p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid;
begin
  select familia_id into f from public.familia_membros where user_id = p_user;
  if f is not null then return f; end if;
  insert into public.familias default values returning id into f;
  begin
    insert into public.familia_membros (familia_id, user_id, papel) values (f, p_user, 'responsavel');
  exception when unique_violation then          -- duas chamadas ao mesmo tempo
    delete from public.familias where id = f;
    select familia_id into f from public.familia_membros where user_id = p_user;
  end;
  return f;
end;
$$;

-- Se a família ficar sem responsável, o membro mais antigo assume.
create or replace function public._garantir_responsavel(p_familia uuid)
returns void language sql security definer set search_path = '' as $$
  update public.familia_membros set papel = 'responsavel'
  where familia_id = p_familia
    and not exists (select 1 from public.familia_membros where familia_id = p_familia and papel = 'responsavel')
    and user_id = (select user_id from public.familia_membros where familia_id = p_familia order by entrou_em limit 1);
$$;

-- ---------------- Migração: cada conta vira uma família de 1 pessoa ----------------

select public._garantir_familia(id) from auth.users;

-- registros: família dona + quem alterou por último
alter table public.registros add column if not exists familia_id uuid references public.familias (id) on delete cascade;
alter table public.registros add column if not exists updated_by uuid references auth.users (id) on delete set null;
alter table public.registros alter column familia_id set default public.minha_familia_id();

update public.registros r
   set familia_id = m.familia_id
  from public.familia_membros m
 where r.familia_id is null and m.user_id = r.user_id;
update public.registros set updated_by = user_id where updated_by is null;

alter table public.registros alter column familia_id set not null;

-- chave: (família, id) em vez de (usuário, id)
do $$ begin
  if exists (select 1 from information_schema.key_column_usage
             where table_schema = 'public' and table_name = 'registros' and constraint_name = 'registros_pkey' and column_name = 'user_id') then
    alter table public.registros drop constraint registros_pkey;
    alter table public.registros add primary key (familia_id, id);
  end if;
end $$;

-- user_id passa a ser "quem criou": se a conta for apagada, o registro fica com a família
alter table public.registros drop constraint if exists registros_user_id_fkey;
alter table public.registros alter column user_id drop not null;
alter table public.registros add constraint registros_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

drop index if exists public.registros_sync_idx;
create index if not exists registros_familia_sync_idx on public.registros (familia_id, updated_at);
create index if not exists registros_anexo_path_idx on public.registros ((dados->>'path')) where tipo = 'anexo';

-- data e autor da alteração sempre definidos pelo servidor
create or replace function public.registros_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- ---------------- Regras de acesso: registros por família ----------------

drop policy if exists "registros: dono lê"    on public.registros;
drop policy if exists "registros: dono cria"  on public.registros;
drop policy if exists "registros: dono altera" on public.registros;
drop policy if exists "registros: dono apaga" on public.registros;

drop policy if exists "registros: família lê" on public.registros;
create policy "registros: família lê" on public.registros
  for select to authenticated using (familia_id = (select public.minha_familia_id()));

drop policy if exists "registros: família cria" on public.registros;
create policy "registros: família cria" on public.registros
  for insert to authenticated with check (familia_id = (select public.minha_familia_id()));

drop policy if exists "registros: família altera" on public.registros;
create policy "registros: família altera" on public.registros
  for update to authenticated
  using (familia_id = (select public.minha_familia_id()))
  with check (familia_id = (select public.minha_familia_id()));

drop policy if exists "registros: família apaga" on public.registros;
create policy "registros: família apaga" on public.registros
  for delete to authenticated using (familia_id = (select public.minha_familia_id()));

-- ---------------- Regras de acesso: anexos (Storage) ----------------
-- Novos arquivos: <id da família>/<id do anexo>.
-- Ler/apagar: arquivo da pasta da família OU que tenha um anexo da família
-- apontando para ele (cobre os arquivos antigos em <id do usuário>/ e os
-- pets trazidos de outra família, sem precisar mover arquivo nenhum).

create or replace function public.anexo_da_familia(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select split_part(p_path, '/', 1) = (select public.minha_familia_id())::text
      or exists (select 1 from public.registros
                 where tipo = 'anexo' and dados->>'path' = p_path
                   and familia_id = (select public.minha_familia_id()));
$$;

drop policy if exists "anexos: dono lê"    on storage.objects;
drop policy if exists "anexos: dono envia" on storage.objects;
drop policy if exists "anexos: dono altera" on storage.objects;
drop policy if exists "anexos: dono apaga" on storage.objects;

drop policy if exists "anexos: família lê" on storage.objects;
create policy "anexos: família lê" on storage.objects
  for select to authenticated using (bucket_id = 'anexos' and public.anexo_da_familia(name));

drop policy if exists "anexos: família envia" on storage.objects;
create policy "anexos: família envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] = (select public.minha_familia_id())::text);

drop policy if exists "anexos: família altera" on storage.objects;
create policy "anexos: família altera" on storage.objects
  for update to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = (select public.minha_familia_id())::text);

drop policy if exists "anexos: família apaga" on storage.objects;
create policy "anexos: família apaga" on storage.objects
  for delete to authenticated using (bucket_id = 'anexos' and public.anexo_da_familia(name));

-- ---------------- Funções chamadas pelo app ----------------

-- Minha família: nome, meu papel, membros e (para responsáveis) convites ativos.
create or replace function public.minha_familia()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  f uuid;
  meu_papel text;
begin
  if eu is null then raise exception 'sem login' using errcode = '42501'; end if;
  f := public._garantir_familia(eu);
  select papel into meu_papel from public.familia_membros where familia_id = f and user_id = eu;
  return jsonb_build_object(
    'id', f,
    'nome', (select nome from public.familias where id = f),
    'papel', meu_papel,
    'membros', (
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'papel', m.papel,
        'entrou_em', m.entrou_em,
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
  );
end;
$$;

create or replace function public._exigir_responsavel()
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid;
begin
  select familia_id into f from public.familia_membros where user_id = auth.uid() and papel = 'responsavel';
  if f is null then raise exception 'só o responsável da família pode fazer isso' using errcode = '42501'; end if;
  return f;
end;
$$;

create or replace function public.criar_convite()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public._exigir_responsavel(); c public.convites;
begin
  if (select count(*) from public.convites where familia_id = f and revogado_em is null and usado_em is null and expira_em > now()) >= 10 then
    raise exception 'limite de convites ativos atingido' using errcode = 'P0001';
  end if;
  insert into public.convites (familia_id, criado_por) values (f, auth.uid()) returning * into c;
  return jsonb_build_object('token', c.token, 'expira_em', c.expira_em);
end;
$$;

create or replace function public.revogar_convite(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare f uuid := public._exigir_responsavel();
begin
  update public.convites set revogado_em = now()
  where token = p_token and familia_id = f and revogado_em is null and usado_em is null;
end;
$$;

-- Nome de pet normalizado para comparar: sem acento, minúsculo, espaços únicos.
create or replace function public._nome_pet(p text)
returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(translate(coalesce(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '\s+', ' ', 'g'));
$$;

-- Pets da família `de` que já existem na família `para` (não são levados):
-- mesmo nome, ou o mesmo registro (mesmo id, ex.: cópia de uma versão antiga).
create or replace function public._pets_repetidos(de uuid, para uuid)
returns table (id text) language sql stable security definer set search_path = '' as $$
  select r.id from public.registros r
  where r.familia_id = de and r.tipo = 'pet' and not r.excluido
    and (public._nome_pet(r.dados->>'nome') in (
           select public._nome_pet(x.dados->>'nome') from public.registros x
           where x.familia_id = para and x.tipo = 'pet' and not x.excluido)
         or r.id in (select x.id from public.registros x where x.familia_id = para));
$$;

-- Situação de um convite (para a tela "Você foi convidado").
create or replace function public.ver_convite(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.convites;
  minha uuid := public.minha_familia_id();
  st text;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select * into c from public.convites where token = p_token;
  st := case
    when c.token is null then 'invalido'
    when c.familia_id = minha then 'ja_membro'
    when c.revogado_em is not null then 'revogado'
    when c.usado_em is not null then 'usado'
    when c.expira_em <= now() then 'expirado'
    when (select count(*) from public.familia_membros where familia_id = minha) > 1 then 'em_familia'
    else 'valido' end;
  if st = 'invalido' then return jsonb_build_object('status', st); end if;
  return jsonb_build_object(
    'status', st,
    'familia', (select nome from public.familias where id = c.familia_id),
    'convidado_por', (select coalesce(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', split_part(email, '@', 1)) from auth.users where id = c.criado_por),
    'membros', (select count(*) from public.familia_membros where familia_id = c.familia_id),
    'expira_em', c.expira_em,
    -- meus pets e se cada um já existe (mesmo nome) na família do convite
    'meus_pets', case when st = 'valido' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'nome', r.dados->>'nome',
        'repetido', r.id in (select id from public._pets_repetidos(minha, c.familia_id))
      ) order by r.dados->>'nome'), '[]'::jsonb)
      from public.registros r where r.familia_id = minha and r.tipo = 'pet' and not r.excluido) else '[]'::jsonb end
  );
end;
$$;

-- Aceitar: entra na família do convite.
--  * Só para quem está sozinho na própria família; quem já divide uma
--    família com outras pessoas precisa sair dela antes.
--  * p_levar_pets = true: leva os pets (com cuidados, pesos, ração, anexos)
--    e os gastos, MENOS os pets que já existem na família nova (mesmo nome
--    ou mesmo registro) e o que já estiver lá.
--  * O que não é levado é apagado junto com a família antiga. Antes de
--    chamar, o app já apagou isso no aparelho e os arquivos no Storage.
create or replace function public.aceitar_convite(p_token text, p_levar_pets boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  c public.convites;
  antiga uuid;
begin
  if eu is null then raise exception 'sem login' using errcode = '42501'; end if;
  select * into c from public.convites where token = p_token for update;
  if c.token is null then raise exception 'convite inválido' using errcode = 'P0001'; end if;
  if c.revogado_em is not null then raise exception 'convite revogado' using errcode = 'P0001'; end if;
  if c.usado_em is not null then raise exception 'convite já usado' using errcode = 'P0001'; end if;
  if c.expira_em <= now() then raise exception 'convite expirado' using errcode = 'P0001'; end if;

  antiga := public._garantir_familia(eu);
  if antiga = c.familia_id then return antiga; end if;
  if (select count(*) from public.familia_membros where familia_id = antiga) > 1 then
    raise exception 'saia da família atual para entrar em outra' using errcode = 'P0001';
  end if;

  if p_levar_pets then
    update public.registros r set familia_id = c.familia_id
    where r.familia_id = antiga and not r.excluido
      and r.id not in (select x.id from public.registros x where x.familia_id = c.familia_id) -- já existe lá
      and r.id not in (select id from public._pets_repetidos(antiga, c.familia_id))
      and coalesce(r.dados->>'petId', '') not in (select id from public._pets_repetidos(antiga, c.familia_id))
      and coalesce(r.dados->>'careId', '') not in (
        select x.id from public.registros x
        where x.familia_id = antiga and x.tipo = 'cuidado'
          and x.dados->>'petId' in (select id from public._pets_repetidos(antiga, c.familia_id)));
  end if;
  delete from public.familias where id = antiga;   -- apaga membros, convites e o que não foi levado

  insert into public.familia_membros (familia_id, user_id, papel) values (c.familia_id, eu, 'membro');
  update public.convites set usado_por = eu, usado_em = now() where token = c.token;
  return c.familia_id;
end;
$$;

-- Sair da família: os pets ficam com ela; a pessoa ganha uma família nova, vazia.
create or replace function public.sair_da_familia()
returns uuid language plpgsql security definer set search_path = '' as $$
declare eu uuid := auth.uid(); f uuid;
begin
  select familia_id into f from public.familia_membros where user_id = eu;
  if f is null or (select count(*) from public.familia_membros where familia_id = f) < 2 then
    raise exception 'você é a única pessoa da família' using errcode = 'P0001';
  end if;
  delete from public.familia_membros where familia_id = f and user_id = eu;
  perform public._garantir_responsavel(f);
  return public._garantir_familia(eu);
end;
$$;

-- Remover alguém (só responsável). A pessoa perde o acesso na hora.
create or replace function public.remover_membro(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f uuid := public._exigir_responsavel();
begin
  if p_user = auth.uid() then raise exception 'use "sair da família"' using errcode = 'P0001'; end if;
  delete from public.familia_membros where familia_id = f and user_id = p_user;
  if not found then raise exception 'pessoa não está na família' using errcode = 'P0001'; end if;
  perform public._garantir_familia(p_user);
end;
$$;

-- Mudar papel (só responsável). Sempre sobra pelo menos um responsável.
create or replace function public.alterar_papel(p_user uuid, p_papel text)
returns void language plpgsql security definer set search_path = '' as $$
declare f uuid := public._exigir_responsavel();
begin
  if p_papel not in ('responsavel', 'membro') then raise exception 'papel inválido' using errcode = 'P0001'; end if;
  update public.familia_membros set papel = p_papel where familia_id = f and user_id = p_user;
  if not found then raise exception 'pessoa não está na família' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.familia_membros where familia_id = f and papel = 'responsavel') then
    raise exception 'a família precisa de pelo menos um responsável' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.renomear_familia(p_nome text)
returns void language plpgsql security definer set search_path = '' as $$
declare f uuid := public._exigir_responsavel();
begin
  update public.familias set nome = left(trim(p_nome), 60) where id = f and char_length(trim(p_nome)) > 0;
end;
$$;

-- ---------------- Permissões das funções ----------------

revoke all on function public._garantir_familia(uuid)     from public, anon, authenticated;
revoke all on function public._garantir_responsavel(uuid) from public, anon, authenticated;
revoke all on function public._exigir_responsavel()       from public, anon, authenticated;
revoke all on function public._pets_repetidos(uuid, uuid) from public, anon, authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.minha_familia_id()', 'public.anexo_da_familia(text)', 'public.minha_familia()',
    'public.criar_convite()', 'public.revogar_convite(text)', 'public.ver_convite(text)',
    'public.aceitar_convite(text, boolean)', 'public.sair_da_familia()', 'public.remover_membro(uuid)',
    'public.alterar_papel(uuid, text)', 'public.renomear_familia(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

commit;

-- ---------------- Conferência ----------------
select
  (select count(*) from auth.users)                                   as contas,
  (select count(*) from public.familias)                              as familias,
  (select count(*) from public.familia_membros)                       as membros,
  (select count(*) from public.registros)                             as registros,
  (select count(*) from public.registros where familia_id is null)    as registros_sem_familia;
