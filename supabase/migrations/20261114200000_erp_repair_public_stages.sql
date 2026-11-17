-- Etapa 6, construcción parcial: catálogo de estados y coherencia de entrega.
alter table erp.repair_statuses add column if not exists public_stage text
  check (public_stage in ('Recibido','Diagnóstico','Repuestos','Reparación','Finalizado'));

create or replace function erp.install_repair_public_stages(target_org uuid)
returns void language plpgsql set search_path = pg_catalog, erp as $$
declare next_order integer;
begin
  update erp.repair_statuses set public_stage = case code
    when 'received' then 'Recibido' when 'diagnosis' then 'Diagnóstico'
    when 'waiting_parts' then 'Repuestos' when 'repair' then 'Reparación'
    when 'ready' then 'Finalizado' when 'delivered' then 'Finalizado' end
  where organization_id = target_org and code in ('received','diagnosis','waiting_parts','repair','ready','delivered');

  select coalesce(max(display_order),0) into next_order from erp.repair_statuses where organization_id = target_org;
  insert into erp.repair_statuses (organization_id,code,name,display_order,is_initial,is_terminal,requires_final_tests,public_message,public_stage)
  values (target_org,'waiting_parts','Esperando repuestos',next_order+1,false,false,false,'Esperando repuestos','Repuestos'),
         (target_org,'delivered','Entregado',next_order+2,false,true,false,'Equipo entregado','Finalizado')
  on conflict (organization_id,code) do nothing;

  insert into erp.repair_status_transitions (organization_id,from_status_id,to_status_id,required_permission)
  select target_org, f.id, t.id, 'repairs.manage'
  from (values ('received','diagnosis'),('diagnosis','waiting_parts'),('diagnosis','repair'),
               ('waiting_parts','repair'),('repair','waiting_parts'),('repair','ready'),('ready','delivered')) v(from_code,to_code)
  join erp.repair_statuses f on f.organization_id=target_org and f.code=v.from_code
  join erp.repair_statuses t on t.organization_id=target_org and t.code=v.to_code
  on conflict (organization_id,from_status_id,to_status_id) do nothing;
end; $$;
revoke all on function erp.install_repair_public_stages(uuid) from public, anon, authenticated, service_role;
select erp.install_repair_public_stages(id) from erp.organizations;

-- Solo la entrega formal puede producir el evento Entregado.
create or replace function erp.guard_delivered_repair_event()
returns trigger language plpgsql security definer set search_path = pg_catalog, erp as $$
begin
  if exists (select 1 from erp.repair_statuses s where s.id=new.status_id and s.organization_id=new.organization_id and s.code='delivered')
     and not exists (select 1 from erp.repair_deliveries d where d.repair_order_id=new.repair_order_id and d.organization_id=new.organization_id) then
    raise exception using errcode='object_not_in_prerequisite_state', message='formal delivery is required';
  end if;
  return new;
end; $$;
revoke all on function erp.guard_delivered_repair_event() from public, anon, authenticated, service_role;
create trigger repair_state_delivered_guard before insert on erp.repair_state_events
for each row execute function erp.guard_delivered_repair_event();

create or replace function erp.record_delivered_repair_event()
returns trigger language plpgsql security definer set search_path = pg_catalog, erp as $$
declare delivered_status erp.repair_statuses%rowtype;
begin
  select * into delivered_status from erp.repair_statuses
  where organization_id=new.organization_id and code='delivered' and is_active;
  if delivered_status.id is null then
    raise exception using errcode='object_not_in_prerequisite_state', message='delivered status is not configured';
  end if;
  insert into erp.repair_state_events(organization_id,branch_id,repair_order_id,status_id,public_message,internal_reason,actor_id)
  values(new.organization_id,new.branch_id,new.repair_order_id,delivered_status.id,delivered_status.public_message,'Entrega formal',new.delivered_by);
  return new;
end; $$;
revoke all on function erp.record_delivered_repair_event() from public, anon, authenticated, service_role;
create trigger repair_delivery_record_state after insert on erp.repair_deliveries
for each row execute function erp.record_delivered_repair_event();

-- Conservar el significado de entregas registradas antes de instalar el catálogo.
insert into erp.repair_state_events(organization_id,branch_id,repair_order_id,status_id,public_message,internal_reason,occurred_at,actor_id)
select d.organization_id,d.branch_id,d.repair_order_id,s.id,s.public_message,'Entrega formal anterior',d.delivered_at,d.delivered_by
from erp.repair_deliveries d
join erp.repair_statuses s on s.organization_id=d.organization_id and s.code='delivered' and s.is_active
where not exists (
  select 1 from erp.repair_state_events e
  join erp.repair_statuses es on es.id=e.status_id and es.organization_id=e.organization_id
  where e.repair_order_id=d.repair_order_id and e.organization_id=d.organization_id and es.code='delivered'
);
