-- Dump UnitDefs for bar-replay-manager.
--
-- Drop this file in your BAR "LuaUI/Widgets" folder, enable it once in-game
-- (any match, incl. a skirmish vs AI), then quit. It writes
-- `unitdefs_dump.json` to the BAR write directory (next to infolog.txt).
-- Feed that file to `node scripts/gen-unitdefs.mjs`.
--
-- The dump is the authoritative source of the unitDefID -> {metalCost, offensive}
-- mapping: it is the engine's own table for exactly this game version.

function widget:GetInfo()
  return {
    name    = "Dump UnitDefs (bar-replay-manager)",
    desc    = "Writes unitdefs_dump.json, then does nothing",
    author  = "bar-replay-manager",
    date    = "2026",
    license = "GPL v2 or later",
    layer   = 0,
    enabled = true,
  }
end

-- Offensive = can shoot, and isn't a factory / builder / commander.
-- Static defence and anti-air keep their weapons and pass; radar, resource,
-- scouts and nano turrets have no weapons and fall out on their own.
local function isOffensive(ud)
  local hasWeapons = ud.weapons ~= nil and #ud.weapons > 0
  local cp = ud.customParams or {}
  local isCommander = cp.iscommander ~= nil or cp.isscavcommander ~= nil
  return hasWeapons and not ud.isFactory and not ud.isBuilder and not isCommander
end

function widget:Initialize()
  local rows = {}
  for id, ud in pairs(UnitDefs) do
    local metal = ud.metalCost or ud.buildCostMetal or 0
    rows[#rows + 1] = string.format(
      '    "%d": [%d, %d]', id, math.floor(metal + 0.5), isOffensive(ud) and 1 or 0
    )
  end

  local gameVersion = tostring(Game.gameVersion or "")
  local gameName = tostring(Game.gameName or "")
  local engine = tostring((Engine and Engine.version) or Game.version or "")

  local body = string.format(
    '{\n  "gameVersion": %q,\n  "gameName": %q,\n  "engineVersion": %q,\n  "units": {\n%s\n  }\n}\n',
    gameVersion, gameName, engine, table.concat(rows, ",\n")
  )

  local name = "unitdefs_dump.json"
  local f = io.open(name, "w")
  if f then
    f:write(body)
    f:close()
    Spring.Echo("[dump-unitdefs] wrote " .. name .. " (" .. #rows .. " units) to the BAR write dir")
  else
    Spring.Echo("[dump-unitdefs] could not write a file; JSON follows in the log:")
    Spring.Echo(body)
  end

  widgetHandler:RemoveWidget(self)
end
