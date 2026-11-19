import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, owner, workspace, tag, button, setProfile, capture } from './fixtures';
import { balancesOf, catalog, depotId, stockedAccessory, type Product } from './catalog-fixtures';
import { literal, sqlRows } from './local';
import { addPromotion } from './promotion-fixtures';

async function sell(page: Page, product: Product, method: 'Efectivo' | 'Tarjeta', remaining: number, promo?: { list: string; price: string }) {
  await workspace(page, 'Punto de venta');
  await page.getByLabel('Ubicación de salida').selectOption(depotId);
  await page.getByRole('textbox', { name: 'Buscar productos por código de barras o nombre' }).fill(product.internal_name);
  const variantName = product.internal_name.replace(` ${tag()}`, ` Color ${tag()}`);
  await page.getByTitle(new RegExp(`Agregar variante ${variantName}`)).click();
  if (promo) {
    const cart = page.getByRole('group', { name: 'Artículos del carrito' });
    await expect(cart.locator('del')).toHaveText(promo.list);
    await expect(cart.getByText(promo.price, { exact: true })).toBeVisible();
  }
  await page.getByLabel('Tipo de comprobante').selectOption('non_fiscal');
  await button(page, method).click();
  await button(page, 'Cobrar y Emitir Comprobante').click();
  await expect.poll(() => balancesOf(product.id)[0]?.qty).toBe(remaining);
  await expect(page.getByText(/Comprobante no fiscal:/)).toBeVisible();
  await expect(button(page, 'Imprimir comprobante')).toBeEnabled();
}

const paymentsFor = (productId: string) => sqlRows(`select pm.code,p.amount from erp.payments p
    join erp.payment_methods pm on pm.id=p.payment_method_id
    join erp.sale_lines sl on sl.sale_id=p.sale_id where sl.product_id=${literal(productId)} order by pm.code`);

async function openTill(page: Page, reason: string, amount: number, checkValidation: boolean) {
  await workspace(page, 'Caja');
  await button(page, 'Abrir nueva caja').click();
  const opening = page.getByRole('dialog', { name: 'Abrir turno de caja' });
  const fund = opening.getByLabel('Fondo inicial en efectivo (ARS)');
  const submit = opening.getByRole('button', { name: 'Abrir turno' });
  if (checkValidation) {
    await fund.clear();
    await submit.click();
    await expect(opening.getByRole('alert')).toContainText('Ingresá el fondo inicial.');
    await capture(page, 'caja-apertura-validacion');
  }
  await expect(opening.getByLabel('Operador')).not.toBeEditable();
  await fund.fill(String(amount));
  await opening.getByLabel('Observaciones del turno').fill(reason);
  await submit.click();
  await expect(opening).toBeHidden();
  const [{ id }] = sqlRows<{ id: string }>(`select id from erp.cash_sessions where reason=${literal(reason)}`);
  await expect(page.getByText(`#${id.slice(0, 8).toUpperCase()}`, { exact: true })).toBeVisible();
  return id;
}

async function countTill(page: Page, sessionId: string, counted: number, difference: number) {
  const row = page.getByRole('row').filter({ hasText: sessionId.slice(0, 8).toUpperCase() });
  await expect(row).toContainText('Se revela al cerrar');
  await row.getByRole('button', { name: 'Arqueo y cierre' }).click();
  const dialog = page.getByRole('dialog', { name: 'Arqueo y cierre de caja' });
  const count = dialog.getByLabel('Efectivo contado (ARS)');
  const review = dialog.getByRole('button', { name: 'Ver resultado' });
  await expect(dialog.getByText('Total teórico esperado')).toHaveCount(0);
  await review.click();
  await expect(dialog.getByRole('alert')).toContainText('Ingresá el efectivo contado.');
  if (difference === 0) await capture(page, 'caja-arqueo-ciego-validacion');
  await count.fill(String(counted));
  await review.click();
  await expect(dialog.getByText('Total teórico esperado')).toBeVisible();
  await expect(dialog.getByText(difference === 0 ? 'Sin diferencia' : /Faltante de/)).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Cerrar turno' });
  if (difference !== 0) {
    await close.click();
    await expect(dialog.getByRole('alert')).toContainText(/diferencia/i);
    await dialog.getByLabel('Motivo del cierre').fill('Diferencia detectada durante el conteo.');
  }
  await capture(page, difference === 0 ? 'caja-arqueo-sin-diferencia' : 'caja-arqueo-con-diferencia');
  await close.click();
  const confirm = page.getByRole('dialog', { name: /^Cerrar turno/ });
  await confirm.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect(confirm).toBeHidden();
  await expect(row).toHaveCount(0);
  expect(sqlRows(`select c.expected_amount,c.counted_amount,c.difference_amount from erp.cash_close_counts c
    join erp.cash_closures cl on cl.id=c.cash_closure_id where cl.cash_session_id=${literal(sessionId)} and c.currency_code='ARS'`))
    .toEqual([{ expected_amount: counted - difference, counted_amount: counted, difference_amount: difference }]);
}

