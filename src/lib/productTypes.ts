
export type ProductType = 'phone' | 'case' | 'variant' | 'generic';

export const PHONE_KEYWORDS  = ['celular', 'smartphone', 'iphone', 'samsung'];
export const CASE_KEYWORDS   = ['funda', 'case'];

/** Returns the type of a product based on its category name and whether it has variants in DB. */
export function getProductType(
  categoryName: string | null | undefined,
  variantIds: Set<string>,
  productId: string,
): ProductType {
  const cat = (categoryName || '').toLowerCase();
  if (PHONE_KEYWORDS.some(k => cat.includes(k))) return 'phone';
  if (CASE_KEYWORDS.some(k => cat.includes(k))) return 'case';
  if (variantIds.has(productId)) return 'variant';
  return 'generic';
}

export const TYPE_META: Record<ProductType, { label: string; cls: string; dot: string }> = {
  phone:   { label: 'Celular',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',     dot: 'bg-blue-500' },
  case:    { label: 'Funda',    cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', dot: 'bg-purple-500' },
  variant: { label: 'Variante', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', dot: 'bg-orange-500' },
  generic: { label: 'Producto', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',          dot: 'bg-gray-400' },
};
