import type { Page } from '@playwright/test';
import { expect, workspace, button, tag, capture } from './fixtures';
import { literal, sqlRows } from './local';

export const depotId = '30000000-0000-0000-0000-000000000001';
const brandId = 'e2000000-0000-0000-0000-000000000003';
const modelId = 'e2000000-0000-0000-0000-000000000004';
const phoneCategory = 'e2000000-0000-0000-0000-000000000001';
const accessoryCategory = 'e2000000-0000-0000-0000-000000000002';
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=', 'base64');

export type Product = {
  id: string; internal_code: string; internal_name: string; sheet_template: string;
  internal_description: string; public_description: string; web_status: string;
};

export const catalog = (page: Page) => workspace(page, 'Catálogo y precios');
export const productRow = (page: Page, name: string) => page.getByRole('row').filter({
  has: page.getByRole('cell', { name: new RegExp(name) }),
});
export const productInDb = (name: string) =>
  sqlRows<Product>(`select id, internal_code, internal_name, sheet_template, internal_description,
    public_description, web_status from erp.products where internal_name = ${literal(name)}`)[0];

export const balancesOf = (productId: string) => sqlRows<{ location_id: string; variant_id: string | null; qty: number; reserved: number }>(
  `select location_id, variant_id, quantity_on_hand as qty, quantity_reserved as reserved
    from erp.stock_balances where product_id = ${literal(productId)} order by location_id, variant_id`);

export async function findProduct(page: Page, name: string) {
  await page.getByPlaceholder('Buscar por código o nombre...').fill(name);
  const row = productRow(page, name);
  await expect(row).toBeVisible();
  return row;
}

export async function createSheet(page: Page, name: string, template: 'celular' | 'accesorio', colors: { name: string; qty: number; own?: number }[], checkValidation = false) {
  await catalog(page);
  await button(page, 'Nuevo Producto').click();
  const sheet = page.getByRole('dialog', { name: 'Nuevo producto' });
  const save = sheet.getByRole('button', { name: 'Guardar ficha' });
  if (checkValidation) {
    await save.click();
    await expect(sheet.getByRole('alert').filter({ hasText: 'Elegí una categoría.' })).toBeVisible();
    await capture(page, 'catalogo-alta-validacion');
  }
  await sheet.getByLabel(/^Tipo \(/).selectOption(template);
  await sheet.getByLabel('Categoría').selectOption(template === 'celular' ? phoneCategory : accessoryCategory);
  await sheet.getByLabel('Marca').selectOption(brandId);
  if (template === 'celular') {
    await sheet.getByLabel(/^Modelo \(/).selectOption(modelId);
    await sheet.getByLabel('Capacidad').fill('128 GB');
    await sheet.getByLabel('Condición').selectOption('nuevo');
  }
  await sheet.getByLabel(/^Nombre \(/).fill(name);
  await sheet.getByLabel('Costo estimado ARS').fill('400');
  await sheet.getByLabel('Precio final ARS con IVA incluido').fill('1210');
  await sheet.getByLabel('Descripción interna (no se publica)').fill(`Uso interno ${name}`);
  await sheet.getByLabel('Descripción web').fill(`Descripción pública ${name}`);
  for (const color of colors) {
    await sheet.getByLabel('Crear color nuevo').fill(color.name);
    await sheet.getByRole('button', { name: 'Crear color', exact: true }).click();
    await expect(sheet.getByLabel('Crear color nuevo')).toHaveValue('');
    await sheet.getByRole('button', { name: 'Agregar color', exact: true }).click();
    const quantity = sheet.getByLabel(`Cantidad inicial ${color.name}`);
    await quantity.click();
    await quantity.pressSequentially(String(color.qty));
    await expect(quantity).toHaveValue(String(color.qty));
    await sheet.getByLabel(`Ubicación inicial ${color.name}`).selectOption(depotId);
    await sheet.getByLabel(`Costo unitario inicial ${color.name}`).fill('400');
    if (color.own) {
      await sheet.getByLabel(`Precio ${color.name}`, { exact: true }).selectOption('own');
      await sheet.getByLabel(`Precio propio ${color.name}`).fill(String(color.own));
    }
  }
  await sheet.getByLabel('Agregar fotos').setInputFiles({ name: 'qa.png', mimeType: 'image/png', buffer: photo });
  await save.click();
  await expect(sheet).toBeHidden();
  await expect(await findProduct(page, name)).toContainText('Borrador');
  const product = productInDb(name);
  expect(product).toBeDefined();
  const quantities = sqlRows<{ name: string; qty: number }>(`select v.name,b.quantity_on_hand as qty
    from erp.stock_balances b join erp.product_variants v on v.id=b.variant_id
    where b.product_id=${literal(product.id)} and b.location_id='${depotId}' order by v.name`);
  expect(quantities).toEqual(colors.map(({ name: colorName, qty }) => ({ name: colorName, qty }))
    .sort((a, b) => a.name.localeCompare(b.name)));
  return product;
}

export async function editSheet(page: Page, name: string) {
  await (await findProduct(page, name)).getByRole('button', { name: 'Ficha', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Ficha de producto' });
  await expect(sheet.getByText('Cargando ficha…')).toHaveCount(0);
  return sheet;
}

export async function publishSheet(page: Page, name: string) {
  const sheet = await editSheet(page, name);
  await sheet.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(productRow(page, name)).toContainText('Publicado');
}

export async function stockedAccessory(page: Page, scope: string, qty = 12) {
  const name = `QA ${scope} ${tag()}`;
  return createSheet(page, name, 'accesorio', [{ name: `QA ${scope} Color ${tag()}`, qty }]);
}
