begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select has_function('erp', 'ensure_storefront_ars_exchange_snapshot', array[]::text[],
  'Storefront ARS snapshot command exists');
select is(has_function_privilege('authenticated',
  'erp.ensure_storefront_ars_exchange_snapshot()', 'EXECUTE'), false,
  'Browser sessions cannot create exchange snapshots');

create temporary table _storefront_snapshot_test (id uuid not null) on commit drop;
insert into _storefront_snapshot_test select erp.ensure_storefront_ars_exchange_snapshot();
select is(erp.ensure_storefront_ars_exchange_snapshot(), (select id from _storefront_snapshot_test),
  'Repeating the command returns the same snapshot');
select is((select count(*) from erp.exchange_rates
  where idempotency_key = 'storefront-ars-base-currency'), 1::bigint,
  'The command creates one immutable exchange rate');

select * from finish();
rollback;
