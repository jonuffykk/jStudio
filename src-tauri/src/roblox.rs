use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Serialize;
use serde_json::{json, Value};

use crate::bridge::nowMs;

const USER_AGENT: &str = "RobloxStudio/WinInet";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const UPLOAD_POLL_ATTEMPTS: u32 = 30;
const RATE_LIMIT_ATTEMPTS: u32 = 4;

const FALLBACK_PLACE_IDS: [&str; 4] = ["99840799534728", "606849621", "155615604", "5704517949"];

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Bucket {
    Download,
    Upload,
    Catalog,
}

static downloadUntil: AtomicU64 = AtomicU64::new(0);
static uploadUntil: AtomicU64 = AtomicU64::new(0);
static catalogUntil: AtomicU64 = AtomicU64::new(0);

fn clockFor(bucket: Bucket) -> &'static AtomicU64 {
    match bucket {
        Bucket::Download => &downloadUntil,
        Bucket::Upload => &uploadUntil,
        Bucket::Catalog => &catalogUntil,
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanItem {
    pub id: String,
    pub name: String,
    pub creatorType: String,
    pub creatorId: String,
}

pub fn client() -> Client {
    Client::builder()
        .user_agent(USER_AGENT)
        .gzip(true)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("http client")
}

pub fn normalizeCookie(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches(['"', '\'']);
    let value = trimmed
        .split(';')
        .find_map(|part| {
            let part = part.trim();
            part.strip_prefix(".ROBLOSECURITY=")
                .or_else(|| part.strip_prefix(".roblosecurity="))
        })
        .unwrap_or(trimmed)
        .trim();

    if value.is_empty() {
        String::new()
    } else {
        format!(".ROBLOSECURITY={value}")
    }
}

pub fn sanitizeFileName(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .take(80)
        .collect();

    let cleaned = cleaned.trim().to_owned();
    if cleaned.is_empty() {
        "asset".into()
    } else {
        cleaned
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Download,
    Upload,
}

pub fn describeFailure(phase: Phase, raw: &str) -> String {
    describeFailureFor(phase, raw, true)
}

pub fn describeFailureFor(phase: Phase, raw: &str, mine: bool) -> String {
    let lower = raw.to_lowercase();
    let rateLimited = lower.contains("429") || lower.contains("rate limit");
    let unauthorized = lower.contains("401");
    let forbidden = lower.contains("403") || lower.contains("permission");
    let missing = lower.contains("404") || lower.contains("moderated");
    let offline = lower.contains("timeout")
        || lower.contains("connect")
        || lower.contains("dns")
        || lower.contains("network");

    let text = match phase {
        Phase::Upload => {
            if unauthorized {
                "Open Cloud key rejected"
            } else if forbidden {
                "Key cannot write assets"
            } else if rateLimited {
                "Upload rate limited"
            } else if lower.contains("400") {
                "Roblox refused the upload"
            } else if offline {
                "Upload could not reach Roblox"
            } else {
                "Upload failed"
            }
        }
        Phase::Download => {
            if unauthorized {
                "Roblox session expired"
            } else if forbidden {
                if mine {
                    "Roblox refused it to this session"
                } else {
                    "Private to whoever made it"
                }
            } else if missing {
                "Asset unavailable"
            } else if rateLimited {
                "Download rate limited"
            } else if offline {
                "Download could not reach Roblox"
            } else {
                "Download failed"
            }
        }
    };

    text.to_owned()
}

pub fn failureDetail(raw: &str) -> String {
    let clean = raw.trim();
    if clean.len() <= 180 {
        return clean.to_owned();
    }
    // The trail is joined with a middle dot, so cutting on a byte index can land
    // inside a character.
    let cut = clean
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= 177)
        .last()
        .unwrap_or(0);
    format!("{}...", &clean[..cut])
}

pub fn parseScanLines(lines: &[String]) -> Vec<ScanItem> {
    let mut seen = std::collections::HashSet::new();
    let mut found = Vec::new();

    for line in lines {
        let line = line.trim();
        let Some((id, rest)) = line.split_once(" - ") else {
            continue;
        };
        let Some((name, creator)) = rest.rsplit_once(" - ") else {
            continue;
        };
        let Some((kind, creatorId)) = creator.split_once(':') else {
            continue;
        };

        let id = id.trim();
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) || !seen.insert(id.to_owned()) {
            continue;
        }

        let creatorId = creatorId.trim();
        let name = name.trim();
        found.push(ScanItem {
            id: id.to_owned(),
            name: if name.is_empty() { "Unnamed" } else { name }.to_owned(),
            creatorType: if kind.trim().eq_ignore_ascii_case("G") {
                "group"
            } else {
                "user"
            }
            .to_owned(),
            creatorId: if creatorId.chars().all(|c| c.is_ascii_digit()) {
                creatorId.to_owned()
            } else {
                String::new()
            },
        });
    }
    found
}

async fn authedJson(client: &Client, url: &str, cookie: &str) -> Result<Value, String> {
    let header = normalizeCookie(cookie);
    if header.is_empty() {
        return Err("The stored Roblox session is not a valid cookie.".into());
    }

    awaitCooldown(Bucket::Catalog).await;

    let response = client
        .get(url)
        .header("Cookie", header)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if status == StatusCode::TOO_MANY_REQUESTS {
        let retryAfter = response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(5);
        holdRateLimit(Bucket::Catalog, retryAfter);
    }

    if !status.is_success() {
        return Err(format!("HTTP {status} from {url}"));
    }
    response.json().await.map_err(|error| error.to_string())
}

