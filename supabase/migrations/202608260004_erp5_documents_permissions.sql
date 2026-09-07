-- Correct the Stage 8 queue implementation and preserve intended fixture access.

create or replace function erp.queue_customer_message(
  target_branch_id uuid,
  target_customer_id uuid,
  target_conversation_id uuid,
  target_template_version_id uuid,
  recipient_address text,
  variables jsonb,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, erp
as $$
declare
  org_id uuid := erp.current_organization_id();
  command_row erp.stage8_commands%rowtype;
  conversation_id uuid;
  message_channel erp.communication_channel;
  message_body text;
  expected_keys jsonb;
  result_id uuid;
begin
  select template.channel, version.body, version.variable_keys
    into message_channel, message_body, expected_keys
    from erp.message_template_versions as version
    join erp.message_templates as template
      on template.id = version.template_id
     and template.organization_id = version.organization_id
   where version.id = target_template_version_id
     and version.organization_id = org_id
     and template.is_active;

  if org_id is null
     or not erp.has_permission('messages.manage', target_branch_id)
     or message_channel is null
     or variables is null
     or jsonb_typeof(variables) <> 'object'
     or pg_column_size(variables) > 131072
     or exists (
       select 1
         from jsonb_array_elements_text(expected_keys) as required_key(value)
        where not variables ? required_key.value
     )
     or exists (
       select 1
         from jsonb_object_keys(variables) as supplied_key(value)
        where not expected_keys ? supplied_key.value
     )
     or nullif(btrim(recipient_address), '') is null
     or length(recipient_address) > 320
     or nullif(btrim(operation_reason), '') is null
     or not exists (
       select 1
         from erp.customers as customer
        where customer.id = target_customer_id
          and customer.organization_id = org_id
     )
     or not coalesce((
       select consent.granted
         from erp.communication_consents as consent
        where consent.organization_id = org_id
          and consent.customer_id = target_customer_id
          and consent.channel = message_channel
        order by consent.event_sequence desc
        limit 1
     ), false)
  then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'active template, customer, consent, recipient, exact variables and permission are required';
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);
  command_row := erp.claim_stage8_command(
    'message.queue',
    org_id,
    target_branch_id,
    operation_key,
    jsonb_build_object(
      'customer_id', target_customer_id,
      'conversation_id', target_conversation_id,
      'template_id', target_template_version_id,
      'recipient', recipient_address,
      'variables', variables,
      'reason', operation_reason
    )
  );

  if command_row.result_id is not null then
    return command_row.result_id;
  end if;

  if target_conversation_id is null then
    insert into erp.conversations(organization_id, branch_id, customer_id, channel)
      values (org_id, target_branch_id, target_customer_id, message_channel)
      returning id into conversation_id;
  else
    select conversation.id
      into conversation_id
      from erp.conversations as conversation
     where conversation.id = target_conversation_id
       and conversation.organization_id = org_id
       and conversation.branch_id = target_branch_id
       and conversation.customer_id = target_customer_id
       and conversation.channel = message_channel
       and conversation.closed_at is null
     for update;
  end if;

  if conversation_id is null then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'active matching conversation is required';
  end if;

  insert into erp.communication_messages(
    organization_id, branch_id, conversation_id, customer_id, channel,
    direction, template_version_id, recipient_address, body_snapshot,
    variables_snapshot, created_by
  )
  values (
    org_id, target_branch_id, conversation_id, target_customer_id, message_channel,
    'outbound', target_template_version_id, btrim(recipient_address), message_body,
    variables, auth.uid()
  )
  returning id into result_id;

  insert into erp.communication_message_events(organization_id, branch_id, message_id, status)
    values (org_id, target_branch_id, result_id, 'queued');

  insert into erp.integration_outbox(
    organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
  )
  values (
    org_id, target_branch_id, 'communication_message', result_id,
    'message.send.requested',
    jsonb_build_object('message_id', result_id, 'channel', message_channel, 'redacted', true),
    'stage8:message:' || result_id
  );

  perform erp.complete_stage8_command(command_row.id, result_id);
  return result_id;
end;
$$;

grant execute on function erp.queue_customer_message(uuid, uuid, uuid, uuid, text, jsonb, text, text)
  to authenticated, service_role;
