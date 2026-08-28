# User Analytics tab — statistics reference

This document explains every number shown on the **User Analytics** tab and how it
is derived from the replay files. The tab aggregates one player's performance
across *every* locally-indexed replay.

Code: [`src/main/analytics.ts`](../src/main/analytics.ts) (aggregation),
[`src/renderer/src/AnalyticsTab.tsx`](../src/renderer/src/AnalyticsTab.tsx)
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

Faction (`side`), OpenSkill rating (`skill`), player colour (`rgbcolor`), start
position (`startpos` / ally-team `startrect*`), team/ally-team structure, and the
`spectator` flag all come from parsing the embedded start script.

### Per-appearance row

The unit of aggregation is an **appearance** — one player's line in one replay
([`interface Appearance`](../src/main/analytics.ts)). `setAnalyticsIndex()`
flattens every indexed replay into a flat list of appearances (`INDEX`), and a
report is `INDEX.filter(a => a.nameKey === name.toLowerCase())`.

Fields captured per appearance: name, file path, start time, map (version suffix
stripped), duration, format (`8v8` etc.), side (blue/red), faction, result,
OS, colour, start-grid cell, and the raw stat fields
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

**Thin sample:** if `scoped.length < 20` the tab shows only the averages grid and
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
* **`N g`** — games on that faction.
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

### Start position

A 3 columns × 2 rows grid over the map (cells 0–5, row-major: N-left, N-centre,
N-right, S-left, S-centre, S-right).

* Cell for an appearance comes from the player's **start position** normalised to
  the map (`startPos.x / (mapWidth × 512)`, same for `z`), falling back to the
  **ally-team start box** centroid. Column split at ⅓ / ⅔, row split at ½.
* Each cell shows `count / (appearances with a readable cell)` as a percentage;
  background opacity scales with that fraction.
* **Splits** below:
  * `north` = cells 0+1+2, `south` = `1 − north`
  * `centre` = cells 1+4 (the middle column), `flank` = `1 − centre`
* Appearances with no readable start box/position are counted in
  "*N excluded — unreadable start boxes*" and left out of the percentages.

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
startCell         = 3x2 grid index from normalised start pos / start-box centroid
north / south     = share of appearances in the top / bottom grid row
centre / flank    = share in / outside the middle grid column
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
| Company: min shared games / shown | 15 / top 4 |
| Stats snapshot period (engine) | 15 s |
| `90d` scope window | 90 days |
