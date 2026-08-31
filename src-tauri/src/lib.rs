#![allow(non_snake_case, non_upper_case_globals)]

mod bridge;
mod mcp;
mod roblox;
mod spoof;
mod store;
mod vault;

use std::sync::Arc;
use std::time::Duration;

use bridge::{Bridge, JobResult};
use mcp::McpHost;
use serde_json::{json, Value};
use spoof::{RunControl, RunOptions};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use vault::Account;

const PLUGIN_SOURCE: &str = include_str!("../../plugin/jStudio.server.lua");
const PLUGIN_FILE: &str = "jStudio.server.lua";
const PLUGIN_VERSION: &str = env!("CARGO_PKG_VERSION");
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

struct AppState {
    bridge: Bridge,
    control: Arc<RunControl>,
    mcp: McpHost,
    http: reqwest::Client,
}

#[tauri::command]
fn bridgeStatus(state: tauri::State<AppState>) -> Value {
    state.bridge.status()
}

#[tauri::command]
fn bridgeTree(state: tauri::State<AppState>) -> Value {
    state.bridge.tree()
}

#[tauri::command]
fn bridgeEnqueue(state: tauri::State<AppState>, kind: String, payload: Value) -> String {
    state.bridge.enqueue(kind, payload)
}

#[tauri::command]
fn bridgeResult(state: tauri::State<AppState>, id: String) -> Option<JobResult> {
    state.bridge.result(&id)
}

#[tauri::command]
fn secretSet(id: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        vault::secretDelete(&id);
        return Ok(());
    }
    vault::secretSet(&id, &value)
}

#[tauri::command]
fn secretGet(id: String) -> Option<String> {
    vault::secretGet(&id)
}

fn pluginsDir() -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("LOCALAPPDATA")
            .map_err(|_| "This Windows session has no %LOCALAPPDATA%.".to_string())?;
        Ok(std::path::PathBuf::from(base)
            .join("Roblox")
            .join("Plugins"))
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| "No home folder found.".to_string())?;
        Ok(std::path::PathBuf::from(home)
            .join("Documents")
            .join("Roblox")
            .join("Plugins"))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("Roblox Studio only runs on Windows and macOS.".to_string())
    }
}

#[tauri::command]
fn pluginStatus(state: tauri::State<AppState>) -> Value {
    let installed = pluginsDir()
        .ok()
        .map(|dir| dir.join(PLUGIN_FILE).exists())
        .unwrap_or(false);

    let running = state.bridge.status();
    json!({
        "installed": installed,
        "bundledVersion": PLUGIN_VERSION,
        "runningVersion": running.get("pluginVersion").cloned().unwrap_or(Value::Null),
        "outdated": running
            .get("pluginVersion")
            .and_then(Value::as_str)
            .map(|version| version != PLUGIN_VERSION)
            .unwrap_or(false),
    })
}

#[tauri::command]
fn pluginInstall() -> Result<String, String> {
    let dir = pluginsDir()?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not create {dir:?}: {error}"))?;

    let target = dir.join(PLUGIN_FILE);
    std::fs::write(&target, PLUGIN_SOURCE)
        .map_err(|error| format!("Could not write the plugin: {error}"))?;
    Ok(target.display().to_string())
}

#[tauri::command]
fn settingsLoad(app: AppHandle) -> Value {
    store::loadSettings(&app)
}

#[tauri::command]
fn settingsSave(app: AppHandle, value: Value) -> Result<(), String> {
    store::saveSettings(&app, value)
}

#[tauri::command]
fn accountsList(app: AppHandle) -> Value {
    vault::listAccounts(&app)
}

#[tauri::command]
async fn accountSignInWithCookie(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    cookie: String,
) -> Result<Value, String> {
    let profile = roblox::getProfile(&state.http, &cookie).await?;
    let account: Account = serde_json::from_value(profile).map_err(|error| error.to_string())?;
    vault::upsertAccount(&app, account, &cookie, None)
}

