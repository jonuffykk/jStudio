import { $, closeModal, drawIcons, on, onState, openModal, savedLanguage, setStatus } from './lib.js';
import { detectLanguage, setLanguage, t, translateDom } from './i18n.js';
import { mountHome, refreshGroups, renderNextSteps, startRun } from './views/home.js';
import { mountAccounts, openAccounts, refreshAccounts } from './views/accounts.js';
import { mountHistory, renderHistory } from './views/history.js';
import { checkForUpdates, installPlugin, mountSettings, openUpdate, pickDownloadFolder, refreshPlugin } from './views/settings.js';

const api = window.jspoofer;
const PAGES = ['home', 'history', 'settings'];

const showPage = name => {
  document.querySelectorAll('.nav-item[data-page]').forEach(button => {
    if (button.dataset.page === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  PAGES.forEach(page => {
    $(`page-${page}`).classList.toggle('hidden', page !== name);
    $(`page-${page}`).classList.toggle('flex', page === name);
  });
  if (name === 'history') renderHistory();
  if (name === 'settings') refreshPlugin();
};

const NEXT_STEP_ACTIONS = {
  accounts: openAccounts,
  'install-plugin': installPlugin,
  'pick-folder': pickDownloadFolder,
  update: openUpdate,
};

const bindShell = () => {
  on($('btnMinimize'), 'click', () => api.window.minimize());
  on($('btnClose'), 'click', () => api.window.close());
  document.querySelectorAll('.nav-item[data-page]').forEach(button => {
    on(button, 'click', () => showPage(button.dataset.page));
  });

  on($('btnUninstall'), 'click', () => openModal($('uninstallModal')));
  on($('btnCancelUninstall'), 'click', () => closeModal($('uninstallModal')));
  on($('btnConfirmUninstall'), 'click', () => api.app.uninstall());

  on(document, 'keydown', event => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') startRun(false);
    if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) api.run.stop();
  });

  onState('next-step', action => NEXT_STEP_ACTIONS[action]?.());
  onState('settings', renderNextSteps);
};

const init = async () => {
  $('languageSelect').value = setLanguage(detectLanguage(savedLanguage()));
  translateDom();
  drawIcons();

  mountSettings();
  mountHome();
  mountAccounts();
  mountHistory();
  bindShell();
  showPage('home');
  setStatus(t('status.ready'));

  api.app.version().then(version => {
    $('version').textContent = `v${version}`;
  });

  await refreshAccounts();
  await refreshGroups();
  await refreshPlugin();
  renderNextSteps();

  if (!(await api.auth.list()).accounts.length) openAccounts();
  checkForUpdates({ silent: true });
};

init();
