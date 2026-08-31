# Changelog

## [1.0.6]

### The agent talks less and works more

- The prompt no longer asks for a line before and a line after every call. That instruction, with one call per turn, was most of the monologue: the model announced a step, spent a turn on it, announced the next. It now writes a short line only before something genuinely slow, and one report at the end.
- Calls that are already known to be needed go out together instead of one per round trip. Reading three scripts, or a Part and the Script that drives it, is one turn now.
- A repeated read is answered from what the conversation already holds, whether the repeat came in the same turn or three turns later. Tools that report the live moment, like the console, the viewport or running code, are never reused.
- A turn where nothing new was called gets one direct nudge; a second one ends the loop and asks for the reply. It used to circle until the turn budget ran out.
- Questions are only asked when the answer would change what gets built and no sensible default exists.
- The context meter counts in millions past a million and drops the trailing zero, so the budget reads 9.5k / 1M instead of 9.5k / 1000.0k, and a slice reads 8k instead of 8.0k.

### Chats

- A running chat is no longer tied to the one on screen. Open another chat, or start a new one, and the answer carries on in the background instead of being cancelled; the sidebar spins on whichever chat is still working.
- Messages, queued sends and applied proposals stay in the conversation they belong to. Switching mid answer used to drop the run's tail into whatever chat you had opened.
- The token count is per conversation. It used to carry the previous chat's numbers into every other one, because only starting a new chat reset it.
- Sending while another chat answers queues the message under that chat and starts it as soon as the other finishes, with a line saying so, instead of silently doing nothing.
- Deleting a chat that is still answering stops it, and it no longer reappears when the run saves.
- Forking a chat now switches to the fork properly rather than leaving the app writing to the old one.

### Animations

- The scanner now runs the jSpoofer pipeline: every id is confirmed to be an animation through MarketplaceService before it is touched, so decals, sounds and images no longer enter the run as animations and fail there.
- Bare numeric ids in scripts (`AnimationId = 1234567890`) are found and swapped, not just `rbxassetid://` ones. Digits glued to an identifier or sitting inside a decimal are left alone.
- The creator of each asset comes back from Studio with the scan instead of one rate limited web call per asset, which is what broke group runs.
- Group assets download again: when a creator's own games cannot be listed, the run falls back to public places that can vouch for the asset instead of giving up.
- Uploads retry a rate limit up to four times with the cooldown Roblox asks for, rather than failing on the first 429.
- Uploads can be named after the instance or the variable holding the id, so a run produces `Roll` and `Slide Left` instead of a wall of `Animation`.
- Replacement rewrites bare ids in scripts too, preserving the surrounding formatting, and stays one undo step.

### The agent

- Every tool call announces itself before it runs and reports how it ended. A slow one, like generating a mesh, now reads as work in progress instead of silence.
- Approved changes go through the Roblox Studio MCP server when it is connected, which reaches the whole Instance API, and through the jStudio plugin when it is not. Both stay live and cover each other.
- A change is refused, with a clear reason, when neither the MCP server nor the plugin can reach the place.
- Chat names are generated on a low reasoning budget with a longer deadline. A thinking model used to spend the whole allowance before writing a word, so the chat was named after the message instead.

### Windows

- Studio's MCP server is launched from its executable rather than through `cmd.exe` and the `mcp.bat` shim, so no console window flashes open and the app stops looking like a script dropper to behavioural antivirus.
- The window centres itself on the active screen before the splash appears.

### Project

- Tests run on Node's own test runner. Vitest is gone, and with it 92 packages from the install.
- Contribution, security, issue and pull request templates.

## [1.0.5]

### First run and shell

- A splash screen greets you on launch, with the logo and the theme you picked, and it stays until the app has actually finished loading.
- First launch walks through one gated setup: pick a model provider and its key, then sign in to Roblox and add the Open Cloud key. Nothing else opens until both are done.
- Roblox sign in offers the real login window or a pasted session cookie, side by side, with the instructions for each.
- The sidebar carries Home, Build and Animations. Your Roblox avatar sits at the bottom and opens a menu with Settings, Accounts and Leave.
- Accounts and Settings are modals now, reachable from anywhere instead of being screens you navigate away to.
- No control paints a purple border any more. Focus and selection read as neutral, and accent colour is left to things that are actually accented.

### Accounts