test('compra aprobada y recepcionada: saldo físico y costo en el ledger', async ({ page }) => {
  await owner(page);
  await setProfile(page, 'completo');
  const product = await stockedAccessory(page, 'Compras', 2);
  const supplier = `Proveedor QA ${tag()}`;
  await workspace(page, 'Compras y proveedores');
  await page.getByRole('tab', { name: 'Proveedores', exact: true }).click();
  await button(page, 'Nuevo proveedor').click();
  const supplierForm = page.getByRole('dialog', { name: 'Registrar proveedor' });
  await supplierForm.locator('button[type=submit]').click();
  await expect(supplierForm.getByRole('alert')).toHaveText('Ingresá al menos 2 caracteres.');
  await capture(page, 'compras-proveedor-validacion');
  await supplierForm.getByLabel('Razón social o nombre').fill(supplier);
  await supplierForm.locator('button[type=submit]').click();
  await expect(supplierForm).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: supplier })).toBeVisible();

  await page.getByRole('tab', { name: 'Compras', exact: true }).click();
  await button(page, 'Nueva orden de compra').click();
  const order = page.getByRole('dialog', { name: 'Nueva orden de compra' });
  const emit = order.getByRole('button', { name: 'Emitir orden de compra' });
  await emit.click();
  await expect(order.getByRole('alert').filter({ hasText: /proveedor/i })).toBeVisible();
  await capture(page, 'compras-orden-validacion');
  const suppliers = order.getByLabel('Proveedor');
  await suppliers.selectOption(await suppliers.getByRole('option', { name: new RegExp(`^${supplier} \\(`) }).getAttribute('value') ?? '');
  await order.getByLabel('Sucursal').selectOption('20000000-0000-0000-0000-000000000001');
  await order.getByLabel('Motivo de la compra').fill(`Compra E2E ${tag()}`);
  await order.getByLabel('Producto').selectOption(product.id);
  const variant = balancesOf(product.id)[0].variant_id;
  if (!variant) throw new Error('Falta la variante del producto de compras.');
  await order.getByLabel('Variante').selectOption(variant);
  await order.getByLabel('Cantidad').fill('3');
  await order.getByLabel('Costo unitario ($)').fill('650');
  await emit.click();
  await expect(order).toBeHidden();
  const row = page.getByRole('row').filter({ hasText: supplier });
  await row.getByRole('button', { name: 'Aprobar' }).click();
  const approval = page.getByRole('dialog', { name: 'Aprobar orden de compra' });
  await capture(page, 'compras-aprobar-orden');
  await approval.getByRole('button', { name: 'Aprobar orden' }).click();
  await row.getByRole('button', { name: 'Recepcionar' }).click();
  const receipt = page.getByRole('dialog', { name: /Recibir mercadería/i });
  await receipt.getByLabel('Ubicación de destino').selectOption(depotId);
  await receipt.getByLabel('Remito o factura del proveedor').fill(`REM-QA-${tag()}`);
  await receipt.getByRole('spinbutton').fill('3');
  await receipt.getByRole('button', { name: 'Confirmar recepción' }).click();
  await expect(receipt).toBeHidden();
  await expect(row.getByRole('button', { name: 'Recepcionar' })).toHaveCount(0);
  expect(balancesOf(product.id)).toMatchObject([{ location_id: depotId, qty: 5 }]);
  expect(sqlRows(`select quantity_delta,unit_cost_snapshot,value_delta_base from erp.stock_cost_movements
    where product_id=${literal(product.id)} and purchase_cost_entry_id is not null order by id desc limit 1`))
    .toEqual([{ quantity_delta: 3, unit_cost_snapshot: 650, value_delta_base: 1950 }]);
});

