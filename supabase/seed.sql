insert into erp.organizations (
  id,
  legal_name,
  display_name,
  timezone,
  default_currency
) values (
  '10000000-0000-0000-0000-000000000001',
  'NicTech',
  'NicTech',
  'America/Argentina/Buenos_Aires',
  'ARS'
)
on conflict (id) do nothing;

insert into erp.repair_statuses (
  id, organization_id, code, name, display_order, is_initial, is_terminal,
  requires_final_tests, public_message
)
values
  ('85000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','received','Recibido',1,true,false,false,'Equipo recibido'),
  ('85000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','diagnosis','Diagnostico',2,false,false,false,'Equipo en diagnostico'),
  ('85000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','repair','Reparacion',3,false,false,false,'Reparacion en curso'),
  ('85000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','ready','Listo para entregar',4,false,true,true,'Equipo listo para entregar')
on conflict (id) do update set
  code=excluded.code,name=excluded.name,display_order=excluded.display_order,
  is_initial=excluded.is_initial,is_terminal=excluded.is_terminal,
  requires_final_tests=excluded.requires_final_tests,public_message=excluded.public_message,is_active=true;

insert into erp.repair_status_transitions (
  id, organization_id, from_status_id, to_status_id, required_permission
)
values
  ('85100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000002','repairs.manage'),
  ('85100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000002','85000000-0000-0000-0000-000000000003','repairs.manage'),
  ('85100000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000003','85000000-0000-0000-0000-000000000004','repairs.manage')
on conflict (id) do update set
  organization_id=excluded.organization_id,from_status_id=excluded.from_status_id,
  to_status_id=excluded.to_status_id,required_permission=excluded.required_permission,is_active=true;

insert into erp.repair_test_templates (id,organization_id,code,kind,name)
values
  ('85200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','standard_intake','intake','Prueba estandar de ingreso'),
  ('85200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','standard_final','final','Prueba estandar final')
on conflict (id) do update set
  organization_id=excluded.organization_id,code=excluded.code,kind=excluded.kind,
  name=excluded.name,is_active=true;

select set_config('erp.allow_seed_template_update','on',false);

insert into erp.repair_test_template_versions (id,organization_id,template_id,version,definition)
values
  ('85300000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','85200000-0000-0000-0000-000000000001',1,'[{"key":"powers_on","label":"Enciende","required":true},{"key":"display","label":"Pantalla","required":true},{"key":"connectivity","label":"Conectividad","required":true}]'::jsonb),
  ('85300000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','85200000-0000-0000-0000-000000000002',1,'[{"key":"powers_on","label":"Enciende","required":true},{"key":"reported_fault","label":"Falla reportada","required":true},{"key":"safety","label":"Seguridad","required":true}]'::jsonb)
on conflict (id) do update set
  organization_id=excluded.organization_id,template_id=excluded.template_id,
  version=excluded.version,definition=excluded.definition;

select set_config('erp.allow_seed_template_update','off',false);

insert into erp.branches (id, organization_id, code, name)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'CENTRAL',
  'Sucursal central'
)
on conflict (id) do nothing;

insert into erp.locations (
  id,
  organization_id,
  branch_id,
  code,
  name,
  kind,
  allows_sale,
  contributes_to_web_stock
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'MOSTRADOR',
    'Mostrador',
    'store',
    true,
    true
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'DEPOSITO',
    'Deposito',
    'warehouse',
    false,
    true
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'TALLER',
    'Taller',
    'workshop',
    false,
    false
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'RESERVA-REP',
    'Reserva reparaciones',
    'repair_reserve',
    false,
    false
  ),
  (
    '30000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'RESERVA-WEB',
    'Reserva web',
    'web_reserve',
    false,
    false
  ),
  (
    '30000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'GARANTIAS',
    'Garantias',
    'warranty',
    false,
    false
  ),
  (
    '30000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'TRANSITO',
    'En transito',
    'transit',
    false,
    false
  )
on conflict (id) do nothing;

