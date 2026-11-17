# Supabase local de NicTech

Este directorio es la fuente versionada del esquema. La preparación y las pruebas de base de datos descritas aquí son locales.

## Comandos permitidos

```bash
npm run db:start
npm run db:test
npm run db:stop
```

`npm run db:start` inicia el stack local. En este equipo, la CLI 2.115.0 requiere que
`C:\Users\Gime\.supabase\profile` contenga `supabase`; ese archivo no contiene credenciales.

El arranque usa `--ignore-health-check` porque algunos servicios tardan más que el timeout de la
CLI en Windows. Los puertos locales se asignan fuera del rango reservado de Windows 54193–54492:

| Servicio | Endpoint local |
|---|---|
| API, Auth, REST, Realtime y Functions | `http://127.0.0.1:55421` |
| PostgreSQL | `127.0.0.1:55422` |
| Studio | `http://127.0.0.1:55423` |
| Mailpit web | `http://127.0.0.1:55424` |
| Mailpit SMTP | `127.0.0.1:55425` |
| Mailpit POP3 | `127.0.0.1:55426` |
| Analytics | `127.0.0.1:55427` |
| Vector | `127.0.0.1:55428` |
| Supavisor pooler (deshabilitado por defecto) | `127.0.0.1:55429` |
| PostgreSQL shadow, para migraciones | `127.0.0.1:55420` |

El storefront local usa la URL de API `http://127.0.0.1:55421`. El ERP puede usar un proyecto
Supabase remoto mediante su propio archivo `apps/erp/.env` o las variables `ERP_SUPABASE_*`
para construirlo con Docker.

El contenedor `vector` puede reiniciarse porque la imagen no logra acceder al socket Docker de
Windows. Es un componente de observabilidad y no bloquea la aplicación, la base ni Storage. Para
arrancar sin ese componente opcional:

```bash
npx supabase start --ignore-health-check --exclude vector
npx supabase status
```

No se ejecuta `supabase db reset` durante la preparación normal: puede destruir datos locales.

## Aplicaciones en Docker

Crear una copia local de `.env.example` como `.env`. Configurar `VITE_SUPABASE_*` con el
Supabase local para el storefront y `ERP_SUPABASE_*` con la URL y la publishable key del proyecto
remoto para el ERP. Las variables del ERP son obligatorias al usar este compose; su ausencia
impide construir una imagen que apunte por accidente a la base local. Luego construir y levantar
las dos aplicaciones:

```bash
docker compose -f docker-compose.apps.yml --env-file .env up --build -d
```

- Storefront: `http://127.0.0.1:8080`
- ERP: `http://127.0.0.1:8081`

El compose de aplicaciones es independiente del compose administrado por la CLI de Supabase.
El build del ERP recibe la URL y la publishable key públicas; no incluye credenciales de servicio
en las imágenes. Vite lee `apps/erp/.env` al desarrollar el ERP fuera de Docker.

## Comandos prohibidos sin autorizacion expresa

```bash
supabase link
supabase db push
supabase migration up --linked
supabase db reset --linked
```

No se debe copiar un `project-ref` remoto dentro de `supabase/.temp`. Antes de cualquier despliegue futuro se debe identificar el proyecto correcto, obtener un esquema y respaldo autoritativos, revisar diferencias y recibir autorizacion del usuario.

Las migraciones nuevas deben ser idempotentes al reconstruir una base vacia, tener seed determinista y sumar pruebas en `supabase/tests/database` para permisos, RLS, restricciones y transacciones.

## Primer responsable local

El seed no crea usuarios ficticios. Despues de registrar un usuario real en Auth local, se
inicializa el primer responsable desde un contexto confiable con rol de servicio:

```sql
select erp.bootstrap_owner(
  '<local-auth-user-uuid>'::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid
);
```

La funcion rechaza usuarios autenticados comunes, perfiles ya asignados a otra organizacion y
organizaciones sin el rol `owner` activo.
