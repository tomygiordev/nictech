export interface InstallmentsOffer { count: number; interestFree: boolean }

/** Cuotas con Mercado Pago que se muestran en tarjeta y ficha. null = no se muestra nada. Lo define el negocio. */
export const STOREFRONT_INSTALLMENTS: InstallmentsOffer | null = null;
