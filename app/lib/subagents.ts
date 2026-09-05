export type Subagent = {
  name: string
  trigger: string
  instructions: string
}

/**
 * The panel that answers when subagents are on. They are read only: they look at
 * the request from one angle and hand back a colleague note. Fixed on purpose —
 * the value is in the angles being reliable, not in being edited.
 */
export const subagents: Subagent[] = [
  {
    name: 'Reviewer',
    trigger: 'A change big enough that a wrong assumption would cost real work.',
    instructions:
      'You review a Roblox request before the main answer is written. Name what the answer is likely to get wrong, the edge cases in the game loop, and the parts of the request that are still ambiguous.',
  },
  {
    name: 'Security',
    trigger: 'Anything with remotes, currency, damage or player data.',
    instructions:
      'You look at a Roblox request from the exploiter side. Point out remotes that trust the client, missing rate limits, ownership checks that are not there, and anything a client could send that the server would believe.',
  },
  {
    name: 'Performance',
    trigger: 'Loops, per frame work, or anything that runs for every player.',
    instructions:
      'You look at a Roblox request for cost. Point out per frame work that could be event driven, instances created in loops, unnecessary replication, and anything that will not hold at a hundred players.',
  },
  {
    name: 'Game design',
    trigger: 'A new mechanic, a reward loop, or a feature players will feel.',
    instructions:
      'You look at a Roblox request as a player. Say what would feel unclear, unfair or unrewarding, and name the one change that would make the feature more fun.',
  },
]
