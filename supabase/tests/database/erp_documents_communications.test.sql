begin;

create extension if not exists pgtap with schema extensions;

select plan(133);

-- Stage 8 schema.
select has_table('erp','stage8_commands','Stage 8 command ledger exists');
select has_table('erp','document_templates','Document templates exist');
select has_table('erp','document_template_versions','Document template versions exist');
select has_table('erp','documents','Immutable customer documents exist');
select has_table('erp','document_events','Document lifecycle events exist');
select has_table('erp','fiscal_points','Fiscal points exist');
select has_table('erp','fiscal_counters','Fiscal counters exist');
select has_table('erp','fiscal_requests','Fiscal requests exist');
select has_table('erp','fiscal_events','Fiscal provider events exist');
select has_table('erp','communication_consents','Communication consent history exists');
select has_table('erp','message_templates','Message templates exist');
select has_table('erp','message_template_versions','Message template versions exist');
select has_table('erp','conversations','Conversations exist');
select has_table('erp','conversation_assignments','Assignment history exists');
select has_table('erp','communication_messages','Message facts exist');
select has_table('erp','communication_message_events','Message status history exists');
select has_table('erp','communication_attachments','Attachment metadata exists');
select has_table('erp','provider_webhook_events','Webhook receipt history exists');
select has_table('erp','integration_dead_letters','Dead-letter history exists');
select has_table('erp','communication_automation_rules','Automation rules exist');
select has_table('erp','communication_automation_executions','Automation execution history exists');

select has_column('erp','documents','customer_snapshot','Documents freeze a customer-safe projection');
select has_column('erp','documents','private_object_path','Documents retain a private canonical object path');
select has_column('erp','document_events','status','Document lifecycle status is append-only');
select has_column('erp','fiscal_requests','voucher_number','Fiscal requests freeze the voucher number');
select has_column('erp','fiscal_events','cae','Fiscal events retain CAE');
select has_column('erp','communication_messages','direction','Messages distinguish inbound and outbound');
select has_column('erp','communication_message_events','provider_message_id','Provider message identity belongs to immutable events');
select has_column('erp','provider_webhook_events','signature_valid','Webhook signature verdict is retained');
select has_column('erp','communication_automation_rules','conditions','Automation conditions are configurable');

select has_function('erp','issue_document',array['uuid','uuid','text','uuid','text','jsonb','text','text','text','text'],'Checked document issuance exists');
select has_function('erp','create_document_template_version',array['uuid','jsonb','text','text'],'Document template version command exists');
select has_function('erp','create_message_template_version',array['uuid','text','text','text','jsonb','text','text'],'Message template version command exists');
select has_function('erp','void_document',array['uuid','text','text'],'Document void command exists');
select has_function('erp','request_fiscal_issuance',array['uuid','uuid','text','text','text'],'Fiscal request command exists');
select has_function('erp','record_fiscal_provider_result',array['uuid','text','text','erp.fiscal_status','text','date','text','text','text'],'Fiscal provider ingest exists');
select has_function('erp','record_communication_consent',array['uuid','uuid','erp.communication_channel','boolean','text','text','text'],'Consent command exists');
select has_function('erp','queue_customer_message',array['uuid','uuid','uuid','uuid','text','jsonb','text','text'],'Outbound message command exists');
select has_function('erp','record_provider_message_event',array['uuid','text','text','erp.communication_status','text','text','text'],'Provider message status ingest exists');
select has_function('erp','record_provider_webhook',array['uuid','text','text','text','text','boolean'],'Webhook receipt command exists');
select has_function('erp','record_inbound_message',array['uuid','erp.communication_channel','text','text','uuid','text','text','text','timestamp with time zone'],'Inbound message command exists');
select has_function('erp','assign_conversation',array['uuid','uuid','text','text'],'Conversation assignment command exists');
select has_function('erp','register_communication_attachment',array['uuid','text','bigint','text'],'Attachment registration exists');
select has_function('erp','configure_communication_automation',array['uuid','text','text','uuid','jsonb','boolean','text','text'],'Automation configuration exists');
select has_function('erp','record_communication_automation_execution',array['uuid','text','uuid','uuid','text','text'],'Automation execution recording exists');
select has_function('erp','move_integration_to_dead_letter',array['uuid','text'],'Dead-letter command exists');