test('POS efectivo y tarjeta: comprobantes, stock y arqueo de caja', async ({ page }) => {
  await owner(page);
  const product = await stockedAccessory(page, 'POS', 10);
  const sessionId = await openTill(page, `Caja QA ${tag()}`, 5000, true);

  await button(page, 'Ingreso o egreso').click();
  const movement = page.getByRole('dialog', { name: 'Registrar ingreso o egreso manual' });
  const postMovement = movement.getByRole('button', { name: 'Registrar movimiento' });
  await movement.getByLabel('Importe').clear();
  await postMovement.click();
  await expect(movement.getByRole('alert')).toContainText(/importe/i);
  await capture(page, 'caja-movimiento-validacion');
  await movement.getByLabel('Importe').fill('50');
  await movement.getByLabel('Motivo o comprobante').fill(`Aporte QA ${tag()}`);
  await postMovement.click();
  await expect(movement).toBeHidden();
  expect(sqlRows(`select kind,amount from erp.cash_movements where cash_session_id=${literal(sessionId)} and amount=50`))
    .toEqual([{ kind: 'contribution', amount: 50 }]);

  await sell(page, product, 'Efectivo', 9);
  await workspace(page, 'Caja');
  await sell(page, product, 'Tarjeta', 8);
  expect(paymentsFor(product.id)).toEqual([{ code: 'CARD', amount: 1210 }, { code: 'CASH', amount: 1210 }]);

  await workspace(page, 'Caja');
  await countTill(page, sessionId, 6260, 0);

  const documents = sqlRows<{ document_number: string }>(`select d.document_number from erp.documents d
    join erp.sale_lines sl on sl.sale_id=d.owner_id where d.owner_type='sale' and sl.product_id=${literal(product.id)}
    order by d.issued_at desc`);
  expect(documents).toHaveLength(2);
  const [{ document_number: documentNumber }] = documents;
  await workspace(page, 'Documentos y facturas');
  await page.getByPlaceholder('Buscar por nro, cliente o CUIT…').fill(documentNumber);
  await button(page, `Abrir documento ${documentNumber}`).click();
  const document = page.getByRole('dialog', { name: documentNumber });
  await expect(document).toContainText('Comprobante no fiscal');
  await expect(document).toContainText('Pagado');
  await expect(document.getByRole('button', { name: 'Reimprimir comprobante' })).toBeEnabled();
  await capture(page, 'documentos-comprobante-pos');
  await document.getByRole('button', { name: 'Cerrar modal' }).click();
  await button(page, 'Registrar documento').click();
  const register = page.getByRole('dialog', { name: 'Registrar documento' });
  await register.getByRole('button', { name: 'Registrar documento' }).click();
  await expect(register.getByRole('alert')).toHaveText('El nombre del cliente es obligatorio.');
  await capture(page, 'documentos-registro-validacion');
  await register.getByRole('button', { name: 'Cancelar' }).click();
});

test('caja: arqueo ciego con faltante, motivo obligatorio y cierre trazable', async ({ page }) => {
  await owner(page);
  const id = await openTill(page, `Caja QA Diferencia ${tag()}`, 3000, false);
  await countTill(page, id, 2980, -20);
  await button(page, /^Historial de arqueos/).click();
  await expect(page.getByRole('row').filter({ hasText: id.slice(0, 8).toUpperCase() })).toBeVisible();
  await capture(page, 'caja-historial-arqueos');
});

test('POS cobra el descuento del 10 % cuando la promoción está vigente', async ({ page }) => {
  await owner(page);
  const product = await stockedAccessory(page, 'POS descuento', 3);
  await catalog(page);
  await page.getByRole('tab', { name: 'Precios y monedas' }).click();
  const promo = await addPromotion(page, product.internal_name, {
    name: `QA Descuento POS ${tag()}`, kind: 'porcentaje', value: '10', channel: 'POS', active: true,
  });
  await expect(promo.getByRole('button', { name: 'Desactivar' })).toBeVisible();
  await sell(page, product, 'Tarjeta', 2, { list: 'ARS 1.210,00', price: 'ARS 1.089,00' });
  expect(paymentsFor(product.id), 'Una promo POS activa de 10 % debe cobrar ARS 1.089, no el precio de lista').toEqual([
    { code: 'CARD', amount: 1089 },
  ]);
});

test('reportes y descarga del Libro IVA Ventas en CSV', async ({ page }) => {
  await owner(page);
  await setProfile(page, 'completo');
  await workspace(page, 'Contabilidad y análisis');
  await page.getByRole('tab', { name: 'Reportes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Libro IVA Ventas por Alícuota' })).toBeVisible();
  const iva = page.locator('.flow-card').filter({ has: page.getByRole('heading', { name: 'Libro IVA Ventas por Alícuota' }) });
  await iva.getByRole('button', { name: 'Exportar CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Exportación oficial' });
  await dialog.getByRole('textbox').fill(`Verificación E2E de IVA ${tag()}`);
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Autorizar y descargar' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('libro_iva_ventas.csv');
  const path = await download.path();
  const csv = await readFile(path, 'utf8');
  expect(csv.trim().split(/\r?\n/).length).toBeGreaterThan(1);
  expect(await download.failure()).toBeNull();
});
