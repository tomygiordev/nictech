begin;

create extension if not exists pgtap with schema extensions;

select plan(250);

select has_table('erp','customer_equipment','Customer equipment exists');
select has_table('erp','equipment_ownership_events','Equipment ownership history exists');
select has_table('erp','repair_orders','Repair orders exist');
select has_table('erp','repair_state_events','Repair state events exist');
select has_table('erp','repair_assignment_events','Repair assignment events exist');
select has_table('erp','repair_credentials','Protected repair credentials exist');
select has_table('erp','repair_credential_keys','Protected credential key versions exist');
select has_table('erp','repair_tracking_tokens','Rotatable tracking tokens exist');
select has_table('erp','repair_test_template_versions','Versioned test templates exist');
select has_table('erp','repair_test_runs','Test runs exist');
select has_table('erp','repair_test_results','Test results exist');
select has_table('erp','repair_quotes','Versioned repair quotes exist');
select has_table('erp','repair_quote_lines','Frozen quote lines exist');
select has_table('erp','repair_quote_response_tokens','Quote response tokens exist');
select has_table('erp','repair_part_events','Repair part links exist');
select has_table('erp','repair_labor_facts','Repair labor facts exist');
select has_table('erp','repair_media_upload_tokens','Temporary media tokens exist');
select has_table('erp','repair_private_media','Private media metadata exists');
select has_table('erp','repair_deliveries','Immutable repair deliveries exist');
select has_table('erp','repair_warranties','Repair warranties exist');
select has_table('erp','repair_warranty_claims','Independent warranty claims exist');
select has_column('erp','customer_equipment','normalized_serial_number','Equipment serial normalization is stored');
select has_column('erp','customer_equipment','normalized_imei','Equipment IMEI normalization is stored');
select has_column('erp','repair_quote_lines','inventory_unit_id','Serialized quote parts retain their immutable inventory unit identity');
select has_column('erp','repair_media_upload_tokens','token_family_id','Media token reissues retain immutable quota-family identity');
select has_column('erp','repair_orders','tracking_token_digest','Tracking stores only a token digest');
select has_column('erp','repair_state_events','event_sequence','Repair state order is monotonic');
select has_column('erp','repair_quote_lines','unit_cost_snapshot','Quote lines freeze costs');
select has_column('erp','payments','repair_order_id','Payments support repair ownership');
select has_function('erp','create_repair_order',array['uuid','uuid','uuid','jsonb','text','text','text','text','text','text'],'Checked repair order command exists');
select has_function('erp','get_repair_credentials',array['uuid'],'Audited credential read command exists');
select has_function('erp','create_repair_quote_version',array['uuid','text','uuid','jsonb','text','text'],'Quote version command exists');
select has_function('erp','reserve_repair_parts',array['uuid','timestamp with time zone','jsonb','text','text'],'Repair reservation wrapper exists');
select has_function('erp','consume_repair_parts',array['uuid','uuid','text','text'],'Repair consumption wrapper exists');
select has_function('erp','record_repair_payment',array['uuid','uuid','uuid','numeric','text','uuid','text','text','text'],'Repair payment command exists');
select has_function('public','get_repair_tracking',array['text'],'Safe public tracking wrapper exists');
select has_function('public','respond_repair_quote',array['text','text','text'],'Public quote response wrapper exists');
select has_function('public','register_repair_private_media',array['text','integer','text','text','bigint','text'],'Public metadata registration wrapper exists');
select has_function('erp','provision_repair_credential_key',array['uuid','bytea','text'],'Service-only credential key provisioning exists');
select has_function('erp','get_customer_equipment_identifiers',array['uuid'],'Audited equipment identifier RPC exists');
select ok(pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure) like '%pg_advisory_xact_lock%hashtextextended%org_id%branch%','Quote cost reads use the canonical organization-branch stock advisory lock');
select ok(pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure) like '%jsonb_array_elements(normalized_lines)%','Quote inserts consume the once-frozen normalized line set');
select has_function('erp','get_repair_quote_costs',array['uuid'],'Checked quote cost RPC exists');

select ok((select relrowsecurity from pg_class where oid='erp.customer_equipment'::regclass),'Equipment enforces RLS');
select ok((select relrowsecurity from pg_class where oid='erp.repair_credentials'::regclass),'Credentials enforce RLS');
select ok((select relrowsecurity from pg_class where oid='erp.repair_credential_keys'::regclass),'Credential keys enforce RLS');
select ok((select relrowsecurity from pg_class where oid='erp.repair_quotes'::regclass),'Quotes enforce RLS');
select ok((select relrowsecurity from pg_class where oid='erp.repair_private_media'::regclass),'Private media enforces RLS');
select ok((select relrowsecurity from pg_class where oid='erp.repair_warranties'::regclass),'Warranties enforce RLS');
select is(has_table_privilege('authenticated','erp.repair_orders','INSERT'),false,'Authenticated clients cannot insert repairs directly');
select is(has_table_privilege('service_role','erp.repair_orders','INSERT'),false,'Service role cannot insert repairs directly');
select is(has_table_privilege('authenticated','erp.repair_credentials','SELECT'),false,'Credentials have no authenticated table reads');
select is(has_table_privilege('service_role','erp.repair_credentials','SELECT'),false,'Credentials have no service table reads');
select is(has_table_privilege('service_role','erp.repair_credential_keys','SELECT'),false,'Service role cannot read key material directly');
select is(has_table_privilege('authenticated','erp.repair_credential_keys','SELECT'),false,'Authenticated actors cannot read key material directly');
select is(has_table_privilege('service_role','erp.repair_credential_keys','INSERT'),false,'Service role cannot bypass key provisioning with direct writes');
select is(has_table_privilege('authenticated','erp.repair_private_media','SELECT'),false,'Private paths are not exposed to authenticated clients');
select is(has_table_privilege('service_role','erp.repair_private_media','SELECT'),true,'Service role has metadata read access only');
select is(has_function_privilege('anon','public.get_repair_tracking(text)','EXECUTE'),true,'Anon can invoke minimal tracking');
select is(has_function_privilege('anon','public.respond_repair_quote(text,text,text)','EXECUTE'),true,'Anon can invoke token quote response');
select is(has_function_privilege('anon','erp.get_repair_credentials(uuid)','EXECUTE'),false,'Anon cannot read credentials');
select is(has_function_privilege('service_role','erp.record_repair_payment(uuid,uuid,uuid,numeric,text,uuid,text,text,text)','EXECUTE'),false,'Service role cannot invoke repair payment command');
select is(has_function_privilege('authenticated','erp.claim_repair_command(text,uuid,uuid,text,jsonb)','EXECUTE'),false,'Command ledger core is private');
select is(has_function_privilege('authenticated','erp.provision_repair_credential_key(uuid,bytea,text)','EXECUTE'),false,'Authenticated actors cannot provision credential keys');
select is(has_function_privilege('service_role','erp.provision_repair_credential_key(uuid,bytea,text)','EXECUTE'),true,'Service role can provision credential keys only through checked command');
select is(has_column_privilege('authenticated','erp.customer_equipment','serial_number','SELECT'),false,'General repair viewers cannot select equipment serials');
select is(has_column_privilege('authenticated','erp.customer_equipment','normalized_imei','SELECT'),false,'General repair viewers cannot select normalized IMEI');
select is(has_column_privilege('authenticated','erp.repair_quote_lines','unit_cost_snapshot','SELECT'),false,'General quote viewers cannot select cost snapshots');
select is(has_column_privilege('authenticated','erp.payments','repair_order_id','SELECT'),true,'Repair payment ownership is safely visible');
select is(has_column_privilege('authenticated','erp.payments','provider_reference','SELECT'),false,'Provider references remain hidden');
select ok(exists(select 1 from pg_constraint where conrelid='erp.payments'::regclass and conname='payments_exactly_one_owner'),'Payments enforce exactly one owner');
select ok(exists(select 1 from pg_constraint where conrelid='erp.repair_orders'::regclass and conname='repair_orders_number_unique'),'Repair numbers are branch-scoped unique');
select ok(exists(select 1 from pg_indexes where schemaname='erp' and indexname='customer_equipment_imei_unique'),'Equipment IMEI is tenant unique');
select ok((select pg_get_constraintdef(oid) like '%supersedes_quote_id, organization_id, branch_id, repair_order_id%' from pg_constraint where conrelid='erp.repair_quotes'::regclass and conname='repair_quotes_supersedes_fk'),'Quote supersession is constrained to the same repair order tuple');
select ok((select pg_get_constraintdef(oid) like '%delivery_id, organization_id, branch_id, repair_order_id%' from pg_constraint where conrelid='erp.repair_warranties'::regclass and conname='repair_warranty_delivery_fk'),'Warranty delivery is constrained to the same repair order tuple');
select ok(exists(select 1 from pg_policies where schemaname='erp' and tablename='repair_label_events' and policyname='repair_labels_select'),'Repair label reads have a dedicated permission policy');
select ok(exists(select 1 from erp.permissions where code='repairs.view_identifiers' and is_sensitive),'Equipment identifier permission is sensitive');
select is((select count(*) from erp.role_permissions rp join erp.permissions p on p.id=rp.permission_id where rp.role_id='40000000-0000-0000-0000-000000000003' and p.code='repairs.view_identifiers' and rp.is_active),0::bigint,'Technician role does not receive identifier access by default');

