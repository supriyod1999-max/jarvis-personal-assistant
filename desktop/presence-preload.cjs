const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jarvisPresence', Object.freeze({
  ready: () => ipcRenderer.invoke('jarvis:presence-ready'),
  report: state => ipcRenderer.invoke('jarvis:presence-state', state),
  disable: () => ipcRenderer.invoke('jarvis:presence-off'),
  open: () => ipcRenderer.invoke('jarvis:presence-open'),
  wake: () => ipcRenderer.invoke('jarvis:presence-wake'),
  coding: () => ipcRenderer.invoke('jarvis:coding-read'),
  setCoding: value => ipcRenderer.invoke('jarvis:coding-enabled', value),
  openCoding: id => ipcRenderer.invoke('jarvis:coding-open', id),
  onConfig: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('jarvis:presence-config', listener); return () => ipcRenderer.removeListener('jarvis:presence-config', listener); },
}));