- Leave signs you out of the Roblox account, which is what it always looked like it did. It asks first and says what leaves the vault.
- Removing your last account closes the modal and hands you to the first run screen instead of stranding you in the add account step.
- Signing in shows one waiting panel while the Roblox window is open, with Back held until it closes, so the two screens cannot fight.
- The Open Cloud key and the session cookie both save from an icon beside the field, on first run and in the modal alike.

### Small

- An edited message no longer counts its versions in the corner.
- The page ships a first paint rule and the boot script paints the root before anything else runs, so the theme cannot flicker on the way in.

### Launch

- The window opens hidden, takes the tone of the theme it was left in, and only then appears. No more black, grey, white on the way in.
- The page paints its own background from the first frame, so the webview never shows through.
- The splash was rebuilt on the same type and spacing as the rest of the app.

### The meter measures the window

- It reads what is in the context right now, not what the session has spent. A long chat could show a hundred per cent of a window it was nowhere near filling.
- Spent input and output moved to their own line, named for what they are.
- The context window is a million tokens, and a config saved with the old two hundred thousand is brought up on the next launch.

### Asking and planning happen at the composer

- A question no longer sits in the transcript. It docks above the input as a compact panel: the question on top, numbered options underneath, a pager when there is more than one, and a row that says you can simply write the answer instead. Picking an option moves to the next question and the last pick sends them all.
- A plan docks the same way, its steps numbered, with Approve on the right.
- Writing in the composer answers directly and closes the panel, and the placeholder says so while it is open.
- Skip closes it without answering.

### Elsewhere

- The context window is a million tokens by default and no longer takes a row in Settings.
- The library import lost its explainer line.
- Expand packs the facts across the line instead of leaving the first row half empty.

### Memory

- Saved facts get ids that cannot collide, even when five land in the same millisecond, and a duplicate that slipped in earlier is dropped on the next launch. That was the React key warning.
- Expand lays the facts out as highlighted text that flows across the line and wraps, so a short fact no longer costs a whole row.

### Skills

- Each skill carries its own switch for loading from the start of a chat. Everything else stays available and counts the moment you name it with a slash.
- The section lost its blurb, and the library lost the five skills that ship installed. It lists servers and whatever you import.
- Importing a URL that answers with a page instead of JSON now says so, rather than failing inside the stream reader.

### Compress

- `/goal` is gone. `/compress` stays, and it behaves like a turn: the command lands in the chat, the summary streams in under it with the usual working line, and the two of them are what the model carries on from.
- Nothing is deleted. The older messages stay on screen under a Summarised above rule; they simply leave the context, so the transcript is still yours to scroll.

### Elsewhere

- The Studio row on Home no longer prints the place id.
- Chat titles are two words, three at the very most.

### Context, read properly

- The pill is the ring alone. Opening it breaks the window down the way a context meter should: messages, place tree, tools, skills, memory and free space, each with its share of the limit, and the in and out totals under them.
- The `/compress` nudge only appears once the window is actually filling.

### Skills when you want them

- An enabled skill is available, not loaded. It counts when you name it with a slash, and the model is told which ones exist so it can point at the one that would settle a question. A switch in Extensions loads them all from the start again.
- `/compress` and `/goal` highlight in the composer exactly like a skill does.

### Fixes and polish

- Expand is a page inside Settings now, not a second modal over the first, and Back returns to the tab.
- The saved facts read as a queue of highlighted lines in one scrolling frame instead of a list of cards.
- A fact the model saves lands in the timeline where it happened, as one compact line, instead of a pile of chips at the end.
- Chat and run rows keep their fill while the menu button is hovered, and the button highlights on its own.
- Home reports the last six and the last twenty four hours from a real hourly trail, and the Studio row drops the place id.
- The Open Cloud key saves from an icon beside the link, in one row.
- Run, pause and stop are the same three icons everywhere.
- Defaults were revisited: two upload retries, twelve tool turns per message, and learning from other chats on.

### Two commands, after Claude Code

- `/compress [focus]` summarises the conversation into working notes and starts again from them, freeing the context. Pass a focus and the summary keeps that in view.
- `/goal <what>` pins what the chat is working towards; the model carries it across turns and says when it is met. `/goal` alone reports it, and `clear`, `stop`, `off`, `reset`, `none` or `cancel` removes it. The goal rides above the composer and follows the chat, branches included.
- Both show up in the slash menu next to the skills.

### Context you can read

- The meter reports a percentage of a context window you set in Settings, turns amber past seventy and red past ninety, and points at `/compress` when it does.

### Nothing gets lost

