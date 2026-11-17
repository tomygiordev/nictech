import { describe, expect, it } from 'vitest';
import { BUSINESS_INFO, isValidCuit } from './business-info';

describe('isValidCuit', () => {
  it.each(['20-12345678-6', '30-71234567-1'])('accepts valid CUIT %s', (cuit) => {
    expect(isValidCuit(cuit)).toBe(true);
  });

  it.each(['20-12345678-7', '20123456786', ''])('rejects invalid CUIT %s', (cuit) => {
    expect(isValidCuit(cuit)).toBe(false);
  });

  it('has either an unset or valid configured CUIT', () => {
    expect(BUSINESS_INFO.cuit === null || isValidCuit(BUSINESS_INFO.cuit)).toBe(true);
  });
});
