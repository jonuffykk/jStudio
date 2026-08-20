'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { app, shell } = require('electron');
const { compareVersions } = require('./updater');

const PLUGIN_PATTERN = /^jSpoofer-v(\d+(?:\.\d+)*)\.rbxmx$/i;
const LEGACY_PATTERN = /^(jSpoofer|JonuffySpoofer).*\.rbxmx$/i;

const pluginsDir = () =>
  path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Roblox',
    'Plugins'
  );

const listDir = dir => fs.readdir(dir).catch(() => []);

const versionOf = name => name.match(PLUGIN_PATTERN)?.[1] || name.match(/v(\d+(?:\.\d+)*)/i)?.[1] || null;

const bundledPlugin = async () => {
  const candidates = [
    process.resourcesPath,
    path.join(app.getAppPath(), 'dist'),
    path.join(app.getAppPath(), '..', 'dist'),
    app.getAppPath(),
  ].filter(Boolean);

  for (const dir of candidates) {
    const match = (await listDir(dir)).find(name => PLUGIN_PATTERN.test(name));
    if (match) return path.join(dir, match);
  }
  return null;
};

const installedPlugin = async () => {
  const dir = pluginsDir();
  const match = (await listDir(dir)).find(name => LEGACY_PATTERN.test(name));
  return match ? path.join(dir, match) : null;
};

const status = async () => {
  if (process.platform !== 'win32') return { supported: false, installed: false };
  const installed = await installedPlugin();
  return {
    supported: true,
    installed: !!installed,
    file: installed ? path.basename(installed) : null,
    path: installed,
    version: installed ? versionOf(path.basename(installed)) : null,
  };
};

const updateStatus = async () => {
  if (process.platform !== 'win32') return { hasUpdate: false };
  const bundled = await bundledPlugin();
  const bundledVersion = bundled ? versionOf(path.basename(bundled)) : null;
  if (!bundledVersion) return { hasUpdate: false };
  const current = await status();
  return {
    hasUpdate: !current.version || compareVersions(bundledVersion, current.version) > 0,
    bundledVersion,
    installedVersion: current.version,
  };
};

const install = async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const source = await bundledPlugin();
  if (!source) return { ok: false, error: 'Plugin file missing — run npm run plugin first.' };

  const dir = pluginsDir();
  try {
    await fs.mkdir(dir, { recursive: true });
    const stale = (await listDir(dir)).filter(name => LEGACY_PATTERN.test(name));
    await Promise.all(stale.map(name => fs.rm(path.join(dir, name), { force: true })));
    const destination = path.join(dir, path.basename(source));
    await fs.copyFile(source, destination);
    return { ok: true, path: destination };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

const reveal = async () => {
  const dir = pluginsDir();
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  shell.openPath(dir);
};

module.exports = { install, pluginsDir, reveal, status, updateStatus };