insert into erp.permissions (code, module, name, is_sensitive)
values
  ('dashboard.view', 'dashboard', 'Ver centro operativo', false),
  ('sales.view', 'sales', 'Ver ventas', false),
  ('sales.create', 'sales', 'Crear ventas', false),
  ('sales.discount', 'sales', 'Autorizar descuentos', true),
  ('sales.cancel', 'sales', 'Anular ventas', true),
  ('cash.view', 'cash', 'Ver caja', true),
  ('cash.open', 'cash', 'Abrir caja', true),
  ('cash.close', 'cash', 'Cerrar caja', true),
  ('cash.adjust', 'cash', 'Registrar diferencias de caja', true),
  ('orders.view', 'orders', 'Ver pedidos online', false),
  ('orders.manage', 'orders', 'Gestionar pedidos online', false),
  ('catalog.view', 'catalog', 'Ver catalogo interno', false),
  ('catalog.manage', 'catalog', 'Gestionar productos y servicios', false),
  ('stock.view', 'stock', 'Ver existencias', false),
  ('stock.view_identifiers', 'stock', 'Ver series e IMEI', true),
  ('stock.move', 'stock', 'Mover existencias', false),
  ('stock.reservations_expire', 'stock', 'Vencer reservas de stock', true),
  ('stock.adjust', 'stock', 'Ajustar existencias', true),
  ('stock.override_negative', 'stock', 'Autorizar stock negativo', true),
  ('stock_counts.view', 'stock_counts', 'Ver inventarios fisicos', false),
  ('stock_counts.manage', 'stock_counts', 'Gestionar inventarios fisicos', true),
  ('labels.print', 'labels', 'Imprimir etiquetas', false),
  ('purchases.view', 'purchases', 'Ver compras', true),
  ('purchases.manage', 'purchases', 'Gestionar compras', true),
  ('purchases.approve', 'purchases', 'Aprobar compras', true),
  ('suppliers.view', 'suppliers', 'Ver proveedores', false),
  ('suppliers.manage', 'suppliers', 'Gestionar proveedores', true),
  ('customers.view', 'customers', 'Ver clientes', false),
  ('customers.manage', 'customers', 'Gestionar clientes', false),
  ('customers.view_sensitive', 'customers', 'Ver datos sensibles de clientes', true),
  ('quotes.view', 'quotes', 'Ver presupuestos', false),
  ('quotes.manage', 'quotes', 'Gestionar presupuestos', false),
  ('repairs.view', 'repairs', 'Ver reparaciones', false),
  ('repairs.manage', 'repairs', 'Gestionar reparaciones', false),
  ('repairs.view_identifiers', 'repairs', 'Ver series e IMEI de equipos de clientes', true),
  ('repairs.view_credentials', 'repairs', 'Ver credenciales de equipos', true),
  ('repair_tests.view', 'repair_tests', 'Ver pruebas tecnicas', false),
  ('repair_tests.manage', 'repair_tests', 'Gestionar pruebas tecnicas', false),
  ('pc_builds.view', 'pc_builds', 'Ver armados de PC', false),
  ('pc_builds.manage', 'pc_builds', 'Gestionar armados de PC', false),
  ('trade_ins.view', 'trade_ins', 'Ver equipos usados', false),
  ('trade_ins.manage', 'trade_ins', 'Gestionar equipos usados', true),
  ('warranties.view', 'warranties', 'Ver garantias', false),
  ('warranties.manage', 'warranties', 'Gestionar garantias', false),
  ('pricing.view', 'pricing', 'Ver precios y cotizaciones', false),
  ('pricing.manage', 'pricing', 'Gestionar precios y cotizaciones', true),
  ('costs.view', 'costs', 'Ver costos', true),
  ('costs.manage', 'costs', 'Gestionar costos', true),
  ('profitability.view', 'profitability', 'Ver rentabilidad', true),
  ('accounts_receivable.view', 'accounts_receivable', 'Ver cuentas corrientes', true),
  ('accounts_receivable.manage', 'accounts_receivable', 'Gestionar cuentas corrientes', true),
  ('accounting.view', 'accounting', 'Ver contabilidad', true),
  ('accounting.post', 'accounting', 'Publicar asientos', true),
  ('accounting.close_period', 'accounting', 'Cerrar periodos', true),
  ('reports.view', 'reports', 'Ver reportes', false),
  ('reports.export', 'reports', 'Exportar reportes', true),
  ('documents.view', 'documents', 'Ver documentos', false),
  ('documents.issue', 'documents', 'Emitir documentos', true),
  ('messages.view', 'messages', 'Ver conversaciones', false),
  ('messages.manage', 'messages', 'Gestionar conversaciones', false),
  ('integrations.view', 'integrations', 'Ver estado de integraciones', true),
  ('integrations.retry', 'integrations', 'Reintentar integraciones', true),
  ('users.view', 'users', 'Ver usuarios y permisos', true),
  ('users.manage', 'users', 'Gestionar usuarios y permisos', true),
  ('users.assign_sensitive', 'users', 'Asignar permisos sensibles', true),
  ('locations.view', 'locations', 'Ver sucursales y ubicaciones', false),
  ('locations.manage', 'locations', 'Gestionar sucursales y ubicaciones', true),
  ('configuration.view', 'configuration', 'Ver configuracion', false),
  ('configuration.view_secret', 'configuration', 'Ver valores secretos de configuracion', true),
  ('configuration.manage', 'configuration', 'Gestionar configuracion', true),
  ('audit.view', 'audit', 'Ver auditoria', true)
