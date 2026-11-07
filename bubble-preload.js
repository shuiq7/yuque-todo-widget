'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbleApi', {
  open() {
    ipcRenderer.send('widget:bubble-open');
  },
  dragStart(screenX, screenY) {
    ipcRenderer.send('widget:bubble-drag-start', screenX, screenY);
  },
  dragMove(screenX, screenY) {
    ipcRenderer.send('widget:bubble-drag-move', screenX, screenY);
  },
  dragEnd() {
    ipcRenderer.send('widget:bubble-drag-end');
  },
  onCount(callback) {
    ipcRenderer.on('widget:bubble-count', (_event, count) => callback(Number(count) || 0));
  },
});
