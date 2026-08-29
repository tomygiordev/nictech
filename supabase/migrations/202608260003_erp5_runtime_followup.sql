-- Runtime follow-up for corrections discovered after applying 202608260002.

revoke execute on function erp.provision_repair_credential_key(uuid, bytea, text) from authenticated;

create or replace function erp.release_stock_reservation(target_batch_id uuid, release_reason text)
returns void language plpgsql security definer set search_path = erp, pg_catalog, pg_temp as $$
declare actor_organization_id uuid := erp.current_organization_id(); target_branch_id uuid; reservation_source_type text; source_permission text; reservation_row record;
begin
  select branch_id, source_type into target_branch_id, reservation_source_type from erp.stock_reservation_batches where id=target_batch_id and organization_id=actor_organization_id and status='active';
  if target_branch_id is null then raise exception using errcode='object_not_in_prerequisite_state',message='active reservation not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text||':'||target_branch_id::text,0));
  select branch_id, source_type into target_branch_id, reservation_source_type from erp.stock_reservation_batches where id=target_batch_id and organization_id=actor_organization_id and status='active' for update;
  if target_branch_id is null then raise exception using errcode='object_not_in_prerequisite_state',message='active reservation not found'; end if;
  if not erp.has_permission('stock.move',target_branch_id) then raise exception using errcode='insufficient_privilege',message='stock.move permission is required'; end if;
  source_permission:=erp.reservation_source_permission(reservation_source_type);
  if source_permission is null or not erp.has_permission(source_permission,target_branch_id) then raise exception using errcode='insufficient_privilege',message='reservation source permission is required'; end if;
  if nullif(btrim(release_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='release reason is required'; end if;
  perform set_config('erp.operation_reason',release_reason,true);
  for reservation_row in select * from erp.stock_reservations where batch_id=target_batch_id order by id for update loop
    update erp.stock_balances set quantity_reserved=quantity_reserved-reservation_row.quantity,updated_at=now() where organization_id=actor_organization_id and location_id=reservation_row.location_id and product_id=reservation_row.product_id and variant_key=coalesce(reservation_row.variant_id,'00000000-0000-0000-0000-000000000000'::uuid) and quantity_reserved>=reservation_row.quantity;
    if not found then raise exception using errcode='data_exception',message='reservation balance is inconsistent'; end if;
    if reservation_row.inventory_unit_id is not null then
      update erp.inventory_units set status='available',updated_by=auth.uid() where id=reservation_row.inventory_unit_id and organization_id=actor_organization_id and status='reserved';
      if not found then raise exception using errcode='data_exception',message='reserved inventory unit is inconsistent'; end if;
    end if;
  end loop;
  update erp.stock_reservation_batches set status=(case when expires_at<=now() then 'expired'::erp.stock_reservation_status else 'released'::erp.stock_reservation_status end),released_at=now(),reason=release_reason,updated_by=auth.uid() where id=target_batch_id and organization_id=actor_organization_id;
end $$;

create or replace function erp.release_web_order_reservation_core(target_organization_id uuid,target_web_order_id uuid,target_batch_id uuid,release_reason text)
returns void language plpgsql security definer set search_path=erp,pg_catalog,pg_temp as $$
declare target_branch_id uuid; reservation_row record;
begin
  select branch_id into target_branch_id from erp.stock_reservation_batches where id=target_batch_id and organization_id=target_organization_id and source_type='online_order' and source_id=target_web_order_id and status='active';
  if target_branch_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':'||target_branch_id::text,0));
  perform 1 from erp.stock_reservation_batches where id=target_batch_id and organization_id=target_organization_id and source_type='online_order' and source_id=target_web_order_id and status='active' for update;
  if not found then return; end if;
  perform set_config('erp.operation_reason',release_reason,true);
  for reservation_row in select * from erp.stock_reservations where batch_id=target_batch_id order by id for update loop
    update erp.stock_balances set quantity_reserved=quantity_reserved-reservation_row.quantity,updated_at=now() where organization_id=target_organization_id and location_id=reservation_row.location_id and product_id=reservation_row.product_id and variant_key=coalesce(reservation_row.variant_id,'00000000-0000-0000-0000-000000000000'::uuid) and quantity_reserved>=reservation_row.quantity;
    if not found then raise exception using errcode='data_exception',message='reservation balance is inconsistent'; end if;
    if reservation_row.inventory_unit_id is not null then
      update erp.inventory_units set status='available',updated_by=auth.uid() where id=reservation_row.inventory_unit_id and organization_id=target_organization_id and status='reserved';
      if not found then raise exception using errcode='data_exception',message='reserved inventory unit is inconsistent'; end if;
    end if;
  end loop;
  update erp.stock_reservation_batches set status=(case when expires_at<=now() then 'expired'::erp.stock_reservation_status else 'released'::erp.stock_reservation_status end),released_at=now(),reason=release_reason,updated_by=auth.uid() where id=target_batch_id and organization_id=target_organization_id;
