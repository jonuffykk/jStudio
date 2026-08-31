import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { luauFor } from './luau.ts'
import { action, settings, spoofOptions } from './schemas.ts'
import { dictionaries, translate } from './i18n.ts'
import { pickDefaultModel, usableForCode } from './providers.ts'
import { activeInstructions, builtinSkills, mergeSkills } from './skills.ts'

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
    const parsed = action.safeParse({
      kind: 'delete',
      path: '../../etc/passwd',
      summary: 'nope',
    })
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

describe('providers', () => {
  it('prefers the strongest coding model available', () => {
    assert.equal(pickDefaultModel(['llama-3.3-70b', 'claude-opus-5', 'gpt-5']), 'claude-opus-5')
    assert.equal(pickDefaultModel(['whatever']), 'whatever')
    assert.equal(pickDefaultModel([]), '')
  })

  it('filters out models that cannot write code', () => {
    assert.equal(usableForCode('whisper-large'), false)
    assert.equal(usableForCode('qwen-2.5-coder'), true)
  })
})

describe('skills', () => {
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
})