- A chat that is still writing is saved as it writes, and opening it again while it runs no longer replaces the live answer with the stored one.
- Memory can learn from your other chats: an option feeds the titles and openings of recent conversations to the model for context and habits.
- The model is told to hold one language for a whole answer, including the short lines between tool calls.
- A stream that dies mid turn no longer kills the answer. It records the failure and closes with the report.
- A specialist that comes back empty says so in its own block instead of sitting blank.

### Fixes

- Memory shows one row with a count and an Expand view; the facts live there, read only, with a delete on each.
- A run opens on everything it touched, with its status, not only on what changed, so a pass where everything was already yours reads correctly.
- Run rows hover exactly like chat rows.
- The Usage panel fills its card instead of leaving a gap under the week line.
- The command bar is centred on the window rather than on the space left over.
- Stop is a stop, not an empty checkbox.

### Orchestration you can watch

- A delegated agent appears in the timeline the moment it starts, at the point where it was called, and its answer streams into that block while it writes. No more three cards stacked silently at the end.
- The model is told to call a reading tool once. A repeated read with the same arguments in the same turn comes back with what it already returned instead of running again.
- remember takes every fact in one call, and askQuestion carries every open question at once.
- Questions render as a card with the options and a text box for each, so an answer that is not on the list still fits. Approving a plan or sending an answer disables the card, so a second click cannot fire.

### Chat

- Switching to Home or Animations and back no longer loses a running answer. Every view stays mounted, so the reply keeps writing and every step is still there when you return.
- Thinking and Working stopped repeating each other. One live line at a time.
- The reasoning panel folds and unfolds while it is still writing.
- Timestamps read as time passed, sit after the actions, and show the full date on hover.
- The row menu blends into the row it belongs to instead of painting its own box.
- The finished answer only raises a notification when the chat is not the view you are looking at.

### Animations

- Run now scans first and lists what it found. Uncheck what should stay, then start, and only the checked ones are touched.
- A run opens on its log, with Apply again and Revert side by side and the target it uploaded to.
- Times read as the hour with the full date on hover.

### Settings and shell

- Memory has an Expand view: every fact in one scrollable box, one per line, delete a line to forget it.
- The language picker carries a flag and sits at its own width.
- Ctrl+I for the model, Ctrl+M cycles the apply mode, Ctrl+E cycles the effort, all of them also in Ctrl+K.
- The window buttons keep their place on the right at every size, and they no longer draw at the wrong scale.
- The terms step is gone from first run; the two remaining steps carry the same cards as the rest of the app, and the sign-in window opens centred and resizable.
- Home lines up on one three column grid, so the recent lists and the update panel share their edges.

### Agents that behave like agents

- The specialists no longer run on every message and dump three opinions on a hello. The model delegates to them, by name, when a request has a side worth a second read, at most three at a time, and their note comes back folded into the answer as an artifact.
- The model can search the web and read a page when it needs a current API, a rate limit or a document it does not know.
- Plan mode produces a real plan: a titled, numbered card that waits for your approval, and only then does the work, step by step.
- A turn that runs out of tool turns, or ends without a word, now closes with a short report of what landed and what is left. It no longer stops mid air.
- Facts the model saves show up under the answer as memory chips, and it knows the app well enough to answer where a setting lives.

### Chat

- The chevron menu on a chat row replaced the settings gear, and rename, pin, archive and delete all sit under it.
- Branching asks first and names the result after the chat it came from.
- The Continue button is gone; the model carries itself to the end of the thought.
- Skills are slugs now, like /animation-hygiene. Type one inside a sentence and it highlights in place, no chip, no lost text.

### Shell

- Ctrl+B for the rail, Ctrl+1 to Ctrl+3 for the three views, Ctrl+, for settings, on top of the ones that were already there.
- Back and forward remember which chat you were in and grey out at the ends of the trail.
- The context menu, F5, F12 and the browser shortcuts are off. It reads as an app, not a page.
- Every icon comes from lucide now, at one weight and one size.

### Animations

- Runs carry a short name, group by day, and take a rename, a pin, an archive and a delete like chats do. Clear history moved out of the rail.
- Settings became a modal behind the slider button next to the plus, with the advanced options open where you can see them.
- A pass that replaced nothing leaves no run behind.
- The header reads Animations, then the run, in the same breadcrumb as Build.

### Home and settings

