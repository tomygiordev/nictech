begin;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.reissue_repair_quote_token(uuid,timestamptz,text)'::regprocedure)
    into definition;

  definition := replace(
    definition,
    'update erp.repair_quote_response_tokens set revoked_at=clock_timestamp() where quote_id=target_quote_id',
    'update erp.repair_quote_response_tokens as tokens set revoked_at=clock_timestamp() where tokens.quote_id=target_quote_id'
  );

  execute definition;
end;
$migration$;

commit;
