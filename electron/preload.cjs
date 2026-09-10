const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tickeoAgent", {
  getStatus: () => ipcRenderer.invoke("status:get"),
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  selectPrinter: (key) => ipcRenderer.invoke("printers:select", key),
  getLogs: () => ipcRenderer.invoke("logs:get"),
  exportLogs: () => ipcRenderer.invoke("logs:export"),
  getPrintConfig: () => ipcRenderer.invoke("print-config:get"),
  setPrintConfig: (config) => ipcRenderer.invoke("print-config:set", config),
  printTest: () => ipcRenderer.invoke("print:test"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  uploadDebugData: () => ipcRenderer.invoke("debug:upload"),
  openUsbDkDownload: () => ipcRenderer.invoke("usbdk:open-download"),
  getAutoStart: () => ipcRenderer.invoke("autostart:get"),
  setAutoStart: (enabled) => ipcRenderer.invoke("autostart:set", enabled),
  onLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on("logs:new", listener);
    return () => ipcRenderer.removeListener("logs:new", listener);
  }
});
