-- Phase A: compare the authoritative amount and remove PL/pgSQL/table name collisions.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.apply_price_change(uuid,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'current_entry.id is distinct from line.baseline_entry_id' || chr(10) || '        or ', '');
  execute definition;

  select pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'quote_id uuid;', 'created_quote_id uuid;');
  definition := replace(definition, 'into quote_id', 'into created_quote_id');
  definition := replace(definition, 'quote_id:=', 'created_quote_id:=');
  definition := replace(definition, 'quote_id and', 'created_quote_id and');
  definition := replace(definition, 'quote_id,', 'created_quote_id,');
  definition := replace(definition, 'quote_id);', 'created_quote_id);');
  definition := replace(definition, 'quote_id; return', 'created_quote_id; return');
  execute definition;
end;
$migration$;
