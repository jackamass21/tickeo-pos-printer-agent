import express from "express";
import cors from "cors";
import escpos from "escpos";
import escposUSB from "escpos-usb";
import QRCode from "qrcode";

escpos.USB = escposUSB;

const app = express();
app.use(cors());
app.use(express.json({ limit: "3mb" }));

function money(v) {
  const n = Number(v || 0);
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

async function qrToImageBuffer(text) {
  const dataUrl = await QRCode.toDataURL(text, {
    margin: 1,
    width: 220,
    color: { dark: "#000000", light: "#FFFFFF" }
  });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Buffer.from(base64, "base64");
}

async function printReceipt(payload) {
  const device = new escpos.USB();
  const options = { encoding: "GB18030" };

  return new Promise((resolve, reject) => {
    device.open(async (err) => {
      if (err) return reject(err);

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
            const imageBuffer = await qrToImageBuffer(t.qr_url);

            await new Promise((res, rej) => {
              escpos.Image.load(imageBuffer, (img) => {
                try {
                  printer.align("ct").raster(img, "dwdh").align("lt");
                  res();
                } catch (e) {
                  rej(e);
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

        resolve(true);
      } catch (e) {
        try { printer.close(); } catch {}
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
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(17891, "127.0.0.1", () => {
  console.log("Tickeo POS Printer Agent escuchando en http://127.0.0.1:17891");
});