create temporary table stage7_ids(kind text primary key,id uuid,secret text);
grant all on stage7_ids to authenticated;
grant all on stage7_ids to anon;

insert into erp.customers(id,organization_id,code,display_name)
values('b1000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','STAGE7-CUSTOMER','Stage 7 Customer'),
      ('b1000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','STAGE7-CUSTOMER-2','Stage 7 Customer 2');
insert into erp.organizations(id,legal_name,display_name)
values('b9000000-0000-0000-0000-000000000001','Foreign Stage 7','Foreign Stage 7');
insert into erp.branches(id,organization_id,code,name)
values('b9000000-0000-0000-0000-000000000002','b9000000-0000-0000-0000-000000000001','FOREIGN','Foreign branch'),
      ('b8000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','STAGE7-B2','Stage 7 second branch');
insert into erp.locations(id,organization_id,branch_id,code,name,kind)
values('b8000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000001','STAGE7-B2-WH','Stage 7 other warehouse','warehouse');
insert into erp.customers(id,organization_id,code,display_name)
values('b9000000-0000-0000-0000-000000000004','b9000000-0000-0000-0000-000000000001','FOREIGN-CUSTOMER','Foreign Customer');
insert into erp.products(id,organization_id,product_type_id,item_kind,unit_id,internal_code,internal_name,inventory_tracking,can_use_as_repair_part)
values
('b2000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','STAGE7-PART','Stage 7 Part','quantity',true),
('b2000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002','product','50000000-0000-0000-0000-000000000001','STAGE7-SERIAL-PART','Stage 7 Serial Part','serial',true);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000000','b3000000-0000-0000-0000-000000000001','authenticated','authenticated','stage7@nictech.local','not-used',now(),'{}','{"display_name":"Stage 7"}',now(),now()),
('00000000-0000-0000-0000-000000000000','b3000000-0000-0000-0000-000000000002','authenticated','authenticated','stage7-quotes@nictech.local','not-used',now(),'{}','{"display_name":"Stage 7 Quotes"}',now(),now()),
('00000000-0000-0000-0000-000000000000','b3000000-0000-0000-0000-000000000003','authenticated','authenticated','stage7-foreign@nictech.local','not-used',now(),'{}','{"display_name":"Stage 7 Foreign"}',now(),now());
update erp.profiles set organization_id='10000000-0000-0000-0000-000000000001' where id in('b3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000002');
update erp.profiles set organization_id='b9000000-0000-0000-0000-000000000001' where id='b3000000-0000-0000-0000-000000000003';
insert into erp.roles(id,organization_id,code,name,is_system)
values('b9000000-0000-0000-0000-000000000005','b9000000-0000-0000-0000-000000000001','owner','Foreign owner',true);
insert into erp.role_permissions(organization_id,role_id,permission_id)
select 'b9000000-0000-0000-0000-000000000001','b9000000-0000-0000-0000-000000000005',id from erp.permissions where is_active;
insert into erp.profile_roles(organization_id,profile_id,role_id,created_by)
values
('10000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001'),
('10000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','b3000000-0000-0000-0000-000000000001'),
('b9000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000003','b9000000-0000-0000-0000-000000000005','b3000000-0000-0000-0000-000000000003');

insert into erp.repair_number_counters(organization_id,branch_id,next_number)
values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)
on conflict(organization_id,branch_id) do update set next_number=1;

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role postgres;
select lives_ok($$select erp.provision_repair_credential_key('10000000-0000-0000-0000-000000000001',decode(repeat('ab',32),'hex'),'Stage 7 initial key')$$,'Service role provisions the first credential key');
select lives_ok($$select erp.provision_repair_credential_key('b9000000-0000-0000-0000-000000000001',decode(repeat('ef',32),'hex'),'Stage 7 foreign key')$$,'Foreign tenant receives an independent protected key');
reset role;