on conflict (code) do update
set module = excluded.module,
    name = excluded.name,
    is_sensitive = excluded.is_sensitive,
    is_active = true;

insert into erp.roles (
  id,
  organization_id,
  code,
  name,
  description,
  is_system
)
values
  (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'owner',
    'Responsable del sistema',
    'Acceso completo. Debe asignarse de forma controlada.',
    true
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'sales',
    'Ventas',
    'Venta, clientes, pedidos y consultas operativas.',
    true
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'technician',
    'Tecnico',
    'Reparaciones, pruebas, repuestos y garantias.',
    true
  ),
  (
    '40000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'inventory',
    'Inventario y compras',
    'Catalogo, existencias, compras y proveedores.',
    true
  )
on conflict (id) do nothing;

insert into erp.role_permissions (organization_id, role_id, permission_id)
select
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  permission.id
from erp.permissions permission
where permission.is_active
on conflict (role_id, permission_id) do update
set is_active = true,
    updated_at = now();

update erp.role_permissions role_permission
set is_active = false,
    updated_at = now()
from erp.permissions permission
where role_permission.role_id = '40000000-0000-0000-0000-000000000001'
  and role_permission.permission_id = permission.id
  and not permission.is_active
  and role_permission.is_active;

update erp.role_permissions
set is_active = false,
    updated_at = now()
where role_id = '40000000-0000-0000-0000-000000000002'
  and is_active;

insert into erp.role_permissions (organization_id, role_id, permission_id)
select
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002',
  permission.id
from erp.permissions permission
where permission.code = any (array[
  'dashboard.view',
  'sales.view',
  'sales.create',
  'cash.view',
  'cash.open',
  'cash.close',
  'orders.view',
  'orders.manage',
  'catalog.view',
  'stock.view',
  'customers.view',
  'customers.manage',
  'quotes.view',
  'quotes.manage',
  'repairs.view',
  'pricing.view',
  'documents.view',
  'messages.view',
  'locations.view'
])
on conflict (role_id, permission_id) do update
set is_active = true,
    updated_at = now();

update erp.role_permissions
set is_active = false,
    updated_at = now()
where role_id = '40000000-0000-0000-0000-000000000003'
  and is_active;

insert into erp.role_permissions (organization_id, role_id, permission_id)
select
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003',
  permission.id
from erp.permissions permission
where permission.code = any (array[
  'dashboard.view',
  'catalog.view',
  'stock.view',
  'stock.move',
  'customers.view',
  'quotes.view',
  'repairs.view',
  'repairs.manage',
  'repair_tests.view',
  'repair_tests.manage',
  'pc_builds.view',
  'pc_builds.manage',
  'warranties.view',
  'warranties.manage',
  'documents.view',
  'locations.view'
])
on conflict (role_id, permission_id) do update
set is_active = true,
    updated_at = now();

update erp.role_permissions
set is_active = false,
    updated_at = now()
where role_id = '40000000-0000-0000-0000-000000000004'
  and is_active;

insert into erp.role_permissions (organization_id, role_id, permission_id)
select
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000004',
  permission.id
