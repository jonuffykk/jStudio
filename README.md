# jSpoofer

Desktop utility for re-uploading Roblox animation assets. It pairs with a Studio plugin over a local bridge, so scanning a place, re-uploading its animations and swapping every ID back in happens without leaving the app.

[![Latest Release](https://img.shields.io/github/v/release/jonuffykk/jSpoofer)](https://github.com/jonuffykk/jSpoofer/releases/latest)
[![Discord](https://img.shields.io/discord/128880573?label=Discord&color=5865F2)](https://discord.gg/CNSZssFz23)

## Download

[github.com/jonuffykk/jSpoofer/releases](https://github.com/jonuffykk/jSpoofer/releases/latest) — Windows portable, no installation required.

## Usage

1. Open **Accounts** and add your `.ROBLOSECURITY` cookie plus an Open Cloud API key with **Read & Write Assets**.
2. Open **Settings → Studio Plugin → Install Plugin**, then restart Roblox Studio if it is already running.
3. With the place open in Studio, the Home screen shows **Studio connected**.
4. Press **Run Spoofer**. The plugin streams every animation reference it finds; the app downloads and re-uploads each one under your account or a group.
5. Replacement IDs are pushed straight back to Studio and applied as a single undoable change.

Select instances in Studio to get a **Scan Selected** shortcut that limits the run to that subtree.

## Features

- Live Studio bridge — scanning, progress and ID replacement without copy-pasting
- Scans `Animation` instances and `LuaSourceContainer` sources for full coverage
- Auto-naming from the instance or variable name instead of the marketplace title
- Credentials stored encrypted through the OS keychain (`safeStorage`), never in the renderer
- Multi-account switching from the account modal, group uploads with live permission checks
- The Run screen names the next thing standing between you and a working run, with a button that does it
- Cached ID mappings, ownership detection and an automatic retry pass for failures
- Adaptive rate-limit handling with per-asset cooldown
- Download-only mode, configurable concurrency, retries and Place ID override
- Run history, exportable logs and ID mappings
- Checksum-verified self-update

## Development

```bash
npm install
npm run plugin   # build dist/jSpoofer-v<version>.rbxmx
npm start        # launch the app
npm test         # unit and bridge tests
npm run build    # package the portable Windows binary
```

### Layout

| Path | What lives there |
| --- | --- |
| `main.js` | Entry point: single-instance lock, data migration, boot order |
| `preload.js` | The whole IPC surface, exposed to the page as `window.jspoofer` |
| `src/main/bridge.js` | Local HTTP server the Studio plugin polls |
| `src/main/run/` | `pipeline.js` validates and orchestrates a run, `worker.js` handles one animation |
| `src/main/roblox/` | `api.js` (parsing, users, groups, places) and `assets.js` (download, upload, rate limits) |
| `src/main/vault.js` | Credentials, encrypted through the OS keychain |
| `src/main/history.js` | ID cache and run history on disk |
| `src/main/lib.js` | Retry, semaphore, abort helpers and atomic JSON writes |
| `src/renderer/views/` | One module per screen — home, console, accounts, settings, history |
| `src/renderer/lib.js` | DOM helpers, saved preferences, shared state and the status bar |
| `src/plugin/plugin.lua` | The Studio plugin, packed into `dist/*.rbxmx` by `npm run plugin` |

## Links

- [Discord](https://discord.gg/qMrJHxnS9T)
- [Roblox Profile](https://www.roblox.com/users/228880573/profile)
- [GitHub](https://github.com/jonuffykk)

## Tech

Electron · Tailwind CSS · Roblox Open Cloud API · Luau plugin
