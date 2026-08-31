import type { Skill } from '@/app/lib/schemas'

export const builtinSkills: Skill[] = [
  {
    id: 'builtin.serverAuthority',
    name: 'server-authority',
    description: 'Nothing worth money, damage or progress is decided on the client.',
    builtin: true,
    enabled: true,
    instructions: `The Roblox client belongs to the player and they can rewrite everything running there.
- Damage, currency, inventory, progress and cooldowns are decided on the server, always.
- A RemoteEvent arriving from the client is untrusted input. Validate range, cooldown and ownership before acting on it.
- The client may request and predict, the server confirms.
- A RemoteFunction that returns sensitive data leaks it. Send only what that player is allowed to see.`,
  },
  {
    id: 'builtin.mobileUi',
    name: 'mobile-ui',
    description: 'Scale over pixels, safe areas and touch targets big enough to hit.',
    builtin: true,
    enabled: true,
    instructions: `When building interface:
- Size with UDim2 scale. Use offset only for what needs exact pixels, like borders and icons.
- Every touch target is at least 44 by 44 pixels.
- Respect GuiService:GetGuiInset() at the top and the phone safe area at the bottom.
- Use UIAspectRatioConstraint on panels that must not stretch, and UIListLayout or UIGridLayout instead of placing children by hand.
- Check the layout mentally at 1920x1080 and at 750x1334. If it only works at one of them it is wrong.`,
  },
  {
    id: 'builtin.performance',
    name: 'roblox-performance',
    description: 'No needless per frame loops, no leaking instances.',
    builtin: true,
    enabled: true,
    instructions: `- Use RunService.Heartbeat only when the logic truly needs every frame. Everything else becomes an event, a task.wait, or an accumulated timer.
- Disconnect every connection made on a temporary object and destroy every Instance created at runtime. Leaked connections are the most common performance bug in Roblox.
- Prefer CollectionService over scanning the Workspace by name.
- Never call WaitForChild without a timeout on the server.
- For many identical parts, group them, turn on streaming, or use a single MeshPart.`,
  },
  {
    id: 'builtin.typedLuau',
    name: 'typed-luau',
    description: 'Strict mode and annotations in modules.',
    builtin: true,
    enabled: false,
    instructions: `- Start every ModuleScript with --!strict.
- Annotate parameters and return types of public functions, and declare the type the module exports.
- Use table.freeze on constant tables.
- Prefer a named local table with an exported type over returning an anonymous table.`,
  },
  {
    id: 'builtin.animations',
    name: 'animation-hygiene',
    description: 'Track lifecycle, priorities and ownership of animation assets.',
    builtin: true,
    enabled: false,
    instructions: `- Load animations through Animator, never through Humanoid:LoadAnimation.
- Set AnimationPriority deliberately. Action beats Movement beats Idle beats Core.
- Stop and destroy AnimationTracks when the character dies or the tool is unequipped.
- An animation only plays if the account or group that owns the experience also owns the asset. When a track silently refuses to play, ownership is the first thing to check, and the Animations tab can re-upload every reference under the signed in account.`,
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
