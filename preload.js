'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result?.ok) throw new Error(result?.error || 'Request failed');
  return result.data;
};

const listen = (channel, handler) => {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
};

contextBridge.exposeInMainWorld('jspoofer', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
  },
  app: {
    version: () => call('app:version'),
    openExternal: url => ipcRenderer.send('app:openExternal', url),
    uninstall: () => call('app:uninstall'),
    setTheme: theme => ipcRenderer.send('app:theme', theme),
    selectFolder: () => call('app:selectFolder'),
  },
  auth: {
    list: () => call('auth:list'),
    signIn: (cookie, apiKey) => call('auth:signIn', cookie, apiKey),
    switch: id => call('auth:switch', id),
    remove: id => call('auth:remove', id),
    signOut: () => call('auth:signOut'),
    groups: () => call('auth:groups'),
    checkGroup: groupId => call('auth:checkGroup', groupId),
  },
  plugin: {
    status: () => call('plugin:status'),
    updateStatus: () => call('plugin:updateStatus'),
    install: () => call('plugin:install'),
    reveal: () => call('plugin:reveal'),
  },
  run: {
    start: options => call('run:start', options),
    pause: () => ipcRenderer.send('run:pause'),
    resume: () => ipcRenderer.send('run:resume'),
    stop: () => ipcRenderer.send('run:stop'),
  },
  history: {
    runs: () => call('history:runs'),
    clearRuns: () => call('history:clearRuns'),
    clearMappings: () => call('history:clearMappings'),
  },
  updates: {
    check: () => call('update:check'),
    download: () => call('update:download'),
    apply: () => call('update:apply'),
  },
  on: listen,
});
