# Changelog

## [1.3.0]

### Everything reaches the place through the MCP

- The AI no longer has a second way in. Reading, inspecting and applying all go through Roblox Studio's own MCP server, so there is one path to keep working instead of two that drift apart. When it is not connected, the app says so and the editing tools refuse instead of failing quietly.
- The prompt teaches that path: list the Studio session once and reuse the id, search the tree instead of walking it, run Luau to read and measure but never to change, and propose changes so they land as one reviewable, undoable step.
- Applying no longer looks for tools by name. The Luau runner is found by its schema, the session id by a named pattern that is then cached, and a failure is read from the server's own error flag rather than by grepping the output for the word "error".
- Properties Studio refuses are collected and reported instead of being swallowed, missing ancestors are created as the class that belongs there (ScreenGui under StarterGui, Model under Workspace), and the selection is only touched if you ask for it.

### Interfaces are described, not scripted

- `buildUi` takes a screen as a tree — class, style, text, layout, children — and the app compiles the Luau. The model never writes instance code for a GUI again, and the proposal card shows the tree as an outline before anything is applied.
- Every property is typed. Colors, UDim, UDim2, Vector2, Rect, gradients and enums are checked and encoded, so `CornerRadius`, `Font` and `TextSize` finally land instead of being dropped; whatever a class does not accept is reported by name rather than swallowed.
- Layout is intent. `fill`, `hug` and pixel or scale extents with a floor and a ceiling become anchors, positions, `AutomaticSize` and a `UISizeConstraint`; padding, direction and gap become `UIPadding` and a list or grid layout.
- Sixteen presets — screen, panel, card, title, body, caption, primary, secondary, ghost, danger, input, list, divider, badge and the rest — carry their radius, type and states, so one word gives a button that already looks finished.
- The theme is a palette of tokens resolved while compiling. A node says `surface` or `primary` and gets a `Color3`; no ModuleScript is added to the place, and a screen can override the palette for itself.
- A rebuild reconciles instead of replacing. Names that exist are reused, a class that changed is swapped, and only what this tool created carries the mark that lets it be pruned — anything added by hand in Studio survives. The whole screen is one `ChangeHistoryService` recording, so one undo takes it back.
- Hover and pressed states become a single small `UIStates` script with a tween, written only when something actually reacts and removed when nothing does.

### Approvals and two local commands

- Before a tool that can touch the live session runs, the app asks: allow, always allow, or deny. Reading is always free — the server's own read-only hint decides. The answer can be remembered per tool, and the whole gate can be switched to "just run it".
- `/status` and `/tools` answer from what the app already knows, without spending a token.

### Conversations run side by side

- Every chat owns its own session: messages, spend, proposals, undo history and approval. Starting one no longer refuses because another is answering, and switching away leaves it running with its spinner in the sidebar.
- A conversation deleted while it works is stopped and dropped.

### The web, in batches

- `searchWeb` takes up to four queries at once and merges them, deduplicated by address, so three angles of a question cost one step instead of three turns.
- `readPage` became `readPages`: up to eight addresses fetched four at a time, each returned with its title, and a `✓`/`✗` index at the top naming every source that answered and every one that refused.
- Pages are fetched as a browser is — real user agent, fifteen second timeout, one retry with a looser Accept, content type checked before the body is read — and the extractor keeps the article while dropping script, style, nav, header, footer and aside, decoding the entities a real page carries.
- Four engines are asked at the same time — DuckDuckGo, its lite front end, Mojeek and Bing — plus Wikipedia's JSON API, and the results are interleaved round robin so no single engine takes the page. If one is blocked or empty, the others still answer.
- Pages are read to completion instead of cancelling the stream mid flight, and the timeout is now a clock the request cancels when it finishes. Both a cancelled stream and a timer that fired after its answer arrived left the host holding a resource nobody owned, which surfaced later as `The resource id is invalid` with no owner.
- The prompt is explicit that the web is read with these two tools and nothing else: a Studio tool that happens to speak HTTP is for the place, needs the same session, and is never the way to fetch a page.

### Subagents