select ok((select bool_and(relrowsecurity) from pg_class where oid=any(array[
  'erp.stage8_commands'::regclass,'erp.document_templates'::regclass,'erp.document_template_versions'::regclass,
  'erp.documents'::regclass,'erp.fiscal_points'::regclass,'erp.fiscal_counters'::regclass,
  'erp.fiscal_requests'::regclass,'erp.fiscal_events'::regclass,'erp.communication_consents'::regclass,
  'erp.message_templates'::regclass,'erp.message_template_versions'::regclass,'erp.conversations'::regclass,
  'erp.conversation_assignments'::regclass,'erp.communication_messages'::regclass,
  'erp.communication_message_events'::regclass,'erp.communication_attachments'::regclass,
  'erp.provider_webhook_events'::regclass,'erp.integration_dead_letters'::regclass,
  'erp.communication_automation_rules'::regclass,'erp.communication_automation_executions'::regclass
])), 'Every Stage 8 table has RLS enabled');
select ok(exists(select 1 from pg_constraint where conrelid='erp.fiscal_events'::regclass and conname='fiscal_events_provider_unique'),'Fiscal provider events are globally idempotent per tenant and provider');
select ok(exists(select 1 from pg_constraint where conrelid='erp.integration_dead_letters'::regclass and conname='integration_dead_letters_outbox_fk'),'Dead letters retain branch-safe outbox ownership');
select ok(exists(select 1 from pg_indexes where schemaname='erp' and indexname='communication_message_events_provider_message_status_unique'),'Provider message states are deduplicated');

-- ACL boundaries.
select is(has_table_privilege('authenticated','erp.documents','SELECT'),false,'Authenticated actors do not receive full document rows');
select is(has_column_privilege('authenticated','erp.documents','customer_snapshot','SELECT'),true,'Document viewers can read customer-safe snapshots');
select is(has_column_privilege('authenticated','erp.documents','private_object_path','SELECT'),false,'Private document paths are hidden');
select is(has_table_privilege('authenticated','erp.communication_messages','SELECT'),false,'Authenticated actors do not receive full message rows');
select is(has_column_privilege('authenticated','erp.communication_messages','body_snapshot','SELECT'),true,'Message viewers can read message bodies');
select is(has_column_privilege('authenticated','erp.communication_messages','recipient_address','SELECT'),false,'Recipient addresses are hidden from general message reads');
select is(has_column_privilege('authenticated','erp.conversations','provider_conversation_id','SELECT'),false,'Provider conversation identifiers are hidden');
select is(has_column_privilege('authenticated','erp.provider_webhook_events','payload_sha256','SELECT'),false,'Webhook payload digests are hidden');
select is(has_column_privilege('authenticated','erp.communication_attachments','private_object_path','SELECT'),false,'Private attachment paths are hidden');
select is(has_function_privilege('authenticated','erp.issue_document(uuid,uuid,text,uuid,text,jsonb,text,text,text,text)','EXECUTE'),true,'Authenticated actors use checked document issuance');
select is(has_function_privilege('authenticated','erp.record_fiscal_provider_result(uuid,text,text,erp.fiscal_status,text,date,text,text,text)','EXECUTE'),false,'Authenticated actors cannot forge fiscal provider results');
select is(has_function_privilege('service_role','erp.record_fiscal_provider_result(uuid,text,text,erp.fiscal_status,text,date,text,text,text)','EXECUTE'),true,'Service role can ingest fiscal provider results');
select is(has_function_privilege('authenticated','erp.record_provider_webhook(uuid,text,text,text,text,boolean)','EXECUTE'),false,'Authenticated actors cannot forge webhook receipts');
select is(has_function_privilege('service_role','erp.record_provider_webhook(uuid,text,text,text,text,boolean)','EXECUTE'),true,'Service role can record webhook receipts');
select is(has_function_privilege('anon','erp.queue_customer_message(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE'),false,'Anonymous callers cannot queue messages');
select is(has_function_privilege('authenticated','erp.claim_stage8_command(text,uuid,uuid,text,jsonb)','EXECUTE'),false,'Stage 8 command core remains private');
select is(has_function_privilege('authenticated','erp.create_document_template_version(uuid,jsonb,text,text)','EXECUTE'),true,'Authenticated document managers can version templates');
select is(has_function_privilege('authenticated','erp.create_message_template_version(uuid,text,text,text,jsonb,text,text)','EXECUTE'),true,'Authenticated message managers can version templates');
select is(has_function_privilege('authenticated','erp.record_communication_automation_execution(uuid,text,uuid,uuid,text,text)','EXECUTE'),false,'Authenticated actors cannot forge automation outcomes');
select is(has_function_privilege('service_role','erp.record_communication_automation_execution(uuid,text,uuid,uuid,text,text)','EXECUTE'),true,'Service workers can record automation outcomes');

