import type { Page, Response, TestInfo } from '@playwright/test';
import { expect, supabaseHost, type Network } from './fixtures';

type Variant = {
  id: string;
  color: string;
  stock: number;
  image_url: string | null;
  is_active: boolean;
};

export type CatalogProduct = {
  id: string;
  name: string;
  stock: number;
  price: number;
  image_url: string | null;
  additional_images: string[] | null;
  sale_expires_at: string | null;
  category: { name: string } | null;
  product_variants: Variant[];
};

export const cards = (page: Page) => page.getByRole('button', { name: /^Ver detalles de / });
export const search = (page: Page) => page.getByPlaceholder('Buscar celulares, fundas, cargadores...');
export const details = (page: Page) => page.getByRole('dialog', { name: /^Detalles del producto:/ });
export const cart = (page: Page) => page.locator('nav').first().locator('button').filter({
  has: page.locator('svg.lucide-shopping-cart'),
});
export const addButton = (page: Page) => details(page).getByRole('button', { name: /Añadir a carrito/i });
export const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function catalogResponse(response: Response) {
  const url = new URL(response.url());
  return url.hostname === supabaseHost && url.pathname === '/rest/v1/products'
    && url.searchParams.get('select')?.includes('product_variants(') === true;
}

export async function openCatalog(page: Page) {
  const response = page.waitForResponse(catalogResponse);
  await page.goto('/tienda', { waitUntil: 'domcontentloaded' });
  const result = await response;
  expect(result.ok(), `Catálogo: HTTP ${result.status()}`).toBe(true);
  await expect(cards(page).first()).toBeVisible();
  return await result.json() as CatalogProduct[];
}

export async function openDetails(page: Page, product: CatalogProduct) {
  await search(page).fill(product.name);
  await cards(page).and(page.getByRole('button', { name: `Ver detalles de ${product.name}`, exact: true }))
    .first().getByRole('heading', { level: 3 }).click();
  await expect(details(page)).toBeVisible();
}

function findVariants(products: CatalogProduct[]) {
  for (const product of products) {
    const available = (product.product_variants ?? []).filter((variant) => variant.is_active && variant.stock > 0);
    const first = available.find((variant) => variant.stock >= 2 && variant.image_url);
    const second = available.find((variant) => variant.image_url && variant.image_url !== first?.image_url && variant.color !== first?.color);
    if (first && second) return { product, first, second };
  }
  return null;
}

export async function openVariantCatalog(page: Page, network: Network, testInfo: TestInfo) {
  const products = await openCatalog(page);
  const available = findVariants(products);
  if (available) return available;

  const images = [...new Set(products.flatMap(({ image_url }) =>
    image_url && new URL(image_url).hostname === supabaseHost ? [image_url] : []))];
  expect(images.length, 'Se necesitan tres fotos públicas diferentes para el fixture de galería').toBeGreaterThanOrEqual(3);
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const first = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', product_id: id,
    color: 'Azul QA', stock: 3, image_url: images[1], is_active: true, price: 12000,
  };
  const second = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', product_id: id,
    color: 'Verde QA', stock: 2, image_url: images[2], is_active: true, price: 12000,
  };
  const product = {
    id, name: 'Producto QA con dos colores', price: 12000, price_usd: null, stock: 5,
    image_url: images[0], additional_images: images.slice(1, 3), sale_expires_at: null,
    category: null, product_variants: [first, second], tags: [],
  };
  network.catalogRead = (url) => {
    if (url.pathname === '/rest/v1/products') return [product];
    if (url.pathname === '/rest/v1/storefront_promotion_prices') return [];
    if (url.pathname === '/rest/v1/product_variants') {
      const ids = url.searchParams.get('id');
      return ids ? [first, second].filter((variant) => ids.includes(variant.id)) : [first, second];
    }
  };
  const response = page.waitForResponse(catalogResponse);
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect((await response).ok()).toBe(true);
  await expect(cards(page).first()).toBeVisible();
  testInfo.annotations.push({
    type: 'datos', description: 'Sin combinación apta en el catálogo real: variantes y stock interceptados; fotos públicas reales.',
  });
  return { product, first, second };
}

export function selectColor(page: Page, color: string, stock: number) {
  return details(page).getByTitle(`${color} (${stock} disponibles)`, { exact: true }).click();
}

export type StoredLine = { id: string; quantity: number; variant?: { id: string } };

export function storedCart(page: Page): Promise<StoredLine[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('cartItems') ?? '[]'));
}

export function price(text: string) {
  const match = text.match(/(USD|\$)\s*([\d.,]+)/);
  if (!match) throw new Error(`Importe ilegible: ${text}`);
  const [, currency, amount] = match;
  return { currency, amount: Number(currency === 'USD' ? amount.replaceAll(',', '') : amount.replaceAll('.', '').replace(',', '.')) };
}
