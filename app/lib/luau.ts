import { compileUi } from './ui/compile.ts'
import type { Action } from '@/app/lib/schemas'

function quote(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
}

const list = (values: number[]) => values.join(', ')

/** Services whose children are known to need a specific container class. */
const containerFor: Record<string, string> = {
  StarterGui: 'ScreenGui',
  StarterPack: 'Folder',
  Workspace: 'Model',
}

function propertyLines(action: Extract<Action, { kind: 'instance' }>): string[] {
  const lines: string[] = []

  if (action.position) lines.push(`instance.Position = Vector3.new(${list(action.position)})`)
  if (action.size) lines.push(`instance.Size = Vector3.new(${list(action.size)})`)
  if (action.color) lines.push(`instance.Color = Color3.new(${list(action.color)})`)
  if (action.anchored !== undefined) lines.push(`instance.Anchored = ${action.anchored}`)
  if (action.material) lines.push(`instance.Material = Enum.Material[${quote(action.material)}]`)
  if (action.transparency !== undefined) lines.push(`instance.Transparency = ${action.transparency}`)
  if (action.text !== undefined) lines.push(`instance.Text = ${quote(action.text)}`)
  if (action.uiSize) lines.push(`instance.Size = UDim2.new(${list(action.uiSize)})`)
  if (action.uiPosition) lines.push(`instance.Position = UDim2.new(${list(action.uiPosition)})`)

  return lines.map(
    (line) => `local ok, why = pcall(function() ${line} end)
	if not ok then table.insert(skipped, why) end`
  )
}

const resolver = `
local skipped = {}

local function resolve(path, create, className, containerClass)
	local current = game
	local parts = string.split(path, ".")
	for index, name in ipairs(parts) do
		local child
		if index == 1 then
			local ok, service = pcall(function() return game:GetService(name) end)
			child = ok and service or game:FindFirstChild(name)
		else
			child = current:FindFirstChild(name)
		end
		if not child then
			if not create then return nil end
			child = Instance.new(index == #parts and className or containerClass)
			child.Name = name
			child.Parent = current
		end
		current = child
	end
	return current
end`

export function luauFor(action: Action, select = false): string {
  if (action.kind === 'ui') {
    return compileUi({ path: action.path, tree: action.tree, theme: action.theme }).luau
  }

  const path = quote(action.path)
  const root = action.path.split('.')[0] ?? ''
  const container = quote(containerFor[root] ?? 'Folder')
  const reveal = select ? `\n\tgame:GetService("Selection"):Set({ instance })` : ''

  const body =
    action.kind === 'script'
      ? `	local instance = resolve(${path}, true, ${quote(action.className)}, ${container})
	if instance.ClassName ~= ${quote(action.className)} then
		local replacement = Instance.new(${quote(action.className)})
		replacement.Name = instance.Name
		replacement.Parent = instance.Parent
		instance:Destroy()
		instance = replacement
	end
	instance.Source = ${quote(action.source)}${reveal}
	return "wrote " .. ${path}`
      : action.kind === 'instance'
        ? `	local instance = resolve(${path}, true, ${quote(action.className)}, ${container})
${propertyLines(action)
  .map((line) => `\t${line}`)
  .join('\n')}${reveal}
	return "built " .. ${path}`
        : `	local instance = resolve(${path}, false)
	if not instance then error("nothing at " .. ${path}) end
	instance:Destroy()
	return "removed " .. ${path}`

  return `${resolver}

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local recording = ChangeHistoryService:TryBeginRecording("jStudio: ${action.kind}")
local ok, message = pcall(function()
${body}
end)
if recording then
	ChangeHistoryService:FinishRecording(
		recording,
		ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
	)
end
if not ok then error(message, 0) end
if #skipped > 0 then
	return message .. " (skipped: " .. table.concat(skipped, "; ") .. ")"
end
return message`
}
