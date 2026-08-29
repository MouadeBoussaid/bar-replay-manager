# Player analytics — statistics reference

This document explains every number shown on the **Player analytics** view and how
it is derived from the replay files. It is a standalone top-level view (switch to
it from the title bar) that aggregates **one player's performance across every
locally-indexed replay** — it is never scoped to a single selected replay.

Code: [`src/main/analytics.ts`](../src/main/analytics.ts) (aggregation),
[`src/renderer/src/AnalyticsView.tsx`](../src/renderer/src/AnalyticsView.tsx)
(rendering), [`src/main/demo-header.ts`](../src/main/demo-header.ts) (raw stat
extraction).

---

## 1. Where the raw data comes from

### The demo trailer

Every `.sdfz` / `.sdf` replay ends with a **stats trailer** written by the engine.
Two blocks matter here:

| Block | Struct | Contents | Used for |
|---|---|---|---|
| Team stats | `TeamStatistics` | Cumulative economy/combat totals per in-game team, snapshotted every `teamStatPeriod` seconds (**15 s** by default) | Metal, energy, damage, units |
| Player stats | `PlayerStatistics` | Mouse pixels, mouse clicks, key presses, command counts per player | CMD/min |

The parser reads the **last snapshot** of each team's series — the final
cumulative totals for the game — in
[`readTrailer` → `lastSamples`](../src/main/demo-header.ts). If the game crashed
(`demoStreamSize == 0`) the trailer offsets are unreliable and **no stats are
produced** for that replay; it still counts toward games/wins/losses if the
winner can be recovered.

> **"Team" vs "player":** the engine tracks economy per *team*, not per *player*.
> In team games (8v8, 3v3, …) each human is normally their own team, so the
> team totals *are* that player's totals. In the rare case of shared control
> two humans would share one economy line — the analytics treat the team line as
> belonging to each human on it.

### The start script (`[GAME]{…}` TDF)

OpenSkill rating (`skill`), player colour (`rgbcolor`), start position (`startpos`
/ ally-team `startrect*`), team/ally-team structure, and the `spectator` flag all
come from parsing the embedded start script.

