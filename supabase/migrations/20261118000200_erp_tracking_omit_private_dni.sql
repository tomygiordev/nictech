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
  -- Preserve the public response shape without echoing a private identifier.
  select c.display_name, ''::text, r.opened_at, e.brand_snapshot, e.model_snapshot,
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
