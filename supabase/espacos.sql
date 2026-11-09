-- =========================================================
-- Miaumigo, Fase 2.1: "Só meus" + família
-- Rode DEPOIS de familia.sql. Roda numa transação; idempotente.
--
-- Cada pessoa tem um espaço PESSOAL (pets "só meus", só ela vê) e pode
-- participar de UMA família compartilhada. Ao entrar numa família, os
-- pets pessoais continuam só da pessoa; ela compartilha cada um quando
-- quiser (e aí ele passa a ser da família, sem volta).
-- Tecnicamente, o espaço pessoal é uma "família" com pessoal = true.
-- =========================================================

begin;

-- ---------------- Estrutura ----------------

alter table public.familias        add column if not exists pessoal boolean not null default false;
alter table public.familia_membros add column if not exists pessoal boolean not null default false;

-- Famílias de 1 pessoa viram o espaço pessoal dela (mesmo id: nada muda de lugar).
update public.familias f set pessoal = true
 where not f.pessoal and (select count(*) from public.familia_membros m where m.familia_id = f.id) = 1
   and not exists (select 1 from public.familia_membros m2 join public.familia_membros m1 on m1.user_id = m2.user_id
                   where m1.familia_id = f.id and m2.familia_id <> f.id);
update public.familia_membros m set pessoal = f.pessoal from public.familias f where f.id = m.familia_id and m.pessoal <> f.pessoal;

-- Cada pessoa: no máximo 1 espaço pessoal e no máximo 1 família compartilhada.
alter table public.familia_membros drop constraint if exists familia_membros_user_id_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'familia_membros_user_pessoal_key') then
    alter table public.familia_membros add constraint familia_membros_user_pessoal_key unique (user_id, pessoal);
  end if;
end $$;

-- ---------------- Funções internas ----------------

create or replace function public.meu_espaco_pessoal()
returns uuid language sql stable security definer set search_path = '' as $$
  select familia_id from public.familia_membros where user_id = (select auth.uid()) and pessoal;
$$;

create or replace function public.minha_familia_compartilhada()
returns uuid language sql stable security definer set search_path = '' as $$
  select familia_id from public.familia_membros where user_id = (select auth.uid()) and not pessoal;
$$;

-- Todos os espaços de quem está logado (usada nas regras de acesso).
create or replace function public.minhas_familias()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select familia_id from public.familia_membros where user_id = (select auth.uid());
$$;

-- Compatibilidade (app 1.5.0 e valor padrão de registros.familia_id): o espaço pessoal.
create or replace function public.minha_familia_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select public.meu_espaco_pessoal();
$$;

