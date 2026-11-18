# E2E de la tienda

En PowerShell, desde la raíz:

```powershell
npm ci
npx playwright install chromium

# Preview: compila con la configuración pública obtenida del bundle publicado.
node e2e/tienda/build-preview.mjs
Remove-Item Env:E2E_BASE_URL -ErrorAction SilentlyContinue
npm run test:e2e:tienda

# Sitio publicado: no levanta servidor local ni publica el build.
$env:E2E_BASE_URL = 'https://www.nictech.com.ar'
npm run test:e2e:tienda
Remove-Item Env:E2E_BASE_URL
```

Chromium, un worker, desktop (1280×800) y mobile (390×844, táctil). El build y el preview usan `envDir: false` y una salida aislada en `e2e/tienda/dist/`, para que otro build no reemplace los assets mientras corre la suite. El extractor valida la key con un GET al catálogo, no la imprime ni escribe archivos de entorno. La key pública queda en el bundle de Vite, como en el sitio publicado.

## Red y consola

- Todas las pruebas importan `fixtures.ts`. El bloqueo se registra en la página y en el contexto (incluye primeras navegaciones de popups); se deshabilitan service workers y WebSockets. Las peticiones a Mercado Pago, las funciones Edge no simuladas y las escrituras REST/Auth se abortan. En `orders` solo se admite GET.
- El único RPC que llega al servidor es `get_product_click_counts` (consulta de solo lectura). La validación de carrito hace **GET** a `products`, `product_variants` y `storefront_promotion_prices`. Seguimiento intercepta `get_repair_by_tracking_code` y `get_repair_by_tracking_code_erp` y devuelve `[]`: el adaptador ERP escribe contadores de rate limit y el cutover puede enrutar el RPC legacy al adaptador.
- El checkout intercepta la Edge con 200, 409 o 400 y sirve el destino de pago falso dentro del contexto. Nunca se envían los datos del pagador a un servidor. Las pruebas de galería/carrito usan variantes y stock interceptados cuando no hay datos reales aptos; las imágenes siguen siendo públicas. Una oferta con fecha se comprueba con datos deterministas, además de comprobar por separado los datos reales de promos y combos.
- Lista blanca de errores de consola: 400/409 del **mock** de checkout, carga fallida del POST a `product_clicks` **si** el guard lo abortó, y el log 404 del cliente únicamente para la ruta inexistente de prueba. No hay excepciones generales ni de terceros. Las excepciones de página fallan el test.

Reportes JSON y capturas: `test-results/tienda-{preview,remoto}*`. Reportes HTML: `playwright-report/tienda-{preview,remoto}/`. Revisión de la ejecución: [docs/qa/e2e-tienda-2026-11-17.md](../../docs/qa/e2e-tienda-2026-11-17.md).
