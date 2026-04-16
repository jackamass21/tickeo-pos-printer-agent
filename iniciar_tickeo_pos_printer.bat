@echo off
title Tickeo POS Printer Agent
cd /d %~dp0

echo ==========================================
echo   TICKEO POS PRINTER AGENT - XPRINTER USB
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js no esta instalado o no esta en PATH.
    echo Instala Node.js y vuelve a ejecutar este archivo.
    pause
    exit /b 1
)

if not exist package.json (
    echo ERROR: No se encontro package.json en esta carpeta.
    echo Copia este .bat dentro de la carpeta del agente.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Instalando dependencias...
    call npm install
    if errorlevel 1 (
        echo ERROR: Fallo la instalacion de dependencias.
        pause
        exit /b 1
    )
)

echo Iniciando agente de impresion...
echo URL local: http://127.0.0.1:17891/health
echo.
node server.mjs

echo.
echo El agente se detuvo.
pause