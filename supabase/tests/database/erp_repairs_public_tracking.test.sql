begin;
create extension if not exists pgtap with schema extensions;
select plan(48);
select ok(position('public.repair_status' in pg_get_functiondef('public.get_repair_by_tracking_code_erp(text)'::regprocedure)) > 0,
  'El adaptador califica el enum público aunque su search_path no incluya public');
select is((select count(*) from erp.repair_statuses where organization_id='10000000-0000-0000-0000-000000000001' and
  (code,public_stage) in (('received','Recibido'),('diagnosis','Diagnóstico'),('waiting_parts','Repuestos'),('repair','Reparación'),('ready','Finalizado'),('delivered','Finalizado'))), 6::bigint, 'Los seis estados tienen su etapa pública');
select ok((select is_terminal from erp.repair_statuses where organization_id='10000000-0000-0000-0000-000000000001' and code='delivered'), 'Entregado es terminal');
select is((select count(*) from erp.repair_status_transitions t join erp.repair_statuses f on f.id=t.from_status_id join erp.repair_statuses s on s.id=t.to_status_id where t.organization_id='10000000-0000-0000-0000-000000000001' and
  (f.code,s.code) in (('received','diagnosis'),('diagnosis','waiting_parts'),('diagnosis','repair'),('waiting_parts','repair'),('repair','waiting_parts'),('repair','ready'),('ready','delivered'))), 7::bigint, 'Existen las transiciones del flujo');
select lives_ok($$select erp.install_repair_public_stages('10000000-0000-0000-0000-000000000001')$$, 'La instalación es idempotente');
select is((select count(*) from erp.repair_statuses where organization_id='10000000-0000-0000-0000-000000000001' and code in ('waiting_parts','delivered')), 2::bigint, 'La reinstalación no duplica estados');
select ok(exists(select 1 from pg_trigger where tgrelid='erp.repair_deliveries'::regclass and tgname='repair_delivery_record_state' and not tgisinternal), 'La entrega formal registra el evento de estado');
select ok(exists(select 1 from pg_trigger where tgrelid='erp.repair_state_events'::regclass and tgname='repair_state_delivered_guard' and not tgisinternal), 'Entregado exige una entrega formal');
select ok(not has_function_privilege('anon','erp.install_repair_public_stages(uuid)','execute'), 'La instalación no es una RPC anónima');

-- Fixture local transaccional con usuario y cliente de reparaciones.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','87000000-0000-0000-0000-000000000096','authenticated','authenticated','tracking-test@example.test','x',now(),'{"provider":"email"}','{}',now(),now());
update erp.profiles set organization_id='10000000-0000-0000-0000-000000000001' where id='87000000-0000-0000-0000-000000000096';
insert into erp.profile_roles(organization_id,profile_id,role_id,created_by)
values('10000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000096','40000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000096') on conflict do nothing;
insert into erp.customers(id,organization_id,code,display_name) values('c1000000-0000-0000-0000-000000000096','10000000-0000-0000-0000-000000000001','TRACK-TEST','Cliente de prueba');
insert into erp.customer_private_details(organization_id,customer_id,identity_document) values('10000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000096','30123456');
create temporary table tracking_test_ids(kind text primary key, id uuid, code text);
grant all on tracking_test_ids to authenticated,anon;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000096',true);
set local role authenticated;
insert into tracking_test_ids select 'one',(v->>'repair_order_id')::uuid,v->>'public_tracking_code' from erp.intake_repair_order('20000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000096','Teléfono','Marca','Modelo','SN-TRACK-ONE',null,'[]','Bien',null,'SECRETO DE INGRESO','Falla') as t(v);
insert into tracking_test_ids select 'two',(v->>'repair_order_id')::uuid,v->>'public_tracking_code' from erp.intake_repair_order('20000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000096','Teléfono','Marca','Modelo','SN-TRACK-TWO',null,'[]','Bien',null,null,'Falla') as t(v);
select ok((select code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' from tracking_test_ids where kind='one'), 'Código de ingreso respeta formato');
select isnt((select code from tracking_test_ids where kind='one'),(select code from tracking_test_ids where kind='two'),'Códigos son únicos');
select lives_ok($$select erp.add_repair_note((select id from tracking_test_ids where kind='one'),'Nota pública',true)$$,'Alta de nota pública');
select lives_ok($$select erp.add_repair_note((select id from tracking_test_ids where kind='one'),'NOTA INTERNA SECRETA',false)$$,'Alta de nota interna');
select is((select count(*) from erp.search_repairs_by_document('30123456')),2::bigint,'Búsqueda ERP por DNI autorizado');
select is((select count(*) from erp.search_repairs_by_document('no válido')),0::bigint,'Búsqueda ERP rechaza DNI inválido');
reset role;
select set_config('request.headers','{"x-forwarded-for":"192.0.2.11"}',true);
set local role anon;
select is((select count(*) from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='one'))),1::bigint,'Búsqueda por código');
select is((select count(*) from public.get_repair_by_tracking_code_erp('30123456')),2::bigint,'Búsqueda por DNI');
select is((select count(*) from public.get_repair_by_tracking_code_erp('30.123.456')),2::bigint,'Búsqueda por DNI con puntos');
select ok((select repair_logs::text like '%Nota pública%' from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='one'))),'Nota pública visible');
select ok((select repair_logs::text not like '%NOTA INTERNA SECRETA%' and notes not like '%SECRETO DE INGRESO%' from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='one'))),'No se exponen notas internas');
select is((select count(*) from public.get_repair_by_tracking_code_erp('ZZZZ-ZZZZ')),0::bigint,'Código inexistente no expone datos');
reset role;
select ok(not has_table_privilege('anon','erp.repair_orders','select'),'Anon no puede leer órdenes');
select ok(has_function_privilege('anon','public.get_repair_by_tracking_code_erp(text)','execute'),'Anon puede ejecutar el RPC');
reset role;
-- Insertamos eventos de prueba directamente para cubrir cada una de las etapas públicas.
create temporary table expected_stages(code text, stage text);
insert into expected_stages values ('received','Recibido'),('diagnosis','Diagnóstico'),('waiting_parts','Repuestos'),('repair','Reparación'),('ready','Finalizado');
create temporary table mapped_stages(code text,stage text);
do $$ declare item record; order_id uuid; branch uuid:='20000000-0000-0000-0000-000000000001'; org uuid:='10000000-0000-0000-0000-000000000001'; c text;
begin
 select id,code into order_id,c from tracking_test_ids where kind='one';
 for item in select * from expected_stages loop
   insert into erp.repair_state_events(organization_id,branch_id,repair_order_id,status_id,public_message,internal_reason)
   select org,branch,order_id,id,'Mensaje público','RAZÓN INTERNA' from erp.repair_statuses where organization_id=org and code=item.code;
   insert into mapped_stages select item.code,status::text from public.get_repair_by_tracking_code_erp(c);
 end loop;
