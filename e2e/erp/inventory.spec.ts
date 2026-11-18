import { test, expect, owner, workspace, tag } from './fixtures';
import { balancesOf, depotId, findProduct, publishSheet, stockedAccessory } from './catalog-fixtures';
import { literal, sqlRows } from './local';
import { addPromotion } from './promotion-fixtures';

test('ingreso, ajuste y transferencia concilian el saldo por ubicación', async ({ page }) => {
  await owner(page);
  const product = await stockedAccessory(page, 'Movimientos', 12);
  const { internal_name: name, id } = product;
  await (await findProduct(page, name)).getByRole('button', { name: 'Stock', exact: true }).click();
  const intake = page.getByRole('dialog', { name: 'Carga Formal de Stock' });
  await intake.getByLabel(/Ubicación.*Ingreso/).selectOption(depotId);
  await intake.getByLabel(/Cantidad a Ingresar/).fill('4');
  await intake.getByLabel(/Costo Unitario/).fill('500');
  await intake.getByLabel(/Motivo de Auditoría/).fill(`Ingreso QA ${tag()}`);
  await intake.getByRole('button', { name: 'Confirmar Ingreso' }).click();
  await expect(intake).toBeHidden();
  expect(balancesOf(id)).toMatchObject([{ location_id: depotId, qty: 16, reserved: 0 }]);

  await workspace(page, 'Stock y almacén');
  const source = page.getByRole('row').filter({ hasText: name }).filter({ hasText: '16 u.' });
  await expect(source).toBeVisible();
  await source.getByRole('button', { name: 'Ajustar', exact: true }).click();
  const adjust = page.getByRole('dialog', { name: 'Registrar Movimiento en Ledger de Stock' });
  await adjust.getByLabel(/Sentido del Movimiento/).selectOption('out');
  await adjust.getByLabel(/Cantidad/).fill('2');
  await adjust.getByLabel(/Motivo de Auditoría/).fill(`Ajuste QA ${tag()}`);
  await adjust.getByRole('button', { name: 'Confirmar Movimiento' }).click();
  await expect(adjust).toBeHidden();
  expect(balancesOf(id)).toMatchObject([{ location_id: depotId, qty: 14, reserved: 0 }]);

  await page.getByRole('row').filter({ hasText: name }).filter({ hasText: '14 u.' })
    .getByRole('button', { name: 'Transferir', exact: true }).click();
  const transfer = page.getByRole('dialog', { name: 'Transferir stock entre ubicaciones' });
  const destination = transfer.getByLabel('Destino *');
  const toId = await destination.inputValue();
  expect(toId).toBeTruthy();
  expect(toId).not.toBe(depotId);
  await transfer.getByLabel(/Cantidad/).fill('3');
  await transfer.getByLabel(/Motivo de auditoría/i).fill(`Transferencia QA ${tag()}`);
  await transfer.getByRole('button', { name: 'Confirmar transferencia' }).click();
  await expect(transfer).toBeHidden();
  await expect(page.getByText(/Transferencia registrada: 3 u/)).toBeVisible();
  const balances = balancesOf(id);
  expect(balances).toHaveLength(2);
  expect(balances).toEqual(expect.arrayContaining([
    expect.objectContaining({ location_id: depotId, qty: 11, reserved: 0 }),
    expect.objectContaining({ location_id: toId, qty: 3, reserved: 0 }),
  ]));
});

test('promos porcentual y fija cambian el precio web durante la vigencia', async ({ page }) => {
  await owner(page);
  const product = await stockedAccessory(page, 'Promos');
  await publishSheet(page, product.internal_name);
  await page.getByRole('tab', { name: 'Precios y monedas' }).click();
  await expect(page.getByRole('heading', { name: 'Promociones' })).toBeVisible();

  const effective = () => sqlRows<{ list_price: number; effective_price: number; promotion_id: string | null }>(`
    select list_price, effective_price, promotion_id from public.storefront_promotion_prices
    where product_id=${literal(product.id)} and variant_id is null`)[0];
  expect(effective()).toEqual({ list_price: 1210, effective_price: 1210, promotion_id: null });
  for (const promo of [
    { kind: 'porcentaje', name: `QA Porcentaje ${tag()}`, value: '10', price: 1089 },
    { kind: 'precio_fijo', name: `QA Precio fijo ${tag()}`, value: '990', price: 990 },
  ] as const) {
    const row = await addPromotion(page, product.internal_name, { ...promo, channel: 'Web', active: false });
    await expect(row).toContainText('Inactiva');
    expect(effective().effective_price).toBe(1210);
    await row.getByRole('button', { name: 'Activar', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Desactivar' })).toBeVisible();
    expect(effective()).toMatchObject({ list_price: 1210, effective_price: promo.price, promotion_id: expect.any(String) });
    await row.getByRole('button', { name: 'Desactivar', exact: true }).click();
    await expect(row).toContainText('Inactiva');
    expect(effective()).toEqual({ list_price: 1210, effective_price: 1210, promotion_id: null });
  }
});
