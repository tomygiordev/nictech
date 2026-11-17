# Contrato de Entradas de Catálogo, Precios, Inventario y Conciliación ERP (S1)

**Proyecto:** NicTech ERP & Storefront  
**Fase:** S1 — Documentación y Conciliación de Baseline Read-Only  
**Referencia:** Engram #1221 / prompt606  
**Ambiente Verificado:** Supabase Producción (`tuzpcofywkhglkqplhnn`) — Snapshot 2026-10-20  
**Última Migración DB:** `supabase/migrations/20260924000000_dynamic_user_organization.sql`  

---

## 1. Alcance y Límites de la Entrega S1

Este documento establece el contrato exhaustivo de campos, validaciones, resolución de precios y reglas de inventario para la migración del catálogo administrativo legado hacia el núcleo ERP centralizado de NicTech.

- **Entregable S1:** Documentación técnica integral (`docs/erp-catalog-input-contract.md`) y script SQL de conciliación de sólo lectura (`scripts/check-erp-catalog-baseline.sql`).
- **Límite Estricto:** S1 no modifica componentes de UI, ni endpoints, ni esquemas de base de datos, ni datos de negocio. No se realizan mutaciones, commits ni escrituras.
- **Implementación posterior (S2–S6):** La implementación de resolvers en servidor, guardado atómico, nuevas pantallas compactas y retiro de sincronizaciones legacy se ejecutará en los slices subsiguientes conforme a la planificación aprobada.

---

## 2. Snapshot de Conciliación Baseline (2026-10-20)

La consulta de auditoría de solo lectura ejecutada contra la base de datos de producción (`tuzpcofywkhglkqplhnn`) arrojó las siguientes métricas exactas:

| Métrica de Baseline | Valor Verificado | Observaciones Técnicas |
|---|---|---|
| **Productos Públicos (`public.products`)** | `199` | Catálogo actualmente proyectado en e-commerce. |
| **Variantes Públicas (`public.product_variants`)** | `275` | Variantes de color/stock activas en web. |
| **Productos ERP (`erp.products`)** | `223` | Incluye 199 compartidos + 24 artículos internos/repuestos. |
| **Variantes ERP (`erp.product_variants`)** | `294` | Incluye 275 compartidas + 19 variantes exclusivas ERP. |
| **Mapeo de UUID Compartidos** | `199 / 199 (100%)` | Todos los productos públicos comparten UUID exacto con el ERP (`0` huérfanos). |
| **Mapeo de Variantes UUID** | `275 / 275 (100%)` | Todas las variantes públicas comparten UUID exacto con el ERP (`0` huérfanas). |
| **Paridad de Precio Base** | `0 diferencias` | `public.products.price == erp.products.base_sale_price` en el 100% de las filas compartidas. |
| **Tasa de IVA en ERP** | `100% en 21%` | Las 199 filas tienen `tax_rate_percent = 21.0000`. Ningún registro en 0%. |
| **Entradas en Historial de Precios (`erp.price_entries`)** | `0` | El histórico de listas está limpio; los precios residen en la ficha maestra. |
| **Productos Legacy con Precio USD (`price_usd`)** | `1` | UUID `401a31ce-c23f-4e6e-9398-d70a9d477720` ($369.600 ARS / 240 USD, cotiz. implícita 1.540). |
| **Promociones Activas Legacy (`original_price`)** | `2` | 2 productos con precio rebajado y precio original de referencia. |
| **Stock Global ERP On-Hand (`erp.stock_balances`)** | `499.0000` | Suma de stock físico en todas las ubicaciones (`0.0000` reservado). |
| **Ubicaciones Web Calificadas** | `2` | `is_active = true` y `contributes_to_web_stock = true`. |
| **Unidades Padre Proyectadas a Web** | `435` | Proyección exacta: `public.products.stock` suma exactamente 435 (`0` discrepancias). |
| **Unidades Variantes Proyectadas a Web** | `318` | Proyección exacta: `public.product_variants.stock` suma exactamente 318 (`0` discrepancias). |
| **Banderas de Puente Activas** | `1 organización` | `catalog_sync`, `stock_projection` y `stock_capture` activas en Org `10000000-0000-0000-0000-000000000001`. |
| **Monedas Activas de Organización** | `ARS (base), USD` | ARS base activa; USD operativa activa. |

