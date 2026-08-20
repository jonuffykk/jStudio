local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local BRIDGE = "http://127.0.0.1:28476"
local POLL_INTERVAL = 2
local ANIMATION_ASSET_TYPE = 24
local SCAN_YIELD_EVERY = 150
local FLUSH_THRESHOLD = 10

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
	lastMappingHash = "",
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

local function variableNameFor(source, assetId)
	local position = source:find("rbxassetid://" .. assetId, 1, true)
	if not position then
		return nil
	end
	local lineStart = select(2, source:sub(1, position - 1):find(".*\n")) or 0
	local lineEnd = (source:find("\n", position) or (#source + 1)) - 1
	local line = source:sub(lineStart + 1, lineEnd)

	local name = line:match("([%a_][%w_]*)%s*=%s*[\"']?rbxassetid")
		or line:match("%[%s*[\"']([%w_ ]+)[\"']%s*%]%s*=%s*[\"']?rbxassetid")
	if not name then
		return nil
	end
	name = name:match("^%s*(.-)%s*$")
	if name == "" or GENERIC_NAMES[name:lower()] then
		return nil
	end
	return name
end

local function resolveName(useInstanceNames, info, instanceName, source, assetId)
	if not useInstanceNames then
		return info.Name or "Unknown"
	end
	if instanceName and instanceName ~= "" and instanceName ~= "Animation" then
		return instanceName
	end
	if source then
		local variable = variableNameFor(source, assetId)
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
	return object.AnimationId:match("rbxassetid://(%d+)")
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
				visit(id, object.Name, nil)
			end
		elseif object:IsA("LuaSourceContainer") then
			local source = sourceOf(object)
			if source and source ~= "" then
				for id in source:gmatch("rbxassetid://(%d+)") do
					if not seen[id] then
						seen[id] = true
						visit(id, nil, source)
					end
				end
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

	eachAnimationReference(objects, function(id, instanceName, source)
		local ok, info = pcall(function()
			return MarketplaceService:GetProductInfo(tonumber(id))
		end)
		if not ok or not info or info.AssetTypeId ~= ANIMATION_ASSET_TYPE then
			return
		end
		local kind, creatorId = creatorOf(info)
		local name = cleanName(resolveName(useInstanceNames, info, instanceName, source, id))
		table.insert(results, string.format("%s - %s - %s: %s", id, name, kind, creatorId))
		pending += 1
		flush(false)
	end)

	flush(true)
	request("/scan-result", "POST", { status = "completed", results = results })
	state.scanning = false
	render()
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
			if source then
				local updated = source
				for oldId, newId in pairs(map) do
					updated = updated:gsub("rbxassetid://" .. oldId, "rbxassetid://" .. newId)
				end
				if updated ~= source then
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
					local hash = table.concat(body.mappings, "|")
					if hash ~= state.lastMappingHash then
						state.lastMappingHash = hash
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
