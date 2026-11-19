# E2E del ERP

Requiere Docker Desktop, PostgreSQL `psql` en PATH y Chromium de Playwright (`npx playwright install chromium` si falta). Ejecutá desde la raíz; no se leen archivos `.env` ni se requieren claves externas.

PowerShell, con Docker Desktop iniciado:

```powershell
Remove-Item Env:DOCKER_HOST -ErrorAction SilentlyContinue
node e2e/erp/prepare-stack.mjs
$env:ERP_E2E_SUPABASE_WORKDIR = 'test-results/erp-supabase'
npx supabase start --workdir $env:ERP_E2E_SUPABASE_WORKDIR --ignore-health-check --exclude vector,logflare,edge-runtime,studio,postgres-meta,imgproxy,mailpit,realtime
try {
  # start puede restaurar un respaldo E2E anterior sin las migraciones nuevas.
  npx supabase migration up --local --workdir $env:ERP_E2E_SUPABASE_WORKDIR
  if ($LASTEXITCODE -ne 0) { throw "No se pudieron aplicar las migraciones al stack E2E." }
  $env:ERP_E2E_RUN_LABEL = 'run-1'
  npm run test:e2e:erp
  $env:ERP_E2E_RUN_LABEL = 'run-2'
  npm run test:e2e:erp
} finally {
  npx supabase stop --workdir $env:ERP_E2E_SUPABASE_WORKDIR
}
```

El proyecto descartable toma migraciones y seed de `supabase/`, normalizados a LF. Usa los mismos puertos del proyecto local; si ese proyecto está activo, detenelo antes con `npx supabase stop`, **sin** `--no-backup`. El setup rechaza una base con cuentas ajenas a la suite y rota las contraseñas de QA en memoria. Conserva los movimientos y los registros contables entre corridas para no sortear el ledger; cada caso usa nombres únicos. Si necesitás vaciar el entorno de QA, detenelo con `npx supabase stop --project-id nictech-erp-e2e --no-backup`; no uses esa opción en tu proyecto habitual.

`storefront-fixture.sql` cubre las tablas legacy que el stack ERP no crea. Activa el puente real y configura el bucket local para que las verificaciones de catálogo, promociones y pago se apoyen en proyecciones reales. El webhook se prueba en su RPC transaccional: no se conecta a Mercado Pago ni ejecuta la Edge Function. Las fotos son sintéticas.

Sin etiqueta, la salida JSON se escribe en `test-results/erp.json`, con traces y capturas en `test-results/erp-artifacts/`. Con etiqueta, cada corrida conserva su JSON y sus artefactos separados. Estos archivos pueden contener credenciales locales de prueba; no los versionés.

Las capturas de revisión se guardan en `test-results/erp-screens/`: `<módulo>-<pantalla>.png` a 1366×768 y `<módulo>-<pantalla>-1024.png` a 1024×768. La segunda corrida reemplaza las capturas homónimas. Ambas resoluciones se capturan en la misma sesión, sin repetir mutaciones.

Cada test adjunta un diagnóstico de excepciones JS, errores de consola y respuestas HTTP de error del navegador. La credencial incorrecta acepta un único `POST /auth/v1/token` con HTTP 400 y su mensaje de recurso de Chromium. El caso de permisos verifica aparte el rechazo SQLSTATE `42501` por el cliente Supabase de Node. Un 4xx/5xx distinto no se ignora.
