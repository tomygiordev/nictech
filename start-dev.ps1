<#
.SYNOPSIS
    Inicia todas las aplicaciones del proyecto NicTech (Storefront + ERP).

.DESCRIPTION
    Script de arranque para Windows que valida el entorno, opcionalmente inicia Supabase local,
    y levanta Storefront (puerto 8080) y ERP (puerto 8081).

.PARAMETER WithDb
    Inicia la base de datos local de Supabase antes de los servidores frontend.

.PARAMETER OpenBrowser
    Abre automáticamente las URLs en el navegador predeterminado una vez iniciados los servicios.

.PARAMETER SeparateWindows
    Abre Storefront y ERP en ventanas de consola independientes en lugar de una terminal combinada.

.EXAMPLE
    .\start-dev.ps1
    .\start-dev.ps1 -OpenBrowser
    .\start-dev.ps1 -WithDb -OpenBrowser
    .\start-dev.ps1 -SeparateWindows
#>

param(
    [switch]$WithDb,
    [switch]$OpenBrowser,
    [switch]$SeparateWindows
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $RepoRoot

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "            NicTech - Entorno de Desarrollo           " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "Directorio: $RepoRoot" -ForegroundColor DarkGray

# 1. Comprobar archivo .env
if (-not (Test-Path "$RepoRoot\.env")) {
    Write-Host "[!] ADVERTENCIA: No se encontro el archivo .env en la raiz." -ForegroundColor Yellow
    if (Test-Path "$RepoRoot\.env.example") {
        Write-Host "    Copiando .env.example a .env..." -ForegroundColor Yellow
        Copy-Item "$RepoRoot\.env.example" "$RepoRoot\.env"
        Write-Host "    [OK] Archivo .env creado desde .env.example" -ForegroundColor Green
    }
}

# 2. Iniciar Supabase local si fue solicitado
if ($WithDb) {
    Write-Host ""
    Write-Host "[1/3] Iniciando Supabase local (Docker)..." -ForegroundColor Yellow
    try {
        npm run db:start
        Write-Host "[OK] Supabase local iniciado." -ForegroundColor Green
    } catch {
        Write-Host "[X] Error al iniciar Supabase local. Verifique que Docker Desktop este corriendo." -ForegroundColor Red
        exit 1
    }
}

# 3. Mostrar URLs de acceso
Write-Host ""
Write-Host "Servicios a iniciar:" -ForegroundColor White
Write-Host "  -> Storefront (E-commerce / Web): " -NoNewline
Write-Host "http://localhost:8080" -ForegroundColor Green
Write-Host "  -> ERP Interno:                   " -NoNewline
Write-Host "http://localhost:8081" -ForegroundColor Magenta

if ($WithDb) {
    Write-Host "  -> Supabase Studio:               " -NoNewline
    Write-Host "http://127.0.0.1:54323" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Para detener todos los servicios: Presiona Ctrl + C" -ForegroundColor DarkGray
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# 4. Abrir navegador si se especifico
if ($OpenBrowser) {
    Start-Job -ScriptBlock {
        Start-Sleep -Seconds 3
        Start-Process "http://localhost:8080"
        Start-Sleep -Seconds 1
        Start-Process "http://localhost:8081"
    } | Out-Null
}

# 5. Ejecucion de aplicaciones
if ($SeparateWindows) {
    Write-Host "Iniciando Storefront y ERP en ventanas independientes..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RepoRoot'; npm run dev:storefront"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RepoRoot'; npm run dev:erp"
    Write-Host "[OK] Procesos iniciados en terminales separadas." -ForegroundColor Green
} else {
    Write-Host "Iniciando servidores en consola combinada..." -ForegroundColor Cyan
    npx concurrently -n "storefront,erp" -c "cyan.bold,magenta.bold" "npm run dev:storefront" "npm run dev:erp"
}