- The place row says the place name, its id and whether the tree is still arriving.
- Updates check themselves; the row only speaks up when there is something to install.
- The recent lists hold three, at a fixed height, so the page stops jumping.
- Settings was rebuilt on one section, one card, one row per setting. Extensions keeps a single reconnect for all servers.

### Reading what the model is doing

- The answer is one ordered timeline now. A thought panel, then the line the model wrote, then the next thought panel under it, in the order they actually happened, instead of every thought stacked at the top and the whole reply glued together at the bottom.
- A shimmering Working line runs whenever the model is between steps, so a long tool call never looks like a freeze.
- Scrolling up during a reply stays up. The view only follows the stream while you are already at the bottom.
- An MCP step names the tool once and the server once, instead of printing the server twice.

### Fewer conflicts, fewer clicks

- Automatic mode applies a proposal the moment it arrives. It no longer waited for the whole turn and then asked.
- createInstance refuses script classes and says to use writeScript, which is what produced empty scripts.
- With the Studio MCP connected, reading goes through the MCP and every change still goes through a proposal you review. The two no longer race.
- Two proposals for the same path are two cards again rather than one React key collision.

### Settings

- Memory lost the manual add box, the divider and the subtitle. Facts are chips you can read at a glance and remove on hover, the way attachments read.
- Model splits into Endpoint and Behaviour, and apply mode sits there with Plan alongside Manual and Automatic.
- Usage charts input against output, per card and per day, with the busiest day called out.
- Agents ship pre written: Reviewer, Security, Performance and Game design. Turn on up to three, point any of them at another model, edit the role. Nothing to add or delete.
- Every MCP row is the same row with the same reconnect button. The on and off switches are gone, and so are the Filesystem and Sequential Thinking entries.

### Shell and home

- The rail is icons only.
- Toasts slide in and lean toward the cursor.
- The plugin installs itself when it is missing or behind, and Home carries one Updates panel for the app and the plugin together, plus a usage panel with the week at a glance.
- Cards, rows and list entries all react to the cursor, and finishing an answer plays a chime and raises a notification when the window is in the background.

### Animations

- Runs moved into the left rail, grouped by day like the chat list, and open into a full page with their replacements.
- Settings became a tab next to Assets.

### Agents, memory and usage

- Up to three agents can work on one answer together. Each carries its own role and model, runs alongside the main reply, and leaves its notes as an artifact you can fold open under the message.
- The memory system was rebuilt after how Claude, Codex and ChatGPT do it. The model writes facts itself as it works, and Settings lists them so you can edit or drop any one of them.
- A usage tab charts tokens and cost by day, week and month. It reports what you spent, it does not cap anything.
- The model can ask you a question when a request is incomplete, with the likely answers as buttons. A Continue action picks an answer back up where it stopped.

### Animations

- Group upload works again. The uploader sends the model as model/x-rbxm, which is what Open Cloud expects for an animation; the previous generic type was rejected.
- The Animations rail matches the chat sidebar, and each run is a single row that expands in place to show its replacements and to apply or revert.

### Chat and settings

- The thinking line no longer opens an empty dropdown, and it keeps a soft pulse while the model is still working.
- Mode and effort share one dropdown style, and attachments sit inside the composer instead of over it.
- Every MCP row, built in or your own, carries the same switch and connects or disconnects on the spot.
- A minimise button sits next to the back arrow, and finished responses raise a notification.
- The terms page is gone, along with the descriptions that repeated what the control above already said.

### Accounts

- The account manager lists every account with its avatar, shows which one is active, and adds another without leaving the modal.
- Each account carries its own Open Cloud key, edited inline on its own row. Removing an account clears both its session and its key from the vault.

### Settings

- Split into Model, Extensions and App.
- The model list loads by itself when you open the tab or change provider, groups models by family, and marks the free ones.
- A custom provider keeps its base URL and model across restarts.
- The Studio plugin and the update check moved to the Home quick actions, where they belong. jStudio also checks for an update on its own at startup.
- Roblox Studio's MCP server now sits inside the MCP list with the rest, showing whether it is connected and how many tools it exposes.
- A library of curated MCP servers and skills ships with the app, and any URL serving a jStudio manifest can be imported next to it.
- Reasoning effort and apply mode are settings, and both are also one click away in the composer.

### Build

- Conversations live in a sidebar, can be renamed by double clicking, and name themselves from your first message.
- Reasoning is stored with the conversation, so reopening a chat no longer loses it.
- Thinking and reasoning are one block that expands while the model works and collapses when it is done.
- Every tool call the model makes appears as a step inside that block, named and attributed to its source, so a play test driven through the Studio MCP is visible instead of silent.
- Images can be pasted, dropped or attached, and are sent to providers that accept them.
- Typing a slash offers your skills and pins the one you choose to that single message.
- The composer carries the model picker, the apply mode, the reasoning effort and the running token count.