- One switch turns on a fixed panel of four specialists — Reviewer, Security, Performance and Game design — that the agent can consult, several at once, on a heavy request. There is nothing to configure and nothing to break.

### Models, from the provider's own catalogue

- The model list is read from each provider and carries what it publishes: context window, output ceiling, image and tool support, reasoning style, and price where there is one. OpenRouter publishes prices, Groq publishes context windows, and Anthropic, OpenAI and B.AI publish neither — so cost is shown only where it is real, and never guessed.
- Google Gemini joined the providers through its OpenAI-compatible endpoint.
- Output ceiling, thinking budget and reasoning effort now come from what the model can actually do instead of a fixed number, and a rate limit or a busy provider is retried with backoff instead of ending the turn.
- An answer cut off at the length limit picks itself back up, up to twice, in the same message.
- Reasoning is read in every shape providers send it: `reasoning`, `reasoning_content`, `thinking`, `reasoning_details`, and Anthropic's thinking blocks.
- Every model picker is the same component, loaded automatically when the provider or the key changes. No refresh button anywhere.

### Usage that adds up

- Usage moved out of the settings file into its own ledger, written at most once a second instead of on every exchange.
- Anthropic cache tokens are counted, so input is no longer reported far below what was billed.
- The context ring shows the context, not the running total, and side calls — naming a chat, consulting a specialist, summarising — no longer move it.
- The popover shows what the prompt actually carries, each slice measured from the strings this app built and scaled to the token count the provider charged for.
- The Usage tab leads with today — the number, the runs, the cost when there is one — a fourteen day bar chart beside it, and the input/output split spelled out underneath with the share output actually represents. Week and month follow as two cards, then average per day, tokens per exchange, the input:output ratio and the busiest day.
- The chart draws every day in the window whether or not it has data, so it reads the same on the first day as on the fourteenth. Home shows the same bars without dividers, and both surfaces show a real empty state before there is anything to count.
- The ledger records which model spent what, and the tab lists them with a proportion bar — so a tab that used to be mostly empty space now says where the tokens went.
- Days are counted where the person is, not where UTC is, and "today" means the calendar day rather than the last twenty-four hours. An evening session used to land on tomorrow and leave today reading zero.
- The tab stacks: today, the fourteen day chart, the summary rows, then the models — one column, scrolling, no grid of half-empty tiles.

### Lighter turns

- Tool descriptions are cut to a whole sentence and JSON schemas lose what a model never reads — `$schema`, `title`, `examples`, `default` — which is where most of a turn's input was going.
- The place fits in a smaller budget, and `@Path.To.Script` attaches exactly the sources you mean.
- Prompt caching covers the system block and the tool list on Anthropic.

### The chat

- The transcript is memoised and each message is its own layout island, so a long conversation with big scripts stays smooth while tokens stream.
- A button brings you back to the newest message, and scrolling up now wins immediately instead of fighting the auto follow.
- Script proposals show a real diff with a `+n/-n` count, and an applied change can be reverted from the card.
- A plan or a question takes the composer's place while it is open, and stays in the transcript as a card afterwards, so approving a plan no longer leaves a one-sided conversation.
- Editing a message takes over the bubble, keeps its attachments, and saves with Enter or cancels with Escape.
- Chats are named by the model from the first message, and the sidebar has a search.
- Slash skills only apply when you type them.

### Settings, plugin and storage

- Six tabs became five: Model, Extensions, Memory, Usage and App, all at one fixed height. Temperature and tool turns are set by the app now.
- Memory opens with who you are: your Roblox avatar and name, what the app should call you, and what you do — which is also what the model is told.
- Eight skills, one per area and none repeating another: the trust boundary, saved data, cost at runtime, interface, types, animation assets, chasing a bug to its cause, and writing back like a colleague. Saved facts are a readable list that wraps instead of a row of clipped chips.
- Context7 and DeepWiki ship connected, alongside Studio, with nothing to configure.
- The plugin is one button that adapts, reconnects on its own forever, and updates itself whenever the app ships a new copy.
- The local bridge is paired with a token written into the plugin, so no other process on the machine can drive your Studio.
- Conversations are one file each, images live outside the transcript, and clearing them sweeps the orphans.

