'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { app, dialog, ipcMain } = require('electron');
const { bridge } = require('./bridge');
const { Run, RunError } = require('./run/pipeline');
const history = require('./history');
const plugin = require('./plugin');
const updater = require('./updater');
const vault = require('./vault');
const { getGroups, getProfile } = require('./roblox/api');
const { probeUploadPermission } = require('./roblox/assets');
const { filePath } = require('./lib');
const { broadcast, getMainWindow, openExternal, setTheme } = require('./windows');

let activeRun = null;
let stagedUpdate = null;

const handle = (channel, fn) =>
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

const requireString = (value, label) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required`);
  return text;
};

const activeAccount = async () => {
  const account = await vault.getActive();
  if (!account) throw new Error('No account is signed in');
  return account;
};

const startRun = async options => {
  if (activeRun) throw new Error('A run is already in progress');
  const account = await activeAccount();

  const run = new Run({
    options,
    credentials: { id: account.id, cookie: account.cookie, apiKey: account.apiKey },
    bridge,
    emit: broadcast,
  });
  activeRun = run;

  try {
    const result = await run.execute();
    broadcast('run:result', result);
    return result;
  } catch (error) {
    const message = error instanceof RunError ? error.message : `The run stopped: ${error.message}`;
    broadcast('run:event', { kind: 'error', at: Date.now(), message });
    broadcast('run:result', { ok: false, done: 0, failed: 0, mappings: [], error: message });
    return { ok: false, error: message };
  } finally {
    activeRun = null;
  }
};

const uninstall = async () => {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const installed = await plugin.status();
  const targets = [
    app.getPath('userData'),
    path.join(localAppData, 'jSpoofer'),
    path.join(localAppData, 'Programs', 'jSpoofer'),
    path.join(app.getPath('desktop'), 'jSpoofer.lnk'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'jSpoofer.lnk'),
    installed.path,
  ].filter(Boolean);

  await Promise.all(targets.map(target => fs.rm(target, { recursive: true, force: true }).catch(() => {})));
  app.quit();
  return true;
};

const downloadUpdate = async () => {
  const release = await updater.getLatestRelease();
  if (!release.hasUpdate || !release.assetUrl) throw new Error('No update is available');

  const destination = filePath(path.join('updates', release.assetName ?? 'jSpoofer.exe'));
  const { size } = await updater.downloadRelease(release.assetUrl, destination, progress =>
    broadcast('update:progress', progress)
  );

  if (size < 1024 * 1024 || (release.assetSize && Math.abs(size - release.assetSize) > 4096)) {
    await fs.rm(destination, { force: true });
    throw new Error('The download was incomplete — try again');
  }

  if (release.checksumUrl) {
    const expected = await updater.expectedChecksum(release.checksumUrl, release.assetName).catch(() => null);
    if (expected && (await updater.sha256File(destination)) !== expected) {
      await fs.rm(destination, { force: true });
      throw new Error('Checksum mismatch — the download was rejected');
    }
  }

  stagedUpdate = destination;
  return { path: destination, size };
};

const register = () => {
  ipcMain.on('window:minimize', () => getMainWindow()?.minimize());
  ipcMain.on('window:close', () => app.quit());
  ipcMain.on('app:openExternal', (_event, url) => openExternal(url));
  ipcMain.on('app:theme', (_event, value) => setTheme(value));
  ipcMain.on('run:pause', () => activeRun?.pause());
  ipcMain.on('run:resume', () => activeRun?.resume());
  ipcMain.on('run:stop', () => activeRun?.stop());

  handle('app:version', () => app.getVersion());
  handle('app:uninstall', uninstall);
  handle('app:selectFolder', async () => {
    const result = await dialog.showOpenDialog(getMainWindow() ?? undefined, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('auth:list', vault.listAccounts);
  handle('auth:signIn', async (cookie, apiKey) => {
    const profile = await getProfile(requireString(cookie, 'The cookie'));
    return vault.upsertAccount(profile, cookie.trim(), requireString(apiKey, 'The API key'));
  });
  handle('auth:switch', id => vault.setActive(requireString(id, 'Account id')));
  handle('auth:remove', id => vault.removeAccount(requireString(id, 'Account id')));
  handle('auth:signOut', vault.clear);
  handle('auth:groups', async () => getGroups((await activeAccount()).cookie));
  handle('auth:checkGroup', async groupId =>
    probeUploadPermission((await activeAccount()).apiKey, groupId ?? null)
  );

  handle('plugin:status', plugin.status);
  handle('plugin:updateStatus', plugin.updateStatus);
  handle('plugin:install', plugin.install);
  handle('plugin:reveal', plugin.reveal);

  handle('run:start', startRun);

  handle('history:runs', history.loadRuns);
  handle('history:clearRuns', async () => {
    await history.clearRuns();
    return true;
  });
  handle('history:clearMappings', async () => {
    await history.clearMappings();
    return true;
  });

  handle('update:check', updater.getLatestRelease);
  handle('update:download', downloadUpdate);
  handle('update:apply', async () => {
    if (!stagedUpdate) throw new Error('No update has been downloaded yet');
    await updater.applyUpdate(stagedUpdate);
    return true;
  });

  bridge.on('status', payload => broadcast('studio:status', payload));
  bridge.on('selection', payload => broadcast('studio:selection', payload));
  bridge.on('replace', payload => broadcast('studio:replace', payload));
};

module.exports = { register };
