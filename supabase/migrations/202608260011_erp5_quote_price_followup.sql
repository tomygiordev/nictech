-- Phase A: preserve optimistic concurrency while including prices created in the current transaction.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.apply_price_change(uuid,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'and entry.effective_at <= preview.created_at', 'and entry.effective_at <= effective_time');
  execute definition;

  select pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'product_id uuid;', 'quote_product_id uuid;');
  definition := replace(definition, 'variant_id uuid;', 'quote_variant_id uuid;');
  definition := replace(definition, 'product_id:=', 'quote_product_id:=');
  definition := replace(definition, 'variant_id:=', 'quote_variant_id:=');
  definition := replace(definition, 'p.id=product_id', 'p.id=quote_product_id');
  definition := replace(definition, 'b.product_id=product_id', 'b.product_id=quote_product_id');
  definition := replace(definition, 'u.product_id=product_id', 'u.product_id=quote_product_id');
  definition := replace(definition, 'b.product_id = product_id', 'b.product_id = quote_product_id');
  definition := replace(definition, 'coalesce(variant_id,', 'coalesce(quote_variant_id,');
  definition := replace(definition, 'is not distinct from variant_id', 'is not distinct from quote_variant_id');
  definition := replace(definition, '''product_id'',product_id', '''product_id'',quote_product_id');
  definition := replace(definition, '''variant_id'',variant_id', '''variant_id'',quote_variant_id');
  execute definition;
end;
$migration$;