pub async fn getProfile(client: &Client, cookie: &str) -> Result<Value, String> {
    let user = authedJson(
        client,
        "https://users.roblox.com/v1/users/authenticated",
        cookie,
    )
    .await?;

    let id = user
        .get("id")
        .and_then(Value::as_u64)
        .ok_or("Roblox did not recognise that session.")?
        .to_string();

    let name = user.get("name").and_then(Value::as_str).unwrap_or_default();
    let displayName = user
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or(name);

    let avatarUrl = client
        .get(format!(
            "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={id}&size=48x48&format=Png&isCircular=true"
        ))
        .send()
        .await
        .ok()
        .and_then(|response| response.error_for_status().ok());

    let avatarUrl = match avatarUrl {
        Some(response) => response
            .json::<Value>()
            .await
            .ok()
            .and_then(|body| {
                body.pointer("/data/0/imageUrl")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_default(),
        None => String::new(),
    };

    Ok(json!({
        "id": id,
        "name": displayName,
        "username": name,
        "avatarUrl": avatarUrl,
        "hasApiKey": false,
    }))
}

pub async fn sessionAlive(client: &Client, cookie: &str) -> bool {
    authedJson(
        client,
        "https://users.roblox.com/v1/users/authenticated",
        cookie,
    )
    .await
    .map(|body| body.get("id").is_some())
    .unwrap_or(false)
}

pub async fn getGroups(client: &Client, cookie: &str, userId: &str) -> Result<Value, String> {
    let manageable = authedJson(
        client,
        "https://develop.roblox.com/v1/user/groups/canmanage",
        cookie,
    )
    .await
    .ok()
    .and_then(|body| {
        body.get("data").and_then(Value::as_array).map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_u64))
                .collect::<std::collections::HashSet<u64>>()
        })
    });

    let body = authedJson(
        client,
        &format!("https://groups.roblox.com/v1/users/{userId}/groups/roles"),
        cookie,
    )
    .await?;

    let groups: Vec<Value> = body
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.pointer("/group/id").and_then(Value::as_u64)?;
                    if let Some(allowed) = &manageable {
                        if !allowed.contains(&id) {
                            return None;
                        }
                    }
                    Some(json!({
                        "id": id.to_string(),
                        "name": item.pointer("/group/name").and_then(Value::as_str).unwrap_or("Unknown group"),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(Value::Array(groups))
}

pub async fn getPlaceIds(
    client: &Client,
    cookie: &str,
    creatorType: &str,
    creatorId: &str,
    max: usize,
) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();

    for accessFilter in [2, 1] {
        if creatorId.is_empty() || !ids.is_empty() {
            break;
        }
        let base = if creatorType == "group" {
            format!("https://games.roblox.com/v2/groups/{creatorId}/games?limit=50&accessFilter={accessFilter}")
        } else {
            format!("https://games.roblox.com/v2/users/{creatorId}/games?sortOrder=Asc&limit=50&accessFilter={accessFilter}")
        };

        let mut cursor: Option<String> = None;
        while ids.len() < max {
            let url = match &cursor {
                Some(cursor) => format!("{base}&cursor={cursor}"),
                None => base.clone(),
            };
            let Ok(body) = authedJson(client, &url, cookie).await else {
                break;
            };

            let page = body.get("data").and_then(Value::as_array);
            let Some(page) = page.filter(|games| !games.is_empty()) else {
                break;
            };

            ids.extend(page.iter().filter_map(|game| {
                game.pointer("/rootPlace/id")
                    .or_else(|| game.get("id"))
                    .and_then(Value::as_u64)
                    .map(|id| id.to_string())
            }));

            cursor = body
                .get("nextPageCursor")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if cursor.is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
        ids.truncate(max);
    }

    for id in FALLBACK_PLACE_IDS {
        if !ids.iter().any(|known| known == id) {
            ids.push(id.to_owned());
        }
    }
    ids
}

fn studioSession(placeId: &str) -> [(&'static str, String); 3] {
    let gameId = gameIdFor(placeId);
    let session = json!({
        "SessionId": gameId,
        "GameId": gameId,
        "PlaceId": placeId.parse::<u64>().unwrap_or(0),
    })
    .to_string();

    [
        ("Roblox-Place-Id", placeId.to_owned()),
        ("Roblox-Game-Id", gameId),
        ("Roblox-Session-Id", session),
    ]
}

static gameIds: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Studio sends a fresh session guid per place. A stable one per place, kept for the
/// life of the process, is what the delivery service accepts; deriving it from the
/// place id produced guids Roblox refused for copylocked assets.
fn gameIdFor(placeId: &str) -> String {
    let mut guard = gameIds.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some(known) = map.get(placeId) {
        return known.clone();
    }

    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos() as u64)
        .unwrap_or(0)
        ^ placeId
            .bytes()
            .fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| {
                (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
            });
    let high = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    let low = high.rotate_left(31).wrapping_mul(0xbf58_476d_1ce4_e5b9);

    let value = format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (high >> 32) as u32,
        (high >> 16) as u16,
        (high & 0xfff) as u16,
        0x8000u16 | ((low >> 48) as u16 & 0x3fff),
        low & 0xffff_ffff_ffff,
    );
    map.insert(placeId.to_owned(), value.clone());
    value
}

const STUDIO_AGENTS: [&str; 3] = [
    "RobloxStudio/WinInet",
    "RobloxApp/WinInet",
    "Roblox/WinInet",
];

fn expectedType(assetKind: &str) -> &'static str {
    match assetKind {
        "audio" => "&expectedAssetType=Audio",
        _ => "",
    }
}

