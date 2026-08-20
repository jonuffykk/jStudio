'use strict';

const path = require('path');
const { BrowserWindow, app, nativeImage, nativeTheme, shell } = require('electron');
const { EXTERNAL_HOSTS } = require('./config');
const { read, write } = require('./lib');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const SPLASH_MIN_MS = 1100;
const THEME_FILE = 'ui.json';

const BACKGROUND = { dark: '#0d0d12', light: '#f7f7f9' };

let theme = 'dark';

const applyTheme = value => {
  theme = value === 'light' ? 'light' : 'dark';
  nativeTheme.themeSource = theme;
};

const loadTheme = async () => applyTheme((await read(THEME_FILE, null))?.theme);

const setTheme = value => {
  applyTheme(value);
  write(THEME_FILE, { theme });
};

let mainWindow = null;
let splashWindow = null;

const appIcon = nativeImage.createFromPath(
  path.join(ROOT, 'assets', process.platform === 'win32' ? 'logo.ico' : 'logo.png')
);

const isAllowedExternal = url => {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return [...EXTERNAL_HOSTS].some(host => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
};

const openExternal = url => {
  if (isAllowedExternal(url)) shell.openExternal(url);
};

const harden = contents => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
};

const createSplash = () => {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 180,
    icon: appIcon,
    frame: false,
    resizable: false,
    transparent: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(RENDERER, 'splash.html'));
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
};

const createMain = () => {
  const openedAt = Date.now();

  mainWindow = new BrowserWindow({
    width: 920,
    height: 560,
    minWidth: 880,
    minHeight: 520,
    title: 'jSpoofer',
    icon: appIcon,
    frame: false,
    show: false,
    backgroundColor: BACKGROUND[theme],
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  harden(mainWindow.webContents);
  mainWindow.loadFile(path.join(RENDERER, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    setTimeout(
      () => {
        splashWindow?.destroy();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.setIcon(appIcon);
        mainWindow.show();
      },
      Math.max(0, SPLASH_MIN_MS - (Date.now() - openedAt))
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const getMainWindow = () => mainWindow;

const focusMain = () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
};

const broadcast = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

const boot = async () => {
  await loadTheme();
  createSplash();
  createMain();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createMain();
  });
};

module.exports = { boot, broadcast, focusMain, getMainWindow, openExternal, setTheme };
