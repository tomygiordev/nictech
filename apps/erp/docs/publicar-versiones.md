# Publicar versiones de NicTech ERP

Al subir un tag `erp-vX.Y.Z`, **GitHub Actions** genera el instalador de Windows y la versión portable. Si pasan las verificaciones, publica la Release y la marca como **Latest**. El actualizador del ERP busca `latest.yml` en esa Release pública, sin token.

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
   npm run version:erp -- X.Y.Z
   ```

   Usar el próximo número disponible, superior a `0.2.0` para la primera entrega con actualizador. No reutilizar el tag `erp-v0.2.0`.

3. Revisar y crear el commit con los cambios, incluyendo `apps/erp/package.json` y `package-lock.json`. Si necesitás probar el instalador antes de publicarlo, usá la ejecución desde una rama que se describe más abajo.
4. Subir la rama y etiquetar **ese commit** con el comando de entrega:

   ```powershell
   npm run release:erp
   ```

   El comando exige que las fuentes de la entrega estén guardadas en commits; no crea commits automáticos. Obtiene la versión de `apps/erp/package.json`, sube la rama y el tag `erp-vX.Y.Z`. No hace falta cambiar a `main` para publicar una versión desde `dev/erp`.

5. Abrir **Actions → ERP · Instaladores Windows**. El trabajo instala dependencias desde el lockfile, verifica TypeScript, ejecuta las pruebas del ERP y empaqueta en Windows con Node.js 24. Electron Builder genera los metadatos de actualización con `--publish never`; el trabajo final de Actions verifica los archivos y publica la Release como **Latest**.
6. Confirmar en **Releases** que la versión aparece como **Latest** y que incluye los cinco archivos de la tabla. No hay un paso manual de publicación.

El tag debe coincidir exactamente con `apps/erp/package.json.version`; por ejemplo, versión `0.2.1` exige tag `erp-v0.2.1`. Si ya existe una Release publicada para ese tag, el flujo se detiene sin reemplazar sus archivos. Una corrección se entrega con una nueva versión. Si existe un borrador para el tag, el flujo carga los archivos validados antes de publicarlo. No marcar como **Latest** una Release ajena al ERP: esa marca es compartida por todo el repositorio y el ERP dejaría de encontrar el feed.

## Probar la generación desde una rama

Una vez que el workflow esté en la rama predeterminada, con GitHub CLI autenticado y la rama ya subida:

```powershell
gh workflow run erp-release.yml --ref dev/erp
gh run list --workflow erp-release.yml --limit 5
```

También se puede usar **Actions → ERP · Instaladores Windows → Run workflow** y seleccionar la rama. Al ejecutarlo sobre una rama, guarda un artifact descargable durante 30 días; **no crea tags ni Releases**. Ejecutarlo sobre un tag válido sí publica esa versión.

## Qué descargar y entregar

| Archivo | Uso |
| --- | --- |
| `NicTech-ERP-Setup-X.Y.Z.exe` | Instalador habitual para el cliente. |
| `NicTech-ERP-Portable-X.Y.Z.exe` | Versión portable, sin instalación. |
| `NicTech-ERP-Setup-X.Y.Z.exe.blockmap` | Metadatos para la descarga diferencial. El cliente no necesita abrirlos. |
| `latest.yml` | Versión, nombre y huella del instalador que lee el actualizador. |
| `SHA256SUMS.txt` | Huellas SHA-256 de los cuatro archivos anteriores. |

El artifact de Actions y la Release usan los mismos nombres y sumas. No renombrar el instalador: `latest.yml` referencia su nombre exacto. Para entregar la versión al cliente, usar la [última Release pública](https://github.com/tomygiordev/nictech/releases/latest).

Para consultar la huella de un archivo descargado en Windows:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\NicTech-ERP-Setup-0.2.1.exe'
```

Comparar el valor con la línea correspondiente de `SHA256SUMS.txt`.

## Pasar desde la versión 0.2.0

La **0.2.0 no tiene actualizador**. El cliente debe descargar de GitHub y ejecutar **una sola vez** el primer `NicTech-ERP-Setup-X.Y.Z.exe` que incluya el actualizador. La `0.2.0` que se genere localmente para probar estos cambios no debe publicarse.

Desde esa primera instalación, el ERP busca actualizaciones 10 segundos después de abrir la ventana y luego cada cuatro horas. Descarga la nueva versión y ofrece reiniciar cuando está lista. Si el cliente elige **Más tarde**, la instala al cerrar la aplicación. Sin conexión no aparece ningún aviso de error.

La edición portable solo avisa de una versión nueva. **Abrir descargas** lleva a GitHub para bajar el instalador; el portable no se actualiza ni instala nada por su cuenta. La versión instalada se ve en la barra de título del ERP de escritorio.

También podés usar **Configuración → Actualizaciones → Buscar actualizaciones**. La tarjeta muestra la versión instalada y el progreso sin abrir un diálogo adicional. Si la descarga termina, elegí **Reiniciar e instalar**; en la edición portable, **Descargar** abre la última Release en GitHub.

## Alcance de esta entrega

- Windows x64, instalador NSIS y portable.
- Inicio de sesión con las cuentas creadas en Supabase Auth y los permisos que tengan asignados en el ERP; requiere Internet.
- Ejecutables sin firma digital: Windows puede mostrar un aviso de editor desconocido.
- Los instaladores se guardan como archivos de Release, no se agregan al historial de Git.

Referencias: [GitHub CLI: crear Releases](https://cli.github.com/manual/gh_release_create), [artifacts de Actions](https://github.com/actions/upload-artifact), [Node.js en Actions](https://github.com/actions/setup-node).