fn deliveryUrls(assetId: &str, placeId: Option<&str>, assetKind: &str) -> Vec<String> {
    let expected = expectedType(assetKind);
    match placeId {
        Some(placeId) => vec![
            format!("https://assetdelivery.roblox.com/v1/asset/?id={assetId}&placeId={placeId}{expected}"),
            format!("https://assetdelivery.roblox.com/v1/asset/?id={assetId}&placeId={placeId}&serverplaceid={placeId}{expected}&clientInsert=1"),
        ],
        None => vec![format!(
            "https://assetdelivery.roblox.com/v1/asset/?id={assetId}{expected}"
        )],
    }
}

pub async fn relatedPlaceIds(
    client: &Client,
    cookie: &str,
    creatorType: &str,
    creatorId: &str,
    max: usize,
) -> Vec<String> {
    if creatorId.is_empty() || creatorType != "user" {
        return Vec::new();
    }

    let mut owners: Vec<(String, String)> = Vec::new();

    if let Ok(body) = authedJson(
        client,
        &format!("https://groups.roblox.com/v1/users/{creatorId}/groups/roles"),
        cookie,
    )
    .await
    {
        for entry in body
            .get("data")
            .and_then(Value::as_array)
            .unwrap_or(&vec![])
        {
            if let Some(groupId) = entry.pointer("/group/id").and_then(Value::as_u64) {
                owners.push(("group".to_owned(), groupId.to_string()));
            }
            if let Some(ownerId) = entry.pointer("/group/owner/userId").and_then(Value::as_u64) {
                owners.push(("user".to_owned(), ownerId.to_string()));
            }
            if owners.len() >= 12 {
                break;
            }
        }
    }

    let mut found = Vec::new();
    for (kind, id) in owners {
        if id == creatorId {
            continue;
        }
        for placeId in getPlaceIds(client, cookie, &kind, &id, 4).await {
            if !found.contains(&placeId) {
                found.push(placeId);
            }
            if found.len() >= max {
                return found;
            }
        }
    }
    found
}