> [!IMPORTANT]
> **Regla Contable de Inventario (Prohibición de Doble Conteo):**
> NUNCA se deben sumar unidades padre + unidades variantes. En productos con variantes, el stock del padre representa la agregación de sus variantes. El stock total físico en ERP de 499 unidades abarca ubicaciones técnicas/internas que no proyectan a la web; por ello no es directamente comparable con las 435 unidades web calificadas.

---

## 3. Correcciones Críticas a Premisas de Esquema Previas

1. **`erp.products` NO posee columna `attributes`:**  
   El esquema actual de `erp.products` (`supabase/migrations/202608190002_erp_master_data.sql:175-244`) almacena únicamente `brand_id`, `model_id`, `category_id`, descripciones e imágenes. Solo `erp.product_variants` dispone de la columna `attributes jsonb not null default '{}'::jsonb`. Cualquier atributo extendido a nivel producto (como tags, materiales o capacidades) se manejará mediante las columnas específicas normalizadas o extensiones explícitas planificadas en S2.
2. **`erp.price_entries` NO posee columnas `kind` ni `valid_until`:**  
   La tabla `erp.price_entries` (`supabase/migrations/202608190004_erp_purchases_costs_pricing.sql:459-480`) es un libro de hechos inmutable (*append-only fact table*) con columnas: `id`, `organization_id`, `price_list_id`, `product_id`, `variant_id`, `variant_key`, `amount`, `currency_code`, `application_id`, `effective_at` y `created_at`. La vigencia se rige cronológicamente por `effective_at` y no por una fecha de vencimiento en la fila.
3. **El estado actual de `price_delta` no es el contrato final:**  
   Aunque `erp.product_variants` contiene actualmente `price_delta numeric(18, 4) not null default 0`, el plan Engram #1221 dictamina formalmente que las variantes deben poseer **precio heredado del padre o precio final propio en ARS**, desterrando el diferencial (*delta*) relativo que induce a ambigüedades operativas y desajustes de redondeo.

---

## 4. Decisiones Arquitectónicas Resueltas (Engram #1221)

Estas decisiones están fijadas por la dirección del proyecto y no son objeto de debate:

1. **Precio Operador es Precio Final ARS:**  
   El precio introducido por el operador humano en cualquier formulario de producto o variante es siempre el **importe final a cobrar al público (con IVA incluido)**.
2. **Conservación y Desglose de IVA al 21%:**  
   Se mantiene estrictamente `tax_rate_percent = 21.0000`. El sistema desglosa el IVA retrospectivamente para el registro contable y fiscal:
   $$\text{Neto} = \text{round}\left(\frac{\text{Precio Final}}{1.21}, 2\right)$$
   $$\text{IVA} = \text{Precio Final} - \text{Neto}$$
   NUNCA se debe establecer el IVA en 0% para igualar el POS ni sumar un 21% adicional sobre los precios ya existentes en la base de datos (lo que inflaría ilegalmente los precios web).
3. **Resolver Unificado y Centralizado con Autoridad de Servidor:**  
   El motor de cálculo de precios, impuestos y descuentos residirá exclusivamente en el servidor (RPCs de Supabase y Edge Functions). El POS, el catálogo web y el checkout consumirán el mismo resolver con idénticas reglas de redondeo. Los comprobantes fiscales y ventas ya emitidos son inmutables.
4. **Captura de Cotización USD Desacoplada de Publicación:**  
   Consultar o registrar el tipo de cambio del dólar captura una cotización contable, pero **NO altera de manera automática los precios públicos**. La actualización de precios vinculados a USD requiere la generación de una vista previa explícita (`erp.price_change_previews`) y su confirmación deliberada por el operador (`erp.price_change_applications`).
5. **Invariante de Precios Fijos en ARS:**  
   Cualquier actualización de cotización cambiaria USD solo afectará a los productos marcados explícitamente en modalidad USD. Los productos configurados con precio fijo en ARS permanecerán estrictamente invariantes.
