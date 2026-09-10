const api = window.tickeoAgent;

const els = {
  serviceSummary: document.querySelector("#service-summary"),
  servicePill: document.querySelector("#service-pill"),
  statusOk: document.querySelector("#status-ok"),
  statusVersion: document.querySelector("#status-version"),
  statusUrl: document.querySelector("#status-url"),
  statusPort: document.querySelector("#status-port"),
  statusPid: document.querySelector("#status-pid"),
  statusNode: document.querySelector("#status-node"),
  statusPlatform: document.querySelector("#status-platform"),
  statusUpdate: document.querySelector("#status-update"),
  usbDkState: document.querySelector("#usbdk-state"),
  printerList: document.querySelector("#printer-list"),
  logList: document.querySelector("#log-list"),
  autoStart: document.querySelector("#autostart-toggle"),
  refresh: document.querySelector("#refresh-btn"),
  checkUpdate: document.querySelector("#check-update-btn"),
  rescan: document.querySelector("#rescan-btn"),
  exportLog: document.querySelector("#export-log-btn"),
  usbDk: document.querySelector("#usbdk-btn"),
  printConfigForm: document.querySelector("#print-config-form"),
  testPrint: document.querySelector("#test-print-btn"),
  shareDebug: document.querySelector("#share-debug-toggle"),
  uploadDebug: document.querySelector("#upload-debug-btn"),
  debugUploadStatus: document.querySelector("#debug-upload-status")
};

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tab-${name}`);
    });
  });
});

function text(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function renderStatus(status) {
  els.servicePill.textContent = status.ok ? "Activo" : "Detenido";
  els.servicePill.classList.toggle("ok", status.ok);
  els.servicePill.classList.toggle("bad", !status.ok);
  els.serviceSummary.textContent = `${status.url} · ${status.printerCount} impresora(s) detectada(s)`;
  els.statusOk.textContent = status.ok ? "Operativo" : "No disponible";
  els.statusVersion.textContent = text(status.appVersion);
  els.statusUrl.textContent = text(status.url);
  els.statusPort.textContent = text(status.port);
  els.statusPid.textContent = text(status.pid);
  els.statusNode.textContent = text(status.node);
  els.statusPlatform.textContent = text(status.platform);
  els.autoStart.checked = Boolean(status.autoStart);

  const backend = status.usbBackend || {};
  const isWindows = backend.platform === "win32";
  const usbDkOk = Boolean(backend.usbDkLoaded);
  els.usbDkState.classList.toggle("ok", usbDkOk);
  els.usbDkState.textContent = isWindows
    ? usbDkOk
      ? "UsbDK activo para backend USB"
      : "UsbDK no confirmado. Instalar si la impresora no abre."
    : "UsbDK solo aplica en Windows.";

  renderPrinters(status.printers || []);
}

function renderPrinters(printers) {
  if (!printers.length) {
    els.printerList.innerHTML = '<p class="muted">No hay impresoras USB clase printer detectadas.</p>';
    return;
  }

  els.printerList.innerHTML = "";

  for (const printer of printers) {
    const row = document.createElement("div");
    row.className = `printer-row${printer.selected ? " selected" : ""}`;

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "printer-name";
    name.textContent = [printer.manufacturer, printer.product].filter(Boolean).join(" ") || `Impresora USB ${printer.index}`;

    const meta = document.createElement("div");
    meta.className = "printer-meta";
    meta.textContent = [
      `VID ${printer.vendorId}`,
      `PID ${printer.productId}`,
      `Bus ${text(printer.busNumber)}`,
      `Addr ${text(printer.deviceAddress)}`,
      `Puerto ${text(printer.portNumbers)}`
    ].join(" · ");

    info.append(name, meta);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = printer.selected ? "secondary" : "";
    btn.textContent = printer.selected ? "Seleccionada" : "Seleccionar";
    btn.disabled = printer.selected;
    btn.addEventListener("click", async () => {
      await api.selectPrinter(printer.key);
      await refresh();
    });

    row.append(info, btn);
    els.printerList.append(row);
  }
}

function renderLog(entry) {
  const div = document.createElement("div");
  div.className = `log-entry log-${entry.level}`;
  div.textContent = `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}${
    entry.meta ? ` ${JSON.stringify(entry.meta)}` : ""
  }`;
  els.logList.append(div);
  els.logList.scrollTop = els.logList.scrollHeight;
}

function readPrintConfigForm() {
  const data = new FormData(els.printConfigForm);
  return {
    qrMode: data.get("qrMode"),
    qrImageDensity: data.get("qrImageDensity"),
    qrImageWidth: Number(data.get("qrImageWidth")),
    qrImageMargin: Number(data.get("qrImageMargin")),
    qrNativeVersion: Number(data.get("qrNativeVersion")),
    qrNativeLevel: data.get("qrNativeLevel"),
    qrNativeSize: Number(data.get("qrNativeSize")),
    qrFeed: Number(data.get("qrFeed")),
    fontFamily: data.get("fontFamily"),
    titleWidth: Number(data.get("titleWidth")),
    titleHeight: Number(data.get("titleHeight")),
    textWidth: Number(data.get("textWidth")),
    textHeight: Number(data.get("textHeight"))
  };
}

function renderPrintConfig(config) {
  for (const [key, value] of Object.entries(config)) {
    const field = els.printConfigForm.elements[key];
    if (field) field.value = value;
  }
}

async function refreshPrintConfig() {
  renderPrintConfig(await api.getPrintConfig());
}

async function savePrintConfig() {
  renderPrintConfig(await api.setPrintConfig(readPrintConfigForm()));
}

async function refreshSettings() {
  const settings = await api.getSettings();
  els.shareDebug.checked = settings.shareDebugData !== false;
}

async function refresh() {
  const status = await api.getStatus();
  renderStatus(status);
}

async function refreshLogs() {
  els.logList.innerHTML = "";
  const logs = await api.getLogs();
  logs.forEach(renderLog);
}

els.refresh.addEventListener("click", refresh);
els.checkUpdate.addEventListener("click", async () => {
  els.checkUpdate.disabled = true;
  els.statusUpdate.textContent = "Buscando...";
  try {
    const result = await api.checkForUpdates();
    els.statusUpdate.textContent = result.skipped ? "Solo en app instalada" : "Consulta iniciada";
  } catch (error) {
    els.statusUpdate.textContent = error.message || String(error);
  } finally {
    els.checkUpdate.disabled = false;
  }
});
els.rescan.addEventListener("click", refresh);
els.usbDk.addEventListener("click", () => api.openUsbDkDownload());
els.exportLog.addEventListener("click", () => api.exportLogs());
els.printConfigForm.addEventListener("change", savePrintConfig);
els.shareDebug.addEventListener("change", async (event) => {
  const settings = await api.setSettings({ shareDebugData: event.target.checked });
  els.shareDebug.checked = settings.shareDebugData !== false;
});
els.uploadDebug.addEventListener("click", async () => {
  els.uploadDebug.disabled = true;
  els.uploadDebug.textContent = "Enviando...";
  els.debugUploadStatus.textContent = "";
  try {
    const result = await api.uploadDebugData();
    els.debugUploadStatus.textContent = result.ok
      ? "Diagnostico enviado a Tickeo.cl."
      : `No enviado: ${result.error || `HTTP ${result.status}`}`;
  } catch (error) {
    els.debugUploadStatus.textContent = `No enviado: ${error.message || error}`;
  } finally {
    els.uploadDebug.disabled = false;
    els.uploadDebug.textContent = "Enviar diagnostico";
  }
});
els.testPrint.addEventListener("click", async () => {
  els.testPrint.disabled = true;
  els.testPrint.textContent = "Imprimiendo...";
  try {
    await savePrintConfig();
    await api.printTest();
  } finally {
    els.testPrint.disabled = false;
    els.testPrint.textContent = "Probar impresion";
  }
});
els.autoStart.addEventListener("change", async (event) => {
  const enabled = await api.setAutoStart(event.target.checked);
  els.autoStart.checked = Boolean(enabled);
});

api.onLog(renderLog);

refresh();
refreshLogs();
refreshPrintConfig();
refreshSettings();
setInterval(refresh, 5000);
