@echo off
title Instalador Tickeo POS Printer Agent
color 0A
cd /d %~dp0

echo ==========================================
echo   INSTALADOR TICKEO POS PRINTER AGENT
echo ==========================================
echo.

REM ==========================
REM Verificar Node.js
REM ==========================
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado o no esta en PATH.
    echo.
    echo Descargalo desde:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM ==========================
REM Verificar npm
REM ==========================
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm no esta disponible.
    echo Reinstala Node.js correctamente.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js detectado:
node -v
echo [OK] npm detectado:
npm -v
echo.

REM ==========================
REM Verificar package.json
REM ==========================
if not exist package.json (
    echo [ERROR] No se encontro package.json en esta carpeta.
    echo Debes ejecutar este .bat dentro de la carpeta del agente.
    echo.
    pause
    exit /b 1
)

REM ==========================
REM Limpiar instalacion anterior opcional
REM ==========================
if exist node_modules (
    echo [INFO] Ya existe node_modules
) else (
    echo [INFO] No existe node_modules, se instalara desde cero.
)

echo.
echo ==========================================
echo   INSTALANDO DEPENDENCIAS...
echo ==========================================
echo.

call npm install
if errorlevel 1 (
    echo.
    echo [WARN] npm install fallo.
    echo Intentando instalacion forzada...
    echo.
    call npm install --force
)

echo.
echo ==========================================
echo   RECONSTRUYENDO MODULOS NATIVOS...
echo ==========================================
echo.

call npm rebuild
if errorlevel 1 (
    echo [WARN] npm rebuild fallo. Continuando...
)

echo.
echo ==========================================
echo   PROBANDO DEPENDENCIAS CLAVE...
echo ==========================================
echo.

node -e "require('express'); require('cors'); require('qrcode'); console.log('OK libs JS')"
if errorlevel 1 (
    echo [ERROR] Faltan dependencias JS basicas.
    pause
    exit /b 1
)

node -e "try { require('escpos'); require('escpos-usb'); console.log('OK escpos'); } catch(e) { console.error(e); process.exit(1); }"
if errorlevel 1 (
    echo.
    echo [WARN] escpos o escpos-usb no cargaron correctamente.
    echo Esto puede deberse a modulos USB nativos o drivers.
    echo Aun asi puedes probar el agente.
    echo.
) else (
    echo [OK] Librerias de impresion cargadas correctamente.
)

echo.
echo ==========================================
echo   INSTALACION FINALIZADA
echo ==========================================
echo.
echo Ahora puedes ejecutar:
echo iniciar_tickeo_pos_printer.bat
echo.
pause