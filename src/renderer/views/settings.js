import {
  $,
  closeModal,
  emit,
  escapeHtml,
  fill,
  formatBytes,
  icon,
  on,
  openModal,
  rememberLanguage,
  resetSettings,
  setStatus,
  settings,
  show,
  showFlex,
  state,
  updateSettings,
} from '../lib.js';
import { setLanguage, t, translateDom } from '../i18n.js';

const api = window.jspoofer;

export const openUpdate = () => {
  const release = state.release;
  if (!release?.hasUpdate) return;
  $('updateTitle').textContent = t('update.available', { version: release.latest });
  $('updateSubtitle').textContent = t('update.current', { version: release.current });
  $('updateBar').style.width = '0%';
  $('updatePercent').textContent = '0%';
  $('updateSpeed').textContent = '';
  show($('updateActions'), true);
  $('updateActions').classList.add('flex');
  show($('btnInstallUpdate'), false);
  openModal($('updateModal'));
};

export const checkForUpdates = async ({ silent }) => {
  if (!silent) setStatus(t('update.checking'), 'busy');
  try {
    state.release = await api.updates.check();
    emit('release', state.release);
    if (state.release.hasUpdate) return openUpdate();
    if (!silent) setStatus(t('update.upToDate', { version: state.release.current }), 'ok');
  } catch {
    if (!silent) setStatus(t('update.failed'), 'bad');
  }
};

const trackSpeed = () => {
  let lastTick = 0;
  let lastBytes = 0;
  let smoothed = 0;

  return received => {
    const now = performance.now();
    if (!lastTick) {
      lastTick = now;
      lastBytes = received;
      return null;
    }
    const elapsed = (now - lastTick) / 1000;
    if (elapsed < 0.3) return null;
    const instant = (received - lastBytes) / elapsed;
    smoothed = smoothed ? smoothed * 0.7 + instant * 0.3 : instant;
    lastTick = now;
    lastBytes = received;
    return smoothed;
  };
};

const mountUpdates = () => {
  const speedOf = trackSpeed();

  on($('btnCheckUpdate'), 'click', () => checkForUpdates({ silent: false }));
  on($('btnCloseUpdate'), 'click', () => closeModal($('updateModal')));
  on($('btnInstallUpdate'), 'click', () => api.updates.apply());

  on($('btnDownloadUpdate'), 'click', async () => {
    show($('updateActions'), false);
    $('updateSubtitle').textContent = t('update.downloading');
    try {
      await api.updates.download();
      $('updateSubtitle').textContent = t('update.complete');
      $('updateBar').style.width = '100%';
      $('updatePercent').textContent = '100%';
      $('updateSpeed').textContent = '';
      show($('btnInstallUpdate'), true);
    } catch (error) {
      $('updateSubtitle').textContent = error.message;
      show($('updateActions'), true);
    }
  });

  api.on('update:progress', ({ received, pct }) => {
    $('updateBar').style.width = `${pct}%`;
    $('updatePercent').textContent = `${pct}%`;
    const speed = speedOf(received);
    if (speed) $('updateSpeed').textContent = `${formatBytes(speed)}/s`;
  });
};

const NOTICE = {
  info: 'mb-2.5 bg-paper px-2.5 py-2 num text-[11px] text-ink-faint dark:text-night-faint dark:bg-night',
  warn: 'mb-2.5 bg-amber-400/10 px-2.5 py-2 text-[11.5px] text-amber-700 dark:text-amber-300',
  bad: 'mb-2.5 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-red-600 dark:text-red-400',
};

export const applyTheme = () => {
  const dark = settings.theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  $('togTheme').setAttribute('aria-checked', String(dark));
  api.app.setTheme(settings.theme);
};

const bindSwitch = (id, key, onChange) => {
  const element = $(id);
  element.setAttribute('aria-checked', String(!!settings[key]));
  on(element, 'click', () => {
    const value = element.getAttribute('aria-checked') !== 'true';
    element.setAttribute('aria-checked', String(value));
    updateSettings({ [key]: value });
    onChange?.(value);
  });
};