### Animations

- The plugin no longer asks Roblox for the creator of every asset, which was rate limited inside Studio and silently poisoned most runs with a wrong creator and a failed download. jStudio resolves the creator itself, authenticated, and caches it.
- Every asset shows as a live row with its own state, from queued through downloading and uploading to replaced or failed with a reason.
- Runs open in place to show every id that was replaced, from the Runs tab or from the Home list.

### Legal

- A Legal screen carries the full terms and privacy policy, out of Settings and into its own place, in all three languages.

### Chat, second pass

- Messages carry a timestamp, a copy button, and a branch button that opens the conversation up to that point as a new chat.
- Your messages can be edited in place. The earlier text is kept and the counter shows which version you are on.
- The last answer can be retried without retyping anything.
- Typing while the model is still working queues the message instead of dropping it. Queued messages show as outlines and go out in order.
- Send and stop are icons now, and Enter versus Ctrl and Enter is a setting.
- Reasoning renders as markdown, so headings, lists and code inside it read properly.
- The composer is taller and the transcript has more room to breathe.
- The model picker only lists models of the provider you are on. Switching provider stays in Settings, where it belongs.
- The header carries a real token meter: total, input and output, with a two segment bar.

### Chat list

- Titles are short, three words at most, named after the subject rather than the action.
- One settings icon per row opens rename, pin, archive and delete.
- Pinned chats sit at the top, archived ones collapse into their own section.

### Elsewhere

- The title bar no longer repeats the Studio and MCP state. The status bar already carried it.
- Home is one system card: Studio, account, model, plugin with both versions and an install button, and the update row with its own check and install. The two big actions sit above it.
- Leaving the Animations screen works. Clearing the focused run was resetting the view back to Animations on the way out.
- Animations only offers groups the Open Cloud key can actually upload for, checked at load, and your own account reads as My profile.
- The window no longer flashes dark before switching to a light theme. The boot script reads the stored theme, falls back to the system preference, and the theme is written on every load rather than only when it changes.
- Focus and selection use a soft neutral tone instead of the hard outline the previous pass left behind.
- The sidebar is wider so the icons and labels sit comfortably.
- Settings gained an App tab worth opening: theme, language, Enter behaviour, reasoning visibility, the Studio MCP toggle, and buttons to clear chats or run history. Reasoning effort and apply mode sit on their own rows instead of floating.

### Polish pass

- MCP servers all render as the same row. The Roblox Studio one is no longer a special case, and its toggle sits where the other rows keep their actions.
- Adding or removing a server only touches that server. It used to tear down and rebuild every connection.
- The model chooser is always a dropdown, in Settings and in the composer, backed by a per provider cache so it opens instantly instead of showing a text field while it loads.
- The chat row menu is anchored to the button and rendered above the scroll area, so it opens in the right place and can actually be clicked. It flips upward near the bottom edge.
- Animations lists only the groups Roblox says you can manage, asked through the canmanage endpoint instead of guessing from an upload probe, and the role is gone from the label. Your own account reads as My profile.
- The Open Cloud probe command went with it. Nothing called it any more.
- Adding an account turns the modal into a two step sign in: Roblox window or session cookie, then the Open Cloud key, then back to the list.
- Reasoning and tool calls share one ordered timeline, so a pause and a new train of thought appear below the tool that caused it, in the order it happened.
- The token counter is a ring next to the send button, and reasoning effort is a three stop slider from faster to smarter.
- Every page carries the same header rail at the same height, so the chat sidebar, the animations column and the page titles line up.
- Clicking a field no longer draws a box around it. Focus is a border tint, and only buttons keep a ring.
- The App tab no longer repeats the Studio MCP toggle that already lives under Extensions.
- The Legal page lost its footer.
- The sidebar is narrower again with tighter labels, and the selection scope reads Selection only.

### The interleaving bug

- Every message was starting two agent runs at once. `reactStrictMode` double invokes state updater functions, and the send, edit, retry and queue paths all launched the run from inside one. Two streams wrote into the same reply, character by character, which is why answers came out scrambled, repeated themselves and drifted between languages. The transcript is now held in a ref and no run is ever started from inside an updater.
- A run also refuses to start while another is in flight, so a stray double click cannot reproduce it.

