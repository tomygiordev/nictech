/**
 * Optimización de imágenes antes de subirlas a Supabase Storage.
 *
 * Las fotos de producto se sirven en cada visita a la tienda, por lo que subir
 * PNG originales de varios MB dispara el egress. Acá se redimensionan y se
 * convierten a WebP en el navegador.
 */

const MAX_DIMENSION = 1200;
const WEBP_QUALITY = 0.82;
/** Archivos más chicos que esto no valen la pena recomprimirlos. */
const SKIP_BELOW_BYTES = 120 * 1024;
const SKIP_TYPES = new Set(['image/gif', 'image/svg+xml']);

/** Cache largo: los nombres de archivo son únicos, así que nunca se pisan. */
export const IMAGE_UPLOAD_OPTIONS = { cacheControl: '31536000' } as const;

function loadBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Devuelve un WebP redimensionado (lado mayor ≤ 1200px).
 * Si no se puede o no conviene optimizar, devuelve el archivo original.
 */
export async function optimizeImage(file: File, maxDimension: number = MAX_DIMENSION): Promise<File> {
  if (!file.type.startsWith('image/') || SKIP_TYPES.has(file.type)) return file;
  if (file.size < SKIP_BELOW_BYTES) return file;

  try {
    const bitmap = await loadBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
  } catch {
    return file;
  }
}

/** Extensión del archivo (sin punto), en minúscula. */
export function fileExtension(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? 'webp';
}
