use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Notify, Semaphore};
use tokio::task::JoinSet;

use crate::bridge::{nowMs, Bridge, ScanRequest};
use crate::roblox::{self, ScanItem};
use crate::store;
use crate::vault::Credentials;

const SCAN_TIMEOUT: Duration = Duration::from_secs(240);
const MAX_CONCURRENCY: usize = 25;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOptions {
    #[serde(default)]
    pub downloadOnly: bool,
    #[serde(default)]
    pub downloadFolder: String,
    #[serde(default)]
    pub forceReupload: bool,
    #[serde(default)]
    pub selectedOnly: bool,
    #[serde(default)]
    pub groupId: String,
    #[serde(default)]
    pub overridePlaceId: String,
    #[serde(default)]
    pub maxPlaceIds: usize,
    #[serde(default)]
    pub uploadRetries: u32,
    #[serde(default)]
    pub downloadConcurrency: usize,
    #[serde(default)]
    pub uploadConcurrency: usize,
    #[serde(default)]
    pub only: Vec<String>,
    #[serde(default)]
    pub autoName: bool,
}

#[derive(Debug)]
struct Settings {
    downloadOnly: bool,
    downloadFolder: String,
    forceReupload: bool,
    selectedOnly: bool,
    groupId: Option<String>,
    overridePlaceId: Option<String>,
    maxPlaceIds: usize,
    uploadRetries: u32,
    downloadConcurrency: usize,
    uploadConcurrency: usize,
    only: HashSet<String>,
    autoName: bool,
}

fn digitsOnly(value: &str, label: &str) -> Result<Option<String>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if !trimmed.chars().all(|character| character.is_ascii_digit()) {
        return Err(format!("{label} must be a number, got \"{trimmed}\"."));
    }
    Ok(Some(trimmed.to_owned()))
}

fn resolve(options: RunOptions, credentials: &Credentials) -> Result<Settings, String> {
    if options.downloadOnly && options.downloadFolder.trim().is_empty() {
        return Err("Pick a folder before running in download only mode.".into());
    }
    if !options.downloadOnly && credentials.apiKey.is_empty() {
        return Err("Uploading needs an Open Cloud API key on the active account.".into());
    }

    let clamp = |value: usize, fallback: usize| {
        if value == 0 {
            fallback
        } else {
            value.min(MAX_CONCURRENCY)
        }
    };

    Ok(Settings {
        groupId: digitsOnly(&options.groupId, "Group ID")?,
        overridePlaceId: digitsOnly(&options.overridePlaceId, "Place ID override")?,
        downloadOnly: options.downloadOnly,
        downloadFolder: options.downloadFolder,
        forceReupload: options.forceReupload,
        selectedOnly: options.selectedOnly,
        maxPlaceIds: options.maxPlaceIds.clamp(1, 50),
        uploadRetries: options.uploadRetries.clamp(1, 10),
        downloadConcurrency: clamp(options.downloadConcurrency, 8),
        uploadConcurrency: clamp(options.uploadConcurrency, 6),
        only: options.only.into_iter().collect(),
        autoName: options.autoName,
    })
}

#[derive(Default)]
pub struct RunControl {
    stop: AtomicBool,
    paused: AtomicBool,
    resume: Notify,
    running: AtomicBool,
}

impl RunControl {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        self.paused.store(false, Ordering::Relaxed);
        self.resume.notify_waiters();
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::Relaxed);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::Relaxed);
        self.resume.notify_waiters();
    }

    pub fn isRunning(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    async fn gate(&self) {
        while self.paused.load(Ordering::Relaxed) && !self.stopped() {
            self.resume.notified().await;
        }
    }
}

struct Session {
    app: AppHandle,
    client: reqwest::Client,
    control: Arc<RunControl>,
    settings: Settings,
    credentials: Credentials,
    target: String,
    cache: HashMap<String, String>,
    placeIds: Mutex<HashMap<String, Vec<String>>>,
    total: AtomicU32,
    done: AtomicU32,
    failed: AtomicU32,
    pairs: Mutex<Vec<Value>>,
    log: Mutex<HashMap<String, Value>>,
    retries: Mutex<Vec<ScanItem>>,
    uploadSlots: Semaphore,
}

impl Session {
    fn item(&self, id: &str, name: &str, status: &str, extra: Value) {
        let mut payload = json!({ "id": id, "name": name, "status": status, "at": nowMs() });
        if let Some(fields) = extra.as_object() {
            for (key, value) in fields {
                payload[key] = value.clone();
            }
        }
        if let Ok(mut log) = self.log.lock() {
            log.insert(id.to_owned(), payload.clone());
        }
        let _ = self.app.emit("spoof:item", payload);
    }

