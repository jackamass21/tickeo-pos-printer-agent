import express from "express";
import cors from "cors";
import readline from "node:readline/promises";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import escpos from "escpos";
import USBAdapter, { getUsbBackendStatus } from "./usb-adapter.mjs";
import QRCode from "qrcode";

escpos.USB = USBAdapter;

const app = express();
app.use(cors());
app.use(express.json({ limit: "3mb" }));

export const serviceEvents = new EventEmitter();

let selectedPrinter = null;
let selectedPrinterRef = null;
let serverInstance = null;
let startedAt = null;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17891;
const logEntries = [];
const MAX_LOG_ENTRIES = 500;
const QR_IMAGE_DENSITIES = ["s8", "d8", "d24"];
const QR_NATIVE_LEVELS = ["L", "M", "Q", "H"];
const FONT_FAMILIES = ["A", "B", "C"];

let printConfig = normalizePrintConfig({
  qrMode: process.env.QR_MODE || "image",
  qrImageDensity: process.env.QR_DENSITY || "d24",
  qrImageWidth: process.env.QR_WIDTH,
  qrImageMargin: process.env.QR_MARGIN,
  qrNativeVersion: process.env.QR_VERSION,
  qrNativeLevel: process.env.QR_LEVEL,
  qrNativeSize: process.env.QR_NATIVE_SIZE,
  qrFeed: process.env.QR_FEED,
  fontFamily: process.env.PRINTER_FONT || "A",
  titleWidth: process.env.PRINTER_TITLE_WIDTH,
  titleHeight: process.env.PRINTER_TITLE_HEIGHT,
  textWidth: process.env.PRINTER_TEXT_WIDTH,
  textHeight: process.env.PRINTER_TEXT_HEIGHT
});

function log(level, message, meta) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, meta: meta ?? null };
  logEntries.push(entry);
  if (logEntries.length > MAX_LOG_ENTRIES) logEntries.shift();
  serviceEvents.emit("log", entry);

  if (meta === undefined) {
    console[level](`[${timestamp}] ${message}`);
    return;
  }

  console[level](`[${timestamp}] ${message}`, meta);
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return { error: String(error) };
}

function summarizePayload(payload = {}) {
  return {
    orderId: payload.order?.id ?? null,
    buyerEmail: payload.order?.buyer_email ?? null,
    eventName: payload.event?.name ?? null,
    ticketCount: Array.isArray(payload.tickets) ? payload.tickets.length : 0
  };
}

function toHex(value, width = 4) {
  return `0x${Number(value ?? 0).toString(16).padStart(width, "0")}`;
}

async function getStringDescriptorSafe(device, index) {
  if (!index) return null;

  return new Promise((resolve) => {
    device.getStringDescriptor(index, (error, value) => {
      if (error) {
        resolve(null);
        return;
      }

      resolve(typeof value === "string" ? value : String(value));
    });
  });
}

async function getPrinterUsbNames(device) {
  let openedHere = false;

  try {
    if (!device.interfaces) {
      device.open();
      openedHere = true;
    }

    const manufacturer = await getStringDescriptorSafe(device, device.deviceDescriptor?.iManufacturer);
    const product = await getStringDescriptorSafe(device, device.deviceDescriptor?.iProduct);

    return {
      manufacturer,
      product
    };
  } catch {
    return {
      manufacturer: null,
      product: null
    };
  } finally {
    if (openedHere) {
      try {
        device.close();
      } catch {}
    }
  }
}

async function describePrinter(device, index) {
  const names = await getPrinterUsbNames(device);

  return {
    index,
    manufacturer: names.manufacturer,
    product: names.product,
    vendorId: toHex(device.deviceDescriptor?.idVendor),
    productId: toHex(device.deviceDescriptor?.idProduct),
    busNumber: device.busNumber ?? null,
    deviceAddress: device.deviceAddress ?? null,
    portNumbers: Array.isArray(device.portNumbers) ? device.portNumbers.join(".") : null
  };
}

function getAvailablePrinters() {
  return USBAdapter.findPrinter();
}

function buildPrinterRef(device) {
  return {
    vendorId: device.deviceDescriptor?.idVendor ?? null,
    productId: device.deviceDescriptor?.idProduct ?? null,
    busNumber: device.busNumber ?? null,
    deviceAddress: device.deviceAddress ?? null,
    portNumbers: Array.isArray(device.portNumbers) ? device.portNumbers.join(".") : null
  };
}

