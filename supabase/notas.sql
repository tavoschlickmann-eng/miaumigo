-- =========================================================
-- Miaumigo, Fase 3: Notas por pet
-- Rode DEPOIS de espacos.sql. Roda numa transação; idempotente.
--
-- Cada nota é um registro tipo 'nota' (petId, data, hora, texto,
-- etiquetas, autor). A foto opcional é um anexo comum, ligado à nota
-- pelo mesmo campo careId usado pelos cuidados.
-- =========================================================

begin;

-- 1. Novo tipo de registro
alter table public.registros drop constraint if exists registros_tipo_check;
alter table public.registros add constraint registros_tipo_check
  check (tipo in ('pet', 'cuidado', 'peso', 'gasto', 'racao', 'anexo', 'nota'));

-- 2. Compartilhar um pet leva também as notas e as fotos delas
--    (notas têm petId; as fotos apontam para a nota em careId).
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
                                    where c.familia_id = de and c.tipo in ('cuidado', 'nota')
                                      and c.dados->>'petId' = any (p_ids)));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public._mover_pets(text[], uuid, uuid) from public, anon, authenticated;

commit;
