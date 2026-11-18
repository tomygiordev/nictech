import { test, expect, site, supabaseHost } from './fixtures';
import { cards, details, openCatalog, openDetails, openVariantCatalog, price, search, selectColor, uuidPattern } from './storefront';

test('01 Home: navegación principal', async ({ page, isMobile }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: /Nictech/i })).toBeVisible();
  for (const [name, path, heading] of [
    ['Tienda', '/tienda', /Nictech/i],
    ['Servicios', '/servicios', /Qué podemos hacer/i],
    ['Seguimiento', '/seguimiento', /Consulta tu Reparación/i],
    ['Contacto', '/contacto', /Contáctanos/i],
    ['Promos', '/promos', /Promociones/i],
    ['Combos', '/combos', /Combos/i],
  ] as const) {
    if (isMobile) await page.getByRole('button', { name: 'Menú' }).click();
    const nav = isMobile ? page.getByRole('dialog') : page.getByRole('navigation').first();
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Nictech Logo' }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test('02 Tienda: catálogo, imágenes y cargar más', async ({ page }, testInfo) => {
  await openCatalog(page);
  const found = page.getByText(/^\d+ productos? encontrados?$/);
  const total = Number((await found.innerText()).split(' ')[0]);
  const initial = await cards(page).count();
  expect(initial).toBeGreaterThan(0);
  const more = page.getByRole('button', { name: /Cargar más productos/i });
  if (initial < total) {
    await more.click();
    await expect.poll(() => cards(page).count()).toBeGreaterThan(initial);
  } else {
    await expect(more).toHaveCount(0);
    testInfo.annotations.push({ type: 'catálogo', description: 'Todos los productos caben en la primera página.' });
  }

  const images = page.getByRole('main').locator('img:visible');
  expect(await images.count()).toBeGreaterThan(0);
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => ({
      loaded: node.complete && node.naturalWidth > 0,
      host: new URL(node.currentSrc || node.src).hostname,
    })), { message: `Imagen: ${await image.getAttribute('alt')}` }).toEqual({ loaded: true, host: supabaseHost });
  }
});

test('02 Tienda: categoría y búsqueda positiva/negativa', async ({ page, isMobile }) => {
  const products = await openCatalog(page);
  const category = products.find((product) => product.category && !/^(promos|combos)$/i.test(product.category.name))?.category?.name;
  expect(category, 'Categoría real con productos').toBeTruthy();
  if (isMobile) await page.getByRole('button', { name: /Filtros/i }).click();
  await page.getByRole('complementary').getByRole('button', { name: category!, exact: true }).click();
  await expect(cards(page).first().getByText(category!, { exact: true }).first()).toBeVisible();
  for (const product of await cards(page).all()) {
    await expect(product.getByText(category!, { exact: true }).first()).toBeVisible();
  }

  const name = await cards(page).first().getByRole('heading', { level: 3 }).innerText();
  await search(page).fill(name);
  await expect(cards(page).getByRole('heading', { name, exact: true }).first()).toBeVisible();
  await search(page).fill('qa-sin-coincidencias-a9c72f');
  await expect(page.getByRole('heading', { name: /No se encontraron productos/i })).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('02 Tienda: orden ascendente y descendente', async ({ page }) => {
  await openCatalog(page);
  const sort = page.getByRole('combobox');
  let firstName = '';
  for (const order of ['Menor precio', 'Mayor precio']) {
    await sort.click();
    await page.getByRole('option', { name: order }).click();
    await expect(sort).toHaveText(order);
    const currentName = await cards(page).first().getByRole('heading', { level: 3 }).innerText();
    if (firstName) expect(currentName).not.toBe(firstName);
    firstName = currentName;
    const labels = await cards(page).locator('.text-primary.font-bold, .font-bold.text-primary').allTextContents();
    const pesos = labels.map(price).filter((item) => item.currency === '$').map((item) => item.amount);
    expect(pesos.length).toBeGreaterThan(1);
    expect(pesos).toEqual([...pesos].sort((a, b) => order === 'Menor precio' ? a - b : b - a));
  }
});

test('03 Ficha: slug, título, canonical, cierre, acceso directo y URL legacy válida', async ({ page }) => {
  const [product] = await openCatalog(page);
  await openDetails(page, product);
  const path = new URL(page.url()).pathname;
  const [slug, id] = path.replace(/^\/producto\//, '').split('--');
  expect(path).toMatch(/^\/producto\/[a-z\d-]+--[a-f\d-]+$/);
  expect(slug).toBeTruthy();
  expect(id).toMatch(uuidPattern);
  expect(id).toBe(product.id);
  await expect(page).toHaveTitle(`${product.name} | Tienda Nictech`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', site + path);
  await details(page).locator('button:has(> svg.lucide-x):visible').first().click();
  await expect(page).toHaveURL(/\/tienda$/);
  await expect(details(page)).toHaveCount(0);

  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(details(page).getByRole('heading', { name: product.name, exact: true }).last()).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', site + path);
  await page.goto(`/producto/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new URL(path, page.url()).href);
  await expect(details(page)).toBeVisible();
});

test('03 Ficha: WhatsApp comparte el enlace canónico', async ({ page }) => {
  const [product] = await openCatalog(page);
  await openDetails(page, product);
  const link = details(page).getByRole('link', { name: /Consultar por este producto en WhatsApp/i });
  await expect(link).toBeVisible();
  const href = new URL((await link.getAttribute('href'))!);
  expect(href.hostname).toBe('wa.me');
  expect(href.searchParams.get('text')).toContain(site + new URL(page.url()).pathname);
});

test('03 Ficha: galería ampliada y cambio de imagen por color', async ({ page, network }, testInfo) => {
  const { product, first, second } = await openVariantCatalog(page, network, testInfo);
  await openDetails(page, product);
  const gallery = details(page).getByRole('button', { name: /^Ampliar imagen/ });
  await selectColor(page, first.color, first.stock);
  await expect(gallery.first().locator('img')).toHaveAttribute('src', first.image_url!);
  await gallery.first().click();
  const enlarged = page.locator('img[alt^="Imagen ampliada"]');
  await expect(enlarged).toBeVisible();
  await expect.poll(() => enlarged.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.locator('button[aria-label="Siguiente"]').click();
  await expect(enlarged).not.toHaveAttribute('src', first.image_url!);
  await page.locator('button[aria-label="Cerrar"]').click();
  await expect(enlarged).toHaveCount(0);

  await selectColor(page, second.color, second.stock);
  await expect(gallery.first().locator('img')).toHaveAttribute('src', second.image_url!);
  await expect.poll(() => gallery.first().locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test('03 Ficha: ID inválido muestra noindex y 404 en español', async ({ page }) => {
  for (const path of [
    '/producto/enlace-invalido--00000000-0000-0000-0000-000000000000',
    '/producto/slug-legacy-inexistente-e2e',
  ]) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Producto no encontrado|Página no encontrada/i);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('main').getByRole('heading', { name: /producto no encontrado|página no encontrada/i })).toBeVisible();
    await expect(page.getByText('Error 404', { exact: true })).toBeVisible();
  }
});