### Repairs

- The chat view was 2,212 lines; it is now nine focused modules and a container.
- Editing a message showed the text of a different chat.
- A field inside a dialog lost focus on every keystroke, because the dialog's focus trap re-ran whenever anything re-rendered.
- A cancelled request no longer surfaces as an unhandled rejection.
- Keyboard shortcuts stopped hijacking Ctrl+F, Ctrl+S and friends inside text fields, DevTools and the context menu are free again, and dialogs trap focus and close on Escape.
- Duration reads in whole seconds, dates and times follow the app language, and 38 TypeScript tests plus 19 Rust tests cover the new ground.

## [1.2.0]

### One page for every asset

- Animations, audios and images were three entries in the sidebar running the same screen three times. They are now one Assets page with a switch at the top, and each kind still keeps its own run history and its own settings.
- Meshes joined them as a fourth kind, read from MeshPart, SpecialMesh, FileMesh, CharacterMesh, WrapTarget and WrapLayer.
- The sidebar is down to Home, Build and Assets, and Ctrl+1 to Ctrl+3 follow it.

### The scan sees the whole place

- One id per instance was ever read, so a Sky kept five of its six textures, a SurfaceAppearance three of its four maps and an ImageButton two of its three images. Every reference is recorded now, and every one of them is replaced.
- The property list grew to what a place actually holds: Decal, Texture, MeshPart, SpecialMesh, CharacterMesh, ParticleEmitter, Beam, Trail, ImageLabel, ImageButton, ImageHandleAdornment, Shirt, Pants, ShirtGraphic, Sky, SurfaceAppearance, MaterialVariant, Sound, AudioPlayer, Animation and the seven Humanoid animation properties.
- Properties are read and written as string, as number and as Content, so the values recent Studio builds hand over no longer read as empty.
- An asset the catalog will not talk about was dropped from the scan. That is precisely what a private or moderated asset looks like, which meant the assets most worth replacing never appeared. The property an id sits on now decides its kind, and the catalog is asked only for the name, the creator, and to move an id that plainly belongs to another tab.

### Downloads reach what Studio reaches

- The games that actually run an asset are asked for first, through asset-to-universe. A copylocked asset is served to those places, and this is what makes someone else's asset reachable at all. The previous build never asked.
- The delivery service is asked in the shape the client asks: the plain url, then the url carrying placeId, serverplaceid and clientInsert, then the location endpoint, then the batch call, then the asset hash across every CDN shard and the saved versions.
- The Studio session guid is a real per-place guid held for the life of the process. The one derived from the place id was a shape Roblox refused for copylocked assets.
- A free asset that is refused is taken first, then downloaded, instead of only being labelled free.
- What counts as a valid payload follows the file: magic numbers for audio and pictures, and an error-page blacklist for animations and meshes, whose binary shapes keep changing.
- The creator's games are asked for publicly first and privately only if that came back empty.
- An asset nobody will serve stops after twenty refusals in a row instead of spending the shared rate limit on every remaining url.

### The picture that arrived blank

- A picture id is usually a Decal, and what Roblox hands over for one is a small model pointing at the bitmap underneath. The id inside it is read out and fetched on its own.
- Uploading the result as a Decal handed back the id of a new wrapper, and a Texture or an Image property fed that id shows nothing. Pictures upload as Image now, so the id that goes back into the place is the bitmap itself. A type name the key refuses is retried once under the other name Roblox knows it by.

### Pause and stop

- Resume could be missed. The waiting task registered for the wake-up after checking the flag, so a resume landing in that gap left the run paused forever. The wait is polled now, and it costs nothing.
- Pause and resume answer with the state of the run itself, so the button can no longer disagree with what is happening, and pausing when nothing is running does nothing at all.
- A run that ends any way at all, including badly, releases the running flag. A failed run used to leave the app refusing the next one.
- Opening the Assets page reconciles with the run that is actually going, so a reload no longer shows a run that finished or hides one that did not.
- What the run is doing, which the backend has always reported, is on screen under the progress bar.

### Runs are faster

