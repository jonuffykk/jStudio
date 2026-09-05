use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const MAX_RUNS: usize = 40;
const MAX_MAPPINGS: usize = 20_000;
const MAX_CONVERSATIONS: usize = 60;

fn subDir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = dataDir(app)?.join(name);
    std::fs::create_dir_all(&dir).map_err(|error| format!("could not create {dir:?}: {error}"))?;
    Ok(dir)
}

fn safeName(id: &str) -> Option<String> {
    let clean: String = id
        .chars()
        .filter(|letter| letter.is_ascii_alphanumeric() || *letter == '-' || *letter == '_')
        .collect();
    (!clean.is_empty() && clean.len() <= 64).then_some(clean)
}

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

pub fn loadUsage(app: &AppHandle) -> Value {
    readJson(app, "usage.json", json!({ "days": [], "pulse": [] }))
}

pub fn saveUsage(app: &AppHandle, value: Value) -> Result<(), String> {
    writeJson(app, "usage.json", &value)
}

fn chatsDir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = subDir(app, "chats")?;

    let legacy = dataDir(app)?.join("conversations.json");
    if legacy.exists() {
        if let Ok(Value::Array(items)) = std::fs::read_to_string(&legacy)
            .map_err(|error| error.to_string())
            .and_then(|raw| serde_json::from_str(&raw).map_err(|error| error.to_string()))
        {
            for entry in items {
                if let Some(name) = entry.get("id").and_then(Value::as_str).and_then(safeName) {
                    let body = serde_json::to_vec(&entry).unwrap_or_default();
                    let _ = std::fs::write(dir.join(format!("{name}.json")), body);
                }
            }
        }
        let _ = std::fs::remove_file(&legacy);
    }

    Ok(dir)
}

fn readChats(dir: &PathBuf) -> Vec<Value> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut chats: Vec<Value> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            (path.extension()? == "json").then_some(())?;
            serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
        })
        .collect();

    chats.sort_by_key(|chat| {
        std::cmp::Reverse(chat.get("updatedAt").and_then(Value::as_u64).unwrap_or(0))
    });
    chats
}

pub fn loadConversations(app: &AppHandle) -> Value {
    let Ok(dir) = chatsDir(app) else {
        return json!([]);
    };
    Value::Array(readChats(&dir))
}

pub fn saveConversation(app: &AppHandle, conversation: Value) -> Result<Value, String> {
    let dir = chatsDir(app)?;
    let name = conversation
        .get("id")
        .and_then(Value::as_str)
        .and_then(safeName)
        .ok_or("that conversation has no usable id")?;

    let body = serde_json::to_vec(&conversation).map_err(|error| error.to_string())?;
    let staging = dir.join(format!("{name}.tmp"));
    std::fs::write(&staging, body).map_err(|error| format!("could not write the chat: {error}"))?;
    std::fs::rename(&staging, dir.join(format!("{name}.json")))
        .map_err(|error| format!("could not save the chat: {error}"))?;

    let mut chats = readChats(&dir);
    for stale in chats.split_off(chats.len().min(MAX_CONVERSATIONS)) {
        if let Some(name) = stale.get("id").and_then(Value::as_str).and_then(safeName) {
            let _ = std::fs::remove_file(dir.join(format!("{name}.json")));
        }
    }

    Ok(Value::Array(chats))
}

pub fn deleteConversation(app: &AppHandle, id: &str) -> Result<Value, String> {
    let dir = chatsDir(app)?;
    if let Some(name) = safeName(id) {
        let _ = std::fs::remove_file(dir.join(format!("{name}.json")));
    }
    Ok(Value::Array(readChats(&dir)))
}

pub fn saveImage(app: &AppHandle, dataUrl: &str) -> Result<String, String> {
    let (header, payload) = dataUrl
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(";base64,"))
        .ok_or("that is not a base64 data URL")?;

    let extension = match header {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => return Err("only png, jpeg, webp and gif images are stored".to_owned()),
    };

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|_| "that image is not valid base64".to_owned())?;

    let dir = subDir(app, "images")?;
    let id = format!("{:016x}{:x}", crate::bridge::nowMs(), bytes.len());
    let name = format!("{id}.{extension}");

    std::fs::write(dir.join(&name), bytes)
        .map_err(|error| format!("could not store the image: {error}"))?;
    Ok(name)
}

pub fn loadImage(app: &AppHandle, name: &str) -> Option<String> {
    let (id, extension) = name.rsplit_once('.')?;
    let mime = match extension {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => return None,
    };

    let bytes = std::fs::read(dataDir(app).ok()?.join("images").join(format!(
        "{}.{extension}",
        safeName(id)?
    )))
    .ok()?;

    use base64::Engine;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub fn sweepImages(app: &AppHandle) {
    let Ok(dir) = subDir(app, "images") else {
        return;
    };
    let Ok(chats) = chatsDir(app) else {
        return;
    };

    let transcript = readChats(&chats)
        .iter()
        .map(|chat| chat.to_string())
        .collect::<String>();

    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !transcript.contains(name) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

pub fn clearHistory(app: &AppHandle) -> Result<(), String> {
    writeJson(app, "runs.json", &json!([]))?;
    writeJson(app, "mappings.json", &json!({}))
}

pub fn clearConversations(app: &AppHandle) -> Result<(), String> {
    let dir = chatsDir(app)?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    sweepImages(app);
    Ok(())
}
