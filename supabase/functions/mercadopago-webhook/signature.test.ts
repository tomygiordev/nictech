import { describe, expect, it } from "vitest";
import { parseSignatureHeader, verifyMercadoPagoSignature } from "./signature";

async function sign(secret: string, manifest: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(manifest)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Mercado Pago webhook signature", () => {
  it("verifica el manifiesto oficial con punto y coma final", async () => {
    const secret = "webhook-secret";
    const id = "123456";
    const requestId = "request-1";
    const ts = "1710000000";
    const hash = await sign(secret, `id:${id};request-id:${requestId};ts:${ts};`);

    await expect(verifyMercadoPagoSignature(
      secret,
      id,
      requestId,
      `ts=${ts},v1=${hash}`,
    )).resolves.toBe(true);
  });

  it("falla cerrado ante secretos, headers o hashes ausentes", async () => {
    expect(parseSignatureHeader("ts=1,v1=no-es-un-hash")).toBeNull();
    await expect(verifyMercadoPagoSignature("", "1", "request", null)).resolves.toBe(false);
    await expect(verifyMercadoPagoSignature("secret", "1", "request", null)).resolves.toBe(false);
  });
});