const bindNumber = (id, key) => {
  const element = $(id);
  element.value = settings[key];
  on(element, 'change', () => updateSettings({ [key]: Number(element.value) }));
};

const bindRange = (id, key) => {
  const element = $(id);
  const output = $(`${id}Value`);
  element.value = settings[key];
  output.textContent = settings[key];
  on(element, 'input', () => {
    output.textContent = element.value;
    updateSettings({ [key]: Number(element.value) });
  });
};

export const refreshPlugin = async () => {
  const [status, update] = await Promise.all([
    api.plugin.status().catch(() => null),
    api.plugin.updateStatus().catch(() => null),
  ]);
  state.plugin = status;
  state.pluginUpdate = update;
  emit('plugin', status);

  const notice = $('pluginNotice');
  const button = $('btnInstallPlugin');

  if (!status?.supported) {
    notice.className = NOTICE.warn;
    notice.textContent = t('plugin.unsupported');
    show(notice, true);
    button.disabled = true;
    return;
  }

  const action = update?.hasUpdate
    ? 'plugin.update'
    : status.installed
      ? 'plugin.reinstall'
      : 'plugin.install';
  fill(
    button,
    `${icon(status.installed ? 'refresh-cw' : 'download')}<span>${escapeHtml(t(action))}</span>`
  );

  if (update?.hasUpdate) {
    notice.className = NOTICE.warn;
    notice.textContent = t('plugin.updateAvailable', {
      from: update.installedVersion ?? '—',
      to: update.bundledVersion,
    });
    show(notice, true);
  } else if (status.installed) {
    notice.className = NOTICE.info;
    notice.textContent = status.file;
    show(notice, true);
  } else {
    show(notice, false);
  }
};

export const installPlugin = async () => {
  const button = $('btnInstallPlugin');
  button.disabled = true;
  try {
    const result = await api.plugin.install();
    setStatus(
      result.ok ? t('plugin.installed') : (result.error ?? t('plugin.installFailed')),
      result.ok ? 'ok' : 'bad'
    );
  } finally {
    button.disabled = false;
    await refreshPlugin();
  }
};

export const pickDownloadFolder = async () => {
  const folder = await api.app.selectFolder();
  if (!folder) return;
  updateSettings({ downloadFolder: folder });
  $('downloadFolder').value = folder;
  emit('settings');
};

export const mountSettings = () => {
  applyTheme();
  $('downloadFolder').value = settings.downloadFolder;
  showFlex($('folderRow'), settings.downloadOnly);

  bindSwitch('togDownloadOnly', 'downloadOnly', value => {
    showFlex($('folderRow'), value);
    emit('settings');
  });
  bindSwitch('togAutoName', 'autoNameAnimations');
  bindSwitch('togForceReupload', 'forceReupload');
  bindRange('uploadConcurrency', 'uploadConcurrency');
  bindRange('downloadConcurrency', 'downloadConcurrency');
  bindNumber('maxPlaceIds', 'maxPlaceIds');
  bindNumber('uploadRetries', 'uploadRetries');

  const override = $('overridePlaceId');
  override.value = settings.overridePlaceId;
  on(override, 'change', () => updateSettings({ overridePlaceId: override.value.trim() }));

  on($('togTheme'), 'click', () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
    applyTheme();
  });

  on($('languageSelect'), 'change', event => {
    rememberLanguage(setLanguage(event.target.value));
    translateDom();
    refreshPlugin();
    emit('language');
  });

  on($('btnSelectFolder'), 'click', pickDownloadFolder);
  on($('btnInstallPlugin'), 'click', installPlugin);
  on($('btnRevealPlugin'), 'click', () => api.plugin.reveal());
  on($('btnClearCache'), 'click', async () => {
    await api.history.clearMappings();
    setStatus(t('app.cacheCleared'), 'ok');
  });
  on($('btnResetSettings'), 'click', () => {
    resetSettings();
    location.reload();
  });

  mountUpdates();
};
