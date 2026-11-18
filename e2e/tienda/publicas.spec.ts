import { test, expect, site } from './fixtures';
import { cards, catalogResponse, price, type CatalogProduct } from './storefront';

for (const [path, heading, empty] of [
  ['/promos', 'Promociones Destacadas', 'No hay promociones activas hoy'],
  ['/combos', 'Combos Especiales', 'No hay combos disponibles hoy'],
] as const) {
  test(`06 ${path}: descuentos y fin de vigencia si existe`, async ({ page }, testInfo) => {
    const catalog = page.waitForResponse(catalogResponse);
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    const result = await catalog;
    expect(result.ok()).toBe(true);
    const products = await result.json() as CatalogProduct[];
    const noOffers = page.getByRole('heading', { name: empty, exact: true });
    await expect(cards(page).first().or(noOffers)).toBeVisible();
    if (await noOffers.isVisible()) {
      testInfo.annotations.push({ type: 'datos', description: 'Sin ofertas activas: se verificó el estado vacío.' });
      return;
    }
    let discounts = 0;
    let dates = 0;
    for (const card of await cards(page).all()) {
      const original = card.locator('.line-through');
      if (!(await original.count())) continue;
      discounts++;
      const originalPrice = price(await original.innerText());
      const final = price(await original.locator('+ span').innerText());
      expect(final.currency).toBe(originalPrice.currency);
      expect(final.amount).toBeGreaterThan(0);
      expect(originalPrice.amount).toBeGreaterThan(final.amount);
      const name = await card.getByRole('heading', { level: 3 }).innerText();
      const expiry = products.find((product) => product.name === name)?.sale_expires_at;
      const dateLabel = card.getByText(/Promo válida hasta el/i);
      if (expiry && Date.parse(expiry) > Date.now()) await expect(dateLabel).toBeVisible();
      if (await dateLabel.count()) {
        await expect(dateLabel).toHaveText(/^Promo válida hasta el \d{2}\/\d{2}$/);
        dates++;
      }
    }
    if (path === '/promos') expect(discounts).toBeGreaterThan(0);
    testInfo.annotations.push({ type: 'datos', description: `${discounts} descuentos comparados, ${dates} fechas mostradas.` });
  });
}

test('06 Promos y combos: vigencia de una oferta con fecha', async ({ page, network }) => {
  const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const date = expiry.toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires',
  });
  const product = {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    name: 'Combo QA con vigencia',
    stock: 5,
    price: 12_000,
    original_price: 15_000,
    sale_expires_at: expiry.toISOString(),
    category: { name: 'Combos' },
    product_variants: [],
  };
  network.catalogRead = (url) => {
    if (url.pathname === '/rest/v1/products') return [product];
    if (url.pathname === '/rest/v1/storefront_promotion_prices') return [];
  };
  for (const path of ['/promos', '/combos']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const offer = page.getByRole('button', { name: `Ver detalles de ${product.name}` });
    await expect(offer.locator('.line-through')).toHaveText('$ 15.000');
    await expect(offer.locator('.line-through + span')).toHaveText('$ 12.000');
    await expect(offer.getByText(`Promo válida hasta el ${date}`, { exact: true })).toBeVisible();
  }
});

test('07 Seguimiento: código inexistente no muestra datos', async ({ page, network }) => {
  await page.goto('/seguimiento', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/DNI o código/i).fill('ZZZZ-ZZZZ');
  await page.getByRole('main').getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No se encontró ninguna reparación' })).toBeVisible();
  await expect(page.getByText(/Estado de la Reparación|Observaciones|Datos del cliente/i)).toHaveCount(0);
  expect(network.trackingCalls).toHaveLength(1);
  expect(network.trackingCalls[0].postDataJSON()).toEqual({ search_code: 'ZZZZ-ZZZZ' });
});

test('07 Seguimiento: formato inválido no llama al RPC', async ({ page, network }) => {
  await page.goto('/seguimiento', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/DNI o código/i).fill('x!');
  await page.getByRole('main').getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText('Ingresá un DNI o código de reparación válido', { exact: true })).toBeVisible();
  expect(network.trackingCalls).toHaveLength(0);
});

for (const [path, heading] of [
  ['/servicios', '¿Qué podemos hacer por vos?'],
  ['/contacto', 'Contáctanos'],
  ['/terminos', 'Términos y Condiciones'],
  ['/privacidad', 'Políticas de Privacidad'],
  ['/blog', 'Nuestro Blog'],
] as const) {
  test(`08 ${path}: contenido público en español`, async ({ page }) => {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', /^es\b/);
  });
}

test('08 Página inexistente: 404 en español', async ({ page }) => {
  await page.goto('/__e2e__/pagina-inexistente', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
  await expect(page.getByText('Error 404', { exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('09 SEO: sitemap y robots responden 200 y usan el dominio canónico', async ({ page }) => {
  const robots = await page.goto('/robots.txt');
  expect(robots?.status()).toBe(200);
  expect(await robots!.text()).toContain(`Sitemap: ${site}/sitemap.xml`);
  expect(robots!.headers()['content-type']).toContain('text/plain');
  const sitemap = await page.goto('/sitemap.xml');
  expect(sitemap?.status()).toBe(200);
  expect(sitemap!.headers()['content-type']).toContain('xml');
  const contents = await sitemap!.text();
  const locations = [...contents.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((match) => new URL(match[1]));
  expect(locations.length).toBeGreaterThan(0);
  expect(locations.every((url) => url.origin === site)).toBe(true);
});
