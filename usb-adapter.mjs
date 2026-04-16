import os from "node:os";
import { EventEmitter } from "node:events";
import usbModule from "usb";

const usb = usbModule.usb || usbModule;

if (os.platform() === "win32" && typeof usbModule.useUsbDkBackend === "function") {
  try {
    usbModule.useUsbDkBackend();
  } catch {
    // If UsbDk is unavailable we'll fall back to the default backend and surface the real open error later.
  }
}

const IFACE_CLASS = {
  PRINTER: 0x07
};

export default class USBAdapter extends EventEmitter {
  static findPrinter() {
    return usb.getDeviceList().filter((device) => {
      try {
        return device.configDescriptor.interfaces.some((iface) =>
          iface.some((conf) => conf.bInterfaceClass === IFACE_CLASS.PRINTER)
        );
      } catch {
        return false;
      }
    });
  }

  static getDevice(vid, pid) {
    return new Promise((resolve, reject) => {
      const device = new USBAdapter(vid, pid);
      device.open((err) => {
        if (err) return reject(err);
        resolve(device);
      });
    });
  }

  constructor(vid, pid) {
    super();

    this.device = null;
    this.endpoint = null;
    this._detachListener = null;

    if (vid && pid) {
      this.device = usb.findByIds(vid, pid);
    } else if (vid) {
      this.device = vid;
    } else {
      const devices = USBAdapter.findPrinter();
      if (devices.length) this.device = devices[0];
    }

    if (!this.device) {
      throw new Error("Can not find printer");
    }

    this._detachListener = (device) => {
      if (device === this.device) {
        this.emit("detach", device);
        this.emit("disconnect", device);
        this.device = null;
      }
    };

    usb.on("detach", this._detachListener);
  }

  open(callback) {
    try {
      this.device.open();
    } catch (error) {
      callback?.(error);
      return this;
    }

    const interfaces = this.device.interfaces || [];
    if (!interfaces.length) {
      callback?.(new Error("Can not find endpoint from printer"));
      return this;
    }

    let pending = interfaces.length;
    let settled = false;

    for (const iface of interfaces) {
      iface.setAltSetting(iface.altSetting, () => {
        if (settled) return;

        try {
          if (os.platform() !== "win32" && iface.isKernelDriverActive()) {
            try {
              iface.detachKernelDriver();
            } catch (error) {
              console.error("[ERROR] Could not detach kernel driver: %s", error);
            }
          }

          iface.claim();

          if (!this.endpoint) {
            this.endpoint = iface.endpoints.find((endpoint) => endpoint.direction === "out") || null;
          }

          if (this.endpoint) {
            settled = true;
            this.emit("connect", this.device);
            callback?.(null, this);
            return;
          }
        } catch (error) {
          settled = true;
          callback?.(error);
          return;
        }

        pending -= 1;
        if (!settled && pending === 0) {
          settled = true;
          callback?.(new Error("Can not find endpoint from printer"));
        }
      });
    }

    return this;
  }

  write(data, callback) {
    this.emit("data", data);
    this.endpoint.transfer(data, callback);
    return this;
  }

  close(callback) {
    if (!this.device) {
      callback?.(null);
      return this;
    }

    try {
      this.device.close();
      if (this._detachListener) {
        usb.off("detach", this._detachListener);
      }
      callback?.(null);
      this.emit("close", this.device);
    } catch (error) {
      callback?.(error);
    }

    return this;
  }
}