from erp.permissions permission
where permission.code = any (array[
  'dashboard.view',
  'catalog.view',
  'catalog.manage',
  'stock.view',
  'stock.move',
  'stock.reservations_expire',
  'stock.adjust',
  'stock_counts.view',
  'stock_counts.manage',
  'labels.print',
  'purchases.view',
  'purchases.manage',
  'purchases.approve',
  'suppliers.view',
  'suppliers.manage',
  'pricing.view',
  'pricing.manage',
  'costs.view',
  'costs.manage',
  'locations.view'
])
on conflict (role_id, permission_id) do update
set is_active = true,
    updated_at = now();

insert into erp.configuration_values (
  organization_id,
  key,
  value,
  description,
  is_system
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'inventory.negative_stock_default',
    'false'::jsonb,
    'El stock negativo requiere una autorizacion explicita por operacion.',
    true
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    'repairs.order_prefix',
    '"NT"'::jsonb,
    'Prefijo visible para las ordenes de reparacion.',
    true
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    'currencies.enabled',
    '["ARS", "USD"]'::jsonb,
    'Monedas habilitadas inicialmente.',
    true
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    'orders.reservation_minutes',
    '30'::jsonb,
    'Vigencia predeterminada de reservas de pedidos web.',
    true
  )
on conflict do nothing;

insert into erp.organization_currencies (
  id, organization_id, currency_code, decimal_places, is_base
)
values
  (
    '81000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'ARS', 2, true
  ),
  (
    '81000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'USD', 2, false
  )
on conflict (id) do nothing;

insert into erp.payment_methods (
  id, organization_id, code, name, surcharge_percent, max_installments,
  settlement_kind, requires_cash_session
)
values
  (
    '82000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'CASH', 'Efectivo', 0, 1, 'cash', true
  ),
  (
    '82000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'CARD', 'Tarjeta', 0, 12, 'card', false
  ),
  (
    '82000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'MERCADOPAGO', 'Mercado Pago', 0, 1, 'wallet', false
  )
on conflict (id) do update
set settlement_kind = excluded.settlement_kind,
    requires_cash_session = excluded.requires_cash_session,
    surcharge_percent = excluded.surcharge_percent,
    max_installments = excluded.max_installments,
    is_active = true;

insert into erp.cash_registers (
  id, organization_id, branch_id, code, name
) values (
  '84000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'MAIN', 'Caja principal'
)
on conflict (id) do nothing;

insert into erp.price_lists (
  id, organization_id, code, name, currency_code, payment_method_id
)
values (
  '83000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'RETAIL-ARS', 'Venta minorista ARS', 'ARS',
  '82000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into erp.units_of_measure (
  id,
  organization_id,
  code,
  name,
  allows_decimals
)
values
  (
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'UN',
    'Unidad',
    false
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'HS',
    'Hora',
    true
  )
on conflict (id) do nothing;

insert into erp.product_types (
  id,
  organization_id,
  code,
  name,
  item_kind,
  default_tracking_mode
)
values
  (
    '60000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'PRODUCT',
    'Producto por cantidad',
    'product',
    'quantity'
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'SERIALIZED',
    'Producto serializado',
    'product',
    'serial'
  ),
  (
    '60000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'IMEI',
    'Equipo con IMEI',
    'product',
    'imei'
  ),
  (
    '60000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'SERVICE',
    'Servicio',
    'service',
    'none'
  )
on conflict (id) do nothing;

-- Stage 7 deterministic PC-build, trade-in and IMEI configuration.
insert into erp.permissions(code,module,name,is_sensitive)
values ('trade_ins.approve','trade_ins','Aprobar procedencia, evaluacion y liberacion de canjes',true)
on conflict(code) do update set module=excluded.module,name=excluded.name,is_sensitive=excluded.is_sensitive,is_active=true;

insert into erp.locations(
  id,organization_id,branch_id,code,name,kind,allows_sale,contributes_to_web_stock
) values (
  '30000000-0000-0000-0000-000000000008',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'CUARENTENA-CANJES','Cuarentena de canjes','quarantine',false,false
)
on conflict(id) do update set code=excluded.code,name=excluded.name,kind=excluded.kind,
  allows_sale=false,contributes_to_web_stock=false,is_active=true;

