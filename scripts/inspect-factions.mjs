// Dump how faction / "side" is recorded in a replay's start script, so we can see
// why the analytics Faction card is missing a faction.
//   node scripts/inspect-factions.mjs "C:\path\to\some.sdfz"
import { readDemoFile } from '../src/main/demo-header.ts'
import { parseTdf, findSection, collectIndexed } from '../src/main/tdf.ts'

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/inspect-factions.mjs <path-to-.sdfz>')
  process.exit(1)
}

const raw = readDemoFile(path)
const root = parseTdf(raw.scriptText)
const game = findSection(root, 'game') ?? root

console.log('--- [GAME] keys that look faction-ish ---')
for (const [k, v] of Object.entries(game.keys)) {
  if (/side|faction|random|commander/i.test(k)) console.log(`  ${k} = ${JSON.stringify(v)}`)
}

for (const label of ['modoptions', 'hostoptions']) {
  const sec = findSection(game, label)
  if (!sec) continue
  const hits = Object.entries(sec.keys).filter(([k]) => /side|faction|random|commander/i.test(k))
  if (hits.length) {
    console.log(`--- [${label.toUpperCase()}] faction-ish keys ---`)
    for (const [k, v] of hits) console.log(`  ${k} = ${JSON.stringify(v)}`)
  }
}

const players = collectIndexed(game, 'player')
const teams = collectIndexed(game, 'team')

console.log('\n--- [TEAM_n] sections ---')
for (const [id, t] of Object.entries(teams)) {
  console.log(`  team${id}: ${JSON.stringify(t.keys)}`)
}

console.log('\n--- players -> team.side ---')
for (const [pid, p] of Object.entries(players)) {
  if (p.keys['spectator'] === '1') continue
  const tid = p.keys['team']
  const team = tid !== undefined ? teams[Number(tid)] : undefined
  console.log(
    `  ${(p.keys['name'] ?? 'player' + pid).padEnd(20)} team=${tid}` +
      `  side=${JSON.stringify(team?.keys['side'])}` +
      `  team.keys=${JSON.stringify(team?.keys ?? null)}`
  )
}
