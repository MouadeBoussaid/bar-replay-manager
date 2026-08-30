# Unit-def tables — offensive share for the comparison drawer

`unitDefTables.generated.ts` maps a numeric **unitDefID** to `[metalCost, offensive]`
per BAR game version. `src/main/army-orders.ts` uses it to weight the comparison
drawer's "value on field" toward combat units; without a matching table it falls
back to counting every unit type (`source: 'trailer-estimate'`).

The file ships **empty**. Populate it like this:

1. Copy `scripts/dump-unitdefs.lua` into your BAR `LuaUI/Widgets/` folder.
2. Start any match (a skirmish vs. AI is fine), let the widget run once, quit.
   It writes `unitdefs_dump.json` to the BAR write directory (next to
   `infolog.txt`).
3. `node scripts/gen-unitdefs.mjs path/to/unitdefs_dump.json` — regenerates
   `unitDefTables.generated.ts`.

Repeat with a dump from each BAR version you care about; pass several dumps in
one `gen-unitdefs.mjs` call. Replays on a version newer than any bundled table
use the closest older one (fine unless units were added/renamed since).

## Why a dump rather than parsing the archive

The build command in the demo stream carries the numeric `unitDefID` the engine
assigned from archive load order. That order isn't in the demo and bar-rts.com
doesn't publish it. The dump is the engine's own `UnitDefs` table, so the IDs are
correct by construction — no load-order reconstruction to get wrong.
