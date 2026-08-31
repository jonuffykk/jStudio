use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const MAX_RUNS: usize = 40;
const MAX_MAPPINGS: usize = 20_000;
const MAX_CONVERSATIONS: usize = 60;

fn dataDir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("no writable app folder: {error}"))?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("could not create {dir:?}: {error}"))?;
    Ok(dir)
}

pub fn readJson(app: &AppHandle, name: &str, fallback: Value) -> Value {
    let Ok(dir) = dataDir(app) else {
        return fallback;
    };
    std::fs::read_to_string(dir.join(name))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(fallback)
}

pub fn writeJson(app: &AppHandle, name: &str, value: &Value) -> Result<(), String> {
    let dir = dataDir(app)?;
    let target = dir.join(name);
    let staging = dir.join(format!("{name}.tmp"));
    let body = serde_json::to_vec(value).map_err(|error| error.to_string())?;

    std::fs::write(&staging, body).map_err(|error| format!("could not write {name}: {error}"))?;
    std::fs::rename(&staging, &target).map_err(|error| format!("could not save {name}: {error}"))
}

fn trimList(app: &AppHandle, name: &str, entry: Value, limit: usize) -> Result<Value, String> {
    let mut list = match readJson(app, name, json!([])) {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    list.insert(0, entry);
    list.truncate(limit);

    let value = Value::Array(list);
    writeJson(app, name, &value)?;
    Ok(value)
}

pub fn loadSettings(app: &AppHandle) -> Value {
    readJson(app, "settings.json", json!({}))
}

pub fn saveSettings(app: &AppHandle, value: Value) -> Result<(), String> {
    writeJson(app, "settings.json", &value)
}

pub fn loadRuns(app: &AppHandle) -> Value {
    readJson(app, "runs.json", json!([]))
}

pub fn recordRun(app: &AppHandle, run: Value) -> Result<Value, String> {
    trimList(app, "runs.json", run, MAX_RUNS)
}

pub fn updateRun(app: &AppHandle, id: &str, applied: bool) -> Result<Value, String> {
    let mut list = match loadRuns(app) {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    for run in list.iter_mut() {
        if run.get("id").and_then(Value::as_str) == Some(id) {
            run["applied"] = json!(applied);
        }
    }
    let value = Value::Array(list);
    writeJson(app, "runs.json", &value)?;
    Ok(value)
}

pub fn patchRun(app: &AppHandle, id: &str, patch: &Value) -> Result<Value, String> {
    let mut list = match loadRuns(app) {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    for run in list.iter_mut() {
        if run.get("id").and_then(Value::as_str) != Some(id) {
            continue;
        }
        if let (Some(target), Some(fields)) = (run.as_object_mut(), patch.as_object()) {
            for (key, value) in fields {
                target.insert(key.clone(), value.clone());
            }
        }
    }

    let value = Value::Array(list);
    writeJson(app, "runs.json", &value)?;
    Ok(value)
}

pub fn deleteRun(app: &AppHandle, id: &str) -> Result<Value, String> {
    let mut list = match loadRuns(app) {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    list.retain(|run| run.get("id").and_then(Value::as_str) != Some(id));

    let value = Value::Array(list);
    writeJson(app, "runs.json", &value)?;
    Ok(value)
}

pub fn loadMappings(app: &AppHandle) -> Value {
    readJson(app, "mappings.json", json!({}))
}

pub fn saveMapping(app: &AppHandle, key: String, newId: String, name: String) {
    let mut cache = match loadMappings(app) {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    if cache.len() >= MAX_MAPPINGS {
        cache.clear();
    }
    cache.insert(
        key,
        json!({ "newId": newId, "name": name, "at": crate::bridge::nowMs() }),
    );
    let _ = writeJson(app, "mappings.json", &Value::Object(cache));
}

pub fn loadConversations(app: &AppHandle) -> Value {
    readJson(app, "conversations.json", json!([]))
}

pub fn saveConversation(app: &AppHandle, conversation: Value) -> Result<Value, String> {
    let id = conversation
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();

    let mut list = match loadConversations(app) {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    list.retain(|entry| entry.get("id").and_then(Value::as_str) != Some(id.as_str()));
    list.insert(0, conversation);
    list.truncate(MAX_CONVERSATIONS);

    let value = Value::Array(list);
    writeJson(app, "conversations.json", &value)?;
    Ok(value)
}

pub fn deleteConversation(app: &AppHandle, id: &str) -> Result<Value, String> {
    let mut list = match loadConversations(app) {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    list.retain(|entry| entry.get("id").and_then(Value::as_str) != Some(id));

    let value = Value::Array(list);
    writeJson(app, "conversations.json", &value)?;
    Ok(value)
}

pub fn clearHistory(app: &AppHandle) -> Result<(), String> {
    writeJson(app, "runs.json", &json!([]))?;
    writeJson(app, "mappings.json", &json!({}))
}
