import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,
  quit: () => ipcRenderer.send('app-quit'),
});