-- Deterministic seed.
select is((select count(*) from erp.document_templates where organization_id='10000000-0000-0000-0000-000000000001' and is_active),6::bigint,'Six document families are seeded');
select is((select count(*) from erp.document_template_versions where organization_id='10000000-0000-0000-0000-000000000001'),6::bigint,'Six document template versions are seeded');
select is((select count(*) from erp.message_templates where organization_id='10000000-0000-0000-0000-000000000001' and is_active),3::bigint,'Three communication templates are seeded');
select is((select count(*) from erp.message_template_versions where organization_id='10000000-0000-0000-0000-000000000001'),3::bigint,'Three message template versions are seeded');
select is((select count(*) from erp.fiscal_points where id='91400000-0000-0000-0000-000000000001' and environment='local_stub' and is_active),1::bigint,'Local fiscal point is seeded');
select is((select count(*) from erp.communication_automation_rules where id='91500000-0000-0000-0000-000000000001' and not is_active),1::bigint,'Default automation is explicitly disabled');
select is((select count(*) from erp.role_permissions rp join erp.permissions p on p.id=rp.permission_id where rp.role_id='40000000-0000-0000-0000-000000000002' and p.code in('documents.view','documents.issue','messages.view','messages.manage') and rp.is_active),4::bigint,'Sales role receives exact document and message scope');
select is((select count(*) from erp.role_permissions rp join erp.permissions p on p.id=rp.permission_id where rp.role_id='40000000-0000-0000-0000-000000000004' and p.code in('messages.view','messages.manage','integrations.view','integrations.retry') and rp.is_active),0::bigint,'Inventory role receives no message or integration scope');

-- Local behavior fixtures.
create temporary table stage8_ids(key text primary key,value uuid not null);
grant all on stage8_ids to authenticated,service_role;

insert into erp.customers(id,organization_id,code,display_name,email,whatsapp_phone)
values('b9100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','STAGE8-CUSTOMER','Stage 8 Customer','stage8@nictech.local','5493430000000');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','b9200000-0000-0000-0000-000000000001','authenticated','authenticated','stage8-owner@nictech.local','not-used',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{"display_name":"Stage 8 Owner"}'::jsonb,now(),now());
update erp.profiles set organization_id='10000000-0000-0000-0000-000000000001' where id='b9200000-0000-0000-0000-000000000001';
insert into erp.profile_roles(organization_id,profile_id,role_id,created_by)
values('10000000-0000-0000-0000-000000000001','b9200000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','b9200000-0000-0000-0000-000000000001');

insert into erp.exchange_rates(id,organization_id,base_currency,quote_currency,rate_to_base,source,quoted_at,idempotency_key,request_hash)
values('b9300000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ARS','ARS',1,'stage8-local',now(),'stage8-rate',repeat('a',64));
insert into erp.exchange_rate_snapshots(id,organization_id,exchange_rate_id,base_currency,quote_currency,rate_to_base,source,quoted_at,captured_at)
values('b9400000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','b9300000-0000-0000-0000-000000000001','ARS','ARS',1,'stage8-local',now(),now());
insert into erp.sales(id,organization_id,branch_id,customer_id,currency_code,exchange_snapshot_id,exchange_rate,idempotency_key,request_hash,reason,subtotal_amount,discount_amount,tax_amount,total_amount)
values('b9500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','ARS','b9400000-0000-0000-0000-000000000001',1,'stage8-sale',repeat('b',64),'Stage 8 document fixture',0,0,0,0);

