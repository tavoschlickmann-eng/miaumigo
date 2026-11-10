-- =========================================================
-- Miaumigo, Fase 5: conta e segurança
-- Rode DEPOIS de premium.sql. Roda numa transação; idempotente.
-- =========================================================

begin;

-- 1. Limite de tamanho de cada registro (o maior hoje, um pet com foto
--    de perfil, tem ~40 KB). Impede que alguém encha o banco gratuito
--    mandando um registro gigante pela API.
alter table public.registros drop constraint if exists registros_dados_tamanho;
alter table public.registros add constraint registros_dados_tamanho check (pg_column_size(dados) <= 262144); -- 256 KB

-- 2. Excluir a própria conta.
--    * Pets "Só meus" e tudo deles: apagados.
--    * Família com outras pessoas: os pets continuam com elas; se a pessoa
--      era a única responsável, o membro mais antigo assume.
--    * Família só dela: apagada com os pets.
--    * Login, assinatura e papel de admin: apagados (em cascata).
--    Os arquivos no Storage são apagados pelo app ANTES de chamar esta
--    função (o banco não pode apagar arquivos diretamente).
create or replace function public.excluir_minha_conta()
returns void language plpgsql security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  p uuid;
  f uuid;
begin
  if eu is null then raise exception 'sem login' using errcode = '42501'; end if;
  select familia_id into p from public.familia_membros where user_id = eu and pessoal;
  select familia_id into f from public.familia_membros where user_id = eu and not pessoal;
  if f is not null then
    if (select count(*) from public.familia_membros where familia_id = f) = 1 then
      delete from public.familias where id = f;              -- última pessoa: a família acaba
    else
      delete from public.familia_membros where familia_id = f and user_id = eu;
      perform public._garantir_responsavel(f);                -- alguém assume como responsável
    end if;
  end if;
  if p is not null then delete from public.familias where id = p; end if;  -- "Só meus" e tudo deles
  delete from auth.users where id = eu;
end;
$$;

revoke all on function public.excluir_minha_conta() from public, anon;
grant execute on function public.excluir_minha_conta() to authenticated;

commit;
