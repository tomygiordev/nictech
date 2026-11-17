-- Mercado Pago settles the storefront in ARS. Create an immutable 1:1
-- exchange snapshot only when the operator prepares the webhook cutover.
create or replace function erp.ensure_storefront_ars_exchange_snapshot()
returns uuid
language plpgsql
set search_path = pg_catalog, erp, pg_temp
as $$
declare
  target_org constant uuid := '10000000-0000-0000-0000-000000000001';
  operation_key constant text := 'storefront-ars-base-currency';
  rate_id uuid;
  snapshot_id uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = 'insufficient_privilege',
      message = 'storefront exchange snapshot requires the database owner';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nictech:storefront-ars-rate', 0));
  if not exists (
    select 1 from erp.organization_currencies
    where organization_id = target_org and currency_code = 'ARS'
      and is_base and is_active
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'active ARS base currency is required';
  end if;

  select r.id, s.id into rate_id, snapshot_id
  from erp.exchange_rates r
  join erp.exchange_rate_snapshots s
    on s.exchange_rate_id = r.id and s.organization_id = r.organization_id
  where r.organization_id = target_org and r.idempotency_key = operation_key;
  if found then
    if not exists (
      select 1 from erp.exchange_rates r
      where r.id = rate_id and r.base_currency = 'ARS'
        and r.quote_currency = 'ARS' and r.rate_to_base = 1
    ) then
      raise exception using errcode = 'integrity_constraint_violation',
        message = 'storefront ARS operation key belongs to another rate';
    end if;
    return snapshot_id;
  end if;

  insert into erp.exchange_rates (
    organization_id, base_currency, quote_currency, rate_to_base,
    source, quoted_at, idempotency_key, request_hash
  ) values (
    target_org, 'ARS', 'ARS', 1,
    'storefront_base_currency', now(), operation_key,
    md5('storefront:ARS:ARS:1')
  ) returning id into rate_id;

  insert into erp.exchange_rate_snapshots (
    organization_id, exchange_rate_id, base_currency, quote_currency,
    rate_to_base, source, quoted_at, captured_at
  )
  select organization_id, id, base_currency, quote_currency,
    rate_to_base, source, quoted_at, captured_at
  from erp.exchange_rates where id = rate_id
  returning id into snapshot_id;
  return snapshot_id;
end;
$$;

revoke all on function erp.ensure_storefront_ars_exchange_snapshot()
  from public, anon, authenticated, service_role;