**Faction is *not* reliable from the script.** `[TEAM_n].side` is only the
pre-game lobby pick — it defaults to `Armada` and most players change their
faction on the in-game picker after the script is written, so the real choice
lives in the demo stream (which we don't parse). The confirmed in-game faction is
read from the **cached bar-rts.com record** (`AllyTeams[].Players[].faction`) when
one is present — otherwise the appearance keeps the local `side` and is flagged
`factionConfirmed = false`.

### Background bar-rts backfill

Three things need the **bar-rts.com record** for a game: the confirmed faction,
per-player start positions, and start-position roles. That record is cached in
`store.apiCache` — historically only when you opened that replay with **Online
lookup** on, so coverage was sparse.

After every folder scan, [`server-backfill.ts`](../src/main/server-backfill.ts)
now walks every indexed game that has a `gameId` but no cached record and fetches
it — **one request every 5 s** (deliberately gentle; a first run of a large
folder takes ~an hour), rebuilding the analytics index every 20 fetches. It stops
early if Online lookup is turned off or the API fails 5× in a row, and resumes on
the next scan. The Player-analytics view shows a "Syncing bar-rts data — N / M"
banner while it runs and refreshes itself as records land.

### Per-appearance row

The unit of aggregation is an **appearance** — one player's line in one replay
([`interface Appearance`](../src/main/analytics.ts)). `setAnalyticsIndex()`
flattens every indexed replay into a flat list of appearances (`INDEX`), and a
report is `INDEX.filter(a => a.nameKey === name.toLowerCase())`.

Fields captured per appearance: name, file path, start time, map (version suffix
stripped), duration, format (`8v8` etc.), side (blue/red), faction (+
`factionConfirmed`), result,
OS, colour, normalised start position (`startNX/NY`, when a bar-rts record is
cached — see §5b), start-position `role` (see §5b · Roles), and the raw stat
fields
`metalProduced`, `metalExcess`, `energyProduced`, `energyExcess`,
`damageDealt`, `damageReceived`, `unitsProduced`, `cmdPerMin`, plus the lists of
allies and enemies (human names only).

### What is excluded

* **AI games.** Any replay with a bot participant, or a player whose name ends in
  `AI`, is dropped entirely (`isAiReplay`).
* **Unparsed / parse-error replays** and replays with zero ally-teams.
* **Spectators** — only players on an ally-team are indexed.

### Scope selector (All time / Last 90 days / Last 50 games)

Appearances are sorted **oldest → newest by start time**, then `applyScope`:

| Scope | Rule |
|---|---|
| `all` | everything |
| `90d` | `startTime >= now − 90 days` |
| `last50` | last 50 appearances |

Every block below operates on the **scoped** list, with two exceptions noted
inline (First/Last seen, and the baseline).

---

## 2. Header line

`120 replays · 68 W – 49 L · 58.1% · first seen 3 jan 2026 · last seen 27 aug 2026`
and an `OS` chip.

| Field | Derivation |
|---|---|
| **replays** | `scoped.length` — count of appearances in scope |
| **W** | appearances with `result === 'win'` |
| **L** | appearances with `result === 'loss'` |
| **win rate %** | `wins / (wins + losses)` — **undecided games are excluded from the denominator**. `null` (shown `—`) if no decided games |
| **first seen** | start time of the player's **earliest** appearance — from the *full* unscoped history, not the scoped slice |
| **last seen** | start time of the player's **latest** appearance — also unscoped |
| **OS chip** | the most recent non-null OpenSkill rating in the scoped list (`[...scoped].reverse().find(a => a.os != null)`). Blank if never rated |

**Result** per appearance: the player's ally-team `won` flag, itself set from the
demo's `winningAllyTeams` list. `true → win`, `false → loss`, unknown →
`undecided`.

**Thin sample:** if `scoped.length < 20` the view shows only the averages grid and
the appearances table, hides win-rate colouring, and prints a warning. All
"derived" blocks (form, breakdowns, maps, company) require ≥ 20 games.

---

## 3. Averages grid

Seven cards, each showing the player's **mean** of a metric over the scoped games,
plus a signed delta **vs the baseline**.

### The metrics ([`METRICS`](../src/main/analytics.ts))

| Card | Value | Per-appearance formula | Higher is better? |
|---|---|---|---|
| Metal / game | mean of `metalProduced` | final team `metalProduced` | yes |
| Energy / game | mean of `energyProduced` | final team `energyProduced` | yes |
| Metal excess | mean of `metalExcess` | final team `metalExcess` (metal wasted at full storage) | **no** |
| Damage dealt | mean of `damageDealt` | final team `damageDealt` | yes |
| Damage taken | mean of `damageReceived` | final team `damageReceived` | **no** |
| Efficiency | mean of per-game efficiency | `damageDealt / damageReceived × 100` (%), skipped when `damageReceived` is 0/absent | yes |
| Units made | mean of `unitsProduced` | final team `unitsProduced` (count) | yes |
| CMD / min | mean of `cmdPerMin` | `PlayerStatistics.numCommands / gameMinutes`, rounded — engine command count per game-minute, a rough APM proxy | yes |

Appearances missing a given field are skipped for that card only. Value shown as
`—` if no appearance has the field.

Number formatting (`fmtK`): ≥ 1 M → `1.2M`, ≥ 10 k → `47k`, ≥ 1 k → `4.7k`,
else the rounded integer. Efficiency shows as `128%`, Units/CMD as plain
integers.

### The baseline and the delta

The **baseline** is the mean of the same metric over the **entire index** — every
appearance of *every* player, ignoring the scope selector
(`INDEX.map(m.pick)`). It is a "typical indexed player" reference, not a
skill-bracket or format-matched one.

* Normal metrics: `delta = (playerAvg − baseline) / baseline × 100`, shown as
  `+8%` / `−12%`. Suppressed if baseline ≤ 0.
* Efficiency (`pts: true`): `delta = playerAvg − baseline`, shown as `+11pt` /
  `−4pt` (percentage **points**).

**Colour** (`good`): green when the delta points the "good" way for that metric
(up for *higher-better*, down for *lower-better*), red the other way, neutral at
zero. Forced neutral when the sample is thin.

---

## 4. Form over time

A line chart over the **last 50 scoped games** (`scoped.slice(-50)`), oldest on
the left. A metric selector and a *Per game* / *Rolling 10* toggle.

### Selectable metrics ([`FORM_METRICS`](../src/main/analytics.ts))

| Metric | Per-game value |
|---|---|
| Metal / min | `metalProduced / gameMinutes` |
| Energy / min | `energyProduced / gameMinutes` |
| Damage dealt | `damageDealt` |
| Damage taken | `damageReceived` |
| Efficiency | `damageDealt / damageReceived × 100` |
| CMD / min | `cmdPerMin` |
| Units made | `unitsProduced` |
| OS | OpenSkill rating at that game |

`gameMinutes = durationMs / 60000` (min 1 to avoid divide-by-zero). Missing
values create gaps in the line (the path lifts the pen).

* **Per game** — the raw per-game series (faint line + area fill).
* **Rolling 10** — trailing mean of the last ≤ 10 non-null values at each point
  (bright line). Computed in the renderer (`rolling(series, 10)`).

The **W/L strip** under the chart is one tick per game (win / loss / undecided).
Hover reads out map, date, result and the metric value; click opens that replay.

---

## 5. Breakdown row

### Faction

Horizontal bars, one per faction the player has used, ordered
Armada → Cortex → Legion → Random.

* Faction string normalised (`normFaction`): `arm*` → Armada, `cor*` → Cortex,
  `leg*` → Legion, empty/`random` → Random, anything else title-cased as-is.
* **Built from confirmed games only.** If any scoped game has a bar-rts-confirmed
  faction (`factionConfirmed`), the bars use just that subset — otherwise every
  game shows as its lobby default (see §1) and the mix is meaningless. Footnotes:
  * 0 confirmed → *"In-game faction isn't in local replay files — turn on Online
    lookup…"* (bars still drawn from local `side`, usually all-Armada)
  * some confirmed → *"From N of M games with a confirmed in-game faction."*
  * all confirmed → no footnote
  Confirmed coverage climbs on its own via the background backfill (see §1) and
  when you open replays with Online lookup on.
* **`N g`** — games on that faction (within whichever set was used).
* **win rate** — `wins / (wins + losses)` among those games; `—` if none decided.
  Coloured green ≥ 54%, red ≤ 46%, neutral between (and always neutral when thin).
* **bar width** — `games / (max games on any one faction)`, so the most-played
  faction fills the track.

### Win rate by length

Four fixed duration buckets ([`DURATION_BUCKETS`](../src/main/analytics.ts)),
using each appearance's `durationMs`:

| Bucket | Range |
|---|---|
| `<15m` | 0 – 15 min |
| `15–25m` | 15 – 25 min |
| `25–40m` | 25 – 40 min |
| `40m+` | 40 min and up |

Each column shows the bucket's **win rate** (bar height = `winRate × 100%`,
same colour thresholds) and its **game count**.

