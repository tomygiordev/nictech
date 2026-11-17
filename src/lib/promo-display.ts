import type { InstallmentsOffer } from '@/config/storefront-offers';

export function formatPromoEndLabel(saleExpiresAt: string | null | undefined): string | null {
  if (!saleExpiresAt) return null;
  const date = new Date(saleExpiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Promo válida hasta el ${date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  })}`;
}

export function formatInstallmentsLabel(
  price: number,
  offer: InstallmentsOffer | null,
  options?: { fromPrefix?: boolean },
): string | null {
  if (!offer || !Number.isInteger(offer.count) || offer.count < 2) return null;
  const label = offer.interestFree
    ? `${offer.count} cuotas sin interés de $ ${Math.ceil(price / offer.count).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
    : `Hasta ${offer.count} cuotas con Mercado Pago`;
  return `${options?.fromPrefix ? 'Desde ' : ''}${label}`;
}