insert into erp.payment_methods(
  id,organization_id,code,name,surcharge_percent,max_installments,settlement_kind,requires_cash_session
) values (
  '82000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000001',
  'TRADE_IN','Canje en parte de pago',0,1,'credit',false
)
on conflict(id) do update set code=excluded.code,name=excluded.name,surcharge_percent=0,
  max_installments=1,settlement_kind='credit',requires_cash_session=false,is_active=true;

insert into erp.pc_compatibility_specs(id,organization_id,code,name)
values('86000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','standard_pc','PC estandar')
on conflict(id) do update set code=excluded.code,name=excluded.name,is_active=true;

insert into erp.pc_compatibility_rule_sets(id,organization_id,code,name)
values('86100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','standard_pc','Compatibilidad PC estandar')
on conflict(id) do update set code=excluded.code,name=excluded.name,is_active=true;

insert into erp.pc_test_templates(id,organization_id,code,name)
values('86200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','standard_pc_final','Prueba final de PC')
on conflict(id) do update set code=excluded.code,name=excluded.name,is_active=true;

select set_config('erp.allow_stage7_seed_update','on',false);

insert into erp.pc_compatibility_spec_versions(id,organization_id,spec_id,version,required_slots)
values('86300000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','86000000-0000-0000-0000-000000000001',1,'["motherboard","cpu","memory","storage","power_supply"]'::jsonb)
on conflict(id) do update set spec_id=excluded.spec_id,version=excluded.version,required_slots=excluded.required_slots;

insert into erp.pc_compatibility_rule_set_versions(id,organization_id,rule_set_id,version)
values('86400000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',1)
on conflict(id) do update set rule_set_id=excluded.rule_set_id,version=excluded.version;

insert into erp.pc_compatibility_rules(id,organization_id,rule_set_version_id,rule_order,code,severity,definition,message)
values
  ('86500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','86400000-0000-0000-0000-000000000001',1,'cpu_socket','fail','{"left_slot":"motherboard","left_key":"socket","operator":"eq","right_slot":"cpu","right_key":"socket"}'::jsonb,'El socket del CPU no coincide con la placa madre'),
  ('86500000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','86400000-0000-0000-0000-000000000001',2,'memory_type','fail','{"left_slot":"motherboard","left_key":"memory_type","operator":"eq","right_slot":"memory","right_key":"memory_type"}'::jsonb,'El tipo de memoria no coincide con la placa madre'),
  ('86500000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','86400000-0000-0000-0000-000000000001',3,'power_capacity','fail','{"left_slot":"power_supply","left_key":"watts","operator":"gte","right_slot":"cpu","right_key":"recommended_psu_watts"}'::jsonb,'La fuente no alcanza la potencia recomendada')
on conflict(id) do update set rule_set_version_id=excluded.rule_set_version_id,
  rule_order=excluded.rule_order,code=excluded.code,severity=excluded.severity,
  definition=excluded.definition,message=excluded.message;

insert into erp.pc_test_template_versions(id,organization_id,template_id,version,definition)
values('86600000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','86200000-0000-0000-0000-000000000001',1,
  '[{"key":"post","label":"POST completo","required":true},{"key":"memory","label":"Prueba de memoria","required":true},{"key":"storage","label":"Prueba de almacenamiento","required":true},{"key":"thermal","label":"Prueba termica","required":true}]'::jsonb)
on conflict(id) do update set template_id=excluded.template_id,version=excluded.version,definition=excluded.definition;

select set_config('erp.allow_stage7_seed_update','off',false);

insert into erp.configuration_values(organization_id,key,value,description,is_system)
values
  ('10000000-0000-0000-0000-000000000001','pc_builds.default_spec_version','"86300000-0000-0000-0000-000000000001"'::jsonb,'Version predeterminada de especificacion de armado PC.',true),
  ('10000000-0000-0000-0000-000000000001','pc_builds.default_rule_set_version','"86400000-0000-0000-0000-000000000001"'::jsonb,'Version predeterminada de reglas de compatibilidad PC.',true),
  ('10000000-0000-0000-0000-000000000001','pc_builds.final_test_template_version','"86600000-0000-0000-0000-000000000001"'::jsonb,'Version obligatoria de la prueba final de armado PC.',true),
  ('10000000-0000-0000-0000-000000000001','trade_ins.imei_manual_fallback','{"requires_documentation":true,"blocked_override":false}'::jsonb,'Politica local para alternativa manual de IMEI.',true)
