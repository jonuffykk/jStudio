local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local MarketplaceService = game:GetService("MarketplaceService")
local StudioService = game:GetService("StudioService")
local Selection = game:GetService("Selection")
local RunService = game:GetService("RunService")

local PLUGIN_VERSION = "1.3.0"
local TOKEN = "__JSTUDIO_TOKEN__"
local FIRST_PORT = 8712
local LAST_PORT = 8719
local MAX_NODES = 4000
local MAX_SOURCE = 60000
local SCAN_BATCH = 40
local IDLE_DELAY = 1
local RETRY_DELAY = 3
local MAX_POLL_MISSES = 3
local KIND_PROPERTIES = {
	animation = {
		{ className = "Animation", properties = { "AnimationId" } },
		{
			className = "Humanoid",
			properties = {
				"ClimbAnimation",
				"FallAnimation",
				"IdleAnimation",
				"JumpAnimation",
				"RunAnimation",
				"SwimAnimation",
				"WalkAnimation",
			},
		},
	},
	audio = {
		{ className = "Sound", properties = { "SoundId" } },
		{ className = "AudioPlayer", properties = { "AssetId", "Asset" } },
	},
	image = {
		{ className = "Decal", properties = { "Texture" } },
		{ className = "Texture", properties = { "Texture" } },
		{ className = "MeshPart", properties = { "TextureID" } },
		{ className = "SpecialMesh", properties = { "TextureId" } },
		{ className = "CharacterMesh", properties = { "BaseTextureId", "OverlayTextureId" } },
		{ className = "ParticleEmitter", properties = { "Texture" } },
		{ className = "Beam", properties = { "Texture" } },
		{ className = "Trail", properties = { "Texture" } },
		{ className = "ImageLabel", properties = { "Image" } },
		{ className = "ImageButton", properties = { "Image", "HoverImage", "PressedImage" } },
		{ className = "ImageHandleAdornment", properties = { "Image" } },
		{ className = "Shirt", properties = { "ShirtTemplate" } },
		{ className = "Pants", properties = { "PantsTemplate" } },
		{ className = "ShirtGraphic", properties = { "Graphic" } },
		{
			className = "Sky",
			properties = {
				"SkyboxBk",
				"SkyboxDn",
				"SkyboxFt",
				"SkyboxLf",
				"SkyboxRt",
				"SkyboxUp",
				"SunTextureId",
				"MoonTextureId",
			},
		},
		{
			className = "SurfaceAppearance",
			properties = { "ColorMap", "MetalnessMap", "NormalMap", "RoughnessMap" },
		},
		{
			className = "MaterialVariant",
			properties = { "ColorMap", "MetalnessMap", "NormalMap", "RoughnessMap" },
		},
	},
	mesh = {
		{ className = "MeshPart", properties = { "MeshId", "MeshContent" } },
		{ className = "SpecialMesh", properties = { "MeshId" } },
		{ className = "FileMesh", properties = { "MeshId" } },
		{ className = "CharacterMesh", properties = { "MeshId" } },
		{ className = "WrapTarget", properties = { "ReferenceMeshId", "CageMeshId" } },
		{ className = "WrapLayer", properties = { "ReferenceMeshId", "CageMeshId" } },
	},
}

-- What the catalog says an id is. It outranks the property the id was read from, so
-- a mesh sitting on a texture property is listed under meshes and never under
-- pictures.
local TYPE_KIND = {
	[3] = "audio",
	[24] = "animation",
	[61] = "animation",
	[1] = "image",
	[11] = "image",
	[12] = "image",
	[13] = "image",
	[4] = "mesh",
	[10] = "mesh",
	[40] = "mesh",
}

local SCAN_YIELD_EVERY = 150
local PRODUCT_INFO_WORKERS = 12
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
local button = toolbar:CreateButton(
	"jStudio",
	"Connect, sync the place, or scan the selection when there is one",
	"rbxassetid://79755648663792"
)

button.ClickableWhenViewportHidden = true

local active = true
local connected = false
local port = FIRST_PORT
local lastMappingToken = nil
local pendingSelectionCount = ""

local function baseUrl()
	return string.format("http://127.0.0.1:%d", port)
end

