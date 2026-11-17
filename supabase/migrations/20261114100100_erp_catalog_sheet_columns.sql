-- The bridge is intentionally unchanged here; Stage 1 sheet synchronization
-- must be implemented before writing these fields through the ERP.
alter table erp.products
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists condition text,
  add column if not exists capacity text,
  add column if not exists sheet_template text not null default 'accesorio',
  add column if not exists web_status text generated always as (
    case
      when not is_active then 'paused'
      when publish_on_web and allow_online_sale and can_sell then 'published'
      when publish_on_web then 'paused'
      else 'draft'
    end
  ) stored;

alter table erp.products
  add constraint products_condition_sheet_check
    check (condition is null or condition in ('nuevo', 'usado', 'reacondicionado')),
  add constraint products_sheet_template_check
    check (sheet_template in ('celular', 'accesorio', 'funda'));

-- Classify only existing smartphone products with a concrete model.  Other
-- products keep the default; category changes are not inferred afterwards.
update erp.products p
   set sheet_template = 'celular'
  from erp.product_categories c
 where p.organization_id = c.organization_id
   and p.category_id = c.id
   and p.model_id is not null
   and (lower(c.name) like '%smartphone%' or lower(c.name) like '%celular%');

comment on column erp.products.model_id is
  'Modelo que es el producto (celulares); compatibilidades de accesorios en erp.product_compatible_models.';
comment on table erp.product_compatible_models is
  'Modelos para los que sirve un accesorio; no indica el modelo que es un celular.';
comment on column erp.products.web_status is
  'Estado derivado: borrador, publicado o pausado; un producto inactivo nunca se publica.';
