# Errores encontrados fuera del ERP

## Alcance

Esta sección corresponde al storefront existente, checkout, MercadoPago, webhooks, Docker y configuración general. Estos problemas no deben atribuirse automáticamente al ERP privado.

## MP-1 — Docker local apunta al Supabase remoto

**Severidad: P1 alto**

Archivo: `docker-compose.apps.yml`

Aunque tiene defaults locales, un `.env` los sobrescribe. La configuración resuelta por `docker compose -f docker-compose.apps.yml config` apunta a `https://...supabase.co` para storefront y ERP.

Riesgo: entrar al admin local y crear, editar o borrar datos, modificar inventario o ejecutar operaciones reales contra el backend remoto. La publishable key no es una service role key, pero un usuario autenticado puede ejecutar las operaciones permitidas por RLS.

## MP-2 — Checkout conectado potencialmente al backend remoto

**Severidad: P1**

El checkout usa Supabase y Edge Functions mediante variables Vite. Si el build se genera con el `.env` remoto, el flujo queda conectado así:

```text
Checkout local -> Supabase remoto -> Edge Function remota -> MercadoPago real
```

Por lo tanto, que la aplicación sea local no significa necesariamente que esté aislada de efectos reales.

## MP-3 — URL del webhook de MercadoPago hardcodeada

**Severidad: P1**

Archivo: `supabase/functions/create-mercadopago-preference/index.ts:165-166`

La preferencia contiene una URL fija:

```text
https://...supabase.co/functions/v1/mercadopago-webhook
```

Aunque la aplicación corra localmente, las preferencias pueden intentar notificar a un webhook remoto. Esto mezcla pruebas y producción/sandbox, impide que el webhook local reciba automáticamente notificaciones y obliga a modificar código al cambiar de proyecto.

## MP-4 — El webhook acepta solicitudes sin firma si falta el secreto

**Severidad: P0 de seguridad**

Archivo: `supabase/functions/mercadopago-webhook/index.ts:9-14`

La lógica actual es:

```ts
if (!secret) {
  console.warn("MERCADOPAGO_WEBHOOK_SECRET not set");
  return true;
}
```

Si el secreto no está configurado, permite continuar. En producción, una mala configuración puede dejar el webhook aceptando solicitudes falsificadas.

Impactos potenciales:

- registrar pagos falsos;
- crear o actualizar órdenes;
- intentar descontar stock;
- enviar correos falsos;
- contaminar el historial de pedidos.

El webhook debería rechazar solicitudes si el secreto obligatorio no está configurado.

## MP-5 — Stock marcado como procesado antes de terminar

**Severidad: P1**

El webhook marca `stock_decremented = true` y después procesa cada ítem.

Si una llamada a `decrement_stock` falla, el error se registra, pero el pedido puede quedar marcado como procesado. Esto puede dejar stock sin descontar, pedidos aparentemente procesados y reintentos posteriores incapaces de corregirlo.

## MP-6 — El webhook continúa si falla un decremento de stock

**Severidad: P1**

Cuando falla el RPC, el flujo hace `console.error(...)` y continúa. Esto puede producir pago aprobado, orden creada, correo enviado y stock parcial o sin descontar, especialmente en órdenes con varios productos.

## MP-7 — Operaciones separadas y estado parcialmente aplicado

**Severidad: P1/P2**

El flujo realiza operaciones independientes:

1. consulta la orden;
2. hace `upsert`;
3. reclama el descuento;
4. descuenta stock por ítem;
5. envía correo;
6. actualiza `email_sent`.

Si una etapa falla después de otra exitosa, puede quedar una orden creada sin stock descontado, stock descontado sin email, productos parcialmente descontados o un email enviado sin actualizar `email_sent`.

## MP-8 — Checkout y ERP usan estructuras de stock distintas

**Severidad: P1/P2**

La Edge Function valida correctamente precio, nombre y stock consultando `products`, pero el storefront utiliza tablas y funciones legacy mientras el ERP tiene tablas y migraciones nuevas.

Riesgos:

- storefront y ERP pueden administrar stocks diferentes;
- las operaciones del ERP no necesariamente alimentan el checkout existente;
- puede venderse con una estructura mientras el ERP administra otra.

Es uno de los principales problemas de integración entre ambos sistemas.

## MP-9 — URLs remotas hardcodeadas en el storefront

Se encontraron referencias al proyecto remoto en:

- `vercel.json`;
- `public/manifest.json`;
- `src/pages/Admin.tsx`;
- `src/components/layout/Navbar.tsx`;
- `src/components/layout/Footer.tsx`;
- `supabase/functions/mercadopago-webhook/index.ts`.

Afectan imágenes, CSP, endpoints, notificaciones y recursos del correo. Aunque algunas sean imágenes públicas, dificultan el aislamiento local y pueden fallar si el proyecto remoto cambia o deja de existir.

## MP-10 — Bundle grande del storefront

**Severidad: P2**

El build informa un vendor bundle de aproximadamente `1.28 MB` sin comprimir. Puede afectar carga inicial, dispositivos móviles, rendimiento y tiempo hasta interacción.

## MP-11 — Browserslist desactualizada

**Severidad: P2**

Durante el build apareció un warning por datos antiguos de `caniuse-lite`. No rompe el sistema, pero puede producir información desactualizada sobre compatibilidad de navegadores.

## MP-12 — Espacios finales y líneas vacías

**Severidad: P2**

`git diff --check` detectó espacios y líneas vacías en varios archivos modificados. No rompe la aplicación, pero el estado no está completamente limpio desde el punto de vista de calidad del código.

## MP-13 — Docker healthy no garantiza un entorno seguro

**Severidad: P1/P2**

Los contenedores responden correctamente:

- storefront: puerto 8080;
- ERP: puerto 8081;
- health checks: HTTP 200.

El problema es que Docker puede servir una aplicación correctamente levantada, pero compilada contra el backend equivocado:

```text
Docker healthy != entorno local seguro
```

## Checks que sí pasaron

- `npm run lint`: 0 errores, 21 warnings.
- `npm run typecheck:erp`: PASS.
- `npm run build`: PASS.
- `npm run build:erp`: PASS.
- `npm run test:run`: 5 archivos, 41 tests PASS.
- `http://127.0.0.1:8080/health`: 200.
- `http://127.0.0.1:8081/health`: 200.
- Contenedores Docker de storefront y ERP: `healthy`.

Estos checks prueban compilación y disponibilidad HTTP, no aislamiento del backend ni seguridad de pagos.

## Limitaciones de la auditoría

No se probaron pagos reales, MercadoPago real, webhooks reales, credenciales de producción, navegación E2E, flujo completo de compra, rollback real, restauración de backup ni conexión autorizada al Supabase remoto.

Por eso, los riesgos de MercadoPago y webhook son conclusiones basadas en revisión estática del código y configuración, no en una transacción real.

## Prioridad recomendada

1. Impedir que el entorno local utilice un `.env` remoto por accidente.
2. Hacer que el webhook falle cerrado si falta `MERCADOPAGO_WEBHOOK_SECRET`.
3. Garantizar que el descuento de stock sea atómico y reintentable.
4. Definir cómo se sincroniza el stock legacy con el stock del ERP.
5. Reducir el bundle del storefront.
6. Actualizar Browserslist.
7. Limpiar warnings de formato.
8. Actualizar la documentación de verificación de Stage 9.