end $$;
select is((select count(*) from expected_stages e join mapped_stages m using(code) where e.stage=m.stage),5::bigint,'Cinco etapas públicas mapeadas');
insert into erp.repair_deliveries(organization_id,branch_id,repair_order_id,recipient_name,recipient_document_suffix,signature_method,signature_reference,delivered_at,delivered_by)
values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select id from tracking_test_ids where kind='one'),'Cliente','3456','typed_name','Cliente',clock_timestamp(),'87000000-0000-0000-0000-000000000096');
select is((select status::text from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='one'))),'Finalizado','Entrega formal mapea a etapa Finalizado');
select ok((select repair_logs::text not like '%RAZÓN INTERNA%' from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='one'))),'Motivo interno nunca se expone');
update erp.repair_tracking_rate_config set max_per_value=1;
select is((select count(*) from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='two'))),1::bigint,'Primer intento de código válido permitido');
select is((select count(*) from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='two'))),0::bigint,'Límite bloquea código válido');
select is((select attempts from erp.repair_tracking_attempts where bucket='v:'||encode(extensions.digest(convert_to((select code from tracking_test_ids where kind='two'),'UTF8'),'sha256'),'hex')),2,'Intentos contabilizados en servidor');
update erp.repair_tracking_rate_config set max_per_value=100,max_per_ip=1;
select set_config('request.headers','{"x-forwarded-for":"192.0.2.12"}',true);
select is((select count(*) from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='one'))),1::bigint,'Primer intento por IP permitido');
select is((select count(*) from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='two'))),0::bigint,'Límite por IP bloquea otro código');
do $$ begin perform * from public.get_repair_by_tracking_code_erp('UUUU-UUUU'); end $$;
select is((select count(*) from erp.repair_tracking_attempts where bucket='v:'||encode(extensions.digest(convert_to('UUUU-UUUU','UTF8'),'sha256'),'hex')),0::bigint,'IP limitada no crea buckets adicionales');

insert into erp.organizations(id,legal_name,display_name,timezone,default_currency) values('10000000-0000-0000-0000-000000000096','Nueva','Nueva','America/Argentina/Buenos_Aires','ARS');
select is((select count(*) from erp.repair_statuses where organization_id='10000000-0000-0000-0000-000000000096'),6::bigint,'Nuevas organizaciones reciben seis estados');
select ok(not has_function_privilege('anon','erp.add_repair_note(uuid,text,boolean)','execute'),'Anon no puede agregar notas');
select ok(not has_function_privilege('anon','erp.search_repairs_by_document(text)','execute'),'Anon no puede buscar documentos del ERP');
select ok(not has_table_privilege('anon','erp.repair_notes','select'),'Anon no puede leer notas ERP');

