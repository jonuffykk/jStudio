import { resolveLayout, type Layout } from './geometry.ts'
import { styles } from './styles.ts'
import { theme, type Theme } from './theme.ts'
import { classes, encode, writeProps, type Value } from './values.ts'

export type UiNode = {
  class: string
  name?: string
  text?: string
  style?: string
  props?: Record<string, Value>
  layout?: Layout
  states?: Record<string, Record<string, Value>>
  children?: UiNode[]
}

export type Compiled = { luau: string; skipped: string[]; count: number }

const MARK = 'jstudio_ui'

const quote = (value: string) =>
  `"${value
    .replace(/[\\\"]/g, '\\$&')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}"`

const textClasses = new Set(['TextLabel', 'TextButton', 'TextBox'])

/** A name that is stable, unique among siblings and readable in the Explorer. */
function nameOf(node: UiNode, taken: Set<string>): string {
  const wanted = (node.name ?? node.text ?? node.class)
    .replace(/[^A-Za-z0-9_ ]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')

  const base = wanted || node.class
  let name = base
  let index = 2

  while (taken.has(name)) name = `${base}${index++}`
  taken.add(name)
  return name
}

const helpers = `
local function ensure(parent, name, class)
	local found = parent:FindFirstChild(name)
	if found and found.ClassName ~= class then
		found:Destroy()
		found = nil
	end
	if not found then
		found = Instance.new(class)
		found.Name = name
		found.Parent = parent
	end
	found:SetAttribute("${MARK}", true)
	return found
end

local function prune(parent, keep)
	for _, child in ipairs(parent:GetChildren()) do
		if child:GetAttribute("${MARK}") and not keep[child.Name] then
			child:Destroy()
		end
	end
end`

type Walk = {
  lines: string[]
  skipped: string[]
  states: string[]
  count: number
  palette: Theme
}

function emit(
  node: UiNode,
  parent: string,
  id: number,
  path: string[],
  walk: Walk,
  reserved: string[] = []
): number {
  const preset = node.style ? styles[node.style] : undefined
  if (node.style && !preset) walk.skipped.push(`style "${node.style}"`)

  const variable = `n${id}`
  const siblings = new Set<string>(reserved)
  const name = nameOf(node, new Set())

  walk.count += 1
  walk.lines.push(`local ${variable} = ensure(${parent}, ${quote(name)}, ${quote(node.class)})`)

  const layout = { ...preset?.layout, ...node.layout }
  const resolved = resolveLayout(layout, (node.children?.length ?? 0) > 0)

  const props: Record<string, Value> = {
    ...preset?.props,
    ...resolved.props,
    ...(node.text !== undefined && textClasses.has(node.class) ? { Text: node.text } : {}),
    ...node.props,
  }

  const written = writeProps(variable, node.class, props, walk.palette)
  walk.lines.push(...written.lines)
  walk.skipped.push(...written.skipped)

  const attachments = [...(preset?.helpers ?? []), ...resolved.helpers]
  let next = id + 1

  for (const helper of attachments) {
    if (!classes[helper.class]) {
      walk.skipped.push(helper.class)
      continue
    }

    const child = `n${next++}`
    siblings.add(helper.name)
    walk.lines.push(`local ${child} = ensure(${variable}, ${quote(helper.name)}, ${quote(helper.class)})`)

    const helperProps = writeProps(child, helper.class, helper.props, walk.palette)
    walk.lines.push(...helperProps.lines)
    walk.skipped.push(...helperProps.skipped)
  }

  const states = { ...preset?.states, ...node.states }
  if (Object.keys(states).length > 0) {
    const entries = Object.entries(states)
      .map(([state, values]) => {
        const fields = Object.entries(values)
          .map(([property, value]) => {
            const kind = classes[node.class]?.[property]
            const literal = kind ? encode(kind, value, walk.palette) : null
            if (!literal) {
              walk.skipped.push(`${node.class}.${property}`)
              return ''
            }
            return `${property} = ${literal}`
          })
          .filter(Boolean)

        return fields.length > 0 ? `\t\t${state} = { ${fields.join(', ')} },` : ''
      })
      .filter(Boolean)

    if (entries.length > 0) {
      const inside = [...path.slice(1), name].join('/')
      walk.states.push(`\t[${quote(inside)}] = {\n${entries.join('\n')}\n\t},`)
    }
  }

  for (const child of node.children ?? []) {
    const childName = nameOf(child, siblings)
    next = emit({ ...child, name: childName }, variable, next, [...path, name], walk)
  }

  const keep = [...siblings].map((entry) => `[${quote(entry)}] = true`).join(', ')
  walk.lines.push(`prune(${variable}, { ${keep} })`)

  return next
}

/** A tiny open script, written only when something actually reacts. */
function stateScript(entries: string[]): string {
  return `local TweenService = game:GetService("TweenService")
local root = script.Parent
local info = TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

local states = {
${entries.join('\n')}
}

local function find(path)
	local target = root
	for _, name in ipairs(string.split(path, "/")) do
		if not target then return nil end
		target = target:FindFirstChild(name)
	end
	return target
end

for path, set in pairs(states) do
	local target = find(path)
	if target and target:IsA("GuiObject") then
		local base = {}
		for _, values in pairs(set) do
			for property in pairs(values) do
				base[property] = target[property]
			end
		end

		local function to(values)
			TweenService:Create(target, info, values or base):Play()
		end

		local inside = false
		target.MouseEnter:Connect(function()
			inside = true
			to(set.Hover)
		end)
		target.MouseLeave:Connect(function()
			inside = false
			to(nil)
		end)

		if target:IsA("GuiButton") then
			target.MouseButton1Down:Connect(function()
				to(set.Pressed or set.Hover)
			end)
			target.MouseButton1Up:Connect(function()
				to(inside and set.Hover or nil)
			end)
		end
	end
end`
}

/**
 * One screen, one transaction. Names that already exist are reused, classes that
 * changed are replaced, and only what this tool created can be pruned — anything
 * added by hand in Studio stays where it is.
 */
export function compileUi(input: {
  path: string
  tree: UiNode
  theme?: Theme
  summary?: string
}): Compiled {
  const palette = { ...theme, ...input.theme }
  const walk: Walk = { lines: [], skipped: [], states: [], count: 0, palette }

  const root = input.path.split('.').pop() ?? 'Screen'
  emit({ ...input.tree, name: root }, 'parent', 1, [], walk, ['UIStates'])

  const script =
    walk.states.length > 0
      ? `\tlocal states = ensure(n1, "UIStates", "LocalScript")\n\tstates.Source = ${quote(
          stateScript(walk.states)
        )}`
      : '\tlocal stale = n1:FindFirstChild(\"UIStates\")\n\tif stale then stale:Destroy() end'

  const body = walk.lines.map((line) => `\t${line}`).join('\n')

  const luau = `local ChangeHistoryService = game:GetService("ChangeHistoryService")
${helpers}

local function resolve(path)
	local current = game
	local parts = string.split(path, ".")
	for index, name in ipairs(parts) do
		if index == #parts then return current, name end
		local ok, service = pcall(function() return game:GetService(name) end)
		local child = (index == 1 and ok and service) or current:FindFirstChild(name)
		if not child then
			child = Instance.new("Folder")
			child.Name = name
			child.Parent = current
		end
		current = child
	end
	return current, parts[#parts]
end

local parent, rootName = resolve(${quote(input.path)})
local recording = ChangeHistoryService:TryBeginRecording("jStudio: interface")

local ok, message = pcall(function()
${body}
${script}
	return "built " .. rootName
end)

if recording then
	ChangeHistoryService:FinishRecording(
		recording,
		ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
	)
end

if not ok then error(message, 0) end
return message`

  return { luau, skipped: [...new Set(walk.skipped)], count: walk.count }
}
