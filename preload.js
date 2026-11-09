const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  setOpacity: (opacity) => ipcRenderer.invoke('set-opacity', opacity),
  setLayoutMode: (mode) => ipcRenderer.invoke('set-layout-mode', mode)
});
