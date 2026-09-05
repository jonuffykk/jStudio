import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { condense, diffLines, diffStat } from './diff.ts'
import { readable } from './net.ts'
import { isRunning, newChatId, newSession } from '../views/chat/session.ts'
import { luauFor } from './luau.ts'
import { compileUi, type UiNode } from './ui/compile.ts'
import { resolveLayout } from './ui/geometry.ts'
import { styles } from './ui/styles.ts'
import { classes, encode, writeProps } from './ui/values.ts'
import { theme } from './ui/theme.ts'
import {
  capabilityOf,
  costOf,
  describeModel,
  formatContext,
  groupModels,
  pickDefaultModel,
  readModel,
  supportsVision,
  usableForCode,
} from './models.ts'
import { buildSystemPrompt, describeProject, promptParts } from './prompt.ts'
import { action, settings, spoofOptions } from './schemas.ts'
import { dictionaries, translate } from './i18n.ts'
import { activeInstructions, builtinSkills, mergeSkills } from './skills.ts'
import { cacheable, mutating, slimDescription, slimSchema, studioTools, toolSize } from './tools.ts'
import { compactTokens, dayKey, emptyUsage, lastDays, recordUsage, totalsOver } from './usage.ts'

describe('schemas', () => {
  it('accepts a complete script proposal', () => {
    const parsed = action.safeParse({
      kind: 'script',
      path: 'ServerScriptService.Combat.DamageHandler',
      className: 'Script',
      source: 'print("hi")',
      summary: 'Added the damage handler.',
    })
    assert.equal(parsed.success, true)
  })

  it('rejects a path that could escape the tree', () => {
    const parsed = action.safeParse({ kind: 'delete', path: '../../etc/passwd', summary: 'nope' })
    assert.equal(parsed.success, false)
  })

  it('rejects an instance class that is not a class name', () => {
    const parsed = action.safeParse({
      kind: 'instance',
      path: 'Workspace.Thing',
      className: 'Part; os.exit()',
      summary: 'nope',
    })
    assert.equal(parsed.success, false)
  })

  it('clamps colour channels to the unit range', () => {
    const parsed = action.safeParse({
      kind: 'instance',
      path: 'Workspace.Thing',
      className: 'Part',
      summary: 'ok',
      color: [255, 0, 0],
    })
    assert.equal(parsed.success, false)
  })

  it('fills defaults for settings and run options', () => {
    const value = settings.parse({})
    assert.equal(value.providerId, 'anthropic')
    assert.equal(value.mode, 'manual')
    assert.equal(value.effort, 'medium')
    assert.equal(spoofOptions.parse({}).downloadConcurrency, 10)
  })
})

describe('i18n', () => {
  it('translates every key in every language', () => {
    const keys = Object.keys(dictionaries.en)
    for (const [language, dictionary] of Object.entries(dictionaries)) {
      assert.deepEqual(Object.keys(dictionary).sort(), keys.slice().sort(), `${language} keys`)
      for (const key of keys) assert.ok((dictionary[key as keyof typeof dictionary]?.length ?? 0) > 0, key)
    }
  })

  it('interpolates values', () => {
    assert.ok(translate('en', 'settings.updateReady', { version: '1.2.0' }).includes('1.2.0'))
  })
})