select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select lives_ok($$select erp.capture_exchange_rate('ARS',1,'stage7-local','2026-08-19 12:00:00+00','stage7-fx','Stage 7 FX')$$,'Base FX snapshot is available');
select lives_ok($$select erp.post_stock_document('opening','20000000-0000-0000-0000-000000000001','stage7-stock','Stage 7 stock','[{"product_id":"b2000000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":10,"unit_cost":25}]')$$,'Repair stock is opened with cost');
select lives_ok($$insert into stage7_ids(kind,id) values('serial-unit',erp.register_inventory_unit('b2000000-0000-0000-0000-000000000002',null,'STAGE7-SERIAL-1',null,40))$$,'Serialized repair part unit is registered');
select lives_ok($$select erp.post_stock_document('opening','20000000-0000-0000-0000-000000000001','stage7-serial-stock','Stage 7 serial stock',jsonb_build_array(jsonb_build_object('product_id','b2000000-0000-0000-0000-000000000002','inventory_unit_id',(select id from stage7_ids where kind='serial-unit'),'to_location_id','30000000-0000-0000-0000-000000000002','quantity',1,'unit_cost',40)))$$,'Serialized repair stock is opened with cost');
select lives_ok($$insert into stage7_ids(kind,id) values('serial-unit-other-branch',erp.register_inventory_unit('b2000000-0000-0000-0000-000000000002',null,'STAGE7-SERIAL-B2',null,55))$$,'A second serialized unit is registered for branch validation');
select lives_ok($$select erp.post_stock_document('opening','b8000000-0000-0000-0000-000000000001','stage7-serial-stock-b2','Stage 7 other-branch serial stock',jsonb_build_array(jsonb_build_object('product_id','b2000000-0000-0000-0000-000000000002','inventory_unit_id',(select id from stage7_ids where kind='serial-unit-other-branch'),'to_location_id','b8000000-0000-0000-0000-000000000002','quantity',1,'unit_cost',55)))$$,'Other-branch serialized stock is opened independently');
select is((select count(*) from erp.branches where organization_id='b9000000-0000-0000-0000-000000000001'),0::bigint,'Local owner RLS cannot see foreign branches');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000003',true);
select is((select count(*) from erp.customer_equipment where organization_id='10000000-0000-0000-0000-000000000001'),0::bigint,'Foreign tenant RLS cannot see local equipment');
select throws_ok($$select erp.create_customer_equipment('20000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',null,null,'Phone','Cross','Cross','CROSS-LOCAL',null,'stage7-foreign-to-local','Cross tenant')$$,'42501','repairs.manage permission is required','Foreign tenant cannot target a local branch RPC');
select lives_ok($$insert into stage7_ids(kind,id) values('foreign-equipment',erp.create_customer_equipment('b9000000-0000-0000-0000-000000000002','b9000000-0000-0000-0000-000000000004',null,null,'Phone','Foreign','Foreign','FOREIGN-1',null,'stage7-foreign-own-equipment','Foreign equipment'))$$,'Foreign tenant can create its own isolated equipment');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
select is((select count(*) from erp.customer_equipment where id=(select id from stage7_ids where kind='foreign-equipment')),0::bigint,'Local owner RLS cannot see foreign equipment');
select lives_ok($$insert into stage7_ids(kind,id) select 'equipment',erp.create_customer_equipment('20000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',null,null,'Phone','Free Brand','Free Model',' SN- 001 ',null,'stage7-equipment','Initial owner')$$,'Equipment and initial ownership are created atomically');
select throws_ok($$select erp.create_customer_equipment('b9000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001',null,null,'Phone','Foreign','Foreign','FOREIGN-1',null,'stage7-foreign-equipment','Cross tenant')$$,'42501','repairs.manage permission is required','Foreign-tenant branch is rejected before data creation');
select is((select normalized_serial_number from erp.get_customer_equipment_identifiers((select id from stage7_ids where kind='equipment'))),'SN001','Authorized identifier RPC returns normalized serial');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000002',true);
select throws_ok($$select * from erp.get_customer_equipment_identifiers((select id from stage7_ids where kind='equipment'))$$,'42501','repairs.view and repairs.view_identifiers are required','Least-privilege repair viewer cannot read identifiers');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000003',true);
select throws_ok($$select * from erp.get_customer_equipment_identifiers((select id from stage7_ids where kind='equipment'))$$,'P0002','customer equipment not found','Foreign tenant receives no local identifier record through the RPC');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
select throws_ok($$select erp.create_customer_equipment('20000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',null,null,'Phone','Other','Other','SN001',null,'stage7-equipment-duplicate','Duplicate serial')$$,'23505',null,'Normalized serial is tenant unique');
select lives_ok($$select erp.transfer_customer_equipment('20000000-0000-0000-0000-000000000001',(select id from stage7_ids where kind='equipment'),'b1000000-0000-0000-0000-000000000002','stage7-transfer','Ownership transfer')$$,'Equipment ownership is append-only transferable');
select is((select count(*) from erp.equipment_ownership_events where equipment_id=(select id from stage7_ids where kind='equipment')),2::bigint,'Ownership history retains both owners');
select lives_ok($$select erp.transfer_customer_equipment('20000000-0000-0000-0000-000000000001',(select id from stage7_ids where kind='equipment'),'b1000000-0000-0000-0000-000000000001','stage7-transfer-back','Return ownership')$$,'Equipment can return through another ownership event');

select lives_ok($$insert into stage7_ids(kind,id,secret) select 'order',repair_order_id,tracking_token from erp.create_repair_order('20000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',(select id from stage7_ids where kind='equipment'),'["charger"]','Scratched','Corner dent','Internal intake note','Does not charge','stage7-order','Receive equipment')$$,'Numbered repair order is created');
select is((select order_number from erp.repair_orders where id=(select id from stage7_ids where kind='order')),1::bigint,'First branch counter value is deterministic');
select is((select count(*) from erp.repair_state_events where repair_order_id=(select id from stage7_ids where kind='order')),1::bigint,'Initial state event is appended');
reset role;
select is((select request_hash from erp.repair_commands where command_name='repair.order.create' and idempotency_key='stage7-order'),encode(extensions.digest(convert_to(jsonb_build_object('customer_id','b1000000-0000-0000-0000-000000000001'::uuid,'equipment_id',(select id from stage7_ids where kind='equipment'),'accessories','["charger"]'::jsonb,'condition','Scratched','damage','Corner dent','notes','Internal intake note','fault','Does not charge','reason','Receive equipment')::text,'UTF8'),'sha256'),'hex'),'Command request identity uses SHA-256');
set local role authenticated;
select throws_ok($$select erp.create_repair_order('20000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',(select id from stage7_ids where kind='equipment'),'["charger"]','Scratched','Corner dent','Internal intake note','Does not charge','stage7-order','Receive equipment')$$,'55000','tracking token was already returned; rotate it to recover access','Secret-return retry directs caller to recovery command');
select throws_ok($$select erp.create_repair_order('20000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',(select id from stage7_ids where kind='equipment'),'[]','Changed',null,null,'Changed','stage7-order','Changed')$$,'23000','idempotency key is already used by another request','Mismatched retry is rejected');

