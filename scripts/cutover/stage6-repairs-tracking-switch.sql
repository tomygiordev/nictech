\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply false
\endif
\echo 'Etapa 6: cambio de seguimiento (predeterminado: dry-run; usar -v apply=true para aplicar)'
begin;
select pg_advisory_xact_lock(hashtextextended('erp.cutover.repair_tracking',0));
do $$
declare old_oid oid:=to_regprocedure('public.get_repair_by_tracking_code(text)'); new_oid oid:=to_regprocedure('public.get_repair_by_tracking_code_erp(text)');
begin
  if old_oid is null or new_oid is null then raise exception 'Falta el RPC anterior o el nuevo con argumento text'; end if;
  if pg_get_function_result(old_oid) is distinct from pg_get_function_result(new_oid) then
    raise exception 'Las firmas de retorno difieren. No se hará el corte: anterior %, ERP %', pg_get_function_result(old_oid),pg_get_function_result(new_oid);
  end if;
  if exists(select 1 from erp.cutover_function_backups where function_identity='public.get_repair_by_tracking_code(text)' and restored_at is null) then
    raise exception 'Ya hay un respaldo activo. No se sobrescribe.';
  end if;
  raise notice 'Chequeos correctos. Contrato: %',pg_get_function_result(old_oid);
end $$;
\if :apply
insert into erp.cutover_function_backups(function_identity,definition)
select 'public.get_repair_by_tracking_code(text)',pg_get_functiondef('public.get_repair_by_tracking_code(text)'::regprocedure);
do $$ declare result_type text:=pg_get_function_result('public.get_repair_by_tracking_code(text)'::regprocedure); begin
  execute format('create or replace function public.get_repair_by_tracking_code(search_code text) returns %s language sql volatile security definer set search_path=pg_catalog,public as $body$ select * from public.get_repair_by_tracking_code_erp(search_code) $body$',result_type);
end $$;
commit;
\echo 'Corte aplicado; respaldo conservado.'
\else
rollback;
\echo 'Dry-run completado; no se cambió ningún objeto.'
\endif
