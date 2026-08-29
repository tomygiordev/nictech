-- Phase A: bind optimistic-concurrency checks to the preview snapshot.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.apply_price_change(uuid,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'from erp.price_change_preview_lines line', 'from erp.price_change_preview_lines line join erp.price_change_previews preview on preview.id = line.preview_id');
  execute definition;

  select pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'inventory_unit_id uuid;', 'quote_inventory_unit_id uuid;');
  definition := replace(definition, 'inventory_unit_id:=', 'quote_inventory_unit_id:=');
  definition := replace(definition, 'inventory_unit_id is', 'quote_inventory_unit_id is');
  definition := replace(definition, 'u.id=inventory_unit_id', 'u.id=quote_inventory_unit_id');
  definition := replace(definition, '''inventory_unit_id'',inventory_unit_id', '''inventory_unit_id'',quote_inventory_unit_id');
  execute definition;
end;
$migration$;