select throws_ok($$select erp.provision_repair_credential_key('10000000-0000-0000-0000-000000000001',decode(repeat('cd',32),'hex'),'Forged key')$$,'42501',null,'Authenticated actor cannot provision or influence credential key');
select set_config('erp.credentials_key','attacker-controlled-setting-is-ignored',true);
select lives_ok($$select erp.rotate_repair_credentials((select id from stage7_ids where kind='order'),'{"pin":"1234"}','Initial protected credentials')$$,'Credentials use protected active key rather than client GUC');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role postgres;
select lives_ok($$select erp.provision_repair_credential_key('10000000-0000-0000-0000-000000000001',decode(repeat('cd',32),'hex'),'Stage 7 key rotation')$$,'Service role rotates credential key without exposing material');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(erp.create_customer_equipment('20000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',null,null,'Phone','Free Brand','Free Model',' SN- 001 ',null,'stage7-equipment','Initial owner'),(select id from stage7_ids where kind='equipment'),'Equipment idempotency survives protected-key rotation');
select lives_ok($$select erp.rotate_repair_credentials((select id from stage7_ids where kind='order'),'{"pin":"5678"}','Rotate lost credentials')$$,'Credential rotation creates an audited new version');
reset role;
select isnt(encode((select ciphertext from erp.repair_credentials where repair_order_id=(select id from stage7_ids where kind='order') order by credential_version desc limit 1),'escape'),'5678','Ciphertext does not contain plaintext');
set local role authenticated;
select is(erp.get_repair_credentials((select id from stage7_ids where kind='order'))->>'pin','5678','Credential RPC decrypts latest rotated version');
reset role;
select is((select count(*) from erp.repair_commands where command_name like 'repair.credentials.%'),0::bigint,'Credential plaintext or verifier never enters command ledger');
select isnt((select request_hash from erp.repair_commands where command_name='repair.equipment.create' and idempotency_key='stage7-equipment'),encode(extensions.digest(convert_to(jsonb_build_object('customer_id','b1000000-0000-0000-0000-000000000001'::uuid,'brand_id',null,'model_id',null,'type','Phone','brand','Free Brand','model','Free Model','serial',' SN- 001 ','imei',null,'reason','Initial owner')::text,'UTF8'),'sha256'),'hex'),'Equipment command identity is not an unkeyed hash of raw identifiers');
set local role authenticated;
select ok(exists(select 1 from erp.audit_events where table_name='repair_credentials' and action='read_sensitive' and metadata->>'repair_order_id'=(select id::text from stage7_ids where kind='order')),'Sensitive credential read is audited');
select ok(exists(select 1 from erp.audit_events where table_name='customer_equipment' and action='read_sensitive' and record_id=(select id::text from stage7_ids where kind='equipment')),'Sensitive equipment identifier read is audited');
select ok(not exists(select 1 from erp.audit_events where table_name in('repair_credentials','repair_credential_keys') and (coalesce(old_values,'{}')::text||coalesce(new_values,'{}')::text||metadata::text) ~ '1234|5678|abababab'),'Credential and key material are never audited');
select ok(not exists(select 1 from erp.audit_events where (coalesce(old_values,'{}')::text||coalesce(new_values,'{}')::text||metadata::text) ~ 'SN- 001|SN001'),'Equipment identifier material is absent from audit payloads');

select throws_ok($$select erp.transition_repair_order((select id from stage7_ids where kind='order'),'85000000-0000-0000-0000-000000000004',null,'stage7-skip','Skip workflow')$$,'42501','authorized repair transition is required','Workflow rejects unconfigured edge');
select lives_ok($$select erp.transition_repair_order((select id from stage7_ids where kind='order'),'85000000-0000-0000-0000-000000000002',null,'stage7-diagnosis','Start diagnosis')$$,'Configured transition is appended');
select lives_ok($$select erp.assign_repair_order((select id from stage7_ids where kind='order'),'b3000000-0000-0000-0000-000000000001','stage7-assign','Assign technician')$$,'Technician assignment is appended');
select throws_ok($$select erp.record_repair_test_run((select id from stage7_ids where kind='order'),'85300000-0000-0000-0000-000000000002','[{"item_key":"powers_on","result":"pass"}]',null,'stage7-final-partial')$$,'22023','result keys must exactly match required template keys','Partial final result set is rejected');
select lives_ok($$select erp.record_repair_test_run((select id from stage7_ids where kind='order'),'85300000-0000-0000-0000-000000000002','[{"item_key":"powers_on","result":"pass"},{"item_key":"reported_fault","result":"pass"},{"item_key":"safety","result":"pass"}]',null,'stage7-final-stale')$$,'Complete final run can be recorded during diagnosis');
select lives_ok($$select erp.transition_repair_order((select id from stage7_ids where kind='order'),'85000000-0000-0000-0000-000000000003',null,'stage7-repair','Start repair')$$,'Repair transition is appended');
select throws_ok($$select erp.transition_repair_order((select id from stage7_ids where kind='order'),'85000000-0000-0000-0000-000000000004',null,'stage7-ready-stale','Ready with stale test')$$,'55000','latest final test must follow repair progression and pass every required item','Stale pre-repair final run cannot satisfy terminal gate');
select lives_ok($$select erp.record_repair_test_run((select id from stage7_ids where kind='order'),'85300000-0000-0000-0000-000000000002','[{"item_key":"powers_on","result":"pass"},{"item_key":"reported_fault","result":"fail"},{"item_key":"safety","result":"pass"}]',null,'stage7-final-fail')$$,'Complete failing final run remains an immutable fact');
select throws_ok($$select erp.transition_repair_order((select id from stage7_ids where kind='order'),'85000000-0000-0000-0000-000000000004',null,'stage7-ready-fail','Ready with failed test')$$,'55000','latest final test must follow repair progression and pass every required item','Failing latest final run cannot satisfy terminal gate');
select lives_ok($$select erp.record_repair_test_run((select id from stage7_ids where kind='order'),'85300000-0000-0000-0000-000000000002','[{"item_key":"powers_on","result":"pass"},{"item_key":"reported_fault","result":"pass"},{"item_key":"safety","result":"pass"}]',null,'stage7-final-test')$$,'Versioned final test run is recorded with responsible actor');
select is((select count(*) from erp.repair_test_results r join erp.repair_test_runs run on run.id=r.test_run_id where run.repair_order_id=(select id from stage7_ids where kind='order') and run.id=(select id from erp.repair_test_runs where repair_order_id=run.repair_order_id order by run_sequence desc limit 1)),3::bigint,'Latest validated test has every required result');
select lives_ok($$select erp.transition_repair_order((select id from stage7_ids where kind='order'),'85000000-0000-0000-0000-000000000004',null,'stage7-ready','Ready after tests')$$,'Terminal transition succeeds after final tests');

select throws_ok($$select erp.create_repair_quote_version((select id from stage7_ids where kind='order'),'ARS',(select id from erp.exchange_rate_snapshots where source='stage7-local'),'[{"kind":"product","product_id":"b2000000-0000-0000-0000-000000000002","description":"Missing serial unit","quantity":1,"unit_price":100,"tax_rate_percent":21}]','stage7-quote-serial-missing','Missing unit')$$,'22023','serialized repair-part quote line 1 requires an inventory unit','Serialized quote parts require an inventory unit');
select throws_ok($$select erp.create_repair_quote_version((select id from stage7_ids where kind='order'),'ARS',(select id from erp.exchange_rate_snapshots where source='stage7-local'),jsonb_build_array(jsonb_build_object('kind','product','product_id','b2000000-0000-0000-0000-000000000001','inventory_unit_id',(select id from stage7_ids where kind='serial-unit'),'description','Quantity with unit','quantity',1,'unit_price',100,'tax_rate_percent',21)),'stage7-quote-quantity-unit','Wrong unit mode')$$,'22023','quantity repair-part quote line 1 cannot reference an inventory unit','Quantity quote parts cannot smuggle a serialized unit');
select throws_ok($$select erp.create_repair_quote_version((select id from stage7_ids where kind='order'),'ARS',(select id from erp.exchange_rate_snapshots where source='stage7-local'),jsonb_build_array(jsonb_build_object('kind','product','product_id','b2000000-0000-0000-0000-000000000002','inventory_unit_id',(select id from stage7_ids where kind='serial-unit-other-branch'),'description','Wrong branch unit','quantity',1,'unit_price',100,'tax_rate_percent',21)),'stage7-quote-wrong-branch-unit','Wrong branch unit')$$,'55000','authoritative repair-part cost unavailable on quote line 1','Serialized quote unit must be available in the repair branch');
 select lives_ok($$insert into stage7_ids(kind,id) values('quote1',erp.create_repair_quote_version((select id from stage7_ids where kind='order'),'ARS',(select id from erp.exchange_rate_snapshots where source='stage7-local'),jsonb_build_array(jsonb_build_object('kind','product','product_id','b2000000-0000-0000-0000-000000000001','description','Part','quantity',1,'unit_price',100,'unit_cost',999,'tax_rate_percent',21),jsonb_build_object('kind','product','product_id','b2000000-0000-0000-0000-000000000002','inventory_unit_id',(select id from stage7_ids where kind='serial-unit'),'description','Serialized part','quantity',1,'unit_price',80,'unit_cost',999,'tax_rate_percent',21)),'stage7-quote-1','First quote'))$$,'Quote freezes quantity WAC and serialized acquisition cost in one normalized pass');