async fn batchLocation(
    client: &Client,
    assetId: &str,
    placeId: &str,
    cookie: &str,
    assetKind: &str,
) -> Option<String> {
    awaitCooldown(Bucket::Download).await;

    let assetType = match assetKind {
        "audio" => "Audio",
        "image" => "Decal",
        "mesh" => "Mesh",
        _ => "Animation",
    };

    let mut request = client
        .post("https://assetdelivery.roblox.com/v2/assets/batch")
        .header("Cookie", normalizeCookie(cookie))
        .header("User-Agent", STUDIO_AGENTS[0])
        .json(&json!([{
            "requestId": assetId,
            "assetType": assetType,
            "assetId": assetId,
        }]));

    for (name, value) in studioSession(placeId) {
        request = request.header(name, value);
    }

    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let body = response.json::<Value>().await.ok()?;
    body.pointer("/0/locations/0/location")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

async fn cdnUrls(client: &Client, assetId: &str, cookie: &str) -> Vec<String> {
    let Ok(body) = authedJson(
        client,
        &format!("https://economy.roblox.com/v2/assets/{assetId}/details"),
        cookie,
    )
    .await
    else {
        return Vec::new();
    };

    let mut urls = Vec::new();
    if let Some(hash) = body
        .get("AssetHash")
        .and_then(Value::as_str)
        .filter(|hash| !hash.is_empty())
    {
        urls.push(format!(
            "https://assetdelivery.roblox.com/v1/assetHash/{hash}"
        ));
        for shard in 0..8 {
            urls.push(format!("https://t{shard}.rbxcdn.com/{hash}"));
        }
        urls.push(format!("https://setup.rbxcdn.com/{hash}"));
    }
    if let Some(version) = body.get("AssetVersionId").and_then(Value::as_u64) {
        urls.push(format!(
            "https://assetdelivery.roblox.com/v1/assetversion?assetVersionId={version}"
        ));
    }
    urls
}

/// The delivery service answers `/v1/assetId/{id}` with the very location the client
/// would stream from. Asking once inside the place context and once outside it covers
/// assets that are only served to a running game.
async fn locationUrls(
    client: &Client,
    assetId: &str,
    placeId: Option<&str>,
    cookie: &str,
) -> Vec<String> {
    awaitCooldown(Bucket::Download).await;

    let mut request = client
        .get(format!(
            "https://assetdelivery.roblox.com/v1/assetId/{assetId}"
        ))
        .header("Cookie", normalizeCookie(cookie))
        .header("User-Agent", STUDIO_AGENTS[0]);

    if let Some(placeId) = placeId {
        for (name, value) in studioSession(placeId) {
            request = request.header(name, value);
        }
    }

    let Ok(response) = request.send().await else {
        return Vec::new();
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    let Ok(body) = response.json::<Value>().await else {
        return Vec::new();
    };

    body.pointer("/locations/0/location")
        .or_else(|| body.get("location"))
        .and_then(Value::as_str)
        .filter(|location| !location.is_empty())
        .map(|location| vec![location.to_owned()])
        .unwrap_or_default()
}

/// Places that actually run the asset. This is the most reliable source of a working
/// place context for something someone else made.
pub async fn usagePlaceIds(
    client: &Client,
    cookie: &str,
    assetId: &str,
    max: usize,
) -> Vec<String> {
    let Ok(body) = authedJson(
        client,
        &format!("https://games.roblox.com/v1/games/asset-to-universe?assetId={assetId}"),
        cookie,
    )
    .await
    else {
        return Vec::new();
    };

    let mut universeIds: Vec<String> = Vec::new();
    let mut push = |value: Option<&Value>| {
        let Some(value) = value else { return };
        let id = value
            .as_u64()
            .map(|id| id.to_string())
            .or_else(|| value.as_str().map(str::to_owned));
        let Some(id) = id else { return };
        if !id.is_empty()
            && id.chars().all(|character| character.is_ascii_digit())
            && !universeIds.contains(&id)
        {
            universeIds.push(id);
        }
    };

    if let Some(values) = body.get("universeIds").and_then(Value::as_array) {
        for value in values {
            push(Some(value));
        }
    }
    if let Some(values) = body.get("data").and_then(Value::as_array) {
        for value in values {
            push(Some(
                value
                    .get("universeId")
                    .or_else(|| value.get("id"))
                    .unwrap_or(value),
            ));
        }
    }
    push(body.get("universeId"));

    if universeIds.is_empty() {
        return Vec::new();
    }
    universeIds.truncate(50);

    let Ok(games) = authedJson(
        client,
        &format!(
            "https://games.roblox.com/v1/games?universeIds={}",
            universeIds.join(",")
        ),
        cookie,
    )
    .await
    else {
        return Vec::new();
    };

    let mut placeIds = Vec::new();
    let empty = Vec::new();
    for game in games
        .get("data")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
    {
        let placeId = game
            .get("rootPlaceId")
            .or_else(|| game.pointer("/rootPlace/id"))
            .or_else(|| game.get("placeId"))
            .and_then(|value| {
                value
                    .as_u64()
                    .map(|id| id.to_string())
                    .or_else(|| value.as_str().map(str::to_owned))
            });
        if let Some(placeId) = placeId.filter(|id| id != "0") {
            if !placeIds.contains(&placeId) {
                placeIds.push(placeId);
            }
            if placeIds.len() >= max {
                break;
            }
        }
    }
    placeIds
}

async fn csrfToken(client: &Client, cookie: &str) -> Option<String> {
    let response = client
        .post("https://auth.roblox.com/v2/logout")
        .header("Cookie", normalizeCookie(cookie))
        .header("Content-Length", "0")
        .send()
        .await
        .ok()?;
    response
        .headers()
        .get("x-csrf-token")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

/// A free asset is still refused to a session that does not own it. Taking the free
/// copy first turns that refusal into a plain download.
pub async fn claimFree(client: &Client, assetId: &str, cookie: &str) -> bool {
    let Ok(details) = authedJson(
        client,
        &format!("https://economy.roblox.com/v2/assets/{assetId}/details"),
        cookie,
    )
    .await
    else {
        return false;
    };

    let price = details.get("PriceInRobux");
    let free = price.is_none()
        || price.is_some_and(Value::is_null)
        || price.and_then(Value::as_u64) == Some(0)
        || details
            .get("IsPublicDomain")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    if !free {
        return false;
    }

    let Some(productId) = details
        .get("ProductId")
        .and_then(Value::as_u64)
        .filter(|id| *id != 0)
    else {
        return false;
    };
    let Some(sellerId) = details
        .pointer("/Creator/CreatorTargetId")
        .and_then(Value::as_u64)
    else {
        return false;
    };
    let Some(token) = csrfToken(client, cookie).await else {
        return false;
    };

    client
        .post(format!(
            "https://economy.roblox.com/v1/purchases/products/{productId}"
        ))
        .header("Cookie", normalizeCookie(cookie))
        .header("x-csrf-token", token)
        .json(&json!({
            "expectedCurrency": 1,
            "expectedPrice": 0,
            "expectedSellerId": sellerId,
        }))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

pub fn looksLikeAsset(bytes: &[u8], assetKind: &str) -> bool {
    if bytes.len() < 16 {
        return false;
    }
    let start = bytes
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(0);
    let head = &bytes[start..];
    if head.len() < 4 {
        return false;
    }

    let startsWith = |needle: &[u8]| {
        head.len() >= needle.len() && head[..needle.len()].eq_ignore_ascii_case(needle)
    };
    let contains = |needle: &[u8]| {
        head[..head.len().min(512)]
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle))
    };

    if startsWith(b"<!doctype html")
        || startsWith(b"<html")
        || startsWith(b"{\"errors\"")
        || startsWith(b"{\"error\"")
        || bytes.starts_with(&[0x1f, 0x8b])
        || ((startsWith(b"<?xml") || startsWith(b"<error")) && !contains(b"<roblox"))
    {
        return false;
    }

    match assetKind {
        "audio" => {
            head.starts_with(b"OggS")
                || head.starts_with(b"ID3")
                || (head[0] == 0xff && (head[1] & 0xe0) == 0xe0)
                || head.starts_with(b"RIFF")
                || head.starts_with(b"fLaC")
                || head.starts_with(b"MAC ")
                || head.starts_with(b"FORM")
                || contains(b"ftyp")
        }
        "image" => {
            head.starts_with(&[0x89, b'P', b'N', b'G'])
                || head.starts_with(&[0xff, 0xd8, 0xff])
                || head.starts_with(b"GIF87a")
                || head.starts_with(b"GIF89a")
                || contains(b"<roblox")
        }
        // Meshes and animations keep arriving in new binary shapes, so anything that
        // is not an error page counts.
        _ => true,
    }
}

async fn savedVersionUrls(client: &Client, assetId: &str, cookie: &str) -> Vec<String> {
    let Ok(body) = authedJson(
        client,
        &format!("https://develop.roblox.com/v1/assets/{assetId}/saved-versions?count=10"),
        cookie,
    )
    .await
    else {
        return Vec::new();
    };

    body.get("data")
        .and_then(Value::as_array)
        .map(|versions| {
            versions
                .iter()
                .filter_map(|version| version.get("Id").or_else(|| version.get("id")))
                .filter_map(Value::as_u64)
                .map(|id| {
                    format!("https://assetdelivery.roblox.com/v1/assetversion?assetVersionId={id}")
                })
                .collect()
        })
        .unwrap_or_default()
}

pub async fn universeOf(client: &Client, placeId: &str, cookie: &str) -> Option<String> {
    let body = authedJson(
        client,
        &format!("https://apis.roblox.com/universes/v1/places/{placeId}/universe"),
        cookie,
    )
    .await
    .ok()?;

    body.get("universeId")
        .and_then(|value| {
            value
                .as_u64()
                .map(|id| id.to_string())
                .or_else(|| value.as_str().map(str::to_owned))
        })
        .filter(|id| !id.is_empty())
}

pub async fn grantAssetUse(
    client: &Client,
    apiKey: &str,
    cookie: &str,
    assetId: &str,
    universeId: &str,
) -> Result<(), String> {
    if apiKey.is_empty() || universeId.is_empty() {
        return Ok(());
    }

    let response = client
        .patch(format!(
            "https://apis.roblox.com/asset-permissions-api/v1/assets/{assetId}/permissions"
        ))
        .header("x-api-key", apiKey)
        .header("Cookie", normalizeCookie(cookie))
        .header("Content-Type", "application/json-patch+json")
        .json(&json!({
            "requests": [{
                "subjectType": "Universe",
                "subjectId": universeId,
                "action": "Use",
            }],
            "grantToDependencies": false,
            "enableDeepAccessCheck": false,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if status.is_success() || status == StatusCode::CONFLICT {
        return Ok(());
    }
    Err(format!("HTTP {status}"))
}

/// A picture id is very often a Decal, and the delivery service answers for one with
/// an rbxm that only points at the bitmap underneath. Uploading that wrapper is what
/// produced pictures that arrived stripped of their image, so the id inside it is
/// read out here and fetched in its own right.
pub fn wrappedAssetId(bytes: &[u8], outerId: &str) -> Option<String> {
    if !bytes.starts_with(b"<roblox") {
        return None;
    }

    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(20_000)]);
    let mut cursor = 0;

    while let Some(offset) = text[cursor..].find("id=") {
        let start = cursor + offset + 3;
        let digits: String = text[start..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        cursor = start.max(cursor + offset + 1);

        if digits.len() >= 4 && digits != outerId {
            return Some(digits);
        }
    }
    None
}

pub async fn isFreeToTake(client: &Client, assetId: &str, cookie: &str) -> bool {
    let Ok(details) = authedJson(
        client,
        &format!("https://economy.roblox.com/v2/assets/{assetId}/details"),
        cookie,
    )
    .await
    else {
        return false;
    };

    let price = details.get("PriceInRobux");
    let free = price.is_some_and(Value::is_null) || price.and_then(Value::as_u64) == Some(0);
    let public = details
        .get("IsPublicDomain")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let forSale = details
        .get("IsForSale")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    (free && forSale) || public
}

pub struct Fetched {
    pub bytes: Vec<u8>,
    pub placeId: Option<String>,
}

pub async fn fetchAsset(
    client: &Client,
    assetId: &str,
    placeIds: &[String],
    cookie: &str,
    assetKind: &str,
) -> Result<Fetched, String> {
    let header = normalizeCookie(cookie);
    let mut queue: std::collections::VecDeque<(String, Option<String>)> = Default::default();
    let mut queued: Vec<String> = Vec::new();

    let push = |queue: &mut std::collections::VecDeque<(String, Option<String>)>,
                queued: &mut Vec<String>,
                url: String,
                placeId: Option<String>| {
        if !queued.contains(&url) {
            queued.push(url.clone());
            queue.push_back((url, placeId));
        }
    };

    if let Some(placeId) = placeIds.first() {
        for url in deliveryUrls(assetId, Some(placeId), assetKind) {
            push(&mut queue, &mut queued, url, Some(placeId.clone()));
        }
    }
    for url in deliveryUrls(assetId, None, assetKind) {
        push(&mut queue, &mut queued, url, None);
    }
    for placeId in placeIds.iter().skip(1).take(15) {
        for url in deliveryUrls(assetId, Some(placeId), assetKind) {
            push(&mut queue, &mut queued, url, Some(placeId.clone()));
        }
    }

    let mut trail: Vec<String> = Vec::new();
    let mut deepened = false;
    let mut claimed = false;
    let mut refusals = 0usize;

    loop {
        let Some((url, placeId)) = queue.pop_front() else {
            if deepened {
                break;
            }
            deepened = true;
            refusals = 0;

            if let Some(placeId) = placeIds.first() {
                for url in locationUrls(client, assetId, Some(placeId), cookie).await {
                    push(&mut queue, &mut queued, url, Some(placeId.clone()));
                }
                if let Some(location) =
                    batchLocation(client, assetId, placeId, cookie, assetKind).await
                {
                    push(&mut queue, &mut queued, location, Some(placeId.clone()));
                }
            }
            for placeId in placeIds.iter().skip(1).take(8) {
                if let Some(location) =
                    batchLocation(client, assetId, placeId, cookie, assetKind).await
                {
                    push(&mut queue, &mut queued, location, Some(placeId.clone()));
                }
            }
            for url in locationUrls(client, assetId, None, cookie).await {
                push(&mut queue, &mut queued, url, None);
            }
            for url in cdnUrls(client, assetId, cookie).await {
                push(&mut queue, &mut queued, url, None);
            }
            for url in savedVersionUrls(client, assetId, cookie).await {
                push(&mut queue, &mut queued, url, None);
            }
            if queue.is_empty() {
                break;
            }
            continue;
        };

        // Roblox answers a url it will never serve the same way every time, so each one
        // is walked over the agents once and then dropped instead of being retried.
        let mut refused = false;

        for agent in STUDIO_AGENTS {
            awaitCooldown(Bucket::Download).await;

            let mut request = client
                .get(&url)
                .header("User-Agent", agent)
                .header("Roblox-Browser-Asset-Request", "false");

            if !url.contains("rbxcdn.com") {
                request = request.header("Cookie", &header);
            }
            if let Some(placeId) = &placeId {
                for (name, value) in studioSession(placeId) {
                    request = request.header(name, value);
                }
            }

            let response = match request.send().await {
                Ok(response) => response,
                Err(error) => {
                    trail.push(format!("{}: {error}", label(&url, placeId.as_deref())));
                    break;
                }
            };

            let status = response.status();
            if status == StatusCode::TOO_MANY_REQUESTS {
                let retryAfter = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(10);
                holdRateLimit(Bucket::Download, retryAfter);
                trail.push(format!("{}: 429", label(&url, placeId.as_deref())));
                continue;
            }

            if !status.is_success() {
                trail.push(format!(
                    "{}: {}",
                    label(&url, placeId.as_deref()),
                    status.as_u16()
                ));

                let blocked = matches!(
                    status,
                    StatusCode::FORBIDDEN | StatusCode::NOT_FOUND | StatusCode::CONFLICT
                );
                if blocked && !claimed {
                    claimed = true;
                    if claimFree(client, assetId, cookie).await {
                        continue;
                    }
                }
                refused = blocked;
                break;
            }

            let bytes = match response.bytes().await {
                Ok(bytes) => bytes.to_vec(),
                Err(error) => {
                    trail.push(format!("{}: {error}", label(&url, placeId.as_deref())));
                    break;
                }
            };

            if bytes.is_empty() {
                trail.push(format!("{}: empty", label(&url, placeId.as_deref())));
                break;
            }
            if !looksLikeAsset(&bytes, assetKind) {
                trail.push(format!(
                    "{}: {}",
                    label(&url, placeId.as_deref()),
                    refusalIn(&bytes)
                ));
                break;
            }

            return Ok(Fetched { bytes, placeId });
        }

        refusals = if refused { refusals + 1 } else { 0 };

        // An asset nobody will serve refuses every url the same way. Twenty in a row is
        // enough to stop spending the shared rate limit on it.
        if refusals >= 20 {
            trail.push("refused everywhere".into());
            if deepened {
                break;
            }
            queue.clear();
        }
    }

    if trail.is_empty() {
        trail.push("nothing to try".into());
    }
    Err(trail.join(" \u{b7} "))
}

fn refusalIn(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0x1f, 0x8b]) {
        return "still compressed".to_owned();
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(400)]);
    if let Ok(body) = serde_json::from_str::<Value>(head.trim()) {
        if let Some(code) = body.pointer("/errors/0/code").and_then(Value::as_u64) {
            return format!("{code} in body");
        }
    }
    "not an asset".to_owned()
}

fn label(url: &str, placeId: Option<&str>) -> String {
    if url.contains("rbxcdn.com") || url.contains("assetHash") {
        "cdn".into()
    } else if url.contains("assetversion") {
        "old version".into()
    } else {
        match placeId {
            Some(placeId) => format!("place {placeId}"),
            None => "direct".into(),
        }
    }
}

pub fn cooldownRemainingMs(bucket: Bucket) -> u64 {
    clockFor(bucket)
        .load(Ordering::Relaxed)
        .saturating_sub(nowMs())
}

fn holdRateLimit(bucket: Bucket, seconds: u64) {
    let until = nowMs() + seconds.clamp(1, 120) * 1000;
    clockFor(bucket).fetch_max(until, Ordering::Relaxed);
}

pub async fn awaitCooldown(bucket: Bucket) {
    loop {
        let remaining = cooldownRemainingMs(bucket);
        if remaining == 0 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(remaining.min(1000))).await;
    }
}

