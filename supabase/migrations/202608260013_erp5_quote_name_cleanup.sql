-- Phase A: repair the local-variable rename without changing persisted column names.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'supersedes_created_quote_id', 'supersedes_quote_id');
  execute definition;
end;
$migration$;