6. **Compatibilidad Múltiple con SKU Físico Único:**  
   Cuando un artículo físico (funda, vidrio templado, cable) es compatible con múltiples modelos de dispositivos, debe registrarse como **un único producto/SKU físico que referencia a varios modelos**. Queda terminantemente prohibido clonar N filas de producto para N modelos, práctica que fragmentaba y falseaba el stock disponible.
7. **Retiro Seguro y Gradual de Sincronizadores Legados:**  
   Los procesos automáticos del panel web (como el recálculo en segundo plano de `DollarSettings.tsx` o la manipulación de `original_price` en `PromoManagement.tsx`) se mantendrán activos hasta que el circuito ERP sea plenamente operativo y verificado en la entrega de corte final (cutover S6).

---

## 5. Matriz Per-Field Exhaustiva: Comportamiento Actual vs Propuesto

### A. Módulo General de Inventario y Celulares (`UnifiedInventory.tsx` y `SmartphoneManagement.tsx`)

| Campo / Control | Visibilidad / Obligatoriedad | Validación Existente en Código Fuente | Destino Actual en Base de Datos | Destino ERP Planificado (1221) | Proyección Pública Web | Prueba de Aceptación Específica (G/W/T) |
|---|---|---|---|---|---|---|
| **`category_id`** | Visible. Obligatorio por flujo. | Selector en `src/components/admin/UnifiedInventory.tsx:447-451` (`CreatableResourceSelector`). No permite guardar si no se define categoría. | `public.products.category_id` (UUID). | `erp.products.category_id` (UUID). | `public.products.category_id` con join a `categories.name`. | **G:** Operador en alta de producto. **W:** No selecciona categoría y presiona Guardar. **T:** Se impide el submit y se resalta el selector de categoría. |
| **`name` (No celulares)** | Visible (solo si categoría no es smartphone). Obligatorio. | `src/components/admin/UnifiedInventory.tsx:487-490`: `<Input required value={form.name} />`. Sin restricción arbitraria de longitud en código cliente. | `public.products.name` (`text`). | `erp.products.internal_name` y `public_name` (`text`). | Título principal de la tarjeta de producto en `/tienda`. | **G:** Producto de accesorio genérico. **W:** Se ingresa "Cargador Rápido 20W USB-C". **T:** Se guarda y proyecta con ese nombre exacto en tienda y ERP. |
| **`brand_id` / `model_id` (Celulares / Accesorios con modelo)** | Visible (si categoría es smartphone o selector activo). Obligatorio para celulares. | `src/components/admin/SmartphoneManagement.tsx:197`: `if (!currentProduct.brand_id \|\| !currentProduct.model_id)`. `src/components/admin/BrandModelSelector.tsx:456-461`. | `public.products.brand_id`, `public.products.model_id`. | `erp.products.brand_id`, `erp.products.model_id` (FKs a `erp.brands`, `erp.product_models`). | Filtros laterales de marca y modelo en `/tienda`. | **G:** Operador carga un celular. **W:** Selecciona marca "Apple" y modelo "iPhone 13". **T:** El selector filtra modelos asociados a Apple y asigna ambos UUIDs en el registro. |
| **`capacity`** | Visible en smartphones. Opcional. | `src/components/admin/UnifiedInventory.tsx:463-465` (`CreatableAttributeSelector`). Inserción libre en tabla auxiliar `capacities(name)`. | `public.products.capacity` (`text`). | `erp.product_variants.attributes->>'capacity'` o metadato en variantes. *(Nota: `erp.products` NO tiene columna attributes).* | Filtro de capacidad y sufijo en nombre comercial. | **G:** Celular con capacidad "128GB". **W:** Se selecciona del desplegable o se crea inline. **T:** Se guarda el texto sin perder el formulario y se refleja en el título compuesto. |
| **`color`** | Visible en smartphones o variantes. Opcional en padre, requerido en variantes. | `src/components/admin/UnifiedInventory.tsx:466-468` (`CreatableAttributeSelector`). Inserción libre en `colors(name)`. | `public.products.color` (`text`) o `public.product_variants.color` (`text`). | `erp.product_variants.name` y `attributes->>'color'`. | Selector de bolitas de color en la ficha del producto web. | **G:** Operador define color "Azul Medianoche". **W:** Guarda la variante. **T:** La variante en ERP vincula el atributo color y lo expone en la galería pública. |
| **`condition`** | Visible en smartphones. Opcional (valor por defecto: 'Nuevo'). | `src/components/admin/UnifiedInventory.tsx:472-479`: `<Select>` con opciones fijas: `'Nuevo'`, `'Usado'`, `'Reacondicionado'`. | `public.products.condition` (`text`). | `erp.products` (clasificación/tags) o metadato de unidad física en ingresos serializados. | Badge de estado ('Nuevo' / 'Usado') en la tienda. | **G:** Celular usado recibido para reventa. **W:** Operador selecciona "Usado". **T:** El nombre sugerido anexa "(Usado)" y en la web se exhibe la etiqueta correspondiente. |
| **Nombre sugerido (Smartphones)** | Automático/Derivado. No editable directamente en UI actual de smartphones. | `src/components/admin/UnifiedInventory.tsx:275-276` y `src/components/admin/SmartphoneManagement.tsx:229`: Generado como `[brand, model, capacity, color, condition].filter(Boolean).join(' ')`. | `public.products.name` (`text`). | `erp.products.internal_name` y `public_name`. En plan 1221: **Sugerido pero editable**, sin sobreescribir al modificar precio o foto. | Nombre del producto en e-commerce. | **G:** Se cargan datos de teléfono. **W:** El sistema propone el nombre. Operador lo ajusta manualmente. **T:** Al cambiar la foto o el precio en el futuro, el nombre editado NO se resetea al valor automático. |
| **`priceCurrency`** | Visible en formulario. Toggle 'ARS' / 'USD'. | `src/components/admin/UnifiedInventory.tsx:79-118` (`PriceToggle`). | No persiste directo como columna de moneda en `public.products`; se infiere por la presencia de `price_usd`. | `erp.products.purchase_currency` y modo en listas de precios. | Etiqueta de moneda y conversión en catálogo. | **G:** Producto cotizado en dólares. **W:** Operador elige toggle "USD". **T:** Se habilita campo USD con cálculo preview en ARS según cotización cargada. |
| **`price` (ARS Final)** | Visible. Obligatorio si moneda es ARS. | `src/components/admin/UnifiedInventory.tsx:265-267`: `parseFloat(form.price) \|\| 0`. Si es USD: `Math.round(priceUsd * dollarRate)`. | `public.products.price` (`numeric`). | `erp.products.base_sale_price` (`numeric(18, 4)`). Representa **IMPORTE FINAL CON IVA**. | Precio exhibido en carrito y checkout de Mercado Pago. | **G:** Operador fija $12.100 ARS. **W:** Se guarda el producto. **T:** En ERP `base_sale_price` es 12100.0000, el resolver calcula neto $10.000 e IVA $2.100. En POS y web el total a pagar es exactamente $12.100. |
| **`price_usd`** | Visible si moneda es USD. Obligatorio si USD activo. | `src/components/admin/UnifiedInventory.tsx:264`: `parseFloat(form.price_usd) \|\| null`. | `public.products.price_usd` (`numeric`). | Parámetro de cálculo para previews de listas en ERP. | Indicador referencial en USD si aplica. | **G:** Producto configurado a 100 USD con cotización 1.500. **W:** Se aplica la cotización. **T:** El precio ARS resulta $150.000. Una nueva consulta de cotización NO altera este valor hasta su aprobación explícita. |
| **`stock` (Padre sin variantes)** | Visible. Obligatorio (`min="0"`). | `src/components/admin/UnifiedInventory.tsx:503`: `<Input required type="number" min="0" />`. | `public.products.stock` (`integer`). | **Prohibida la sobreescritura ciega.** Destino: `erp.stock_balances` vía movimientos formales (`erp.stock_documents`). | Stock disponible para compra en tienda online. | **G:** Operador edita ficha para cambiar descripción. **W:** Presiona Guardar. **T:** El stock físico NO se modifica ni se pisa con el valor del formulario cargado previamente. |
| **`image_url` (Foto principal)** | Visible. Opcional. URL o Archivo. | `src/components/admin/UnifiedInventory.tsx:66-75`: Archivo máx. 5MB. Extensiones: JPEG, PNG, WebP, GIF. UUID generado para Storage bucket `product_images`. | `public.products.image_url` (`text`). | `erp.products.web_image_path` (`text`). | Imagen de portada en grilla y detalle de producto. | **G:** Operador sube imagen JPG de 2MB. **W:** Se sube a Supabase Storage y se guarda la URL pública. **T:** Si la subida falla, la ficha NO se guarda parcialmente corrupta. |
| **`additional_images` (Galería)** | Visible. Opcional. Múltiples archivos. | `src/components/admin/UnifiedInventory.tsx:286-288`: Mismas reglas de tipo y peso (máx 5MB). | `public.products.additional_images` (`text[]`). | Planificado: Galería multimedia asociada al producto en ERP. | Carrusel de fotos secundarias en página de producto. | **G:** Operador agrega 3 fotos adicionales. **W:** Guarda el producto. **T:** Las fotos existentes se conservan y las nuevas se anexan al arreglo sin duplicar URLs. |
| **`tags`** | Visible. Opcional. Array de strings. | `src/components/admin/UnifiedInventory.tsx:530-550`: Input de texto que añade etiquetas al presionar Enter o botón (+). | `public.products.tags` (`text[]`). | Planificado: Clasificación por etiquetas en catálogo ERP. | Filtros temáticos y badges en tienda. | **G:** Se ingresan tags "Oferta", "Gamer". **W:** Guarda producto. **T:** Los tags se normalizan sin duplicados (`Set`) y persisten en la base de datos. |
| **`description`** | Visible. Opcional. Texto multilínea. | `src/components/admin/UnifiedInventory.tsx:551-555`: `<Textarea rows={2} />`. | `public.products.description` (`text`). | `erp.products.public_description` y `internal_description`. | Pestaña de descripción técnica en la web. | **G:** Operador redacta detalles del producto. **W:** Guarda el formulario. **T:** El texto se preserva idéntico, admitiendo saltos de línea y caracteres especiales. |

