# tickeo-pos-printer-agent

Agente Windows/Electron para impresora POS USB Tickeo.

## Instalar

1. Instala Node.js.
2. Ejecuta `instalar_tickeo_pos_printer.bat`.
3. Si la impresora no abre por USB, instala UsbDK desde https://github.com/daynix/UsbDk/releases.

## Iniciar app Windows

Ejecuta `iniciar_tickeo_pos_printer.bat` o:

```bash
npm start
```

## Empaquetar en Windows

El build debe ejecutarse en Windows, no en WSL:

```bat
empaquetar_tickeo_windows.bat
```

Genera instalador NSIS y portable en `dist/`.

## Publicar release en GitHub

Configura un token con permiso de releases y ejecuta en Windows:

```bat
set GH_TOKEN=tu_token_github
npm run release:win
```

Esto publica en `jackamass21/tickeo-pos-printer-agent` y sube los artefactos necesarios para el auto-updater. La app empaquetada busca actualizaciones al iniciar y luego cada 1 hora.

La ventana permite:

- ver estado del servicio local `http://127.0.0.1:17891`
- seleccionar impresora USB detectada
- ver historial/log de eventos
- exportar log para depurar
- abrir descarga de UsbDK
- activar auto-inicio con Windows

## Modo servidor sin ventana

```bash
npm run server
```
