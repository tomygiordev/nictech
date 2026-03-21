import { supabase } from '@/integrations/supabase/client';

// Mapa base en código — cubre todos los colores del DB
export const COLOR_MAP: Record<string, string> = {
  'transparente':    'repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 0 0 / 10px 10px',
  'blanco':          '#FFFFFF',
  'negro':           '#000000',
  'azul':            '#3B82F6',
  'azul francia':    '#0055A4',
  'azul marino':     '#1E3A5F',
  'azul oscuro':     '#1E4080',
  'bisel':           '#B0B0B0',
  'bordo':           '#881337',
  'bordó':           '#881337',
  'brillo':          '#E8E8E8',
  'celeste':         '#67E8F9',
  'celeste pastel':  '#BAE6FD',
  'dorado':          '#F59E0B',
  'francia':         '#0055A4',
  'fucsia':          '#FF0090',
  'grafito':         '#374151',
  'gris':            '#6B7280',
  'gris claro':      '#D1D5DB',
  'gris oscuro':     '#4B5563',
  'lila':            '#C084FC',
  'magenta':         '#E879F9',
  'marron':          '#92400E',
  'marrón':          '#92400E',
  'marron pastel':   '#D4A574',
  'metalizado':      '#B8B8B8',
  'midnight':        '#191970',
  'multicolor':      'linear-gradient(135deg, red, orange, yellow, green, blue, violet)',
  'naranja':         '#F97316',
  'plateado':        '#C0C0C0',
  'rojo':            '#EF4444',
  'rosa':            '#EC4899',
  'rosa claro':      '#F9A8D4',
  'rosa viejo':      '#C9897A',
  'strass':          '#E0D8F0',
  'tini':            '#9CA3AF',
  'vede agua':       '#2DD4BF',
  'verde':           '#22C55E',
  'verde agua':      '#2DD4BF',
  'verde manzana':   '#8DB600',
  'verde musgo':     '#4A5240',
  'verde oscuro':    '#14532D',
  'violeta':         '#A855F7',
  'amarillo':        '#EAB308',
  'beige':           '#D4B896',
  'turquesa':        '#14B8A6',
};

export const getVariantColor = (colorName: string): string =>
  COLOR_MAP[colorName.toLowerCase()] ?? '#9CA3AF';

export const isLightColor = (colorName: string): boolean =>
  ['blanco', 'amarillo', 'beige', 'plateado', 'gris claro', 'celeste pastel', 'rosa claro', 'transparente', 'brillo', 'strass']
    .includes(colorName.toLowerCase());

/** Carga hex_colors desde DB y sobreescribe COLOR_MAP. Llamar una vez al montar el admin. */
export const loadColorsFromDB = async () => {
  const { data } = await supabase.from('colors' as any).select('name, hex_color');
  if (!data) return;
  for (const row of data as { name: string; hex_color: string | null }[]) {
    if (row.hex_color) COLOR_MAP[row.name.toLowerCase()] = row.hex_color;
  }
};

/** Guarda hex_color en DB y actualiza el mapa local. */
export const saveColorHex = async (colorName: string, hex: string): Promise<boolean> => {
  COLOR_MAP[colorName.toLowerCase()] = hex;
  const { error } = await supabase
    .from('colors' as any)
    .update({ hex_color: hex } as any)
    .ilike('name', colorName);
  return !error;
};
