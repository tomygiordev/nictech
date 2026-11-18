import { z } from 'zod';

export const checkoutPayerSchema = z.object({
  name: z.string().trim()
    .min(1, 'Ingresá tu nombre completo')
    .max(120, 'El nombre no puede superar los 120 caracteres'),
  dni: z.string().trim()
    .max(20, 'Ingresá un DNI o CUIL válido')
    .transform((value) => value.replace(/[.\s-]/g, ''))
    .pipe(z.string().regex(/^\d{7,11}$/, 'Ingresá un DNI o CUIL válido')),
  email: z.string().trim().email('Ingresá un email válido')
    .max(254, 'El email no puede superar los 254 caracteres'),
  phone: z.string().trim()
    .max(40, 'Ingresá un teléfono válido')
    .regex(/^\+?[\d().\s-]+$/, 'Ingresá un teléfono válido')
    .refine((value) => value.replace(/\D/g, '').length >= 6, 'Ingresá un teléfono válido'),
  address: z.string().trim()
    .min(1, 'Ingresá la dirección de entrega')
    .max(300, 'La dirección y las indicaciones no pueden superar los 300 caracteres'),
});
