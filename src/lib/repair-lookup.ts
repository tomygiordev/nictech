import { z } from 'zod';

export const repairLookupSchema = z.string().trim().refine((value) => {
  const isCode = /^[a-z\d]{4}-[a-z\d]{4}$/i.test(value);
  const isDni = /^[\d.\s-]+$/.test(value) && /^\d{6,12}$/.test(value.replace(/[.\s-]/g, ''));
  return isCode || isDni;
}, 'Ingresá un DNI o código de reparación válido');