function isSamePrinter(device, ref) {
  if (!ref) return false;

  return (
    device.deviceDescriptor?.idVendor === ref.vendorId &&
    device.deviceDescriptor?.idProduct === ref.productId &&
    device.busNumber === ref.busNumber &&
    device.deviceAddress === ref.deviceAddress
  );
}

function getSelectedPrinterDevice() {
  const printers = getAvailablePrinters();

  if (!printers.length) {
    return null;
  }

  if (!selectedPrinterRef) {
    return printers[0];
  }

  return printers.find((device) => isSamePrinter(device, selectedPrinterRef)) ?? printers[0];
}

function refKey(ref) {
  return [
    ref.vendorId ?? "",
    ref.productId ?? "",
    ref.busNumber ?? "",
    ref.deviceAddress ?? "",
    ref.portNumbers ?? ""
  ].join(":");
}

async function listPrinters() {
  const printers = getAvailablePrinters();
  const describedPrinters = await Promise.all(
    printers.map((device, index) => describePrinter(device, index + 1))
  );

  return describedPrinters.map((printer, index) => {
    const ref = buildPrinterRef(printers[index]);
    return {
      ...printer,
      ref,
      key: refKey(ref),
      selected: selectedPrinterRef ? isSamePrinter(printers[index], selectedPrinterRef) : index === 0
    };
  });
}

async function selectPrinterByKey(key) {
  const printers = getAvailablePrinters();
  const indexed = printers.map((device) => ({ device, ref: buildPrinterRef(device) }));
  const found = indexed.find((entry) => refKey(entry.ref) === key);

  if (!found) {
    throw new Error("Impresora no encontrada");
  }

  selectedPrinter = found.device;
  selectedPrinterRef = found.ref;
  log("info", "Impresora seleccionada desde panel", await describePrinter(found.device, printers.indexOf(found.device) + 1));
  return selectedPrinterRef;
}

async function choosePrinterInteractively(printers) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return printers[0] ?? null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question(`Selecciona impresora [1-${printers.length}] (default 1): `);
    const chosenIndex = Number.parseInt(answer.trim() || "1", 10);

    if (!Number.isInteger(chosenIndex) || chosenIndex < 1 || chosenIndex > printers.length) {
      log("warn", "Seleccion invalida, se usara la impresora 1");
      return printers[0];
    }

    return printers[chosenIndex - 1];
  } finally {
    rl.close();
  }
}

export async function initializePrinterSelection({ interactive = true } = {}) {
  const printers = getAvailablePrinters();

  if (!printers.length) {
    log("warn", "No se detectaron impresoras USB compatibles al iniciar");
    return;
  }

  const describedPrinters = await Promise.all(
    printers.map((device, index) => describePrinter(device, index + 1))
  );

  log("info", "Impresoras USB detectadas", describedPrinters);

  if (printers.length === 1) {
    selectedPrinter = printers[0];
    selectedPrinterRef = buildPrinterRef(printers[0]);
    log("info", "Se selecciono automaticamente la unica impresora disponible", describedPrinters[0]);
    return;
  }

  selectedPrinter = interactive ? await choosePrinterInteractively(printers) : printers[0];

  if (selectedPrinter) {
    selectedPrinterRef = buildPrinterRef(selectedPrinter);
    const index = printers.indexOf(selectedPrinter) + 1;
    log("info", "Impresora seleccionada", describedPrinters[index - 1] ?? await describePrinter(selectedPrinter, index));
  }
}