## 5b. Start positions (per-map)

Its own full-width card below the breakdown row. **Everything here is per map** —
spots are only ever ranked and win-rated against the *other spots on that same
map*, never pooled across maps (an "air" spot on one map is a different place
from "air" on another).

One row per map, most-played first (up to 6, min **6 positioned games** —
`START_MAP_MIN_GAMES` / `START_MAP_LIMIT`). Each row = the map's real minimap
texture with numbered dots, next to a ranked list of that map's spots.

### Where the position comes from

The local demo only carries the **ally-team start box** — the whole team's half
of the map, shared by every teammate — so it cannot tell one player's spot from
another's. Per-player start positions are read instead from the **cached
bar-rts.com record** (`AllyTeams[].Players[].startPos` + `Map.width/height`),
filled in by the background backfill (§1) and by opening replays with Online
lookup on. Games with no cached record contribute nothing here (`serverPlayerData`
in [`analytics.ts`](../src/main/analytics.ts)).

* Normalised coords for plotting: `x = startPos.x / (Map.width × 512)`,
  `y = startPos.z / (Map.height × 512)`, clamped to 0–1. `(0, 0)` is the engine's
  "unset" sentinel and is skipped.
* The minimap texture is fetched with the map's **full name** (latest version
  seen in the group), same path as the Overview map panel (`useMapImage`).

### Clustering into spots

Per map, the player's deploy points are clustered by proximity
(`clusterStartSpots`): greedy assignment to the nearest existing cluster within
`SPOT_MERGE_DIST = 0.055` normalised units (recentred on its running mean as
points join), then up to 6 merge passes combining any two clusters that drifted
within that distance of each other. Spots are sorted by games, descending — spot
1 is where you deploy most **on that map**.

### What each row shows

| Element | Meaning |
|---|---|
| dot position | cluster centroid, as a % of map width/height |
| dot size | `15 + (spotGames / mostGamesOnThisMap) × 26` px |
| dot / bar colour | win rate from that spot — green ≥ 54%, red ≤ 46%, neutral between (and when the sample is thin) |
| dot number | the spot's rank on this map (ties it to the list) |
| list label | the spot's curated **role** (`air`, `front/tech`, …) when the map is in maps-metadata, else `Spot N`. Role = `majorityRole` of the cluster's games (see §5b · roles) |
| list `%` | `spotGames / map.games` — share of *this map's* positioned games |
| list bar + `%` | win rate at that spot |
| hover (dot) | `label · N games · WR% win rate` |

The card footer reports how many scoped games had **no** start position available
(`startNoData`).

### Roles

Roles come from `beyond-all-reason/maps-metadata`: the maps team curates a `role`
(`air / front / tech / sea` + slashed combos) for every labelled spawn point, per
team-size config. Each deploy point is snapped to the nearest labelled spawn
(within ~2600 elmos) for the config matching the game's team size, and takes that
spawn's role ([`roleForPosition`](../src/main/map-roles.ts)). Data is a trimmed
snapshot in [`src/main/map-roles.data.json`](../src/main/map-roles.data.json),
regenerated by [`scripts/fetch-map-roles.mjs`](../scripts/fetch-map-roles.mjs)
(~64 maps). The same lookup fills `role` on each **appearance** (the Appearances
"Pos" column) and on each **start pip** in the per-replay Overview map.

