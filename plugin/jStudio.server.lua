local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local MarketplaceService = game:GetService("MarketplaceService")
local Selection = game:GetService("Selection")
local RunService = game:GetService("RunService")

local PLUGIN_VERSION = "1.0.6"
local FIRST_PORT = 8712
local LAST_PORT = 8719
local MAX_NODES = 4000
local MAX_SOURCE = 60000
local SCAN_BATCH = 40
local IDLE_DELAY = 1
local ANIMATION_ASSET_TYPE = 24
local SCAN_YIELD_EVERY = 150
-- Scripts often carry the animation as a bare number ("AnimationId = 1234567890"). Any digit run
-- this long that is not glued to an identifier is a candidate; MarketplaceService then confirms
-- whether it really is an animation.
local MIN_BARE_ID_DIGITS = 8
local EXPLICIT_PREFIXES = { "rbxassetid://$", "[?&]id=$", "assetid=$", "asset/%?id=$" }

local GENERIC_NAMES = {
	id = true,
	animationid = true,
	animid = true,
	anim = true,
	animation = true,
	value = true,
	url = true,
}

local SCRIPT_CLASSES = { Script = true, LocalScript = true, ModuleScript = true }

local TREE_SERVICES = {
	"Workspace",
	"Players",
	"ReplicatedStorage",
	"ReplicatedFirst",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"SoundService",
	"Lighting",
}

local toolbar = plugin:CreateToolbar("jStudio")
local connectButton = toolbar:CreateButton("jStudio", "Connect this place to jStudio", "rbxassetid://79755648663792")
local syncButton = toolbar:CreateButton("Sync tree", "Send the place tree to jStudio now", "rbxassetid://79755648663792")
local scanButton = toolbar:CreateButton("Scan selection", "Scan the current selection for animations", "rbxassetid://79755648663792")

connectButton.ClickableWhenViewportHidden = true
syncButton.ClickableWhenViewportHidden = true
scanButton.ClickableWhenViewportHidden = true

local active = false
local port = FIRST_PORT
local lastMappingToken = nil
local pendingSelectionCount = -1

local function baseUrl()
	return string.format("http://127.0.0.1:%d", port)
end

local function send(path, method, body)
	local request = {
		Url = baseUrl() .. path,
		Method = method,
		Headers = { ["x-jstudio"] = PLUGIN_VERSION, ["Content-Type"] = "application/json" },
	}
	if body ~= nil then
		request.Body = HttpService:JSONEncode(body)
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync(request)
	end)
	if not ok or not response.Success then
		return nil
	end

	local decoded
	ok, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	return ok and decoded or nil
end

local function findPort()
	for candidate = FIRST_PORT, LAST_PORT do
		port = candidate
		local reply = send("/hello", "POST", {
			placeId = tostring(game.PlaceId),
			placeName = game.Name,
			pluginVersion = PLUGIN_VERSION,
		})
		if reply and reply.ok then
			return true
		end
	end
	return false
end

local function collectNodes()
	local nodes = {}
	local truncated = false

	local function walk(instance, path)
		if #nodes >= MAX_NODES then
			truncated = true
			return
		end

		local node = { path = path, className = instance.ClassName }
		if SCRIPT_CLASSES[instance.ClassName] then
			local ok, source = pcall(function()
				return instance.Source
			end)
			if ok and #source <= MAX_SOURCE then
				node.source = source
			end
		end
		table.insert(nodes, node)

		for _, child in ipairs(instance:GetChildren()) do
			walk(child, path .. "." .. child.Name)
		end
	end

	for _, name in ipairs(TREE_SERVICES) do
		local ok, service = pcall(function()
			return game:GetService(name)
		end)
		if ok and service then
			walk(service, name)
		end
	end

	return nodes, truncated
end

local function syncTree()
	local nodes, truncated = collectNodes()
	send("/tree", "POST", { nodes = nodes, truncated = truncated })
end