describe('models', () => {
  it('prefers the strongest coding model available', () => {
    assert.equal(pickDefaultModel(['llama-3.3-70b', 'claude-opus-5', 'gpt-5']), 'claude-opus-5')
    assert.equal(pickDefaultModel(['whatever']), 'whatever')
    assert.equal(pickDefaultModel([]), '')
  })

  it('filters out models that cannot write code', () => {
    assert.equal(usableForCode('whisper-large'), false)
    assert.equal(usableForCode('qwen-2.5-coder'), true)
  })

  it('knows which models refuse images', () => {
    assert.equal(supportsVision('deepseek-reasoner'), false)
    assert.equal(supportsVision('qwen2.5-coder-32b'), false)
    assert.equal(supportsVision('openai/gpt-oss-120b'), false)
    assert.equal(supportsVision('claude-opus-5'), true)
    assert.equal(supportsVision('gpt-4o-mini'), true)
    assert.equal(supportsVision('qwen2-vl-7b'), true)
    assert.equal(supportsVision(''), true)
  })

  it('carries an output budget and a reasoning style per family', () => {
    assert.equal(capabilityOf('claude-sonnet-5').reasoning, 'budget')
    assert.equal(capabilityOf('gpt-5-mini').reasoning, 'effort')
    assert.equal(capabilityOf('some-unknown-model').reasoning, 'none')
    assert.ok(capabilityOf('claude-sonnet-5').maxOutput >= 8_192)
  })

  it('only charges when the provider published a price', () => {
    assert.equal(costOf(describeModel('claude-opus-5'), 1000, 1000), null)

    const priced = readModel({
      id: 'openai/gpt-4o',
      context_length: 128_000,
      pricing: { prompt: '0.0000025', completion: '0.00001' },
      architecture: { input_modalities: ['text', 'image'] },
      supported_parameters: ['tools'],
    })

    assert.ok(priced)
    assert.equal(priced.inputPrice, 2.5)
    assert.equal(priced.outputPrice, 10)
    assert.equal(priced.vision, true)
    assert.equal(priced.tools, true)
    assert.equal(costOf(priced, 1_000_000, 0), 2.5)
  })

  it('reads what a provider says and falls back to the table for the rest', () => {
    const groq = readModel({ id: 'llama-3.3-70b', context_window: 131_072 })
    assert.equal(groq?.contextWindow, 131_072)
    assert.equal(groq?.inputPrice, null)

    assert.equal(readModel({ id: 'whisper-large-v3', context_window: 448 })?.code, false)
    assert.equal(readModel({ id: 'retired', active: false }), null)
    assert.equal(readModel({}), null)
  })

  it('formats a context window the way a person reads it', () => {
    assert.equal(formatContext(128_000), '128k')
    assert.equal(formatContext(1_000_000), '1M')
  })

  it('groups a catalogue by vendor', () => {
    const groups = groupModels([describeModel('openai/gpt-4o'), describeModel('anthropic/claude-opus-5')])
    assert.deepEqual(groups.map((group) => group.label), ['Anthropic', 'Openai'])
  })
})

describe('usage', () => {
  it('folds exchanges into one day and keeps a rolling pulse', () => {
    const at = Date.parse('2026-01-02T10:00:00Z')
    const first = recordUsage(emptyUsage, { input: 10, output: 5, model: 'x', source: 'chat', cost: 0.01 }, at)
    const second = recordUsage(first, { input: 4, output: 1, model: 'x', source: 'agent', cost: 0.02 }, at + 1000)

    assert.equal(second.days.length, 1)
    assert.equal(second.days[0]?.input, 14)
    assert.equal(second.days[0]?.runs, 2)
    assert.ok(Math.abs((second.days[0]?.cost ?? 0) - 0.03) < 1e-9)
    assert.equal(second.days[0]?.bySource.chat, 15)
    assert.equal(second.days[0]?.bySource.agent, 5)
    assert.equal(second.pulse.length, 2)
  })

  it('drops pulses older than the window', () => {
    const now = Date.now()
    const old = recordUsage(emptyUsage, { input: 1, output: 1, model: 'x', source: 'chat', cost: null }, now - 400_000_000)
    const fresh = recordUsage(old, { input: 1, output: 1, model: 'x', source: 'chat', cost: null }, now)

    assert.equal(fresh.pulse.length, 1)
  })
})

describe('settings', () => {
  it('asks before a tool runs until the person says otherwise', () => {
    const value = settings.parse({})
    assert.equal(value.approval, 'ask')
    assert.deepEqual(value.allowedTools, [])
  })
})

describe('usage chart', () => {
  it('always draws a full window, present or not', () => {
    const today = dayKey(Date.now())
    const slots = lastDays(
      [{ day: today, input: 10, output: 2, runs: 1, cost: 0, bySource: {} }],
      14
    )

    assert.equal(slots.length, 14)
    assert.equal(slots[13]?.day, today)
    assert.equal(slots[13]?.total, 12)
    assert.equal(slots[0]?.total, 0)
  })

  it('counts today as the calendar day, not the last 24 hours', () => {
    const evening = Date.parse('2026-09-04T23:30:00-03:00')
    const day = dayKey(evening)

    assert.equal(day, '2026-09-04')

    const ledger = [{ day, input: 100, output: 10, runs: 2, cost: 0, bySource: {} }]
    const today = totalsOver(ledger, 1, evening)

    assert.equal(today.input, 100)
    assert.equal(today.runs, 2)
    assert.equal(totalsOver(ledger, 7, evening).input, 100)
    assert.equal(totalsOver(ledger, 1, Date.parse('2026-09-06T10:00:00-03:00')).input, 0)
  })

  it('shortens tokens the way a person reads them', () => {
    assert.equal(compactTokens(950), '950')
    assert.equal(compactTokens(11_899), '11.9k')
    assert.equal(compactTokens(2_400_000), '2.4M')
  })
})