---

## 6. Maps and Company

### Maps

* Games grouped by map name with the trailing version stripped
  (`Supreme Isthmus v1.6` → `Supreme Isthmus`, via `stripMapVersion`).
* **Only maps with ≥ 20 games** are eligible; sorted by game count; **top 6**
  shown. "*+ more*" flag when there were more than 6.
* Per row: game count, and win rate (`wins / (wins + losses)`) as a coloured bar
  + percentage.

### Company — Allied with / Against

Built by walking each appearance's `allies` / `enemies` name lists
(`companyRows`):

* For every other player, accumulate games together, wins, losses, and their
  last-seen colour.
* **Only pairings with ≥ 15 shared games**; sorted by shared game count; **top 4**
  per column.
* Win rate is *the subject player's* win rate in those shared games
  (`wins / (wins + losses)`), coloured with the usual thresholds. The left border
  uses the other player's in-game RGB colour.

> "Allied with" win rate near 50% is expected for a frequent teammate; well above
> means the pair tends to win together, well below the opposite. "Against" win
> rate is how often the subject beats that opponent.

---

## 7. Appearances table

One row per scoped game, **newest first** (`[...scoped].reverse()`). Filter chips
(All / Wins / Losses); starts capped at 10 rows, "Load more" up to 25, then
scrolls all.

| Column | Source |
|---|---|
| Date | appearance start time |
| Map | version-stripped map name |
| Fmt | ally-team sizes joined with `v` (`8v8`, `3v3v3`, `FFA`) |
| Side | BAR blue/red label for the player's team — from the captain's colour, defaulting team 1 → blue in a 2-team game (`teamColorNames`) |
| Fac | first letter of the normalised faction |
| Pos | curated start-position role (`air` / `front` / `front/tech` / …), or `—` when unknown / map not covered (see §5b · Roles) |
| Result | Victory / Defeat / — |
| Length | `durationMs` as `m:ss` / `h:mm:ss` |
| Metal | `metalProduced`, compact (`fmtCompact`: `1.5M` / `708k` / `5.4k` / `420`) |
| Dmg | `damageDealt`, compact |
| Eff | `round(damageDealt / damageReceived × 100)` %. Green when ≥ the player's **mean Eff across all their appearances**, red below. `—` when `damageReceived` is 0/absent |
| CMD/min | `cmdPerMin`, rounded |

Clicking a row opens that replay in the detail view.

---

## Glossary of formulas

```
result            = allyTeam.won ? 'win' : (won === false ? 'loss' : 'undecided')
winRate           = wins / (wins + losses)          # undecided excluded
efficiency (%)    = damageDealt / damageReceived * 100
metalPerMin       = metalProduced / (durationMs / 60000)
energyPerMin      = energyProduced / (durationMs / 60000)
cmdPerMin         = PlayerStatistics.numCommands / (gameTimeSeconds / 60)
averageX          = mean(scoped appearances' X)
baselineX         = mean(ALL indexed appearances' X)   # ignores scope
delta (normal)    = (averageX - baselineX) / baselineX * 100      # "%"
delta (efficiency)= averageX - baselineX                          # "pt"
faction           = bar-rts Players[].faction when cached, else local [TEAM].side
factionConfirmed  = faction came from bar-rts (not the lobby default)
startNX / startNY = bar-rts startPos.{x,z} / (Map.{width,height} * 512), clamped 0..1
startSpot         = proximity cluster of a player's startNX/NY on one map (< 0.055)
spot share        = spotGames / map.games          # within that one map only
role              = maps-metadata role of the nearest labelled spawn (< 2600 elmos)
                    for the config matching the game's team size
share (bars)      = groupGames / max(groupGames across the breakdown)
thinSample        = scoped.length < 20
```

## Thresholds and cut-offs

| Thing | Value |
|---|---|
| Thin-sample cutoff | 20 games |
| Win-rate green / red | ≥ 54% / ≤ 46% |
| Form chart window | last 50 games |
| Rolling average window | 10 games |
| Maps: min games / shown | 20 / top 6 |
| Start positions: min positioned games / maps shown | 6 / top 6 |
| Start spot cluster / merge distance | 0.055 normalised map units |
| Role snap distance (position → nearest labelled spawn) | 2600 elmos |
| Maps with curated role data | ~64 (`map-roles.data.json`) |
| Company: min shared games / shown | 15 / top 4 |
| Stats snapshot period (engine) | 15 s |
| `90d` scope window | 90 days |
