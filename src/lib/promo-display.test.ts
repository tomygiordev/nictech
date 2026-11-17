import { describe, expect, it } from 'vitest';
import { formatInstallmentsLabel, formatPromoEndLabel } from './promo-display';

describe('formatPromoEndLabel', () => {
  it('usa la fecha en Argentina', () => {
    expect(formatPromoEndLabel('2026-12-01T02:00:00Z')).toBe('Promo válida hasta el 30/11');
  });
  it.each([null, undefined, '', 'no-es-fecha'])('omite fecha inválida o ausente: %s', (value) => {
    expect(formatPromoEndLabel(value)).toBeNull();
  });
});

describe('formatInstallmentsLabel', () => {
  it('redondea hacia arriba y formatea en pesos argentinos', () => {
    expect(formatInstallmentsLabel(100000, { count: 3, interestFree: true })).toBe('3 cuotas sin interés de $ 33.334');
  });
  it('omite el importe cuando hay interés', () => {
    expect(formatInstallmentsLabel(100000, { count: 6, interestFree: false })).toBe('Hasta 6 cuotas con Mercado Pago');
  });
  it('omite ofertas ausentes o inválidas', () => {
    expect(formatInstallmentsLabel(100000, null)).toBeNull();
    expect(formatInstallmentsLabel(100000, { count: 1, interestFree: true })).toBeNull();
    expect(formatInstallmentsLabel(100000, { count: 2.5, interestFree: true })).toBeNull();
  });
  it('antepone Desde cuando corresponde', () => {
    expect(formatInstallmentsLabel(100000, { count: 3, interestFree: true }, { fromPrefix: true })).toBe('Desde 3 cuotas sin interés de $ 33.334');
  });
});