select set_config('request.jwt.claim.sub','b9200000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select lives_ok(
  $$insert into stage8_ids values('document-template-v2',erp.create_document_template_version('91000000-0000-0000-0000-000000000001','{"sections":["business","customer","sale","payments","totals","delivery"]}'::jsonb,'stage8-document-template-v2','Version local sale receipt'))$$,
  'Document templates can create immutable versions'
);
select lives_ok(
  $$insert into stage8_ids values('message-template-v2',erp.create_message_template_version('91200000-0000-0000-0000-000000000002','nictech_order_ready_v2','es_AR','Tu pedido {{order_code}} esta listo.','["order_code"]'::jsonb,'stage8-message-template-v2','Version local order notification'))$$,
  'Message templates can create immutable versions'
);

select throws_ok(
  $$select erp.issue_document('20000000-0000-0000-0000-000000000001','91100000-0000-0000-0000-000000000001','sale','b9500000-0000-0000-0000-000000000001','V-0001','{"customer":{"name":"Safe","costs":{"base_cost":10}}}'::jsonb,repeat('1',64),null,'stage8-unsafe-document','Reject nested internal values')$$,
  '22023','customer document snapshot contains internal fields','Nested internal document fields are rejected'
);
select lives_ok(
  $$insert into stage8_ids values('document',erp.issue_document('20000000-0000-0000-0000-000000000001','91100000-0000-0000-0000-000000000001','sale','b9500000-0000-0000-0000-000000000001','V-0001','{"customer":{"name":"Stage 8 Customer"},"total":0}'::jsonb,repeat('2',64),null,'stage8-document','Issue customer-safe document'))$$,
  'A customer-safe document can be issued'
);
select is(
  erp.issue_document('20000000-0000-0000-0000-000000000001','91100000-0000-0000-0000-000000000001','sale','b9500000-0000-0000-0000-000000000001','V-0001','{"customer":{"name":"Stage 8 Customer"},"total":0}'::jsonb,repeat('2',64),null,'stage8-document','Issue customer-safe document'),
  (select value from stage8_ids where key='document'),'Document issuance retry returns the same fact'
);
select throws_ok(
  $$select erp.issue_document('20000000-0000-0000-0000-000000000001','91100000-0000-0000-0000-000000000001','sale','b9500000-0000-0000-0000-000000000001','V-0001','{"customer":{"name":"Changed"},"total":0}'::jsonb,repeat('2',64),null,'stage8-document','Issue customer-safe document')$$,
  '23000','idempotency key is already used by another request','Changed document retry is rejected'
);
reset role;
select is((select private_object_path from erp.documents where id=(select value from stage8_ids where key='document')),'documents/10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/sale/b9500000-0000-0000-0000-000000000001/'||repeat('2',64)||'.pdf','Document path is server-canonical');
set local role authenticated;

select lives_ok(
  $$insert into stage8_ids values('void-document',erp.issue_document('20000000-0000-0000-0000-000000000001',(select value from stage8_ids where key='document-template-v2'),'sale','b9500000-0000-0000-0000-000000000001','V-0002','{"customer":{"name":"Stage 8 Customer"},"total":0}'::jsonb,repeat('3',64),null,'stage8-void-document','Issue document for void test'))$$,
  'A second template version can issue a separate document fact'
);
select lives_ok(
  $$insert into stage8_ids values('void-event',erp.void_document((select value from stage8_ids where key='void-document'),'stage8-void-event','Void local duplicate document'))$$,
  'Issued documents can be voided through an append-only event'
);
select is(erp.void_document((select value from stage8_ids where key='void-document'),'stage8-void-event','Void local duplicate document'),(select value from stage8_ids where key='void-event'),'Document void retry returns the same event');
select is((select status from erp.document_events where document_id=(select value from stage8_ids where key='void-document') order by event_sequence desc limit 1),'voided'::erp.document_status,'Latest document event is authoritative');
select throws_ok(
  $$select erp.request_fiscal_issuance((select value from stage8_ids where key='void-document'),'91400000-0000-0000-0000-000000000001','FACTURA_C','stage8-void-fiscal','Reject voided fiscal document')$$,
  '55000','active fiscal point, issued document, permission and reason are required','Voided documents cannot enter fiscal issuance'
);

