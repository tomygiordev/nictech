begin;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.deliver_repair_order(uuid,text,text,text,text,integer,text,text,text)'::regprocedure)
    into definition;

  definition := replace(
    definition,
    'select s into latest from erp.repair_state_events e join erp.repair_statuses s',
    'select s.* into latest from erp.repair_state_events e join erp.repair_statuses s'
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
    'update erp.repair_quote_response_tokens token set revoked_at=clock_timestamp() from erp.repair_quotes old_quote where token.quote_id=old_quote.id and old_quote.repair_order_id=target_repair_order_id and old_quote.id<>created_quote_id and token.used_at is null and token.revoked_at is null',
    'update erp.repair_quote_response_tokens as token set revoked_at=clock_timestamp() where token.quote_id=prior and token.used_at is null and token.revoked_at is null'
  );

  execute definition;
end;
$migration$;

commit;
