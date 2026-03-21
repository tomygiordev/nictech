import { describe, it, expect } from 'vitest';
import { generateTrackingCode } from './generateTrackingCode';

const VALID_CHARS = new Set('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');

describe('generateTrackingCode()', () => {
  it('returns a string of the format XXXX-XXXX (9 chars total)', () => {
    const code = generateTrackingCode();
    expect(code).toHaveLength(9);
    expect(code[4]).toBe('-');
  });

  it('only uses allowed characters (no I, O, 0, 1)', () => {
    // Run many times to cover randomness
    for (let i = 0; i < 200; i++) {
      const code = generateTrackingCode();
      const chars = code.replace('-', '');
      for (const char of chars) {
        expect(VALID_CHARS.has(char), `Char "${char}" should not appear in tracking code`).toBe(true);
      }
    }
  });

  it('never contains the excluded characters I, O, 0, 1', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateTrackingCode();
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it('generates unique codes across many calls', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateTrackingCode()));
    // With a 32-char alphabet and 8 positions, collisions in 100 calls are astronomically rare
    expect(codes.size).toBe(100);
  });
});
