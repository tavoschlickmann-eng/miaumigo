-- =========================================================
-- Miaumigo: "ping" para o projeto gratuito do Supabase não pausar
-- (o plano gratuito pausa após 7 dias sem atividade no banco).
-- Chamado uma vez por dia pela tarefa .github/workflows/manter-ativo.yml
--
-- Não lê nem expõe dado nenhum: só devolve a hora do servidor,
-- mas passa pelo banco, o que conta como atividade.
-- =========================================================

create or replace function public.ping()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

select public.ping() as ok;
