export type SupabaseConfig = { url: string; publishableKey: string };
export type SupabaseConfigResult =
  | { ok: true; config: SupabaseConfig }
  | { ok: false; message: string };

export const resolveSupabaseConfig = (
  env: Record<string, string | undefined>,
): SupabaseConfigResult => {
  const url = env.VITE_SUPABASE_URL?.trim();
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    return { ok: false, message: "Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY." };
  }
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('unsupported protocol');
  } catch {
    return { ok: false, message: "VITE_SUPABASE_URL no contiene una URL válida." };
  }
  return { ok: true, config: { url, publishableKey } };
};
