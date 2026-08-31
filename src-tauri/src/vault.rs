use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::store;

const SERVICE: &str = "dev.jstudio.app";
const ACCOUNTS_FILE: &str = "accounts.json";
const MAX_ACCOUNTS: usize = 10;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub username: String,
    #[serde(default)]
    pub avatarUrl: String,
    #[serde(default)]
    pub hasApiKey: bool,
}

#[derive(Clone)]
pub struct Credentials {
    pub id: String,
    pub cookie: String,
    pub apiKey: String,
}

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, id).map_err(describe)
}

fn describe(error: keyring::Error) -> String {
    match error {
        keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => {
            "This session cannot reach the system credential vault. Sign in to the machine normally, \
             reopen jStudio, and store the credential again."
                .into()
        }
        keyring::Error::NoEntry => "Nothing stored under that name.".into(),
        other => format!("The system vault rejected it: {other}"),
    }
}

pub fn secretSet(id: &str, value: &str) -> Result<(), String> {
    entry(id)?.set_password(value).map_err(describe)
}

pub fn secretGet(id: &str) -> Option<String> {
    entry(id).ok().and_then(|slot| slot.get_password().ok())
}

pub fn secretDelete(id: &str) -> bool {
    entry(id)
        .map(|slot| slot.delete_credential().is_ok())
        .unwrap_or(false)
}

fn readAccounts(app: &AppHandle) -> (Vec<Account>, Option<String>) {
    let raw = store::readJson(app, ACCOUNTS_FILE, json!({}));
    let accounts = raw
        .get("accounts")
        .and_then(|value| serde_json::from_value::<Vec<Account>>(value.clone()).ok())
        .unwrap_or_default();
    let activeId = raw
        .get("activeId")
        .and_then(Value::as_str)
        .map(str::to_owned);
    (accounts, activeId)
}

fn writeAccounts(
    app: &AppHandle,
    accounts: &[Account],
    activeId: Option<&str>,
) -> Result<Value, String> {
    let value = json!({ "accounts": accounts, "activeId": activeId });
    store::writeJson(app, ACCOUNTS_FILE, &value)?;
    Ok(value)
}

pub fn listAccounts(app: &AppHandle) -> Value {
    let (accounts, activeId) = readAccounts(app);
    json!({ "accounts": accounts, "activeId": activeId })
}

pub fn upsertAccount(
    app: &AppHandle,
    account: Account,
    cookie: &str,
    apiKey: Option<&str>,
) -> Result<Value, String> {
    secretSet(&format!("cookie.{}", account.id), cookie)?;
    if let Some(key) = apiKey.filter(|value| !value.is_empty()) {
        secretSet(&format!("apiKey.{}", account.id), key)?;
    }

    let (mut accounts, _) = readAccounts(app);
    accounts.retain(|existing| existing.id != account.id);

    let mut stored = account;
    stored.hasApiKey = secretGet(&format!("apiKey.{}", stored.id)).is_some();
    let activeId = stored.id.clone();

    accounts.insert(0, stored);
    accounts.truncate(MAX_ACCOUNTS);
    writeAccounts(app, &accounts, Some(&activeId))
}

pub fn setApiKey(app: &AppHandle, id: &str, apiKey: &str) -> Result<Value, String> {
    if apiKey.is_empty() {
        secretDelete(&format!("apiKey.{id}"));
    } else {
        secretSet(&format!("apiKey.{id}"), apiKey)?;
    }

    let (mut accounts, activeId) = readAccounts(app);
    for account in accounts.iter_mut() {
        if account.id == id {
            account.hasApiKey = !apiKey.is_empty();
        }
    }
    writeAccounts(app, &accounts, activeId.as_deref())
}

pub fn setActive(app: &AppHandle, id: &str) -> Result<Value, String> {
    let (accounts, _) = readAccounts(app);
    if !accounts.iter().any(|account| account.id == id) {
        return Err("That account is not in the vault.".into());
    }
    writeAccounts(app, &accounts, Some(id))
}

pub fn removeAccount(app: &AppHandle, id: &str) -> Result<Value, String> {
    secretDelete(&format!("cookie.{id}"));
    secretDelete(&format!("apiKey.{id}"));

    let (mut accounts, activeId) = readAccounts(app);
    accounts.retain(|account| account.id != id);

    let nextActive = match activeId {
        Some(current) if current == id => accounts.first().map(|account| account.id.clone()),
        other => other,
    };
    writeAccounts(app, &accounts, nextActive.as_deref())
}

pub fn activeCredentials(app: &AppHandle) -> Result<Credentials, String> {
    let (accounts, activeId) = readAccounts(app);
    let id = activeId.ok_or("No Roblox account is signed in.")?;
    if !accounts.iter().any(|account| account.id == id) {
        return Err("The active account is no longer in the vault.".into());
    }

    let cookie = secretGet(&format!("cookie.{id}"))
        .ok_or("The session for this account is gone from the vault. Sign in again.")?;

    Ok(Credentials {
        apiKey: secretGet(&format!("apiKey.{id}")).unwrap_or_default(),
        cookie,
        id,
    })
}
