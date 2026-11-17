function decodeHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export function parseSignatureHeader(value: string | null): { ts: string; hash: Uint8Array<ArrayBuffer> } | null {
  if (!value) return null;
  const parts = new Map<string, string>();
  for (const entry of value.split(",")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    parts.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
  }

  const ts = parts.get("ts");
  const hash = decodeHex(parts.get("v1") ?? "");
  return ts && /^\d+$/.test(ts) && hash ? { ts, hash } : null;
}

export async function verifyMercadoPagoSignature(
  secret: string,
  dataId: string,
  requestId: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!secret || !dataId || !requestId) return false;
  const signature = parseSignatureHeader(signatureHeader);
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${signature.ts};`;
  return crypto.subtle.verify("HMAC", key, signature.hash, encoder.encode(manifest));
}
