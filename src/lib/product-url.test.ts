import { describe, expect, it } from 'vitest';
import { buildProductPath, canonicalProductUrl, findProductByParam, parseProductParam, productWhatsAppUrl, slugifyProductName } from './product-url';

const id = '123e4567-e89b-12d3-a456-426614174000';
const product = { id, name: 'Motorola G23 128 GB Blanco (Usado)' };

describe('product URLs', () => {
  it.each([
    ['Motorola G23 128 GB Blanco (Usado)', 'motorola-g23-128-gb-blanco-usado'],
    ['Auriculares Inalámbricos Bluetooth con Cancelación de Ruido', 'auriculares-inalambricos-bluetooth-con-cancelacion-de-ruido'],
    ['Samsung Galaxy A03 – 64 GB | 4 GB RAM', 'samsung-galaxy-a03-64-gb-4-gb-ram'],
    ['¡Últimos! Ñandú 3.5mm', 'ultimos-nandu-3-5mm'],
    ['***', ''],
  ])('slugifies %s', (name, slug) => {
    expect(slugifyProductName(name)).toBe(slug);
  });

  it('builds paths with a slug or an ID alone', () => {
    expect(buildProductPath(product)).toBe(`/producto/motorola-g23-128-gb-blanco-usado--${id}`);
    expect(buildProductPath({ id, name: '***' })).toBe(`/producto/${id}`);
  });

  it('builds the canonical absolute URL', () => {
    expect(canonicalProductUrl(product)).toBe(`https://www.nictech.com.ar/producto/motorola-g23-128-gb-blanco-usado--${id}`);
  });

  it('uses the public canonical URL in WhatsApp even on a preview hostname', () => {
    const link = new URL(productWhatsAppUrl(product, 1200, 'Azul & gris'));
    const message = link.searchParams.get('text');
    expect(link.origin).toBe('https://wa.me');
    expect(message).toContain('(Azul & gris)');
    expect(message).toContain(canonicalProductUrl(product));
    expect(message).not.toContain(window.location.origin);
  });

  it('parses the ID after the last separator or the entire parameter', () => {
    expect(parseProductParam(`motorola-g23--${id}`)).toBe(id);
    expect(parseProductParam(`old--motorola--${id}`)).toBe(id);
    expect(parseProductParam(id)).toBe(id);
  });

  it('finds by direct ID, extracted ID, or slug and returns null otherwise', () => {
    const items = [product];
    expect(findProductByParam(id, items)).toBe(product);
    expect(findProductByParam(`old--${id}`, items)).toBe(product);
    expect(findProductByParam('motorola-g23-128-gb-blanco-usado', items)).toBe(product);
    expect(findProductByParam('not-found', items)).toBeNull();
  });
});