select is((select unit_cost_snapshot from erp.get_repair_quote_costs((select id from stage7_ids where kind='quote1')) limit 1),25::numeric,'Caller product cost is ignored in favor of current WAC');
select is((select unit_cost_snapshot from erp.get_repair_quote_costs((select id from stage7_ids where kind='quote1')) where line_number=2),40::numeric,'Serialized quote part derives authoritative unit acquisition cost');
select is((select inventory_unit_id from erp.repair_quote_lines where quote_id=(select id from stage7_ids where kind='quote1') and line_number=2),(select id from stage7_ids where kind='serial-unit'),'Serialized inventory unit identity is stored on the immutable quote line');
select is((select total_amount from erp.repair_quotes where id=(select id from stage7_ids where kind='quote1')),(select sum(line_total) from erp.repair_quote_lines where quote_id=(select id from stage7_ids where kind='quote1')),'Frozen normalized quote lines agree with the inserted header total');
select throws_ok($$update erp.repair_quote_lines set inventory_unit_id=null where quote_id=(select id from stage7_ids where kind='quote1') and line_number=2$$,'42501','permission denied for table repair_quote_lines','Authenticated quote actors cannot mutate serialized unit linkage');
select lives_ok($$insert into stage7_ids(kind,id,secret) select 'quote1-token',quote_id,response_token from erp.issue_repair_quote((select id from stage7_ids where kind='quote1'),now()+interval '1 hour','stage7-quote1-issue','Issue first quote')$$,'First version can be issued');
select lives_ok($$insert into stage7_ids(kind,id) values('quote2',erp.create_repair_quote_version((select id from stage7_ids where kind='order'),'ARS',(select id from erp.exchange_rate_snapshots where source='stage7-local'),'[{"kind":"product","product_id":"b2000000-0000-0000-0000-000000000001","description":"Part revised","quantity":1,"unit_price":110,"tax_rate_percent":21}]','stage7-quote-2','Revised quote'))$$,'Editing creates a new version and supersedes the old token');
select is((select count(*) from erp.repair_quotes where repair_order_id=(select id from stage7_ids where kind='order')),2::bigint,'Both quote versions remain immutable');
set local role postgres;
select ok((select revoked_at is not null from erp.repair_quote_response_tokens where quote_id=(select id from stage7_ids where kind='quote1')),'New quote version revokes older response token');
reset role;
select is((select count(*) from erp.sales where reason like 'Stage 7%'),0::bigint,'Quote creation creates no fixture sale');
select is((select count(*) from erp.payments where repair_order_id=(select id from stage7_ids where kind='order')),0::bigint,'Quote creation creates no repair payment');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000002',true);
select throws_ok($$select erp.create_repair_quote_version((select id from stage7_ids where kind='order'),'ARS',(select id from erp.exchange_rate_snapshots where source='stage7-local'),'[{"kind":"free_concept","description":"Editable labor","quantity":1,"unit_price":50,"unit_cost":20,"tax_rate_percent":21}]','stage7-quote-no-cost','No cost permission')$$,'42501','costs.manage is required for editable labor or free-concept costs','Least-privilege quote manager cannot set editable costs');
select throws_ok($$select * from erp.get_repair_quote_costs((select id from stage7_ids where kind='quote2'))$$,'42501','quotes.view and costs.view are required','Quote viewer without costs.view cannot read snapshots');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
select throws_ok($$select * from erp.issue_repair_quote((select id from stage7_ids where kind='quote2'),null,'stage7-quote-null-expiry','Null expiry')$$,'22023','quote token expiry is required','Quote token creation rejects NULL expiry explicitly');
select throws_ok($$select * from erp.issue_repair_quote((select id from stage7_ids where kind='quote2'),now()+interval '8 days','stage7-quote-long','Too long')$$,'55000','only latest draft quote can be issued for at most seven days','Quote response TTL is capped');
select lives_ok($$insert into stage7_ids(kind,id,secret) select 'quote2-original',quote_id,response_token from erp.issue_repair_quote((select id from stage7_ids where kind='quote2'),now()+interval '1 hour','stage7-quote-issue','Issue latest quote')$$,'Latest quote issues a random response token once');
select throws_ok($$select * from erp.issue_repair_quote((select id from stage7_ids where kind='quote2'),now()+interval '1 hour','stage7-quote-issue','Issue latest quote')$$,'55000','quote token was already returned; reissue it to recover access','Quote secret replay directs caller to recovery');
select throws_ok($$select * from erp.reissue_repair_quote_token((select id from stage7_ids where kind='quote2'),null,'Null quote reissue expiry')$$,'22023','quote token expiry is required','Quote token reissue rejects NULL expiry explicitly');
select lives_ok($$insert into stage7_ids(kind,id,secret) select 'quote-token',quote_id,response_token from erp.reissue_repair_quote_token((select id from stage7_ids where kind='quote2'),(select expires_at from erp.repair_quotes where id=(select id from stage7_ids where kind='quote2')),'Recover lost quote token')$$,'Quote token can be securely reissued');
select is(length((select secret from stage7_ids where kind='quote-token')),64,'Quote token carries exactly 256 random bits');
reset role;
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is((select count(*) from erp.repair_quotes where organization_id='10000000-0000-0000-0000-000000000001'),0::bigint,'Foreign tenant RLS cannot see local quotes');
select throws_ok($$select * from erp.get_repair_quote_costs((select id from stage7_ids where kind='quote2'))$$,'42501','quotes.view and costs.view are required','Foreign tenant cannot read local quote costs through RPC');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
reset role;
insert into erp.repair_quote_response_tokens(id,organization_id,branch_id,quote_id,token_digest,created_at,expires_at)
values('b4000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select id from stage7_ids where kind='quote2'),encode(extensions.digest(convert_to(repeat('d',64),'UTF8'),'sha256'),'hex'),now()-interval '2 hours',now()-interval '1 hour');
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','anon',true);
set local role anon;
select throws_ok($$select public.respond_repair_quote((select secret from stage7_ids where kind='quote-token'),null,null)$$,'22023','valid quote response is required','Public quote response rejects NULL decision');
select throws_ok($$select public.respond_repair_quote((select secret from stage7_ids where kind='quote-token'),'maybe',null)$$,'22023','valid quote response is required','Public quote response rejects malformed decision');
select throws_ok($$select public.respond_repair_quote((select secret from stage7_ids where kind='quote1-token'),'approved',null)$$,'55000','quote response token is unavailable','Superseded quote token cannot decide');
select throws_ok($$select public.respond_repair_quote((select secret from stage7_ids where kind='quote2-original'),'approved',null)$$,'55000','quote response token is unavailable','Reissue revokes the lost original token');
select throws_ok($$select public.respond_repair_quote(repeat('d',64),'approved',null)$$,'55000','quote response token is unavailable','Expired token cannot decide');
select lives_ok($$select public.respond_repair_quote((select secret from stage7_ids where kind='quote-token'),'approved','Approved locally')$$,'Anon token holder approves latest quote once');
select throws_ok($$select public.respond_repair_quote((select secret from stage7_ids where kind='quote-token'),'rejected',null)$$,'55000','quote response token is unavailable','One terminal customer decision is enforced');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select erp.create_repair_quote_version((select id from stage7_ids where kind='order'),'ARS',(select id from erp.exchange_rate_snapshots where source='stage7-local'),'[{"kind":"product","product_id":"b2000000-0000-0000-0000-000000000001","description":"Too late","quantity":1,"unit_price":1,"tax_rate_percent":0}]','stage7-quote-after-decision','Too late')$$,'55000','customer quote decision is already terminal for this repair','No new quote version bypasses terminal decision');
select is((select count(*) from erp.sales where reason like 'Stage 7%'),0::bigint,'Quote approval still creates no fixture sale');
select is((select count(*) from erp.stock_documents where source_id=(select id from stage7_ids where kind='order')),0::bigint,'Quote approval creates no stock fact');