end $$;

create or replace function erp.queue_customer_message(target_branch_id uuid, target_customer_id uuid, target_conversation_id uuid, target_template_version_id uuid, recipient_address text, variables jsonb, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); cmd erp.stage8_commands%rowtype; conversation_id uuid; channel erp.communication_channel; body text; expected_keys jsonb; result_id uuid;
begin
  select t.channel,v.body,v.variable_keys into channel,body,expected_keys from erp.message_template_versions v join erp.message_templates t on t.id=v.template_id and t.organization_id=v.organization_id where v.id=target_template_version_id and v.organization_id=org_id and t.is_active;
  if org_id is null or not erp.has_permission('messages.manage',target_branch_id) or channel is null or variables is null or jsonb_typeof(variables)<>'object' or pg_column_size(variables)>131072 or exists(select 1 from jsonb_array_elements_text(expected_keys) as expected_key(value) where not variables ? expected_key.value) or exists(select 1 from jsonb_object_keys(variables) as supplied_key(value) where not expected_keys ? supplied_key.value) or nullif(btrim(recipient_address),'') is null or length(recipient_address)>320 or nullif(btrim(operation_reason),'') is null or not exists(select 1 from erp.customers c where c.id=target_customer_id and c.organization_id=org_id) or not coalesce((select consent.granted from erp.communication_consents consent where consent.organization_id=org_id and consent.customer_id=target_customer_id and consent.channel=queue_customer_message.channel order by consent.event_sequence desc limit 1),false) then raise exception using errcode='object_not_in_prerequisite_state',message='active template, customer, consent, recipient, exact variables and permission are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('message.queue',org_id,target_branch_id,operation_key,jsonb_build_object('customer_id',target_customer_id,'conversation_id',target_conversation_id,'template_id',target_template_version_id,'recipient',recipient_address,'variables',variables,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  if target_conversation_id is null then insert into erp.conversations(organization_id,branch_id,customer_id,channel) values(org_id,target_branch_id,target_customer_id,channel) returning id into conversation_id; else select c.id into conversation_id from erp.conversations c where c.id=target_conversation_id and c.organization_id=org_id and c.branch_id=target_branch_id and c.customer_id=target_customer_id and c.channel=queue_customer_message.channel and c.closed_at is null for update; end if;
  if conversation_id is null then raise exception using errcode='foreign_key_violation',message='active matching conversation is required'; end if;
  insert into erp.communication_messages(organization_id,branch_id,conversation_id,customer_id,channel,direction,template_version_id,recipient_address,body_snapshot,variables_snapshot,created_by) values(org_id,target_branch_id,conversation_id,target_customer_id,channel,'outbound',target_template_version_id,btrim(recipient_address),body,variables,auth.uid()) returning id into result_id;
  insert into erp.communication_message_events(organization_id,branch_id,message_id,status) values(org_id,target_branch_id,result_id,'queued');
  insert into erp.integration_outbox(organization_id,branch_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(org_id,target_branch_id,'communication_message',result_id,'message.send.requested',jsonb_build_object('message_id',result_id,'channel',channel,'redacted',true),'stage8:message:'||result_id);
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;
