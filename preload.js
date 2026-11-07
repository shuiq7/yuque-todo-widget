'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  onData(callback) {
    ipcRenderer.on('todo:data', (_event, payload) => callback(payload));
  },
  onPinned(callback) {
    ipcRenderer.on('widget:pinned', (_event, value) => callback(Boolean(value)));
  },
  onForceCollapse(callback) {
    ipcRenderer.on('widget:force-collapse', () => callback());
  },
  ready() {
    ipcRenderer.send('widget:ready');
  },
  resize(height) {
    ipcRenderer.send('widget:height', height);
  },
  refresh() {
    ipcRenderer.send('widget:refresh');
  },
  pin(value) {
    ipcRenderer.send('widget:pin', Boolean(value));
  },
  minimize() {
    ipcRenderer.send('widget:minimize');
  },
  saveDocUrl(url) {
    ipcRenderer.send('widget:doc-url', String(url || ''));
  },
  dragStart(screenX, screenY) {
    ipcRenderer.send('widget:drag-start', screenX, screenY);
  },
  dragMove(screenX, screenY) {
    ipcRenderer.send('widget:drag-move', screenX, screenY);
  },
  dragEnd() {
    ipcRenderer.send('widget:drag-end');
  },
  menu() {
    ipcRenderer.send('widget:menu');
  },
  quit() {
    ipcRenderer.send('widget:quit');
  },
});