select lives_ok(
  $$insert into stage8_ids values('fiscal',erp.request_fiscal_issuance((select value from stage8_ids where key='document'),'91400000-0000-0000-0000-000000000001','FACTURA_C','stage8-fiscal','Request local fiscal issuance'))$$,
  'Fiscal request can be queued'
);
select is(erp.request_fiscal_issuance((select value from stage8_ids where key='document'),'91400000-0000-0000-0000-000000000001','FACTURA_C','stage8-fiscal','Request local fiscal issuance'),(select value from stage8_ids where key='fiscal'),'Fiscal retry returns the same request');
select is((select voucher_number from erp.fiscal_requests where id=(select value from stage8_ids where key='fiscal')),1::bigint,'Fiscal numbering starts deterministically');
select is((select count(*) from erp.integration_outbox where aggregate_id=(select value from stage8_ids where key='fiscal')),1::bigint,'Fiscal retry does not duplicate outbox work');

select throws_ok(
  $$select erp.queue_customer_message('20000000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001',null,'91300000-0000-0000-0000-000000000002','5493430000000','{"order_code":"W-1"}'::jsonb,'stage8-message-before-consent','No consent')$$,
  '55000','active template, customer, consent, recipient, exact variables and permission are required','Messages require current consent'
);
select lives_ok(
  $$select erp.record_communication_consent('20000000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','whatsapp',true,'customer_form','stage8-consent','Customer granted WhatsApp consent')$$,
  'Consent can be recorded'
);
select throws_ok(
  $$select erp.queue_customer_message('20000000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001',null,'91300000-0000-0000-0000-000000000002','5493430000000','{"wrong":"W-1"}'::jsonb,'stage8-message-wrong-vars','Wrong variables')$$,
  '55000','active template, customer, consent, recipient, exact variables and permission are required','Template variables must match exactly'
);
select lives_ok(
  $$insert into stage8_ids values('message',erp.queue_customer_message('20000000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001',null,'91300000-0000-0000-0000-000000000002','5493430000000','{"order_code":"W-1"}'::jsonb,'stage8-message','Queue customer message'))$$,
  'Consented message can be queued'
);
select is(erp.queue_customer_message('20000000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001',null,'91300000-0000-0000-0000-000000000002','5493430000000','{"order_code":"W-1"}'::jsonb,'stage8-message','Queue customer message'),(select value from stage8_ids where key='message'),'Message retry returns the same fact');
select is((select count(*) from erp.conversations where customer_id='b9100000-0000-0000-0000-000000000001'),1::bigint,'Message retry does not create an orphan conversation');
select is((select count(*) from erp.integration_outbox where aggregate_id=(select value from stage8_ids where key='message')),1::bigint,'Message retry does not duplicate outbox work');
select lives_ok(
  $$select erp.assign_conversation((select conversation_id from erp.communication_messages where id=(select value from stage8_ids where key='message')),'b9200000-0000-0000-0000-000000000001','stage8-assignment','Assign owner')$$,
  'Conversation assignment is append-only and checked'
);
select lives_ok(
  $$select erp.configure_communication_automation('20000000-0000-0000-0000-000000000001','ORDER_READY_NOTIFY','order.ready','91300000-0000-0000-0000-000000000002','{"requires_consent":true}'::jsonb,true,'stage8-automation','Enable local automation rule')$$,
  'Automation configuration is permission checked'
);

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

