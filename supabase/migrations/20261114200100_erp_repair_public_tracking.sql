-- Short codes are globally unique because the public lookup has no tenant selector.
alter table erp.repair_orders add column public_tracking_code text;
create unique index repair_orders_public_tracking_code_key on erp.repair_orders(public_tracking_code);
create or replace function erp.new_repair_public_code() returns text
language plpgsql volatile set search_path=pg_catalog,extensions as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; out_code text := ''; i integer;
begin
  b := extensions.gen_random_bytes(8);
  for i in 0..7 loop
    if i=4 then out_code := out_code || '-'; end if;
    out_code := out_code || substr(alphabet, (get_byte(b,i) % 32)+1, 1);
  end loop;
  return out_code;
end $$;
revoke all on function erp.new_repair_public_code() from public,anon,authenticated,service_role;
create or replace function erp.assign_repair_public_code() returns trigger
language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
begin
  if new.public_tracking_code is not null then
    raise exception using errcode='22023', message='public tracking code is server generated';
  end if;
  -- Serialize allocation through commit, including inserts in other organizations.
  perform pg_advisory_xact_lock(hashtextextended('erp.repair.public_tracking_code',0));
  loop
    new.public_tracking_code := erp.new_repair_public_code();
    exit when not exists(select 1 from erp.repair_orders r where r.public_tracking_code=new.public_tracking_code);
  end loop;
  return new;
end $$;
revoke all on function erp.assign_repair_public_code() from public,anon,authenticated,service_role;
create trigger repair_order_assign_public_code before insert on erp.repair_orders for each row execute function erp.assign_repair_public_code();
-- Existing orders are immutable; only this migration temporarily permits their code backfill.
alter table erp.repair_orders disable trigger repair_orders_immutable;
do $$ declare r record; c text; begin
  perform pg_advisory_xact_lock(hashtextextended('erp.repair.public_tracking_code',0));
  for r in select id from erp.repair_orders where public_tracking_code is null loop
    loop
      c:=erp.new_repair_public_code();
      exit when not exists(select 1 from erp.repair_orders where public_tracking_code=c);
    end loop;
    update erp.repair_orders set public_tracking_code=c where id=r.id;
  end loop;
end $$;
alter table erp.repair_orders enable trigger repair_orders_immutable;
alter table erp.repair_orders alter column public_tracking_code set not null;
alter table erp.repair_orders add constraint repair_orders_public_tracking_code_format check(public_tracking_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$');
grant select(public_tracking_code) on erp.repair_orders to authenticated;

create table erp.repair_notes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid not null,
  repair_order_id uuid not null, content text not null check(length(btrim(content)) between 1 and 4000),
  is_public boolean not null default false, created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  foreign key (repair_order_id,organization_id,branch_id) references erp.repair_orders(id,organization_id,branch_id)
);
create index repair_notes_order_idx on erp.repair_notes(repair_order_id,created_at);
alter table erp.repair_notes enable row level security;
create policy repair_notes_read on erp.repair_notes for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('repairs.view',branch_id));
revoke all on erp.repair_notes from public,anon,authenticated,service_role;
grant select on erp.repair_notes to authenticated;
create trigger repair_notes_audit after insert on erp.repair_notes for each row execute function erp.audit_repair_fact();
create trigger repair_notes_immutable before update or delete on erp.repair_notes for each row execute function erp.prevent_fact_mutation();
create or replace function erp.add_repair_note(p_repair_order_id uuid,p_content text,p_is_public boolean)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org uuid:=erp.current_organization_id(); branch uuid; note_id uuid;
begin
  select branch_id into branch from erp.repair_orders where id=p_repair_order_id and organization_id=org;
  if branch is null or not erp.has_permission('repairs.manage',branch) then raise exception using errcode='42501',message='repairs.manage permission is required'; end if;
  if p_is_public is null or length(btrim(coalesce(p_content,''))) not between 1 and 4000 then raise exception using errcode='22023',message='valid content and visibility are required'; end if;
  insert into erp.repair_notes(organization_id,branch_id,repair_order_id,content,is_public,created_by)
  values(org,branch,p_repair_order_id,btrim(p_content),p_is_public,auth.uid()) returning id into note_id;
  return note_id;