select lives_ok($$insert into stage7_ids(kind,id) values('part-batch',erp.reserve_repair_parts((select id from stage7_ids where kind='order'),now()+interval '1 hour','[{"location_id":"30000000-0000-0000-0000-000000000002","product_id":"b2000000-0000-0000-0000-000000000001","quantity":2}]','stage7-parts','Reserve parts'))$$,'Repair wrapper reserves parts');
select is((select source_type from erp.stock_reservation_batches where id=(select id from stage7_ids where kind='part-batch')),'repair','Reservation source type is repair');
select is((select source_id from erp.stock_reservation_batches where id=(select id from stage7_ids where kind='part-batch')),(select id from stage7_ids where kind='order'),'Reservation source is repair order');
select lives_ok($$insert into stage7_ids(kind,id) values('part-document',erp.consume_repair_parts((select id from stage7_ids where kind='order'),(select id from stage7_ids where kind='part-batch'),'stage7-consume','Consume parts'))$$,'Repair-specific consumption releases reservation and posts stock/cost atomically');
select is((select kind from erp.stock_documents where id=(select id from stage7_ids where kind='part-document')),'repair_consumption'::erp.stock_document_kind,'Repair consumption uses repair document semantics');
select is((select source_type from erp.stock_documents where id=(select id from stage7_ids where kind='part-document')),'repair','Repair stock document retains repair source');
select is((select status from erp.stock_reservation_batches where id=(select id from stage7_ids where kind='part-batch')),'released'::erp.stock_reservation_status,'Repair reservation is released rather than sale-fulfilled');
select is((select quantity_on_hand from erp.stock_balances where product_id='b2000000-0000-0000-0000-000000000001' and location_id='30000000-0000-0000-0000-000000000002'),8::numeric,'Repair consumption decrements stock');
select is((select value_delta_base from erp.stock_cost_movements where document_id=(select id from stage7_ids where kind='part-document')),-50::numeric,'Repair consumption records immutable cost');
select is(erp.consume_repair_parts((select id from stage7_ids where kind='order'),(select id from stage7_ids where kind='part-batch'),'stage7-consume','Consume parts'),(select id from stage7_ids where kind='part-document'),'Consumption retry is idempotent');
reset role;
insert into erp.profile_permission_overrides(organization_id,profile_id,permission_id,branch_id,effect,reason,created_by)
values('10000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001',(select id from erp.permissions where code='sales.cancel'),'20000000-0000-0000-0000-000000000001','deny','Repair reversal must not require sales.cancel','b3000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$insert into stage7_ids(kind,id) values('part-reversal',erp.reverse_repair_part_consumption((select id from stage7_ids where kind='order'),(select id from stage7_ids where kind='part-document'),'stage7-consume-reverse','Reverse repair part'))$$,'Repair consumption reversal does not require sales.cancel');
select is((select quantity_on_hand from erp.stock_balances where product_id='b2000000-0000-0000-0000-000000000001' and location_id='30000000-0000-0000-0000-000000000002'),10::numeric,'Repair reversal restores stock');
select lives_ok($$insert into stage7_ids(kind,id) values('serial-batch',erp.reserve_repair_parts((select id from stage7_ids where kind='order'),now()+interval '1 hour',jsonb_build_array(jsonb_build_object('location_id','30000000-0000-0000-0000-000000000002','product_id','b2000000-0000-0000-0000-000000000002','inventory_unit_id',(select id from stage7_ids where kind='serial-unit'),'quantity',1)),'stage7-serial-parts','Reserve serialized part'))$$,'Serialized repair part is reserved');
select lives_ok($$insert into stage7_ids(kind,id) values('serial-document',erp.consume_repair_parts((select id from stage7_ids where kind='order'),(select id from stage7_ids where kind='serial-batch'),'stage7-serial-consume','Consume serialized part'))$$,'Serialized repair part uses repair-specific consumption');
select is((select status from erp.inventory_units where id=(select id from stage7_ids where kind='serial-unit')),'retired'::erp.inventory_unit_status,'Consumed serialized repair part is retired rather than sold');
select lives_ok($$select erp.reverse_repair_part_consumption((select id from stage7_ids where kind='order'),(select id from stage7_ids where kind='serial-document'),'stage7-serial-reverse','Reverse serialized repair part')$$,'Serialized repair consumption reverses without sale semantics');
select is((select status from erp.inventory_units where id=(select id from stage7_ids where kind='serial-unit')),'available'::erp.inventory_unit_status,'Serialized reversal restores available state');
select throws_ok($$select erp.record_repair_labor((select id from stage7_ids where kind='order'),'Invalid labor','NaN'::numeric,10,'stage7-labor-nan')$$,'22023','finite labor values are required','Labor rejects NaN');
select lives_ok($$select erp.record_repair_labor((select id from stage7_ids where kind='order'),'Bench work',1.5,20,'stage7-labor')$$,'Finite labor cost fact is recorded');

select lives_ok($$select erp.open_cash_session('84000000-0000-0000-0000-000000000001','stage7-cash','Open repair cash','[{"currency_code":"ARS","amount":0}]')$$,'Repair cash session opens under existing rules');
select lives_ok($$insert into stage7_ids(kind,id) values('deposit',erp.record_repair_payment((select id from stage7_ids where kind='order'),'82000000-0000-0000-0000-000000000001',(select id from erp.cash_sessions where idempotency_key='stage7-cash'),50,'ARS',(select id from erp.exchange_rate_snapshots where source='stage7-local'),'stage7-deposit','Repair deposit',null))$$,'Repair deposit uses generic payment and cash facts');
select is((select sale_id from erp.payments where id=(select id from stage7_ids where kind='deposit')),null::uuid,'Repair deposit has no fake sale owner');
select is((select repair_order_id from erp.payments where id=(select id from stage7_ids where kind='deposit')),(select id from stage7_ids where kind='order'),'Repair deposit has exactly one repair owner');
select is((select count(*) from erp.customer_account_entries where payment_id=(select id from stage7_ids where kind='deposit')),0::bigint,'Repair deposit creates no customer-account entry');
select lives_ok($$select erp.reverse_repair_payment((select id from stage7_ids where kind='deposit'),'stage7-deposit-reverse','Reverse deposit',null)$$,'Repair payment exact reversal uses current cash session');
select is((select sum(amount) from erp.payments where repair_order_id=(select id from stage7_ids where kind='order')),0::numeric,'Repair payment reversal offsets exactly');

select throws_ok($$select * from erp.create_repair_media_upload_token((select id from stage7_ids where kind='order'),null,1,1000,array['image/jpeg'],'stage7-media-null-expiry')$$,'22023','bounded media token policy and TTL within 24 hours are required','Media token creation rejects NULL expiry');
select throws_ok($$select * from erp.create_repair_media_upload_token((select id from stage7_ids where kind='order'),now()+interval '1 hour',1,1000,null,'stage7-media-null-mimes')$$,'22023','bounded media token policy and TTL within 24 hours are required','Media token creation rejects NULL MIME policy');
select lives_ok($$select * from erp.create_repair_media_upload_token((select id from stage7_ids where kind='order'),now()+interval '1 hour',1,1073741824,array['image/jpeg'],'stage7-media-max-boundary')$$,'Media token accepts the table maximum of exactly one GiB');
select throws_ok($$select * from erp.create_repair_media_upload_token((select id from stage7_ids where kind='order'),now()+interval '1 hour',1,1073741825,array['image/jpeg'],'stage7-media-over-boundary')$$,'22023','bounded media token policy and TTL within 24 hours are required','Media token rejects one byte above the table maximum with controlled validation');
select lives_ok($$insert into stage7_ids(kind,id,secret) select 'media-token',upload_token_id,upload_token from erp.create_repair_media_upload_token((select id from stage7_ids where kind='order'),now()+interval '1 hour',2,1000,array['image/jpeg'],'stage7-media-token')$$,'Media token returns addressable ID plus at least 256 random bits');
select lives_ok($$insert into stage7_ids(kind,id,secret) select 'media-token-sibling',upload_token_id,upload_token from erp.create_repair_media_upload_token((select id from stage7_ids where kind='order'),now()+interval '1 hour',1,1000,array['image/jpeg'],'stage7-media-token-sibling')$$,'A repair can retain a second independent active upload session');
select throws_ok($$select * from erp.create_repair_media_upload_token((select id from stage7_ids where kind='order'),now()+interval '25 hours',1,1000,array['image/jpeg'],'stage7-media-long')$$,'22023','bounded media token policy and TTL within 24 hours are required','Media token TTL is capped');
select is(length((select secret from stage7_ids where kind='media-token')),64,'Media token is 32 bytes encoded as hex');
select throws_ok($$select * from erp.create_repair_media_upload_token((select id from stage7_ids where kind='order'),now()+interval '1 hour',2,1000,array['image/jpeg'],'stage7-media-token')$$,'55000','media token was already returned; reissue it to recover access','Media secret replay is explicit and recoverable');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','anon',true);
set local role anon;
select lives_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token'),1,'predecessor photo.jpg','image/jpeg',600,repeat('f',64))$$,'Predecessor media usage is recorded before explicit token reissue');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select * from erp.reissue_repair_media_upload_token((select id from stage7_ids where kind='media-token'),null,'Null expiry')$$,'22023','media token expiry is required','Media token reissue rejects NULL expiry');
select lives_ok($$insert into stage7_ids(kind,id,secret) select 'media-token-reissued',upload_token_id,upload_token from erp.reissue_repair_media_upload_token((select id from stage7_ids where kind='media-token'),now()+interval '1 hour','Recover media token')$$,'Media upload token reissues the explicitly addressed session');
reset role;
select is((select token_family_id from erp.repair_media_upload_tokens where id=(select id from stage7_ids where kind='media-token-reissued')),(select token_family_id from erp.repair_media_upload_tokens where id=(select id from stage7_ids where kind='media-token')),'Reissued token preserves predecessor quota-family identity');
select isnt((select token_family_id from erp.repair_media_upload_tokens where id=(select id from stage7_ids where kind='media-token-sibling')),(select token_family_id from erp.repair_media_upload_tokens where id=(select id from stage7_ids where kind='media-token')),'Concurrent sibling upload session has an independent quota family');
select ok((select revoked_at is null from erp.repair_media_upload_tokens where id=(select id from stage7_ids where kind='media-token-sibling')),'Reissuing one upload session leaves its sibling active');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select erp.rotate_repair_tracking_token((select id from stage7_ids where kind='order'),null,'Null tracking expiry')$$,'22023','tracking TTL must be within 365 days and include a reason','Tracking rotation rejects NULL expiry');
select lives_ok($$insert into stage7_ids(kind,id,secret) values('tracking-new',(select id from stage7_ids where kind='order'),erp.rotate_repair_tracking_token((select id from stage7_ids where kind='order'),now()+interval '30 days','Rotate tracking token'))$$,'Tracking token can be explicitly rotated');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','anon',true);
set local role anon;
select throws_ok($$select * from public.get_repair_tracking(repeat('A',64))$$,'22023','tracking token must be exactly 64 lowercase hexadecimal characters','Tracking token format is exact and lowercase');
select throws_ok($$select public.register_repair_private_media(null,1,'photo.jpg','image/jpeg',500,repeat('a',64))$$,'22023','bounded media metadata and a 256-bit token are required','Public media registration rejects NULL token');
select throws_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token-reissued'),1,'photo.jpg',null,500,repeat('a',64))$$,'22023','bounded media metadata and a 256-bit token are required','Public media registration rejects NULL MIME');
select throws_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token-reissued'),1,'photo.jpg','not a mime',500,repeat('a',64))$$,'22023','bounded media metadata and a 256-bit token are required','Public media registration rejects malformed MIME');
select throws_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token-reissued'),1,'photo.jpg','image/jpeg',500,null)$$,'22023','bounded media metadata and a 256-bit token are required','Public media registration rejects NULL hash');
select throws_ok($$select public.register_repair_private_media('A'||substr((select secret from stage7_ids where kind='media-token-reissued'),2),1,'photo.jpg','image/jpeg',500,repeat('a',64))$$,'22023','bounded media metadata and a 256-bit token are required','Public media token must be exactly lowercase hex');
select throws_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token'),1,'lost-token.jpg','image/jpeg',100,repeat('e',64))$$,'55000','upload token or file metadata is invalid','Only the explicitly reissued old media token is revoked');
select lives_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token-sibling'),1,'sibling photo.jpg','image/jpeg',1000,repeat('d',64))$$,'Sibling token family retains its complete independent byte quota');
select throws_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token-reissued'),1,'over-family-quota.jpg','image/jpeg',401,repeat('9',64))$$,'23514','upload token limits exceeded','Predecessor bytes reduce successor remaining family quota');
select lives_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token-reissued'),1,'customer photo.jpg','image/jpeg',400,repeat('a',64))$$,'Successor may consume exactly the family quota remaining after predecessor usage');
select throws_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token-reissued'),2,'second.jpg','image/jpeg',1,repeat('b',64))$$,'23514','upload token limits exceeded','Media token enforces file count');
select is((select count(*) from public.get_repair_tracking((select secret from stage7_ids where kind='order'))),0::bigint,'Rotated old tracking token is revoked');
select is((select count(*) from public.get_repair_tracking((select secret from stage7_ids where kind='tracking-new'))),1::bigint,'Anon tracking returns latest status only');
select is((select public_message from public.get_repair_tracking((select secret from stage7_ids where kind='tracking-new'))),'Equipo listo para entregar','Public tracking uses configured status message');
select is((select extract(minute from status_at) from public.get_repair_tracking((select secret from stage7_ids where kind='tracking-new'))),0::numeric,'Public tracking timestamp is coarsened to the hour');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
select matches((select object_path from erp.repair_private_media where upload_token_id=(select id from stage7_ids where kind='media-token-reissued')),'^repair-private/[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+/001[.]jpg$','Media object path is canonical and server-derived');
set local role authenticated;
select lives_ok($$insert into stage7_ids(kind,id,secret) select 'media-token-mime',upload_token_id,upload_token from erp.create_repair_media_upload_token((select id from stage7_ids where kind='order'),now()+interval '1 hour',2,1000,array['image/jpeg'],'stage7-media-token-mime')$$,'Independent media token stores MIME constraints');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','anon',true);
set local role anon;
select throws_ok($$select public.register_repair_private_media((select secret from stage7_ids where kind='media-token-mime'),1,'stage7.png','image/png',100,repeat('c',64))$$,'55000','upload token or file metadata is invalid','Media token rejects disallowed MIME');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select ok(pg_get_function_result('public.get_repair_tracking(text)'::regprocedure) !~* 'customer|contact|serial|imei|credential|cipher|note|cost|path','Public tracking signature exposes no sensitive columns');
select lives_ok($$select erp.record_repair_label_event((select id from stage7_ids where kind='order'),'repair-default',1,'test-printer','stage7-label')$$,'Authorized actor records internal label metadata');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000002',true);
select is((select count(*) from erp.repair_label_events where repair_order_id=(select id from stage7_ids where kind='order')),0::bigint,'Repair viewer without labels.print cannot read label events');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',true);