fn assetIdOf(body: &Value) -> Option<String> {
    body.pointer("/response/assetId")
        .or_else(|| body.pointer("/response/Id"))
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| value.as_u64().map(|id| id.to_string()))
        })
}

/// The name Open Cloud takes for a type moves around between keys and asset kinds, so
/// a refused name is retried once under the other one it is known by.
fn alternateType(assetType: &str) -> Option<&'static str> {
    match assetType {
        "Image" => Some("Decal"),
        "Decal" => Some("Image"),
        "Animation" => Some("Model"),
        "Model" => Some("Animation"),
        _ => None,
    }
}

fn uploadShape(assetKind: &str, bytes: &[u8]) -> (&'static str, &'static str, &'static str) {
    match assetKind {
        "audio" => {
            if bytes.starts_with(b"ID3") || bytes.starts_with(&[0xff, 0xfb]) {
                ("Audio", "audio/mpeg", "mp3")
            } else {
                ("Audio", "audio/ogg", "ogg")
            }
        }
        // Uploading a picture as a Decal hands back the id of the decal wrapper, and a
        // Texture or Image property fed that id shows nothing. Image hands back the id
        // of the bitmap itself, which is what those properties want.
        "image" => {
            if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
                ("Image", "image/jpeg", "jpg")
            } else {
                ("Image", "image/png", "png")
            }
        }
        "mesh" => ("Model", "model/x-rbxm", "rbxm"),
        _ => ("Animation", "model/x-rbxm", "rbxm"),
    }
}

