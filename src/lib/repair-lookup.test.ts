import { describe, expect, it } from 'vitest';
import { repairLookupSchema } from './repair-lookup';

describe('formato de seguimiento', () => {
  it.each([' ABCD-1234 ', 'zzzz-zzzz', '30.123.456', '12 345 678', '20-12345678-9'])('acepta %s', (value) => {
    expect(repairLookupSchema.parse(value)).toBe(value.trim());
  });

  it.each(['x!', 'ABCD1234', '12.34', 'x30123456', ''])('rechaza %s', (value) => {
    expect(repairLookupSchema.safeParse(value).success).toBe(false);
  });
});
