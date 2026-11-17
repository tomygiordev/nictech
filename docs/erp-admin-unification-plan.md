# Plan de unificación Panel Admin web → ERP

> Elaborado el 2026-11-14 sobre `dev/erp`, a partir de `docs/erp-admin-unification-context.md` y `docs/erp-catalog-input-contract.md`.
> Es un plan, no hay nada implementado. Continúa el plan de catálogo S1–S6 (Engram #1221) y lo extiende al resto del admin.
> Versión 3 (2026-11-14): incorpora las decisiones del usuario (sección 5) y el estado real de producción (sección 2 bis).
> **Estado al 16/11/2026: ver sección 6.** Producción es `qatkzvlomuaoaxlfgjfa`; las menciones a `tuzpcofywkhglkqplhnn` en las secciones 2 y 2 bis son históricas (relevamiento del 14/11).

## 0. Para el agente que ejecuta

**Objetivo:** que el ERP (`apps/erp/`) sea el único lugar de gestión y que el panel admin de la tienda (`/admin`) quede reducido a banners y blog.

**Por dónde empezar:** lo pendiente de la Etapa 0 (commits, volcado del DDL legacy, tipos). Después, Etapa 1. Una etapa por vez; no empezar la siguiente sin que el usuario haya aprobado la anterior.

**Reglas que no se negocian:**

- La base `qatkzvlomuaoaxlfgjfa` es **producción y la tienda está en vivo** (desde el 16/11/2026; reemplaza a `tuzpcofywkhglkqplhnn`, que quedó como proyecto viejo). No aplicar migraciones, desplegar Edge Functions ni escribir datos ahí sin el visto bueno explícito del usuario para esa acción puntual. La puesta en producción sigue `docs/erp-production-runbook.md`.
- Nunca `reset` ni `seed`. Docker no se usa. Las pruebas de base van con fixtures temporales y rollback.
- Toda migración es aditiva: no se borran columnas ni tablas de `public`.
- **No borrar registros existentes**, ni de `public` ni de `erp`, aunque estén inactivos o parezcan de prueba. Los ajustes de estructura están autorizados; el borrado de datos no.
- No ocultar ni bloquear ninguna pestaña del admin por cuenta propia: el corte de cada módulo lo decide el usuario.
- Convenciones de `CLAUDE.md` y `AGENTS.md`: sin `any`, Zod en todo formulario, shadcn primero, no editar a mano los tipos generados.
- Decisiones de negocio ya fijadas en `docs/erp-catalog-input-contract.md` §4 (precio final ARS con IVA incluido, IVA desglosado, un solo resolver, dólar con preview y aprobación, un SKU físico para N modelos).
- El árbol de trabajo tiene cambios sin commitear ajenos a este plan: preservarlos y no mezclarlos en commits sin revisarlos.

**Qué entregar al cerrar cada etapa:** migraciones y tests, pantallas, script de migración de datos con dry-run, resultado de los criterios de aceptación de la etapa, y lo que quedó sin verificar.

**Contexto de origen:** `docs/erp-admin-unification-context.md` (relevamiento) y `docs/erp-catalog-input-contract.md` (contrato de campos). Los números de catálogo de esos dos documentos están desactualizados; valen los de la sección 2 bis.

## 1. Regla que ordena todo

**El ERP escribe, la web lee.** Las tablas `public.*` de catálogo pasan a ser una proyección de solo lectura de `erp.*`. Hoy el puente es bidireccional y esa es la raíz de casi todas las incompatibilidades: una promo o el dólar del admin pisan el precio base del ERP, y una venta rápida aparece como "ajuste".

Cada etapa sigue el mismo ciclo, que es lo que la hace reversible:

1. **Construir** en el ERP lo que falta (migración aditiva + pantalla).
2. **Migrar** los datos de ese grupo de campos (mismos UUID, script con dry-run).
3. **Ocultar** la pestaña del admin detrás de una bandera de servidor. Volver atrás es prender la bandera.
4. **Canario**: durante 1–2 semanas, un trigger registra cualquier escritura legacy sobre ese grupo de campos que no venga de la proyección. Si el registro queda vacío, nadie depende de esa pestaña.
5. **Bloquear** en base: se corta el sentido `public → erp` para ese grupo y la escritura directa falla con error claro.
6. **Borrar** el código del admin recién en la etapa final.

Ninguna etapa borra columnas ni tablas de `public`; la tienda en producción sigue leyendo lo mismo salvo donde se indica.

**El ERP todavía está en desarrollo y prueba, y el local sigue operando con el admin.** Por eso cada etapa tiene dos momentos separados:

- **Construcción** (pasos 1 y 2): se hace y se prueba en el ERP sin tocar la operación diaria. El admin sigue funcionando igual.
- **Corte** (pasos 3 a 5): es el día en que el local empieza a usar ese módulo del ERP de verdad. Lo decide el usuario, módulo por módulo, cuando lo probó y le sirve.

Se puede avanzar con la construcción de varias etapas antes de hacer el primer corte. El orden de los cortes va de menor a mayor impacto en la rutina del local: catálogo, precios, reparaciones, stock y ventas, promos.

**Alcance mínimo.** El local tiene hoy 41 productos y 99 unidades; el ERP tiene unos 30 módulos. El riesgo es que sobren funciones, no que falten. La salida a producción usa solo **catálogo, punto de venta, caja y reparaciones**. Los demás módulos quedan ocultos por permisos hasta que el usuario los pida. No se construye nada para datos que hoy no existen (precios en USD, fundas multimodelo).

**No se migra la forma de cargar del admin.** La ficha del ERP se diseña para guiar la carga y corregir los problemas de la sección 2 ter, no para copiar las cinco pantallas actuales.

## 2. Lo que verifiqué en el código (además del documento de contexto)

- **Reparaciones: son dos sistemas paralelos, confirmado.** `/seguimiento` llama a `get_repair_by_tracking_code` (legacy, código `XXXX-XXXX` o DNI). El ERP expone `public.get_repair_tracking(token)` con token de 64 hex, y la web no lo llama en ningún lado. Además `public.repairs`, `repair_logs` y `get_repair_by_tracking_code` **no figuran en ninguna migración del repo**: se crearon fuera de él.
- **El resolver de precios no es invocable desde la tienda.** `erp.resolve_catalog_effective_price` exige usuario autenticado con permisos ERP. La web anónima necesita una proyección, y el checkout debe llamarlo con service role.
- **El checkout sigue cobrando el precio del padre** (`create-mercadopago-preference/index.ts:174`). El webhook ya invoca al ERP (`mercadopago-webhook/index.ts:459`).
- **`erp.products` ya tiene** `public_description`, `web_image_path`, `publish_on_web`, `allow_online_sale`. **No tiene** tags, condición, capacidad, USD ni galería. No existe tabla de medios.
- **`erp.price_lists` existe pero sin vigencia** (`price_entries` es append-only con `effective_at`). `PricingWorkspace` hoy solo captura cotizaciones.
- **`product_images` no es una tabla, es el bucket de Storage** donde el admin sube las fotos; la tienda lee `products.image_url` y `products.additional_images`. `inventory_movements` solo lo leen pantallas del admin (`Admin.tsx`, `DashboardModule`, `InventoryHistory`).
- **Las migraciones del puente (`20260923050000`–`050006`) y `20260924000000` están sin trackear en git**, junto con sus tests.
- **Producción es el proyecto "Nictech" de Supabase** (confirmado por el usuario). Falta comprobar que su ref sea `tuzpcofywkhglkqplhnn`: el doc S1 lo llama producción y la memoria del plan #1221 lo llama dev. No pude consultar la base (el MCP de Supabase no está autorizado en esta sesión), así que tampoco sé qué migraciones del ERP y del puente están aplicadas ahí.
- **Reparaciones viejas, forma de los datos:** `repairs` guarda DNI, nombre, teléfono, marca, modelo, localidad (Urdinarrain / Gilbert), problema, notas, estado (enum de 5 pasos) y `tracking_code`; `repair_logs` guarda notas con `is_public`. El ERP exige cliente, sucursal, número de orden por contador y eventos de estado.

## 2 bis. Estado real de producción (relevado el 2026-11-14, solo lectura)

Proyecto "NicTech", ref `tuzpcofywkhglkqplhnn`. Es el único proyecto de NicTech en la cuenta: **el ERP en desarrollo (`apps/erp/.env`) apunta a esta misma base**, no hay entorno de prueba separado. El sitio en vivo muestra 41 productos, igual que la base.

| Dato | Baseline 2026-10-20 | Hoy |
|---|---|---|
| Migraciones aplicadas | — | Las 99 del repo, sin drift |
| Puente (triggers de catálogo, referencias, proyección y captura de stock) | Activo | Activo |
| Productos web (`public.products`) | 199 | **41**, todos activos; 36 creados el 2026-11-04 |
| Variantes web | 275 | **0** |
| Productos ERP | 223 | 260: 41 activos y publicados, **219 inactivos** (172 desactivados el 2026-11-04) |
| Variantes ERP | 294 | 294, **ninguna activa** |
| Diferencias de precio web vs ERP | 0 | 0 |
| Stock web | 435 | 99 |
| Stock ERP | 499 | 593: 99 en productos activos y **494 en productos inactivos** |
| Promos activas | 2 | **8, todas sin fecha de vencimiento** |
| Productos con precio USD | 1 | 0 |
| Productos con galería | — | 0 |
| Productos con tags / con condición, capacidad y modelo | — | 41 / 8 (los smartphones) |
| Compatibilidades multimodelo | — | 191 filas, solo 4 sobre productos activos |
| Reparaciones (`public.repairs`) | — | **4, todas marcadas como borradas**; la última es de marzo de 2026 |
| Reparaciones ERP, clientes ERP, ventas ERP | — | 0 / 0 / 0 |
| Pedidos web, auditoría de pagos, clics de producto | — | **0 / 0 / 0** |
| `inventory_movements` | — | 0 |
| Blog / banners | — | 2 / 2 |
| Sucursales ERP | — | 1 ("Sucursal central"); las reparaciones viejas usan localidad "Gilbert" |
| Edge Functions | — | `create-mercadopago-preference`, `mercadopago-webhook`, `mp-webhook` (duplicado del anterior, mismo código) y `get-dollar-rate` |

Lo que esto cambia:

- **El catálogo se rehízo en noviembre.** Hay 41 productos y ninguna variante: las migraciones de datos de las etapas 1, 4 y 5 son mucho más chicas de lo previsto.
- **No hay historial de reparaciones que migrar.** Las únicas 4 filas están borradas. La etapa 6 se reduce a conectar `/seguimiento` con el ERP.
- **No hay pedidos web ni ventas registradas.** El riesgo de tocar el checkout en la etapa 2 baja mucho.
- **Quedan 494 unidades de stock en productos desactivados.** Si esa mercadería ya no existe, hay que darla de baja con un ajuste formal para que los reportes del ERP no la cuenten.
- **Las migraciones legacy del storefront están en el repo como marcadores vacíos** (su SQL original no está), así que el DDL de `repairs`, `orders`, etc. solo existe en la base.

## 2 ter. Cómo se carga hoy y qué hay que corregir

Revisión de los 41 productos reales (2026-11-14). El admin tiene cinco pantallas de carga (inventario, celulares, fundas, variantes, promos), unas 11.000 líneas, casi sin campos obligatorios ni validación. El resultado en los datos:

| Problema | Ejemplo real | Corrección en el ERP |
|---|---|---|
| Colores como productos separados; 0 variantes en uso | "Wallet Cuero Magnetic – Azul" y "– Blanco"; "Cable Power Ringo (BLACK)" y "(WHITE)" | Color siempre como variante, con stock y foto propios |
| Marca escrita en el nombre y campo vacío | Baseus, Mcdodo, Karsen, TP-Link, Genius sin `brand_id`; solo los 8 celulares lo tienen | Marca obligatoria como campo (con opción "Genérico") |
| Tag usado como campaña | Los 41 productos tienen el tag "CYBERMONDAY" | Campañas con vigencia (etapa 4); tags solo para características |
| Sin costo | `base_cost = 0` en los 41 | Costo obligatorio al cargar, aunque sea estimado |
| Códigos ilegibles | `WEB-c70e6f1d892f...` | Código corto automático por categoría (`CAB-0012`) y código de barras del envase |
| Promo inconsistente | Motorola G23: precio $184.900 con precio original $93.390 | El ERP rechaza una promo cuyo precio no sea menor al de lista |
| Nombres sin criterio | Mayúsculas mezcladas, "CHARGUNG", "LIGHTING", un tabulador al final de un nombre | Nombre sugerido (tipo + marca + modelo + especificación), editable, con espacios normalizados |
| Categoría equivocada | "Cargador de pared tipo C Karsen" dentro de "Cables de datos" | Se corrige en el saneamiento de la etapa 1 |
| Carga manual masiva | 36 de 41 productos cargados a mano el 2026-11-04 | Importación desde planilla con vista previa |
| Usados como producto con stock 1 | 6 celulares usados, cada uno irrepetible | Unidad única con IMEI en el módulo de equipos usados |

## 2 quater. Ambigüedades de la base y ajuste propuesto

Revisión de estructura del 2026-11-14 (solo lectura). Tamaño: `public` tiene 18 tablas; `erp` tiene **178 tablas, 260 funciones y 7 vistas, con 125 tablas vacías**. El ERP no tiene ventas, clientes ni reparaciones reales: es el momento más barato para ordenar, antes de que haya datos que cuidar.

| # | Ambigüedad | Evidencia | Ajuste |
|---|---|---|---|
| A | **Dos copias del catálogo** que se sincronizan con triggers en ambos sentidos | `public.products` ↔ `erp.products`, `public.product_variants` ↔ `erp.product_variants`, y lo mismo para categorías, marcas y modelos (97 modelos en un lado y 99 en el otro) | Estado final: las tablas de catálogo de `public` se reemplazan por **vistas de solo lectura sobre `erp`**. Desaparecen los triggers de sincronización, la captura de stock y cualquier posibilidad de que las dos copias difieran. Paso intermedio: triggers en un solo sentido (etapas 1 a 4). |
| B | **Cuatro banderas para decidir si algo se ve en la web** | `is_active ∧ publish_on_web ∧ allow_online_sale ∧ can_sell`. En los datos solo existen dos combinaciones: todo prendido (41) o apagado (219) | Un único estado visible para el operador: Borrador / Publicado / Pausado. Las banderas quedan como detalle interno derivado de ese estado. |
| C | **Nombre, descripción e imagen duplicados** en versión interna y pública | `internal_name`/`public_name`, etc. En los 41 productos activos el nombre público nunca difiere del interno | La ficha muestra un solo nombre, una descripción y una foto principal. El campo público solo se usa si alguien lo distingue a propósito. |
| D | **Dos formas de dar precio a una variante** | `price_delta` (legacy) y `final_price_ars`. Ninguna variante tiene `price_delta` distinto de 0 | Quitar `price_delta` del resolver y marcar la columna como obsoleta. Queda una sola regla: precio propio o heredado. |
| E | **Atributos de variante sin estructura** | `attributes jsonb` libre + `name`; en `public`, `color` y `capacity` como texto y tablas sueltas `colors` y `capacities` | Color = eje de variante, con catálogo de colores en `erp` (nombre y hex). Capacidad y condición = atributos del producto. Se define en la etapa 1 y no se usa JSON libre para datos que la web filtra. |
| F | **Dos formas de decir "modelo"** | `products.model_id` (uno) y `product_compatible_models` (N) | Regla por tipo de producto: `model_id` significa "es este modelo" (celulares); la tabla N:M significa "sirve para" (accesorios). La ficha muestra una u otra, nunca las dos. |
| G | **Datos muertos de pruebas y del catálogo anterior** | 219 productos y 294 variantes inactivos, 494 unidades de stock en productos inactivos, 187 compatibilidades huérfanas, 2.374 eventos de auditoría, 50 documentos de stock | **No se borra nada** (decisión del usuario, 2026-11-14): son registros y se conservan. Los inactivos se filtran por defecto en todas las pantallas y reportes del ERP. Queda pendiente decidir si las 494 unidades se dan de baja con un ajuste formal de stock, que no borra nada y queda registrado. |
| H | **Restos del sistema viejo** | Tablas vacías `inventory_movements` y `payment_audit_log`; funciones `decrement_stock`, `process_approved_order`, `restore_expired_promos`, `count_repairs_by_status`; `dollar_settings`; `public.repair_statuses`; Edge Function duplicada `mp-webhook` | Se eliminan en la etapa 7, cuando ya nadie las llama. Las tablas están vacías, no se pierde nada. |
| I | **Estados de reparación que no coinciden** | La web muestra 5 pasos (Recibido, Diagnóstico, Repuestos, Reparación, Finalizado); el ERP tiene 4 estados (Recibido, Diagnóstico, Reparación, Listo para entregar) y solo 3 transiciones | Definir el catálogo de estados del ERP antes de la etapa 6: agregar "Esperando repuestos" y "Entregado", con sus transiciones y su paso web. |
| J | **Dos registros de pedidos** | `public.orders` (JSONB) y `erp.web_orders`, ambos vacíos | Dejar escrito el rol de cada uno: `public.orders` es la entrada del checkout; `erp.web_orders` es el pedido operativo. No se mira `public.orders` desde ninguna pantalla de gestión. |
| K | **Estructura sobredimensionada** | 8 ubicaciones para un local con 99 unidades; módulos completos sin uso (armados de PC, contabilidad, cuentas corrientes, WhatsApp) | No se borra: borrar cuesta más que dejarlo. Se ocultan los módulos y las ubicaciones que no se usan, y no se agrega nada a esos módulos hasta que el local los pida. |
| L | **Organización fija** | `organization_id` en todas las tablas, una sola organización y su UUID escrito a mano en las funciones del puente | No se toca. Regla para código nuevo: usar `erp.current_organization_id()`, nunca el UUID literal. |

## 3. Etapas

Orden de construcción: 0 → 0B → 1 → 2 → 6 → 3 → 4 → 7. Reparaciones (6) sube porque no comparte tablas con el catálogo y su corte no depende de que el local use POS ni caja. La etapa 5 (multimodelo) y la parte de USD de la etapa 4 quedan **postergadas** hasta que existan datos que las necesiten.

### Etapa 0 — Base firme (sin cambios funcionales)

| | |
|---|---|
| **Alcance** | Saber exactamente qué hay en producción y dejar el repo en un estado desde el que se pueda desplegar por partes. |
| **Trabajo** | (a) Confirmar el ref del proyecto "Nictech", listar las migraciones aplicadas contra las 99 del repo y comprobar si el puente (sincronización de catálogo, proyección y captura de stock) está realmente activo en producción. Definir dónde se prueba el ERP mientras está en desarrollo: si hoy se prueba contra producción, toda migración nueva necesita un entorno de prueba o fixtures con rollback antes de aplicarse. (b) Correr `scripts/check-erp-catalog-baseline.sql` y comparar con el baseline del 2026-10-20. (c) Commitear el árbol sucio en commits lógicos: puente, storefront/checkout, tutoriales del admin, docs. Revisar `scratch_fix_users*.sql` antes de decidir si se commitean o se descartan. (d) Volcar el DDL de las tablas legacy que no están en migraciones (`repairs`, `repair_logs`, `repair_statuses`, `inventory_movements`, `dollar_settings`, `hero_banners`, `posts`…) a un archivo de referencia. (e) Regenerar `src/integrations/supabase/types.ts`. (f) Contar: reparaciones abiertas en `public.repairs`, órdenes en `erp.repair_orders`, promos activas, productos con `price_usd`, grupos de fundas clonadas. |
| **Migraciones** | Ninguna nueva. |
| **Se apaga** | Nada. |
| **Hecho el 2026-11-14** | (a), (b) y (f): ver sección 2 bis. Sin drift de migraciones y puente activo. |
| **Pendiente** | (c) commits, (d) volcado del DDL legacy, (e) tipos. Además: decidir el entorno de prueba (hoy el ERP en desarrollo escribe sobre producción), decidir qué hacer con las 494 unidades en productos inactivos, y borrar la Edge Function duplicada `mp-webhook` si Mercado Pago no la tiene configurada como destino. |
| **Aceptación** | `git status` limpio; lista de drift de migraciones; baseline actualizado; los conteos de (f) escritos en este documento. |
| **Riesgo** | Bajo. Solo lectura sobre la base. |

### Etapa 0B — Ajuste de base antes de construir

Deja la base sin ambigüedades para que las etapas siguientes no las arrastren. Refiere a la tabla de la sección 2 quater.

| | |
|---|---|
| **Requisito previo** | Entorno de prueba definido (segundo proyecto Supabase o equivalente). Estas migraciones se prueban ahí primero. |
| **Sin riesgo, se hacen primero** | D (quitar `price_delta` del resolver), B y C (estado único y nombre único en la ficha; son cambios de pantalla y de RPC, no de datos), F (regla por tipo), I (catálogo de estados de reparación), K (ocultar módulos y ubicaciones sin uso por permisos y configuración), borrar la Edge Function duplicada `mp-webhook` tras confirmar que Mercado Pago no la usa. |
| **Datos viejos (G): no se borran** | Decisión del usuario: **no eliminar registros**. Ningún script de esta etapa hace `delete` ni `truncate` sobre datos existentes. Lo que sí se hace: los listados, buscadores y reportes del ERP excluyen por defecto productos y variantes inactivos, con un filtro "ver inactivos" para consultarlos. Relevado: los inactivos concentran 321 de los 365 movimientos de stock y 318 de los 359 saldos, así que sin ese filtro los reportes de stock no reflejan la mercadería real. |
| **Alcance autorizado** | El usuario autorizó ajustar la **estructura** de la base cuando afecte la calidad del ERP (columnas, restricciones, funciones, vistas, triggers). Eso no incluye borrar datos, y cada migración sigue probándose primero fuera de producción. |
| **Se posterga a su etapa** | A (vistas en lugar de tablas) se completa en la etapa 7; E (atributos de variante) en la etapa 1; H (restos legacy) en la etapa 7. |
| **Aceptación** | El resolver devuelve el mismo precio que antes para los 41 productos. La cantidad de filas de cada tabla es la misma antes y después de la etapa. Los listados del ERP muestran 41 productos por defecto. Tests de base verdes. |
| **Riesgo** | Bajo: son cambios de estructura y de pantalla, sin borrado de datos. |

### Etapa 1 — Ficha completa y borrador por defecto

Resuelve incompatibilidades 1, 2 y 7. Es lo que más le duele al usuario (carga de productos).

| | |
|---|---|
| **Dónde vive cada dato** | `tags text[]`, `condition` (enum nuevo/usado/reacondicionado) y `capacity text` como **columnas de `erp.products`**, porque en la web son atributos del producto y `erp.products` no tiene `attributes`. Fotos en una **tabla nueva `erp.product_media`** (producto, variante opcional, ruta en Storage, orden, principal). La descripción ya tiene columna. |
| **Migraciones / RPC** | Columnas + tabla de medios. RPC `erp.save_catalog_product_sheet` de guardado atómico (ficha + variantes + medios; si falla una subida no queda ficha a medias). `create_catalog_product_with_variants` pasa a `publish_on_web = false`. RPC `erp.publish_catalog_product` con checklist en servidor: foto principal, precio > 0, categoría, nombre público. Extender la proyección: `tags`, `condition`, `capacity`, `image_url`, `additional_images`. |
| **Pantallas ERP** | `CreateProductModal` y `ProductEditModal`: bloque "Publicación web" (fotos, descripción, tags, capacidad, condición), estado Borrador / Publicado y botón Publicar con los faltantes listados. |
| **Ficha guiada** | Una sola ficha con **plantilla por tipo** (Celular, Accesorio, Funda): cada tipo muestra solo sus campos y define cuáles son obligatorios. Reemplaza las cinco pantallas del admin. Marca obligatoria. Costo obligatorio. Nombre sugerido para todos los tipos, editable y que no se resetea al cambiar precio o foto. Color siempre como variante: la ficha ofrece "agregar color" en lugar de duplicar el producto. |
| **Códigos** | Código interno corto automático con prefijo por categoría. Campo de código de barras pensado para lector, usando los identificadores de variante que ya existen. Los códigos `WEB-…` actuales se reemplazan en el saneamiento; verificar antes que `products_prevent_code_reassignment` lo permita o agregar un comando explícito de recodificación. |
| **Saneamiento de los 41 productos** | Script con dry-run, revisado por el usuario antes de aplicar: unir productos que son colores del mismo artículo en uno con variantes (pasando el stock con documentos formales), asignar marca, corregir categorías y nombres, recodificar. El costo lo completa el usuario en una planilla. |
| **Etapa 1B — Importación desde planilla** | Carga masiva por CSV o Excel con vista previa, validación fila por fila y creación en borrador. Se construye después del corte de la etapa 1, si el usuario confirma que va a seguir cargando por lotes. |
| **Etapa 1C — Celulares usados** | Cargar cada usado como unidad única con IMEI desde el módulo de equipos usados, y publicarlo en la web desde ahí. Requiere habilitar ese módulo; se hace solo si el usuario lo pide. Mientras tanto, los usados siguen como producto con stock 1. |
| **Web** | Sin cambios: sigue leyendo las mismas columnas. |
| **Datos** | Backfill `public → erp` de tags (41 productos) y de condición y capacidad (8 smartphones), con los mismos UUID. Hoy ningún producto usa galería. Los productos ya publicados quedan publicados. |
| **Se apaga** | Pestañas `products` (celulares), el alta/edición de `inventory` y `variants`. La clave `nictech_hidden_variant_cats` se descarta: la visibilidad pasa a ser `is_active` de la variante. |
| **Aceptación** | Un producto creado en el ERP no aparece en `/tienda` hasta publicarlo. Publicar sin foto falla con mensaje. Editar descripción no toca stock ni resetea el nombre. Conciliación: 0 diferencias en los campos nuevos entre `erp` y `public`. |
| **Riesgo** | Medio. La proyección de imágenes toca lo que ve el cliente; se valida con la conciliación antes de bloquear. |

### Etapa 2 — Un solo precio en mostrador, web y checkout

Resuelve la incompatibilidad 3.

| | |
|---|---|
| **Diseño** | Extraer el cálculo a una función interna sin chequeo de permisos (no expuesta por la API). La usan el RPC actual del POS, la proyección y el checkout. Columna nueva `public.product_variants.price` con el precio efectivo ya resuelto, mantenida por trigger cuando cambia `base_sale_price` o `final_price_ars`. |
| **Edge Function** | `create-mercadopago-preference` deja de leer `products.price` y pide el precio al resolver con service role, por producto y variante. La columna pública es solo para mostrar; el cobro siempre sale del resolver. |
| **Web** | `ProductCard`, `ProductDetailModal`, `CartContext` y `Checkout` muestran el precio de la variante elegida; la tarjeta muestra "desde $X" si las variantes difieren. `validateCart()` también revalida precio. |
| **Regla de publicación** | Mercado Pago cobra con 2 decimales. El checklist de publicar rechaza precios con más de 2 decimales. Lo tomo como definido salvo que el usuario diga lo contrario. |
| **Orden de despliegue** | Migración aditiva → Edge Function → frontend. Reversible con `ERP_CHECKOUT_PAUSED` (ya existe) y redeploy de la función anterior. |
| **Se apaga** | Nada del admin. |
| **Aceptación** | Para una variante con precio propio: POS, tarjeta web, carrito, preferencia de MP y `orders.items` muestran el mismo importe. Los casos de redondeo del contrato S1 §6.3 pasan en los tres canales. |
| **Riesgo** | Alto por tocar el cobro. Mitigación: comparar antes del corte el precio viejo y el nuevo de todo el catálogo; solo deberían diferir las variantes con precio propio. |

### Etapa 3 — Stock y ventas rápidas por el ERP

Resuelve la incompatibilidad 6.

| | |
|---|---|
| **Reemplazos** | `QuickSaleModal` → Punto de venta + Caja. `QuickRestockModal` → `StockIntakeModal` o Compras cuando hay proveedor y costo. `StockMovementModal` y la edición de stock de `UnifiedInventory` → Existencias. |
| **Salida a producción** | Es el primer corte que cambia la rutina diaria del local, y el ERP todavía no se usa en la operación. Antes del corte: usuarios y roles creados, medios de pago y caja configurados, una prueba piloto de una jornada con ventas reales cargadas en paralelo en el admin y en el ERP, y conciliación de stock y caja al cierre. Recién con el piloto conciliado se oculta la pestaña. |
| **Antes de apagar** | Confirmar que la carga rápida del ERP no es más lenta que el modal viejo: un ingreso de mercadería sin orden de compra en pocos pasos, y una venta de mostrador con caja abierta. Si falta, se agrega acá. |
| **Migraciones** | `capture_storefront_stock_delta` deja de convertir escrituras directas en ajustes y pasa a rechazarlas (salvo la proyección). Primero en modo canario, después bloqueo. |
| **`inventory_movements`** | Se congela: sin escrituras nuevas, queda como histórico consultable. No se migra al ERP; el stock inicial ya entró por la importación de apertura. |
| **Se apaga** | Pestaña `inventory` completa y los tres modales. `InventoryHistory` queda de solo lectura hasta la etapa 7. |
| **Aceptación** | Dos semanas sin escrituras directas a `public.*.stock` en el canario. Toda venta de mostrador tiene comprobante y movimiento de caja. Proyección de stock con 0 discrepancias. |
| **Riesgo** | Medio, más operativo que técnico: cambia la rutina del local (abrir caja, usar POS). |

### Etapa 4 — Promos y dólar

Resuelve la incompatibilidad 5. Requiere la etapa 2.

| | |
|---|---|
| **Campañas** | Tabla `erp.campaigns`: nombre ("Cyber Monday"), `starts_at`, `ends_at`, estado. Una campaña agrupa promociones y reemplaza el uso del tag como marca de campaña: la página `/promos` de la web lista los productos de las campañas vigentes. Al vencer, todo vuelve solo al precio de lista. Una promo también puede existir sin campaña. |
| **Validación** | Una promo se rechaza si su precio no es menor al precio de lista. La promo invertida del Motorola G23 se corrige con el usuario antes de migrar. El tag "CYBERMONDAY" se quita de los 41 productos al migrar a la campaña. |
| **Promos** | Tabla `erp.promotions`: campaña opcional, producto, variante opcional, precio promo final ARS o porcentaje, `starts_at`, `ends_at`, quién la creó, cancelación. El resolver devuelve precio de lista y precio vigente según la fecha; al vencer vuelve solo al de lista, sin job ni acción manual. Es más simple que montar listas de precios con vigencia y cubre lo que hoy hace `PromoManagement`. |
| **Proyección** | `public.products.price` vuelve a ser siempre el precio de lista; la promo se proyecta aparte (`promo_price`, `promo_starts_at`, `promo_ends_at`). La web decide por fecha si la muestra; el checkout lo decide el resolver. Cambian `Tienda`, `Promos`, `Combos`, `ProductCard` y `ProductDetailModal`, que hoy leen `original_price` / `sale_expires_at`. |
| **USD (postergado)** | Hoy no hay productos en USD: no se construye hasta que haga falta. En esta etapa solo se apaga `DollarSettings`. Diseño previsto para cuando se necesite: `erp.products.price_mode` (`ars_fixed` / `usd_linked`) y `price_usd`. Capturar cotización genera un preview (`price_change_previews`) solo para los `usd_linked`; aplicar requiere aprobación. La web sigue mostrando la etiqueta USD desde la proyección. |
| **Pantallas ERP** | En `PricingWorkspace`: lista de promos con alta/baja y vigencia, y la bandeja de previews de cambio por dólar. |
| **Datos** | Las 8 promos activas: `base_sale_price = original_price` y una fila en `erp.promotions` con el precio rebajado. Ninguna tiene vencimiento, así que hay que definir una fecha de fin o permitir promos sin fin. Hoy no hay productos en USD, por lo que esa parte no tiene datos que migrar. Se hace en una sola transacción junto con el corte del sentido `public.price → erp.base_sale_price`. |
| **Se apaga** | `PromoManagement` y `DollarSettings`. El recálculo horario corre en el navegador del admin, así que ocultarlo ya lo detiene. |
| **Aceptación** | Una promo vencida deja de aplicarse en web y POS sin tocar nada. Capturar una cotización no cambia ningún precio. Los productos `ars_fixed` no aparecen en ningún preview. El POS cobra precio de lista salvo promo vigente. |
| **Riesgo** | Alto en el instante del corte: si queda una promo a medio migrar, el POS cobra mal. Mitigación: migrar con la tienda en `ERP_CHECKOUT_PAUSED` y conciliar antes de reabrir. |

### Etapa 5 — Compatibilidad multimodelo en la tienda

Resuelve la incompatibilidad 4.

> **Postergada.** Hoy no hay fundas activas en el catálogo. Se construye cuando el local vuelva a cargar fundas; hasta entonces `CaseManagement` se oculta junto con el resto del catálogo en el corte de la etapa 1.

| | |
|---|---|
| **Proyección** | Tabla `public.product_compatible_models (product_id, model_id)`, lectura anónima, mantenida desde `erp.product_compatible_models`. `public.products.model_id` queda como modelo principal. |
| **Web** | El filtro por modelo y marca de `Tienda.tsx` usa la tabla de compatibilidad; la ficha muestra "Compatible con: …". |
| **Consolidar fundas clonadas** | Por grupos confirmados por una persona, nunca por coincidencia automática de nombre. Para cada grupo: elegir el producto que sobrevive, asignarle los N modelos, pasar el stock de los clones con documentos formales de stock (queda auditado) y **desactivar** los clones. No se borran ni se redirigen UUID: los pedidos históricos guardan los ítems como snapshot en JSONB y los clones inactivos siguen existiendo. |
| **Herramienta** | Script SQL por lotes con dry-run que lista los grupos candidatos; el catálogo es chico y no justifica una pantalla. |
| **Estado hoy** | Entre los 41 productos activos no hay fundas y solo 4 filas de compatibilidad. Si las fundas se vuelven a cargar directamente en el ERP como un producto con N modelos, no queda nada que consolidar y esta etapa se reduce a la proyección y el filtro web. |
| **Se apaga** | `CaseManagement`. |
| **Aceptación** | Una funda compatible con iPhone 13 y 14 aparece en ambos filtros con un único stock. La suma de stock antes y después de consolidar coincide por grupo. |
| **Riesgo** | Medio. La consolidación es difícil de deshacer; por eso va por lotes chicos y con revisión previa del dry-run. |

### Etapa 6 — Reparaciones en el ERP y seguimiento en la web

Decidido por el usuario: las reparaciones pasan a cargarse en el ERP y el cliente **sigue entrando a `/seguimiento` en la web** con su código o DNI. Después del corte queda un único sistema de reparaciones.

**No hay historial que migrar:** `public.repairs` tiene 4 filas, todas borradas, la última de marzo de 2026. Las reparaciones arrancan de cero en el ERP, sin importador.

| | |
|---|---|
| **Código de seguimiento** | Columna nueva `erp.repair_orders.public_tracking_code` con el formato actual `XXXX-XXXX`, única por organización. Cada orden lo recibe en el ingreso (`intake_repair_order`) con la misma regla de `generateTrackingCode()` (sin I, O, 0, 1). El código se imprime en el comprobante de ingreso. El token largo del ERP queda para links, no lo reemplaza. |
| **Seguimiento web** | En el corte se **redefine `get_repair_by_tracking_code`** para que lea del ERP y devuelva exactamente la misma forma que hoy (datos del equipo, estado de 5 pasos, logs públicos). `Seguimiento.tsx` y `RepairTimeline` no cambian. Busca por código o por DNI del cliente, como ahora. Se agrega límite de intentos en servidor: hoy la espera entre búsquedas es solo del navegador. |
| **Estados** | Columna `public_stage` en `erp.repair_statuses` que mapea cada estado del ERP a uno de los 5 pasos web (Recibido, Diagnóstico, Repuestos, Reparación, Finalizado). Los estados internos sin equivalente (por ejemplo, esperando aprobación de presupuesto) se muestran con el paso más cercano. |
| **Pantallas ERP** | `RepairsWorkspace`: mostrar y buscar por código de seguimiento y DNI, y notas públicas o internas con la misma facilidad que hoy tiene el admin. El ERP tiene una sola sucursal ("Sucursal central") y el admin distingue Urdinarrain y Gilbert: confirmar con el usuario si hacen falta dos sucursales. |
| **Corte** | Un solo día: cambiar el RPC y ocultar la pestaña `repairs`. Volver atrás es restaurar el cuerpo anterior del RPC y mostrar la pestaña; las tablas viejas no se tocan. |
| **Se apaga** | Pestaña `repairs` completa. `GlobalSearch` deja de buscar en `public.repairs`. Las tablas viejas quedan congeladas. |
| **Aceptación** | Una reparación ingresada en el ERP se encuentra en `/seguimiento` por código y por DNI, con el paso correcto de los 5. Al cambiar el estado en el ERP, la web lo refleja. Ninguna nota interna aparece en la web. Un código inexistente no revela datos y los intentos repetidos quedan limitados. |
| **Riesgo** | Medio: es lo que el cliente final usa directamente, pero no hay datos previos que puedan romperse. El DDL legacy no está en el repo (la etapa 0 lo documenta). |

### Etapa 7 — Admin mínimo y cierre

| | |
|---|---|
| **Contenido web** | Banners, carrusel y blog **se quedan en la web**, en un `/admin` reducido a esas pestañas más un acceso al ERP. Es la decisión ya registrada (Engram #1261): el ERP no es un CMS. |
| **Pedidos y dashboard** | Verificar de punta a punta que un pago aprobado genera `erp.web_orders`, reserva stock y se puede preparar con `fulfill_web_order`. `DashboardModule` e `InventoryHistory` se eliminan: los reemplaza el Centro operativo. |
| **Acceso** | Cada usuario del admin con membresía y rol en el ERP. Un rol "Contenido web" sin permisos de catálogo para quien solo carga banners y blog. |
| **Catálogo público como vistas** | Con el admin ya sin escribir, `public.products`, `product_variants`, `categories`, `brands` y `models` se reemplazan por vistas de solo lectura sobre `erp` con los mismos nombres y columnas, de modo que la tienda y el checkout no cambian. El stock sale de `erp.stock_balances` y el precio del resolver. Se eliminan todos los triggers del puente. Se prueba primero en el entorno de prueba comparando fila por fila la vista contra la tabla actual; volver atrás es restaurar las tablas desde el backup tomado ese día. |
| **Cierre técnico** | Eliminar los restos legacy del punto H de la sección 2 quater. Eliminar los triggers `public → erp`, revocar escritura sobre las tablas de catálogo de `public` a `authenticated`, borrar los componentes retirados de `src/components/admin/` y la clave de `localStorage`. |
| **Aceptación** | `grep` de escrituras (`insert`/`update`/`delete`/`upsert`) en `src/` solo encuentra `posts`, `hero_banners`, `carousel_settings`, `product_clicks` y `orders` (checkout). Canarios en cero. Build y tests verdes. |
| **Riesgo** | Bajo si las etapas anteriores cerraron su canario. |

## 4. Resumen de apagado del admin

| Pestaña | Se oculta en | Se bloquea en base en | Condición |
|---|---|---|---|
| `products`, `variants`, alta/edición de `inventory` | Etapa 1 | Etapa 1 | Conciliación de campos nuevos en 0 |
| `inventory` (stock), venta y reposición rápidas | Etapa 3 | Etapa 3 | Canario de stock en 0 |
| `promos`, `DollarSettings` | Etapa 4 | Etapa 4 | Promos y USD migrados |
| `cases` | Etapa 1 | Etapa 1 | No hay fundas activas; la carga multimodelo queda para la etapa 5 |
| `repairs` | Etapa 6, día del corte | Etapa 6 | `/seguimiento` leyendo del ERP |
| `dashboard` | Etapa 7 | Etapa 7 | Todas las demás pestañas apagadas |
| `banners`, `blog` | No se apagan | — | — |

## 5. Decisiones

Resueltas por el usuario el 2026-11-14:

- **D1. Producción** es el proyecto "Nictech" de Supabase. Falta solo comprobar el ref en la etapa 0.
- **D2. El ERP está en desarrollo y prueba**; el local todavía opera con el admin. De ahí la separación entre construcción y corte, y el piloto previo de la etapa 3.
- **D3. El cliente sigue su reparación desde `/seguimiento` en la web**, con código o DNI. El ERP adopta el código `XXXX-XXXX`.
- **D5. Las reparaciones pasan al ERP.** El usuario pidió migrar el historial, pero en producción no hay reparaciones vigentes, así que arrancan de cero.

Tomadas por defecto, a confirmar:

- **D4. Precios web con 2 decimales como máximo.** El ERP guarda 4; publicar exige 2.
- **Banners y blog se quedan en un admin web mínimo**, según la decisión previa registrada en Engram #1261.
- **Búsqueda por DNI en `/seguimiento` se mantiene** para no cambiarle la costumbre al cliente, con límite de intentos en servidor.

Pendientes del usuario, no bloquean empezar:

- **Entorno de prueba.** Hoy el ERP en desarrollo escribe sobre producción. Recomendado: un segundo proyecto Supabase para desarrollo antes de crear las migraciones de la etapa 1. Alternativa: seguir sobre producción solo con fixtures y rollback.
- **Las 494 unidades de stock en productos desactivados:** ¿se dan de baja con un ajuste formal?
- **Las 8 promos sin vencimiento:** ¿se les pone fecha de fin o se permiten promos sin fin?
- **Sucursales:** ¿una sola o Urdinarrain y Gilbert por separado?
- **Costos:** el usuario completa el costo de los 41 productos en una planilla durante la etapa 1.
- **Importación desde planilla (1B) y celulares usados con IMEI (1C):** se hacen solo si el usuario las confirma.

## 6. Estado al 16/11/2026

Este estado sale de la auditoría final del 17/11/2026: código sin commitear en `plan/auditoria-adia` y verificación **solo local**, con PostgreSQL 18 sobre esquema y datos de prod, Vitest y builds.

**Nada está aplicado en producción (`qatkzvlomuaoaxlfgjfa`).** Prod sigue con 99 migraciones, hasta `20261022001512`. Hay 24 pendientes, de `20261114100000` a `20261117100000`. La puesta en producción se hace con `docs/erp-production-runbook.md`.

### 6.1 Implementado y verificado en local

| Etapa | Estado | Evidencia local |
|---|---|---|
| 0 (d) DDL legacy | Hecho: `supabase/reference/legacy-public-schema.sql` | — |
| 0B + 1 catálogo | Ficha completa (`CatalogSheetModal`), borrador, media, publicación con guard de 2 decimales, descripción interna y stock inicial por color (H8), overlay consolidado | pgTAP `erp_catalog_*` verde, vitest ERP |
| 2 precio único | `resolve_catalog_effective_price_internal`, precio por variante, la función de preferencia re-resuelve precio y stock, 409 antes de crear la orden (H2) | `erp_unified_price_projection` 11/11, `deno check` OK |
| 3 stock y venta rápida | Carga rápida de stock y venta en el ERP, perfil de módulos "salida" | vitest |
| 4 promos (sin USD) | Promos ERP (`PromotionsPanel`), vista `storefront_promotion_prices`, tienda y carrito con precio vigente, scripts de corte y rollback | `erp_campaigns_promotions` 50/50; corte y rollback simulados sobre datos de prod |
| 6 reparaciones | Código `XXXX-XXXX`, rate limit, notas públicas, switch y rollback; migración `20261117100000_legacy_tracking_status_cast` corrige el `42804` del RPC legacy sin reemplazar el adaptador ERP activo | `erp_repairs_public_tracking` 48/48; ciclo switch→rollback OK; estados del respaldo: 0 fuera del enum y 0 nulos |
| Cortes (W3) | Banderas por grupo (todas en `off`), canarios `observe`/`block`, pestañas del admin con banderas (falla abierta), rol `web_content` (sin permisos), conciliación | `erp_storefront_cutover_flags` 65/65; simulación observe→block→off en los 4 grupos |
| Pedido web → ERP | El webhook MP asienta venta, stock y asiento (`pricing_version` v2), idempotente | `erp_storefront_order_end_to_end` 53/53 y `erp_fulfill_online_order` 40/40 |
| Seguridad | H1 (sin owner automático, `bootstrap_first_owner`), H5 (ACL `anon`), asignación de roles con `users.manage`, RLS legacy `public.*` solo admin (27 políticas), Storage sin escritura `anon` en `product_images` | `erp_auth_bootstrap_roles`, `erp_role_assignment` y `legacy_public_rls_admin_only` 12/12 |

**Totales:**
- **pgTAP:** 44 archivos, 1885/1885 en base limpia y en tipo prod, `notok=0`.
- **Front:**
  - `typecheck:erp`: 0 errores.
  - `tsc` de la tienda: 95, todos legacy.
  - lint: 8 errores y 25 warnings (línea base).
  - vitest: 427/427 tests (50/51 archivos; falla `scripts/release-erp.test.mjs`, que es `node:test` y ya fallaba antes).
  - `build`, `build:erp` y `test:erp:desktop`: OK (10/10).

### 6.2 Decisiones tomadas por el orquestador

Detalle en la revisión de diseño y en los reportes de cada tarea:

- El rol `admin` no se siembra: owner es el único administrador global.
- `assign_profile_role` exige `users.manage` y, además, ser owner o admin.
- Promos:
  - Permisos `pricing.view` y `pricing.manage`.
  - Porcentaje menor a 100.
  - `v_list` con 4 decimales; solo el precio promocional se redondea a 2.
  - El checkout rechaza precios con más de 2 decimales (falla cerrada).
- La tienda cae al precio legacy si falla la vista de promos (falla abierta). El servidor es la autoridad (409).
- Corte de la Etapa 4:
  - `prices_promos` se pone en `block` **antes** del apply.
  - La promo invertida (Moto G23) no se migra.
  - Los 34 `CYBERMONDAY` quedan para F4.
- `get_admin_cutover_flags` solo da el fallback al admin legacy (`app_metadata.role = 'admin'`).
- `web_content`: el permiso y la RLS de contenido van en la Etapa 7.
- Pedido web:
  - Se marca `dispatched` en el pago y la entrega se registra después como `delivered`.
  - Un segundo pago aprobado del mismo checkout queda para conciliación manual.
- RLS legacy: `auth.role() = 'authenticated'` se reemplaza por `public.is_legacy_admin()`. Se dropean las 3 políticas `anon` de `product_images` (incluida la de DELETE).
- R-2: un usuario nuevo recibe un perfil activo sin roles. Se acepta con el signup apagado de forma permanente.

### 6.3 Pendiente

1. **Usuario, ya:**
   - Apagar el signup público en Auth (H1).
   - Revisar los `profile_roles` de prod.
   - `/seguimiento` probablemente esté roto en prod: el RPC legacy del respaldo falla con `42804` (`repairs.status` es `text` y la función declara `repair_status`). Tras aplicar la migración #24, consultar `/seguimiento` con un código real de prueba.
2. **Commits:** separar el trabajo de esta orquestación del de auditoria-adia y revisar los archivos sueltos de la raíz (`scratch_fix_users*.sql` y manuales).
3. **Aplicar en prod según el runbook:** respaldo → 24 migraciones → verificación de seguimiento y reescritura de URLs (§4.1 del runbook) → funciones (preferencia y webhooks, siempre después de las migraciones) → frontends → primer owner y roles → tipos regenerados → cortes por etapa, a criterio del usuario.
4. **Sin ensayar:** políticas de `storage.objects` (no existen en local) y un pago real de MercadoPago.
5. **Imágenes:** scripts `scripts/rewrite-legacy-storage-host.sql` y `scripts/rewrite-legacy-storage-host-rollback.sql`, ensayados localmente: dry-run → apply → verificación de Storage y carga de imágenes → rollback si falla, después de migraciones y antes del corte de catálogo. Se esperan 552 valores; ~507 eventos de auditoría nuevos están aceptados. No pausar ni borrar el proyecto viejo hasta verificar que todas las imágenes cargan desde el host nuevo y los objetos existen en Storage del proyecto nuevo. Storage no se verificó localmente.
6. **Decisiones abiertas de §5:** las 494 unidades, promos sin fin, una o dos sucursales, costos de 41 productos, USD (Etapa 4, parte dólar), multimodelo (Etapa 5), 1B y 1C.
7. **Etapa 7:** apagado del dashboard legacy y permisos de contenido web.