pub async fn uploadAsset(
    client: &Client,
    apiKey: &str,
    userId: &str,
    groupId: Option<&str>,
    name: &str,
    bytes: Vec<u8>,
    assetKind: &str,
) -> Result<String, String> {
    if apiKey.is_empty() {
        return Err("This account has no Open Cloud API key.".into());
    }

    let (assetType, mime, extension) = uploadShape(assetKind, &bytes);

    let creator = match groupId {
        Some(id) => json!({ "groupId": id }),
        None => json!({ "userId": userId }),
    };
    let describe = |assetType: &str| {
        json!({
            "assetType": assetType,
            "displayName": name,
            "description": "Uploaded by jStudio",
            "creationContext": { "creator": creator },
        })
        .to_string()
    };
    let mut request = describe(assetType);
    let mut spare = alternateType(assetType);

    let mut body = json!({});
    for attempt in 1..=RATE_LIMIT_ATTEMPTS {
        awaitCooldown(Bucket::Upload).await;

        let form = reqwest::multipart::Form::new()
            .text("request", request.clone())
            .part(
                "fileContent",
                reqwest::multipart::Part::bytes(bytes.clone())
                    .file_name(format!("{}.{extension}", sanitizeFileName(name)))
                    .mime_str(mime)
                    .map_err(|error| error.to_string())?,
            );

        let response = client
            .post("https://apis.roblox.com/assets/v1/assets")
            .header("x-api-key", apiKey)
            .multipart(form)
            .send()
            .await
            .map_err(|error| error.to_string())?;

        let status = response.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            let retryAfter = response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(30);
            holdRateLimit(Bucket::Upload, retryAfter);
            if attempt == RATE_LIMIT_ATTEMPTS {
                return Err("HTTP 429 rate limit exhausted".into());
            }
            continue;
        }

        body = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
        if !status.is_success() {
            let detail = body
                .pointer("/error/message")
                .or_else(|| body.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("upload rejected");

            if let Some(other) = spare.take().filter(|_| status == StatusCode::BAD_REQUEST) {
                request = describe(other);
                continue;
            }
            return Err(format!("HTTP {status} {detail}"));
        }
        break;
    }

    if let Some(assetId) = assetIdOf(&body) {
        return Ok(assetId);
    }

    let operation = body
        .get("path")
        .and_then(Value::as_str)
        .ok_or("Roblox accepted the upload but returned no operation to follow.")?
        .to_owned();

    pollOperation(client, apiKey, &operation).await
}