#[tauri::command]
async fn accountSignIn(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<Value, String> {
    if let Some(existing) = app.get_webview_window("login") {
        let _ = existing.close();
    }

    let window = WebviewWindowBuilder::new(
        &app,
        "login",
        WebviewUrl::External(
            "https://www.roblox.com/login"
                .parse()
                .map_err(|_| "bad login url")?,
        ),
    )
    .title("Sign in to Roblox")
    .inner_size(520.0, 720.0)
    .min_inner_size(420.0, 560.0)
    .center()
    .resizable(true)
    .focused(true)
    .incognito(true)
    .build()
    .map_err(|error| format!("Could not open the sign in window: {error}"))?;

    let deadline = tokio::time::Instant::now() + LOGIN_TIMEOUT;
    let cookie = loop {
        if tokio::time::Instant::now() > deadline {
            let _ = window.close();
            return Err("The sign in window timed out.".into());
        }
        if app.get_webview_window("login").is_none() {
            return Err("The sign in window was closed.".into());
        }

        if let Ok(cookies) = window.cookies() {
            let found = cookies
                .iter()
                .find(|entry| entry.name() == ".ROBLOSECURITY" && !entry.value().is_empty())
                .map(|entry| entry.value().to_owned());

            if let Some(value) = found {
                break value;
            }
        }
        tokio::time::sleep(Duration::from_millis(1200)).await;
    };

    let _ = window.close();

    let profile = roblox::getProfile(&state.http, &cookie).await?;
    let account: Account = serde_json::from_value(profile).map_err(|error| error.to_string())?;
    vault::upsertAccount(&app, account, &cookie, None)
}

#[tauri::command]
fn accountSetApiKey(app: AppHandle, id: String, apiKey: String) -> Result<Value, String> {
    vault::setApiKey(&app, &id, apiKey.trim())
}

#[tauri::command]
fn accountSetActive(app: AppHandle, id: String) -> Result<Value, String> {
    vault::setActive(&app, &id)
}

#[tauri::command]
fn accountRemove(app: AppHandle, id: String) -> Result<Value, String> {
    vault::removeAccount(&app, &id)
}

#[tauri::command]
async fn accountProbeApiKey(state: tauri::State<'_, AppState>, apiKey: String) -> Result<Value, String> {
    Ok(roblox::probeApiKey(&state.http, &apiKey).await)
}

#[tauri::command]
async fn accountGroups(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let credentials = vault::activeCredentials(&app)?;
    roblox::getGroups(&state.http, &credentials.cookie, &credentials.id).await
}

#[tauri::command]
async fn spoofStart(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    options: RunOptions,
) -> Result<Value, String> {
    let credentials = vault::activeCredentials(&app)?;
    let result = spoof::run(
        app.clone(),
        state.bridge.clone(),
        state.control.clone(),
        credentials,
        options,
    )
    .await;

    if result.is_err() {
        state.control.stop();
    }
    result
}

#[tauri::command]
fn spoofPause(state: tauri::State<AppState>) {
    state.control.pause()
}

#[tauri::command]
fn spoofResume(state: tauri::State<AppState>) {
    state.control.resume()
}

#[tauri::command]
async fn spoofScan(state: tauri::State<'_, AppState>, selectedOnly: bool) -> Result<Value, String> {
    spoof::scan(state.bridge.clone(), selectedOnly).await
}

#[tauri::command]
fn spoofStop(state: tauri::State<AppState>) {
    state.control.stop();
    state.bridge.cancelScan();
}

#[tauri::command]
fn runsLoad(app: AppHandle) -> Value {
    store::loadRuns(&app)
}

#[tauri::command]
fn runApply(
    app: AppHandle,
    state: tauri::State<AppState>,
    id: String,
    revert: bool,
) -> Result<Value, String> {
    if !state.bridge.isOnline() {
        return Err("Roblox Studio is not connected.".into());
    }

    let runs = store::loadRuns(&app);
    let run = runs
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        })
        .ok_or("That run is no longer in the history.")?;

    let lines: Vec<String> = run
        .get("mappings")
        .and_then(Value::as_array)
        .map(|pairs| {
            pairs
                .iter()
                .filter_map(|pair| {
                    let from = pair.get("from")?.as_str()?;
                    let to = pair.get("to")?.as_str()?;
                    Some(if revert {
                        format!("{to}={from}")
                    } else {
                        format!("{from}={to}")
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    if lines.is_empty() {
        return Err("That run replaced no IDs, so there is nothing to apply.".into());
    }

    let count = lines.len();
    state
        .bridge
        .pushMappings(lines, format!("{id}:{revert}:{}", bridge::nowMs()));
    store::updateRun(&app, &id, !revert)?;

    Ok(json!({ "count": count, "applied": !revert }))
}

#[tauri::command]
fn runPatch(app: AppHandle, id: String, patch: Value) -> Result<Value, String> {
    store::patchRun(&app, &id, &patch)
}

#[tauri::command]
fn runDelete(app: AppHandle, id: String) -> Result<Value, String> {
    store::deleteRun(&app, &id)
}

#[tauri::command]
fn historyClear(app: AppHandle) -> Result<(), String> {
    store::clearHistory(&app)
}

#[tauri::command]
fn conversationsLoad(app: AppHandle) -> Value {
    store::loadConversations(&app)
}

#[tauri::command]
fn conversationSave(app: AppHandle, conversation: Value) -> Result<Value, String> {
    store::saveConversation(&app, conversation)
}

#[tauri::command]
fn conversationDelete(app: AppHandle, id: String) -> Result<Value, String> {
    store::deleteConversation(&app, &id)
}

#[tauri::command]
fn mcpDetectStudio() -> Value {
    mcp::detectStudioServer()
}

#[tauri::command]
async fn mcpConnect(
    state: tauri::State<'_, AppState>,
    id: String,
    command: String,
    args: Vec<String>,
) -> Result<Value, String> {
    state.mcp.connect(id, command, args).await
}

#[tauri::command]
async fn mcpDisconnect(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    state.mcp.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
async fn mcpCall(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
    args: Value,
) -> Result<String, String> {
    state.mcp.callTool(&id, &name, args).await
}

pub fn run() {
    let bridge = Bridge::new();
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            bridge: bridge.clone(),
            control: Arc::new(RunControl::default()),
            mcp: McpHost::default(),
            http: roblox::client(),
        })
        .invoke_handler(tauri::generate_handler![
            bridgeStatus,
            bridgeTree,
            bridgeEnqueue,
            bridgeResult,
            secretSet,
            secretGet,
            pluginStatus,
            pluginInstall,
            settingsLoad,
            settingsSave,
            accountsList,
            accountSignIn,
            accountSignInWithCookie,
            accountSetApiKey,
            accountSetActive,
            accountRemove,
            accountGroups,
            accountProbeApiKey,
            spoofStart,
            spoofPause,
            spoofResume,
            spoofStop,
            spoofScan,
            runsLoad,
            runApply,
            runPatch,
            runDelete,
            historyClear,
            conversationsLoad,
            conversationSave,
            conversationDelete,
            mcpDetectStudio,
            mcpConnect,
            mcpDisconnect,
            mcpCall,
        ])
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                // The window is painted before the page loads, so the stored choice is
                // read here. "system", or nothing stored yet, follows Windows.
                let stored = store::loadSettings(app.handle())
                    .get("theme")
                    .and_then(Value::as_str)
                    .map(str::to_owned);

                let light = match stored.as_deref() {
                    Some("light") => true,
                    Some("dark") => false,
                    _ => window.theme().map(|theme| theme == tauri::Theme::Light).unwrap_or(true),
                };

                let tone = if light {
                    tauri::window::Color(246, 246, 248, 255)
                } else {
                    tauri::window::Color(11, 11, 15, 255)
                };

                let _ = window.set_background_color(Some(tone));
                // The window is built hidden, so it is centred here rather than at creation: the
                // splash then fades in on the middle of the screen the person is actually on.
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
            }

            bridge.attach(app.handle().clone());
            let served = bridge.clone();

            tauri::async_runtime::spawn(async move {
                if let Err(error) = bridge::serve(served).await {
                    eprintln!("jStudio: the local bridge could not start: {error}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                let state = window.state::<AppState>();
                state.control.stop();

                let host = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    host.state::<AppState>().mcp.disconnectAll().await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("jStudio failed to start");
}
