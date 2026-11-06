-- =========================================================
-- Miaumigo: banco no Supabase
-- Rode este arquivo inteiro uma vez no SQL Editor do projeto.
-- Pode rodar de novo sem problema (é idempotente).
-- =========================================================

-- Todos os dados do app (pets, cuidados, pesos, gastos, rações e
-- metadados de anexos) ficam em uma tabela só. Cada linha é um
-- registro do app guardado como JSON, com a data da última alteração
-- (definida pelo servidor) e uma marca de exclusão para a sincronização.
create table if not exists public.registros (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  tipo       text        not null check (tipo in ('pet', 'cuidado', 'peso', 'gasto', 'racao', 'anexo')),
  dados      jsonb       not null default '{}'::jsonb,
  excluido   boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists registros_sync_idx on public.registros (user_id, updated_at);

-- A data de alteração sempre vem do relógio do servidor,
-- nunca do aparelho (que pode estar com a hora errada).
create or replace function public.registros_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists registros_updated_at on public.registros;
create trigger registros_updated_at
  before insert or update on public.registros
  for each row execute function public.registros_set_updated_at();

-- Segurança: cada pessoa só vê e altera as próprias linhas.
alter table public.registros enable row level security;

drop policy if exists "registros: dono lê" on public.registros;
create policy "registros: dono lê" on public.registros
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "registros: dono cria" on public.registros;
create policy "registros: dono cria" on public.registros
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "registros: dono altera" on public.registros;
create policy "registros: dono altera" on public.registros
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "registros: dono apaga" on public.registros;
create policy "registros: dono apaga" on public.registros
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------
-- Anexos (fotos e PDFs): bucket privado.
-- Caminho dos arquivos: <id do usuário>/<id do anexo>
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anexos: dono lê" on storage.objects;
create policy "anexos: dono lê" on storage.objects
  for select to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "anexos: dono envia" on storage.objects;
create policy "anexos: dono envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "anexos: dono altera" on storage.objects;
create policy "anexos: dono altera" on storage.objects
  for update to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "anexos: dono apaga" on storage.objects;
create policy "anexos: dono apaga" on storage.objects
  for delete to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = (select auth.uid())::text);
