# Plan de Implementación: Ajustes Web y Roadmap POS

Este plan detalla los pasos técnicos y el orden de ejecución para cumplir con los requerimientos del cliente de forma ordenada y profesional.

---

## User Review Required

> [!IMPORTANT]
> **Definición del Código Fuente**:
> Actualmente este directorio solo cuenta con los archivos multimedia del chat. Necesitamos saber si ya tenés un proyecto existente y dónde está, o si arrancamos a maquetar el frontend de la web desde cero en esta carpeta.

> [!WARNING]
> **Foco de la Etapa 1**:
> Tal como pidió tu cliente en el último audio, la **Etapa 1** se enfocará exclusivamente en los cambios estéticos y estructurales de la página web (campaña de marketing). La **Etapa 2** (el sistema de ventas POS y control de cajas) se deja estructurada pero pausada hasta que se concrete el pago.

---

## Open Questions

> [!IMPORTANT]
> 1. **¿Dónde está el código de la web?** ¿Está en algún otro repositorio local o en la nube?
> 2. **¿Qué stack tecnológico se está usando (o querés usar)?** (HTML/CSS/JS clásico, React + Vite, Next.js, etc.)

---

## Proposed Changes

El plan de trabajo se estructurará en fases incrementales:

### Fase 1: Setup y Estructura Base (Tienda Principal)
*   **Tienda como página principal**: Reconfigurar las rutas del proyecto para que la landing page inicial (Home) sea directamente la Tienda, o remover el banner/sección "Inicio" tradicional según el boceto.
*   **Estructura superior**: Agregar los botones de acceso rápido para "Promos" y "Combos" en la cabecera.
*   **Filtros**: Implementar el panel lateral de filtros con las categorías: *Smart, Auris, Cable, Carga, Comput, C. Auto*.

### Fase 2: Vista Mobile y Tarjetas de Producto
*   **Grilla Responsive**: Configurar el CSS de la grilla de productos mediante CSS Grid o Flexbox para que en dispositivos móviles (celulares) muestre estrictamente **entre 2 y 3 tarjetas por fila** (en lugar del estándar de 1 tarjeta por fila que suele romperse o verse demasiado grande).
*   **Tarjetas de Producto**: Asegurar que cada tarjeta muestre:
    *   Imagen del producto.
    *   Título.
    *   Precio original y precio con descuento (con un badge visual si aplica).
    *   Mantener el comportamiento del click existente (abrir modal, ir a detalle, etc.).

### Fase 3: Landing de Inicio / Servicios y Contacto
*   **Reorganización de la Home**: Agregar secciones claras para los tres pilares de valor:
    *   *Garantía*
    *   *Rapidez*
    *   *Profesionalismo*
*   **Grilla de Servicios**: Crear bloques interactivos para los servicios:
    1.  *Reparación de Celulares y Consolas*
    2.  *Mantenimiento*
    3.  *Reparación de Computadoras*
    4.  *Armado*
    5.  *Sistemas de Seguridad*
    6.  *Servicio Técnico (CTA)*
*   **Pie de Contacto**:
    *   *Columna Izquierda*: WhatsApp, Dirección, Email.
    *   *Columna Derecha*: Integración de mapa interactivo (iframe de Google Maps o similar).

### Fase 4: Páginas de Promos y Combos
*   Crear los templates específicos para las rutas `/promos` y `/combos` mostrando:
    *   Título destacado.
    *   Sección de medios de pago aceptados.
    *   Listado/tarjetas de productos específicos pertenecientes a la promo o combo.

### Fase 5: QA y Enlaces de Banners
*   Revisar y mapear correctamente los enlaces de todos los banners.
*   Ajustar el tiempo de rotación del slider/banner principal para una lectura cómoda.
*   Hacer testing de todos los botones para asegurar que no haya links rotos.

---

## Verification Plan

### Manual Verification
*   **Responsiveness Test**: Emular vista móvil en herramientas de desarrollador y verificar que se visualicen 2 o 3 productos por fila de forma fluida.
*   **Flujo de Navegación**: Probar todos los links de los banners y el comportamiento de los filtros de categorías.
*   **QA de Promos/Combos**: Navegar a las secciones respectivas y verificar el listado correcto y la información de medios de pago.