select lives_ok($$select erp.record_repair_test_run((select id from stage7_ids where kind='order'),'85300000-0000-0000-0000-000000000002','[{"item_key":"powers_on","result":"pass"},{"item_key":"reported_fault","result":"fail"},{"item_key":"safety","result":"pass"}]',null,'stage7-final-delivery-fail')$$,'Later failing final run becomes latest');
select throws_ok($$select erp.deliver_repair_order((select id from stage7_ids where kind='order'),'Customer','1234','typed_name','Customer',90,'Repair warranty terms','stage7-delivery-fail','Deliver repaired equipment')$$,'55000','terminal status and latest passing final tests are required for delivery','Delivery rejects latest failing final run');
select lives_ok($$select erp.record_repair_test_run((select id from stage7_ids where kind='order'),'85300000-0000-0000-0000-000000000002','[{"item_key":"powers_on","result":"pass"},{"item_key":"reported_fault","result":"pass"},{"item_key":"safety","result":"pass"}]',null,'stage7-final-delivery-pass')$$,'Passing retest restores delivery eligibility');
select throws_ok($$select erp.deliver_repair_order((select id from stage7_ids where kind='order'),'Customer','1234','typed_name','Customer',null,'Repair warranty terms','stage7-delivery-null','Deliver repaired equipment')$$,'22023','warranty days are invalid','Null warranty duration is rejected explicitly');
select lives_ok($$insert into stage7_ids(kind,id) values('delivery',erp.deliver_repair_order((select id from stage7_ids where kind='order'),'Customer','1234','typed_name','Customer',90,'Repair warranty terms','stage7-delivery','Deliver repaired equipment'))$$,'Terminal repair with latest passing final run can be delivered');
select is((select starts_at from erp.repair_warranties where repair_order_id=(select id from stage7_ids where kind='order')),(select delivered_at from erp.repair_deliveries where id=(select id from stage7_ids where kind='delivery')),'Warranty starts at immutable delivery instant');
select lives_ok($$select erp.open_repair_warranty_claim((select id from erp.repair_warranties where repair_order_id=(select id from stage7_ids where kind='order')),'Issue returned','stage7-claim','Open independent claim')$$,'Warranty claim is an independent fact');
select is((select count(*) from erp.repair_state_events where repair_order_id=(select id from stage7_ids where kind='order') and occurred_at>(select c.opened_at from erp.repair_warranty_claims c join erp.repair_warranties w on w.id=c.warranty_id where w.repair_order_id=(select id from stage7_ids where kind='order'))),0::bigint,'Claim does not reopen or rewrite original order');

