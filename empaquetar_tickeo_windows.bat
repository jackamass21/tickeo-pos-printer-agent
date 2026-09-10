@echo off
title Empaquetar Tickeo POS Printer Agent
color 0B
cd /d %~dp0

echo ==========================================
echo   EMPAQUETAR APP WINDOWS - TICKEO
echo ==========================================
echo.

if /i not "%OS%"=="Windows_NT" (
  echo [ERROR] Este empaquetado debe ejecutarse en Windows.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm no esta disponible.
  pause
  exit /b 1
)

echo [INFO] Instalando dependencias en Windows...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install fallo.
  pause
  exit /b 1
)

echo.
echo [INFO] Reconstruyendo modulos nativos para Electron...
call npx electron-builder install-app-deps
if errorlevel 1 (
  echo [ERROR] Fallo rebuild de dependencias nativas.
  pause
  exit /b 1
)

echo.
echo [INFO] Generando instalador y portable Windows...
call npm run dist:win
if errorlevel 1 (
  echo [ERROR] Empaquetado fallo.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   LISTO
echo ==========================================
echo Archivos generados en la carpeta dist
echo.
pause
