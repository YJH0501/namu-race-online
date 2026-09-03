'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('namuRace', {
  defaultServerUrl: () => ipcRenderer.invoke('get-default-server-url'),
  request: (serverUrl, method, path, body) => ipcRenderer.invoke('online-request', { serverUrl, method, path, body }),
  showWiki: (title) => ipcRenderer.send('show-wiki', title),
  hideWiki: () => ipcRenderer.send('hide-wiki'),
  setWikiBounds: (bounds) => ipcRenderer.send('set-wiki-bounds', bounds),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  onWikiLink: (callback) => ipcRenderer.on('wiki-link-clicked', (_event, payload) => callback(payload)),
  onWikiBlocked: (callback) => ipcRenderer.on('wiki-navigation-blocked', (_event, payload) => callback(payload)),
  onWikiLoadState: (callback) => ipcRenderer.on('wiki-load-state', (_event, payload) => callback(payload)),
});
