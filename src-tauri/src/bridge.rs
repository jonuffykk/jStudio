use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, Notify};

pub const PORT_RANGE: std::ops::RangeInclusive<u16> = 8712..=8719;

const POLL_HOLD: Duration = Duration::from_secs(25);
const HEARTBEAT_WINDOW_MS: u64 = 40_000;
const MAX_QUEUE: usize = 64;
const MAX_RESULTS: usize = 256;
const MAX_BODY_BYTES: usize = 24 * 1024 * 1024;

pub fn nowMs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub payload: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub id: String,
    pub status: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    #[serde(default)]
    pub selectedOnly: bool,
    #[serde(default)]
    pub useInstanceNames: bool,
    #[serde(default = "animationKind")]
    pub assetKind: String,
}

fn animationKind() -> String {
    "animation".to_owned()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MappingPush {
    token: String,
    lines: Vec<String>,
    assetKind: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNode {
    pub path: String,
    pub className: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Default)]
struct Inner {
    placeId: Option<String>,
    placeName: Option<String>,
    pluginVersion: Option<String>,
    lastSeenAt: Option<u64>,
    selectionCount: u32,
    nodes: Vec<ProjectNode>,
    truncated: bool,
    syncedAt: Option<u64>,
    queue: VecDeque<Job>,
    results: HashMap<String, JobResult>,
    resultOrder: VecDeque<String>,
    studioUserId: Option<String>,
    creatorId: Option<String>,
    creatorType: Option<String>,
    pendingScan: Option<ScanRequest>,
    pendingMappings: Option<MappingPush>,
}

#[derive(Clone)]
pub struct Bridge {
    inner: Arc<Mutex<Inner>>,
    counter: Arc<AtomicU64>,
    port: Arc<Mutex<u16>>,
    work: Arc<Notify>,
    app: Arc<Mutex<Option<AppHandle>>>,
    scanTx: Arc<broadcast::Sender<Value>>,
    token: Arc<Mutex<String>>,
}

impl Default for Bridge {
    fn default() -> Self {
        Self::new()
    }
}

impl Bridge {
    pub fn new() -> Self {
        Self {
            inner: Arc::default(),
            counter: Arc::default(),
            port: Arc::default(),
            work: Arc::default(),
            app: Arc::default(),
            scanTx: Arc::new(broadcast::channel(256).0),
            token: Arc::default(),
        }
    }

    pub fn setToken(&self, token: String) {
        *self.token.lock().unwrap() = token;
    }

    fn authorized(&self, headers: &HeaderMap) -> bool {
        if headers.contains_key("origin") {
            return false;
        }
        let expected = self.token.lock().unwrap().clone();
        headers
            .get("x-jstudio-token")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| !expected.is_empty() && value == expected)
    }

    pub fn subscribeScan(&self) -> broadcast::Receiver<Value> {
        self.scanTx.subscribe()
    }

    pub fn attach(&self, app: AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }

    fn emit(&self, event: &str, payload: Value) {
        if let Some(app) = self.app.lock().unwrap().as_ref() {
            let _ = app.emit(event, payload);
        }
    }

    fn touch(&self) {
        let online = {
            let mut inner = self.inner.lock().unwrap();
            let was = inner.lastSeenAt.is_some();
            inner.lastSeenAt = Some(nowMs());
            !was
        };
        if online {
            self.emit("studio:status", self.status());
        }
    }

    pub fn status(&self) -> Value {
        let inner = self.inner.lock().unwrap();
        let online = inner
            .lastSeenAt
            .map(|seen| nowMs().saturating_sub(seen) < HEARTBEAT_WINDOW_MS)
            .unwrap_or(false);

        json!({
            "online": online,
            "port": *self.port.lock().unwrap(),
            "placeId": inner.placeId,
            "placeName": inner.placeName,
            "studioUserId": inner.studioUserId,
            "creatorId": inner.creatorId,
            "creatorType": inner.creatorType,
            "pluginVersion": inner.pluginVersion,
            "selectionCount": inner.selectionCount,
            "lastSeenAt": inner.lastSeenAt,
            "syncedAt": inner.syncedAt,
            "nodeCount": inner.nodes.len(),
            "truncated": inner.truncated,
        })
    }

    pub fn tree(&self) -> Value {
        let inner = self.inner.lock().unwrap();
        json!({
            "nodes": inner.nodes,
            "truncated": inner.truncated,
            "syncedAt": inner.syncedAt,
        })
    }

    pub fn openPlaceId(&self) -> Option<String> {
        self.inner.lock().unwrap().placeId.clone()
    }

    pub fn studioUserId(&self) -> Option<String> {
        self.inner.lock().unwrap().studioUserId.clone()
    }

    pub fn isOnline(&self) -> bool {
        self.inner
            .lock()
            .unwrap()
            .lastSeenAt
            .map(|seen| nowMs().saturating_sub(seen) < HEARTBEAT_WINDOW_MS)
            .unwrap_or(false)
    }

    pub fn enqueue(&self, kind: String, payload: Value) -> String {
        let id = format!("job{}", self.counter.fetch_add(1, Ordering::Relaxed));
        {
            let mut inner = self.inner.lock().unwrap();
            inner.queue.push_back(Job {
                id: id.clone(),
                kind,
                payload,
            });
            while inner.queue.len() > MAX_QUEUE {
                inner.queue.pop_front();
            }
        }
        self.work.notify_waiters();
        id
    }

    pub fn result(&self, id: &str) -> Option<JobResult> {
        self.inner.lock().unwrap().results.get(id).cloned()
    }

    pub fn requestScan(&self, request: ScanRequest) {
        self.inner.lock().unwrap().pendingScan = Some(request);
        self.work.notify_waiters();
    }

    pub fn cancelScan(&self) {
        self.inner.lock().unwrap().pendingScan = None;
        let payload = json!({ "status": "cancelled", "results": [] });
        let _ = self.scanTx.send(payload.clone());
        self.emit("spoof:scan", payload);
    }

    pub fn pushMappings(&self, lines: Vec<String>, token: String, assetKind: String) {
        self.inner.lock().unwrap().pendingMappings = if lines.is_empty() {
            None
        } else {
            Some(MappingPush {
                token,
                lines,
                assetKind,
            })
        };
        self.work.notify_waiters();
    }

    fn takeWork(&self) -> Option<Value> {
        let mut inner = self.inner.lock().unwrap();
        let job = inner.queue.pop_front();
        let scan = inner.pendingScan.take();
        let mappings = inner.pendingMappings.take();

        if job.is_none() && scan.is_none() && mappings.is_none() {
            return None;
        }
        Some(json!({ "job": job, "scan": scan, "mappings": mappings }))
    }

    fn recordResult(&self, mut result: JobResult) {
        result.at = nowMs();
        let payload = json!(result);
        {
            let mut inner = self.inner.lock().unwrap();
            let id = result.id.clone();
            if inner.results.insert(id.clone(), result).is_none() {
                inner.resultOrder.push_back(id);
            }
            while inner.resultOrder.len() > MAX_RESULTS {
                if let Some(oldest) = inner.resultOrder.pop_front() {
                    inner.results.remove(&oldest);
                }
            }
        }
        self.emit("job:result", payload);
    }
}

