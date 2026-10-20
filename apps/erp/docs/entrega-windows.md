# Entrega de NicTech ERP para Windows

## Archivos para el cliente

La generación deja estos archivos en `apps/erp/release/`:

- `NicTech ERP Setup X.Y.Z.exe`: instalador para Windows de 64 bits, con selección de carpeta y acceso directo.
- `NicTech ERP X.Y.Z.exe`: versión portable que se abre sin instalar.

Para una entrega habitual, enviar el archivo **Setup**. No necesita Node.js, Docker ni herramientas de desarrollo en la computadora del cliente. Sí requiere Internet para acceder a Supabase.

El ejecutable todavía no tiene certificado de firma digital; Windows puede mostrar una advertencia de editor desconocido. Para distribuir versiones firmadas hace falta configurar el certificado correspondiente.

La ventana usa una barra propia de NicTech con controles de minimizar, maximizar/restaurar y cerrar. El espacio libre de esa barra permite arrastrar la ventana; los botones siguen disponibles al abrir los diálogos de la aplicación.

## Cuentas de acceso

El programa usa las cuentas del proyecto **NicTech** de Supabase. El cliente ingresa con correo y contraseña.

1. Crear la cuenta desde **Supabase Dashboard → Authentication → Users → Add user → Create new user**.
2. Definir correo y contraseña, y confirmar el correo al crearla si no se va a completar una confirmación por email.
3. Abrir NicTech ERP e ingresar con esas credenciales.

En el backend actual, el alta de Auth crea el perfil ERP y asigna el rol `owner` de NicTech. Esto da acceso administrativo completo: crear únicamente cuentas de operadores autorizados. Para acceso limitado, asignar el rol correspondiente en lugar de `owner` antes de entregar la cuenta.

Mantener **deshabilitado el registro público** en Supabase Auth. El proyecto comparte Auth con la web; habilitarlo con el trigger actual daría acceso administrativo a las cuentas nuevas. El instalable no tiene formulario de autorregistro.

Si una cuenta inicia sesión pero no tiene contexto ERP válido, la aplicación permite reintentar o cerrar la sesión. Revisar que tenga perfil activo, organización, rol activo y acceso a la sucursal.

## Generar otra versión

Desde la raíz del repositorio, con las dependencias instaladas:

```powershell
npm run build:erp:electron
```

El proceso verifica TypeScript antes de compilar y empaquetar. Electron está fijado en `44.4.5` para que el empaquetado resuelva la versión en el monorepo.

La configuración pública de Supabase se toma de `apps/erp/.env` durante la compilación. No colocar claves secretas ni `service_role` en variables `VITE_*`. Cambiar de proyecto requiere volver a generar el instalador.
