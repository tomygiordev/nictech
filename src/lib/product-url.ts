export const SITE_URL = 'https://www.nictech.com.ar';

type ProductIdentity = { id: string; name: string };

export const slugifyProductName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const buildProductPath = (product: ProductIdentity): string => {
  const slug = slugifyProductName(product.name);
  return slug ? `/producto/${slug}--${product.id}` : `/producto/${product.id}`;
};

export const canonicalProductUrl = (product: ProductIdentity): string =>
  `${SITE_URL}${buildProductPath(product)}`;

export function productWhatsAppUrl(product: ProductIdentity, price: number, color?: string): string {
  const name = color ? `${product.name} (${color})` : product.name;
  const amount = price.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const message = `Hola Nictech! Quiero consultar por ${name} ($ ${amount}). ¿Está disponible? ${canonicalProductUrl(product)}`;
  return `https://wa.me/5493446353769?text=${encodeURIComponent(message)}`;
}

export const parseProductParam = (param: string): string => {
  const separatorIdx = param.lastIndexOf('--');
  return separatorIdx === -1 ? param : param.slice(separatorIdx + 2);
};

export const findProductByParam = <T extends ProductIdentity>(param: string, items: T[]): T | null => {
  const directMatch = items.find((product) => product.id === param);
  if (directMatch) return directMatch;

  const byExtractedId = items.find((product) => product.id === parseProductParam(param));
  if (byExtractedId) return byExtractedId;

  return items.find((product) => slugifyProductName(product.name) === param) ?? null;
};
