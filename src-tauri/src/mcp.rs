use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::oneshot;

const PROTOCOL_VERSION: &str = "2025-06-18";
const CALL_TIMEOUT: Duration = Duration::from_secs(90);

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

struct Server {
    child: Child,
    stdin: ChildStdin,
    pending: Pending,
    nextId: AtomicU64,
}

#[derive(Default)]
pub struct McpHost {
    servers: tokio::sync::Mutex<HashMap<String, Server>>,
}

#[cfg(target_os = "windows")]
const NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
fn newestStudioMcp(root: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut found: Vec<(std::time::SystemTime, std::path::PathBuf)> = std::fs::read_dir(root)
        .ok()?
        .filter_map(|entry| {
            let binary = entry.ok()?.path().join("StudioMCP.exe");
            let stamp = binary.metadata().ok()?.modified().ok()?;
            binary.is_file().then_some((stamp, binary))
        })
        .collect();

    found.sort_by_key(|left| std::cmp::Reverse(left.0));
    found.into_iter().next().map(|(_, path)| path)
}

#[cfg(target_os = "windows")]
fn mcpBatTarget(script: &std::path::Path) -> Option<std::path::PathBuf> {
    let text = std::fs::read_to_string(script).ok()?;
    text.split('"')
        .map(std::path::PathBuf::from)
        .find(|candidate| {
            candidate
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("StudioMCP.exe"))
                && candidate.is_file()
        })
}

fn studioCommand() -> Option<(String, Vec<String>)> {
    #[cfg(target_os = "windows")]
    {
        let root = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").ok()?).join("Roblox");

        // The launcher Roblox writes is a .bat, and running it through cmd.exe flashes a console
        // window and reads as a script drop to behavioural antivirus. Go straight to the binary it
        // points at, and only fall back to the script when the layout is one we do not know.
        let binary =
            newestStudioMcp(&root.join("Versions")).or_else(|| mcpBatTarget(&root.join("mcp.bat")));

        if let Some(binary) = binary {
            return Some((binary.display().to_string(), Vec::new()));
        }

        let script = root.join("mcp.bat");
        script.exists().then(|| {
            (
                "cmd.exe".to_owned(),
                vec!["/c".to_owned(), script.display().to_string()],
            )
        })
    }

    #[cfg(target_os = "macos")]
    {
        let binary = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP";
        std::path::Path::new(binary)
            .exists()
            .then(|| (binary.to_owned(), Vec::new()))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        None
    }
}

pub fn detectStudioServer() -> Value {
    match studioCommand() {
        Some((command, args)) => json!({ "available": true, "command": command, "args": args }),
        None => json!({ "available": false, "command": "", "args": [] }),
    }
}

impl McpHost {
    pub async fn connect(
        &self,
        id: String,
        command: String,
        args: Vec<String>,
    ) -> Result<Value, String> {
        self.disconnect(&id).await;

        let (command, args) = if command == "studio" {
            studioCommand().ok_or(
                "Roblox Studio's MCP server is not installed on this machine. Update Studio and enable it under Assistant, Manage MCP Servers.",
            )?
        } else {
            (command, args)
        };

        let mut spawner = tokio::process::Command::new(&command);
        spawner
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        #[cfg(target_os = "windows")]
        spawner.creation_flags(NO_WINDOW);

        let mut child = spawner
            .spawn()
            .map_err(|error| format!("Could not start {command}: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or("The server refused a stdin pipe.")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("The server refused a stdout pipe.")?;
        let pending: Pending = Arc::default();

        let reader = pending.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let Some(id) = message.get("id").and_then(Value::as_u64) else {
                    continue;
                };
                if let Some(slot) = reader.lock().unwrap().remove(&id) {
                    let _ = slot.send(message);
                }
            }
            reader.lock().unwrap().clear();
        });

        let server = Server {
            child,
            stdin,
            pending,
            nextId: AtomicU64::new(1),
        };
        self.servers.lock().await.insert(id.clone(), server);

        let initialized = self
            .request(
                &id,
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "jStudio", "version": env!("CARGO_PKG_VERSION") },
                }),
            )
            .await;

        if let Err(error) = initialized {
            self.disconnect(&id).await;
            return Err(error);
        }

        self.notify(&id, "notifications/initialized", json!({}))
            .await?;
        let tools = self.request(&id, "tools/list", json!({})).await?;

        Ok(json!({
            "id": id,
            "tools": tools.get("tools").cloned().unwrap_or_else(|| json!([])),
        }))
    }

    pub async fn disconnect(&self, id: &str) {
        if let Some(mut server) = self.servers.lock().await.remove(id) {
            let _ = server.stdin.shutdown().await;
            let _ = server.child.kill().await;
        }
    }

    pub async fn disconnectAll(&self) {
        let ids: Vec<String> = self.servers.lock().await.keys().cloned().collect();
        for id in ids {
            self.disconnect(&id).await;
        }
    }

    async fn send(&self, id: &str, message: Value) -> Result<(), String> {
        let mut servers = self.servers.lock().await;
        let server = servers
            .get_mut(id)
            .ok_or("That MCP server is not connected.")?;
        let mut line = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
        line.push(b'\n');
        server
            .stdin
            .write_all(&line)
            .await
            .map_err(|error| format!("The MCP server closed its input: {error}"))
    }

    async fn notify(&self, id: &str, method: &str, params: Value) -> Result<(), String> {
        self.send(
            id,
            json!({ "jsonrpc": "2.0", "method": method, "params": params }),
        )
        .await
    }

    async fn request(&self, id: &str, method: &str, params: Value) -> Result<Value, String> {
        let (requestId, receiver) = {
            let mut servers = self.servers.lock().await;
            let server = servers
                .get_mut(id)
                .ok_or("That MCP server is not connected.")?;
            let requestId = server.nextId.fetch_add(1, Ordering::Relaxed);
            let (sender, receiver) = oneshot::channel();
            server.pending.lock().unwrap().insert(requestId, sender);
            (requestId, receiver)
        };

        self.send(
            id,
            json!({ "jsonrpc": "2.0", "id": requestId, "method": method, "params": params }),
        )
        .await?;

        let message = tokio::time::timeout(CALL_TIMEOUT, receiver)
            .await
            .map_err(|_| format!("{method} timed out after 90 seconds."))?
            .map_err(|_| "The MCP server stopped before answering.".to_owned())?;

        if let Some(error) = message.get("error") {
            let text = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("the server rejected the call");
            return Err(text.to_owned());
        }
        Ok(message.get("result").cloned().unwrap_or_else(|| json!({})))
    }

    pub async fn callTool(&self, id: &str, name: &str, args: Value) -> Result<String, String> {
        let result = self
            .request(id, "tools/call", json!({ "name": name, "arguments": args }))
            .await?;

        let text = result
            .get("content")
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|block| match block.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            block.get("text").and_then(Value::as_str).map(str::to_owned)
                        }
                        Some(other) => Some(format!("[{other} content]")),
                        None => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();

        if text.trim().is_empty() {
            return Ok("The tool returned nothing.".into());
        }
        Ok(text)
    }
}
