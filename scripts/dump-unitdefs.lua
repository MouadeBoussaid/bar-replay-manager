-- Dump UnitDefs for bar-replay-manager.
--
-- 1. Put this file in the BAR write dir's widget folder (next to infolog.txt), e.g.
--      C:\Program Files\Beyond-All-Reason\data\LuaUI\Widgets\dump-unitdefs.lua
--    Do it with BAR NOT running.
-- 2. Launch BAR, start any match (skirmish vs AI is fine).
-- 3. Press F11, find "BRM Dump UnitDefs", enable it. It prints the table to the
--    console / infolog.txt once, between #####BRM_DUMP_BEGIN##### and
--    #####BRM_DUMP_END##### markers, then does nothing.
-- 4. Quit BAR.
-- 5. node scripts/gen-unitdefs.mjs "<path to>\data\infolog.txt"
--
-- Output only uses Spring.Echo (always available); no io, no config writes, so it
-- can't wedge the game. Each "BRM " line is 40 "id,metalCost,offensive;" records.

function widget:GetInfo()
  return {
    name    = "BRM Dump UnitDefs",
    desc    = "Prints unitDefID,metalCost,offensive to infolog once",
    author  = "bar-replay-manager",
    date    = "2026",
    license = "GPL v2 or later",
    layer   = 0,
    enabled = false,
  }
end

-- Offensive = can shoot, and isn't a factory / builder / commander. Static
-- defence and anti-air keep their weapons and pass; radar, resource, scouts and
-- nano turrets have no weapons and drop out on their own.
local function isOffensive(ud)
  local w = ud.weapons
  local hasWeapons = (w ~= nil) and (#w > 0)
  local cp = ud.customParams or {}
  local isCommander = (cp.iscommander ~= nil) or (cp.isscavcommander ~= nil)
  return hasWeapons and (not ud.isFactory) and (not ud.isBuilder) and (not isCommander)
end

function widget:Initialize()
  local ok, err = pcall(function()
    local rows = {}
    for id, ud in pairs(UnitDefs) do
      local m = ud.metalCost or ud.buildCostMetal or 0
      rows[#rows + 1] = id .. "," .. math.floor(m + 0.5) .. "," .. (isOffensive(ud) and 1 or 0)
    end

    local gv = tostring(Game.gameName or "") .. " " .. tostring(Game.gameVersion or "")
    Spring.Echo("#####BRM_DUMP_BEGIN##### " .. gv .. " count=" .. #rows)

    local buf, n = "", 0
    for i = 1, #rows do
      buf = buf .. rows[i] .. ";"
      n = n + 1
      if n >= 40 then
        Spring.Echo("BRM " .. buf)
        buf, n = "", 0
      end
    end
    if n > 0 then Spring.Echo("BRM " .. buf) end

    Spring.Echo("#####BRM_DUMP_END#####")
  end)

  if not ok then
    Spring.Echo("#####BRM_DUMP_ERROR##### " .. tostring(err))
  end
end