- The walk out from an asset's creator, a dozen paginated lookups deep, used to run once per asset and again for every asset that shared a creator. It runs once per creator now.
- Nothing pays for that walk until it has to. The place open in Studio is asked on its own first, which is the answer for almost everything a run meets.
- The direct urls are tried before the two resolver calls, so an asset that was always going to answer costs one request instead of three.
- A download slot was held for the whole upload that followed it, so the two limits collapsed into whichever was smaller. The slot is handed back the moment the bytes are in hand.
- The plugin asked Roblox about one asset id at a time while scanning, which is what made a large place take minutes. Twelve run at once now, and an answer is remembered for the session.

### Fixes

- A failure trail long enough to be trimmed crashed the worker: the cut landed inside the middle dot that joins its steps. It cuts on character boundaries now.
- A scan that finds nothing goes back to the empty state instead of showing an empty picker, and Run with nothing ticked no longer starts a run that has nothing to do.
- The list no longer yanks itself to the bottom on every event while a run is going.
- The line naming the account an asset belongs to is gone from the rows; it repeated what the run already knows and said nothing useful.
- The audio page reported an empty scan in the words of the animation page. Every message that names what was scanned now says the kind it was actually looking for, in all three languages.
- The row previews are gone: neither the sound player nor the picture thumbnail was worth the network round trip it cost before a run.

### The assistant

- Effort is matched to the request. A greeting, a yes or no, a one line fix is answered at once; deliberation is reserved for what an answer actually turns on. Restating the request, announcing the next step and summarising a proposal already on screen are all out.
- How long an answer took is on it: the thinking time on the reasoning block, the total on the message.
- Every code block carries a copy button that confirms what it did.
- The chat could only re-upload animations; sounds, pictures and meshes are all in reach of `respoofAssets` now.
- A run the chat starts shows on the Assets page as it happens, on the right kind, instead of finishing invisibly.

### Skills

- Five, all for Roblox Studio, all listed by default: server-authority, mobile-ui, roblox-performance, typed-luau and animation-hygiene.
- None of them load themselves. A skill enters the prompt when it is invoked by its slash name, and the assistant is told the others exist without being told what they say. A chat that needs none of them carries none of their words.

### Elsewhere

- The Assets tab wears an icon that reads as assets rather than as film.
- The account menu sits slightly higher and further from the rail.
- The accounts window was rebuilt on the same panels and numbered steps as the rest of the app: each account is one card carrying its state, its key and its actions.
- A release no longer fails because the changelog was not touched; the notes fall back to the commits since the last tag. A push that does not change the version is a quiet no-op instead of an error.
- Six small library files became four, and the source carries no comments.

## [1.1.2]

### The bytes arrive readable

- The delivery CDN hands assets over gzipped, with the encoding signed into the URL, and the HTTP client was not asking for or undoing that. Every asset that did come down arrived compressed and was thrown away as not an asset. It is decompressed now.
- A payload that is still compressed says so in the trail rather than reading as a refusal.

### The batch endpoint is back

- Downloads went through the plain request after the chain was rewritten, and the batch call that Studio itself makes was dropped along the way. It is the first thing tried again, for the open place and then for the others, with the Studio session on it.

### Free assets

- An asset that was refused but is free to take now says so, with a button that opens it on Roblox. jStudio does not add anything to your account for you: you take it in your own session, in one click, and the next run picks it up.

### Fixes

- A row kept the reason of the failure that came before it while the retry was still downloading. Each event replaces the row instead of merging into it.
- A section refuses to scan while the Studio plugin is out of date. An old plugin ignores which kind it was asked for and answers with animations, which is why Audios and Images were listing them.

### Polish

- The play control appears on the row under the cursor instead of on all of them.
- A failed row reads as one line, how it ended and after how many tries, with the whole trail on hover.
- The empty state names the section it is in. Every one of them said animations.

### Images

- The pipeline runs on pictures too: decals, textures, mesh textures, particles, beams, trails and interface images, in their own section with its own history. Each row shows the thumbnail Roblox already renders.
- The uploader reads the container off the bytes, so a png goes up as a png and a jpg as a jpg, and a picture that resolves to a decal is accepted in either form.