### Chat

- Conversations group by date the way a chat app does it: pinned first with a real pin, then today, yesterday, the previous seven days and older.
- Apply mode and reasoning effort are dropdowns that show the current value as text. Mode gained a third option, Plan first, which makes the model write a numbered plan and stop until you approve it.
- Ctrl+M opens the model picker, Ctrl+N starts a chat, Ctrl+Z and Ctrl+Y walk back and forward through the pages you visited.
- The token ring opens on click with the model, input, output and total.
- Deleting a chat asks first.

### Window

- The title bar carries back and forward buttons and a search field that opens the command palette, the way an editor does it.
- The palette is grouped into pages, actions and chats, and searches your conversations by name.
- Toasts sit below the palette instead of over it.
- The status bar at the bottom is gone. It repeated what the pages already say.

### Feel

- Every shadow is gone. Depth comes from the border and the surface tone.
- Hover states are consistent across rows, cards, menu items and toasts.
- Short sound effects on send, finish and failure, off with one toggle.
- Skeletons stand in while the chat list, the model list and the home cards load.

### Memory

- Custom instructions go out with every message in every chat.
- A list of short facts the model keeps across conversations, editable in Settings.

### Plugin

- The toolbar buttons use the jStudio icon.

### Fixes

- Test binaries link against Common Controls 6.0, the same activation context `tauri-build` gives the app binary. Without it the loader resolved `comctl32.dll` to the v5 copy in System32 and every test run died on startup with STATUS_ENTRYPOINT_NOT_FOUND.
- The crate builds as a plain rlib. The staticlib and cdylib types exist only for iOS and Android, which jStudio does not target.
- The animation run settings derive `Debug`, which the pipeline tests need to report a failed `resolve` call.
- The place ID cache releases its lock before the network call instead of around it, and JSON fallbacks are built only when they are needed.
- Line endings are LF everywhere and `.gitattributes` keeps them that way.
- Release announcements on Discord carry the jStudio logo again.
- Version lock covers the plugin too, so a stale `PLUGIN_VERSION` cannot ship.

## [1.0.2]

- Formatted the whole Rust crate the way rustfmt wants it, so `cargo fmt --check` passes on CI instead of failing the Rust job.
- The animation run settings derive `Debug`, which the pipeline tests need to report a failed `resolve` call. Without it the test target did not compile.
- Test binaries now link against Common Controls 6.0, the same activation context `tauri-build` gives the app binary. Without it the loader resolved `comctl32.dll` to the v5 copy in System32, which does not export `TaskDialogIndirect` or the window subclass helpers the dialog and menu code imports, and every test run died on startup with STATUS_ENTRYPOINT_NOT_FOUND.
- The crate builds as a plain rlib. The staticlib and cdylib types exist only for iOS and Android, which jStudio does not target.
- The place ID cache releases its lock before the network call instead of around it, and the JSON fallbacks are built only when they are actually needed.
- Line endings are LF everywhere and `.gitattributes` keeps them that way, so the same file never looks different to the Linux and Windows runners.
- Removed the two dead functions clippy would have rejected on `-D warnings`: an unused staging folder helper and an unused tree accessor on the bridge.
- Release announcements on Discord carry the jStudio logo again.
- Version lock now covers the plugin too, so a stale `PLUGIN_VERSION` cannot ship.

## [1.0.0]

First release. jStudio replaces jBuilder and jSpoofer with one app.

- One Tauri window, one Studio plugin, one local bridge on a long poll instead of two apps polling on timers.
- Build: the agent reads the synced place, proposes complete Luau and instances, and every proposal waits for your click.
- Animations: scan, re-upload through Open Cloud and swap IDs back into the place as one undoable change, now running in Rust so your session never reaches the interface.
- The model can drive the animation pipeline itself through the respoofAnimations tool.
- Roblox Studio's built-in MCP server connects with one toggle, giving the model live Luau, viewport capture and asset insertion.
- Any other MCP server connects too, over a local process or streamable HTTP.
- Sign in with Roblox in a real login window. Pasting a session cookie stays as the advanced path.
- Sessions and API keys live in the system credential vault. Nothing is written to a plain file.
- English, Portuguese and Spanish, light and dark, and a command palette on Ctrl+K.
- Run history and chat history with apply and revert on any past run.
- Signed updater, checksummed releases, version lock across package.json, Cargo.toml, tauri.conf.json and the plugin.