describe('diff', () => {
  it('reports what moved between two versions', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc')
    assert.deepEqual(diffStat(lines), { added: 1, removed: 1 })
  })

  it('collapses untouched stretches', () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')
    const after = before.replace('line 20', 'line twenty')
    const shown = condense(diffLines(before, after))

    assert.ok(shown.length < 20)
    assert.ok(shown.some((line) => line.text === '⋯'))
  })
})

describe('tools', () => {
  it('never replays a tool that changes something', () => {
    for (const name of mutating) assert.equal(cacheable.has(name), false, name)
  })

  it('describes every builtin tool to the model', () => {
    for (const tool of studioTools) {
      assert.ok(tool.description.length > 20, tool.name)
      assert.equal(tool.parameters.type, 'object')
    }
  })
})

describe('sessions', () => {
  it('gives every conversation its own state', () => {
    const one = newSession('a')
    const two = newSession('b', 'claude-sonnet-5')

    one.undo.set('0:0', null)

    assert.equal(isRunning(one), false)
    assert.equal(two.model, 'claude-sonnet-5')
    assert.equal(two.undo.size, 0)

    one.controller = new AbortController()
    assert.equal(isRunning(one), true)
    assert.equal(isRunning(two), false)
  })

  it('never hands out the same chat id twice', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newChatId()))
    assert.equal(ids.size, 50)
  })
})


describe('interface values', () => {
  it('writes every kind as the literal Roblox expects', () => {
    assert.equal(encode('color', '#FF8800', theme), 'Color3.fromRGB(255, 136, 0)')
    assert.equal(encode('color', 'primary', theme), 'Color3.fromRGB(108, 92, 231)')
    assert.equal(encode('udim', 12, theme), 'UDim.new(0, 12)')
    assert.equal(encode('udim2', [1, -24, 0, 44], theme), 'UDim2.new(1, -24, 0, 44)')
    assert.equal(encode('vector2', [0.5, 1], theme), 'Vector2.new(0.5, 1)')
    assert.equal(encode({ enum: 'Font' }, 'GothamBold', theme), 'Enum.Font.GothamBold')
    assert.ok(encode('gradient', ['#000000', '#FFFFFF'], theme)?.startsWith('ColorSequence.new('))
  })

  it('refuses a value of the wrong shape instead of guessing', () => {
    assert.equal(encode('color', 'not a colour', theme), null)
    assert.equal(encode('udim2', [1, 2], theme), null)
    assert.equal(encode({ enum: 'Font' }, 'Gotham; os.exit()', theme), null)
    assert.equal(encode('number', '18', theme), null)
  })

  it('names the properties a class does not have', () => {
    const written = writeProps('n1', 'TextLabel', { Text: 'Hi', Elevation: 4 }, theme)

    assert.deepEqual(written.lines, ['n1.Text = "Hi"'])
    assert.deepEqual(written.skipped, ['TextLabel.Elevation'])
  })

  it('covers the classes a screen is made of', () => {
    for (const name of ['ScreenGui', 'Frame', 'TextButton', 'ScrollingFrame', 'UICorner', 'UIListLayout']) {
      assert.ok(classes[name], name)
    }
  })
})

describe('interface layout', () => {
  it('turns intent into geometry', () => {
    const { props, helpers } = resolveLayout(
      { anchor: 'center', width: { scale: 0.4, max: 520 }, height: 'hug', direction: 'vertical', gap: 12, padding: 16 },
      true
    )

    assert.deepEqual(props.AnchorPoint, [0.5, 0.5])
    assert.deepEqual(props.Position, [0.5, 0, 0.5, 0])
    assert.deepEqual(props.Size, [0.4, 0, 0, 0])
    assert.equal(props.AutomaticSize, 'Y')

    const names = helpers.map((helper) => helper.class)
    assert.ok(names.includes('UISizeConstraint'))
    assert.ok(names.includes('UIPadding'))
    assert.ok(names.includes('UIListLayout'))
  })

  it('fills without growing and hugs without a size', () => {
    assert.deepEqual(resolveLayout({ width: 'fill' }, false).props.Size, [1, 0, 0, 0])
    assert.equal(resolveLayout({ width: 'fill' }, false).props.AutomaticSize, 'Y')
    assert.equal(resolveLayout({ height: 'hug' }, false).props.AutomaticSize, 'XY')
  })

  it('does not arrange children that are not there', () => {
    assert.equal(resolveLayout({ direction: 'vertical' }, false).helpers.length, 0)
  })
})

