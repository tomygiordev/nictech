import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn()', () => {
  it('returns a single class unchanged', () => {
    expect(cn('text-red-500')).toBe('text-red-500');
  });

  it('merges multiple classes', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('resolves Tailwind conflicts — last class wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('ignores falsy values', () => {
    expect(cn('px-2', false, undefined, null, '', 'py-1')).toBe('px-2 py-1');
  });

  it('handles conditional objects', () => {
    expect(cn({ 'font-bold': true, italic: false })).toBe('font-bold');
  });

  it('returns empty string when no valid classes are provided', () => {
    expect(cn(false, undefined)).toBe('');
  });
});
