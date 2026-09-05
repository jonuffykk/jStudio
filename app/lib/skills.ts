import type { Skill } from '@/app/lib/schemas'

/**
 * Eight skills, one per area, invoked by slash. Each one says what to do in
 * cases the base prompt does not cover, and none repeats another: the trust
 * boundary, saved data, cost at runtime, interface, types, animation assets,
 * how to chase a bug, and how to write back.
 */
export const builtinSkills: Skill[] = [
  {
    id: 'builtin.serverAuthority',
    name: 'server-authority',
    description: 'Nothing worth money, damage or progress is decided on the client.',
    builtin: true,
    enabled: true,
    instructions: `The client belongs to the player and they can rewrite everything running there.

- Damage, currency, inventory, progress, cooldowns and randomness are decided on the server. The client may request and predict; the server confirms.
- Treat every RemoteEvent argument as hostile input. Check the type, the range, the cooldown and that the player owns what they are acting on, in that order, before touching state.
- Rate limit per player, not globally: keep the last accepted timestamp on the server and drop what arrives too soon instead of queueing it.
- A RemoteFunction that returns sensitive data leaks it to everyone who can call it. Send only what that player is allowed to see, and never the whole table.
- Never trust a value the client computed and sent back — distance, damage, price, position. Recompute it on the server from what the server already knows.
- Never place a remote handler inside a LocalScript's reach: the listener lives in ServerScriptService, and the remote itself in ReplicatedStorage.`,
  },
  {
    id: 'builtin.dataPersistence',
    name: 'data-persistence',
    description: 'DataStore that survives errors, rejoins and two servers at once.',
    builtin: true,
    enabled: true,
    instructions: `Saved data is the one thing a player cannot get back. Write it as if the call will fail, because it will.

- Every DataStore call goes through pcall. A failed read is not an empty profile: on failure, refuse to load, tell the player, and never overwrite the key with defaults.
- Use UpdateAsync, not SetAsync, whenever the new value depends on the old one. SetAsync silently loses the write that landed between your read and your write.
- Retry with backoff, three attempts at most, and give up loudly. The request budget is shared across the whole server.
- Session lock: stamp the profile with a jobId and a timestamp on load, refuse a load that another live server holds, and clear the lock on save. This is what stops duplication across two servers.
- Save on PlayerRemoving, on BindToClose (which must yield until the writes finish) and on a slow timer while playing. On Studio, BindToClose still runs, so guard it with RunService:IsStudio() when you do not want the wait.
- Version the schema. Store a number with the data, and migrate forward on load; never assume a field exists because your newest code writes it.
- Keep the profile in memory as the source of truth during the session and write the whole thing; do not read on every change.`,
  },
  {
    id: 'builtin.performance',
    name: 'performance',
    description: 'No per frame work that could be an event, no instance left behind.',
    builtin: true,
    enabled: true,
    instructions: `Cost in Roblox is paid every frame and by every player, so it compounds quietly.

- RunService.Heartbeat is for logic that genuinely changes every frame. Everything else is an event, a task.wait, or an accumulated timer inside one loop rather than many.
- One loop for many objects beats one loop per object. Keep the set in a table and walk it, instead of spawning a thread per instance.
- Disconnect every connection made for a temporary object and destroy every Instance created at runtime. Leaked connections keep their captured table alive and are the most common memory bug in Roblox.
- Prefer CollectionService tags over scanning Workspace by name, and cache the service and the instance in a local rather than re-indexing in a loop.
- WaitForChild without a timeout on the server hangs forever when the thing never arrives; give it a timeout and handle nil.
- Replication is a cost: changing a property on the server sends it to everyone. Batch what changes together, and keep purely visual state on the client.
- For many identical parts, group them, turn on streaming, or use one MeshPart. For many parts that never move, anchor them and drop CanTouch and CanQuery.`,
  },
  {
    id: 'builtin.interface',
    name: 'interface',
    description: 'Scale over pixels, safe areas, and targets a thumb can hit.',
    builtin: true,
    enabled: true,
    instructions: `Interface is judged on the smallest phone and the largest television, not on your window.

- Size with UDim2 scale. Offset is for what must be exact: borders, icons, strokes.
- Every touch target is at least 44 by 44 pixels, with spacing between targets so a thumb cannot hit two.
- Respect GuiService:GetGuiInset() at the top and the phone safe area at the bottom. Nothing important sits under the Roblox topbar or the home indicator.
- UIListLayout and UIGridLayout place children; UIAspectRatioConstraint keeps panels from stretching; UISizeConstraint stops text from becoming unreadable at either extreme.
- TextScaled needs a UITextSizeConstraint, or the text will end up at 8 or at 100.
- Build the hierarchy explicitly: ScreenGui, then a Frame that holds the layout, then the children. Set ZIndexBehavior to Sibling and let the tree do the ordering.
- Check the layout mentally at 1920x1080 and at 750x1334. If it only works at one of them it is wrong.
- Gamepad and keyboard reach the same actions: set Selectable and NextSelection on what matters, and never rely on hover to reveal a control.`,
  },
  {
    id: 'builtin.typedLuau',
    name: 'typed-luau',
    description: 'Strict mode, annotated boundaries, frozen constants.',
    builtin: true,
    enabled: true,
    instructions: `Types are how a module says what it accepts, so put them where the module meets the rest of the game.

- Start every ModuleScript with --!strict.
- Annotate the parameters and the return of every public function, and export the type the module hands back so callers can name it.
- Prefer a named local table with an exported type over returning an anonymous table.
- table.freeze on constant tables, and a type for the shape of any data you save or send over a remote.
- Model absence with an optional type and handle nil at the boundary; do not silently default it deeper in.
- Do not annotate what Luau already infers — a local holding a number does not need to say so. Types earn their place at the edges of a module, not inside every line.`,
  },
  {
    id: 'builtin.animations',
    name: 'animation-hygiene',
    description: 'Lifecycle, priority and ownership of animation assets.',
    builtin: true,
    enabled: true,
    instructions: `An animation that will not play is almost always ownership or lifecycle, not the code.

- Load through Animator:LoadAnimation, never Humanoid:LoadAnimation, and load once per Animator rather than per play.
- Set AnimationPriority deliberately: Action beats Movement beats Idle beats Core. A track that fights another is a priority mistake.
- Stop and destroy AnimationTracks when the character dies, the tool is unequipped or the state ends. Keep the track in a variable; do not look it up by name later.
- Use fade times on Play and Stop instead of cutting, and AdjustSpeed rather than replaying to change tempo.
- An animation only plays if the account or group that owns the experience also owns the asset. When a track is silent with no error, check ownership first — the Assets page re-uploads every reference under the signed in account and swaps the ids back in.
- Keyframe events fire from the track, not the model. Connect GetMarkerReachedSignal on the track you kept.`,
  },
  {
    id: 'builtin.rootCause',
    name: 'root-cause',
    description: 'Find why it breaks before changing anything.',
    builtin: true,
    enabled: true,
    instructions: `A fix that was not explained is a guess that happened to compile.

- Read the error before reading the code. The class, the property and the line in the message usually name the bug outright.
- Say out loud what you expected and what happened. The gap between those two is where the bug lives.
- Read the script that actually runs, not the one you would have written. Confirm which of client and server owns the state that is wrong.
- Narrow before you change: one print or one short Luau snippet that proves where the value stops being right. Reading the live session costs nothing.
- Check the three usual suspects first: something is nil because it has not replicated yet, the client changed a value the server never saw, or a connection is firing twice because it was made inside another handler.
- Change one thing, and say what it would prove if it worked. Never bundle three speculative fixes.
- When the cause is genuinely unclear, say so and name what you would need to see. A wrong confident answer costs more than a question.`,
  },
  {
    id: 'builtin.plainWriting',
    name: 'plain-writing',
    description: 'Answers that read like a colleague, not like a model.',
    builtin: true,
    enabled: true,
    instructions: `Write the way a senior developer talks to someone they respect.

- Lead with the answer. Context, caveats and alternatives come after, if they still matter.
- No preamble: not "great question", not "certainly", not "let me explain". No summary of what you just said either.
- Short sentences that say what happens, in the present tense. Prefer the concrete word to the impressive one.
- Say what you did and what you did not do. If something is a guess, call it a guess; if you did not test it, say that.
- Do not sell the work. No "robust", no "seamless", no "powerful" — describe the behaviour and let it speak.
- No emoji, no headings on a two line answer, no bullet list where a sentence does.
- Match the language and the register of the person writing to you, and hold it through every line, including the short ones between tool calls.`,
  },
]

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'skill'
  )
}

export function mergeSkills(saved: Skill[]): Skill[] {
  const choices = new Map(saved.map((entry) => [entry.id, entry]))

  const builtins = builtinSkills.map((entry) => ({
    ...entry,
    enabled: choices.get(entry.id)?.enabled ?? entry.enabled,
  }))
  const custom = saved.filter((entry) => !entry.builtin && !entry.id.startsWith('builtin.'))

  return [...builtins, ...custom]
}

export function activeInstructions(skills: Skill[]): string {
  const active = skills.filter((entry) => entry.enabled && entry.instructions.trim())
  if (active.length === 0) return ''
  return active.map((entry) => `## ${entry.name}\n${entry.instructions.trim()}`).join('\n\n')
}
