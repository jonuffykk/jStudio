<div align="center">

<img src="public/logo.png" alt="jStudio" width="88" />

# jStudio

**An AI pair programmer that sees your place in Roblox Studio, writes the Luau,
and builds the instances, plus the animation pipeline that makes every asset in
that place yours.**

Runs on your machine. No account, no server, your own API key.

</div>

---

## What it does

**Build.** Open Studio and jStudio side by side, then talk.

> _Make a platform that damages whoever steps on it, then disappears for 3 seconds._

jStudio reads the tree of your place, services, models, GUIs and the source of
every script. It answers with the complete change: the `Part` with its position
and material, and the `Script` in `ServerScriptService` with the whole Luau. Each
proposal is a card with the code in plain sight and a button. Nothing enters your
game without that click, and what you apply becomes one undo waypoint in Studio.

**Animations.** Animations only play when the account behind the experience owns
the asset. jStudio scans every `Animation` instance and every `rbxassetid` in
your scripts, re-uploads them under your account or group through Open Cloud, and
swaps the new IDs back into the place as a single undoable change. The model can
drive that pipeline too, so _the walk animation does not play_ is a sentence you
can say in the chat.

## Why it is different

**No account.** There is no jStudio signup because there is no jStudio server.
The app runs on your machine, the plugin finds it on `127.0.0.1`, and they
connect on their own.

**Your key.** Anthropic, Groq, OpenAI, OpenRouter, Ollama, or any
OpenAI-compatible endpoint. The key lives in your system credential vault and the
app talks straight to the provider.

**You review first.** Human review is not a setting, it is the architecture. The
model proposes, you read the code, you decide.

**Native Studio tools.** Turn on the MCP server built into Roblox Studio and the
model can run Luau, read the live data model, capture the viewport and insert
assets, on top of the reviewed proposals. Point it at any other MCP server too,
over a local process or streamable HTTP.

## Install

Grab a build from **Releases**.

| System  | File                                                  |
| ------- | ----------------------------------------------------- |
| Windows | `.exe` installer                                      |
| macOS   | `.dmg`, one universal build for Apple Silicon and Intel |

The macOS build is signed ad hoc rather than notarised, so the first launch needs
right click, **Open**, then **Open** again.

On first launch jStudio asks for three things: accept the terms, point at a model
provider, and install the Studio plugin with one button. After that, in Studio:
**Game Settings, Security, Allow HTTP Requests**, then click the jStudio button
in the Plugins tab.

> Roblox Studio only runs on Windows and macOS, so those are the only platforms
> jStudio ships for.

## How it works

```
┌────────────────┐         ┌──────────────────────────────┐        ┌────────────┐
│ Roblox Studio  │         │       jStudio (Tauri)        │        │  Provider  │
│                │  long   │                              │ HTTPS  │            │
│  jStudio.lua   │◄───────►│   bridge · vault · pipeline  │◄──────►│  your key  │
│  Studio MCP    │  poll   │        (Rust)                │        │            │
│                │◄───────►│   agent · UI (TypeScript)    │        └────────────┘
└────────────────┘  stdio  └──────────────────────────────┘
```

Rust owns what has to be native: the local bridge, the credential vault, every
request that carries your Roblox session, the animation pipeline and the stdio
MCP client. Everything a contributor can read and test without a Rust toolchain,
the agent, the providers, the interface, is TypeScript.

## Development

You need Node 20+, the [Rust toolchain](https://rustup.rs) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run icons
npm run dev
```

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | The real window, hot reload         |
| `npm run dev:web`   | Interface only in a browser         |
| `npm run check`     | Typecheck, lint and tests           |
| `npm run build`     | Package the app for your system     |
| `cargo test`        | Native tests, from `src-tauri`      |

## Project layout

```
app/
  lib/        agent, providers, MCP client, state, schemas, translations
  ui/         primitives and the window shell
  views/      onboarding, home, build, animations, accounts, settings
plugin/       the Studio plugin, embedded into the binary at build time
src-tauri/    bridge, vault, Roblox API, animation pipeline, stdio MCP, storage
```

Code is English and camelCase throughout, including the Rust wire format. Rust
function and module names stay snake_case because that is the language standard;
everything crossing the boundary is camelCase.

## Contributing

Issues and pull requests are welcome, small ones included. Good places to start:
new built-in skills in `app/lib/skills.ts`, more instance properties in the
plugin, and a fourth language in `app/lib/i18n.ts`.

## License and notices

[MIT](LICENSE). Independent project, **not affiliated with Roblox Corporation**.
Roblox and Roblox Studio are their trademarks.

Re-uploading assets and reading a Roblox session outside the browser are your
responsibility under the Roblox Terms of Use. Use jStudio on places and assets
you have the right to change.
