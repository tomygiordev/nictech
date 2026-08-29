begin;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.apply_price_change(uuid,text,text)'::regprocedure)
    into definition;

  definition := replace(
    definition,
    'entry.variant_key = line.variant_key',
    'entry.variant_key is not distinct from line.variant_key'
  );

  execute definition;
end;
$migration$;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure)
    into definition;

  definition := replace(
    definition,
    'insert into erp.repair_quote_lines(organization_id,created_quote_id,line_number',
    'insert into erp.repair_quote_lines(organization_id,quote_id,line_number'
  );
  definition := replace(definition, 'return quote_id;', 'return created_quote_id;');

  execute definition;
end;
$migration$;

commit;