fn pluginOnly(bridge: &Bridge, headers: &HeaderMap) -> Result<(), StatusCode> {
    if bridge.authorized(headers) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hello {
    #[serde(default)]
    placeId: Option<String>,
    #[serde(default)]
    placeName: Option<String>,
    #[serde(default)]
    pluginVersion: Option<String>,
    #[serde(default)]
    studioUserId: Option<String>,
    #[serde(default)]
    creatorId: Option<String>,
    #[serde(default)]
    creatorType: Option<String>,
}

async fn hello(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
    Json(body): Json<Hello>,
) -> Result<Json<Value>, StatusCode> {
    pluginOnly(&bridge, &headers)?;
    {
        let mut inner = bridge.inner.lock().unwrap();
        inner.placeId = body.placeId;
        inner.placeName = body.placeName;
        inner.pluginVersion = body.pluginVersion;
        inner.studioUserId = body.studioUserId.filter(|id| id != "0");
        inner.creatorId = body.creatorId.filter(|id| id != "0");
        inner.creatorType = body.creatorType;
        inner.lastSeenAt = Some(nowMs());
    }
    bridge.emit("studio:status", bridge.status());
    Ok(Json(json!({ "ok": true, "app": "jstudio" })))
}

async fn goodbye(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    pluginOnly(&bridge, &headers)?;
    {
        let mut inner = bridge.inner.lock().unwrap();
        inner.lastSeenAt = None;
        inner.pendingScan = None;
    }
    bridge.emit("studio:status", bridge.status());
    Ok(Json(json!({ "ok": true })))
}

async fn poll(State(bridge): State<Bridge>, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    pluginOnly(&bridge, &headers)?;
    bridge.touch();

    if let Some(work) = bridge.takeWork() {
        return Ok(Json(work));
    }

    let notified = bridge.work.notified();
    tokio::select! {
        _ = notified => {}
        _ = tokio::time::sleep(POLL_HOLD) => {}
    }

    Ok(Json(bridge.takeWork().unwrap_or_else(|| json!({}))))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TreePush {
    nodes: Vec<ProjectNode>,
    #[serde(default)]
    truncated: bool,
}

async fn pushTree(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
    Json(body): Json<TreePush>,
) -> Result<Json<Value>, StatusCode> {
    pluginOnly(&bridge, &headers)?;
    bridge.touch();

    let count = body.nodes.len();
    {
        let mut inner = bridge.inner.lock().unwrap();
        inner.nodes = body.nodes;
        inner.truncated = body.truncated;
        inner.syncedAt = Some(nowMs());
    }
    bridge.emit("studio:tree", bridge.status());
    Ok(Json(json!({ "ok": true, "count": count })))
}

async fn reportResult(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
    Json(body): Json<JobResult>,
) -> Result<Json<Value>, StatusCode> {
    pluginOnly(&bridge, &headers)?;
    bridge.touch();
    bridge.recordResult(body);
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanBatch {
    #[serde(default)]
    status: String,
    #[serde(default)]
    results: Vec<String>,
}

async fn reportScan(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
    Json(body): Json<ScanBatch>,
) -> Result<Json<Value>, StatusCode> {
    pluginOnly(&bridge, &headers)?;
    bridge.touch();

    let payload = json!({ "status": body.status, "results": body.results });
    let _ = bridge.scanTx.send(payload.clone());
    bridge.emit("spoof:scan", payload);
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplaceReport {
    #[serde(default)]
    replacedCount: u32,
}

async fn reportReplace(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
    Json(body): Json<ReplaceReport>,
) -> Result<Json<Value>, StatusCode> {
    pluginOnly(&bridge, &headers)?;
    bridge.touch();
    bridge.emit(
        "studio:replace",
        json!({ "replacedCount": body.replacedCount }),
    );
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionReport {
    #[serde(default)]
    count: u32,
    #[serde(default)]
    paths: Vec<String>,
}

async fn reportSelection(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
    Json(body): Json<SelectionReport>,
) -> Result<Json<Value>, StatusCode> {
    pluginOnly(&bridge, &headers)?;
    bridge.touch();
    bridge.inner.lock().unwrap().selectionCount = body.count;
    let paths: Vec<String> = body.paths.into_iter().take(30).collect();
    bridge.emit(
        "studio:selection",
        json!({ "count": body.count, "paths": paths }),
    );
    Ok(Json(json!({ "ok": true })))
}

pub async fn serve(bridge: Bridge) -> std::io::Result<()> {
    let mut listener = None;
    for port in PORT_RANGE {
        if let Ok(bound) = tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            listener = Some(bound);
            break;
        }
    }

    let listener = listener.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            "every port jStudio listens on is taken",
        )
    })?;

    *bridge.port.lock().unwrap() = listener.local_addr()?.port();

    let app = Router::new()
        .route("/hello", post(hello))
        .route("/goodbye", post(goodbye))
        .route("/poll", get(poll))
        .route("/tree", post(pushTree))
        .route("/result", post(reportResult))
        .route("/scan", post(reportScan))
        .route("/replace", post(reportReplace))
        .route("/selection", post(reportSelection))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            MAX_BODY_BYTES,
        ))
        .with_state(bridge);

    axum::serve(listener, app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queueDrainsInOrderAndCaps() {
        let bridge = Bridge::new();
        for index in 0..(MAX_QUEUE + 4) {
            bridge.enqueue("script".into(), json!({ "index": index }));
        }
        let inner = bridge.inner.lock().unwrap();
        assert_eq!(inner.queue.len(), MAX_QUEUE);
        assert_eq!(inner.queue.front().unwrap().payload["index"], 4);
    }

    #[test]
    fn takeWorkReturnsNothingWhenIdle() {
        let bridge = Bridge::new();
        assert!(bridge.takeWork().is_none());
        bridge.requestScan(ScanRequest {
            selectedOnly: true,
            useInstanceNames: true,
            assetKind: "animation".into(),
        });
        let work = bridge.takeWork().expect("scan should be pending");
        assert_eq!(work["scan"]["selectedOnly"], true);
        assert!(bridge.takeWork().is_none());
    }

    #[test]
    fn resultsEvictOldest() {
        let bridge = Bridge::new();
        for index in 0..(MAX_RESULTS + 2) {
            bridge.recordResult(JobResult {
                id: format!("job{index}"),
                status: "done".into(),
                message: String::new(),
                at: 0,
            });
        }
        assert!(bridge.result("job0").is_none());
        assert!(bridge.result(&format!("job{}", MAX_RESULTS + 1)).is_some());
    }

    #[test]
    fn onlyTheMatchingTokenIsLetIn() {
        let bridge = Bridge::new();
        bridge.setToken("secret".into());

        let mut headers = HeaderMap::new();
        assert!(pluginOnly(&bridge, &headers).is_err());

        headers.insert("x-jstudio-token", "wrong".parse().unwrap());
        assert!(pluginOnly(&bridge, &headers).is_err());

        headers.insert("x-jstudio-token", "secret".parse().unwrap());
        assert!(pluginOnly(&bridge, &headers).is_ok());

        headers.insert("origin", "http://evil.local".parse().unwrap());
        assert!(pluginOnly(&bridge, &headers).is_err());
    }

    #[test]
    fn noTokenMeansNoAccess() {
        let bridge = Bridge::new();
        let mut headers = HeaderMap::new();
        headers.insert("x-jstudio-token", "".parse().unwrap());
        assert!(pluginOnly(&bridge, &headers).is_err());
    }
}
