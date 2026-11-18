import { cpSync, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const erpDir = path.join(rootDir, "apps", "erp");
const storefrontDistDir = path.join(rootDir, "dist");

function isPublicKey(key) {
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "anon";
  } catch {
    return false;
  }
}

function buildErpWeb() {
  const url = process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Configurá VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en el entorno del build.");
  }
  const parsedUrl = URL.canParse(url) ? new URL(url) : null;
  if (parsedUrl?.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
    throw new Error("VITE_SUPABASE_URL debe ser una URL HTTPS pública de Supabase.");
  }
  if (!isPublicKey(key)) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY debe ser publishable o anon; nunca secret ni service_role.");
  }
  if (!existsSync(path.join(storefrontDistDir, "index.html"))) {
    throw new Error("Ejecutá npm run build para generar dist/index.html antes de compilar el ERP web.");
  }
  const target = path.join(realpathSync(storefrontDistDir), "erp");
  const existingTarget = lstatSync(target, { throwIfNoEntry: false });
  if (path.relative(realpathSync(rootDir), target) !== path.join("dist", "erp") ||
      (existingTarget && !existingTarget.isDirectory())) {
    throw new Error("El destino debe ser un directorio normal dentro de dist/erp.");
  }

  const requireErp = createRequire(path.join(erpDir, "package.json"));
  const viteBin = path.join(path.dirname(requireErp.resolve("vite/package.json")), "bin", "vite.js");
  const webOutput = mkdtempSync(path.join(tmpdir(), "nictech-erp-web-"));
  try {
    const result = spawnSync(process.execPath, [viteBin, "build", "--outDir", webOutput, "--emptyOutDir"], {
      cwd: erpDir,
      stdio: "inherit",
      env: {
        ...process.env,
        ERP_BASE_PATH: "/erp/",
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Vite falló (${result.signal ?? result.status}).`);
    if (!existsSync(path.join(webOutput, "index.html"))) {
      throw new Error("Vite no generó el index.html del ERP.");
    }

    rmSync(target, { recursive: true, force: true });
    cpSync(webOutput, target, { recursive: true });
    console.log("ERP web copiado en dist/erp.");
  } finally {
    rmSync(webOutput, { recursive: true, force: true });
  }
}

try {
  buildErpWeb();
} catch (error) {
  console.error(`Build del ERP web: ${error.message}`);
  process.exitCode = 1;
}
