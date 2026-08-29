begin;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.preview_price_change(uuid,text,text,jsonb)'::regprocedure)
    into definition;

  definition := replace(
    definition,
    'and effective_at <= now()',
    'and effective_at <= clock_timestamp()'
  );

  execute definition;
end;
$migration$;

grant select on table erp.repair_quote_response_tokens to authenticated;

commit;
