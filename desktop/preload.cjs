const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jarvisDesktop', Object.freeze({
  status: () => ipcRenderer.invoke('jarvis:status'),
  start: () => ipcRenderer.invoke('jarvis:action', 'start'),
  restart: () => ipcRenderer.invoke('jarvis:action', 'restart'),
  stop: () => ipcRenderer.invoke('jarvis:action', 'stop'),
  hide: () => ipcRenderer.invoke('jarvis:hide'),
  wake: () => ipcRenderer.invoke('jarvis:wake'),
  forgetMicrophone: () => ipcRenderer.invoke('jarvis:forget-microphone'),
  mode: value => ipcRenderer.invoke('jarvis:mode', value),
  workspace: id => ipcRenderer.invoke('jarvis:workspace', id),
  controls: () => ipcRenderer.invoke('jarvis:controls'),
}));