function money(v) {
  const n = Number(v || 0);
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeChoice(value, allowed, fallback) {
  const normalized = String(value || "").toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizePrintConfig(config = {}) {
  const qrImageDensity = String(config.qrImageDensity || "d24").toLowerCase();
  const density = QR_IMAGE_DENSITIES.includes(qrImageDensity) ? qrImageDensity : "d24";
  const qrMode = ["image", "native"].includes(String(config.qrMode || "")) ? String(config.qrMode) : "image";
  const defaultImageWidth = density === "d24" ? 280 : 160;

  return {
    qrMode,
    qrImageDensity: density,
    qrImageWidth: clampNumber(config.qrImageWidth, 80, 420, defaultImageWidth),
    qrImageMargin: clampNumber(config.qrImageMargin, 0, 4, 1),
    qrNativeVersion: clampNumber(config.qrNativeVersion, 1, 16, 3),
    qrNativeLevel: normalizeChoice(config.qrNativeLevel, QR_NATIVE_LEVELS, "L"),
    qrNativeSize: clampNumber(config.qrNativeSize, 1, 8, 6),
    qrFeed: clampNumber(config.qrFeed, 0, 5, 0),
    fontFamily: normalizeChoice(config.fontFamily, FONT_FAMILIES, "A"),
    titleWidth: clampNumber(config.titleWidth, 0, 3, 1),
    titleHeight: clampNumber(config.titleHeight, 0, 3, 1),
    textWidth: clampNumber(config.textWidth, 0, 3, 0),
    textHeight: clampNumber(config.textHeight, 0, 3, 0)
  };
}

export function getPrintConfig() {
  return { ...printConfig };
}

export function setPrintConfig(config = {}) {
  printConfig = normalizePrintConfig({ ...printConfig, ...config });
  log("info", "Configuracion de impresion actualizada", printConfig);
  return getPrintConfig();
}

async function qrToImageBuffer(text, config) {
  const dataUrl = await QRCode.toDataURL(text, {
    margin: config.qrImageMargin,
    width: config.qrImageWidth,
    color: { dark: "#000000", light: "#FFFFFF" }
  });

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Buffer.from(base64, "base64");
}

async function printQr(printer, qrText, config) {
  printer.align("ct");

  if (config.qrMode === "native") {
    printer.qrcode(qrText, config.qrNativeVersion, config.qrNativeLevel, config.qrNativeSize);
    if (config.qrFeed > 0) printer.feed(config.qrFeed);
    printer.align("lt");
    return;
  }

  const imageBuffer = await qrToImageBuffer(qrText, config);
  await new Promise((res, rej) => {
    escpos.Image.load(imageBuffer, "image/png", (result) => {
      if (result instanceof Error) {
        rej(result);
        return;
      }

      (async () => {
        await printer.image(result, config.qrImageDensity);
        if (config.qrFeed > 0) printer.feed(config.qrFeed);
        printer.align("lt");
        res();
      })().catch(rej);
    });
  });
}

async function printReceipt(payload) {
  log("info", "Iniciando impresion", summarizePayload(payload));

  const printerDevice = getSelectedPrinterDevice();

  if (!printerDevice) {
    throw new Error("No hay impresoras USB disponibles");
  }

  log("info", "Usando impresora seleccionada", {
    ...selectedPrinterRef,
    currentBusNumber: printerDevice.busNumber ?? null,
    currentDeviceAddress: printerDevice.deviceAddress ?? null
  });

  const device = new escpos.USB(printerDevice);
  const options = { encoding: "GB18030" };

  return new Promise((resolve, reject) => {
    device.open(async (err) => {
      if (err) {
        log("error", "Error al abrir dispositivo USB", {
          ...summarizePayload(payload),
          error: serializeError(err)
        });
        return reject(err);
      }

      const printer = new escpos.Printer(device, options);
      const config = getPrintConfig();

      try {
        printer
          .font(config.fontFamily)
          .align("ct")
          .style("b")
          .size(config.titleWidth, config.titleHeight)
          .text("TICKEO")
          .style("normal")
          .size(config.textWidth, config.textHeight)
          .text(payload.event.name || "")
          .text(`${payload.event.city || ""} - ${payload.event.venue_name || ""}`.trim())
          .text(payload.event.starts_at || "")
          .drawLine();

        printer.align("lt");
        printer.text(`ORDEN: #${payload.order.id}`);
        if (payload.order.buyer_name) printer.text(`NOMBRE: ${payload.order.buyer_name}`);
        if (payload.order.buyer_email) printer.text(`EMAIL: ${payload.order.buyer_email}`);
        if (payload.order.payment_provider) printer.text(`PAGO: ${payload.order.payment_provider}`);
        printer.drawLine();

        for (const t of payload.tickets || []) {
          printer.style("b").text(t.ticket_type || "");
          printer.style("normal");

          if (t.zone) printer.text(`ZONA: ${t.zone}`);
          if (t.row) printer.text(`FILA: ${t.row}`);
          if (t.seat) printer.text(`ASIENTO: ${t.seat}`);
          printer.text(`CODIGO: ${t.code || ""}`);

          if (t.qr_url) {
            log("info", "Imprimiendo QR", {
              orderId: payload.order?.id ?? null,
              ticketCode: t.code ?? null,
              qrMode: config.qrMode
            });

            await printQr(printer, String(t.qr_url), config);
          }

          printer.drawLine();
        }

        printer
          .style("b")
          .text(`SUBTOTAL: ${money(payload.order.subtotal)}`)
          .text(`SERVICIO: ${money(payload.order.service_fee)}`)
          .text(`TOTAL: ${money(payload.order.total)}`)
          .style("normal")
          .drawLine()
          .align("ct")
          .text("Gracias por tu compra")
          .text("Tickeo")
          .feed(4)
          .cut()
          .close();

        log("info", "Impresion completada", summarizePayload(payload));
        resolve(true);
      } catch (e) {
        try { printer.close(); } catch {}
        log("error", "Error durante la impresion", {
          ...summarizePayload(payload),
          error: serializeError(e)
        });
        reject(e);
      }
    });
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/status", async (_req, res) => {
  res.json(await getServiceStatus());
});

app.get("/printers", async (_req, res) => {
  res.json({ printers: await listPrinters() });
});

app.post("/printers/select", async (req, res) => {
  try {
    await selectPrinterByKey(String(req.body?.key || ""));
    res.json({ ok: true, selectedPrinterRef });
  } catch (e) {
    res.status(404).json({ ok: false, error: String(e) });
  }
});

app.get("/logs", (_req, res) => {
  res.json({ logs: getLogs() });
});

app.get("/config/print", (_req, res) => {
  res.json({ config: getPrintConfig() });
});

app.post("/config/print", (req, res) => {
  res.json({ ok: true, config: setPrintConfig(req.body || {}) });
});

app.post("/print/test", async (_req, res) => {
  try {
    await printTestReceipt();
    res.json({ ok: true });
  } catch (e) {
    log("error", "Fallo impresion de prueba", serializeError(e));
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/print", async (req, res) => {
  try {
    await printReceipt(req.body);
    res.json({ ok: true });
  } catch (e) {
    log("error", "Fallo la solicitud /print", {
      ...summarizePayload(req.body),
      error: serializeError(e)
    });
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export function getLogs() {
  return [...logEntries];
}

export async function printTestReceipt() {
  return printReceipt({
    event: {
      name: "Prueba Tickeo",
      city: "Santiago",
      venue_name: "POS",
      starts_at: new Date().toLocaleString("es-CL")
    },
    order: {
      id: "TEST",
      buyer_name: "Cliente de prueba",
      buyer_email: "test@tickeo.cl",
      payment_provider: "TEST",
      subtotal: 1000,
      service_fee: 0,
      total: 1000
    },
    tickets: [
      {
        ticket_type: "Entrada demo",
        zone: "General",
        row: "A",
        seat: "1",
        code: "TEST-QR-123",
        qr_url: "https://tickeo.cl/test-print"
      }
    ]
  });
}

export async function getServiceStatus() {
  const printers = await listPrinters();
  return {
    ok: Boolean(serverInstance?.listening),
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    url: `http://${DEFAULT_HOST}:${DEFAULT_PORT}`,
    startedAt,
    selectedPrinterRef,
    printerCount: printers.length,
    printers,
    usbBackend: getUsbBackendStatus(),
    pid: process.pid,
    platform: process.platform,
    node: process.version
  };
}

export { listPrinters, selectPrinterByKey, printReceipt };

export async function startService({ host = DEFAULT_HOST, port = DEFAULT_PORT, interactive = false } = {}) {
  if (serverInstance?.listening) {
    return serverInstance;
  }

  await initializePrinterSelection({ interactive });

  return new Promise((resolve, reject) => {
    serverInstance = app.listen(port, host, () => {
      startedAt = new Date().toISOString();
      log("info", `Tickeo POS Printer Agent escuchando en http://${host}:${port}`);
      resolve(serverInstance);
    });

    serverInstance.once("error", (error) => {
      log("error", "No se pudo iniciar servicio HTTP", serializeError(error));
      reject(error);
    });
  });
}

export async function stopService() {
  if (!serverInstance) return;

  await new Promise((resolve, reject) => {
    serverInstance.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  log("info", "Servicio HTTP detenido");
  serverInstance = null;
  startedAt = null;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  await startService({ interactive: true });
}
