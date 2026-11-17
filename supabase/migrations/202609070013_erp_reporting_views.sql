-- Migration: 202609070013_erp_reporting_views.sql
-- Description: Vistas de lectura para reportes fiscales y de gestion. Solo exponen
-- hechos reales; donde la fuente no existe se devuelve NULL documentado en vez de
-- cifras inventadas. Las vistas son security_invoker: el RLS de las tablas base
-- sigue filtrando por organizacion/permiso del invocante; el GRANT SELECT solo
-- habilita el acceso.
--
-- v_iva_ventas: base + IVA por alicuota desde erp.sale_lines (base = line_total -
--   tax_amount). Sin filtro de periodo: las ventas no tienen periodo contable.
-- v_iva_compras: base + IVA desde erp.purchase_order_lines. La linea de compra NO
--   tiene columna de alicuota (solo tax_amount): alicuota se expone NULL.
-- v_trial_balance: sumas y saldos por cuenta solo de periodos CERRADOS
--   (accounting_periods.status = 'closed') y asientos posted/reversed.
-- v_profitability_by_line: margen por producto con ventas reales y costo promedio
--   ponderado real de erp.purchase_receipt_lines; sin recepciones el costo y el
--   margen son NULL (estimacion documentada, no inventada).

set search_path = erp, pg_catalog;

create or replace view erp.v_iva_ventas as
select
  l.organization_id,
  s.branch_id,
  s.id as sale_id,
  s.confirmed_at::date as sale_date,
  l.tax_rate_percent as alicuota,
  (l.line_total - l.tax_amount)::numeric(18, 4) as base_imponible,
  l.tax_amount as iva
from erp.sale_lines l
join erp.sales s on s.id = l.sale_id and s.organization_id = l.organization_id;

create or replace view erp.v_iva_compras as
select
  l.organization_id,
  o.branch_id,
  o.id as purchase_order_id,
  o.ordered_at::date as purchase_date,
  null::numeric(7, 4) as alicuota,
  round(l.ordered_quantity * l.unit_price, 4)::numeric(18, 4) as base_imponible,
  l.tax_amount as iva
from erp.purchase_order_lines l
join erp.purchase_orders o on o.id = l.purchase_order_id and o.organization_id = l.organization_id;

create or replace view erp.v_trial_balance as
select
  e.organization_id,
  e.period_id,
  p.period_start,
  p.period_end,
  l.account_id,
  a.code as account_code,
  a.name as account_name,
  sum(l.debit)::numeric(18, 2) as total_debit,
  sum(l.credit)::numeric(18, 2) as total_credit,
  (sum(l.debit) - sum(l.credit))::numeric(18, 2) as balance
from erp.journal_entry_lines l
join erp.journal_entries e on e.id = l.journal_entry_id and e.organization_id = l.organization_id
join erp.accounting_periods p on p.id = e.period_id and p.organization_id = e.organization_id
join erp.chart_of_accounts a on a.id = l.account_id and a.organization_id = l.organization_id
where p.status = 'closed'
  and e.status in ('posted', 'reversed')
group by
  e.organization_id, e.period_id, p.period_start, p.period_end,
  l.account_id, a.code, a.name;

create or replace view erp.v_profitability_by_line as
with sales_agg as (
  select
    l.organization_id,
    l.product_id,
    sum(l.quantity)::numeric(18, 4) as quantity_sold,
    sum(l.line_total)::numeric(18, 4) as gross_revenue
  from erp.sale_lines l
  where l.kind = 'product' and l.product_id is not null
  group by l.organization_id, l.product_id
),
cost_agg as (
  select
    l.organization_id,
    l.product_id,
    sum(l.landed_cost_base)::numeric(18, 4) as total_landed_cost,
    sum(l.quantity)::numeric(18, 4) as quantity_received
  from erp.purchase_receipt_lines l
  where l.product_id is not null
  group by l.organization_id, l.product_id
)
select
  p.organization_id,
  p.id as product_id,
  p.internal_code,
  p.internal_name,
  s.quantity_sold,
  s.gross_revenue,
  case
    when c.quantity_received is null or c.quantity_received = 0 then null
    else (c.total_landed_cost / c.quantity_received)::numeric(24, 8)
  end as avg_unit_landed_cost,
  case
    when c.quantity_received is null or c.quantity_received = 0 or s.quantity_sold is null then null
    else (s.quantity_sold * c.total_landed_cost / c.quantity_received)::numeric(18, 4)
  end as estimated_cost,
  case
    when c.quantity_received is null or c.quantity_received = 0 or s.quantity_sold is null then null
    else (s.gross_revenue - s.quantity_sold * c.total_landed_cost / c.quantity_received)::numeric(18, 4)
  end as margin
from erp.products p
left join sales_agg s on s.product_id = p.id and s.organization_id = p.organization_id
left join cost_agg c on c.product_id = p.id and c.organization_id = p.organization_id
where s.quantity_sold is not null or c.quantity_received is not null;

comment on view erp.v_iva_ventas is
  'IVA ventas: base + IVA por alicuota desde sale_lines reales. Sin filtro de periodo (las ventas no tienen periodo).';
comment on view erp.v_iva_compras is
  'IVA compras: base + IVA desde purchase_order_lines. alicuota NULL: la linea de compra no registra alicuota.';
comment on view erp.v_trial_balance is
  'Balance de sumas y saldos por cuenta, solo periodos cerrados y asientos posted/reversed.';
comment on view erp.v_profitability_by_line is
  'Rentabilidad por producto: ingresos reales vs costo promedio ponderado real de recepciones; NULL sin datos de costo.';

grant select on erp.v_iva_ventas, erp.v_iva_compras, erp.v_trial_balance, erp.v_profitability_by_line
  to authenticated;
