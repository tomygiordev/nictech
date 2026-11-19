import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { button, capture, expect, owner, setProfile, tag, test, workspace } from './fixtures';
import { balancesOf, depotId, editSheet, findProduct, stockedAccessory } from './catalog-fixtures';
import { literal, organizationId, sql, sqlRows } from './local';

const dashboardMoney = new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2,
});

function kpi(page: Page, label: string) {
  return page.locator('.flow-kpi-card').filter({ has: page.getByText(label, { exact: true }) }).locator('.flow-kpi-card__val');
}

async function dashboard(page: Page) {
  const receiving = page.waitForResponse((response) => new URL(response.url()).pathname === '/rest/v1/rpc/get_dashboard_metrics');
  await workspace(page, 'Centro operativo');
  const response = await receiving;
  expect(response.ok()).toBe(true);
  const data: {
    sales: { total_ars: number };
    products_active_count: number;
    active_repairs_count: number;
    inventory: { sellable_units: number; value_at_sale_price_ars: number };
  } = await response.json();
  await expect(kpi(page, 'Productos activos')).toHaveText(String(data.products_active_count));
  await expect(kpi(page, 'Equipos en taller')).toHaveText(String(data.active_repairs_count));
  await expect(kpi(page, 'Ventas del período')).toHaveText(dashboardMoney.format(data.sales.total_ars));
  await expect(kpi(page, 'Stock vendible a precio de venta')).toHaveText(dashboardMoney.format(data.inventory.value_at_sale_price_ars));
  return data;
}

