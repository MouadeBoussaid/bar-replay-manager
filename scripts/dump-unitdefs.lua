-- Dump UnitDefs for bar-replay-manager.
--
-- 1. With BAR NOT running, put this file in the write dir's widget folder, e.g.
--      C:\Program Files\Beyond-All-Reason\data\LuaUI\Widgets\dump-unitdefs.lua
-- 2. Launch BAR, start any match (skirmish vs AI is fine).
-- 3. F11 -> enable "BRM Dump UnitDefs". It prints to the console / infolog.txt
--    once, between #####BRM_DUMP_BEGIN##### and #####BRM_DUMP_END#####.
-- 4. Quit BAR.
-- 5. node scripts/gen-unitdefs.mjs "<path to>\data\infolog.txt"
--
-- Echo only (no io, no config writes) so it can't wedge the game. One line per
-- unit: `BRM <id>|<name>|mc=<x>|bcm=<y>|cm=<z>|w=<n>|fac=<0/1>|bld=<0/1>|com=<0/1>`

function widget:GetInfo()
  return {
    name    = "BRM Dump UnitDefs",
    desc    = "Prints unit defs to infolog once",
    author  = "bar-replay-manager",
    date    = "2026",
    license = "GPL v2 or later",
    layer   = 0,
    enabled = false,
  }
end

function widget:Initialize()
  local ok, err = pcall(function()
    local n = 0
    Spring.Echo("#####BRM_DUMP_BEGIN##### " ..
      tostring(Game.gameName or "") .. " " .. tostring(Game.gameVersion or ""))

    for id, ud in pairs(UnitDefs) do
      n = n + 1
      local w = ud.weapons
      local nWeapons = (w ~= nil) and #w or 0
      local cp = ud.customParams or {}
      local com = (cp.iscommander ~= nil) or (cp.isscavcommander ~= nil)
      local cm = (ud.cost and ud.cost.metal) or ""
      Spring.Echo(table.concat({
        "BRM", id,
        tostring(ud.name or ""),
        "mc=" .. tostring(ud.metalCost or ""),
        "bcm=" .. tostring(ud.buildCostMetal or ""),
        "cm=" .. tostring(cm),
        "w=" .. nWeapons,
        "fac=" .. (ud.isFactory and 1 or 0),
        "bld=" .. (ud.isBuilder and 1 or 0),
        "com=" .. (com and 1 or 0),
      }, "|"))
    end

    Spring.Echo("#####BRM_DUMP_END##### count=" .. n)
  end)

  if not ok then
    Spring.Echo("#####BRM_DUMP_ERROR##### " .. tostring(err))
  end
end
