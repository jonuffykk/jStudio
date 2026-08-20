import {
  $,
  closeModal,
  emit,
  escapeHtml,
  fill,
  icon,
  on,
  openModal,
  setStatus,
  show,
  state,
} from '../lib.js';
import { t } from '../i18n.js';

const api = window.jspoofer;

// Neutral stand-in until Roblox returns a headshot — the app's own mark would
// read as if it were the person's picture.
const PLACEHOLDER_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%2371717a' fill-opacity='.18'/%3E%3Cpath d='M16 17a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.8-9 6.2V28h18v-2.8c0-3.4-4-6.2-9-6.2z' fill='%2371717a'/%3E%3C/svg%3E";

const avatarOf = account => escapeHtml(account.avatarUrl || PLACEHOLDER_AVATAR);

const renderSidebarAccount = () => {
  const account = state.account;
  show($('btnAccount'), true);
  $('accountAvatar').src = account?.avatarUrl || PLACEHOLDER_AVATAR;
  $('accountName').textContent = account ? account.name : t('accounts.signInAction');
  $('accountHandle').textContent = account ? `@${account.username}` : t('accounts.title');
};

const renderModal = () => {
  const account = state.account;
  show($('activeAccount'), !!account);
  $('activeAccount').classList.toggle('flex', !!account);

  if (account) {
    $('profileAvatar').src = avatarOf(account);
    $('profileName').textContent = account.name;
    $('profileHandle').textContent = `@${account.username}`;
    $('profileKeyState').textContent = t(
      account.hasApiKey ? 'accounts.keySet' : 'accounts.keyMissing'
    );
    $('profileKeyState').className = `truncate num text-[10px] ${
      account.hasApiKey ? 'text-emerald-500' : 'text-red-500'
    }`;
  }

  const others = state.accounts.filter(entry => entry.id !== account?.id);
  show($('savedAccounts'), others.length > 0);
  fill(
    $('accountList'),
    others
      .map(
        entry => `<div class="group flex items-center gap-2.5 px-2 py-1.5 transition hover:bg-paper dark:hover:bg-night">
          <img src="${avatarOf(entry)}" alt="" class="avatar h-6 w-6" />
          <button class="min-w-0 flex-1 text-left" data-switch="${escapeHtml(entry.id)}">
            <span class="block truncate text-[11.5px]">${escapeHtml(entry.name)}</span>
            <span class="block truncate text-[10.5px] text-ink-faint dark:text-night-faint">@${escapeHtml(entry.username)}</span>
          </button>
          <button class="btn-ghost opacity-0 transition group-hover:opacity-100 hover:!text-red-500"
 data-forget="${escapeHtml(entry.id)}" title="${escapeHtml(t('accounts.remove'))}">${icon('x')}</button>
        </div>`
      )
      .join('')
  );

  $('accountList')
    .querySelectorAll('[data-switch]')
    .forEach(button =>
      on(button, 'click', async () => {
        await api.auth.switch(button.dataset.switch);
        await refreshAccounts();
        setStatus(t('accounts.switched', { name: state.account?.name ?? '' }), 'ok');
      })
    );
  $('accountList')
    .querySelectorAll('[data-forget]')
    .forEach(button =>
      on(button, 'click', async () => {
        state.accounts = (await api.auth.remove(button.dataset.forget)).accounts;
        renderModal();
      })
    );

  $('authHeading').textContent = t(account ? 'accounts.addHeading' : 'accounts.signInHeading');
  $('btnSignIn').textContent = t(account ? 'accounts.addAction' : 'accounts.signInAction');
};

export const refreshAccounts = async () => {
  const { accounts, activeId } = await api.auth.list();
  state.accounts = accounts;
  state.account = accounts.find(entry => entry.id === activeId) ?? null;
  renderSidebarAccount();
  renderModal();
  emit('account', state.account);
};

export const openAccounts = () => {
  $('authError').classList.add('hidden');
  renderModal();
  openModal($('accountsModal'));
  $('authCookie').focus();
};

const signIn = async () => {
  const cookie = $('authCookie').value.trim();
  const apiKey = $('authApiKey').value.trim();
  const error = $('authError');
  const button = $('btnSignIn');

  const reject = message => {
    error.textContent = message;
    show(error, true);
    button.disabled = false;
    setStatus(t('status.ready'));
  };

  show(error, false);
  if (!cookie) return reject(t('accounts.cookieRequired'));
  if (!apiKey) return reject(t('accounts.apiKeyRequired'));

  button.disabled = true;
  setStatus(t('accounts.checking'), 'busy');

  let account;
  try {
    account = await api.auth.signIn(cookie, apiKey);
  } catch {
    return reject(t('accounts.invalidCookie'));
  }

  const permission = await api.auth.checkGroup(null).catch(() => null);
  if (
    permission &&
    !permission.canUpload &&
    /invalid|unauthorized|401|403/i.test(permission.reason ?? '')
  ) {
    await api.auth.remove(account.id).catch(() => {});
    return reject(t('accounts.invalidApiKey'));
  }

  button.disabled = false;
  $('authCookie').value = '';
  $('authApiKey').value = '';
  await refreshAccounts();
  closeModal($('accountsModal'));
  setStatus(t('accounts.welcome', { name: account.name }), 'ok');
};

export const mountAccounts = () => {
  on($('btnAccount'), 'click', openAccounts);
  on($('btnCloseAccounts'), 'click', () => closeModal($('accountsModal')));
  on($('btnSignIn'), 'click', signIn);
  on($('authApiKey'), 'keydown', event => event.key === 'Enter' && signIn());
  on($('btnGetKey'), 'click', () =>
    api.app.openExternal('https://create.roblox.com/dashboard/credentials')
  );
  on($('btnSignOut'), 'click', async () => {
    await api.auth.signOut();
    await refreshAccounts();
    setStatus(t('accounts.signedOut'));
  });
};
