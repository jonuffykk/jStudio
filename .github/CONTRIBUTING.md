# Contributing to jSpoofer

Thanks for considering a contribution.

## Before opening a PR

- Open an issue first for anything beyond a trivial fix, so the approach can be agreed on before you write code.
- Keep PRs scoped to one change. Unrelated cleanup makes review slower.
- Run `npm test` and `npm run plugin` locally — both must pass before review.
- Follow the existing code style (no semicolon-free code, no added abstractions for one-off logic, no comments explaining _what_ the code does).

## Project layout

- `main.js`, `preload.js` — entry point and the context-isolated IPC surface (`window.jspoofer`)
- `src/main/` — main process, split by responsibility: `bridge.js`, `run/`, `roblox/`, `vault.js`, `history.js`, `plugin.js`, `updater.js`, `windows.js`, `ipc.js`, `lib.js`
- `src/renderer/` — one module per screen under `views/`, shared helpers in `lib.js`, strings in `i18n.js`. Tailwind and Lucide come from a CDN, so there is no build step
- `src/plugin/plugin.lua` — the Studio plugin, packed into `dist/*.rbxmx` by `npm run plugin`
- `test/` — `node --test` suites for the pure helpers and the Studio bridge

Keep modules roughly 40–260 lines. If one grows past that, it is usually holding two responsibilities.

## Adding a feature

- New main-process capability: add the function to the relevant `src/main` module, expose it through `src/main/ipc.js`, then add the matching entry in `preload.js`.
- New UI string: add the key to all three dictionaries in `src/renderer/i18n.js` and reference it with `data-t` or `t()` — no hard-coded copy in the markup.
- New icon: use any [Lucide](https://lucide.dev) name via `<i data-lucide="name">` in markup or `icon('name')` in JS.
- New colour or spacing value: add it to `src/renderer/theme.js` instead of inlining a hex code. If the main process needs it too (splash, window background), add it to `BACKGROUND` in `src/main/windows.js`.
- New modal: use `<dialog>` — it gives focus trapping and Escape for free.

## Commit / PR expectations

- Describe _why_ the change is needed, not just what changed.
- If you touch `src/plugin/plugin.lua`, run `npm run plugin` and confirm Studio still loads the plugin without errors.
- If you touch update/version logic, be explicit about backward compatibility with existing installs.

## Reporting bugs / requesting features

Use the issue templates — they ask for the minimum info needed to act on a report (repro steps, expected vs actual, app version).

## Security issues

Do not open a public issue for a security vulnerability. See [SECURITY.md](SECURITY.md).