select lives_ok(
  $$insert into stage8_ids values('webhook-invalid',erp.record_provider_webhook('20000000-0000-0000-0000-000000000001','whatsapp','stage8-hook-invalid','message.received',repeat('3',64),false))$$,
  'Invalid webhook signatures are retained as evidence'
);
select throws_ok(
  $$select erp.record_provider_webhook('20000000-0000-0000-0000-000000000001','whatsapp','stage8-hook-invalid','message.received',repeat('4',64),false)$$,
  '23000','provider webhook event is already used by another payload','Webhook retries are payload-bound'
);
select throws_ok(
  $$select erp.record_inbound_message((select value from stage8_ids where key='webhook-invalid'),'whatsapp','conv-invalid','msg-invalid','b9100000-0000-0000-0000-000000000001','5493430000000','Invalid signature message',repeat('4',64),now())$$,
  '22023','verified webhook and bounded inbound message data are required','Invalid signature cannot create an inbound message'
);
select lives_ok(
  $$insert into stage8_ids values('webhook-valid',erp.record_provider_webhook('20000000-0000-0000-0000-000000000001','whatsapp','stage8-hook-valid','message.received',repeat('5',64),true))$$,
  'Verified webhook metadata can be retained'
);
select lives_ok(
  $$insert into stage8_ids values('inbound',erp.record_inbound_message((select value from stage8_ids where key='webhook-valid'),'whatsapp','conv-stage8','msg-stage8','b9100000-0000-0000-0000-000000000001','5493430000000','Hola NicTech',repeat('6',64),'2026-08-20 10:00:00+00'))$$,
  'Verified inbound message is accepted'
);
select is(erp.record_inbound_message((select value from stage8_ids where key='webhook-valid'),'whatsapp','conv-stage8','msg-stage8','b9100000-0000-0000-0000-000000000001','5493430000000','Hola NicTech',repeat('6',64),'2026-08-20 10:00:00+00'),(select value from stage8_ids where key='inbound'),'Inbound provider retry returns the same message');
select throws_ok(
  $$select erp.record_inbound_message((select value from stage8_ids where key='webhook-valid'),'whatsapp','conv-stage8','msg-stage8','b9100000-0000-0000-0000-000000000001','5493430000000','Changed body',repeat('6',64),'2026-08-20 10:00:00+00')$$,
  '23000','provider message is already used by another inbound payload','Inbound retries are payload-bound'
);
select lives_ok(
  $$select erp.register_communication_attachment((select value from stage8_ids where key='inbound'),'image/jpeg',1024,repeat('7',64))$$,
  'Service adapter can register bounded attachment metadata'
);
select throws_ok(
  $$select erp.register_communication_attachment((select value from stage8_ids where key='inbound'),'image/jpeg',2048,repeat('7',64))$$,
  '23000','attachment digest is already used by different metadata','Attachment retries are metadata-bound'
);
reset role;
select is((select count(*) from erp.communication_attachments where message_id=(select value from stage8_ids where key='inbound') and private_object_path='communications/10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/'||(select value from stage8_ids where key='inbound')||'/'||repeat('7',64)),1::bigint,'Attachment path is server-canonical');
set local role service_role;

select lives_ok($$select erp.record_provider_message_event((select value from stage8_ids where key='message'),'whatsapp','stage8-sent','sent','provider-msg-stage8',repeat('8',64),null)$$,'Provider sent state can be recorded');
select lives_ok($$select erp.record_provider_message_event((select value from stage8_ids where key='message'),'whatsapp','stage8-delivered','delivered','provider-msg-stage8',repeat('9',64),null)$$,'Provider delivered state can be recorded');
select lives_ok($$select erp.record_provider_message_event((select value from stage8_ids where key='message'),'whatsapp','stage8-read','read','provider-msg-stage8',repeat('a',64),null)$$,'Provider read state can be recorded');
select throws_ok($$select erp.record_provider_message_event((select value from stage8_ids where key='message'),'whatsapp','stage8-regression','sent','provider-msg-stage8',repeat('b',64),null)$$,'55000','message delivery status cannot move backwards','Delivery state cannot regress');
select lives_ok($$select erp.record_provider_message_event((select value from stage8_ids where key='message'),'whatsapp','stage8-failed','failed',null,repeat('c',64),'Provider timeout')$$,'A later provider failure remains visible');
select throws_ok($$select erp.record_provider_message_event((select value from stage8_ids where key='message'),'whatsapp','stage8-failed','failed',null,repeat('c',64),'Changed failure')$$,'23000','provider event is already used by another message result','Message provider retries include error identity');
select throws_ok($$select erp.record_provider_message_event((select value from stage8_ids where key='message'),'whatsapp','stage8-after-failure-regression','sent','provider-msg-stage8',repeat('d',64),null)$$,'55000','message delivery status cannot move backwards','Failure events do not erase the highest delivery state');

