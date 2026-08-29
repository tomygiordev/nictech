@echo off
title NicTech Development Launcher
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1 -OpenBrowser
pause
