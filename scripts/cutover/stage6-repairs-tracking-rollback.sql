\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply false
\endif
\echo 'Etapa 6: rollback de seguimiento (predeterminado: dry-run; usar -v apply=true para aplicar)'
begin;
select pg_advisory_xact_lock(hashtextextended('erp.cutover.repair_tracking',0));
do $$ begin
  if to_regprocedure('public.get_repair_by_tracking_code(text)') is null then raise exception 'No existe el RPC con argumento text'; end if;
  if position('public.get_repair_by_tracking_code_erp(search_code)' in pg_get_functiondef('public.get_repair_by_tracking_code(text)'::regprocedure))=0 then raise exception 'El RPC actual no coincide con el adaptador de corte; revisar manualmente'; end if;
  if not exists(select 1 from erp.cutover_function_backups where function_identity='public.get_repair_by_tracking_code(text)' and restored_at is null) then raise exception 'No hay respaldo activo para restaurar'; end if;
  raise notice 'Respaldo activo encontrado.';
end $$;
\if :apply
do $$ declare b erp.cutover_function_backups%rowtype; begin
  select * into strict b from erp.cutover_function_backups where function_identity='public.get_repair_by_tracking_code(text)' and restored_at is null order by id desc limit 1 for update;
  execute b.definition;
  update erp.cutover_function_backups set restored_at=clock_timestamp() where id=b.id;
end $$;
commit;
\echo 'Definición anterior restaurada.'
\else
rollback;
\echo 'Dry-run completado; no se cambió ningún objeto.'
\endif
