'use strict';

const { safeStorage } = require('electron');
const { RUN } = require('./config');
const store = require('./lib');

const VAULT_FILE = 'vault.json';

const encode = value => {
  const json = JSON.stringify(value);
  if (!safeStorage.isEncryptionAvailable()) return { plain: json };
  return { cipher: safeStorage.encryptString(json).toString('base64') };
};

const decode = record => {
  try {
    if (record?.cipher) {
      return JSON.parse(safeStorage.decryptString(Buffer.from(record.cipher, 'base64')));
    }
    if (record?.plain) return JSON.parse(record.plain);
  } catch {}
  return null;
};

const emptyVault = () => ({ accounts: [], activeId: null });

const read = async () => {
  const record = await store.read(VAULT_FILE, null);
  const data = decode(record);
  if (!data || !Array.isArray(data.accounts)) return emptyVault();
  return { accounts: data.accounts, activeId: data.activeId ?? null };
};

const write = vault => store.write(VAULT_FILE, encode(vault));

const publicView = account =>
  account && {
    id: account.id,
    name: account.name,
    username: account.username,
    avatarUrl: account.avatarUrl,
    hasApiKey: !!account.apiKey,
  };

const listAccounts = async () => {
  const { accounts, activeId } = await read();
  return { accounts: accounts.map(publicView), activeId };
};

const getActive = async () => {
  const { accounts, activeId } = await read();
  return accounts.find(a => a.id === activeId) || null;
};

const upsertAccount = async (profile, cookie, apiKey) => {
  const vault = await read();
  const rest = vault.accounts.filter(a => a.id !== profile.id);
  const account = {
    id: profile.id,
    name: profile.displayName || profile.name,
    username: profile.name,
    avatarUrl: profile.avatarUrl || '',
    cookie,
    apiKey: apiKey || '',
  };
  vault.accounts = [account, ...rest].slice(0, RUN.maxAccounts);
  vault.activeId = account.id;
  await write(vault);
  return publicView(account);
};

const setActive = async id => {
  const vault = await read();
  if (!vault.accounts.some(a => a.id === id)) return false;
  vault.activeId = id;
  await write(vault);
  return true;
};

const removeAccount = async id => {
  const vault = await read();
  vault.accounts = vault.accounts.filter(a => a.id !== id);
  if (vault.activeId === id) vault.activeId = vault.accounts[0]?.id ?? null;
  await write(vault);
  return listAccounts();
};

const clear = () => store.remove(VAULT_FILE);

module.exports = {
  clear,
  getActive,
  listAccounts,
  removeAccount,
  setActive,
  upsertAccount,
};
