# Prompt para Claude: Refactorización y Mejoras en NicTech

Actúa como un desarrollador Senior Frontend experto en React, TypeScript y Supabase. He recibido una lista de requerimientos de un cliente para mi plataforma de e-commerce "NicTech". Necesito que analices el proyecto (basándote en `CLAUDE.md`, `ARCHITECTURE.md` y `AI_NOTES.md`) y me ayudes a implementar los siguientes puntos, priorizando la estabilidad y la estética premium.

## 1. Corrección de Errores (Prioridad Alta)
- **Bug de Carga de Fotos en Fundas**: Al seleccionar una imagen en el formulario de fundas, esta no se previsualiza o no se carga correctamente hasta que se guarda y se vuelve a editar. Asegúrate de manejar correctamente el estado de la imagen y los buckets de Supabase.
- **Bug de Stock**: Al guardar un producto con stock (ej: 1), el valor se resetea a 0. Revisa la mutación de TanStack Query y la validación de Zod/esquema de base de datos.
- **Validación de Modelos Duplicados**: Al crear un modelo de celular, el sistema debe evitar duplicados incluso si las palabras son similares (case-insensitive o chequeo de substrings).

## 2. Mejoras de UI/UX y Layout
- **Panel de Edición Flotante/Fijo**: En la sección de gestión de productos, el panel lateral o formulario de "Agregar/Editar" debe quedar fijo (`sticky` o `fixed`) al hacer scroll. El usuario no debe volver arriba para editar el último producto de la lista.
- **Categorías y Navegación**:
    - Transformar el menú de categorías en un **desplegable (Dropdown)** para PC.
    - Implementar un **lateral (Drawer/Sheet)** para celulares.
    - Extraer "Promos", "Combos" y "Ofertas" fuera del desplegable de categorías. Deben ser botones/links independientes al lado del menú de categorías.
- **Banner de Envíos**: Agregar un aviso visualmente atractivo (marquesina o barra superior) indicando: "Realizamos envíos a todo el país".

## 3. Nuevas Funcionalidades de Búsqueda y Filtrado
- **Búsqueda Global**: Agregar un ícono de búsqueda al lado del carrito en el Header con un modal de búsqueda rápida (estilo `Command Palette`).
- **Búsqueda en Inventario**: Añadir una barra de búsqueda específica en la tabla/lista de inventario de productos.
- **Búsqueda de Modelos en Fundas**: Al agregar una funda, la selección de modelos de celular debe incluir un buscador interno para facilitar la selección.
- **Filtros Avanzados**:
    - En la Tienda (Sección protectores/vidrios): Agregar filtro por modelo de celular.
    - En la Tienda (Sección fundas): Agregar filtro por tipo de funda (Silicon Case, Transparente, etc.).

## 4. Arquitectura y Escalabilidad
- **Creación Global de Modelos**: Permitir la creación de nuevos modelos de celulares desde cualquier sección de administración (mediante un modal), no solo desde la página dedicada a modelos.
- **Portal de Clientes (Análisis)**: El cliente quiere saber si la "llave" es solo para admin o si habrá login de clientes. Propón una estructura para que los clientes puedan loguearse, ver sus compras y el seguimiento de sus reparaciones (usando el `Seguimiento.tsx` existente).

---

### Instrucciones de Implementación:
1.  **Estética**: Usa `shadcn/ui` y `framer-motion` para que las transiciones sean fluidas y se sientan "premium" (como indica mi `CLAUDE.md`).
2.  **Tipado**: Mantén el tipado estricto (`NO any`). Usa los tipos generados de Supabase.
3.  **Planificación**: Antes de tocar el código, proponme un orden lógico de archivos a modificar (ej. `Header.tsx`, `Inventory.tsx`, `useProductForm.ts`).