async fn pollOperation(client: &Client, apiKey: &str, operation: &str) -> Result<String, String> {
    let url = if operation.starts_with("assets/") {
        format!("https://apis.roblox.com/{operation}")
    } else {
        format!(
            "https://apis.roblox.com/assets/v1/operations/{}",
            operation.rsplit('/').next().unwrap_or(operation)
        )
    };

    for attempt in 0..UPLOAD_POLL_ATTEMPTS {
        tokio::time::sleep(Duration::from_millis(600 + u64::from(attempt) * 200)).await;

        let response = client
            .get(&url)
            .header("x-api-key", apiKey)
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            holdRateLimit(Bucket::Upload, 15);
            continue;
        }

        let body = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
        if let Some(message) = body.pointer("/error/message").and_then(Value::as_str) {
            return Err(message.to_owned());
        }
        if let Some(assetId) = assetIdOf(&body) {
            return Ok(assetId);
        }
    }
    Err("Roblox never finished processing the upload.".into())
}

pub async fn probeApiKey(client: &Client, apiKey: &str) -> Value {
    if apiKey.trim().is_empty() {
        return json!({ "verdict": "empty" });
    }

    let response = client
        .get("https://apis.roblox.com/assets/v1/assets/1")
        .header("x-api-key", apiKey.trim())
        .send()
        .await;

    let Ok(response) = response else {
        return json!({ "verdict": "unknown" });
    };

    let verdict = match response.status().as_u16() {
        401 => "unauthorized",
        403 => "forbidden",
        429 => "unknown",
        status if status >= 500 => "unknown",
        _ => "ok",
    };

    json!({ "verdict": verdict })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn onlyRealAssetsPassTheCheck() {
        assert!(looksLikeAsset(
            b"<roblox!\x89\xff\r\n\x1a\n\x00\x00\x00\x00",
            "animation"
        ));
        assert!(looksLikeAsset(
            b"<roblox xmlns:xmime=\"http://www.w3.org/2005/05/xmlmime\">",
            "animation"
        ));
        assert!(!looksLikeAsset(
            b"<!doctype html><title>Forbidden</title><body>no</body>",
            "animation"
        ));
        assert!(!looksLikeAsset(
            b"{\"errors\":[{\"code\":403}]}",
            "animation"
        ));
        assert!(!looksLikeAsset(b"<roblox", "animation"));

        assert!(looksLikeAsset(
            b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
            "audio"
        ));
        assert!(looksLikeAsset(
            b"ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
            "audio"
        ));
        assert!(!looksLikeAsset(
            b"<!doctype html><title>Forbidden</title>",
            "audio"
        ));
        assert!(!looksLikeAsset(
            b"<roblox!\x89\xff\r\n\x1a\n\x00\x00\x00\x00",
            "audio"
        ));
    }

    #[test]
    fn theBitmapInsideADecalIsFound() {
        let decal = br#"<roblox version="4"><Item class="Decal"><Properties><Content name="Texture"><url>http://www.roblox.com/asset/?id=987654321</url></Content></Properties></Item></roblox>"#;
        assert_eq!(wrappedAssetId(decal, "123").as_deref(), Some("987654321"));
        assert_eq!(wrappedAssetId(decal, "987654321"), None);
        assert_eq!(wrappedAssetId(&[0x89, b'P', b'N', b'G'], "123"), None);
    }

    #[test]
    fn deliveryUrlsCarryThePlaceTheyAskFor() {
        let withPlace = deliveryUrls("123", Some("456"), "animation");
        assert_eq!(withPlace.len(), 2);
        assert!(withPlace.iter().all(|url| url.contains("id=123")));
        assert!(withPlace.iter().all(|url| url.contains("placeId=456")));
        assert!(withPlace[1].contains("serverplaceid=456"));
        assert!(withPlace[1].contains("clientInsert=1"));
        assert!(!withPlace[0].contains("serverplaceid"));
        assert!(deliveryUrls("123", Some("456"), "audio")[0].contains("expectedAssetType=Audio"));
        assert!(!deliveryUrls("123", None, "animation")[0].contains("placeId"));
    }

    #[test]
    fn errorPagesAreNeverMistakenForAssets() {
        assert!(!looksLikeAsset(
            b"<!DOCTYPE html><title>Forbidden</title>",
            "audio"
        ));
        assert!(!looksLikeAsset(
            b"{\"errors\":[{\"code\":403}]}",
            "animation"
        ));
        assert!(looksLikeAsset(
            b"<roblox!89\xff\r\n\x1a\n\x00padpadpad",
            "animation"
        ));
        assert!(looksLikeAsset(b"OggS\x00\x02padpadpadpad", "audio"));
        assert!(looksLikeAsset(b"GIF89a\x01\x00\x01\x00padpadpad", "image"));
        assert!(!looksLikeAsset(b"OggS\x00\x02padpadpadpad", "image"));
    }

    #[test]
    fn uploadShapeFollowsTheBytes() {
        assert_eq!(uploadShape("animation", b"<roblox!").0, "Animation");
        assert_eq!(uploadShape("audio", b"ID3\x04").1, "audio/mpeg");
        assert_eq!(uploadShape("audio", b"OggS").1, "audio/ogg");
        assert_eq!(uploadShape("image", &[0xff, 0xd8, 0xff]).0, "Image");
        assert_eq!(uploadShape("image", &[0xff, 0xd8, 0xff]).1, "image/jpeg");
        assert_eq!(
            uploadShape("image", &[0x89, b'P', b'N', b'G']).1,
            "image/png"
        );
    }

    #[test]
    fn studioSessionIsStablePerPlace() {
        let first = studioSession("456");
        let second = studioSession("456");
        assert_eq!(first[1].1, second[1].1);
        assert_ne!(first[1].1, studioSession("789")[1].1);
        assert!(first[2].1.contains("\"PlaceId\":456"));
    }

    #[test]
    fn cookieNormalizes() {
        assert_eq!(normalizeCookie("  abc "), ".ROBLOSECURITY=abc");
        assert_eq!(normalizeCookie(".ROBLOSECURITY=abc;"), ".ROBLOSECURITY=abc");
        assert_eq!(
            normalizeCookie("path=/; .ROBLOSECURITY=abc; secure"),
            ".ROBLOSECURITY=abc"
        );
        assert_eq!(normalizeCookie("   "), "");
    }

    #[test]
    fn scanLinesCarryCreatorAndDeduplicate() {
        let lines = vec![
            "123 - Idle - U: 42".to_owned(),
            "123 - Idle - U: 42".to_owned(),
            "789 - Run Cycle - G: 7".to_owned(),
            "55 -  - U: 1".to_owned(),
            "garbage".to_owned(),
            "abc - Nope - U: 1".to_owned(),
        ];
        let parsed = parseScanLines(&lines);

        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].creatorType, "user");
        assert_eq!(parsed[0].creatorId, "42");
        assert_eq!(parsed[1].creatorType, "group");
        assert_eq!(parsed[1].name, "Run Cycle");
        assert_eq!(parsed[2].name, "Unnamed");
    }

    #[test]
    fn fileNamesStaySafe() {
        assert_eq!(sanitizeFileName("a/b:c"), "a_b_c");
        assert_eq!(sanitizeFileName("   "), "asset");
    }

    #[test]
    fn failuresNameTheirPhase() {
        assert_eq!(
            describeFailure(Phase::Upload, "HTTP 403 Forbidden"),
            "Key cannot write assets"
        );
        assert_eq!(
            describeFailureFor(Phase::Download, "HTTP 403 Forbidden", false),
            "Private to whoever made it"
        );
        assert_eq!(
            describeFailureFor(Phase::Download, "HTTP 403 Forbidden", true),
            "Roblox refused it to this session"
        );
        assert_eq!(
            describeFailure(Phase::Upload, "HTTP 401"),
            "Open Cloud key rejected"
        );
        assert_eq!(
            describeFailure(Phase::Download, "HTTP 404"),
            "Asset unavailable"
        );
        assert_eq!(failureDetail("  HTTP 403 nope  "), "HTTP 403 nope");

        // The trail joins its steps with a middle dot, which straddles two bytes.
        let long = vec!["place 123456: 403"; 30].join(" \u{b7} ");
        let cut = failureDetail(&long);
        assert!(cut.len() <= 183);
        assert!(cut.ends_with("..."));
    }
}
