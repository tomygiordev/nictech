// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { slugifyProductName, buildProductPath, cleanDescription, renderProductHtml, buildSitemap, parseArgs } from './prerender-storefront-seo.mjs';

vi.stubGlobal('localStorage', { clear() {} });

const fixturePath = 'scripts/fixtures/seo-products.sample.json';
const products = JSON.parse(await readFile(fixturePath, 'utf8'));
const base = await readFile('index.html', 'utf8');

describe('SEO de productos', () => {
  it.each([
    ['Motorola G23 128 GB Blanco (Usado)', 'motorola-g23-128-gb-blanco-usado'],
    ['Auriculares Inalámbricos Bluetooth con Cancelación de Ruido', 'auriculares-inalambricos-bluetooth-con-cancelacion-de-ruido'],
    ['Samsung Galaxy A03 – 64 GB | 4 GB RAM', 'samsung-galaxy-a03-64-gb-4-gb-ram'],
    ['¡Últimos! Ñandú 3.5mm', 'ultimos-nandu-3-5mm'],
    ['***', ''],
  ])('normaliza %s', (name, expected) => expect(slugifyProductName(name)).toBe(expected));

  it('limpia y recorta descripciones en un límite de palabra', () => {
    expect(cleanDescription('uno\n• dos   tres')).toBe('uno dos tres');
    const result = cleanDescription('palabra '.repeat(30));
    expect(result.length).toBeLessThanOrEqual(155);
    expect(result).toMatch(/palabra…$/);
    expect(cleanDescription('', 'Equipo')).toContain('Equipo en Nictech');
  });

  it('renderiza metadatos y JSON-LD escapados sin ofertas', () => {
    const product = { ...products[0], name: 'Equipo "especial" <nuevo>' };
    const html = renderProductHtml(base, product, 'https://www.nictech.com.ar');
    expect(html).toContain('<title>Equipo &quot;especial&quot; &lt;nuevo&gt; | Tienda Nictech</title>');
    expect(html).toMatch(/name="description"\s+content="Pantalla amplia Buena batería Equipo revisado"/);
    const url = `https://www.nictech.com.ar${buildProductPath(product)}`;
    expect(html).toContain(`property="og:url" content="${url}"`);
    expect(html).toContain(`<link rel="canonical" href="${url}"`);
    for (const pattern of [/<title\b/gi, /name="description"/gi, /property="og:url"/gi, /rel="canonical"/gi]) expect(html.match(pattern)).toHaveLength(1);
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const data = JSON.parse(scripts.at(-1)[1]);
    expect(data.name).toBe(product.name);
    expect(scripts.at(-1)[1]).toContain('\\u003c');
    expect(data).not.toHaveProperty('offers');
    expect(data.image).toEqual([product.image_url]);
    expect(renderProductHtml(base.replace(/<title[\s\S]*?<\/title>/i, ''), product)).toBeNull();
  });

  it('conserva estáticas y deduplica productos activos', () => {
    const staticUrl = 'https://www.nictech.com.ar/tienda';
    const xml = buildSitemap([{ loc: staticUrl, changefreq: 'daily', priority: '0.9' }, staticUrl], [...products, products[0]], 'https://www.nictech.com.ar');
    expect(xml.match(/<loc>/g)).toHaveLength(4);
    expect(xml).toContain('<changefreq>daily</changefreq>');
    expect(xml).toContain(buildProductPath(products[0]));
    expect(xml).toContain(buildProductPath(products[3]));
    expect(xml).not.toContain(products[2].id);
  });

  it('rechaza argumentos inválidos', () => {
    expect(() => parseArgs(['--unknown'])).toThrow();
    expect(() => parseArgs(['--dist'])).toThrow();
  });

  it('genera archivos de punta a punta sin red', async () => {
    const temp = await mkdtemp(path.join(tmpdir(), 'nictech-seo-'));
    try {
      const dist = path.join(temp, 'dist');
      await mkdir(dist);
      await writeFile(path.join(dist, 'index.html'), base);
      execFileSync(process.execPath, ['scripts/prerender-storefront-seo.mjs', '--dist', dist, '--input', fixturePath], { encoding: 'utf8' });
      const html = await readFile(path.join(dist, buildProductPath(products[0]).slice(1), 'index.html'), 'utf8');
      expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
      await expect(readFile(path.join(dist, buildProductPath(products[3]).slice(1), 'index.html'), 'utf8')).resolves.toContain('<title>*** | Tienda Nictech</title>');
      const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
      expect(sitemap.match(/<loc>/g)).toHaveLength(12);
      expect(sitemap).not.toContain(products[2].id);
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
});