---

### B. Módulo de Fundas y Artículos Multimodelo (`CaseManagement.tsx`)

| Campo / Control | Comportamiento Actual (Legado) | Deficiencia Crítica Detectada | Comportamiento Propuesto / Requerido (1221) |
|---|---|---|---|
| **`modelIds` (Selección de Modelos)** | Permite selección múltiple de teléfonos (`src/components/admin/CaseManagement.tsx:74`). | **Clonación de Productos:** Líneas 270–292 iteran `modelIds.map()` e insertan un registro independiente en `public.products` por cada modelo seleccionado, con `stock = 0`. | **Un Solo Producto / SKU Físico:** Se crea una sola entidad de producto físico en ERP que vincula un conjunto de modelos compatibles (relación N:M). |
| **Gestión de Stock Multimodelo** | Cada clon tiene su propio saldo de stock desconectado. | Si una funda física calza en iPhone 13 y iPhone 14, registrar stock en uno no actualiza el otro, generando quiebres o sobreventas. | **Stock Único Compartido:** Las unidades físicas residen en un balance único; la venta para cualquier modelo compatible descuenta del mismo stock compartido. |
| **Colores y Variantes de Fundas** | Selector de 17 colores fijos (`FIXED_COLORS`) en `src/components/admin/CaseManagement.tsx:50-54`. | Variantes creadas como hijas del producto individual clonado; difícil mantenimiento lote. | Matriz de variantes centralizada por SKU físico: color, foto, código y estado independiente. |