describe('interface compiler', () => {
  const screen: { path: string; tree: UiNode; theme?: Record<string, string> } = {
    path: 'StarterGui.Shop',
    tree: {
      class: 'ScreenGui',
      style: 'screen',
      children: [
        {
          class: 'Frame',
          name: 'Panel',
          style: 'panel',
          layout: { anchor: 'center', width: { scale: 0.4, max: 520 }, height: 'hug' },
          children: [
            { class: 'TextLabel', name: 'Title', text: 'Loja', style: 'title' },
            { class: 'TextButton', name: 'Buy', text: 'Comprar', style: 'primary' },
          ],
        },
      ],
    },
  }

  it('builds the screen in one recorded transaction', () => {
    const { luau, count } = compileUi(screen)

    assert.equal(count, 4)
    assert.equal((luau.match(/TryBeginRecording/g) ?? []).length, 1)
    assert.ok(luau.includes('ensure(parent, "Shop", "ScreenGui")'))
    assert.ok(luau.includes('"Panel", "Frame"'))
    assert.ok(luau.includes('.Text = "Comprar"'))
  })

  it('applies the style without being told the properties', () => {
    const { luau } = compileUi(screen)

    assert.ok(luau.includes('Enum.Font.GothamBold'))
    assert.ok(luau.includes('"Corner", "UICorner"'))
    assert.ok(luau.includes('Color3.fromRGB(108, 92, 231)'))
  })

  it('writes the state script only when something reacts', () => {
    const { luau } = compileUi(screen)
    assert.ok(luau.includes('"UIStates", "LocalScript"'))

    const source = /states\.Source = "(.*)"$/m.exec(luau)?.[1] ?? ''
    assert.ok(source.length > 100)
    assert.ok(!source.includes('\n'), 'the source is one escaped literal, not raw lines')
    assert.ok(source.includes('Panel/Buy'), 'paths start below the screen the script sits in')
    assert.ok(luau.includes('prune(n1, { ["UIStates"] = true'), 'the script survives a rebuild')

    const quiet = compileUi({
      path: 'StarterGui.Plain',
      tree: { class: 'ScreenGui', children: [{ class: 'Frame', name: 'Box' }] },
    })
    assert.ok(!quiet.luau.includes('LocalScript'))
    assert.ok(quiet.luau.includes('stale:Destroy()'))
  })

  it('only prunes what it made', () => {
    const { luau } = compileUi(screen)

    assert.ok(luau.includes('SetAttribute("jstudio_ui", true)'))
    assert.ok(luau.includes('child:GetAttribute("jstudio_ui")'))
    assert.ok(luau.includes('prune(n1, { ["UIStates"] = true, ["Panel"] = true })'))
  })

  it('takes a palette for the place without writing a module', () => {
    const { luau } = compileUi({ ...screen, theme: { primary: '#FF0000' } })

    assert.ok(luau.includes('Color3.fromRGB(255, 0, 0)'))
    assert.ok(!luau.includes('ModuleScript'))
  })

  it('reports what it could not write instead of failing silently', () => {
    const { skipped } = compileUi({
      path: 'StarterGui.Odd',
      tree: { class: 'Frame', props: { Elevation: 2 }, style: 'nope' },
    })

    assert.ok(skipped.includes('Frame.Elevation'))
    assert.ok(skipped.some((entry) => entry.includes('nope')))
  })

  it('escapes text so it cannot break out of the script', () => {
    const { luau } = compileUi({
      path: 'StarterGui.Hack',
      tree: { class: 'TextLabel', text: 'a") end) os.exit(' },
    })

    assert.ok(!luau.includes('os.exit('.concat(')')))
    assert.ok(luau.includes('\\"'))
  })

  it('ships a style for every part of a screen', () => {
    for (const name of ['panel', 'title', 'primary', 'input', 'card', 'divider']) {
      assert.ok(styles[name], name)
    }
  })
})

