# Contributing to jStudio

Thanks for considering a contribution.

## Before opening a PR

- Open an issue first for anything beyond a trivial fix, so the approach can be agreed on before you write code.
- Keep PRs scoped to one change. Unrelated cleanup makes review slower.
- Run `npm run check` and, in `src-tauri`, `cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test`. CI runs the same commands, so a green local run is a green PR.
- Follow the existing code style: no comment that restates the code, no abstraction introduced for one call site, no `any`.

## Project layout

- `app/` — the Next.js frontend, exported statically into `out/`
  - `app/lib/` — provider clients (`llm.ts`), the agent loop (`agent.ts`), the apply router (`apply.ts`), Luau generation (`luau.ts`), MCP transport (`mcp.ts`), zod schemas (`schemas.ts`), the Tauri command surface (`ipc.ts`), the store (`state.ts`), strings (`i18n.ts`)
  - `app/views/` — one module per screen; `app/ui/` — shared primitives and the shell
- `src-tauri/src/` — the Rust side, split by responsibility: `bridge.rs` (the local HTTP bridge the plugin talks to), `mcp.rs` (stdio MCP host), `roblox.rs` (web API calls), `spoof.rs` (the animation pipeline), `store.rs`, `vault.rs`, `lib.rs` (commands and setup)
- `plugin/jStudio.server.lua` — the Studio plugin, published as a release asset and installed from the app
- `app/lib/core.test.ts` — `node --test` over the pure helpers

Keep modules roughly 50–700 lines. If one grows past that, it is usually holding two responsibilities.

## Adding a feature

- New native capability: add the function to the relevant `src-tauri/src` module, expose it as a `#[tauri::command]` in `lib.rs`, register it in `generate_handler!`, then add the matching wrapper in `app/lib/ipc.ts`.
- New agent tool: add the `ToolDef` in `app/lib/agent.ts`, handle it in `executeTool`, and add it to `mutating` if it changes the place or waits on the person.
- New UI string: add the key to all three dictionaries in `app/lib/i18n.ts` and read it with `t()` — no hard-coded copy in the markup. The test suite fails if a language is missing a key.
- New persisted setting: add it to the zod schema in `app/lib/schemas.ts` with a default, so existing installs keep loading.
- New icon: use a [Lucide](https://lucide.dev) name through `<Icon name="..." />` after registering it in `app/ui/primitives.tsx`.
- New colour or spacing value: add it as a token in `app/globals.css` instead of inlining a hex code. If the native side needs it too (window background), mirror it in `lib.rs`.

## Version and release

`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `PLUGIN_VERSION` in `plugin/jStudio.server.lua` must all carry the same version, and `CHANGELOG.md` must have a matching `## [version]` section. CI refuses to build otherwise. Do not bump the version in a feature PR — that happens when a release is cut.

## Commit / PR expectations

- Describe _why_ the change is needed, not just what changed.
- If you touch `plugin/jStudio.server.lua`, load it in Studio and confirm it connects, syncs and scans without errors.
- If you touch the updater or the version logic, be explicit about backward compatibility with existing installs.

## Reporting bugs / requesting features

Use the issue templates — they ask for the minimum needed to act on a report.

## Security issues

Do not open a public issue for a security vulnerability. See [SECURITY.md](SECURITY.md).