select lives_ok(
  $$insert into stage8_ids values('automation-execution',erp.record_communication_automation_execution((select id from erp.communication_automation_rules where code='ORDER_READY_NOTIFY'),'order.ready','b9500000-0000-0000-0000-000000000001',(select value from stage8_ids where key='message'),'queued','Queued consented notification'))$$,
  'Service worker can record an automation execution'
);
select is(erp.record_communication_automation_execution((select id from erp.communication_automation_rules where code='ORDER_READY_NOTIFY'),'order.ready','b9500000-0000-0000-0000-000000000001',(select value from stage8_ids where key='message'),'queued','Queued consented notification'),(select value from stage8_ids where key='automation-execution'),'Automation execution retry returns the same fact');
select throws_ok(
  $$select erp.record_communication_automation_execution((select id from erp.communication_automation_rules where code='ORDER_READY_NOTIFY'),'order.ready','b9500000-0000-0000-0000-000000000001',null,'skipped','Changed automation outcome')$$,
  '23000','automation source already has a different execution result','Automation execution retries are request-bound'
);

select lives_ok(
  $$insert into stage8_ids values('fiscal-failed',erp.record_fiscal_provider_result((select value from stage8_ids where key='fiscal'),'arca','stage8-arca-failed','failed',null,null,repeat('e',64),'TIMEOUT','Local stub timeout'))$$,
  'Retryable fiscal failure is retained'
);
select throws_ok(
  $$select erp.record_fiscal_provider_result((select value from stage8_ids where key='fiscal'),'arca','stage8-arca-failed','failed',null,null,repeat('e',64),'TIMEOUT','Changed timeout')$$,
  '23000','provider event is already used by another fiscal result','Fiscal provider retries include error identity'
);
select lives_ok(
  $$insert into stage8_ids values('fiscal-authorized',erp.record_fiscal_provider_result((select value from stage8_ids where key='fiscal'),'arca','stage8-arca-authorized','authorized','12345678901234','2026-09-01',repeat('f',64),null,null))$$,
  'Fiscal request can later be authorized'
);
select is(erp.record_fiscal_provider_result((select value from stage8_ids where key='fiscal'),'arca','stage8-arca-authorized','authorized','12345678901234','2026-09-01',repeat('f',64),null,null),(select value from stage8_ids where key='fiscal-authorized'),'Fiscal provider retry returns the same event');
select throws_ok(
  $$select erp.record_fiscal_provider_result((select value from stage8_ids where key='fiscal'),'arca','stage8-arca-late-reject','rejected',null,null,repeat('0',64),'LATE','Late rejection')$$,
  '55000','fiscal request already has a terminal result','Authorized fiscal request cannot receive another terminal result'
);

reset role;
select is((select count(*) from erp.audit_events where table_name in('documents','communication_messages','fiscal_events','provider_webhook_events') and metadata @> '{"redacted":true}'::jsonb and old_values is null and new_values is null)>=4,true,'Stage 8 fact audits are redacted');
select throws_ok($$update erp.fiscal_requests set request_sha256=repeat('0',64) where id=(select value from stage8_ids where key='fiscal')$$,'23000','stage 8 facts are append-only','Fiscal requests remain immutable to privileged writes');

insert into erp.integration_attempts(organization_id,outbox_id,attempt_number,status,error_message)
select organization_id,id,1,'failed','Stage 8 local failure' from erp.integration_outbox where aggregate_id=(select value from stage8_ids where key='message');

select set_config('request.jwt.claim.sub','b9200000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(
  $$insert into stage8_ids values('dead-letter',erp.move_integration_to_dead_letter((select id from erp.integration_outbox where aggregate_id=(select value from stage8_ids where key='message')),'Exhausted local retries'))$$,
  'Failed outbox work can be moved to dead letter'
);
select is(erp.move_integration_to_dead_letter((select id from erp.integration_outbox where aggregate_id=(select value from stage8_ids where key='message')),'Exhausted local retries'),(select value from stage8_ids where key='dead-letter'),'Dead-letter retry returns the same immutable fact');
select throws_ok(
  $$select erp.move_integration_to_dead_letter((select id from erp.integration_outbox where aggregate_id=(select value from stage8_ids where key='message')),'Different reason')$$,
  '23000','outbox item already has a different dead-letter reason','Dead-letter retries are request-bound'
);

select * from finish();
rollback;
