import { test, expect, owner, tag } from './fixtures';
import { literal, sql, sqlRows, apiUrl } from './local';
import { balancesOf, createSheet, editSheet, findProduct, productInDb, productRow, publishSheet } from './catalog-fixtures';

test('ficha celular con colores, stock y foto, edición, código y proyección web', async ({ page }) => {
  await owner(page);
  const name = `QA Celular ${tag()}`;
  const inherited = `QA Negro ${tag()}`;
  const own = `QA Blanco ${tag()}`;
  const product = await createSheet(page, name, 'celular', [
    { name: inherited, qty: 5 }, { name: own, qty: 7, own: 1500 },
  ]);
  expect(product).toMatchObject({
    sheet_template: 'celular', internal_description: `Uso interno ${name}`,
    public_description: `Descripción pública ${name}`, web_status: 'draft',
  });
  expect(product.internal_code).not.toBe('');

  const variants = sqlRows<{ id: string; name: string; final_price_ars: number | null }>(`select id,name,final_price_ars
    from erp.product_variants where product_id=${literal(product.id)} order by name`);
  expect(variants.map(({ name: color, final_price_ars }) => [color, final_price_ars])).toEqual([[own, 1500], [inherited, null]]);
  expect(balancesOf(product.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ variant_id: variants[0].id, qty: 7, reserved: 0 }),
    expect.objectContaining({ variant_id: variants[1].id, qty: 5, reserved: 0 }),
  ]));

  const sheet = await editSheet(page, name);
  await expect(sheet.getByLabel('Descripción interna (no se publica)')).toHaveValue(`Uso interno ${name}`);
  await sheet.getByLabel('Descripción web').fill(`Web editada ${name}`);
  await sheet.getByRole('button', { name: 'Guardar ficha' }).click();
  await expect(sheet).toBeHidden();
  const edit = await editSheet(page, name);
  const code = `QA-${tag()}`;
  await edit.getByLabel('Nuevo código').fill(code);
  await edit.getByRole('button', { name: 'Recodificar', exact: true }).click();
  await page.getByRole('dialog', { name: 'Recodificar producto' }).getByRole('button', { name: 'Recodificar' }).click();
  await expect(edit).toBeHidden();
  await expect(productRow(page, name)).toContainText(code);
  expect(productInDb(name).internal_code).toBe(code);

  await publishSheet(page, name);
  const projection = () => sqlRows<{ name: string; description: string; is_active: boolean; price: number; stock: number; image_url: string }>(
    `select name,description,is_active,price,stock,image_url from public.products where id=${literal(product.id)}`)[0];
  expect(projection()).toMatchObject({ name, description: `Web editada ${name}`, is_active: true, price: 1210, stock: 12 });
  const photo = new URL(projection().image_url);
  expect(photo.origin).toBe(apiUrl().origin);
  const image = await page.request.get(photo.href, { maxRedirects: 0 });
  expect(image.ok()).toBe(true);
  expect(image.headers()['content-type']).toContain('image/png');
  expect(sqlRows(`select o.bucket_id from storage.objects o join erp.product_media m
    on right(m.storage_path, length(o.name)) = o.name
    where m.product_id = ${literal(product.id)} and m.is_active and m.is_primary`)).toEqual([{ bucket_id: 'product_images' }]);
  expect(sqlRows(`select variant_id,effective_price from public.storefront_promotion_prices
    where product_id=${literal(product.id)}`)).toEqual(expect.arrayContaining([
    { variant_id: null, effective_price: 1210 },
    { variant_id: variants[0].id, effective_price: 1500 },
    { variant_id: variants[1].id, effective_price: 1210 },
  ]));

  const published = await editSheet(page, name);
  await published.getByRole('button', { name: 'Pausar' }).click();
  await expect(published).toBeHidden();
  await expect(productRow(page, name)).toContainText('Pausado');
  expect(projection().is_active).toBe(false);
});

test('ficha accesorio y filtro de artículos inactivos', async ({ page }) => {
  await owner(page);
  const name = `QA Accesorio ${tag()}`;
  const product = await createSheet(page, name, 'accesorio', []);
  expect(product.sheet_template).toBe('accesorio');
  await expect(await findProduct(page, name)).toContainText('Borrador');
  sql(`update erp.products set is_active=false where id=${literal(product.id)};`);
  await page.getByRole('button', { name: 'Recargar catálogo' }).click();
  await expect(productRow(page, name)).toHaveCount(0);
  await page.getByLabel('Ver inactivos').check();
  await expect(productRow(page, name)).toContainText('Inactivo');
});