    fn status(&self, text: &str) {
        let _ = self.app.emit("spoof:status", json!({ "text": text }));
    }

    fn progress(&self) {
        let _ = self.app.emit(
            "spoof:progress",
            json!({
                "total": self.total.load(Ordering::Relaxed),
                "done": self.done.load(Ordering::Relaxed),
                "failed": self.failed.load(Ordering::Relaxed),
            }),
        );
    }

    fn markDone(&self, item: &ScanItem, status: &str, newId: Option<&str>) {
        self.done.fetch_add(1, Ordering::Relaxed);
        self.retries
            .lock()
            .unwrap()
            .retain(|entry| entry.id != item.id);

        if let Some(newId) = newId {
            self.pairs.lock().unwrap().push(json!({
                "from": item.id,
                "to": newId,
                "name": item.name,
            }));
            store::saveMapping(
                &self.app,
                format!("{}:{}", self.target, item.id),
                newId.to_owned(),
                item.name.clone(),
            );
        }

        self.item(&item.id, &item.name, status, json!({ "newId": newId }));
        self.progress();
    }

    fn markFailed(&self, item: &ScanItem, reason: &str) {
        self.failed.fetch_add(1, Ordering::Relaxed);
        self.retries.lock().unwrap().push(item.clone());
        self.item(&item.id, &item.name, "failed", json!({ "reason": reason }));
        self.progress();
    }

    fn ownedByTarget(&self, item: &ScanItem) -> bool {
        if item.creatorId.is_empty() {
            return false;
        }
        match &self.settings.groupId {
            Some(groupId) => item.creatorType == "group" && &item.creatorId == groupId,
            None => item.creatorType == "user" && item.creatorId == self.credentials.id,
        }
    }

    async fn placesFor(&self, item: &ScanItem) -> Vec<String> {
        let key = format!("{}:{}", item.creatorType, item.creatorId);
        let cached = self.placeIds.lock().unwrap().get(&key).cloned();
        if let Some(ids) = cached {
            return ids;
        }

        let mut ids = roblox::getPlaceIds(
            &self.client,
            &self.credentials.cookie,
            &item.creatorType,
            &item.creatorId,
            self.settings.maxPlaceIds,
        )
        .await;

        if let Some(override_) = &self.settings.overridePlaceId {
            ids.retain(|id| id != override_);
            ids.insert(0, override_.clone());
        }

        self.placeIds.lock().unwrap().insert(key, ids.clone());
        ids
    }

    async fn process(&self, item: ScanItem) {
        if self.control.stopped() {
            return;
        }
        self.control.gate().await;
        if self.control.stopped() {
            return;
        }

        if !self.settings.downloadOnly && !self.settings.forceReupload {
            if let Some(newId) = self.cache.get(&format!("{}:{}", self.target, item.id)) {
                let newId = newId.clone();
                return self.markDone(&item, "cached", Some(&newId));
            }
        }

        if !self.settings.downloadOnly && !self.settings.forceReupload && self.ownedByTarget(&item)
        {
            return self.markDone(&item, "owned", None);
        }

        self.item(&item.id, &item.name, "downloading", json!({}));

        let places = self.placesFor(&item).await;
        let url =
            roblox::resolveDownloadUrl(&self.client, &item.id, &places, &self.credentials.cookie)
                .await;

        let bytes = match roblox::downloadAsset(&self.client, &url, &self.credentials.cookie).await
        {
            Ok(bytes) => bytes,
            Err(error) => return self.markFailed(&item, roblox::classifyError(&error)),
        };

        if self.settings.downloadOnly {
            let target = std::path::Path::new(&self.settings.downloadFolder).join(format!(
                "{}_{}.rbxm",
                roblox::sanitizeFileName(&item.name),
                item.id
            ));
            return match tokio::fs::write(&target, &bytes).await {
                Ok(()) => self.markDone(&item, "saved", None),
                Err(error) => self.markFailed(&item, &error.to_string()),
            };
        }

        self.control.gate().await;
        if self.control.stopped() {
            return;
        }

        self.item(&item.id, &item.name, "uploading", json!({}));
        let Ok(_slot) = self.uploadSlots.acquire().await else {
            return;
        };

        let mut lastError = String::new();
        for attempt in 1..=self.settings.uploadRetries {
            if self.control.stopped() {
                return;
            }
            match roblox::uploadAnimation(
                &self.client,
                &self.credentials.apiKey,
                &self.credentials.id,
                self.settings.groupId.as_deref(),
                &item.name,
                bytes.clone(),
            )
            .await
            {
                Ok(newId) => return self.markDone(&item, "uploaded", Some(&newId)),
                Err(error) => {
                    lastError = error;
                    if attempt < self.settings.uploadRetries {
                        self.item(
                            &item.id,
                            &item.name,
                            "retrying",
                            json!({
                                "reason": roblox::classifyError(&lastError),
                                "attempt": attempt,
                            }),
                        );
                        roblox::awaitCooldown().await;
                        tokio::time::sleep(Duration::from_millis(1200 * u64::from(attempt))).await;
                    }
                }
            }
        }
        self.markFailed(&item, roblox::classifyError(&lastError));
    }
}

