export const $ = id => document.getElementById(id);

export const show = (element, visible = true) => {
  element.classList.toggle('hidden', !visible);
  return element;
};

export const showFlex = (element, visible = true) => {
  element.classList.toggle('hidden', !visible);
  element.classList.toggle('flex', visible);
  return element;
};

export const escapeHtml = value =>
  String(value).replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );

export const icon = (name, extraClass = '') =>
  `<i data-lucide="${name}" class="${extraClass}"></i>`;

export const drawIcons = () => window.lucide?.createIcons();

export const fill = (element, html) => {
  element.innerHTML = html;
  drawIcons();
  return element;
};

export const on = (element, event, handler) => element.addEventListener(event, handler);

export const delegate = (root, attribute, handler) =>
  on(root, 'click', event => {
    const target = event.target.closest(`[${attribute}]`);
    if (target && root.contains(target)) handler(target.getAttribute(attribute), event);
  });

export const openModal = element => {
  if (!element.open) element.showModal();
};

export const closeModal = element => {
  if (element.open) element.close();
};

export const downloadJson = (name, data) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const formatBytes = value => {
  if (!value || value < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const SETTINGS_KEY = 'jspoofer.settings';
const GROUP_KEY = 'jspoofer.group';
const LANGUAGE_KEY = 'jspoofer.language';

const DEFAULTS = {
  theme: 'dark',
  downloadOnly: false,
  autoNameAnimations: false,
  forceReupload: false,
  downloadFolder: '',
  uploadConcurrency: 10,
  downloadConcurrency: 10,
  maxPlaceIds: 10,
  uploadRetries: 3,
  overridePlaceId: '',
};

const read = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
};

export const settings = read();

export const updateSettings = patch => {
  Object.assign(settings, patch);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
};

export const resetSettings = () => {
  localStorage.removeItem(SETTINGS_KEY);
  Object.assign(settings, DEFAULTS);
};

export const savedGroup = () => localStorage.getItem(GROUP_KEY) ?? '';
export const rememberGroup = id => localStorage.setItem(GROUP_KEY, id);

export const savedLanguage = () => localStorage.getItem(LANGUAGE_KEY);
export const rememberLanguage = code => localStorage.setItem(LANGUAGE_KEY, code);

export const state = {
  running: false,
  paused: false,
  account: null,
  accounts: [],
  studio: { connected: false, placeName: null },
  selectionCount: 0,
  plugin: null,
  pluginUpdate: null,
  release: null,
  logEntries: [],
  mappings: [],
};

const listeners = new Map();

export const onState = (event, handler) => {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
};

export const emit = (event, payload) => {
  listeners.get(event)?.forEach(handler => handler(payload));
};

const DOT = {
  idle: 'bg-ink-faint/50',
  busy: 'bg-amber-500',
  ok: 'bg-emerald-500',
  bad: 'bg-red-500',
};

export const setStatus = (message, tone = 'idle') => {
  $('statusText').textContent = message;
  $('statusDot').className = `relative h-[7px] w-[7px] shrink-0 ${DOT[tone]}`;
};

export const setProgress = (percent, label = '') => {
  $('statusFill').style.width = `${percent}%`;
  $('statusCount').textContent = label;
  show($('statusCount'), !!label);
};
