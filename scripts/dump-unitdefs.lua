-- Dump UnitDefs for bar-replay-manager.
--
-- 1. Copy this file into your BAR write dir's widget folder, e.g.
--      C:\Program Files\Beyond-All-Reason\data\LuaUI\Widgets\dump-unitdefs.lua
-- 2. Launch BAR, start any match (a skirmish vs AI is fine).
-- 3. Open the widget list (F11) and make sure "Dump UnitDefs (bar-replay-manager)"
--    is enabled. It runs once on load and prints a "[dump-unitdefs] ..." line.
-- 4. Quit BAR.
--
-- It writes the table two ways, so at least one survives BAR's Lua sandbox:
--   * unitdefs_dump.json  in the BAR write dir (next to infolog.txt), and
--   * springsettings.cfg  key `bar_replay_manager_unitdefs` (written by the engine
--     on exit — this one always works).
--
-- Then: node scripts/gen-unitdefs.mjs "<path to unitdefs_dump.json OR springsettings.cfg>"

function widget:GetInfo()
  return {
    name    = "Dump UnitDefs (bar-replay-manager)",
    desc    = "Writes unitDefID -> {metalCost, offensive} once, then idles",
    author  = "bar-replay-manager",
    date    = "2026",
    license = "GPL-2.0-or-later",
    layer   = 0,
    enabled = true,
  }
end

-- Offensive = can shoot, and isn't a factory / builder / commander. Static
-- defence and anti-air keep their weapons and pass; radar, resource, scouts and
-- nano turrets have no weapons and drop out on their own.
local function isOffensive(ud)
  local hasWeapons = ud.weapons ~= nil and #ud.weapons > 0
  local cp = ud.customParams or {}
  local isCommander = cp.iscommander ~= nil or cp.isscavcommander ~= nil
  return hasWeapons and not ud.isFactory and not ud.isBuilder and not isCommander
end

function widget:Initialize()
  local parts = {}
  for id, ud in pairs(UnitDefs) do
    local metal = math.floor((ud.metalCost or ud.buildCostMetal or 0) + 0.5)
    parts[#parts + 1] = string.format('"%d":[%d,%d]', id, metal, isOffensive(ud) and 1 or 0)
  end

  -- Compact, single line — must stay one line for springsettings.cfg.
  local body = string.format(
    '{"gameName":%q,"gameVersion":%q,"engineVersion":%q,"units":{%s}}',
    tostring(Game.gameName or ""),
    tostring(Game.gameVersion or ""),
    tostring((Engine and Engine.version) or Game.version or ""),
    table.concat(parts, ",")
  )

  -- Always works: the engine flushes springsettings.cfg on exit.
  Spring.SetConfigString("bar_replay_manager_unitdefs", body)

  -- Also drop a real file when the Lua io sandbox allows it.
  local wroteFile = false
  if io and io.open then
    local f = io.open("unitdefs_dump.json", "w")
    if f then
      f:write(body)
      f:close()
      wroteFile = true
    end
  end

  Spring.Echo(string.format(
    "[dump-unitdefs] %d unit defs -> springsettings.cfg key 'bar_replay_manager_unitdefs'%s. Quit BAR, then run gen-unitdefs.mjs.",
    #parts, wroteFile and " + unitdefs_dump.json" or " (file write was blocked)"
  ))
end
