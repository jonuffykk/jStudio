<div align="center">

<img src="public/logo.png" alt="jStudio" width="88" />
# jStudio

**AI pair programmer and asset pipeline for Roblox Studio.**

Reads your open place, writes the Luau, builds the instances, and makes every
animation and sound in that place yours.

[![Download](https://img.shields.io/github/v/release/jonuffykk/jStudio?label=download&style=for-the-badge&color=6b5bd6)](https://github.com/jonuffykk/jStudio/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/jonuffykk/jStudio/total?style=for-the-badge&color=6b5bd6)](https://github.com/jonuffykk/jStudio/releases)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/4DWGwYEBz3)
[![License](https://img.shields.io/badge/license-MIT-black?style=for-the-badge)](LICENSE)

<img src="https://andersonalves.vercel.app/shots/jstudio-1.webp" alt="Build view, with a proposal open" width="820" />

</div>

## What it does

### Build

Open Studio and jStudio side by side, then say what you want.

> Make a platform that damages whoever steps on it, then disappears for 3 seconds.

jStudio reads the tree of your place: services, models, GUIs, and the source of
every script. It answers with the complete change, the `Part` with its position
and material next to the `Script` in `ServerScriptService` with the whole Luau.
Every proposal is a card with the code in plain sight and a button. Nothing
enters your game without that click, and what you apply lands as one undo
waypoint in Studio.

### Assets

An asset only behaves as yours when the account behind the experience owns it.
jStudio scans the place for what it references, animations, sounds, decals,
textures, meshes' textures, particles and interface images, plus every asset id
sitting inside your scripts. It downloads each one, re-uploads it under your
account or your group through Open Cloud, and swaps the new ids back in as a
single undoable change.

Animations, sounds, pictures and meshes share one page: a switch at the top says which
kind the scan is for, and each kind keeps its own run history. You pick what runs
before it runs, every row reports where it is while it goes, and any run can be
applied again or reverted from its history.

When an asset cannot be fetched, the row says which of the two halves refused it
and prints the trail: every place that was asked and what Roblox answered.

<div align="center">
<img src="https://andersonalves.vercel.app/shots/jstudio-2.webp" alt="Assets view during a run" width="820" />
</div>

## Why it is built this way

**No account.** There is no jStudio signup because there is no jStudio server.
The app runs on your machine, the plugin finds it on `127.0.0.1`, and the two
connect on their own.

**Your key.** Anthropic, OpenAI, B.AI, Groq, OpenRouter, Ollama, or any
OpenAI-compatible endpoint. The key lives in your system credential vault and
the app talks straight to the provider.

**You review first.** Human review is the architecture, not a setting. The model
proposes, you read the code, you decide.

**Native Studio tools.** Turn on the MCP server built into Roblox Studio and the
model can run Luau, read the live data model, capture the viewport, and insert
assets, on top of the reviewed proposals. Point it at any other MCP server too,
over a local process or streamable HTTP.

## Install

Grab a build from [Releases](https://github.com/jonuffykk/jStudio/releases/latest).

| System  | File                                                    |
| ------- | ------------------------------------------------------- |
| Windows | `.exe` installer                                        |
| macOS   | `.dmg`, one universal build for Apple Silicon and Intel |

The macOS build is signed ad hoc rather than notarised, so the first launch
needs right click, **Open**, then **Open** again.

First launch asks what you came for, AI or assets, and sets up only that. Then,
in Studio: **Game Settings, Security, Allow HTTP Requests**, and click the
jStudio button in the Plugins tab.

> Roblox Studio runs on Windows and macOS only, so those are the platforms
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
request that carries your Roblox session, the asset pipeline, and the stdio MCP
client. Everything a contributor can read and test without a Rust toolchain, the
agent, the providers, the interface, is TypeScript.

## Development

You need Node 20+, the [Rust toolchain](https://rustup.rs), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run icons
npm run dev
```

| Command           | What it does                    |
| ----------------- | ------------------------------- |
| `npm run dev`     | The real window, hot reload     |
| `npm run dev:web` | Interface only, in a browser    |
| `npm run check`   | Typecheck, lint, and tests      |
| `npm run build`   | Package the app for your system |
| `cargo test`      | Native tests, from `src-tauri`  |

## Project layout

```
app/
  lib/        agent, providers, MCP client, state, schemas, translations,
              host and network helpers
  ui/         primitives and the window shell
  views/      onboarding, home, build, assets, accounts, settings
plugin/       the Studio plugin, embedded into the binary at build time
src-tauri/    bridge, vault, Roblox API, asset pipeline, stdio MCP, storage
```

Code is English and camelCase throughout, including the Rust wire format. Rust
function and module names stay snake_case because that is the language standard;
everything crossing the boundary is camelCase.

## Contributing

Issues and pull requests are welcome, small ones included. Good places to start:
new built-in skills in `app/lib/skills.ts`, more instance properties in the
plugin, and a fourth language in `app/lib/i18n.ts`.

Questions, bug reports, and builds in progress live in
[Discord](https://discord.gg/4DWGwYEBz3).

## License and notices

[MIT](LICENSE). Independent project, **not affiliated with Roblox Corporation**.
Roblox and Roblox Studio are their trademarks.

Re-uploading assets and reading a Roblox session outside the browser are your
responsibility under the Roblox Terms of Use. Use jStudio on places and assets
you have the right to change.