pub async fn scan(bridge: Bridge, selectedOnly: bool) -> Result<Value, String> {
    if !bridge.isOnline() {
        return Err(
            "Roblox Studio is not connected. Open your place with the plugin running.".into(),
        );
    }

    let mut stream = bridge.subscribeScan();
    bridge.requestScan(ScanRequest {
        selectedOnly,
        useInstanceNames: true,
    });

    let mut seen = HashSet::new();
    let mut found: Vec<Value> = Vec::new();
    let deadline = tokio::time::Instant::now() + SCAN_TIMEOUT;

    loop {
        let batch = tokio::select! {
            message = stream.recv() => message,
            _ = tokio::time::sleep_until(deadline) => break,
        };

        let Ok(batch) = batch else { break };
        let lines: Vec<String> = batch
            .get("results")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();

        for item in roblox::parseScanLines(&lines) {
            if seen.insert(item.id.clone()) {
                found.push(json!({ "id": item.id, "name": item.name }));
            }
        }

        let status = batch.get("status").and_then(Value::as_str).unwrap_or("");
        if status == "completed" || status == "cancelled" {
            break;
        }
    }

    Ok(Value::Array(found))
}

pub async fn run(
    app: AppHandle,
    bridge: Bridge,
    control: Arc<RunControl>,
    credentials: Credentials,
    options: RunOptions,
) -> Result<Value, String> {
    if !bridge.isOnline() {
        return Err(
            "Roblox Studio is not connected. Open your place with the plugin running.".into(),
        );
    }
    if control.isRunning() {
        return Err("A run is already going.".into());
    }

    let settings = resolve(options, &credentials)?;
    control.stop.store(false, Ordering::Relaxed);
    control.paused.store(false, Ordering::Relaxed);

    let target = match &settings.groupId {
        Some(groupId) => format!("group:{groupId}"),
        None => format!("user:{}", credentials.id),
    };

    let cache = if settings.forceReupload {
        HashMap::new()
    } else {
        match store::loadMappings(&app) {
            Value::Object(map) => map
                .into_iter()
                .filter_map(|(key, value)| Some((key, value.get("newId")?.as_str()?.to_owned())))
                .collect(),
            _ => HashMap::new(),
        }
    };

    if settings.downloadOnly {
        tokio::fs::create_dir_all(&settings.downloadFolder)
            .await
            .map_err(|error| format!("Could not use that folder: {error}"))?;
    }

    control.running.store(true, Ordering::Relaxed);

    let selectedOnly = settings.selectedOnly;
    let useInstanceNames = settings.autoName;
    let uploadConcurrency = settings.uploadConcurrency;
    let downloadConcurrency = settings.downloadConcurrency;

    let session = Arc::new(Session {
        uploadSlots: Semaphore::new(uploadConcurrency),
        app: app.clone(),
        client: roblox::client(),
        control: control.clone(),
        settings,
        credentials,
        target: target.clone(),
        cache,
        placeIds: Mutex::default(),
        total: AtomicU32::new(0),
        done: AtomicU32::new(0),
        failed: AtomicU32::new(0),
        pairs: Mutex::default(),
        log: Mutex::default(),
        retries: Mutex::default(),
    });

    let startedAt = nowMs();
    let mut scan = bridge.subscribeScan();
    bridge.requestScan(ScanRequest {
        selectedOnly,
        useInstanceNames,
    });

    session.status("Scanning the place in Studio");
    session.progress();

    let slots = Arc::new(Semaphore::new(downloadConcurrency));
    let mut tasks = JoinSet::new();
    let mut seen = HashSet::new();
    let deadline = tokio::time::Instant::now() + SCAN_TIMEOUT;

    loop {
        if control.stopped() {
            break;
        }

        let batch = tokio::select! {
            message = scan.recv() => message,
            _ = tokio::time::sleep_until(deadline) => break,
        };

        let Ok(batch) = batch else { break };
        let lines: Vec<String> = batch
            .get("results")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();

        for item in roblox::parseScanLines(&lines) {
            if !seen.insert(item.id.clone()) {
                continue;
            }
            if !session.settings.only.is_empty() && !session.settings.only.contains(&item.id) {
                continue;
            }
            session.total.fetch_add(1, Ordering::Relaxed);
            session.item(&item.id, &item.name, "found", json!({}));
            session.progress();

            let session = session.clone();
            let slots = slots.clone();
            tasks.spawn(async move {
                let Ok(_slot) = slots.acquire().await else {
                    return;
                };
                session.process(item).await;
            });
        }

        let status = batch.get("status").and_then(Value::as_str).unwrap_or("");
        if status == "completed" || status == "cancelled" {
            break;
        }
    }

    session.status("Finishing the queue");
    while tasks.join_next().await.is_some() {}

    let pending: Vec<ScanItem> = std::mem::take(&mut *session.retries.lock().unwrap());
    if !pending.is_empty() && !control.stopped() {
        session.status(&format!("Retrying {} item(s)", pending.len()));
        session
            .failed
            .fetch_sub(pending.len() as u32, Ordering::Relaxed);
        session.progress();

        for item in pending {
            let session = session.clone();
            let slots = slots.clone();
            tasks.spawn(async move {
                let Ok(_slot) = slots.acquire().await else {
                    return;
                };
                session.process(item).await;
            });
        }
        while tasks.join_next().await.is_some() {}
    }

    let pairs = session.pairs.lock().unwrap().clone();
    let mut items: Vec<Value> = session.log.lock().unwrap().values().cloned().collect();
    items.sort_by_key(|item| {
        item.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned()
    });
    let applied = !session.settings.downloadOnly && !pairs.is_empty();

    if applied {
        let lines = pairs
            .iter()
            .filter_map(|pair| {
                Some(format!(
                    "{}={}",
                    pair.get("from")?.as_str()?,
                    pair.get("to")?.as_str()?
                ))
            })
            .collect();
        bridge.pushMappings(lines, format!("run{}", nowMs()));
        session.status("Sending the new IDs back to Studio");
    }

    let done = session.done.load(Ordering::Relaxed);
    let failed = session.failed.load(Ordering::Relaxed);
    let stopped = control.stopped();

    let record = json!({
        "id": format!("run{startedAt}"),
        "startedAt": startedAt,
        "finishedAt": nowMs(),
        "stopped": stopped,
        "downloadOnly": session.settings.downloadOnly,
        "target": if session.settings.downloadOnly { Value::Null } else { json!(target) },
        "done": done,
        "failed": failed,
        "total": done + failed,
        "mappings": pairs,
        "items": items,
        "applied": applied,
    });
    if done + failed > 0 {
        let _ = store::recordRun(&app, record.clone());
    }

    control.running.store(false, Ordering::Relaxed);
    session.status("");

    Ok(json!({
        "ok": !stopped && failed == 0,
        "stopped": stopped,
        "done": done,
        "failed": failed,
        "run": record,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credentials(apiKey: &str) -> Credentials {
        Credentials {
            id: "1".into(),
            cookie: "abc".into(),
            apiKey: apiKey.into(),
        }
    }

    #[test]
    fn uploadNeedsApiKey() {
        let error = resolve(RunOptions::default(), &credentials("")).unwrap_err();
        assert!(error.contains("Open Cloud"));
    }

    #[test]
    fn downloadOnlyNeedsFolder() {
        let options = RunOptions {
            downloadOnly: true,
            ..RunOptions::default()
        };
        assert!(resolve(options, &credentials(""))
            .unwrap_err()
            .contains("folder"));
    }

    #[test]
    fn numericFieldsAreValidated() {
        let options = RunOptions {
            groupId: "12x".into(),
            ..RunOptions::default()
        };
        assert!(resolve(options, &credentials("key")).is_err());
    }

    #[test]
    fn concurrencyFallsBackAndCaps() {
        let options = RunOptions {
            downloadConcurrency: 0,
            uploadConcurrency: 900,
            ..RunOptions::default()
        };
        let settings = resolve(options, &credentials("key")).unwrap();
        assert_eq!(settings.downloadConcurrency, 8);
        assert_eq!(settings.uploadConcurrency, MAX_CONCURRENCY);
    }
}
