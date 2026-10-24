'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qb', {
  get: () => ipcRenderer.invoke('get'),
  act: (name, ...args) => ipcRenderer.invoke('act', name, args),
  ui: (cmd, arg) => ipcRenderer.send('ui', cmd, arg),
  exportData: () => ipcRenderer.invoke('export'),
  importData: () => ipcRenderer.invoke('import'),
  onState: (fn) => ipcRenderer.on('state', (_e, p) => fn(p)),
  onNav: (fn) => ipcRenderer.on('nav', (_e, v) => fn(v)),
  onCaptureOpen: (fn) => ipcRenderer.on('capture:open', () => fn()),
  onOverlayHabit: (fn) => ipcRenderer.on('overlay:habit', (_e, id) => fn(id)),
  onHudLayout: (fn) => ipcRenderer.on('hud:layout', (_e, l) => fn(l)),
  platform: process.platform,
});
