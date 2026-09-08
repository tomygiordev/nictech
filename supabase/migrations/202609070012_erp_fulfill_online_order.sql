-- Migration: 202609070012_erp_fulfill_online_order.sql
-- Description: RPC transaccional erp.fulfill_online_order para cumplir ordenes online
-- (erp.web_orders) en una sola transaccion: valida orden y pago aprobado, descuenta
-- stock con el mecanismo real (erp.fulfill_web_order -> erp.create_sale ->
-- erp.fulfill_stock_reservation), registra el asiento via erp.post_erp_source_event
-- y devuelve {sale_id, stock_document_id, journal_entry_id}.
--
-- Idempotencia: si ya existe fila en erp.web_order_fulfillments para la orden, se
-- devuelven los ids existentes (y el asiento ya posteado, o se postea el faltante
-- con la misma operation_key||':journal' si un intento previo fallo tras la venta).
--
-- Estado cumplido: erp.web_orders no tiene columnas status/stock_decremented (el
-- estado vive en erp.web_order_events 'fulfilled' + erp.web_order_fulfillments, que
-- inserta erp.fulfill_web_order); no se hace UPDATE sobre la cabecera.
--
-- RLS ordenes: verificado en DB local que erp.web_orders NO tiene policy UPDATE para
-- authenticated ni grant UPDATE (has_table_privilege UPDATE = false, 0 policies
-- UPDATE). El UPDATE directo ya esta denegado: no se toca ninguna policy.
-- Brecha documentada: public.orders (storefront) no existe en las migraciones
-- locales; su RLS debe auditarse en remoto, fuera del alcance de esta oleada.

set search_path = erp, pg_catalog, pg_temp;

create or replace function erp.fulfill_online_order(
  target_order_id uuid,
  payment_reference text,
  operation_key text,
  operation_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  org_id uuid := erp.current_organization_id();
  order_row erp.web_orders%rowtype;
  existing erp.web_order_fulfillments%rowtype;
  approved erp.web_payment_events%rowtype;
  sale_id uuid;
  stock_doc_id uuid;
  sale_total numeric(18, 4);
  sale_currency text;
  sale_fx numeric(24, 10);
  receivable_acct uuid;
  income_acct uuid;
  journal_id uuid;
begin
  if nullif(btrim(payment_reference), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'payment reference is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'operation key and reason are required';
  end if;

  select * into order_row
  from erp.web_orders
  where id = target_order_id and organization_id = org_id
  for update;
  if order_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'online order not found';
  end if;
  if not erp.has_permission('orders.manage', order_row.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'orders.manage permission is required';
  end if;

  -- Idempotencia: fulfillment existente.
  select * into existing
  from erp.web_order_fulfillments
  where web_order_id = target_order_id and organization_id = org_id;
  if existing.id is not null then
    sale_id := existing.sale_id;
    stock_doc_id := existing.stock_document_id;
  else
    -- Pago aprobado por el total: el evento mas reciente con payment_state 'paid'.
    select pe.* into approved
    from erp.web_order_events oe
    join erp.web_payment_events pe on pe.id = oe.source_payment_event_id
    where oe.web_order_id = target_order_id
      and oe.organization_id = org_id
      and oe.payment_state = 'paid'
    order by oe.event_sequence desc
    limit 1;
    if approved.id is null or approved.amount is distinct from order_row.total_amount then
      raise exception using errcode = 'object_not_in_prerequisite_state', message = 'fully approved web payment is required';
    end if;
    if approved.provider_payment_id is not null
       and approved.provider_payment_id <> btrim(payment_reference) then
      raise exception using errcode = 'object_not_in_prerequisite_state', message = 'payment reference does not match the approved provider payment';
    end if;

    -- Venta + descuento de stock con el mecanismo real (incluye evento 'fulfilled').
    sale_id := erp.fulfill_web_order(target_order_id, operation_key || ':fulfill', operation_reason);
    select s.stock_document_id into stock_doc_id
    from erp.sales s
    where s.id = sale_id;
  end if;

  -- Asiento contable idempotente (source event unico por orden).
  select ase.journal_entry_id into journal_id
  from erp.accounting_source_events ase
  where ase.organization_id = org_id
    and ase.source_type = 'online_order'
    and ase.source_id = target_order_id
    and ase.posting_kind = 'primary';
  if journal_id is null then
    select s.total_amount, s.currency_code, s.exchange_rate
      into sale_total, sale_currency, sale_fx
    from erp.sales s
    where s.id = sale_id;
    if sale_total is null or sale_total <= 0 then
      raise exception using errcode = 'object_not_in_prerequisite_state', message = 'posted sale total is required for journal posting';
    end if;
    select r.account_id into receivable_acct
    from erp.accounting_account_roles r
    where r.organization_id = org_id and r.role_code = 'receivable';
    select r.account_id into income_acct
    from erp.accounting_account_roles r
    where r.organization_id = org_id and r.role_code = 'sales_income';
    if receivable_acct is null or income_acct is null then
      raise exception using errcode = 'object_not_in_prerequisite_state', message = 'receivable and sales income accounts are required (bootstrap_chart_of_accounts)';
    end if;
    -- Sin cuenta de IVA en el plan (roles reales: receivable/sales_income); el
    -- detalle de IVA por alicuota vive en erp.sale_lines y se expone en
    -- erp.v_iva_ventas. El asiento registra el total real de la venta.
    journal_id := erp.post_erp_source_event(
      order_row.branch_id, current_date, 'online_order', target_order_id,
      operation_key || ':journal', operation_reason,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', receivable_acct,
          'description', 'Online order ' || target_order_id::text,
          'debit', round(sale_total, 2), 'credit', 0,
          'currency_code', sale_currency, 'exchange_rate', sale_fx
        ),
        jsonb_build_object(
          'account_id', income_acct,
          'description', 'Online order ' || target_order_id::text,
          'debit', 0, 'credit', round(sale_total, 2),
          'currency_code', sale_currency, 'exchange_rate', sale_fx
        )
      )
    );
  end if;

  return jsonb_build_object(
    'sale_id', sale_id,
    'stock_document_id', stock_doc_id,
    'journal_entry_id', journal_id
  );
end;
$$;

comment on function erp.fulfill_online_order(uuid, text, text, text) is
  'Cumplimiento transaccional de orden online: venta + stock (fulfill_web_order) + asiento (post_erp_source_event). Idempotente por orden.';

revoke all on function erp.fulfill_online_order(uuid, text, text, text) from public, anon, service_role;
grant execute on function erp.fulfill_online_order(uuid, text, text, text) to authenticated;
