use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Serialize;
use serde_json::{json, Value};

use crate::bridge::nowMs;

const USER_AGENT: &str = "RobloxStudio/WinInet";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const UPLOAD_POLL_ATTEMPTS: u32 = 30;
const RATE_LIMIT_ATTEMPTS: u32 = 4;

/// Public places that still serve asset locations when the creator's own games cannot be listed,
/// which is the normal case for group assets and for users with no published game.
const FALLBACK_PLACE_IDS: [&str; 4] = ["99840799534728", "606849621", "155615604", "5704517949"];

static rateLimitUntil: AtomicU64 = AtomicU64::new(0);

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

pub fn classifyError(raw: &str) -> &'static str {
    let lower = raw.to_lowercase();
    if lower.contains("401") || lower.contains("authentication") {
        "Invalid session"
    } else if lower.contains("api key") || lower.contains("apikey") {
        "Invalid API key"
    } else if lower.contains("403") || lower.contains("permission") {
        "No permission"
    } else if lower.contains("429") || lower.contains("rate limit") {
        "Rate limited"
    } else if lower.contains("404") || lower.contains("moderated") {
        "Asset unavailable"
    } else if lower.contains("timeout") || lower.contains("connect") || lower.contains("dns") {
        "Network failure"
    } else {
        "Unknown"
    }
}

/// The plugin has already confirmed each id is an Animation and resolved its creator through
/// MarketplaceService, so a line arrives as `id - name - U: creatorId`. Doing it in Studio costs
/// nothing and spares us one rate limited web call per asset.
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

    let response = client
        .get(url)
        .header("Cookie", header)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} from {url}", response.status()));
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

    if !creatorId.is_empty() {
        let base = if creatorType == "group" {
            format!("https://games.roblox.com/v2/groups/{creatorId}/games?limit=50")
        } else {
            format!("https://games.roblox.com/v2/users/{creatorId}/games?sortOrder=Asc&limit=50")
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

    // Without a place that can vouch for the asset the batch endpoint refuses anything the account
    // does not own, which is every group animation. The fallbacks keep that path open.
    for id in FALLBACK_PLACE_IDS {
        if !ids.iter().any(|known| known == id) {
            ids.push(id.to_owned());
        }
    }
    ids
}

pub async fn resolveDownloadUrl(
    client: &Client,
    assetId: &str,
    placeIds: &[String],
    cookie: &str,
) -> String {
    let header = normalizeCookie(cookie);

    for placeId in placeIds {
        let response = client
            .post("https://assetdelivery.roblox.com/v2/assets/batch")
            .header("Cookie", &header)
            .header("Roblox-Place-Id", placeId)
            .json(&json!([{
                "requestId": assetId,
                "assetType": "Animation",
                "assetId": assetId,
            }]))
            .send()
            .await;

        let Ok(response) = response else { continue };
        if !response.status().is_success() {
            continue;
        }

        if let Ok(body) = response.json::<Value>().await {
            if let Some(location) = body
                .pointer("/0/locations/0/location")
                .and_then(Value::as_str)
            {
                return location.to_owned();
            }
        }
    }

    format!("https://assetdelivery.roblox.com/v1/asset/?id={assetId}")
}

pub async fn downloadAsset(client: &Client, url: &str, cookie: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .header("Cookie", normalizeCookie(cookie))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("The asset came back empty.".into());
    }
    Ok(bytes.to_vec())
}

pub fn cooldownRemainingMs() -> u64 {
    rateLimitUntil
        .load(Ordering::Relaxed)
        .saturating_sub(nowMs())
}

fn holdRateLimit(seconds: u64) {
    let until = nowMs() + seconds.clamp(1, 120) * 1000;
    rateLimitUntil.fetch_max(until, Ordering::Relaxed);
}

pub async fn awaitCooldown() {
    loop {
        let remaining = cooldownRemainingMs();
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

pub async fn uploadAnimation(
    client: &Client,
    apiKey: &str,
    userId: &str,
    groupId: Option<&str>,
    name: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if apiKey.is_empty() {
        return Err("This account has no Open Cloud API key.".into());
    }

    let creator = match groupId {
        Some(id) => json!({ "groupId": id }),
        None => json!({ "userId": userId }),
    };
    let request = json!({
        "assetType": "Animation",
        "displayName": name,
        "description": "Uploaded by jStudio",
        "creationContext": { "creator": creator },
    })
    .to_string();

    let mut body = json!({});
    for attempt in 1..=RATE_LIMIT_ATTEMPTS {
        awaitCooldown().await;

        let form = reqwest::multipart::Form::new()
            .text("request", request.clone())
            .part(
                "fileContent",
                reqwest::multipart::Part::bytes(bytes.clone())
                    .file_name(format!("{}.rbxm", sanitizeFileName(name)))
                    .mime_str("model/x-rbxm")
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
            holdRateLimit(retryAfter);
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
    // Roblox returns either a bare operation id or a full `assets/v1/operations/...` path.
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
            holdRateLimit(15);
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

/// Best effort check of an Open Cloud key before the person leaves the setup screen.
///
/// Roblox has no endpoint that reports what a key is allowed to do, so this asks
/// for an asset that cannot exist and reads the refusal: 401 means the key itself
/// is wrong, 403 means the key is real but carries no `asset:read`, and anything
/// else means the key was accepted and the request only failed on the fake id.
/// `asset:write` cannot be probed without creating an asset, so it is never
/// claimed here. An unreachable API is reported as unknown, never as a failure.
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
    fn errorsClassify() {
        assert_eq!(classifyError("HTTP 429 rate limit"), "Rate limited");
        assert_eq!(classifyError("HTTP 403 permission"), "No permission");
        assert_eq!(classifyError("weird"), "Unknown");
    }
}
