import { describe, expect, it } from 'vitest';
import { checkoutPayerSchema } from './checkout-payer';

const payer = {
  name: ' Persona de Prueba ',
  dni: '20-12345678-9',
  email: 'prueba@example.invalid',
  phone: '+54 9 (11) 1234-5678',
  address: ' Retiro en sucursal ',
};

describe('validación de contacto del checkout', () => {
  it('acepta datos válidos y normaliza documento y espacios', () => {
    expect(checkoutPayerSchema.parse(payer)).toEqual({
      ...payer, name: 'Persona de Prueba', dni: '20123456789', address: 'Retiro en sucursal',
    });
  });

  it('devuelve un error por cada campo inválido antes de pedir un pago', () => {
    const result = checkoutPayerSchema.safeParse({ name: ' ', dni: 'abc', email: 'mal', phone: 'abc', address: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.error.flatten().fieldErrors)).toEqual(['name', 'dni', 'email', 'phone', 'address']);
    }
  });
});
