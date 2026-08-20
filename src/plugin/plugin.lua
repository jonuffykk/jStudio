local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local BRIDGE = "http://127.0.0.1:28476"
local POLL_INTERVAL = 2
local ANIMATION_ASSET_TYPE = 24
local SCAN_YIELD_EVERY = 150
local FLUSH_THRESHOLD = 10
-- Scripts often carry the animation as a bare number ("AnimationId = 1234567890").
-- Any digit run this long that is not glued to an identifier is treated as a
-- candidate asset id; MarketplaceService then confirms whether it is an animation.
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

local state = {
	connected = false,
	scanning = false,
	polling = false,
	placeName = "Unknown",
	replaced = 0,
	lastMappingToken = "",
}

local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 240, 180, 200, 140)
local widget = plugin:CreateDockWidgetPluginGui("jSpoofer", widgetInfo)
widget.Title = "jSpoofer"

local frame = Instance.new("Frame")
frame.Size = UDim2.fromScale(1, 1)
frame.BorderSizePixel = 0
frame.Parent = widget

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
layout.VerticalAlignment = Enum.VerticalAlignment.Center
layout.Parent = frame

local function label(height, size, font)
	local text = Instance.new("TextLabel")
	text.Size = UDim2.new(0.9, 0, 0, height)
	text.BackgroundTransparency = 1
	text.TextSize = size
	text.TextWrapped = true
	text.Font = font
	text.Text = ""
	text.Parent = frame
	return text
end

local statusLabel = label(22, 14, Enum.Font.SourceSansBold)
local detailLabel = label(36, 12, Enum.Font.SourceSans)
local extraLabel = label(28, 11, Enum.Font.SourceSans)

local connectButton = Instance.new("TextButton")
connectButton.Size = UDim2.new(0.8, 0, 0, 28)
connectButton.TextSize = 13
connectButton.Font = Enum.Font.SourceSansBold
connectButton.Text = "Connect"
connectButton.Parent = frame
Instance.new("UICorner").Parent = connectButton

local function applyTheme()
	local theme = settings().Studio.Theme
	frame.BackgroundColor3 = theme:GetColor(Enum.StudioStyleGuideColor.MainBackground)
	detailLabel.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.DimmedText)
	extraLabel.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.DimmedText)
	connectButton.BackgroundColor3 = theme:GetColor(Enum.StudioStyleGuideColor.Button)
	connectButton.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.ButtonText)
end

local function render()
	if state.connected then
		statusLabel.Text = "Connected"
		statusLabel.TextColor3 = Color3.fromRGB(64, 192, 87)
		detailLabel.Text = string.format("%s  (%d)", state.placeName, game.PlaceId or 0)
		if state.scanning then
			extraLabel.Text = "Scanning..."
		elseif state.replaced > 0 then
			extraLabel.Text = string.format("%d ID%s replaced", state.replaced, state.replaced == 1 and "" or "s")
		else
			extraLabel.Text = "Waiting for the desktop app..."
		end
		connectButton.Visible = false
	else
		statusLabel.Text = "Disconnected"
		statusLabel.TextColor3 = Color3.fromRGB(224, 49, 49)
		detailLabel.Text = "Open the jSpoofer app"
		extraLabel.Text = "then press Connect"
		connectButton.Visible = true
	end
end

local function request(endpoint, method, body)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = BRIDGE .. endpoint,
			Method = method,
			Headers = { ["Content-Type"] = "application/json" },
			Body = (method ~= "GET" and body) and HttpService:JSONEncode(body) or nil,
		})
	end)
	if not ok or not response.Success then
		return false, nil
	end
	local decoded
	pcall(function()
		decoded = HttpService:JSONDecode(response.Body)
	end)
	return true, decoded
end

local function creatorOf(info)
	local creator = info.Creator or {}
	local kind = string.sub(creator.CreatorType or "User", 1, 1)
	local id = tostring(creator.CreatorTargetId or creator.Id or 0)
	return kind, id
end

local function cleanName(name)
	name = name:gsub("%s*%-%s*", " "):gsub(":", ";"):gsub("%s+", " ")
	return (name:match("^%s*(.-)%s*$"))
end

