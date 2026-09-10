import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPrintConfig,
  getLogs,
  getServiceStatus,
  listPrinters,
  printTestReceipt,
  selectPrinterByKey,
  serviceEvents,
  setPrintConfig,
  startService
} from "../server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USB_DK_RELEASES_URL = "https://github.com/daynix/UsbDk/releases";
const DEBUG_UPLOAD_URL = "https://printer.tickeo.cl/upload";
const APP_ICON = path.join(__dirname, "..", "assets", process.platform === "win32" ? "icon.ico" : "icon.png");
const CONFIG_PATH = path.join(app.getPath("userData"), "print-config.json");
const APP_SETTINGS_PATH = path.join(app.getPath("userData"), "app-settings.json");
const { autoUpdater } = electronUpdater;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let minimizedNoticeShown = false;
let appSettings = {
  shareDebugData: true
};

function sendRenderer(channel, payload) {
  mainWindow?.webContents.send(channel, payload);
}

function emitUpdateLog(level, message, meta = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    meta
  };
  sendRenderer("logs:new", entry);
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
    `[${entry.timestamp}] ${message}`,
    meta ?? ""
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: "Tickeo POS Printer Agent",
    icon: APP_ICON,
    backgroundColor: "#f5f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    showMinimizedNotice();
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function showMinimizedNotice() {
  if (minimizedNoticeShown) return;
  minimizedNoticeShown = true;

  const title = "Tickeo POS Printer Agent";
  const body = "La app no se cerro. Quedo minimizada en la bandeja del sistema.";

  if (Notification.isSupported()) {
    new Notification({ title, body, icon: APP_ICON }).show();
    return;
  }

  if (process.platform === "win32") {
    tray?.displayBalloon({ title, content: body, icon: APP_ICON });
  }
}

function createTray() {
  tray = new Tray(APP_ICON);
  tray.setToolTip("Tickeo POS Printer Agent");
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Abrir",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: "Salir",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    emitUpdateLog("info", "Auto-updater inactivo en modo desarrollo");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    emitUpdateLog("info", "Buscando actualizaciones");
  });
  autoUpdater.on("update-available", (info) => {
    emitUpdateLog("info", "Actualizacion disponible, descargando", {
      version: info.version
    });
  });
  autoUpdater.on("update-not-available", (info) => {
    emitUpdateLog("info", "No hay actualizaciones disponibles", {
      version: info.version
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    sendRenderer("updater:progress", {
      percent: Math.round(progress.percent || 0),
      transferred: progress.transferred,
      total: progress.total
    });
  });
  autoUpdater.on("update-downloaded", async (info) => {
    emitUpdateLog("info", "Actualizacion descargada", {
      version: info.version
    });

    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Reiniciar ahora", "Despues"],
      defaultId: 0,
      cancelId: 1,
      title: "Actualizacion lista",
      message: `Tickeo POS Printer Agent ${info.version} esta listo para instalar.`
    });

    if (result.response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
    }
  });
  autoUpdater.on("error", (error) => {
    emitUpdateLog("error", "Error en auto-updater", {
      message: error?.message || String(error)
    });
  });
}

async function checkForUpdates({ manual = false } = {}) {
  if (!app.isPackaged) {
    emitUpdateLog("info", "Check update omitido: app no empaquetada");
    return { ok: false, skipped: true, reason: "app no empaquetada" };
  }

  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    emitUpdateLog("error", "No se pudo consultar actualizaciones", {
      message: error?.message || String(error)
    });
    if (manual) throw error;
    return { ok: false, error: error?.message || String(error) };
  }
}

function getAutoStartStatus() {
  return app.getLoginItemSettings().openAtLogin;
}

async function loadPrintConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    setPrintConfig(JSON.parse(raw));
  } catch {
    await savePrintConfig(getPrintConfig());
  }
}

async function loadAppSettings() {
  try {
    const raw = await readFile(APP_SETTINGS_PATH, "utf8");
    appSettings = { ...appSettings, ...JSON.parse(raw) };
  } catch {
    await saveAppSettings(appSettings);
  }
}

async function saveAppSettings(settings) {
  appSettings = { ...appSettings, ...settings };
  await mkdir(path.dirname(APP_SETTINGS_PATH), { recursive: true });
  await writeFile(APP_SETTINGS_PATH, JSON.stringify(appSettings, null, 2), "utf8");
  return { ...appSettings };
}

async function savePrintConfig(config) {
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

async function buildDebugReport() {
  return [
    "Tickeo POS Printer Agent debug report",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "[status]",
    JSON.stringify(await getServiceStatus(), null, 2),
    "",
    "[printConfig]",
    JSON.stringify(getPrintConfig(), null, 2),
    "",
    "[settings]",
    JSON.stringify(appSettings, null, 2),
    "",
    "[logs]",
    getLogs().map((entry) => JSON.stringify(entry)).join("\n")
  ].join("\n");
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await loadAppSettings();
  await loadPrintConfig();
  await startService({ interactive: false });
  createWindow();
  createTray();
  setupAutoUpdater();
  checkForUpdates();
  setInterval(() => checkForUpdates(), 60 * 60 * 1000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (isQuitting && process.platform !== "darwin") app.quit();
});

serviceEvents.on("log", (entry) => {
  mainWindow?.webContents.send("logs:new", entry);
});

ipcMain.handle("status:get", async () => ({
  ...(await getServiceStatus()),
  appVersion: app.getVersion(),
  autoStart: getAutoStartStatus()
}));

ipcMain.handle("printers:list", async () => listPrinters());

ipcMain.handle("printers:select", async (_event, key) => {
  await selectPrinterByKey(String(key || ""));
  return listPrinters();
});

ipcMain.handle("logs:get", async () => getLogs());

ipcMain.handle("logs:export", async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Exportar log Tickeo",
    defaultPath: `tickeo-pos-printer-${new Date().toISOString().slice(0, 10)}.log`,
    filters: [{ name: "Log", extensions: ["log", "txt", "json"] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  const content = getLogs()
    .map((entry) => JSON.stringify(entry))
    .join("\n");
  await writeFile(result.filePath, `${content}\n`, "utf8");
  return { ok: true, filePath: result.filePath };
});

ipcMain.handle("print-config:get", async () => getPrintConfig());

ipcMain.handle("print-config:set", async (_event, config) => {
  const nextConfig = setPrintConfig(config || {});
  await savePrintConfig(nextConfig);
  return nextConfig;
});

ipcMain.handle("print:test", async () => {
  await printTestReceipt();
  return { ok: true };
});

ipcMain.handle("updates:check", async () => checkForUpdates({ manual: true }));

ipcMain.handle("settings:get", async () => ({ ...appSettings }));

ipcMain.handle("settings:set", async (_event, settings) => saveAppSettings(settings || {}));

ipcMain.handle("debug:upload", async () => {
  if (!appSettings.shareDebugData) {
    return { ok: false, disabled: true, error: "Compartir datos de depuracion esta desactivado" };
  }

  const report = await buildDebugReport();
  const response = await fetch(DEBUG_UPLOAD_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Tickeo-Agent": "tickeo-pos-printer-agent"
    },
    body: report
  });

  return {
    ok: response.ok,
    status: response.status,
    responseText: await response.text().catch(() => "")
  };
});

ipcMain.handle("usbdk:open-download", async () => {
  await shell.openExternal(USB_DK_RELEASES_URL);
  return { ok: true, url: USB_DK_RELEASES_URL };
});

ipcMain.handle("autostart:get", async () => getAutoStartStatus());

ipcMain.handle("autostart:set", async (_event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: false
  });
  return getAutoStartStatus();
});