---

### C. Módulo de Variantes de Color y Precios (`VariantManagement.tsx`)

| Campo / Control | Comportamiento Actual (Legado) | Comportamiento Requerido (Engram #1221) |
|---|---|---|
| **Precio de la Variante** | En web actual, las variantes en `product_variants` solo tienen `color`, `stock`, `image_url` e `is_active`. El precio se toma del padre (`public.products.price`). | **Precio Propio o Heredado:** Cada variante puede heredar el precio final del padre o especificar un precio final absoluto en ARS propio. |
| **`price_delta` en ERP** | `erp.product_variants.price_delta` almacena un diferencial numérico. En `PosWorkspace.tsx:337` se suma al precio base. | **Desestimado como contrato final:** No se avala `price_delta`. Provoca errores de redondeo e inconsistencias con el precio exhibido al cliente. El contrato requiere valor final cerrado. |
| **Categorías Ocultas** | `src/components/admin/VariantManagement.tsx:90-97`: Almacena categorías ocultas en `localStorage` del navegador (`nictech_hidden_variant_cats`). | **Persistencia Centralizada:** Las preferencias de catálogo y visibilidad deben responder al estado del servidor (`is_active` o filtros en BD), no al almacenamiento local de un único navegador. |
| **Pausado de Variante** | Campo `is_active boolean` en `product_variants`. | Pausar una variante oculta su disponibilidad web sin destruir su historial contable ni alterar saldos físicos en ERP. |

---

### D. Módulo de Promociones y Descuentos (`PromoManagement.tsx`)

| Campo / Control | Comportamiento Actual (Legado) | Comportamiento Requerido (Engram #1221) |
|---|---|---|
| **`mode` (Porcentaje / Fijo)** | `src/components/admin/PromoManagement.tsx:34`: `'percent' \| 'fixed'`. Calcula descuento y nuevo precio en ARS y USD. | El cálculo de promociones debe regirse por reglas de servidor auditables con fecha de inicio y fin. |
| **Almacenamiento de Oferta** | `src/components/admin/PromoManagement.tsx:154-160`: Sobreescribe destructivamente `public.products.price = precioConDescuento`, guardando el valor anterior en `original_price` y fecha en `sale_expires_at`. | **Listas de Precios / Reglas Promocionales:** El precio base del producto no debe corromperse. La promo debe gestionarse mediante listas promocionales temporales en ERP. |
| **Expiración de Promo** | Si expira, requiere ejecución en cliente o retiro manual (`handleRemovePromo`, líneas 174–200) restaurando `price = original_price`. | El servidor resuelve el precio vigente evaluando la validez temporal automáticamente; al vencer, retorna al precio regular sin intervención manual ni riesgo de desfase. |
| **Retiro en Cutover** | Actualmente existen 2 promociones activas bajo este esquema legado. | Se mantienen intactas en S1; su migración hacia listas de precios ERP se ejecutará en S5/S6 cuando el reemplazo esté probado. |

---

### E. Módulo de Cotización Dólar y Automatismos (`DollarSettings.tsx`)

| Aspecto | Comportamiento Actual (Legado) | Comportamiento Requerido (Engram #1221) |
|---|---|---|
| **Frecuencia y Disparo** | `src/components/admin/DollarSettings.tsx:128-144`: Se dispara automáticamente al montar el componente si pasaron > 60 min, y mediante un `setInterval` cada 1 hora. | **Captura Desacoplada:** El ERP puede capturar cotizaciones externas de forma programada o manual, pero **NUNCA modifica precios de venta de forma automática**. |
| **Impacto en Precios** | `src/components/admin/DollarSettings.tsx:89-112`: Ejecuta un bucle `for` actualizando masivamente `public.products.price = Math.round(p.price_usd * newRate)`. | **Previsualización y Aprobación:** La cotización genera una vista previa de cambios (`price_change_previews`). Un operador debe aprobar y aplicar (`price_change_applications`) explícitamente el lote. |
| **Riesgo Operativo** | Una fluctuación repentina o falla en la API externa impacta directamente en el checkout sin supervisión humana. | Precios protegidos por inmutabilidad y aprobación requerida con registro de usuario auditor (`applied_by`). |

---

### F. Módulo de Reposición Rápida (`QuickRestockModal.tsx`)

| Aspecto / Campo | Comportamiento Actual (Legado) | Comportamiento Requerido (Engram #1221) |
|---|---|---|
| **Entradas del Formulario** | - Producto / Variante (`selected`, `selVariant`)<br>- Cantidad: `qty` (`Input`, `min="0"`)<br>- Costo Unitario: `cost` (`Input`, numérico opcional)<br>- Proveedor: `supplier` (`Input`, texto libre opcional)<br>- Notas: `notes` (`Input`, texto libre opcional) | Mismos campos operativos amigables para el usuario, manteniendo la simplicidad del modal rápido, pero respaldados por documentos formales de stock en ERP. |
| **Comportamiento en Carrito (Merge)** | `src/components/admin/QuickRestockModal.tsx:330-336`: Si el ítem ya existe en el carrito temporal (misma clave `productId::variantId`), suma la cantidad: `qty = existing.qty + qtyNum` y actualiza el costo al último ingresado: `unitCost = costNum`. | Se conserva el merge intuitivo en la interfaz para no frustrar la carga rápida del operador. |
| **Grabación en Base de Datos (Fallo Crítico Legado)** | `src/components/admin/QuickRestockModal.tsx:376-402`: Calcula en cliente `newStock = item.currentStock + item.qty` y ejecuta un `UPDATE products SET stock = newStock`. | **PROHIBIDA LA SOBREESCRITURA DIRECTA:**<br>1. Si hubo ventas entre la apertura del modal y la confirmación, el método actual **sobrescribe y destruye** el saldo real.<br>2. El ERP registrará un movimiento de inventario formal (`erp.stock_documents` y `erp.stock_moves`) con tipo `receipt` / `purchase` y cantidad incremental `+qty`.<br>3. El saldo final se calcula a partir del libro mayor de stock, asegurando concurrencia e idempotencia. |
| **Costo y Comprobante** | Guarda costo en `inventory_movements.unit_price` y emite un remito HTML imprimible `#ING-YYYYMMDD-HHMMSS` (`lines 57-194`). | El costo ingresado se registra como costo de adquisición del lote en la recepción de compra, sin alterar el costo estándar de catálogo (`base_cost`) salvo política explícita. |

---

## 6. Especificación del Resolver de Precios y Reglas de Redondeo

### 6.1. Discrepancia Actual de IVA: POS vs Storefront

En el estado actual del repositorio se identificó la siguiente divergencia operativa:
- **Tienda Web / Carrito (`public.products.price`):** El cliente abona el precio publicado $P$. Si un producto tiene `price = 10000`, la pasarela cobra $10.000 ARS.
- **POS ERP (`apps/erp/src/features/pos/PosWorkspace.tsx:305-307`):** Toma `base_sale_price` (que tras la importación equivale exactamente a $P$) y le aplica la función `calculateLineTax(baseArs, 1, 21)` sumando un 21% adicional:
  $$\text{Total POS} = 10.000 + 2.100 = 12.100 \text{ ARS}$$
  Cobrando en mostrador un 21% más que en la web para el mismo artículo.

### 6.2. Algoritmo del Resolver Centralizado (Objetivo S2)

El resolver de precios de servidor unificará el cálculo para todos los canales (POS, Tienda Web, Checkout Mercado Pago, Presupuestos de Reparación):

```
Entrada:
  producto_id: UUID
  variante_id: UUID (opcional)
  cantidad: integer
  canal: 'pos' | 'web' | 'checkout'

Proceso:
  1. Obtener precio final nominal fijado por el operador (Pf) en ARS:
     - Si variante tiene precio propio: Pf = variante.precio_final_ars
     - Si no: Pf = producto.base_sale_price (ARS)
  2. Obtener tasa de impuesto aplicable: T = producto.tax_rate_percent (actualmente 21.0000%)
  3. Desglosar componentes fiscales:
     - Subtotal Neto Unitario = round(Pf / (1 + T / 100), 2)
     - Impuesto Unitario (IVA) = round(Pf - Subtotal Neto Unitario, 2)
     - Total Línea = Pf * cantidad
  4. Salida:
     - total_ars: Pf * cantidad
     - neto_ars: Subtotal Neto Unitario * cantidad
     - iva_ars: Impuesto Unitario * cantidad
     - tax_rate: T
```

### 6.3. Casos de Prueba de Redondeo (Acceptance Test Cases)

| Caso | Precio Final Operador | Tasa IVA | Neto Calculado | IVA Calculado | Total a Cobrar | Verificación de Invariante |
|---|---|---|---|---|---|---|
| **1. Número Redondo** | `$12.100,00` | 21% | `$10.000,00` | `$2.100,00` | `$12.100,00` | $10.000,00 + 2.100,00 = 12.100,00$ (Exacto) |
| **2. Fraccionario Típico** | `$1.000,00` | 21% | `$826,45` | `$173,55` | `$1.000,00` | $826,45 + 173,55 = 1.000,00$ (Sin pérdida de centavos) |
| **3. Céntimos Complejos** | `$3.499,99` | 21% | `$2.892,55` | `$607,44` | `$3.499,99` | $2.892,55 + 607,44 = 3.499,99$ (Cuadre perfecto) |
| **4. Celular USD Convertido** | `USD 240,00` (TC: $1.540) | 21% | `$305.454,55` | `$64.145,45` | `$369.600,00` | Coincide con el único producto USD del baseline |

---

## 7. Plan de Auditoría de Consumidores Backend (Para Slice S2)

En la entrega S2 se auditarán y adaptarán los siguientes consumidores para garantizar que ninguno continúe realizando cálculos de IVA desacoplados:

1. **POS Workspace (`apps/erp/src/features/pos/PosWorkspace.tsx`):**
   - Retirar la suma de IVA sobre `base_sale_price` en líneas 305–307 y 551–562.
   - Consumir el precio devuelto por el resolver como precio bruto final.
2. **Checkout Storefront (`src/pages/Checkout.tsx`):**
   - Verificar la validación de montos antes de enviar la preferencia a Mercado Pago.
3. **Edge Function `create-mercadopago-preference` (`supabase/functions/create-mercadopago-preference/index.ts`):**
   - Asegurar que tome los precios directamente de la base de datos con desglose formal sin alterar el monto final pactado.
4. **Edge Function `mercadopago-webhook` (`supabase/functions/mercadopago-webhook/index.ts`):**
   - Confirmar conciliación de pagos ARS contra las órdenes registradas en ERP.
5. **Módulo de Facturación Interna / AFIP (`erp.pos_internal_invoice_issuance`):**
   - Auditar generación de comprobantes para que la base imponible y el IVA debitado coincidan al centavo con el desglose del resolver.

---

## 8. Verificación de Integridad de Pruebas y Límites de Infraestructura

- **Chequeo de Tipos TypeScript:** `PASS` verificado en todo el proyecto.
- **Pruebas de Componentes Desktop:** `10 / 10 PASS`.
- **Vitest Unit/Integration Tests:** `25 archivos PASS / 117 tests PASS`.
  *(Nota técnica: el único fallo reportado corresponde a `scripts/release-erp.test.mjs`, el cual está escrito para el runner nativo de Node.js `node:test` y no para Vitest).*
- **Aviso sobre Docker y Fixtures:** Conforme a la política de infraestructura del proyecto, **Docker ya no se utiliza**. Todas las pruebas de base de datos futuras se estructurarán mediante fixtures temporales, aislados y con rollback/limpieza automática sobre el entorno de Supabase, sin ejecutar scripts destructivos de `reset` o `seed`.

---

## 9. Resumen de Handoff Técnico

- **Objetivo:** Documentar exhaustivamente el contrato de datos, inventario y precios entre el panel administrativo y el ERP, sustentado en la conciliación del baseline real de producción.
- **Rutas Afectadas (Exclusivamente Autorizadas):**
  - `docs/erp-catalog-input-contract.md` (Nuevo documento contractual).
  - `scripts/check-erp-catalog-baseline.sql` (Nuevo script de auditoría de solo lectura).
- **Invariantes Clave Confirmadas:**
  1. Cero escrituras o alteraciones en base de datos.
  2. Preservación estricta de los 56 archivos del working tree base.
  3. Precios de operador entendidos como finales inclusivos en ARS con IVA 21% desglosado.
  4. Cero tolerancia al doble conteo en stock (padre vs variantes).
- **Próximos Pasos (S2):** Implementación del resolver unificado de servidor, RPCs de guardado atómico y auditoría de los consumidores POS/Checkout.