local function resolveByPath(path, create, className)
	local parts = string.split(path, ".")
	local current = game

	for index, name in ipairs(parts) do
		local isLast = index == #parts
		local child

		if index == 1 then
			local ok, service = pcall(function()
				return game:GetService(name)
			end)
			child = ok and service or game:FindFirstChild(name)
		else
			child = current:FindFirstChild(name)
		end

		if not child then
			if not create then
				return nil
			end
			child = Instance.new(isLast and className or "Folder")
			child.Name = name
			child.Parent = current
		end
		current = child
	end

	return current
end

local function toColor(value)
	return Color3.new(value[1] or 0, value[2] or 0, value[3] or 0)
end

local function toUDim2(value)
	return UDim2.new(value[1] or 0, value[2] or 0, value[3] or 0, value[4] or 0)
end

local function applyProperties(instance, payload)
	local setters = {
		position = function(value)
			instance.Position = Vector3.new(value[1], value[2], value[3])
		end,
		size = function(value)
			instance.Size = Vector3.new(value[1], value[2], value[3])
		end,
		color = function(value)
			instance.Color = toColor(value)
		end,
		anchored = function(value)
			instance.Anchored = value
		end,
		material = function(value)
			instance.Material = Enum.Material[value]
		end,
		transparency = function(value)
			instance.Transparency = value
		end,
		text = function(value)
			instance.Text = value
		end,
		uiSize = function(value)
			instance.Size = toUDim2(value)
		end,
		uiPosition = function(value)
			instance.Position = toUDim2(value)
		end,
	}

	for key, apply in pairs(setters) do
		if payload[key] ~= nil then
			pcall(apply, payload[key])
		end
	end
end

local function applyJob(job)
	local recording = ChangeHistoryService:TryBeginRecording("jStudio: " .. job.kind)
	local ok, message = pcall(function()
		local payload = job.payload

		if job.kind == "script" then
			local instance = resolveByPath(payload.path, true, payload.className)
			if instance.ClassName ~= payload.className then
				local replacement = Instance.new(payload.className)
				replacement.Name = instance.Name
				replacement.Parent = instance.Parent
				instance:Destroy()
				instance = replacement
			end
			instance.Source = payload.source
			Selection:Set({ instance })
			return "wrote " .. payload.path
		end

		if job.kind == "instance" then
			local instance = resolveByPath(payload.path, true, payload.className)
			applyProperties(instance, payload)
			Selection:Set({ instance })
			return "built " .. payload.path
		end

		if job.kind == "delete" then
			local instance = resolveByPath(payload.path, false)
			if not instance then
				error("nothing at " .. payload.path)
			end
			instance:Destroy()
			return "removed " .. payload.path
		end

		error("unknown job kind " .. tostring(job.kind))
	end)

	if recording then
		if ok then
			ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
		else
			ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Cancel)
		end
	end

	send("/result", "POST", {
		id = job.id,
		status = ok and "done" or "error",
		message = tostring(message),
	})
end

local function scanRoots(selectedOnly)
	local scope, seen = {}, {}
	local function add(instance)
		if not seen[instance] then
			seen[instance] = true
			table.insert(scope, instance)
		end
	end

	if selectedOnly then
		for _, instance in ipairs(Selection:Get()) do
			add(instance)
			for _, descendant in ipairs(instance:GetDescendants()) do
				add(descendant)
			end
		end
		return scope
	end

	for _, name in ipairs(TREE_SERVICES) do
		local ok, service = pcall(function()
			return game:GetService(name)
		end)
		if ok and service then
			add(service)
			for _, descendant in ipairs(service:GetDescendants()) do
				add(descendant)
			end
		end
	end
	return scope
end

local function sourceOf(instance)
	local ok, source = pcall(function()
		return instance.Source
	end)
	return ok and source or nil
end

local function animationIdOf(instance)
	local raw = instance.AnimationId
	return raw and string.match(raw, "%d+") or nil
end

