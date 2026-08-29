begin;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure)
    into definition;

  definition := replace(
    definition,
    'update erp.repair_quote_response_tokens token set revoked_at=clock_timestamp()\n  from erp.repair_quotes old_quote where token.quote_id=old_quote.id and old_quote.repair_order_id=target_repair_order_id\n    and old_quote.id<>created_quote_id and token.used_at is null and token.revoked_at is null;',
    'update erp.repair_quote_response_tokens as token set revoked_at=clock_timestamp()\n  where token.quote_id=prior and token.used_at is null and token.revoked_at is null;'
  );

  execute definition;
end;
$migration$;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('erp.open_repair_warranty_claim(uuid,text,text,text)'::regprocedure)
    into definition;

  definition := replace(
    definition,
    'insert into erp.repair_warranty_claims(organization_id,branch_id,warranty_id,claim_code,reported_issue,opened_by)',
    'insert into erp.repair_warranty_claims(organization_id,branch_id,warranty_id,claim_code,reported_issue,opened_at,opened_by)'
  );
  definition := replace(
    definition,
    'reported_issue,''WC-''||upper(substr(replace(extensions.gen_random_uuid()::text,''-'',''''),1,12)),reported_issue,auth.uid())',
    'reported_issue,''WC-''||upper(substr(replace(extensions.gen_random_uuid()::text,''-'',''''),1,12)),reported_issue,clock_timestamp(),auth.uid())'
  );

  execute definition;
end;
$migration$;

commit;