test('Dashboard y catálogo: KPIs del servidor cambian al cargar stock real', async ({ page }) => {
  await owner(page);
  await workspace(page, 'Clientes');
  const before = await dashboard(page);
  const product = await stockedAccessory(page, 'Métricas', 2);
  const row = await findProduct(page, product.internal_name);
  await expect(kpi(page, 'Total Artículos')).toHaveText('1');
  await expect(kpi(page, 'Stock Bajo')).toHaveText('1');
  await expect(kpi(page, 'Sin Stock')).toHaveText('0');
  await expect(kpi(page, 'Stock vendible a precio de venta')).toHaveText('$2k');
  await capture(page, 'catalogo-tabla-filtrada', { workspaceTop: true });

  const sheet = await editSheet(page, product.internal_name);
  await expect(sheet.getByLabel(/^Nombre \(/)).toHaveValue(product.internal_name);
  await capture(page, 'catalogo-ficha');
  await sheet.getByRole('button', { name: 'Cerrar modal' }).click();

  await row.getByRole('button', { name: 'Cargar stock' }).click();
  const form = page.getByRole('dialog', { name: 'Cargar stock' });
  const confirm = form.getByRole('button', { name: 'Confirmar ingreso' });
  await confirm.click();
  await expect(form.getByRole('alert').filter({ hasText: /cantidad/i })).toBeVisible();
  await capture(page, 'catalogo-cargar-stock-validacion');
  await form.getByLabel('Ubicación de ingreso').selectOption(depotId);
  await form.getByLabel('Cantidad a ingresar').fill('2');
  await form.getByLabel('Costo unitario (ARS)').fill('400');
  await confirm.click();
  await expect(form).toBeHidden();
  await expect(row).toBeVisible();
  await expect(kpi(page, 'Stock Bajo')).toHaveText('0');
  await expect(kpi(page, 'Stock vendible a precio de venta')).toHaveText('$5k');
  expect(balancesOf(product.id)).toMatchObject([{ qty: 4, reserved: 0 }]);
  const after = await dashboard(page);
  expect(after.products_active_count - before.products_active_count).toBe(1);
  expect(after.inventory.sellable_units - before.inventory.sellable_units).toBe(4);
  expect(after.inventory.value_at_sale_price_ars - before.inventory.value_at_sale_price_ars).toBe(4840);
  await capture(page, 'dashboard-kpis-sembrados', { workspaceTop: true });
});

test('clientes: alta, errores dentro del modal, ficha, edición y búsqueda', async ({ page }) => {
  await owner(page);
  await workspace(page, 'Clientes');
  const name = `Cliente contacto QA ${tag()}`;
  await button(page, 'Nuevo cliente').click();
  const create = page.getByRole('dialog', { name: 'Nuevo cliente' });
  await create.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(create.getByText('Ingresá el nombre o razón social.')).toBeVisible();
  await capture(page, 'clientes-alta-validacion');
  await create.getByLabel('Nombre completo o razón social').fill(name);
  await create.getByLabel('Email').fill(`cliente-${tag()}@nictech.test`);
  await create.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(create).toBeHidden();
  const search = page.getByPlaceholder('Buscar cliente...');
  await search.fill(name);
  await button(page, `Abrir ficha de ${name}`).click();
  const detail = page.getByRole('dialog', { name: `Ficha de Cliente: ${name}` });
  await expect(detail.getByText(/DNI: No registrado/)).toBeVisible();
  await capture(page, 'clientes-ficha');
  await detail.getByRole('button', { name: 'Editar datos de contacto' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar datos de contacto' });
  const visibleName = edit.getByLabel('Nombre visible');
  await expect(visibleName).toHaveValue(name);
  await visibleName.clear();
  const save = edit.getByRole('button', { name: 'Guardar cambios' });
  await save.click();
  await expect(edit.getByText('Ingresá el nombre o razón social.')).toBeVisible();
  await capture(page, 'clientes-edicion-validacion');
  await visibleName.fill(`${name} editado`);
  await edit.getByLabel('Teléfono', { exact: true }).fill('1155500041');
  await save.click();
  await expect(edit).toBeHidden();
  await search.fill('1155500041');
  await expect(button(page, `Abrir ficha de ${name} editado`)).toContainText('1155500041');
  expect(sqlRows(`select phone from erp.customers where display_name = ${literal(`${name} editado`)}`))
    .toEqual([{ phone: '1155500041' }]);
});

test('precios y monedas: valida el tipo de cambio y agrega la cotización al historial', async ({ page }) => {
  await owner(page);
  await workspace(page, 'Catálogo y precios');
  await page.getByRole('tab', { name: 'Precios y monedas' }).click();
  await page.getByLabel('Moneda destino').selectOption('USD');
  const form = page.locator('form').filter({ has: page.getByLabel('Moneda destino') });
  const rate = form.getByLabel(/Tipo de cambio a moneda base/);
  await rate.clear();
  const save = form.getByRole('button', { name: 'Registrar tipo de cambio' });
  await save.click();
  await expect(form.getByRole('alert').filter({ hasText: 'El tipo de cambio debe ser mayor que cero.' })).toBeVisible();
  await capture(page, 'precios-cotizacion-validacion');
  const source = `QA USD ${tag()}`;
  await rate.fill('1234');
  await form.getByLabel(/Fuente/).fill(source);
  await form.getByLabel(/Motivo/).fill('Cotización sintética del ERP local');
  await save.click();
  await expect(page.getByRole('row').filter({ hasText: source })).toContainText('1.234');
  await capture(page, 'precios-historial-cotizaciones');
});

test('Fiscal advierte saldo parcial sin IVA de compras; Ayuda abre sus tres vistas', async ({ page }) => {
  await owner(page);
  await setProfile(page, 'completo');
  await workspace(page, 'Contabilidad y análisis');
  await page.getByRole('tab', { name: 'Reportes', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sin compras con IVA registrado' })).toBeVisible();
  await expect(page.getByText('Saldo técnico (sin crédito fiscal de compras)', { exact: true })).toBeVisible();
  await capture(page, 'contabilidad-iva-sin-compras-registradas');

  await button(page, 'Ayuda & Atajos').click();
  const help = page.getByRole('dialog', { name: 'Ayuda y Tutoriales del ERP' });
  await expect(help.getByRole('heading', { name: 'Centro de Ayuda & Tutorial Operativo' })).toBeVisible();
  await help.getByRole('button', { name: 'Tutorial de Módulos' }).click();
  await expect(help.getByPlaceholder('Filtrar módulo...')).toBeVisible();
  await capture(page, 'sistema-ayuda-tutorial');
  await help.getByRole('button', { name: 'Atajos de Teclado' }).click();
  await expect(help.getByRole('heading', { name: 'Atajos de Teclado del Operador' })).toBeVisible();
  await capture(page, 'sistema-ayuda-atajos');
  await help.getByRole('button', { name: 'Manual Completo' }).click();
  await expect(help.getByRole('button', { name: 'Abrir / Descargar Manual en PDF' })).toBeVisible();
  await capture(page, 'sistema-ayuda-manual');
  await help.getByRole('button', { name: 'Cerrar modal' }).click();
  await expect(help).toBeHidden();
});

test('WhatsApp: consentimiento, plantillas y cola local; Auditoría muestra el evento', async ({ page }) => {
  const customerId = randomUUID();
  const conversationId = randomUUID();
  const name = `QA Mensajes ${tag()}`;
  sql(`begin;
    insert into erp.customers(id,organization_id,code,display_name,phone)
      values (${literal(customerId)}, '${organizationId}', 'QA-MSG-${tag()}', ${literal(name)}, '+5491155500042');
    insert into erp.conversations(id,organization_id,branch_id,customer_id,channel)
      values (${literal(conversationId)}, '${organizationId}', '20000000-0000-0000-0000-000000000001', ${literal(customerId)}, 'whatsapp');
    commit;`);
  await owner(page);
  await setProfile(page, 'completo');
  await workspace(page, 'WhatsApp');
  await expect(page.getByText('Encolado real, sin simulación')).toBeVisible();
  await page.getByPlaceholder('Buscar por cliente o teléfono…').fill(name);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Cargando conversación…')).toHaveCount(0);
  const queue = button(page, 'Encolar mensaje');
  await queue.click();
  await expect(page.getByRole('alert')).toContainText('Seleccioná una plantilla y su versión.');
  await page.getByLabel('Plantilla', { exact: true }).selectOption('91200000-0000-0000-0000-000000000002');
  const code = page.getByLabel('order_code', { exact: true });
  await expect(code).toBeVisible();
  await queue.click();
  await expect(page.getByRole('alert')).toContainText('El cliente no tiene consentimiento vigente de WhatsApp.');
  await capture(page, 'whatsapp-cola-sin-consentimiento');

  const consent = button(page, 'Registrar consentimiento');
  await consent.click();
  await expect(page.getByRole('alert')).toContainText('El origen del consentimiento es obligatorio.');
  const reason = `Consentimiento QA ${tag()}`;
  await page.getByLabel('Origen', { exact: true }).fill('Mostrador');
  await page.getByPlaceholder('Ej.: cliente acepta avisos de taller').fill(reason);
  await consent.click();
  await expect(page.getByText(/Consentimiento registrado\. Referencia:/)).toBeVisible();
  await queue.click();
  await expect(page.getByRole('alert')).toContainText('Completá las variables exactas de la plantilla: order_code.');
  await capture(page, 'whatsapp-mensaje-validacion');
  await code.fill(`PED-${tag()}`);
  await page.getByPlaceholder('Ej.: aviso de presupuesto aprobado').fill(`Notificación QA ${tag()}`);
  await queue.click();
  await expect(page.getByText(/Mensaje encolado en estado queued/)).toBeVisible();
  await expect(page.getByText(`Tu pedido PED-${tag()} esta listo para retirar.`, { exact: true })).toBeVisible();
  expect(sqlRows(`select status from erp.communication_message_events e
    join erp.communication_messages m on m.id=e.message_id where m.conversation_id=${literal(conversationId)}`))
    .toEqual([{ status: 'queued' }]);
  await capture(page, 'whatsapp-conversacion-encolada');

  await workspace(page, 'Auditoría');
  await page.getByPlaceholder('Buscar evento o usuario...').fill(reason);
  const row = page.getByRole('row').filter({ hasText: reason });
  await expect(row).toContainText('QA ERP Owner');
  await capture(page, 'auditoria-consentimiento-whatsapp');
});
