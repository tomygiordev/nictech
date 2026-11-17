-- Migration: 202609070008_erp_phase_e_complete_pc_build_ambiguity_fix.sql
-- Description: Phase E fix 42702 en erp.complete_pc_build (parametro vs columna ambiguos).
-- El parametro warranty_snapshot colisiona con la columna c.warranty_snapshot dentro del
-- INSERT...SELECT a pc_component_lineage: el nombre pelado es ambiguo (42702) y el
-- calificado con nombre de funcion no resuelve en SQL (42P01). Se copia el parametro a la
-- variable local v_warranty_snapshot al inicio del BEGIN y el CASE usa el alias.

set search_path = erp, pg_catalog;

create or replace function erp.complete_pc_build(target_project_id uuid,target_revision_id uuid,target_reservation_batch_id uuid,build_serial text,warranty_snapshot jsonb,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); rev erp.pc_build_revisions%rowtype; project erp.pc_build_projects%rowtype; cmd erp.stage7_commands%rowtype; key_row erp.repair_credential_keys%rowtype; candidate erp.repair_credential_keys%rowtype; payload jsonb; prior_hash text; normalized text:=nullif(upper(regexp_replace(btrim(build_serial),'[[:space:]-]+','','g')),''); stock_id uuid; equipment_id uuid; completion_id uuid; latest_test uuid; required_template uuid; reservation_created_at timestamptz; v_warranty_snapshot jsonb;
begin
  v_warranty_snapshot := warranty_snapshot;
  select * into project from erp.pc_build_projects where id=target_project_id and organization_id=org_id for update; select * into rev from erp.pc_build_revisions where id=target_revision_id and project_id=target_project_id and organization_id=org_id;
  if project.id is null or rev.id is null or not erp.has_permission('pc_builds.manage',project.branch_id) then raise exception using errcode='insufficient_privilege',message='pc_builds.manage permission is required'; end if;
  if normalized is null or length(build_serial)>200 or warranty_snapshot is null or jsonb_typeof(warranty_snapshot)<>'object' or pg_column_size(warranty_snapshot)>65536 or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='build serial, bounded warranty and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  select request_hash into prior_hash from erp.stage7_commands where command_name='pc.project.complete' and organization_id=org_id and branch_id=project.branch_id and idempotency_key=operation_key;
  if prior_hash is not null then for candidate in select * from erp.repair_credential_keys where organization_id=org_id order by key_version loop payload:=jsonb_build_object('project_id',target_project_id,'revision_id',target_revision_id,'batch_id',target_reservation_batch_id,'serial_hmac',encode(extensions.hmac(convert_to(normalized,'UTF8'),candidate.key_material,'sha256'),'hex'),'identifier_key_id',candidate.id,'warranty_hmac',encode(extensions.hmac(convert_to(warranty_snapshot::text,'UTF8'),candidate.key_material,'sha256'),'hex'),'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),candidate.key_material,'sha256'),'hex')); if encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')=prior_hash then key_row:=candidate; exit; end if; end loop; if key_row.id is null then raise exception using errcode='integrity_constraint_violation',message='idempotency key is already used by another request'; end if;
  else select * into key_row from erp.repair_credential_keys where organization_id=org_id and is_active for share; end if;
  if key_row.id is null then raise exception using errcode='object_not_in_prerequisite_state',message='protected repair identifier key is unavailable'; end if;
  payload:=jsonb_build_object('project_id',target_project_id,'revision_id',target_revision_id,'batch_id',target_reservation_batch_id,'serial_hmac',encode(extensions.hmac(convert_to(normalized,'UTF8'),key_row.key_material,'sha256'),'hex'),'identifier_key_id',key_row.id,'warranty_hmac',encode(extensions.hmac(convert_to(warranty_snapshot::text,'UTF8'),key_row.key_material,'sha256'),'hex'),'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),key_row.key_material,'sha256'),'hex')); cmd:=erp.claim_stage7_command('pc.project.complete',org_id,project.branch_id,operation_key,payload); if cmd.result_id is not null then return (select equipment_id from erp.pc_build_completions where id=cmd.result_id); end if;
  if exists(select 1 from erp.pc_build_completions where project_id=project.id) or coalesce((select state in('completed','cancelled') from erp.pc_build_state_events where project_id=project.id order by event_sequence desc limit 1),false) then raise exception using errcode='object_not_in_prerequisite_state',message='PC project is terminal'; end if;
  if rev.id<>(select id from erp.pc_build_revisions where project_id=project.id order by version desc limit 1) or coalesce((select outcome<>'fail' from erp.pc_compatibility_runs where revision_id=rev.id order by run_sequence desc limit 1),false)=false then raise exception using errcode='object_not_in_prerequisite_state',message='latest compatible revision is required'; end if;
  select r.created_at into reservation_created_at from erp.pc_build_reservations r join erp.stock_reservation_batches b on b.id=r.reservation_batch_id and b.organization_id=r.organization_id where r.project_id=project.id and r.revision_id=rev.id and r.reservation_batch_id=target_reservation_batch_id and b.status='active' and b.expires_at>clock_timestamp();
  select nullif(value#>>'{}','')::uuid into required_template from erp.configuration_values where organization_id=org_id and branch_id is null and key='pc_builds.final_test_template_version';
  select id into latest_test from erp.pc_test_runs where revision_id=rev.id and template_version_id=required_template and completed_at>=reservation_created_at order by run_sequence desc limit 1;
  if reservation_created_at is null or latest_test is null or exists(select 1 from erp.pc_test_results where test_run_id=latest_test and result<>'pass') or (select count(*) from erp.pc_test_results where test_run_id=latest_test)<>(select count(*) from jsonb_array_elements((select definition from erp.pc_test_template_versions where id=required_template)) d where coalesce((d->>'required')::boolean,true)) then raise exception using errcode='object_not_in_prerequisite_state',message='exact active reservation and current complete passing PC test are required'; end if;
  stock_id:=erp.fulfill_stock_reservation(target_reservation_batch_id,operation_key||':stock',operation_reason);
  insert into erp.customer_equipment(organization_id,equipment_type,brand_snapshot,model_snapshot,serial_number,notes,created_by) values(org_id,'PC','NicTech','Custom build',btrim(build_serial),'PC build '||project.id,auth.uid()) returning id into equipment_id;
  insert into erp.equipment_ownership_events(organization_id,equipment_id,customer_id,reason,actor_id) values(org_id,equipment_id,project.customer_id,operation_reason,auth.uid());
  insert into erp.pc_build_completions(organization_id,branch_id,project_id,revision_id,reservation_batch_id,stock_document_id,equipment_id,completed_by) values(org_id,project.branch_id,project.id,rev.id,target_reservation_batch_id,stock_id,equipment_id,auth.uid()) returning id into completion_id;
  insert into erp.pc_component_lineage(organization_id,completion_id,component_id,product_id,variant_id,inventory_unit_id,quantity,serial_snapshot,unit_cost_snapshot,warranty_snapshot)
  select org_id,completion_id,c.id,c.product_id,c.variant_id,c.inventory_unit_id,c.quantity,
    coalesce(u.serial_number,u.imei,c.serial_snapshot),cost.unit_cost,
    case when c.warranty_snapshot='{}' then v_warranty_snapshot else c.warranty_snapshot end
  from erp.pc_build_components c
  left join erp.inventory_units u on u.id=c.inventory_unit_id and u.organization_id=org_id
  cross join lateral (
    select round(sum(abs(m.value_delta_base))/sum(abs(m.quantity_delta)),8) unit_cost
    from erp.stock_cost_movements m
    where m.organization_id=org_id and m.document_id=stock_id
      and m.product_id=c.product_id and m.variant_id is not distinct from c.variant_id
      and m.inventory_unit_id is not distinct from c.inventory_unit_id
  ) cost
  where c.revision_id=rev.id and cost.unit_cost is not null;
  if (select count(*) from erp.pc_component_lineage l where l.completion_id=completion_id)<>(select count(*) from erp.pc_build_components where revision_id=rev.id) then raise exception using errcode='check_violation',message='fulfillment cost lineage does not exactly match build components'; end if;
  insert into erp.pc_build_state_events(organization_id,branch_id,project_id,state,reason,actor_id) values(org_id,project.branch_id,project.id,'completed',operation_reason,auth.uid()); perform erp.complete_stage7_command(cmd.id,completion_id); return equipment_id;
end $$;
