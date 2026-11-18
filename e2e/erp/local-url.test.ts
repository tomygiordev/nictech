import { describe, expect, it } from 'vitest';
import { localUrl } from './local-url.mjs';

describe('validación del destino E2E', () => {
  it.each(['http://127.0.0.1:55421', 'http://localhost:55421'])('acepta la API local %s', (url) => {
    expect(localUrl(url, 'API').origin).toBe(url);
  });

  it.each([
    'https://example.test',
    'http://localhost.example.test:55421',
    'http://localhost@example.test:55421',
    'file://localhost/fixtures',
    '',
  ])('rechaza un destino inválido o remoto: %s', (url) => {
    expect(() => localUrl(url, 'API')).toThrow();
  });

  it('solo acepta el protocolo de la conexión SQL si se solicita explícitamente', () => {
    const url = 'postgresql://postgres@127.0.0.1:55422/postgres';
    expect(() => localUrl(url, 'API')).toThrow();
    expect(localUrl(url, 'DB', ['postgresql:']).hostname).toBe('127.0.0.1');
  });
});
