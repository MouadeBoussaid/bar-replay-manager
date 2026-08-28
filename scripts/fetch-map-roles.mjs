// Regenerate src/main/map-roles.data.json from BAR's maps-metadata.
//
//   node scripts/fetch-map-roles.mjs
//
// Source of truth: the maps team curates start-position "roles" (air / front /
// tech / sea, plus slashed combos) per map + team-size config in a Rowy sheet,
// exported to map_list.validated.json. We trim it to { mapKey: [ {ppt,tc,spots} ] }
// where mapKey is the version-stripped, lower-cased map name and each spot is
// [x, z, role] in world elmos — the same space as a demo's start positions.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = 'https://maps-metadata.beyondallreason.dev/latest/map_list.validated.json'
const OUT = resolve(fileURLToPath(import.meta.url), '../../src/main/map-roles.data.json')

/** Mirror of stripMapVersion() in src/main/analytics.ts. */
function stripMapVersion(name) {
  const m = String(name).match(/^(.*?)[\s_]+v?\d[\w.]*$/i)
  return (m ? m[1] : name).trim()
}
const keyOf = (springName) => stripMapVersion(springName).toLowerCase()

const res = await fetch(SRC)
if (!res.ok) {
  console.error(`fetch failed: HTTP ${res.status}`)
  process.exit(1)
}
const maps = await res.json()

/** @type {Record<string, {ppt:number,tc:number,spots:[number,number,string][]}[]>} */
const out = {}
let mapCount = 0
let spotCount = 0

for (const entry of Object.values(maps)) {
  const sp = entry?.startPos
  if (!sp?.positions || !Array.isArray(sp.team)) continue

  const configs = []
  for (const team of sp.team) {
    const ppt = Number(team.playersPerTeam)
    const tc = Number(team.teamCount ?? (Array.isArray(team.sides) ? team.sides.length : 0))
    if (!ppt || !tc || !Array.isArray(team.sides)) continue

    const spots = []
    for (const side of team.sides) {
      for (const start of side.starts ?? []) {
        const pos = sp.positions[start.spawnPoint]
        if (!pos || !start.role) continue
        spots.push([Math.round(pos.x), Math.round(pos.y), start.role])
      }
    }
    if (spots.length > 0) configs.push({ ppt, tc, spots })
  }
  if (configs.length === 0) continue

  // Last version of a name wins (entries are roughly version-ordered).
  out[keyOf(entry.springName)] = configs
  mapCount++
  spotCount += configs.reduce((n, c) => n + c.spots.length, 0)
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n')
console.log(`wrote ${mapCount} maps, ${spotCount} labelled spots -> ${OUT}`)
