const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const ERP_DIR = path.resolve(__dirname, "..");
const DEFAULT_PORT = 8081;
const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

function isServerAlive(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function launchElectron(devUrl, cleanup) {
  console.log(`[Electron-Dev] Abriendo ventana de Electron conectada a ${devUrl}...`);
  const electronBinary = require("electron");

  const electronProcess = spawn(electronBinary, [".", "--dev"], {
    cwd: ERP_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devUrl,
    },
  });

  electronProcess.on("close", (code) => {
    console.log(`[Electron-Dev] Ventana de Electron cerrada.`);
    if (cleanup) cleanup();
    process.exit(code || 0);
  });
}

function findViteBin() {
  const candidates = [
    path.resolve(ERP_DIR, "../../node_modules/vite/bin/vite.js"),
    path.resolve(ERP_DIR, "node_modules/vite/bin/vite.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function main() {
  // Check if a Vite server is already running on port 8081
  const alreadyRunning = await isServerAlive(DEFAULT_URL);
  if (alreadyRunning) {
    console.log(`[Electron-Dev] Se detectó servidor activo en ${DEFAULT_URL}. Reutilizándolo.`);
    launchElectron(DEFAULT_URL, null);
    return;
  }

  console.log(`[Electron-Dev] Iniciando Vite en ${DEFAULT_URL}...`);
  const viteBin = findViteBin();
  let viteProcess;

  if (viteBin) {
    viteProcess = spawn(process.execPath, [viteBin, "--port", String(DEFAULT_PORT)], {
      cwd: ERP_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } else {
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    viteProcess = spawn(npxCmd, ["vite", "--port", String(DEFAULT_PORT)], {
      cwd: ERP_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
  }

  let launched = false;

  const handleOutput = (data) => {
    const text = data.toString();
    process.stdout.write(text);

    // Look for Vite ready line: e.g. "Local:   http://localhost:8081/"
    const match = text.match(/(http:\/\/(?:localhost|127\.0\.0\.1):\d+\/?)/i);
    if (match && !launched) {
      launched = true;
      const resolvedUrl = match[1].replace(/\/$/, "");
      launchElectron(resolvedUrl, () => {
        viteProcess.kill();
      });
    }
  };

  viteProcess.stdout.on("data", handleOutput);
  viteProcess.stderr.on("data", (data) => {
    process.stderr.write(data.toString());
  });

  viteProcess.on("error", (err) => {
    console.error("[Electron-Dev] Error al iniciar Vite:", err);
    process.exit(1);
  });

  // Fallback: poll server if regex didn't catch output within 4 seconds
  setTimeout(async () => {
    if (!launched) {
      const alive = await isServerAlive(DEFAULT_URL);
      if (alive && !launched) {
        launched = true;
        launchElectron(DEFAULT_URL, () => viteProcess.kill());
      }
    }
  }, 4000);
}

main();
