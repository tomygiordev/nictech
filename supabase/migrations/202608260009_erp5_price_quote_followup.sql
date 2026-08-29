-- Phase A: use the preview creation snapshot for optimistic price concurrency.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.apply_price_change(uuid,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'and entry.effective_at <= effective_time', 'and entry.effective_at <= preview.created_at');
  execute definition;

  select pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'where u.id=erp.create_repair_quote_version.inventory_unit_id', 'where u.id=inventory_unit_id');
  definition := replace(definition, 'as $$', 'as $$\n#variable_conflict use_variable');
  execute definition;
end;
$migration$;
