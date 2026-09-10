'use strict';

const os = require('os');
const util = require('util');
const EventEmitter = require('events');

let usbModule = null;
let usbApi = null;

const IFACE_CLASS = {
  PRINTER: 0x07
};

function loadUsb() {
  if (!usbModule) {
    usbModule = require('usb');
    usbApi = usbModule.usb ?? usbModule;
  }

  return { usbModule, usbApi };
}

function USB(vid, pid) {
  const { usbModule, usbApi } = loadUsb();

  EventEmitter.call(this);
  this.device = null;
  this.endpoint = null;
  this._detachHandler = null;

  if (vid && pid) {
    this.device = typeof usbModule.findByIds === 'function'
      ? usbModule.findByIds(vid, pid)
      : usbApi.findByIds(vid, pid);
  } else if (vid) {
    this.device = vid;
  } else {
    const devices = USB.findPrinter();
    if (devices && devices.length) {
      this.device = devices[0];
    }
  }

  if (!this.device) {
    throw new Error('Can not find printer');
  }

  this._detachHandler = (device) => {
    if (device === this.device) {
      this.emit('detach', device);
      this.emit('disconnect', device);
      this.device = null;
    }
  };

  if (typeof usbApi.on === 'function') {
    usbApi.on('detach', this._detachHandler);
  }

  return this;
}

USB.findPrinter = function findPrinter() {
  const { usbApi } = loadUsb();

  return usbApi.getDeviceList().filter((device) => {
    try {
      return device.configDescriptor.interfaces.some((iface) =>
        iface.some((conf) => conf.bInterfaceClass === IFACE_CLASS.PRINTER)
      );
    } catch {
      return false;
    }
  });
};

util.inherits(USB, EventEmitter);

USB.prototype.open = function open(callback) {
  let claimed = false;

  try {
    this.device.open();
  } catch (error) {
    callback && callback(error);
    return this;
  }

  this.device.interfaces.forEach((iface) => {
    iface.setAltSetting(iface.altSetting, () => {
      try {
        if (os.platform() !== 'win32' && iface.isKernelDriverActive()) {
          try {
            iface.detachKernelDriver();
          } catch (error) {
            console.error('[ERROR] Could not detach kernel driver: %s', error);
          }
        }

        iface.claim();

        iface.endpoints.forEach((endpoint) => {
          if (endpoint.direction === 'out' && !this.endpoint) {
            this.endpoint = endpoint;
          }
        });

        if (this.endpoint && !claimed) {
          claimed = true;
          this.emit('connect', this.device);
          callback && callback(null, this);
        }
      } catch (error) {
        callback && callback(error);
      }
    });
  });

  if (!this.device.interfaces.length) {
    callback && callback(new Error('Can not find endpoint from printer'));
  }

  return this;
};

USB.prototype.write = function write(data, callback) {
  this.emit('data', data);
  this.endpoint.transfer(data, callback);
  return this;
};

USB.prototype.close = function close(callback) {
  const { usbApi } = loadUsb();

  if (!this.device) {
    callback && callback(null);
    return this;
  }

  try {
    this.device.close();
    if (this._detachHandler && typeof usbApi.off === 'function') {
      usbApi.off('detach', this._detachHandler);
    } else if (this._detachHandler && typeof usbApi.removeListener === 'function') {
      usbApi.removeListener('detach', this._detachHandler);
    }
    callback && callback(null);
    this.emit('close', this.device);
  } catch (error) {
    callback && callback(error);
  }

  return this;
};

module.exports = USB;