### Preview

- A sound plays in the app and a picture shows its thumbnail. An animation has no preview: rendering a rig needs an engine this window does not have, and sending you to Studio to watch it was not a preview of anything.
- A sound whose bytes are not a container the player understands says so instead of failing silently inside the audio element.

### Reaching assets that are not yours

- Taking an asset you do not own is the point of the pipeline, so a run no longer stops when Studio is signed into a different account. It says so once and goes ahead.
- Places around the creator are tried after their own: the groups they belong to, the owners of those groups, and the games all of them published. A private asset is usually used by a game its creator only collaborates on.
- `expectedAssetType` is sent only for the kinds where Roblox uses it, matching what the reference implementation does.

### Infrastructure

- Rate limits are held per endpoint family. A throttled upload used to stall every download queued behind it.
- Every lookup that is not a transfer waits on its own clock and reads the `retry-after` Roblox sends.

### Removed

- The Explorer section. The place tree is already what the chat reads, and a second read-only view of it earned nothing.
- The Audios icon is the waveform rather than the speaker, which read as a volume control.

### Assets come down, and the failures say why

- A run that failed reported `No permission` on every row, whichever half of the pipeline actually refused. Download and upload now speak for themselves: a key that cannot write assets, a session that expired, an asset nobody will vouch for, and the exact response from Roblox on hover.
- Roblox hands an asset over to something that looks like Studio opening a place allowed to use it. jStudio was sending one header of the three that prove it, so every asset it did not already own came back 403. The download presents a full Studio session now, place, game and session id together, under a Studio user agent.
- When no known place vouches for an asset, Roblox is asked which universes reference it and their places are tried. That is what group assets needed.
- After those come the asset's own hash on the CDN, where no permission applies, and then its saved versions, which often survive when the current one does not.
- What comes back is checked for being the thing that was asked for. An error page arriving with a 200 used to be re-uploaded as a broken asset.
- The place that vouched for one asset is tried first for the next one by the same creator.

### The place you have open

- Every asset was refused because the one place certain to reference it, the one open in Studio right now, was never in the list jStudio asked with. It goes first for every asset now, and a private asset of your own comes down on the first request.
- The lookup that asked Roblox which universes use an asset answers 404 for every asset, public ones included. It is gone, and with it a round trip per asset that bought nothing.
- A run checks the Roblox session before it starts. An expired one now says so once, instead of ten rows of Not authorized.
- The expensive fallbacks, the CDN hash and the saved versions, are only looked up once everything cheap has failed.

### An upload that plays where you put it

- An asset uploaded under your account is not usable inside someone else's experience until it is granted there, which is what left a replaced animation silent. Every upload now grants Use to the universe of the open place.

### Audios

- The whole pipeline runs on sounds as well: scan, download, upload, replace, apply and revert. Each kind keeps its own history, and each id is confirmed with Roblox before it enters a run, so an audio never lands in an animation run.
- A sound can be played inside jStudio before anything is replaced. It comes through the same download chain a run uses, so what you hear is what would be re-uploaded.
- The uploader reads the container off the bytes, so an ogg goes up as an ogg and an mp3 as an mp3.

### First run and the Open Cloud key

- The key is saved the moment you press save. It used to be held back when the check came back unhappy, so a good key that Roblox answered a 403 for was quietly never stored.
- The walkthrough lost the step about accepted IP addresses, which changed nothing.
- Picking what you came for no longer jumps to the next step and takes the second pick away. Each step ends with Continue.

### Audios and animations stop borrowing each other

- The live rows of a run belong to the section that started it. The Audios list was showing whatever the animations run was doing.
- Run stops being offered while a run is going. Keeping the list on screen had left it there next to the pause and stop it conflicts with.

### The list holds still

- Starting a run keeps the list you chose from, each row picking up its own status as it goes, instead of tearing it down and building a different one as the events arrive.

## [1.1.0]

### Animations come down again

