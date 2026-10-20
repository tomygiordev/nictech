# Publicar versiones de NicTech ERP

El repositorio genera el instalador de Windows y la versión portable mediante **GitHub Actions**. Al subir un tag `erp-vX.Y.Z`, prepara una **Release en borrador**, con los archivos y sus sumas SHA-256. La publicación para el cliente se hace desde GitHub después de revisar el borrador.

## Configuración de GitHub (una sola vez)

En **Settings → Secrets and variables → Actions → Variables**, crear estas variables del repositorio:

| Variable | Valor |
| --- | --- |
| `VITE_SUPABASE_URL` | URL HTTPS del proyecto Supabase usado por el cliente. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave `sb_publishable_…` o clave `anon` heredada del mismo proyecto. |

Son datos públicos que quedan incluidos en la aplicación. **Nunca usar una clave `service_role` ni `sb_secret_…`**. El flujo rechaza claves que no sean publishable o anon. Los permisos sobre los datos dependen de las políticas y membresías del ERP en Supabase.

GitHub Actions debe estar habilitado. El trabajo que prepara la Release usa el `GITHUB_TOKEN` automático con permiso `contents: write`; no requiere guardar un token personal. Si una política de la organización impide ese permiso, debe habilitarlo el administrador.

El workflow `.github/workflows/erp-release.yml` debe estar en la rama predeterminada para habilitar **Run workflow** y la ejecución manual por GitHub CLI. El disparador por tags usa el workflow incluido en el commit etiquetado. Mientras el archivo esté solamente en `dev/erp`, usar los tags para generar versiones; la ejecución manual quedará disponible al integrar el workflow en la rama predeterminada.

## Generar una versión nueva

1. Terminar y guardar los cambios que debe recibir el cliente. Verificar que la rama contiene el código correcto.
2. Desde la raíz del repositorio, incrementar la versión del ERP y actualizar el lockfile:

   ```powershell
   npm run version:erp -- 0.1.1
   ```

   Usar el próximo número disponible con formato `X.Y.Z`. Para la primera entrega puede conservarse `0.1.0` si todavía no existe el tag `erp-v0.1.0`.

3. Revisar y crear el commit con los cambios, incluyendo `apps/erp/package.json` y `package-lock.json`. Subir la rama al repositorio.
4. Subir la rama y etiquetar **ese commit** con el comando de entrega:

   ```powershell
   npm run release:erp
   ```

   El comando exige que las fuentes de la entrega estén guardadas en commits; no crea commits automáticos. Obtiene la versión de `apps/erp/package.json`, sube la rama y el tag `erp-vX.Y.Z`. No hace falta cambiar a `main` para publicar una versión desde `dev/erp`.

5. Abrir **Actions → ERP · Instaladores Windows**. El trabajo instala dependencias desde el lockfile, verifica TypeScript, ejecuta las pruebas del ERP y empaqueta en Windows con Node.js 24. El comando de empaquetado desactiva la publicación automática de Electron; solamente el trabajo final de Actions prepara el borrador.
6. Cuando termine, abrir **Releases**, revisar el borrador, completar las novedades y probar el instalador en otra PC con una cuenta real del cliente. Presionar **Publish release** para habilitar la descarga.

El tag debe coincidir exactamente con `apps/erp/package.json.version`; por ejemplo, versión `0.1.1` exige tag `erp-v0.1.1`. Si ya existe una Release publicada, el flujo se detiene sin reemplazar sus archivos. Una corrección se entrega con una nueva versión. Reejecutar un flujo que corresponde a un borrador sí reemplaza sus archivos para completar ese borrador.

## Probar la generación desde una rama

Una vez que el workflow esté en la rama predeterminada, con GitHub CLI autenticado y la rama ya subida:

```powershell
gh workflow run erp-release.yml --ref dev/erp
gh run list --workflow erp-release.yml --limit 5
```

También se puede usar **Actions → ERP · Instaladores Windows → Run workflow** y seleccionar la rama. Al ejecutarlo sobre una rama, guarda un artifact descargable durante 30 días; **no crea tags ni Releases**. Ejecutarlo sobre un tag válido sí prepara el borrador de esa versión.

## Qué descargar y entregar

| Archivo | Uso |
| --- | --- |
| `NicTech ERP Setup X.Y.Z.exe` | Instalador habitual para el cliente. |
| `NicTech ERP X.Y.Z.exe` | Versión portable, sin instalación. |
| `NicTech ERP Setup X.Y.Z.exe.blockmap` | Archivo complementario generado por el empaquetador. El cliente no necesita abrirlo. |
| `SHA256SUMS.txt` | Huellas SHA-256 de los tres archivos anteriores para comprobar integridad. |

Los mismos ejecutables quedan en el artifact de la ejecución y en la Release en borrador. En la Release, los nombres usan puntos en lugar de espacios: por ejemplo, `NicTech.ERP.Setup.0.1.1.exe`. Cada descarga incluye un `SHA256SUMS.txt` correspondiente a sus propios nombres de archivo. Las Releases publicadas permanecen hasta que se eliminen; los artifacts de Actions vencen a los 30 días, sujeto a la política del repositorio. En un repositorio privado, el cliente necesita acceso al repositorio para descargar desde GitHub: se puede entregar el `.exe` por otro medio sin cambiar la privacidad del código.

Para consultar la huella de un archivo descargado en Windows:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\NicTech.ERP.Setup.0.1.1.exe'
```

Comparar el valor con la línea correspondiente de `SHA256SUMS.txt`. Si se descargó el artifact de Actions, usar el nombre con espacios.

## Alcance de esta entrega

- Windows x64, instalador NSIS y portable.
- Inicio de sesión con las cuentas creadas en Supabase Auth y los permisos que tengan asignados en el ERP; requiere Internet.
- Actualización manual: descargar e instalar la versión nueva. El archivo `.blockmap` no activa actualizaciones automáticas por sí solo.
- Ejecutables sin firma digital: Windows puede mostrar un aviso de editor desconocido.
- Los instaladores se guardan como archivos de Release, no se agregan al historial de Git.

Referencias: [GitHub CLI: crear Releases](https://cli.github.com/manual/gh_release_create), [artifacts de Actions](https://github.com/actions/upload-artifact), [Node.js en Actions](https://github.com/actions/setup-node).