describe('web', () => {
  it('keeps the article and drops the furniture', () => {
    const page = readable(
      '<html><head><title>Docs — API</title></head><body><nav>menu menu</nav>' +
        '<h1>Animator</h1><p>Loads a track.</p><script>evil()</script>' +
        '<ul><li>one</li><li>two</li></ul><footer>legal</footer></body></html>'
    )

    assert.equal(page.title, 'Docs — API')
    assert.ok(page.text.includes('Animator'))
    assert.ok(page.text.includes('- one'))
    assert.ok(!page.text.includes('evil'))
    assert.ok(!page.text.includes('menu'))
    assert.ok(!page.text.includes('legal'))
  })

  it('decodes the entities a page actually carries', () => {
    assert.equal(readable('<p>a &amp; b &mdash; c&#39;s</p>').text, "a & b — c's")
  })
})

describe('tool weight', () => {
  it('keeps a whole sentence and drops the rest', () => {
    const long = `${'First sentence. '.repeat(3)}${'and then a very long tail '.repeat(20)}`
    const slim = slimDescription(long)

    assert.ok(slim.length <= 241)
    assert.ok(slim.startsWith('First sentence.'))
  })

  it('strips schema padding without breaking the shape', () => {
    const schema = slimSchema({
      $schema: 'https://json-schema.org/draft-07/schema',
      title: 'Ignored',
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'x'.repeat(400), examples: ['a', 'b'], default: '' },
      },
      required: ['path'],
    }) as Record<string, Record<string, Record<string, { type: string; description: string; examples?: unknown }>>> &
      Record<string, unknown>

    const path = schema.properties?.path as unknown as { type: string; description: string; examples?: unknown }

    assert.equal(schema.type, 'object')
    assert.equal(schema.$schema, undefined)
    assert.equal(schema.title, undefined)
    assert.equal(path.type, 'string')
    assert.equal(path.examples, undefined)
    assert.ok(path.description.length <= 121)
    assert.deepEqual(schema.required, ['path'])
  })

  it('measures what a turn actually carries', () => {
    const before = toolSize([{ name: 'a', description: 'x'.repeat(2000), parameters: {} }])
    const after = toolSize([{ name: 'a', description: slimDescription('x'.repeat(2000)), parameters: {} }])
    assert.ok(after < before)
  })
})

describe('prompt', () => {
  it('tells the model to look instead of guessing', () => {
    const text = buildSystemPrompt({
      nodes: [],
      truncated: false,
      attached: [],
      selection: [],
      skills: [],
      studioMcp: true,
      plan: false,
      instructions: '',
      person: '',
      memories: [],
      references: [],
      agents: [],
    })

    assert.ok(text.includes('answered by looking, not by guessing'))
    assert.ok(text.includes('Finish what you start writing'))
  })

  const nodes = [
    { path: 'ServerScriptService.A', className: 'Script', source: 'print("a")' },
    { path: 'ServerScriptService.B', className: 'Script', source: 'print("b")' },
  ]

  it('inlines only the attached scripts when the person named some', () => {
    const text = describeProject(nodes, false, ['ServerScriptService.A'])
    assert.ok(text.includes('print("a")'))
    assert.ok(!text.includes('print("b")'))
    assert.ok(text.includes('ServerScriptService.B'))
  })

  it('tells the model when Studio is not connected', () => {
    const base = {
      nodes,
      truncated: false,
      attached: [],
      selection: [],
      skills: [],
      plan: false,
      instructions: '',
      person: '',
      memories: [],
      references: [],
      agents: [],
    }

    assert.ok(buildSystemPrompt({ ...base, studioMcp: false }).includes('not connected'))
    assert.ok(buildSystemPrompt({ ...base, studioMcp: true }).includes('listRobloxStudios'))
  })

  it('carries the current Studio selection', () => {
    const text = buildSystemPrompt({
      nodes,
      truncated: false,
      attached: [],
      selection: ['Workspace.Arena'],
      skills: [],
      studioMcp: true,
      plan: false,
      instructions: '',
      person: '',
      memories: [],
      references: [],
      agents: [],
    })

    assert.ok(text.includes('Workspace.Arena'))
  })
})

