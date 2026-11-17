# Marca oficial del ERP

Los archivos de `public/brand/` provienen de las mismas fuentes que utiliza la web principal de NicTech. Se incluyen en el instalador y en la compilación web para que la identidad visual cargue desde archivos locales.

| Archivo | Uso | Fuente de la web principal |
| --- | --- | --- |
| `nictech-logo-color.png` | Logotipo de la barra superior y del menú lateral | `src/components/layout/Navbar.tsx`: [logotipo original](https://tuzpcofywkhglkqplhnn.supabase.co/storage/v1/object/public/product_images/Logotipo_color.png) |
| `nictech-symbol.png` | Icono de ventana y favicon | `index.html` y `public/manifest.json`: [isotipo original](https://tuzpcofywkhglkqplhnn.supabase.co/storage/v1/object/public/product_images/Logotipo%20solo%20isotipo%20(solo%20icono%20sin%20texto).png) |
| `nictech.ico` | Ejecutable, instalador, desinstalador y acceso directo de Windows | Conversión del isotipo anterior a ICO, con imágenes de 16, 24, 32, 48, 64, 128 y 256 píxeles |

Los PNG conservan los bytes, colores y transparencia originales. El logotipo mide 5109 × 1378 píxeles y el isotipo 1563 × 1563. La interfaz conserva sus proporciones y muestra `ERP` como identificador del producto separado del logotipo.

El ICO se exportó desde `nictech-symbol.png` con Pillow, usando `Image.save(..., format="ICO", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])`. El archivo convertido queda versionado; la compilación y el instalador usan ese recurso directamente.

Al actualizar la marca, sustituir los archivos oficiales, volver a exportar el ICO y generar una nueva versión. La configuración de Windows y NSIS se encuentra en `apps/erp/package.json`; el icono de la ventana se define en `electron/main.cjs`.
