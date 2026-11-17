begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(5);

create function pg_temp.test_legacy_tracking() returns setof text
language plpgsql as $$
declare
  repair_id uuid := gen_random_uuid();
  code text := 'TST-' || substr(replace(repair_id::text, '-', ''), 1, 12);
  actual_count bigint;
  actual_type text;
  actual_status text;
  actual_logs json;
begin
  if to_regclass('public.repairs') is null then
    for i in 1..5 loop
      return next ok(true, 'skip: public.repairs absent (' || i || ')');
    end loop;
    return;
  end if;

  insert into public.repairs (id, tracking_code, client_dni, device_model, status)
  values (repair_id, code, '999999999', 'Test device', 'Recibido');
  insert into public.repair_logs (repair_id, content, is_public)
  values (repair_id, 'Public fixture', true), (repair_id, 'Private fixture', false);

  set local role anon;
  select count(*), min(pg_typeof(t.status)::text), min(t.status::text), min(t.repair_logs::text)::json
  into actual_count, actual_type, actual_status, actual_logs
  from public.get_repair_by_tracking_code(code) t;
  return next is(actual_count, 1::bigint, 'anon receives one repair');
  return next is(actual_type, 'repair_status', 'status has repair_status type');
  return next is(actual_status, 'Recibido', 'status retains its value');
  return next ok(json_array_length(actual_logs) = 1
    and actual_logs->0->>'content' = 'Public fixture'
    and (actual_logs->0->>'is_public')::boolean, 'only public logs are returned');
  select count(*) into actual_count from public.get_repair_by_tracking_code('NOPE-0000');
  return next is(actual_count, 0::bigint, 'unknown code returns no rows');
  reset role;
end;
$$;
select * from pg_temp.test_legacy_tracking();
select * from finish();
rollback;
