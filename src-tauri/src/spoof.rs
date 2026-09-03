use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex as AsyncMutex, OnceCell, Semaphore};
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
    #[serde(default)]
    pub assetKind: String,
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
    assetKind: String,
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
        downloadConcurrency: clamp(options.downloadConcurrency, 12),
        uploadConcurrency: clamp(options.uploadConcurrency, 8),
        only: options.only.into_iter().collect(),
        autoName: options.autoName,
        assetKind: match options.assetKind.trim() {
            "audio" => "audio".to_owned(),
            "image" => "image".to_owned(),
            "mesh" => "mesh".to_owned(),
            _ => "animation".to_owned(),
        },
    })
}

#[derive(Default)]
pub struct RunControl {
    stop: AtomicBool,
    paused: AtomicBool,
    running: AtomicBool,
}

impl RunControl {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        self.paused.store(false, Ordering::Relaxed);
    }

    pub fn pause(&self) {
        if self.isRunning() {
            self.paused.store(true, Ordering::Relaxed);
        }
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::Relaxed);
    }

    pub fn isRunning(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn isPaused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }

    /// Always called when a run leaves, however it left, so a failed run cannot leave
    /// the app believing one is still going.
    pub fn finish(&self) {
        self.running.store(false, Ordering::Relaxed);
        self.paused.store(false, Ordering::Relaxed);
    }

    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    /// Polled rather than woken: a notify that arrives between the check and the wait
    /// is lost, and that is what left paused runs stuck after resume.
    async fn gate(&self) {
        while self.paused.load(Ordering::Relaxed) && !self.stopped() {
            tokio::time::sleep(Duration::from_millis(120)).await;
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
    universeId: Mutex<Option<Option<String>>>,
    placeId: Option<String>,
    cache: HashMap<String, String>,
    placeIds: AsyncMutex<HashMap<String, Arc<OnceCell<Vec<String>>>>>,
    preferred: Mutex<HashMap<String, String>>,
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

    fn markFailed(&self, item: &ScanItem, reason: &str, detail: &str) {
        self.markFailedFree(item, reason, detail, false);
    }

    fn markFailedFree(&self, item: &ScanItem, reason: &str, detail: &str, free: bool) {
        self.failed.fetch_add(1, Ordering::Relaxed);
        self.retries.lock().unwrap().push(item.clone());
        self.item(
            &item.id,
            &item.name,
            "failed",
            json!({
                "reason": reason,
                "detail": roblox::failureDetail(detail),
                "free": free,
            }),
        );
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

    fn nearPlaces(&self) -> Vec<String> {
        let mut ids: Vec<String> = self
            .placeId
            .iter()
            .filter(|id| id.as_str() != "0")
            .cloned()
            .collect();

        if let Some(chosen) = &self.settings.overridePlaceId {
            ids.retain(|id| id != chosen);
            ids.insert(0, chosen.clone());
        }
        ids
    }

    async fn placesFor(&self, item: &ScanItem) -> Vec<String> {
        let key = format!("{}:{}", item.creatorType, item.creatorId);
        let cell = {
            let mut cache = self.placeIds.lock().await;
            cache.entry(key.clone()).or_default().clone()
        };

        let ids = cell
            .get_or_init(|| async {
                let mut ids = self.nearPlaces();

                ids.extend(
                    roblox::getPlaceIds(
                        &self.client,
                        &self.credentials.cookie,
                        &item.creatorType,
                        &item.creatorId,
                        self.settings.maxPlaceIds,
                    )
                    .await,
                );

                ids.extend(
                    roblox::relatedPlaceIds(
                        &self.client,
                        &self.credentials.cookie,
                        &item.creatorType,
                        &item.creatorId,
                        self.settings.maxPlaceIds,
                    )
                    .await,
                );

                let mut seen = HashSet::new();
                ids.retain(|id| !id.is_empty() && id != "0" && seen.insert(id.clone()));
                ids
            })
            .await;

        let front = self.preferred.lock().unwrap().get(&key).cloned();
        match front {
            Some(placeId) if ids.first() != Some(&placeId) => {
                let mut ordered = vec![placeId.clone()];
                ordered.extend(ids.iter().filter(|id| *id != &placeId).cloned());
                ordered
            }
            _ => ids.clone(),
        }
    }

    async fn grantUse(&self, assetId: &str) {
        let Some(placeId) = self.placeId.clone() else {
            return;
        };

        let known = self.universeId.lock().unwrap().clone();
        let universeId = match known {
            Some(value) => value,
            None => {
                let resolved =
                    roblox::universeOf(&self.client, &placeId, &self.credentials.cookie).await;
                *self.universeId.lock().unwrap() = Some(resolved.clone());
                resolved
            }
        };

        let Some(universeId) = universeId else {
            return;
        };

        let _ = roblox::grantAssetUse(
            &self.client,
            &self.credentials.apiKey,
            &self.credentials.cookie,
            assetId,
            &universeId,
        )
        .await;
    }

    fn rememberPlace(&self, item: &ScanItem, placeId: String) {
        let key = format!("{}:{}", item.creatorType, item.creatorId);
        self.preferred.lock().unwrap().insert(key, placeId);
    }

    async fn download(&self, item: &ScanItem) -> Result<Vec<u8>, String> {
        let bytes = self.fetch(&item.id, item).await?;

        if self.settings.assetKind != "image" {
            return Ok(bytes);
        }

        let Some(inner) = roblox::wrappedAssetId(&bytes, &item.id) else {
            return Ok(bytes);
        };

        match self.fetch(&inner, item).await {
            Ok(unwrapped) if !unwrapped.starts_with(b"<roblox") => Ok(unwrapped),
            _ => Err(format!(
                "the picture inside decal {} could not be fetched on its own",
                item.id
            )),
        }
    }

    /// Games that run this exact asset. A copylocked asset is served to the places
    /// that use it, so this is the context that makes someone else's asset reachable.
    async fn usagePlaces(&self, assetId: &str) -> Vec<String> {
        roblox::usagePlaceIds(
            &self.client,
            &self.credentials.cookie,
            assetId,
            self.settings.maxPlaceIds,
        )
        .await
    }

    async fn fetch(&self, assetId: &str, item: &ScanItem) -> Result<Vec<u8>, String> {
        let near = self.nearPlaces();
        let firstError = match roblox::fetchAsset(
            &self.client,
            assetId,
            &near,
            &self.credentials.cookie,
            &self.settings.assetKind,
        )
        .await
        {
            Ok(fetched) => {
                if let Some(placeId) = fetched.placeId {
                    self.rememberPlace(item, placeId);
                }
                return Ok(fetched.bytes);
            }
            Err(error) => error,
        };

        let mut places = self.usagePlaces(assetId).await;
        for placeId in self.placesFor(item).await {
            if !places.contains(&placeId) {
                places.push(placeId);
            }
        }
        places.retain(|placeId| !near.contains(placeId));
        if places.is_empty() {
            return Err(firstError);
        }

        match roblox::fetchAsset(
            &self.client,
            assetId,
            &places,
            &self.credentials.cookie,
            &self.settings.assetKind,
        )
        .await
        {
            Ok(fetched) => {
                if let Some(placeId) = fetched.placeId {
                    self.rememberPlace(item, placeId);
                }
                Ok(fetched.bytes)
            }
            Err(error) => Err(error),
        }
    }

    async fn process(&self, item: ScanItem, slots: Arc<Semaphore>) {
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

        let Ok(downloadSlot) = slots.acquire().await else {
            return;
        };
        let fetched = self.download(&item).await;

        let bytes = match fetched {
            Ok(bytes) => bytes,
            Err(error) => {
                let mine = item.creatorType == "user" && item.creatorId == self.credentials.id;
                let free = !mine
                    && roblox::isFreeToTake(&self.client, &item.id, &self.credentials.cookie).await;

                let reason = if free {
                    "Free, add it to your account".to_owned()
                } else {
                    roblox::describeFailureFor(roblox::Phase::Download, &error, mine)
                };

                return self.markFailedFree(&item, &reason, &error, free);
            }
        };

        if self.settings.downloadOnly {
            let target = std::path::Path::new(&self.settings.downloadFolder).join(format!(
                "{}_{}.rbxm",
                roblox::sanitizeFileName(&item.name),
                item.id
            ));
            return match tokio::fs::write(&target, &bytes).await {
                Ok(()) => self.markDone(&item, "saved", None),
                Err(error) => {
                    self.markFailed(&item, "Could not write the file", &error.to_string())
                }
            };
        }

        drop(downloadSlot);

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
            match roblox::uploadAsset(
                &self.client,
                &self.credentials.apiKey,
                &self.credentials.id,
                self.settings.groupId.as_deref(),
                &item.name,
                bytes.clone(),
                &self.settings.assetKind,
            )
            .await
            {
                Ok(newId) => {
                    self.grantUse(&newId).await;
                    return self.markDone(&item, "uploaded", Some(&newId));
                }
                Err(error) => {
                    lastError = error;
                    if attempt < self.settings.uploadRetries {
                        self.item(
                            &item.id,
                            &item.name,
                            "retrying",
                            json!({
                                "reason": roblox::describeFailure(roblox::Phase::Upload, &lastError),
                                "attempt": attempt,
                            }),
                        );
                        roblox::awaitCooldown(roblox::Bucket::Upload).await;
                        tokio::time::sleep(Duration::from_millis(1200 * u64::from(attempt))).await;
                    }
                }
            }
        }
        let reason = roblox::describeFailure(roblox::Phase::Upload, &lastError);
        self.markFailed(&item, &reason, &lastError);
    }
}

pub async fn scan(bridge: Bridge, selectedOnly: bool, assetKind: String) -> Result<Value, String> {
    if !bridge.isOnline() {
        return Err(
            "Roblox Studio is not connected. Open your place with the plugin running.".into(),
        );
    }

    let mut stream = bridge.subscribeScan();
    bridge.requestScan(ScanRequest {
        selectedOnly,
        useInstanceNames: true,
        assetKind: match assetKind.as_str() {
            "audio" => "audio".to_owned(),
            "image" => "image".to_owned(),
            "mesh" => "mesh".to_owned(),
            _ => "animation".to_owned(),
        },
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
                found.push(json!({
                    "id": item.id,
                    "name": item.name,
                    "creatorType": item.creatorType,
                    "creatorId": item.creatorId,
                }));
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
    if !roblox::sessionAlive(&roblox::client(), &credentials.cookie).await {
        return Err(
            "Roblox no longer accepts this session. Open Accounts and sign in again.".into(),
        );
    }

    let studioMismatch = bridge
        .studioUserId()
        .filter(|studioUserId| studioUserId != &credentials.id);

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
    let assetKind = settings.assetKind.clone();
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
        universeId: Mutex::default(),
        placeId: bridge.openPlaceId(),
        cache,
        placeIds: AsyncMutex::default(),
        preferred: Mutex::default(),
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
        assetKind,
    });

    if let Some(studioUserId) = &studioMismatch {
        session.status(&format!(
            "Studio is signed in as {studioUserId} and jStudio as {}. Private assets of that account may be refused.",
            session.credentials.id
        ));
    }

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
            tasks.spawn(async move { session.process(item, slots).await });
        }

        let status = batch.get("status").and_then(Value::as_str).unwrap_or("");
        if status == "completed" || status == "cancelled" {
            break;
        }
    }

    session.status("Finishing the queue");
    while tasks.join_next().await.is_some() {}

    control.gate().await;
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
            tasks.spawn(async move { session.process(item, slots).await });
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
        bridge.pushMappings(
            lines,
            format!("run{}", nowMs()),
            session.settings.assetKind.clone(),
        );
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
        "assetKind": session.settings.assetKind,
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

    control.finish();
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
        assert_eq!(settings.downloadConcurrency, 12);
        assert_eq!(settings.uploadConcurrency, MAX_CONCURRENCY);
    }
}