-- Una búsqueda por DNI debe devolver como máximo los cinco ingresos más recientes.
update erp.repair_tracking_rate_config set max_per_value=100,max_per_ip=100;
select set_config('request.headers','{"x-forwarded-for":"192.0.2.98"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000096',true);
set local role authenticated;
do $$ declare i integer; v jsonb; begin
  for i in 1..4 loop
    select erp.intake_repair_order('20000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000096','Teléfono','Marca','Modelo','SN-TRACK-EXTRA-'||i,null,'[]','Bien',null,null,'Falla') into v;
    insert into tracking_test_ids values ('extra-'||i,(v->>'repair_order_id')::uuid,v->>'public_tracking_code');
  end loop;
end $$;
reset role;
select is((select count(*) from public.get_repair_by_tracking_code_erp('30123456')),5::bigint,'La búsqueda por DNI limita a cinco órdenes');
select is((select array_agg(id) from public.get_repair_by_tracking_code_erp('30123456')),
  (select array_agg(id order by opened_at desc,id desc) from (select r.id,r.opened_at from erp.repair_orders r join tracking_test_ids t on t.id=r.id order by r.opened_at desc,r.id desc limit 5) q),
  'La búsqueda ordena los ingresos más recientes primero');

-- Fuerza una colisión y comprueba que el generador vuelva a intentar.
create temporary sequence collision_attempts;
create or replace function erp.new_repair_public_code() returns text language plpgsql volatile set search_path=pg_catalog as $collision$
begin
  if nextval('pg_temp.collision_attempts')=1 then return (select code from pg_temp.tracking_test_ids where kind='one'); end if;
  return 'ZZZZ-ZZZZ';
end $collision$;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000096',true);
set local role authenticated;
insert into tracking_test_ids select 'collision',(v->>'repair_order_id')::uuid,v->>'public_tracking_code' from erp.intake_repair_order('20000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000096','Teléfono','Marca','Modelo','SN-TRACK-COLLISION',null,'[]','Bien',null,null,'Falla') as t(v);
select is((select code from tracking_test_ids where kind='collision'),'ZZZZ-ZZZZ','Se genera otro código tras colisión');
reset role;
select is((select last_value from collision_attempts),2::bigint,'La colisión provoca un reintento');

-- Ejercitar el respaldo y la restauración, sin ejecutar scripts de corte.
do $$ declare rt text:=pg_get_function_result('public.get_repair_by_tracking_code_erp(text)'::regprocedure); begin
  execute format('create or replace function public.get_repair_by_tracking_code(search_code text) returns %s language sql as $body$ select * from public.get_repair_by_tracking_code_erp(search_code) where false $body$',rt);
end $$;
insert into erp.cutover_function_backups(function_identity,definition)
select 'public.get_repair_by_tracking_code(text)',pg_get_functiondef('public.get_repair_by_tracking_code(text)'::regprocedure);
select is((select definition from erp.cutover_function_backups where restored_at is null order by id desc limit 1),pg_get_functiondef('public.get_repair_by_tracking_code(text)'::regprocedure),'El respaldo conserva la definición exacta');
do $$ declare rt text:=pg_get_function_result('public.get_repair_by_tracking_code(text)'::regprocedure); begin
 execute format('create or replace function public.get_repair_by_tracking_code(search_code text) returns %s language sql as $body$ select * from public.get_repair_by_tracking_code_erp(search_code) $body$',rt);
end $$;
select isnt((select definition from erp.cutover_function_backups where restored_at is null order by id desc limit 1),pg_get_functiondef('public.get_repair_by_tracking_code(text)'::regprocedure),'El respaldo no cambia al reemplazar el RPC');
do $$ declare definition text; begin select b.definition into strict definition from erp.cutover_function_backups b where b.restored_at is null order by b.id desc limit 1; execute definition; end $$;
select is((select definition from erp.cutover_function_backups where restored_at is null order by id desc limit 1),pg_get_functiondef('public.get_repair_by_tracking_code(text)'::regprocedure),'La definición respaldada se puede restaurar');
-- Los valores anteriores al proxy no deben permitir rotar el límite por IP.
update erp.repair_tracking_rate_config set max_per_value=100,max_per_ip=1;
insert into erp.repair_tracking_attempts(bucket,window_started,attempts)
values ('expired-test',clock_timestamp()-interval '2 days',1);
select set_config('request.headers','{"x-forwarded-for":"spoof-a, 192.0.2.99"}',true);
select is((select count(*) from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='one'))),1::bigint,'El último salto permite el primer intento');
select set_config('request.headers','{"x-forwarded-for":"spoof-b, 192.0.2.99"}',true);
select is((select count(*) from public.get_repair_by_tracking_code_erp((select code from tracking_test_ids where kind='one'))),0::bigint,'El primer salto falso no permite evadir el límite');
select is((select count(*) from erp.repair_tracking_attempts where bucket='expired-test'),0::bigint,'La consulta purga buckets vencidos');
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
select ok(to_regprocedure('public.get_repair_by_tracking_code_erp(text)') is not null, 'Primera reinstalación del adaptador');
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
select ok(to_regprocedure('public.get_repair_by_tracking_code_erp(text)') is not null, 'Segunda reinstalación del adaptador');
select * from finish();
rollback;