describe('prompt parts', () => {
  it('splits the prompt into the pieces the app shows', () => {
    const parts = promptParts({
      nodes: [{ path: 'Workspace.A', className: 'Part' }],
      truncated: false,
      attached: [],
      selection: [],
      skills: [],
      studioMcp: true,
      plan: false,
      instructions: 'be brief',
      person: '',
      memories: ['likes folders'],
      references: [],
      agents: [],
    })

    const keys = parts.map((part) => part.key)
    assert.deepEqual(keys, ['prompt', 'memory', 'place'])
    assert.ok(parts.every((part) => part.text.length > 0))
  })
})

describe('skills', () => {
  it('ships one skill per area, each with real instructions', () => {
    const names = builtinSkills.map((entry) => entry.name)

    assert.equal(new Set(names).size, names.length, 'no two skills share a name')
    assert.ok(builtinSkills.length >= 8)

    for (const skill of builtinSkills) {
      assert.match(skill.name, /^[a-z][a-z-]+$/, skill.name)
      assert.ok(skill.description.length > 20 && skill.description.length < 90, skill.name)
      assert.ok(skill.instructions.split('\n').filter((line) => line.startsWith('- ')).length >= 5, skill.name)
      assert.equal(skill.builtin, true)
    }
  })

  it('keeps the choice the person made on a builtin', () => {
    const merged = mergeSkills([{ ...builtinSkills[0]!, enabled: false }])
    assert.equal(merged[0]?.enabled, false)
    assert.equal(merged.length, builtinSkills.length)
  })

  it('drops anything pretending to be a builtin', () => {
    const merged = mergeSkills([
      { id: 'builtin.fake', name: 'x', description: '', instructions: 'y', enabled: true, builtin: false },
    ])
    assert.equal(merged.some((entry) => entry.id === 'builtin.fake'), false)
  })

  it('only sends enabled instructions to the prompt', () => {
    const text = activeInstructions([
      { id: 'a', name: 'On', description: '', instructions: 'yes', enabled: true, builtin: false },
      { id: 'b', name: 'Off', description: '', instructions: 'no', enabled: false, builtin: false },
    ])
    assert.ok(text.includes('yes'))
    assert.ok(!text.includes('no'))
  })
})

describe('apply', () => {
  it('escapes place content so it cannot break out of the Luau literal', () => {
    const luau = luauFor({
      kind: 'script',
      path: 'ServerScriptService.Hack',
      className: 'Script',
      source: 'print("a") end) os.exit(\n',
      summary: 'ok',
    })

    assert.ok(luau.includes('\\"a\\"'), 'quotes stay escaped')
    assert.ok(!luau.includes('\n      summary'), 'no raw newline escapes the literal')
    assert.ok(luau.includes('TryBeginRecording'))
  })

  it('writes only the properties the proposal carries', () => {
    const luau = luauFor({
      kind: 'instance',
      path: 'Workspace.Platform',
      className: 'Part',
      summary: 'ok',
      anchored: true,
      size: [4, 1, 4],
    })

    assert.ok(luau.includes('instance.Size = Vector3.new(4, 1, 4)'))
    assert.ok(luau.includes('instance.Anchored = true'))
    assert.ok(!luau.includes('instance.Transparency'))
  })

  it('creates missing interface ancestors as a ScreenGui, not a Folder', () => {
    const gui = luauFor({
      kind: 'instance',
      path: 'StarterGui.Shop.Panel',
      className: 'Frame',
      summary: 'ok',
    })
    assert.ok(gui.includes('"ScreenGui"'))

    const world = luauFor({
      kind: 'instance',
      path: 'Workspace.Arena.Platform',
      className: 'Part',
      summary: 'ok',
    })
    assert.ok(world.includes('"Model"'))
  })

  it('reports the properties Studio refused instead of swallowing them', () => {
    const luau = luauFor({
      kind: 'instance',
      path: 'Workspace.Thing',
      className: 'Part',
      summary: 'ok',
      material: 'Neon',
    })

    assert.ok(luau.includes('table.insert(skipped'))
    assert.ok(luau.includes('skipped: '))
  })

  it('leaves the selection alone unless asked to reveal the change', () => {
    const quiet = luauFor({ kind: 'delete', path: 'Workspace.Old', summary: 'ok' })
    assert.ok(!quiet.includes('Selection'))

    const loud = luauFor(
      { kind: 'script', path: 'Workspace.S', className: 'Script', source: 'print(1)', summary: 'ok' },
      true
    )
    assert.ok(loud.includes('Selection'))
  })
})