reset role;
select throws_ok($$update erp.repair_deliveries set recipient_name='Changed' where id=(select id from stage7_ids where kind='delivery')$$,'23000','erp.repair_deliveries facts are append-only','Delivery is immutable');
select throws_ok($$delete from erp.equipment_ownership_events where equipment_id=(select id from stage7_ids where kind='equipment')$$,'23000','erp.equipment_ownership_events facts are append-only','Ownership history cannot be deleted');
select ok(exists(select 1 from erp.audit_events where table_name='repair_quotes' and metadata->>'redacted'='true'),'Repair audit events are explicitly redacted');
select ok(not exists(select 1 from erp.audit_events where table_name in('repair_credentials','repair_private_media') and (coalesce(old_values,'{}')::text||coalesce(new_values,'{}')::text) <> '{}{}'),'Sensitive tables never audit row payloads');
select ok(exists(select 1 from erp.audit_events where table_name='repair_quote_response_events' and action='insert' and actor_user_id is null and old_values is null and new_values is null and metadata->>'redacted'='true'),'Anonymous quote response audit stores null attribution and redacted metadata only');
select ok(exists(select 1 from erp.audit_events where table_name='repair_private_media' and action='insert' and actor_user_id is null and old_values is null and new_values is null and metadata->>'redacted'='true'),'Anonymous media audit stores null attribution and redacted metadata only');
select ok(not exists(select 1 from erp.audit_events where table_name in('repair_quote_response_events','repair_private_media') and (old_values is not null or new_values is not null or metadata ?| array['token','token_digest','sha256_digest','object_path','client_filename'])),'Anonymous public audit metadata excludes token, digest, path, and filename material');
select has_function('erp','record_sale_payment',array['uuid','uuid','uuid','numeric','text','text','text'],'Existing sale payment signature remains compatible');
select has_function('erp','reverse_sale_payment',array['uuid','text','text','uuid'],'Existing sale reversal signature remains compatible');
select has_function('erp','create_stock_reservation',array['uuid','text','text','uuid','timestamp with time zone','jsonb'],'Existing reservation signature remains compatible');
select has_function('erp','fulfill_stock_reservation',array['uuid','text','text'],'Existing cost-integrated fulfillment remains compatible');

select * from finish();
rollback;