on conflict do nothing;

update erp.configuration_values set
  value='"86300000-0000-0000-0000-000000000001"'::jsonb,
  description='Version predeterminada de especificacion de armado PC.',is_system=true,
  version=version+case when value is distinct from '"86300000-0000-0000-0000-000000000001"'::jsonb then 1 else 0 end,
  updated_at=now()
where organization_id='10000000-0000-0000-0000-000000000001' and branch_id is null
  and key='pc_builds.default_spec_version';

update erp.configuration_values set
  value='"86400000-0000-0000-0000-000000000001"'::jsonb,
  description='Version predeterminada de reglas de compatibilidad PC.',is_system=true,
  version=version+case when value is distinct from '"86400000-0000-0000-0000-000000000001"'::jsonb then 1 else 0 end,
  updated_at=now()
where organization_id='10000000-0000-0000-0000-000000000001' and branch_id is null
  and key='pc_builds.default_rule_set_version';

update erp.configuration_values set
  value='"86600000-0000-0000-0000-000000000001"'::jsonb,
  description='Version obligatoria de la prueba final de armado PC.',is_system=true,
  version=version+case when value is distinct from '"86600000-0000-0000-0000-000000000001"'::jsonb then 1 else 0 end,
  updated_at=now()
where organization_id='10000000-0000-0000-0000-000000000001' and branch_id is null
  and key='pc_builds.final_test_template_version';

update erp.configuration_values set
  value='{"requires_documentation":true,"blocked_override":false}'::jsonb,
  description='Politica local para alternativa manual de IMEI.',is_system=true,
  version=version+case when value is distinct from '{"requires_documentation":true,"blocked_override":false}'::jsonb then 1 else 0 end,
  updated_at=now()
where organization_id='10000000-0000-0000-0000-000000000001' and branch_id is null
  and key='trade_ins.imei_manual_fallback';

insert into erp.role_permissions(organization_id,role_id,permission_id)
select '10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',id
from erp.permissions where is_active
on conflict(role_id,permission_id) do update set is_active=true,updated_at=now();

update erp.role_permissions rp
set is_active=false,updated_at=now()
from erp.permissions p
where rp.permission_id=p.id
  and rp.role_id in(
    '40000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000003',
    '40000000-0000-0000-0000-000000000004'
  )
  and p.code in('pc_builds.view','pc_builds.manage','trade_ins.view','trade_ins.manage','trade_ins.approve')
  and rp.is_active;

insert into erp.role_permissions(organization_id,role_id,permission_id)
select '10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',id
from erp.permissions where code='trade_ins.view'
on conflict(role_id,permission_id) do update set is_active=true,updated_at=now();

insert into erp.role_permissions(organization_id,role_id,permission_id)
select '10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003',id
from erp.permissions where code in('pc_builds.view','pc_builds.manage','trade_ins.view','trade_ins.manage')
on conflict(role_id,permission_id) do update set is_active=true,updated_at=now();

insert into erp.role_permissions(organization_id,role_id,permission_id)
select '10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000004',id
from erp.permissions where code in('pc_builds.view','trade_ins.view','trade_ins.manage')
on conflict(role_id,permission_id) do update set is_active=true,updated_at=now();

-- Stage 8: versioned documents, local fiscal stub and official-channel templates.
insert into erp.document_templates(id,organization_id,code,name,document_kind)
values
  ('91000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','SALE_RECEIPT','Comprobante de venta','sale'),
  ('91000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','PAYMENT_RECEIPT','Recibo de pago','payment'),
  ('91000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','REPAIR_ORDER','Orden de reparacion','repair'),
  ('91000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','WARRANTY_CERTIFICATE','Certificado de garantia','warranty'),
  ('91000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','PC_BUILD_SHEET','Ficha de armado PC','pc_build'),
  ('91000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','TRADE_IN_RECEIPT','Comprobante de canje','trade_in')