-- Walks every asset-id-looking token in a source file. Explicit references (rbxassetid://, ?id=)
-- always count; bare numbers need MIN_BARE_ID_DIGITS and must not be part of a longer identifier
-- or a decimal number.
local function eachSourceId(source, visit)
	local cursor = 1
	while true do
		local first, last = string.find(source, "%d+", cursor)
		if not first then
			return
		end
		cursor = last + 1

		local before = string.sub(source, math.max(1, first - 16), first - 1)
		local previous = first > 1 and string.sub(source, first - 1, first - 1) or ""
		local following = string.sub(source, last + 1, last + 1)

		local explicit = false
		for _, prefix in ipairs(EXPLICIT_PREFIXES) do
			if string.find(before, prefix) then
				explicit = true
				break
			end
		end

		local glued = string.match(previous, "[%w_%.]") ~= nil or string.match(following, "[%w_%.]") ~= nil
		if explicit or (not glued and (last - first + 1) >= MIN_BARE_ID_DIGITS) then
			visit(string.sub(source, first, last), first)
		end
	end
end

-- Names the animation after the closest assignment target to the left of the id on the same line,
-- so `Roll = 3333333333, ["Slide Left"] = 4444444444` names each id correctly instead of reusing
-- the first key on the line.
local function variableNameFor(source, position)
	if not position then
		return nil
	end
	local lineStart = select(2, string.find(string.sub(source, 1, position - 1), ".*\n")) or 0
	local prefix = string.sub(source, lineStart + 1, position - 1)

	local name, nameAt = nil, -1
	local function scan(pattern)
		local cursor = 1
		while true do
			local first, last, capture = string.find(prefix, pattern, cursor)
			if not first then
				return
			end
			local comparison = string.sub(prefix, last + 1, last + 1) == "="
				or string.match(string.sub(prefix, last - 1, last - 1), "[=~<>]") ~= nil
			if not comparison and first > nameAt then
				name, nameAt = capture, first
			end
			cursor = last + 1
		end
	end

	scan("%[%s*['\"]([%w_ ]+)['\"]%s*%]%s*=")
	scan("([%a_][%w_]*)%s*=")

	if not name then
		return nil
	end
	name = string.match(name, "^%s*(.-)%s*$")
	if name == "" or GENERIC_NAMES[string.lower(name)] then
		return nil
	end
	return name
end

-- A scan line is `id - name - K: creatorId`, so a name may not carry either delimiter.
local function cleanName(name)
	name = string.gsub(name, "%s*%-%s*", " ")
	name = string.gsub(name, ":", ";")
	name = string.gsub(name, "%s+", " ")
	return (string.match(name, "^%s*(.-)%s*$"))
end

local function creatorOf(info)
	local creator = info.Creator or {}
	local kind = string.sub(creator.CreatorType or "User", 1, 1)
	return kind, tostring(creator.CreatorTargetId or creator.Id or 0)
end

local function resolveName(useInstanceNames, info, instanceName, source, position)
	if not useInstanceNames then
		return info.Name or "Unknown"
	end
	if instanceName and instanceName ~= "" and instanceName ~= "Animation" then
		return instanceName
	end
	if source then
		local variable = variableNameFor(source, position)
		if variable then
			return variable
		end
	end
	return info.Name or "Unknown"
end

local function eachAnimationReference(objects, visit)
	local seen = {}
	for index, instance in ipairs(objects) do
		if index % SCAN_YIELD_EVERY == 0 then
			task.wait()
		end

		if instance:IsA("Animation") then
			local assetId = animationIdOf(instance)
			if assetId and not seen[assetId] then
				seen[assetId] = true
				visit(assetId, instance.Name, nil, nil)
			end
		elseif instance:IsA("LuaSourceContainer") then
			local source = sourceOf(instance)
			if source and source ~= "" then
				eachSourceId(source, function(assetId, position)
					if not seen[assetId] then
						seen[assetId] = true
						visit(assetId, nil, source, position)
					end
				end)
			end
		end
	end
end

local function runScan(request)
	local objects = (request.selectedOnly and #Selection:Get() == 0) and {} or scanRoots(request.selectedOnly)
	local batch = {}

	local function flush(force)
		if #batch == 0 or (not force and #batch < SCAN_BATCH) then
			return
		end
		send("/scan", "POST", { status = "streaming", results = batch })
		batch = {}
		task.wait()
	end

	eachAnimationReference(objects, function(assetId, instanceName, source, position)
		-- An id that looks like an asset is not necessarily an animation, and treating a decal or a
		-- sound as one is where the old scanner produced its failures.
		local ok, info = pcall(function()
			return MarketplaceService:GetProductInfo(tonumber(assetId))
		end)
		if not ok or not info or info.AssetTypeId ~= ANIMATION_ASSET_TYPE then
			return
		end

		local kind, creatorId = creatorOf(info)
		local name = cleanName(resolveName(request.useInstanceNames, info, instanceName, source, position))
		table.insert(batch, string.format("%s - %s - %s: %s", assetId, name, kind, creatorId))
		flush(false)
	end)

	flush(true)
	send("/scan", "POST", { status = "completed", results = {} })
end

-- Rewrites every id token the scanner would have picked up, so bare numeric references are swapped
-- exactly like rbxassetid:// ones and their surrounding formatting survives.
local function replaceInSource(source, map)
	local pieces, cursor, changed = {}, 1, false
	eachSourceId(source, function(assetId, position)
		local newId = map[assetId]
		if not newId then
			return
		end
		table.insert(pieces, string.sub(source, cursor, position - 1))
		table.insert(pieces, newId)
		cursor = position + #assetId
		changed = true
	end)
	if not changed then
		return source, false
	end
	table.insert(pieces, string.sub(source, cursor))
	return table.concat(pieces), true
end

local function applyMappings(push)
	if push.token == lastMappingToken then
		return
	end
	lastMappingToken = push.token

	local map = {}
	for _, line in ipairs(push.lines) do
		local from, to = string.match(line, "(%d+)=(%d+)")
		if from and to and from ~= to then
			map[from] = to
		end
	end
	if not next(map) then
		send("/replace", "POST", { replacedCount = 0 })
		return
	end

	local replaced = 0
	local recording = ChangeHistoryService:TryBeginRecording("jStudio: replace animation ids")

	for index, instance in ipairs(scanRoots(false)) do
		if index % SCAN_YIELD_EVERY == 0 then
			task.wait()
		end

		if instance:IsA("Animation") then
			local assetId = animationIdOf(instance)
			if assetId and map[assetId] then
				instance.AnimationId = "rbxassetid://" .. map[assetId]
				replaced += 1
			end
		elseif instance:IsA("LuaSourceContainer") then
			local source = sourceOf(instance)
			if source and source ~= "" then
				local updated, changed = replaceInSource(source, map)
				if changed then
					instance.Source = updated
					replaced += 1
				end
			end
		end
	end

	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	send("/replace", "POST", { replacedCount = replaced })
end

local function reportSelection()
	local count = 0
	if #Selection:Get() > 0 then
		eachAnimationReference(scanRoots(true), function()
			count += 1
		end)
	end
	if count ~= pendingSelectionCount then
		pendingSelectionCount = count
		send("/selection", "POST", { count = count })
	end
end

local function loop()
	while active do
		local work = send("/poll", "GET")
		if not work then
			if not findPort() then
				task.wait(3)
			end
		else
			if work.job then
				applyJob(work.job)
			end
			if work.scan then
				runScan(work.scan)
			end
			if work.mappings then
				applyMappings(work.mappings)
			end
			if not work.job and not work.scan and not work.mappings then
				task.wait(IDLE_DELAY)
			end
		end
	end
end

local function setActive(value)
	active = value
	connectButton:SetActive(active)

	if active then
		if findPort() then
			syncTree()
			task.spawn(loop)
		else
			active = false
			connectButton:SetActive(false)
			warn("jStudio is not running, or it is not listening on 127.0.0.1")
		end
	else
		send("/goodbye", "POST", {})
	end
end

connectButton.Click:Connect(function()
	setActive(not active)
end)

syncButton.Click:Connect(function()
	if active then
		syncTree()
	end
end)

scanButton.Click:Connect(function()
	if active then
		task.spawn(runScan, { selectedOnly = true, useInstanceNames = true })
	end
end)

Selection.SelectionChanged:Connect(function()
	if active then
		task.spawn(reportSelection)
	end
end)

plugin.Unloading:Connect(function()
	if active then
		active = false
		send("/goodbye", "POST", {})
	end
end)

if not RunService:IsRunning() then
	setActive(true)
end
