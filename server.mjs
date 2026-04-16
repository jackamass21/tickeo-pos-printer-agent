import express from "express";
import cors from "cors";
import readline from "node:readline/promises";
import escpos from "escpos";
import USBAdapter from "./usb-adapter.mjs";
import QRCode from "qrcode";

escpos.USB = USBAdapter;

const app = express();
app.use(cors());
app.use(express.json({ limit: "3mb" }));

let selectedPrinter = null;
let selectedPrinterRef = null;

function log(level, message, meta) {
  const timestamp = new Date().toISOString();
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

async function initializePrinterSelection() {
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

  selectedPrinter = await choosePrinterInteractively(printers);

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

// QR size tuning (dots ~= pixels). Safe defaults for 58mm printers.
// Note: density "d24" often looks smaller; we compensate with a larger default width.
const QR_DENSITY = String(process.env.QR_DENSITY || "d24"); // "s8" | "d8" | "d24" (etc)
const QR_WIDTH_DEFAULT = QR_DENSITY === "d24" ? 280 : 160;
const QR_WIDTH = clampNumber(process.env.QR_WIDTH, 80, 420, QR_WIDTH_DEFAULT);
const QR_MARGIN = clampNumber(process.env.QR_MARGIN, 0, 4, 1);
const QR_FEED = clampNumber(process.env.QR_FEED, 0, 5, 0); // line feeds after QR image

async function qrToImageBuffer(text) {
  const dataUrl = await QRCode.toDataURL(text, {
    margin: Number.isFinite(QR_MARGIN) ? QR_MARGIN : 1,
    width: Number.isFinite(QR_WIDTH) ? QR_WIDTH : 120,
    color: { dark: "#000000", light: "#FFFFFF" }
  });

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Buffer.from(base64, "base64");
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

      try {
        printer
          .align("ct")
          .style("b")
          .size(1, 1)
          .text("TICKEO")
          .size(0, 0)
          .style("normal")
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
            log("info", "Imprimiendo QR como imagen", {
              orderId: payload.order?.id ?? null,
              ticketCode: t.code ?? null
            });

            const imageBuffer = await qrToImageBuffer(String(t.qr_url));

            await new Promise((res, rej) => {
              escpos.Image.load(imageBuffer, "image/png", (result) => {
                if (result instanceof Error) {
                  rej(result);
                  return;
                }

                try {
                  printer.align("ct");
                  // escpos.Printer#image es async, no se puede encadenar con feed/align
                  (async () => {
                    await printer.image(result, QR_DENSITY);
                    if (QR_FEED > 0) printer.feed(QR_FEED);
                    printer.align("lt");
                    res();
                  })().catch(rej);
                } catch (error) {
                  rej(error);
                }
              });
            });
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

await initializePrinterSelection();

app.listen(17891, "127.0.0.1", () => {
  console.log("Tickeo POS Printer Agent escuchando en http://127.0.0.1:17891");
});