local function send(path, method, body)
	local request = {
		Url = baseUrl() .. path,
		Method = method,
		Headers = {
			["x-jstudio"] = PLUGIN_VERSION,
			["x-jstudio-token"] = TOKEN,
			["Content-Type"] = "application/json",
		},
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
		local studioUserId = 0
		pcall(function()
			studioUserId = StudioService:GetUserId()
		end)

		local reply = send("/hello", "POST", {
			placeId = tostring(game.PlaceId),
			placeName = game.Name,
			pluginVersion = PLUGIN_VERSION,
			studioUserId = tostring(studioUserId),
			creatorId = tostring(game.CreatorId),
			creatorType = game.CreatorType == Enum.CreatorType.Group and "group" or "user",
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

local function assetIdIn(text)
	if type(text) ~= "string" or text == "" or text == "nil" then
		return nil
	end
	if string.find(text, "16666666666666") then
		return nil
	end
	local assetId = string.match(text, "%d+")
	if not assetId or #assetId < 4 or string.match(assetId, "^(%d)%1+$") then
		return nil
	end
	return assetId
end

-- Properties come back as a plain string, a raw number or a Content value depending
-- on the class and the Studio build, so all three shapes are read and written back.
local function readAsset(instance, property)
	local ok, raw = pcall(function()
		return instance[property]
	end)
	if not ok or raw == nil then
		return nil, nil
	end

	if typeof(raw) == "Content" then
		local okUri, uri = pcall(function()
			return raw.Uri
		end)
		return okUri and assetIdIn(uri) or nil, "content"
	end
	if type(raw) == "string" then
		return assetIdIn(raw), "string"
	end
	if type(raw) == "number" and raw > 0 and raw % 1 == 0 then
		return assetIdIn(tostring(math.floor(raw))), "number"
	end
	return nil, nil
end

local function writeAsset(instance, property, shape, newId)
	local url = "rbxassetid://" .. newId

	if shape == "number" then
		return pcall(function()
			instance[property] = tonumber(newId)
		end)
	end
	if shape == "content" then
		local ok = pcall(function()
			instance[property] = Content.fromUri(url)
		end)
		if ok then
			return true
		end
	end
	return pcall(function()
		instance[property] = url
	end)
end

local function propertiesFor(kind)
	return KIND_PROPERTIES[kind] or KIND_PROPERTIES.animation
end

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
	if instanceName and instanceName ~= "" and instanceName ~= "Animation" and instanceName ~= "Sound" then
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

-- Every place an id is written, not only the first one per instance: a Sky holds six
-- textures and a SurfaceAppearance four, and the old walk replaced one of them.
local function eachAssetReference(objects, kind, visit)
	local entries = propertiesFor(kind)

	for index, instance in ipairs(objects) do
		if index % SCAN_YIELD_EVERY == 0 then
			task.wait()
		end

		local matched = false
		for _, entry in ipairs(entries) do
			if instance:IsA(entry.className) then
				for _, property in ipairs(entry.properties) do
					local assetId, shape = readAsset(instance, property)
					if assetId then
						matched = true
						visit({
							assetId = assetId,
							instance = instance,
							property = property,
							shape = shape,
							instanceName = instance.Name,
						})
					end
				end
			end
		end

		if not matched and instance:IsA("LuaSourceContainer") then
			local source = sourceOf(instance)
			if source and source ~= "" then
				eachSourceId(source, function(assetId, position)
					visit({
						assetId = assetId,
						instance = instance,
						source = source,
						position = position,
					})
				end)
			end
		end
	end
end

local productInfoCache = {}

local function productInfo(assetId)
	local cached = productInfoCache[assetId]
	if cached ~= nil then
		return cached or nil
	end

	local ok, info = pcall(function()
		return MarketplaceService:GetProductInfo(tonumber(assetId))
	end)
	local resolved = (ok and info) or false
	productInfoCache[assetId] = resolved
	return resolved or nil
end

local function resolveAll(candidates)
	local pending, running = 1, 0
	local workers = math.min(PRODUCT_INFO_WORKERS, #candidates)

	for _ = 1, workers do
		running += 1
		task.spawn(function()
			while true do
				local index = pending
				pending += 1
				local candidate = candidates[index]
				if not candidate then
					break
				end
				candidate.info = productInfo(candidate.assetId)
			end
			running -= 1
		end)
	end

	while running > 0 do
		task.wait()
	end
end

local function runScan(request)
	local objects = (request.selectedOnly and #Selection:Get() == 0) and {} or scanRoots(request.selectedOnly)
	local kind = request.assetKind or "animation"

	local candidates, seen = {}, {}
	eachAssetReference(objects, kind, function(reference)
		if seen[reference.assetId] then
			return
		end
		seen[reference.assetId] = true
		table.insert(candidates, reference)
	end)

	resolveAll(candidates)

	local batch = {}
	local function flush(force)
		if #batch == 0 or (not force and #batch < SCAN_BATCH) then
			return
		end
		send("/scan", "POST", { status = "streaming", results = batch })
		batch = {}
		task.wait()
	end

	for _, candidate in ipairs(candidates) do
		local info = candidate.info
		local fromProperty = candidate.property ~= nil
		local wanted

		if info then
			local told = TYPE_KIND[info.AssetTypeId]
			-- An id the catalog places somewhere else belongs to that tab, not this one.
			wanted = told == kind or (told == nil and fromProperty)
		else
			-- A private or moderated asset has no catalog entry. Dropping it here is
			-- what left the assets most worth replacing out of every run.
			wanted = fromProperty
		end

		if wanted then
			local creatorKind, creatorId = "U", "0"
			if info then
				creatorKind, creatorId = creatorOf(info)
			end
			local name = cleanName(
				resolveName(request.useInstanceNames, info or {}, candidate.instanceName, candidate.source, candidate.position)
			)
			if name == "" or (not info and name == "Unknown") then
				name = candidate.instanceName or ("Asset " .. candidate.assetId)
			end
			table.insert(batch, string.format("%s - %s - %s: %s", candidate.assetId, name, creatorKind, creatorId))
			flush(false)
		end
	end

	flush(true)
	send("/scan", "POST", { status = "completed", results = {} })
end

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
	local kind = push.assetKind or "animation"

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
	local sources = {}
	local recording = ChangeHistoryService:TryBeginRecording("jStudio: replace asset ids")

	eachAssetReference(scanRoots(false), kind, function(reference)
		local newId = map[reference.assetId]
		if not newId then
			return
		end

		if reference.property then
			if writeAsset(reference.instance, reference.property, reference.shape, newId) then
				replaced += 1
			end
		else
			sources[reference.instance] = true
		end
	end)

	for instance in pairs(sources) do
		local source = sourceOf(instance)
		if source and source ~= "" then
			local updated, changed = replaceInSource(source, map)
			if changed then
				local ok = pcall(function()
					instance.Source = updated
				end)
				if ok then
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
	local paths = {}

	for index, instance in ipairs(Selection:Get()) do
		if index > 30 then
			break
		end
		local ok, full = pcall(function()
			return instance:GetFullName()
		end)
		if ok then
			table.insert(paths, full)
		end
	end

	if #Selection:Get() > 0 then
		local seen = {}
		eachAssetReference(scanRoots(true), "animation", function(reference)
			if not seen[reference.assetId] then
				seen[reference.assetId] = true
				count += 1
			end
		end)
	end

	local token = table.concat(paths, "|") .. "#" .. count
	if token ~= pendingSelectionCount then
		pendingSelectionCount = token
		send("/selection", "POST", { count = count, paths = paths })
	end
end

local function loop()
	local misses = 0
	while active do
		local work = send("/poll", "GET")
		if not work then
			misses += 1
			if misses >= MAX_POLL_MISSES then
				return
			end
			task.wait(RETRY_DELAY)
		else
			misses = 0
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

local function paintButton()
	button:SetActive(connected)
end

local function attach()
	if connected then
		return true
	end
	if not findPort() then
		return false
	end

	connected = true
	paintButton()
	pendingSelectionCount = ""
	syncTree()
	return true
end

local function supervise()
	while active do
		if attach() then
			loop()
			connected = false
			paintButton()
		end
		if active then
			task.wait(RETRY_DELAY)
		end
	end
end

button.Click:Connect(function()
	if not connected then
		task.spawn(attach)
	elseif #Selection:Get() > 0 then
		task.spawn(runScan, { selectedOnly = true, useInstanceNames = true })
	else
		task.spawn(syncTree)
	end
end)

Selection.SelectionChanged:Connect(function()
	if connected then
		task.spawn(reportSelection)
	end
end)

plugin.Unloading:Connect(function()
	active = false
	if connected then
		connected = false
		send("/goodbye", "POST", {})
	end
end)

if not RunService:IsRunning() then
	paintButton()
	task.spawn(supervise)
end