- Every asset was failing on `No permission`. Roblox hands an animation over to something that looks like Studio opening a place allowed to use it, and jStudio was sending one header of the three that proves it. The download now presents a full Studio session, place, game and session id together, under a Studio user agent.
- When no place jStudio knows about can vouch for an asset, it asks Roblox which universes actually reference it and tries their places. That is what group animations needed.
- After those, the asset's own hash is tried on the CDN, where no permission applies at all.
- A refusal moves to the next candidate instead of retrying the same URL, and a rate limit waits out the cooldown Roblox asks for.
- What comes back is checked for being a model. An error page arriving with a 200 used to be uploaded as a broken asset.
- The place that vouched for one asset is tried first for the next one by the same creator.

### The Open Cloud key sticks

- The key is saved the moment you press save. It used to be held back when the check came back unhappy, so a good key that Roblox answered a 403 for was quietly never stored. The check is a note beside a saved key now, never a refusal.
- The walkthrough lost the step about accepted IP addresses. A key Roblox leaves alone is unrestricted, so the step changed nothing.

### First run, in order

- Picking what you came for no longer jumps to the next step, which took the second pick away before you could make it. Each step ends with Continue, and moves when you say so.

### The animation list holds still

- Starting a run keeps the list you just chose from, each row picking up its own status as it goes, instead of tearing the list down and building a different one as the events arrive.

### Setup asks what you came for

- First launch opens with one question: build with AI, re-upload animations, or both. Only what you pick is set up, so someone who came for the animations is never asked for a model key.
- The steps open one at a time, on whichever is unfinished, and fold once they are done.
- Nothing is gated any more. You can enter with a step still open and finish it later; each half of the app asks for what it needs at the moment you open it, with a button that goes straight to the panel that fixes it.
- Settings carries the same two switches, so the other half can be turned on whenever, along with a button to run the setup again.
- An installation that was already configured is never sent back through the setup.

### The Open Cloud key

- The step is a walkthrough now: a button that opens the right Roblox page, the six things to do in order, and the values to type sitting next to the line that needs them, each with a copy button. Roblox has no API that mints a key, so this is as far as automation goes.
- The key is checked before you walk away from it. A key Roblox does not recognise, and a key with no Assets permission, are told apart and say which step to go back to. A check Roblox does not answer saves the key anyway and says it will be proven on the first upload.
- Accounts uses the same walkthrough, so the key is asked for the same way everywhere.

### Images

- An image sent to a model that cannot read one used to break every later message in that chat, because it stayed in the transcript and was resent every turn. Images are now dropped before the request when the model is text-only, and the turn is retried without them when a provider refuses one unexpectedly.
- The attach button is disabled, with the reason, on a model that does not read images, and the tray empties when you switch to one.

### The meter reads properly

- Usage was being counted once per stream frame. Providers that repeat a running total in every frame, rather than sending it once at the end, were multiplying the bill by the number of frames. Each call is now counted once, however the provider reports it.
- Anthropic output was counted from the opening frame, where it is still one or two tokens. It comes from the running total now.
- Specialists and chat naming are real calls and are counted like real calls.
- Spend belongs to the chat that caused it and survives a restart. Compressing frees the context; it no longer pretends the money came back.
- The ring shows nothing until something has been spent. Opening it splits the context, now including the instructions and the full tool schemas that every call carries, and reports input, output, total, calls and the last prompt, which is the measured number to compare the estimate against.
- Usage in Settings adds the spend per chat under the daily chart. The context window defaults to 500k.

### Composer

- The message queue is gone. Send and stop are one button in one place: an arrow while you write, a red square while it answers.
- A chat that is not the one running says so instead of offering a send that does nothing.

### Providers, theme and language

- B.AI, one key for DeepSeek, GPT, Claude and Gemini.
- Light is the default theme, and System is a third option that is honoured from the first painted frame, through the window itself, and again when Windows changes its mind mid session.
- The language follows Windows until you pick one yourself, and then it is yours.

### Data

- Clearing the usage history, resetting every setting, and deleting everything, each saying what it takes. Resetting also clears the API keys from the system vault, which do not live in the settings file.

### Project

- The release announcement no longer dies on a broken pipe when the changelog is long.
- The repository moved from jBuilder to jStudio; the updater was still asking the old one for `latest.json`.

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
