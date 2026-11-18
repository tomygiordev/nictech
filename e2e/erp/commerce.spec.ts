import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, owner, workspace, tag, button, setProfile } from './fixtures';
import { balancesOf, catalog, depotId, stockedAccessory, type Product } from './catalog-fixtures';
import { literal, sqlRows } from './local';
import { addPromotion } from './promotion-fixtures';

async function sell(page: Page, product: Product, method: 'Efectivo' | 'Tarjeta', remaining: number, promo?: { list: string; price: string }) {
  await workspace(page, 'Punto de venta');
  await page.getByLabel('Ubicación de salida').selectOption(depotId);
  await page.getByPlaceholder(/Escanear código de barras/).fill(product.internal_name);
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
  await expect(page.getByText(/Venta completada.*Comprobante no fiscal/)).toBeVisible();
  await expect(button(page, 'Imprimir comprobante')).toBeEnabled();
}

const paymentsFor = (productId: string) => sqlRows(`select pm.code,p.amount from erp.payments p
    join erp.payment_methods pm on pm.id=p.payment_method_id
    join erp.sale_lines sl on sl.sale_id=p.sale_id where sl.product_id=${literal(productId)} order by pm.code`);

test('compra aprobada y recepcionada: saldo físico y costo en el ledger', async ({ page }) => {
  await owner(page);
  await setProfile(page, 'completo');
  const product = await stockedAccessory(page, 'Compras', 2);
  const supplier = `Proveedor QA ${tag()}`;
  await workspace(page, 'Compras y proveedores');
  await page.getByRole('tab', { name: 'Proveedores', exact: true }).click();
  await button(page, 'Nuevo Proveedor').click();
  const supplierForm = page.getByRole('dialog', { name: 'Registrar Nuevo Proveedor' });
  await supplierForm.getByLabel(/Razón Social/).fill(supplier);
  await supplierForm.locator('button[type=submit]').click();
  await expect(supplierForm).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: supplier })).toBeVisible();

  await page.getByRole('tab', { name: 'Compras', exact: true }).click();
  await button(page, 'Nueva Orden (PO)').click();
  const order = page.getByRole('dialog', { name: 'Emitir Orden de Compra Estructurada (PO)' });
  const suppliers = order.getByLabel('Proveedor *');
  await suppliers.selectOption(await suppliers.getByRole('option', { name: new RegExp(`^${supplier} \\(`) }).getAttribute('value') ?? '');
  await order.getByLabel(/Motivo.*Compra/).fill(`Compra E2E ${tag()}`);
  const pick = order.getByRole('combobox').filter({ has: page.locator(`option[value="${product.id}"]`) });
  await pick.selectOption(product.id);
  await order.getByPlaceholder('Cant.').fill('3');
  await order.getByPlaceholder('Costo u.').fill('650');
  await order.getByRole('button', { name: 'Emitir Orden de Compra' }).click();
  await expect(order).toBeHidden();
  const row = page.getByRole('row').filter({ hasText: supplier });
  await row.getByRole('button', { name: 'Aprobar' }).click();
  await row.getByRole('button', { name: 'Recepcionar' }).click();
  const receipt = page.getByRole('dialog', { name: /Recepcionar Mercadería/ });
  await receipt.getByLabel(/Ubicación.*Destino/).selectOption(depotId);
  await receipt.getByLabel(/Nº de Remito/).fill(`REM-QA-${tag()}`);
  await receipt.getByRole('spinbutton').fill('3');
  await receipt.getByRole('button', { name: 'Confirmar Recepción' }).click();
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
  await workspace(page, 'Caja');
  await button(page, 'Abrir Nueva Caja').click();
  const opening = page.getByRole('dialog', { name: 'Apertura de Turno de Caja' });
  const reason = `Caja QA ${tag()}`;
  await opening.getByRole('textbox').nth(0).fill('QA ERP Owner');
  await opening.getByRole('spinbutton').fill('5000');
  await opening.getByRole('textbox').nth(1).fill(reason);
  await opening.getByRole('button', { name: 'Abrir Turno' }).click();
  await expect(opening).toBeHidden();
  const [{ id: sessionId }] = sqlRows<{ id: string }>(`select id from erp.cash_sessions where reason=${literal(reason)}`);

  await button(page, 'Ingreso / Egreso').click();
  const movement = page.getByRole('dialog', { name: 'Registrar ingreso o egreso manual' });
  await movement.getByPlaceholder('0,00').fill('50');
  await movement.getByPlaceholder('Detallá el origen o destino del efectivo').fill(`Aporte QA ${tag()}`);
  await movement.getByRole('button', { name: 'Registrar movimiento' }).click();
  await expect(movement).toBeHidden();
  expect(sqlRows(`select kind,amount from erp.cash_movements where cash_session_id=${literal(sessionId)} and amount=50`))
    .toEqual([{ kind: 'contribution', amount: 50 }]);

  await sell(page, product, 'Efectivo', 9);
  await workspace(page, 'Caja');
  await sell(page, product, 'Tarjeta', 8);
  expect(paymentsFor(product.id)).toEqual([{ code: 'CARD', amount: 1210 }, { code: 'CASH', amount: 1210 }]);

  await workspace(page, 'Caja');
  await button(page, 'Arqueo & Cierre').click();
  const closing = page.getByRole('dialog', { name: 'Arqueo y Cierre de Turno de Caja' });
  const counted = closing.getByPlaceholder('0', { exact: true });
  await counted.click();
  await counted.press('Control+A');
  await counted.pressSequentially('6260');
  await expect(counted).toHaveValue('6260');
  await closing.getByRole('button', { name: 'Confirmar Arqueo y Cerrar' }).click();
  await expect(closing).toBeHidden();
  await expect(page.getByText(/Arqueo y cierre completado/)).toBeVisible();
  expect(sqlRows(`select c.expected_amount,c.counted_amount,c.difference_amount from erp.cash_close_counts c
    join erp.cash_closures cl on cl.id=c.cash_closure_id where cl.cash_session_id=${literal(sessionId)} and c.currency_code='ARS'`))
    .toEqual([{ expected_amount: 6260, counted_amount: 6260, difference_amount: 0 }]);
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