-- Names the animation after the closest assignment target to the left of the id
-- on the same line, so `Roll = 3333333333, ["Slide Left"] = 4444444444` names
-- each id correctly instead of reusing the first key on the line.
local function variableNameFor(source, position)
	if not position then
		return nil
	end
	local lineStart = select(2, source:sub(1, position - 1):find(".*\n")) or 0
	local prefix = source:sub(lineStart + 1, position - 1)

	local name, nameAt = nil, -1
	local function scan(pattern)
		local cursor = 1
		while true do
			local first, last, capture = prefix:find(pattern, cursor)
			if not first then
				return
			end
			local comparison = prefix:sub(last + 1, last + 1) == "="
				or prefix:sub(last - 1, last - 1):match("[=~<>]") ~= nil
			if not comparison and first > nameAt then
				name, nameAt = capture, first
			end
			cursor = last + 1
		end
	end

	scan("%[%s*[\"']([%w_ ]+)[\"']%s*%]%s*=")
	scan("([%a_][%w_]*)%s*=")

	if not name then
		return nil
	end
	name = name:match("^%s*(.-)%s*$")
	if name == "" or GENERIC_NAMES[name:lower()] then
		return nil
	end
	return name
end

-- Walks every asset-id-looking token in a source file. Explicit references
-- (rbxassetid://, ?id=) always count; bare numbers need MIN_BARE_ID_DIGITS and
-- must not be part of a longer identifier or a decimal number.
local function eachSourceId(source, visit)
	local cursor = 1
	while true do
		local first, last = source:find("%d+", cursor)
		if not first then
			return
		end
		cursor = last + 1

		local before = source:sub(math.max(1, first - 16), first - 1)
		local previous = first > 1 and source:sub(first - 1, first - 1) or ""
		local following = source:sub(last + 1, last + 1)

		local explicit = false
		for _, prefix in ipairs(EXPLICIT_PREFIXES) do
			if before:find(prefix) then
				explicit = true
				break
			end
		end

		local glued = previous:match("[%w_%.]") ~= nil or following:match("[%w_%.]") ~= nil
		if explicit or (not glued and (last - first + 1) >= MIN_BARE_ID_DIGITS) then
			visit(source:sub(first, last), first)
		end
	end
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

local function sourceOf(object)
	local ok, source = pcall(function()
		return object.Source
	end)
	return ok and source or nil
end

local function animationIdOf(object)
	local raw = object.AnimationId
	return raw and raw:match("(%d+)") or nil
end

local function selectionScope()
	local scope, seen = {}, {}
	local function add(object)
		if seen[object] then
			return
		end
		seen[object] = true
		table.insert(scope, object)
	end
	for _, object in ipairs(Selection:Get()) do
		add(object)
		for _, descendant in ipairs(object:GetDescendants()) do
			add(descendant)
		end
	end
	return scope
end

local function eachAnimationReference(objects, visit)
	local seen = {}
	for index, object in ipairs(objects) do
		if index % SCAN_YIELD_EVERY == 0 then
			task.wait()
		end
		if object:IsA("Animation") then
			local id = animationIdOf(object)
			if id and not seen[id] then
				seen[id] = true
				visit(id, object.Name, nil, nil)
			end
		elseif object:IsA("LuaSourceContainer") then
			local source = sourceOf(object)
			if source and source ~= "" then
				eachSourceId(source, function(id, position)
					if not seen[id] then
						seen[id] = true
						visit(id, nil, source, position)
					end
				end)
			end
		end
	end
end

local function reportSelection()
	local count = 0
	if #Selection:Get() > 0 then
		eachAnimationReference(selectionScope(), function()
			count += 1
		end)
	end
	request("/selection", "POST", { count = count })
end

local function scan(useInstanceNames, selectedOnly)
	if state.scanning then
		return
	end
	state.scanning = true
	render()

	local results, pending = {}, 0

	local function flush(force)
		if pending == 0 or (not force and pending < FLUSH_THRESHOLD) then
			return
		end
		pending = 0
		request("/scan-result", "POST", { status = "scanning", results = results })
	end

	local objects = selectedOnly and selectionScope() or game:GetDescendants()
	if selectedOnly and #Selection:Get() == 0 then
		objects = {}
	end

	eachAnimationReference(objects, function(id, instanceName, source, position)
		local ok, info = pcall(function()
			return MarketplaceService:GetProductInfo(tonumber(id))
		end)
		if not ok or not info or info.AssetTypeId ~= ANIMATION_ASSET_TYPE then
			return
		end
		local kind, creatorId = creatorOf(info)
		local name = cleanName(resolveName(useInstanceNames, info, instanceName, source, position))
		table.insert(results, string.format("%s - %s - %s: %s", id, name, kind, creatorId))
		pending += 1
		flush(false)
	end)

	flush(true)
	request("/scan-result", "POST", { status = "completed", results = results })
	state.scanning = false
	render()
end

-- Rewrites every id token the scanner would have picked up, so bare numeric
-- references are swapped exactly like rbxassetid:// ones and their formatting
-- (url, quoted string, plain number) is preserved.
local function replaceInSource(source, map)
	local pieces, cursor, changed = {}, 1, false
	eachSourceId(source, function(id, position)
		local newId = map[id]
		if not newId then
			return
		end
		table.insert(pieces, source:sub(cursor, position - 1))
		table.insert(pieces, newId)
		cursor = position + #id
		changed = true
	end)
	if not changed then
		return source, false
	end
	table.insert(pieces, source:sub(cursor))
	return table.concat(pieces), true
end

local function replaceIds(mappings)
	local map = {}
	for _, entry in ipairs(mappings) do
		local oldId, newId = entry:match("(%d+)%s*=%s*(%d+)")
		if oldId and newId and oldId ~= newId then
			map[oldId] = newId
		end
	end
	if not next(map) then
		return
	end

	local recording = ChangeHistoryService:TryBeginRecording("jSpoofer", "Replace animation IDs")
	local started = os.clock()
	local count = 0

	for _, object in ipairs(game:GetDescendants()) do
		if object:IsA("Animation") then
			local id = animationIdOf(object)
			if id and map[id] then
				object.AnimationId = "rbxassetid://" .. map[id]
				count += 1
			end
		elseif object:IsA("LuaSourceContainer") then
			local source = sourceOf(object)
			if source and source ~= "" then
				local updated, changed = replaceInSource(source, map)
				if changed then
					object.Source = updated
					count += 1
				end
			end
		end
	end

	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end

	state.replaced += count
	request("/replace-complete", "POST", { replacedCount = count, elapsed = os.clock() - started })
	render()
end

local function connect()
	local placeId = game.PlaceId or 0
	local ok, info = pcall(function()
		return placeId > 0 and MarketplaceService:GetProductInfo(placeId).Name or nil
	end)
	state.placeName = (ok and info) or ("Place " .. tostring(placeId))
	state.connected = select(1, request("/connect", "POST", { placeId = placeId, placeName = state.placeName }))
	render()
	return state.connected
end

local function poll()
	if state.polling then
		return
	end
	state.polling = true

	task.spawn(function()
		while state.connected do
			task.wait(POLL_INTERVAL)
			local ok, body = request("/poll", "GET")
			if not ok then
				state.connected = false
				render()
				break
			end
			if body then
				if body.scanRequest then
					local options = body.scanRequest
					task.spawn(scan, options.useInstanceNames == true, options.selectedOnly == true)
				end
				if body.mappings and #body.mappings > 0 then
					local token = body.mappingToken or table.concat(body.mappings, "|")
					if token ~= state.lastMappingToken then
						state.lastMappingToken = token
						task.spawn(replaceIds, body.mappings)
					end
				end
			end
		end
		state.polling = false
	end)
end

local function tryConnect(attempts)
	if state.connected then
		return true
	end
	for _ = 1, attempts do
		if connect() then
			poll()
			return true
		end
		task.wait(1)
	end
	return false
end

pcall(applyTheme)
pcall(function()
	settings().Studio.ThemeChanged:Connect(applyTheme)
end)

connectButton.MouseButton1Click:Connect(function()
	detailLabel.Text = "Connecting..."
	if not tryConnect(3) then
		detailLabel.Text = "Failed — is the desktop app running?"
	end
end)

local toolbar = plugin:CreateToolbar("jSpoofer")
local toggleButton = toolbar:CreateButton("jSpoofer", "Toggle the jSpoofer widget", "rbxassetid://133573191144566")
toggleButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

widget:GetPropertyChangedSignal("Enabled"):Connect(function()
	if widget.Enabled and not state.connected then
		task.spawn(tryConnect, 5)
	end
end)

local selectionPending = false
Selection.SelectionChanged:Connect(function()
	if not state.connected or selectionPending then
		return
	end
	selectionPending = true
	task.spawn(function()
		task.wait(0.2)
		reportSelection()
		selectionPending = false
	end)
end)

plugin.Unloading:Connect(function()
	state.connected = false
	request("/disconnect", "POST", {})
end)

render()
task.spawn(tryConnect, 10)