on conflict(id) do update set code=excluded.code,name=excluded.name,document_kind=excluded.document_kind,is_active=true;

insert into erp.document_template_versions(id,organization_id,template_id,version,definition)
values
  ('91100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',1,'{"sections":["business","customer","sale","payments","totals"]}'::jsonb),
  ('91100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002',1,'{"sections":["business","customer","payment","application"]}'::jsonb),
  ('91100000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',1,'{"sections":["business","customer","equipment","intake","public_status"]}'::jsonb),
  ('91100000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000004',1,'{"sections":["business","customer","equipment","coverage","dates"]}'::jsonb),
  ('91100000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000005',1,'{"sections":["business","customer","equipment","components","tests","warranties"]}'::jsonb),
  ('91100000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000006',1,'{"sections":["business","customer","equipment","provenance","evaluation","accepted_value"]}'::jsonb)
on conflict(id) do nothing;

insert into erp.fiscal_points(id,organization_id,branch_id,code,name,environment)
values('91400000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'Punto de venta local','local_stub')
on conflict(id) do update set code=excluded.code,name=excluded.name,environment='local_stub',is_active=true;

insert into erp.message_templates(id,organization_id,code,channel,name)
values
  ('91200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','REPAIR_STATUS','whatsapp','Actualizacion de reparacion'),
  ('91200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ORDER_READY','whatsapp','Pedido listo'),
  ('91200000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','DOCUMENT_AVAILABLE','email','Documento disponible')
on conflict(id) do update set code=excluded.code,channel=excluded.channel,name=excluded.name,is_active=true;

insert into erp.message_template_versions(id,organization_id,template_id,version,provider_template_name,body,variable_keys)
values
  ('91300000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','91200000-0000-0000-0000-000000000001',1,'nictech_repair_status_v1','Tu reparacion {{order_code}} ahora esta en {{status}}.','["order_code","status"]'::jsonb),
  ('91300000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','91200000-0000-0000-0000-000000000002',1,'nictech_order_ready_v1','Tu pedido {{order_code}} esta listo para retirar.','["order_code"]'::jsonb),
  ('91300000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','91200000-0000-0000-0000-000000000003',1,null,'Tu documento {{document_number}} ya esta disponible.','["document_number"]'::jsonb)
on conflict(id) do nothing;

select set_config('erp.operation_reason','Deterministic stage 8 seed',false);
insert into erp.communication_automation_rules(id,organization_id,branch_id,code,event_type,template_version_id,conditions,is_active)
values('91500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','REPAIR_STATUS_NOTIFY','repair.status.changed','91300000-0000-0000-0000-000000000001','{"requires_consent":true}'::jsonb,false)
on conflict(id) do update set event_type=excluded.event_type,template_version_id=excluded.template_version_id,conditions=excluded.conditions,is_active=false,updated_at=now();

update erp.role_permissions rp
set is_active=false,updated_at=now()
from erp.permissions p
where rp.permission_id=p.id
  and rp.role_id in('40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004')
  and p.code in('documents.view','documents.issue','messages.view','messages.manage','integrations.view','integrations.retry')
  and rp.is_active;

insert into erp.role_permissions(organization_id,role_id,permission_id)
select '10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',id
from erp.permissions where code in('documents.view','documents.issue','messages.view','messages.manage')
on conflict(role_id,permission_id) do update set is_active=true,updated_at=now();

insert into erp.role_permissions(organization_id,role_id,permission_id)
select '10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003',id
from erp.permissions where code in('documents.view','documents.issue','messages.view','messages.manage')
on conflict(role_id,permission_id) do update set is_active=true,updated_at=now();

insert into erp.role_permissions(organization_id,role_id,permission_id)
select '10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000004',id
from erp.permissions where code in('documents.view','documents.issue')
on conflict(role_id,permission_id) do update set is_active=true,updated_at=now();

insert into erp.repair_credential_keys (
  organization_id, key_version, key_material, is_active
)
select
  '10000000-0000-0000-0000-000000000001'::uuid,
  1,
  extensions.gen_random_bytes(32),
  true
where not exists (
  select 1 from erp.repair_credential_keys
  where organization_id = '10000000-0000-0000-0000-000000000001'::uuid and is_active
);
