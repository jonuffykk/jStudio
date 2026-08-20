'use strict';

const { app } = require('electron');
const { APP_ID } = require('./src/main/config');
const { bridge } = require('./src/main/bridge');
const { migrateLegacyFiles } = require('./src/main/history');
const { register } = require('./src/main/ipc');
const { boot, broadcast, focusMain } = require('./src/main/windows');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  app.on('second-instance', focusMain);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => bridge.stop());

  app.whenReady().then(async () => {
    await migrateLegacyFiles().catch(() => {});
    register();
    await boot();
    bridge.start();
  });

  const report = error => broadcast('run:status', error?.message ?? String(error));
  process.on('uncaughtException', report);
  process.on('unhandledRejection', report);
}