-- Garante o espaço pessoal da pessoa.
create or replace function public._garantir_familia(p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid;
begin
  select familia_id into f from public.familia_membros where user_id = p_user and pessoal;
  if f is not null then return f; end if;
  insert into public.familias (nome, pessoal) values ('Só meus', true) returning id into f;
  begin
    insert into public.familia_membros (familia_id, user_id, papel, pessoal) values (f, p_user, 'responsavel', true);
  exception when unique_violation then
    delete from public.familias where id = f;
    select familia_id into f from public.familia_membros where user_id = p_user and pessoal;
  end;
  return f;
end;
$$;

select public._garantir_familia(id) from auth.users;

create or replace function public._exigir_responsavel()
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid;
begin
  select familia_id into f from public.familia_membros where user_id = auth.uid() and not pessoal and papel = 'responsavel';
  if f is null then raise exception 'só o responsável da família pode fazer isso' using errcode = '42501'; end if;
  return f;
end;
$$;

-- Move pets do espaço `de` para a família `para`, com tudo ligado a eles.
create or replace function public._mover_pets(p_ids text[], de uuid, para uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.registros r set familia_id = para
  where r.familia_id = de and not r.excluido
    and r.id not in (select x.id from public.registros x where x.familia_id = para)
    and (r.id = any (p_ids)
         or r.dados->>'petId' = any (p_ids)
         or r.dados->>'careId' in (select c.id from public.registros c
                                    where c.familia_id = de and c.tipo = 'cuidado' and c.dados->>'petId' = any (p_ids)));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------- Regras de acesso ----------------

alter table public.registros alter column familia_id set default public.meu_espaco_pessoal();

drop policy if exists "registros: família lê"    on public.registros;
create policy "registros: família lê" on public.registros
  for select to authenticated using (familia_id in (select public.minhas_familias()));
drop policy if exists "registros: família cria"  on public.registros;
create policy "registros: família cria" on public.registros
  for insert to authenticated with check (familia_id in (select public.minhas_familias()));
drop policy if exists "registros: família altera" on public.registros;
create policy "registros: família altera" on public.registros
  for update to authenticated
  using (familia_id in (select public.minhas_familias()))
  with check (familia_id in (select public.minhas_familias()));
drop policy if exists "registros: família apaga" on public.registros;
create policy "registros: família apaga" on public.registros
  for delete to authenticated using (familia_id in (select public.minhas_familias()));

create or replace function public.anexo_da_familia(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select split_part(p_path, '/', 1) in (select f::text from public.minhas_familias() f)
      or exists (select 1 from public.registros
                 where tipo = 'anexo' and dados->>'path' = p_path
                   and familia_id in (select public.minhas_familias()));
$$;

drop policy if exists "anexos: família envia" on storage.objects;
create policy "anexos: família envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] in (select f::text from public.minhas_familias() f));
drop policy if exists "anexos: família altera" on storage.objects;
create policy "anexos: família altera" on storage.objects
  for update to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] in (select f::text from public.minhas_familias() f));

-- ---------------- Funções chamadas pelo app ----------------

-- Meus espaços: o pessoal (id) e a família compartilhada (ou null).
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
  return jsonb_build_object('pessoal', p, 'familia', case when f is null then null else jsonb_build_object(
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

-- Compatibilidade com o app 1.5.0 (só até ele se atualizar sozinho).
create or replace function public.minha_familia()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e jsonb := public.meus_espacos();
begin
  return coalesce(e->'familia', jsonb_build_object('id', e->>'pessoal', 'nome', 'Só meus', 'papel', 'responsavel', 'membros', '[]'::jsonb, 'convites', '[]'::jsonb));
end;
$$;

-- Criar convite: se a pessoa ainda não tem família, cria uma (ela é a responsável).
create or replace function public.criar_convite()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  f uuid;
  c public.convites;
begin
  if eu is null then raise exception 'sem login' using errcode = '42501'; end if;
  f := public.minha_familia_compartilhada();
  if f is null then
    insert into public.familias (nome, pessoal)
    values (coalesce('Família de ' || nullif(split_part(coalesce(
              (select raw_user_meta_data->>'name' from auth.users where id = eu),
              (select raw_user_meta_data->>'full_name' from auth.users where id = eu), ''), ' ', 1), ''), 'Minha família'), false)
    returning id into f;
    insert into public.familia_membros (familia_id, user_id, papel, pessoal) values (f, eu, 'responsavel', false);
  else
    f := public._exigir_responsavel();
  end if;
  if (select count(*) from public.convites where familia_id = f and revogado_em is null and usado_em is null and expira_em > now()) >= 10 then
    raise exception 'limite de convites ativos atingido' using errcode = 'P0001';
  end if;
  insert into public.convites (familia_id, criado_por) values (f, eu) returning * into c;
  return jsonb_build_object('token', c.token, 'expira_em', c.expira_em);
end;
$$;

-- Situação de um convite (tela "Você foi convidado").
drop function if exists public.ver_convite(text);
create or replace function public.ver_convite(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.convites;
  minha uuid := public.minha_familia_compartilhada();
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
    when minha is not null then 'em_familia'
    else 'valido' end;
  if st = 'invalido' then return jsonb_build_object('status', st); end if;
  return jsonb_build_object(
    'status', st,
    'familia', (select nome from public.familias where id = c.familia_id),
    'convidado_por', (select coalesce(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', split_part(email, '@', 1)) from auth.users where id = c.criado_por)
  );
end;
$$;

-- Aceitar: entra na família. Os pets pessoais continuam só da pessoa.
drop function if exists public.aceitar_convite(text, boolean);
create or replace function public.aceitar_convite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  c public.convites;
begin
  if eu is null then raise exception 'sem login' using errcode = '42501'; end if;
  select * into c from public.convites where token = p_token for update;
  if c.token is null then raise exception 'convite inválido' using errcode = 'P0001'; end if;
  if c.familia_id = public.minha_familia_compartilhada() then return c.familia_id; end if;
  if c.revogado_em is not null then raise exception 'convite revogado' using errcode = 'P0001'; end if;
  if c.usado_em is not null then raise exception 'convite já usado' using errcode = 'P0001'; end if;
  if c.expira_em <= now() then raise exception 'convite expirado' using errcode = 'P0001'; end if;
  if public.minha_familia_compartilhada() is not null then
    raise exception 'saia da família atual para entrar em outra' using errcode = 'P0001';
  end if;
  perform public._garantir_familia(eu);
  insert into public.familia_membros (familia_id, user_id, papel, pessoal) values (c.familia_id, eu, 'membro', false);
  update public.convites set usado_por = eu, usado_em = now() where token = c.token;
  return c.familia_id;
end;
$$;

-- Compartilhar pets "só meus" com a família (sem volta).
create or replace function public.compartilhar_pets(p_ids text[])
returns int language plpgsql security definer set search_path = '' as $$
declare f uuid := public.minha_familia_compartilhada(); p uuid := public.meu_espaco_pessoal();
begin
  if f is null then raise exception 'você não está em uma família' using errcode = 'P0001'; end if;
  return public._mover_pets(p_ids, p, f);
end;
$$;

-- Sair da família. Os pets compartilhados ficam com ela; os "só meus" continuam.
-- Se for a última pessoa, a família acaba e os pets dela voltam para "só meus".
drop function if exists public.sair_da_familia();
create or replace function public.sair_da_familia()
returns void language plpgsql security definer set search_path = '' as $$
declare eu uuid := auth.uid(); f uuid := public.minha_familia_compartilhada(); p uuid;
begin
  if f is null then raise exception 'você não está em uma família' using errcode = 'P0001'; end if;
  if (select count(*) from public.familia_membros where familia_id = f) = 1 then
    p := public._garantir_familia(eu);
    update public.registros set familia_id = p
     where familia_id = f and not excluido and id not in (select id from public.registros where familia_id = p);
    delete from public.familias where id = f;
  else
    delete from public.familia_membros where familia_id = f and user_id = eu;
    perform public._garantir_responsavel(f);
  end if;
end;
$$;

create or replace function public.remover_membro(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f uuid := public._exigir_responsavel();
begin
  if p_user = auth.uid() then raise exception 'use "sair da família"' using errcode = 'P0001'; end if;
  delete from public.familia_membros where familia_id = f and user_id = p_user and not pessoal;
  if not found then raise exception 'pessoa não está na família' using errcode = 'P0001'; end if;
end;
$$;

-- (alterar_papel, renomear_familia e revogar_convite usam _exigir_responsavel: já valem só para a família.)

-- ---------------- Funções que saíram ----------------
drop function if exists public._pets_repetidos(uuid, uuid);
drop function if exists public._nome_pet(text);

-- ---------------- Permissões ----------------
revoke all on function public._garantir_familia(uuid)              from public, anon, authenticated;
revoke all on function public._exigir_responsavel()                from public, anon, authenticated;
revoke all on function public._mover_pets(text[], uuid, uuid)      from public, anon, authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.meu_espaco_pessoal()', 'public.minha_familia_compartilhada()', 'public.minhas_familias()',
    'public.minha_familia_id()', 'public.anexo_da_familia(text)', 'public.meus_espacos()', 'public.minha_familia()',
    'public.criar_convite()', 'public.ver_convite(text)', 'public.aceitar_convite(text)',
    'public.compartilhar_pets(text[])', 'public.sair_da_familia()', 'public.remover_membro(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

commit;

-- ---------------- Conferência ----------------
select
  (select count(*) from auth.users)                                              as contas,
  (select count(*) from public.familias where pessoal)                           as espacos_pessoais,
  (select count(*) from public.familias where not pessoal)                       as familias,
  (select count(*) from auth.users u where not exists (select 1 from public.familia_membros m where m.user_id = u.id and m.pessoal)) as contas_sem_espaco,
  (select count(*) from public.registros r join public.familias f on f.id = r.familia_id where not f.pessoal and not r.excluido) as registros_na_familia,
  (select count(*) from public.registros r join public.familias f on f.id = r.familia_id where f.pessoal and not r.excluido)     as registros_so_meus;
