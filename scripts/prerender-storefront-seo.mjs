import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE_URL = 'https://nictech.com.ar';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeMarkup = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const decodeXml = (value) => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
  if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity.toLowerCase()];
});

export function slugifyProductName(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function buildProductPath(product) {
  const slug = slugifyProductName(product.name);
  return `/producto/${slug ? `${slug}--` : ''}${product.id}`;
}

export function cleanDescription(description, name = '') {
  const cleaned = (typeof description === 'string' ? description : '').replace(/[\s•]+/g, ' ').trim() || `${name} en Nictech, con garantía escrita. Retiro en Urdinarrain y Gilbert, envíos a todo el país.`;
  if (cleaned.length <= 155) return cleaned;
  const prefix = cleaned.slice(0, 154);
  const boundary = prefix.lastIndexOf(' ');
  return `${(boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd()}…`;
}

function validProducts(products) {
  if (!Array.isArray(products)) throw new Error('La fuente de productos debe ser un arreglo');
  const ids = new Set();
  const routes = new Set();
  return products.filter((product) => {
    if (!product || product.is_active === false || typeof product.id !== 'string' || !uuid.test(product.id) || typeof product.name !== 'string' || !product.name.trim()) return false;
    const id = product.id.toLowerCase();
    const route = buildProductPath(product).toLowerCase();
    if (ids.has(id) || routes.has(route)) return false;
    ids.add(id);
    routes.add(route);
    return true;
  });
}

function metaReplace(head, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<meta\\b(?=[^>]*\\b(?:name|property)\\s*=\\s*["']${escapedKey}["'])(?=[^>]*\\bcontent\\s*=\\s*["'][^"']*["'])[^>]*>`, 'i');
  if (!regex.test(head)) return [head, false];
  return [head.replace(regex, (tag) => tag.replace(/(\bcontent\s*=\s*)(["'])[^"']*\2/i, (_, prefix) => `${prefix}"${escapeMarkup(value)}"`)), true];
}

export function renderProductHtml(baseHtml, product, site = SITE_URL) {
  const match = baseHtml.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i);
  if (!match) return null;
  let head = match[0];
  const title = `${product.name} | Tienda Nictech`;
  const description = cleanDescription(product.description, product.name);
  const url = `${site.replace(/\/+$/, '')}${buildProductPath(product)}`;
  const titlePattern = /<title\b[^>]*>[\s\S]*?<\/title\s*>/i;
  if (!titlePattern.test(head)) return null;
  head = head.replace(titlePattern, () => `<title>${escapeMarkup(title)}</title>`);
  for (const [key, value, required] of [
    ['description', description, true], ['og:title', title, true], ['og:url', url, true],
    ['og:description', description, false], ['og:type', 'product', false],
  ]) {
    const [next, found] = metaReplace(head, key, value);
    if (required && !found) return null;
    head = next;
  }
  const image = typeof product.image_url === 'string' && /^https:\/\//i.test(product.image_url) ? product.image_url : null;
  if (image) for (const key of ['og:image', 'twitter:image']) [head] = metaReplace(head, key, image);
  const structured = { '@context': 'https://schema.org', '@type': 'Product', name: product.name, description, ...(image ? { image: [image] } : {}), url };
  const extra = `<link rel="canonical" href="${escapeMarkup(url)}" />\n  <script type="application/ld+json">${JSON.stringify(structured).replace(/</g, '\\u003c')}</script>\n`;
  head = head.replace(/<\/head\s*>/i, () => `${extra}</head>`);
  return baseHtml.replace(match[0], () => head);
}

function parseStaticSitemap(xml) {
  return [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url\s*>/gi)].flatMap(([, block]) => {
    const get = (tag) => { const found = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i')); return found ? decodeXml(found[1].trim()) : undefined; };
    const loc = get('loc');
    return loc ? [{ loc, changefreq: get('changefreq'), priority: get('priority') }] : [];
  });
}

export function buildSitemap(staticEntries, products, site = SITE_URL) {
  const entries = [...staticEntries.map((entry) => typeof entry === 'string' ? { loc: entry } : entry), ...validProducts(products).map((product) => ({ loc: `${site.replace(/\/+$/, '')}${buildProductPath(product)}`, changefreq: 'weekly', priority: '0.7' }))];
  const seen = new Set();
  const urls = entries.filter((entry) => entry?.loc && !seen.has(entry.loc) && seen.add(entry.loc)).map((entry) => `  <url>\n    <loc>${escapeMarkup(entry.loc)}</loc>${entry.changefreq ? `\n    <changefreq>${escapeMarkup(entry.changefreq)}</changefreq>` : ''}${entry.priority ? `\n    <priority>${escapeMarkup(entry.priority)}</priority>` : ''}\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function parseArgs(args) {
  const options = { dist: 'dist', site: SITE_URL, input: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    const keys = { '--dist': 'dist', '--site': 'site', '--input': 'input' };
    if (!Object.hasOwn(keys, arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Argumento inválido: ${arg}`);
    options[keys[arg]] = args[++i];
  }
  try { const url = new URL(options.site); if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error(); } catch { throw new Error('Argumento --site inválido'); }
  return options;
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; return; }
  if (!options.input && !(process.env.SEO_PRERENDER_FETCH === '1' && process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    console.log('SEO prerender omitido: sin --input ni SEO_PRERENDER_FETCH=1');
    return;
  }
  try {
    let products;
    if (options.input) products = JSON.parse(await readFile(options.input, 'utf8'));
    else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`${process.env.VITE_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/products?select=id,name,description,image_url&is_active=eq.true&order=name.asc`, { headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${process.env.VITE_SUPABASE_PUBLISHABLE_KEY}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        products = await response.json();
      } finally { clearTimeout(timer); }
    }
    products = validProducts(products);
    const base = await readFile(path.join(options.dist, 'index.html'), 'utf8');
    const staticEntries = parseStaticSitemap(await readFile('public/sitemap.xml', 'utf8'));
    const pages = [];
    for (const product of products) {
      const html = renderProductHtml(base, product, options.site);
      if (!html) { console.warn(`SEO prerender omitió ${product.id}: faltan etiquetas obligatorias`); continue; }
      pages.push({ product, html, route: buildProductPath(product) });
    }
    const sitemap = buildSitemap(staticEntries, pages.map(({ product }) => product), options.site);
    if (options.dryRun) {
      console.log(`Páginas: ${pages.length}`);
      pages.slice(0, 3).forEach(({ route }) => console.log(route));
      console.log(`URLs del sitemap: ${(sitemap.match(/<loc>/g) || []).length}`);
      return;
    }
    for (const { route, html } of pages) {
      const directory = path.join(options.dist, ...route.slice(1).split('/'));
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'index.html'), html);
    }
    await writeFile(path.join(options.dist, 'sitemap.xml'), sitemap);
    console.log(`SEO prerender: ${pages.length} páginas; ${(sitemap.match(/<loc>/g) || []).length} URLs en sitemap`);
  } catch (error) { console.warn(`SEO prerender omitido: ${error.message}`); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