end $$;
revoke all on function erp.add_repair_note(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function erp.add_repair_note(uuid,text,boolean) to authenticated;

-- Legacy enum is present in production, but is absent from the repository migrations.
do $$ begin
  if to_regtype('public.repair_status') is null then
    create type public.repair_status as enum ('Recibido','Diagnóstico','Repuestos','Reparación','Finalizado');
  end if;
end $$;
create table erp.repair_tracking_rate_config (
  singleton boolean primary key default true check(singleton), window_seconds integer not null default 900 check(window_seconds between 1 and 86400),
  max_per_value integer not null default 20 check(max_per_value > 0), max_per_ip integer not null default 60 check(max_per_ip > 0)
);
insert into erp.repair_tracking_rate_config(singleton) values(true);
create table erp.repair_tracking_attempts (
  bucket text primary key, window_started timestamptz not null, attempts integer not null check(attempts > 0)
);
alter table erp.repair_tracking_attempts enable row level security;
alter table erp.repair_tracking_rate_config enable row level security;
revoke all on erp.repair_tracking_attempts, erp.repair_tracking_rate_config from public,anon,authenticated,service_role;
create table erp.cutover_function_backups (
  id bigint generated always as identity primary key, function_identity text not null,
  definition text not null, captured_at timestamptz not null default clock_timestamp(), restored_at timestamptz
);
alter table erp.cutover_function_backups enable row level security;
revoke all on erp.cutover_function_backups from public,anon,authenticated,service_role;

create or replace function erp.get_repair_by_tracking_code_erp_core(search_code text)
returns table(client_name text, client_dni text, created_at timestamptz, device_brand text, device_model text,
 id uuid, locality text, notes text, problem_description text, status public.repair_status, tracking_code text, repair_logs jsonb)
language plpgsql volatile security definer set search_path=pg_catalog,erp,extensions,public as $$
declare v_search text:=upper(btrim(coalesce(search_code,''))); headers jsonb; ip text; cfg erp.repair_tracking_rate_config%rowtype;
  value_key text; ip_key text; value_count integer; ip_count integer;
begin
  if length(v_search) not between 4 and 40 then return; end if;
  begin headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb; exception when others then headers:='{}'::jsonb; end;
  -- Trust the last proxy-added hop only when the deployment guarantees that the proxy appends it.
  -- Without a trusted proxy, forwarded headers remain client-controlled.
  ip:=nullif(btrim(split_part(coalesce(headers->>'x-forwarded-for',''),',',-1)),'');
  delete from erp.repair_tracking_attempts where ctid in (
    select ctid from erp.repair_tracking_attempts
    where window_started < clock_timestamp() - interval '1 day'
    limit 100
  );
  if length(ip)>128 then ip:=null; end if;
  select * into cfg from erp.repair_tracking_rate_config where singleton;
  value_key:='v:'||encode(extensions.digest(convert_to(v_search,'UTF8'),'sha256'),'hex');
  ip_key:='i:'||encode(extensions.digest(convert_to(coalesce(ip,'unknown'),'UTF8'),'sha256'),'hex');
  insert into erp.repair_tracking_attempts as a(bucket,window_started,attempts) values(ip_key,clock_timestamp(),1)
  on conflict(bucket) do update set window_started=case when a.window_started < clock_timestamp()-make_interval(secs=>cfg.window_seconds) then clock_timestamp() else a.window_started end,
    attempts=case when a.window_started < clock_timestamp()-make_interval(secs=>cfg.window_seconds) then 1 else a.attempts+1 end returning attempts into ip_count;
  if ip_count>cfg.max_per_ip then return; end if;
  insert into erp.repair_tracking_attempts as a(bucket,window_started,attempts) values(value_key,clock_timestamp(),1)
  on conflict(bucket) do update set window_started=case when a.window_started < clock_timestamp()-make_interval(secs=>cfg.window_seconds) then clock_timestamp() else a.window_started end,
    attempts=case when a.window_started < clock_timestamp()-make_interval(secs=>cfg.window_seconds) then 1 else a.attempts+1 end returning attempts into value_count;
  if value_count>cfg.max_per_value then return; end if;
  return query
  select c.display_name, coalesce(cp.identity_document,''), r.opened_at, e.brand_snapshot, e.model_snapshot,
    r.id, coalesce(nullif(b.address->>'locality',''),b.name), ''::text, r.reported_fault,
    s.public_stage::public.repair_status, r.public_tracking_code,
    coalesce((select jsonb_agg(x.entry order by x.created_at) from (
      select se.occurred_at as created_at,jsonb_build_object('id',se.id,'created_at',se.occurred_at,'content',se.public_message,'is_public',true) as entry
      from erp.repair_state_events se where se.repair_order_id=r.id and se.organization_id=r.organization_id
      union all
      select n.created_at,jsonb_build_object('id',n.id,'created_at',n.created_at,'content',n.content,'is_public',true)
      from erp.repair_notes n where n.repair_order_id=r.id and n.organization_id=r.organization_id and n.is_public
    ) x),'[]'::jsonb)
  from erp.repair_orders r
  join erp.customers c on c.id=r.customer_id and c.organization_id=r.organization_id
  join erp.customer_equipment e on e.id=r.equipment_id and e.organization_id=r.organization_id
  join erp.branches b on b.id=r.branch_id and b.organization_id=r.organization_id
  left join erp.customer_private_details cp on cp.customer_id=c.id and cp.organization_id=c.organization_id
  join lateral (select st.public_stage from erp.repair_state_events se join erp.repair_statuses st on st.id=se.status_id and st.organization_id=se.organization_id
    where se.repair_order_id=r.id and se.organization_id=r.organization_id order by se.event_sequence desc limit 1) s on true
  where s.public_stage is not null and (
    r.public_tracking_code=v_search
    or (
      cp.identity_document is not null and (
        upper(btrim(cp.identity_document))=v_search
        or (
          v_search ~ '^[0-9.\s-]+$'
          and length(regexp_replace(v_search,'[^0-9]+','','g')) between 6 and 12
          and regexp_replace(cp.identity_document,'[^0-9]+','','g')=regexp_replace(v_search,'[^0-9]+','','g')
        )
      )
    )
  )
  order by r.opened_at desc, r.id desc
  limit 5;
end $$;
revoke all on function erp.get_repair_by_tracking_code_erp_core(text) from public,anon,authenticated,service_role;
-- En entornos donde existe el RPC legacy, su catálogo es la fuente de verdad de tipos y orden.
-- Sin RPC legacy (reconstrucción local), se usa el contrato tipado conocido del repositorio.
do $$
declare old_oid oid:=to_regprocedure('public.get_repair_by_tracking_code(text)');
  result_sql text; columns_sql text; output_names text[];
  previous_search_path text:=current_setting('search_path');
  expected constant text[] := array['client_name','client_dni','created_at','device_brand','device_model','id','locality','notes','problem_description','status','tracking_code','repair_logs'];
begin
  if old_oid is null then old_oid:=to_regprocedure('erp.get_repair_by_tracking_code_erp_core(text)'); end if;
  -- Qualify non-system types in the generated contract, regardless of the caller's search_path.
  perform set_config('search_path','pg_catalog',true);
  select pg_get_function_result(p.oid),
    string_agg(format('%I %s',x.argname,format_type(x.argtype,null)),', ' order by x.n),
    array_agg(x.argname order by x.n)
  into result_sql,columns_sql,output_names
  from pg_proc p cross join lateral unnest(p.proallargtypes,p.proargmodes,p.proargnames) with ordinality x(argtype,argmode,argname,n)
  where p.oid=old_oid and x.argmode in ('o','t','b') group by p.oid;
  if result_sql is null or output_names is null or cardinality(output_names)<>cardinality(expected)
     or not (output_names @> expected and expected @> output_names) then
    raise exception 'El RPC legacy no tiene las columnas esperadas; no se instala el adaptador';
  end if;
  drop function if exists public.get_repair_by_tracking_code_erp(text);
  execute format('create function public.get_repair_by_tracking_code_erp(search_code text) returns %s language sql volatile security definer set search_path=pg_catalog,erp as $body$ select x.* from erp.get_repair_by_tracking_code_erp_core(search_code) c cross join lateral pg_catalog.jsonb_to_record(pg_catalog.to_jsonb(c)) as x(%s) $body$',result_sql,columns_sql);
  perform set_config('search_path',previous_search_path,true);
end $$;
revoke all on function public.get_repair_by_tracking_code_erp(text) from public,anon,authenticated,service_role;
grant execute on function public.get_repair_by_tracking_code_erp(text) to anon,authenticated;
-- Future organizations receive a complete default workflow. Seed bypasses this only while inserting its deterministic IDs.
create or replace function erp.initialize_repair_statuses_for_organization() returns trigger
language plpgsql security definer set search_path=pg_catalog,erp as $$
begin
  if current_setting('erp.seed_repair_statuses',true)='on' then return new; end if;
  insert into erp.repair_statuses(organization_id,code,name,display_order,is_initial,is_terminal,requires_final_tests,public_message,public_stage)
  values (new.id,'received','Recibido',1,true,false,false,'Equipo recibido','Recibido'),
         (new.id,'diagnosis','Diagnóstico',2,false,false,false,'Equipo en diagnóstico','Diagnóstico'),
         (new.id,'repair','Reparación',3,false,false,false,'Reparación en curso','Reparación'),
         (new.id,'ready','Listo para entregar',4,false,true,true,'Equipo listo para entregar','Finalizado')
  on conflict (organization_id,code) do nothing;
  perform erp.install_repair_public_stages(new.id);
  return new;
end $$;
revoke all on function erp.initialize_repair_statuses_for_organization() from public,anon,authenticated,service_role;
create trigger organizations_repair_statuses after insert on erp.organizations for each row execute function erp.initialize_repair_statuses_for_organization();

create or replace function erp.search_repairs_by_document(p_document text)
returns table(repair_order_id uuid) language plpgsql volatile security definer set search_path=pg_catalog,erp as $$
declare org uuid:=erp.current_organization_id(); needle text:=btrim(coalesce(p_document,''));
begin
  if org is null or not erp.has_permission('customers.view_sensitive') then
    raise exception using errcode='42501',message='customers.view_sensitive is required';
  end if;
  if needle !~ '^[0-9]{7,8}$' then return; end if;
  insert into erp.audit_events(organization_id,actor_user_id,schema_name,table_name,record_id,action,metadata)
  values(org,auth.uid(),'erp','customer_private_details','repair-document-search','read_sensitive',jsonb_build_object('context','repair_search'));
  return query select r.id from erp.repair_orders r join erp.customer_private_details cp on cp.customer_id=r.customer_id and cp.organization_id=r.organization_id
  where r.organization_id=org and cp.identity_document=needle and erp.has_permission('repairs.view',r.branch_id);
end $$;
revoke all on function erp.search_repairs_by_document(text) from public,anon,authenticated,service_role;
grant execute on function erp.search_repairs_by_document(text) to authenticated;

create or replace function erp.intake_repair_order(
  target_branch_id uuid,
  target_customer_id uuid,
  equipment_type text,
  brand_name text,
  model_name text,
  serial_number text default null,
  imei text default null,
  accessories jsonb default '[]'::jsonb,
  intake_condition text default 'Recibido en taller',
  intake_damage text default null,
  intake_notes text default null,
  reported_fault text default 'Diagnóstico técnico',
  operation_reason text default 'Ingreso de reparación'
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare
  org_id uuid := erp.current_organization_id();
  eq_id uuid;
  norm_serial text := nullif(upper(regexp_replace(btrim(serial_number), '[[:space:]-]+', '', 'g')), '');
  norm_imei text := nullif(regexp_replace(btrim(imei), '[^0-9]+', '', 'g'), '');
  op_key text := 'intake-' || extensions.gen_random_uuid()::text;
  repair_res record;
begin
  if org_id is null or not erp.has_permission('repairs.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'repairs.manage permission is required';
  end if;

  -- Look up existing equipment owned by this customer
  if norm_serial is not null or norm_imei is not null then
    select e.id into eq_id
    from erp.customer_equipment e
    where e.organization_id = org_id
      and (
        (norm_serial is not null and e.normalized_serial_number = norm_serial)
        or (norm_imei is not null and e.normalized_imei = norm_imei)
      )
      and (
        select customer_id from erp.equipment_ownership_events
        where equipment_id = e.id order by event_sequence desc limit 1
      ) = target_customer_id
    limit 1;
  end if;

  -- Create equipment if not yet registered
  if eq_id is null then
    eq_id := erp.create_customer_equipment(
      target_branch_id,
      target_customer_id,
      null, -- brand_id
      null, -- model_id
      coalesce(nullif(btrim(equipment_type), ''), 'Smartphone'),
      coalesce(nullif(btrim(brand_name), ''), 'Genérico'),
      coalesce(nullif(btrim(model_name), ''), 'Dispositivo'),
      serial_number,
      imei,
      op_key || ':eq',
      operation_reason
    );
  end if;

  -- Create repair order
  select * into repair_res
  from erp.create_repair_order(
    target_branch_id,
    target_customer_id,
    eq_id,
    coalesce(accessories, '[]'::jsonb),
    coalesce(nullif(btrim(intake_condition), ''), 'Recibido en taller'),
    intake_damage,
    intake_notes,
    coalesce(nullif(btrim(reported_fault), ''), 'Diagnóstico técnico'),
    op_key || ':ro',
    operation_reason
  );

  return jsonb_build_object(
    'repair_order_id', repair_res.repair_order_id,
    'order_code', repair_res.order_code,
    'tracking_token', repair_res.tracking_token,
    'equipment_id', eq_id,
    'public_tracking_code', (select r.public_tracking_code from erp.repair_orders r where r.id=repair_res.repair_order_id and r.organization_id=org_id)
  );
end;
$$;


create or replace view erp.repair_orders_overview with (security_invoker = true) as
select
  r.id,
  r.organization_id,
  r.branch_id,
  r.order_number,
  r.order_code,
  r.opened_at,
  r.customer_id,
  c.code as customer_code,
  c.display_name as customer_name,
  c.phone as customer_phone,
  c.email as customer_email,
  r.equipment_id,
  e.equipment_type,
  e.brand_snapshot,
  e.model_snapshot,
  r.reported_fault,
  r.intake_condition,
  r.intake_damage,
  r.intake_notes,
  r.intake_accessories,
  -- Current status
  latest_event.status_id,
  latest_status.code as status_code,
  latest_status.name as status_name,
  latest_status.is_initial as status_is_initial,
  latest_status.is_terminal as status_is_terminal,
  latest_status.requires_final_tests as status_requires_final_tests,
  latest_event.occurred_at as status_updated_at,
  latest_event.public_message as status_public_message,
  -- Delivery info
  d.id as delivery_id,
  d.recipient_name,
  d.recipient_document_suffix,
  d.delivered_at,
  w.id as warranty_id,
  w.ends_at as warranty_ends_at,
  -- Quote summary
  (
    select jsonb_build_object(
      'id', q.id,
      'version', q.version,
      'total_amount', q.total_amount,
      'currency_code', q.currency_code,
      'issued_at', q.issued_at,
      'expires_at', q.expires_at,
      'decision', (
        select decision from erp.repair_quote_response_events re
        where re.repair_order_id = r.id order by re.occurred_at desc limit 1
      )
    )
    from erp.repair_quotes q
    where q.repair_order_id = r.id
    order by q.version desc limit 1
  ) as latest_quote,
  -- Parts count
  (
    select count(*) from erp.repair_part_events p
    where p.repair_order_id = r.id and p.action = 'consumed'
    and not exists (select 1 from erp.repair_part_events rev where rev.reverses_event_id = p.id)
  ) as active_parts_count,
  -- QC pass check
  erp.repair_latest_final_test_passes(r.id, r.organization_id) as qc_passed,
  r.public_tracking_code,
  latest_status.public_stage as status_public_stage
from erp.repair_orders r
join erp.customers c on c.id = r.customer_id and c.organization_id = r.organization_id
join erp.customer_equipment e on e.id = r.equipment_id and e.organization_id = r.organization_id
left join lateral (
  select se.status_id, se.public_message, se.occurred_at
  from erp.repair_state_events se
  where se.repair_order_id = r.id and se.organization_id = r.organization_id
  order by se.event_sequence desc limit 1
) latest_event on true
left join erp.repair_statuses latest_status on latest_status.id = latest_event.status_id and latest_status.organization_id = r.organization_id
left join erp.repair_deliveries d on d.repair_order_id = r.id and d.organization_id = r.organization_id
left join erp.repair_warranties w on w.delivery_id = d.id and w.organization_id = r.organization_id;

