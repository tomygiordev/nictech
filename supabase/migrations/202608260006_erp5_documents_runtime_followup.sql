-- Resolve remaining Stage 8 name collisions and preserve least privilege.

revoke execute on function erp.record_provider_webhook(uuid, text, text, text, text, boolean)
  from authenticated;

drop function if exists erp.register_communication_attachment(uuid, text, bigint, text);
create function erp.register_communication_attachment(
  target_message_id uuid, target_mime_type text, target_byte_size bigint, target_sha256 text
)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare
  message_row erp.communication_messages%rowtype;
  existing_id uuid;
  result_id uuid;
  canonical_path text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = 'insufficient_privilege', message = 'service role is required';
  end if;
  select message.* into message_row from erp.communication_messages as message
   where message.id = target_message_id for update;
  if message_row.id is null or target_mime_type !~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'
     or target_byte_size is null or target_byte_size not between 1 and 1073741824
     or target_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'message and bounded attachment metadata are required';
  end if;
  canonical_path := 'communications/' || message_row.organization_id || '/' || message_row.branch_id || '/' || message_row.id || '/' || target_sha256;
  select attachment.id into existing_id from erp.communication_attachments as attachment
   where attachment.organization_id = message_row.organization_id
     and attachment.private_object_path = canonical_path;
  if existing_id is not null then
    if not exists (select 1 from erp.communication_attachments as attachment
      where attachment.id = existing_id and attachment.message_id = message_row.id
        and attachment.mime_type = target_mime_type and attachment.byte_size = target_byte_size
        and attachment.sha256 = target_sha256) then
      raise exception using errcode = 'integrity_constraint_violation', message = 'attachment digest is already used by different metadata';
    end if;
    return existing_id;
  end if;
  perform set_config('erp.operation_reason', 'Communication attachment metadata registered', true);
  insert into erp.communication_attachments(organization_id, branch_id, message_id, private_object_path, mime_type, byte_size, sha256)
  values (message_row.organization_id, message_row.branch_id, message_row.id, canonical_path, target_mime_type, target_byte_size, target_sha256)
  returning id into result_id;
  return result_id;
end;
$$;
grant execute on function erp.register_communication_attachment(uuid, text, bigint, text) to service_role;

drop function if exists erp.record_communication_automation_execution(uuid, text, uuid, uuid, text, text);
create function erp.record_communication_automation_execution(
  target_rule_id uuid, target_source_event_type text, target_source_event_id uuid,
  target_message_id uuid, target_execution_outcome text, target_execution_reason text
)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare
  rule_row erp.communication_automation_rules%rowtype;
  existing_row erp.communication_automation_executions%rowtype;
  result_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = 'insufficient_privilege', message = 'service role is required';
  end if;
  select rule.* into rule_row from erp.communication_automation_rules as rule
   where rule.id = target_rule_id and rule.is_active for update;
  if rule_row.id is null or rule_row.branch_id is null
     or nullif(btrim(target_source_event_type), '') is null or length(target_source_event_type) > 120
     or target_source_event_id is null or target_execution_outcome not in ('queued','skipped','failed')
     or nullif(btrim(target_execution_reason), '') is null or length(target_execution_reason) > 1000
     or (target_execution_outcome = 'queued') <> (target_message_id is not null)
     or (target_message_id is not null and not exists (
       select 1 from erp.communication_messages as message
        where message.id = target_message_id and message.organization_id = rule_row.organization_id
          and message.branch_id = rule_row.branch_id)) then
    raise exception using errcode = 'invalid_parameter_value', message = 'active rule and bounded automation result are required';
  end if;
  select execution.* into existing_row from erp.communication_automation_executions as execution
   where execution.rule_id = rule_row.id
     and execution.source_event_type = btrim(target_source_event_type)
     and execution.source_event_id = target_source_event_id;
  if existing_row.id is not null then
    if existing_row.message_id is distinct from target_message_id
       or existing_row.outcome <> target_execution_outcome
       or existing_row.reason <> target_execution_reason then
      raise exception using errcode = 'integrity_constraint_violation', message = 'automation source already has a different execution result';
    end if;
    return existing_row.id;
  end if;
  perform set_config('erp.operation_reason', 'Communication automation execution', true);
  insert into erp.communication_automation_executions(organization_id, branch_id, rule_id, source_event_type, source_event_id, message_id, outcome, reason)
  values (rule_row.organization_id, rule_row.branch_id, rule_row.id, btrim(target_source_event_type), target_source_event_id, target_message_id, target_execution_outcome, target_execution_reason)
  returning id into result_id;
  return result_id;
end;
$$;
grant execute on function erp.record_communication_automation_execution(uuid, text, uuid, uuid, text, text) to service_role;
