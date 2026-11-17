'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('NaqshDesktopStore', Object.freeze({
  listProjects: () => ipcRenderer.invoke('naqsh:projects:list'),
  getProject: id => ipcRenderer.invoke('naqsh:projects:get', id),
  saveProject: (id, payload) => ipcRenderer.invoke('naqsh:projects:save', id, payload),
  removeProject: id => ipcRenderer.invoke('naqsh:projects:remove', id)
}));
