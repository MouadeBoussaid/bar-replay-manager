// Synthetic .sdfz round-trip test for demo-header.ts + tdf.ts.
// Run: node scripts/parser-smoke.mjs
import { gzipSync } from 'node:zlib'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readDemoFile, readDemoSeries } from '../src/main/demo-header.ts'
import { parseTdf, findSection, collectIndexed } from '../src/main/tdf.ts'

const script = `[GAME]
{
    Mapname=All That Glitters v2.2.3;
    GameType=Beyond All Reason test-31090;
    [MODOPTIONS] { maxunits=2000; startmetal=1000; }
    [HOSTOPTIONS] { autohostname=BArankTest; }
    [PLAYER0] { name=HammerHead; team=0; spectator=0; countrycode=pl; skill=[i17.45]; skilluncertainty=2.1; }
    [PLAYER1] { name=A10_Warthog; team=1; spectator=0; countrycode=de; skill=[i20.37]; }
    [PLAYER2] { name=SpectatorGuy; spectator=1; }
    [TEAM0] { teamleader=0; allyteam=0; side=Armada; rgbcolor=0.1 0.3 0.9; }
    [TEAM1] { teamleader=1; allyteam=1; side=Cortex; rgbcolor=0.9 0.1 0.1; }
    [ALLYTEAM0] { numallies=0; }
    [ALLYTEAM1] { numallies=0; }
}
\0`

const scriptBuf = Buffer.from(script, 'utf-8')
const HEADER = 352
const demoStream = Buffer.alloc(10)
const winning = Buffer.from([0])

// Synthetic player-stats block: 2 records of 5 int32 (mousePixels, mouseClicks,
// keyPresses, numCommands, unitCommands).
const PLAYER_ELEM = 20
const playerStats = Buffer.alloc(2 * PLAYER_ELEM)
playerStats.writeInt32LE(1200, 0 * PLAYER_ELEM + 12) // player 0 numCommands
playerStats.writeInt32LE(900, 1 * PLAYER_ELEM + 12) // player 1 numCommands

// Synthetic team-stats trailer: 2 snapshots for team 0, 1 for team 1.
const TEAM_ELEM = 80 // includes the leading `int frame`
const teamStats = Buffer.alloc(8 + 3 * TEAM_ELEM)
teamStats.writeInt32LE(2, 0) // team 0 snapshot count
teamStats.writeInt32LE(1, 4) // team 1 snapshot count
let o = 8 // team 0's FIRST snapshot
teamStats.writeInt32LE(0, o) // frame
teamStats.writeFloatLE(1000, o + 4 + 8) // metalProduced
o = 8 + TEAM_ELEM // team 0's LAST snapshot; +4 skips `frame`
teamStats.writeInt32LE(450, o) // frame (15s @ 30fps)
teamStats.writeFloatLE(5000, o + 4 + 8) // metalProduced
teamStats.writeFloatLE(400, o + 4 + 16) // metalExcess
teamStats.writeFloatLE(99000, o + 4 + 12) // energyProduced
teamStats.writeFloatLE(12345, o + 4 + 40) // damageDealt
teamStats.writeInt32LE(42, o + 4 + 52) // unitsDied
teamStats.writeInt32LE(7, o + 4 + 72) // unitsKilled
o = 8 + 2 * TEAM_ELEM // team 1's only snapshot
teamStats.writeInt32LE(0, o) // frame
teamStats.writeFloatLE(3000, o + 4 + 8)
teamStats.writeInt32LE(10, o + 4 + 52)
teamStats.writeInt32LE(20, o + 4 + 72)

const buf = Buffer.alloc(
  HEADER +
    scriptBuf.length +
    demoStream.length +
    playerStats.length +
    teamStats.length +
    winning.length
)
buf.write('spring demofile\0', 0, 'ascii')
buf.writeInt32LE(5, 16) // version
buf.writeInt32LE(HEADER, 20) // headerSize
buf.write('2026.01.01', 24, 'ascii') // versionString
Buffer.alloc(16, 0x11).copy(buf, 280) // gameID
buf.writeBigUInt64LE(1756200000n, 296) // unixTime
buf.writeInt32LE(scriptBuf.length, 304) // scriptSize
buf.writeInt32LE(demoStream.length, 308) // demoStreamSize
buf.writeInt32LE(1263, 312) // gameTime seconds
buf.writeInt32LE(1300, 316) // wallclock
buf.writeInt32LE(2, 320) // numPlayers
buf.writeInt32LE(playerStats.length, 324) // playerStatChunkSize
buf.writeInt32LE(PLAYER_ELEM, 328) // playerStatElemSize
buf.writeInt32LE(2, 332) // numTeams
buf.writeInt32LE(teamStats.length, 336) // teamStatChunkSize
buf.writeInt32LE(TEAM_ELEM, 340) // teamStatElemSize
buf.writeInt32LE(1, 348) // winningAllyTeamsSize
let at = HEADER
scriptBuf.copy(buf, at)
at += scriptBuf.length
demoStream.copy(buf, at)
at += demoStream.length
playerStats.copy(buf, at) // layout: [playerStats][teamStats][winners]
at += playerStats.length
teamStats.copy(buf, at)
at += teamStats.length
winning.copy(buf, at)

const dir = mkdtempSync(join(tmpdir(), 'sdfz-'))
const file = join(dir, 'test.sdfz')
writeFileSync(file, gzipSync(buf))

const raw = readDemoFile(file)
const root = parseTdf(raw.scriptText)
const game = findSection(root, 'game')
const players = collectIndexed(game, 'player')
const teams = collectIndexed(game, 'team')

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error(`  FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  } else {
    console.log(`  ok   ${label}`)
  }
}

check('engineVersion', raw.engineVersion, '2026.01.01')
check('gameId', raw.gameId, '11111111111111111111111111111111')
check('startTimeUnix', raw.startTimeUnix, 1756200000)
check('gameTimeSeconds', raw.gameTimeSeconds, 1263)
check('demoStreamSize', raw.demoStreamSize, 10)
check('winningAllyTeams', raw.winningAllyTeams, [0])
check('teamStats.length', raw.teamStats.length, 2)
check('teamStats[0].metalProduced', raw.teamStats[0].metalProduced, 5000)
check('teamStats[0].metalExcess', raw.teamStats[0].metalExcess, 400)
check('teamStats[0].energyProduced', raw.teamStats[0].energyProduced, 99000)
check('teamStats[0].unitsDied', raw.teamStats[0].unitsDied, 42)
check('teamStats[0].unitsKilled', raw.teamStats[0].unitsKilled, 7)
check('teamStats[0].damageDealt', raw.teamStats[0].damageDealt, 12345)
check('teamStats[1].metalProduced', raw.teamStats[1].metalProduced, 3000)
check('teamStats[1].unitsKilled', raw.teamStats[1].unitsKilled, 20)
check('playerStats.length', raw.playerStats.length, 2)
check('playerStats[0].numCommands', raw.playerStats[0].numCommands, 1200)
check('playerStats[1].numCommands', raw.playerStats[1].numCommands, 900)

const series = readDemoSeries(file)
check('series teams', series.teams.length, 2)
check('series team0 samples', series.teams[0].samples.length, 2)
check('series team0 s0 metalProduced', series.teams[0].samples[0].metalProduced, 1000)
check('series team0 s1 metalProduced', series.teams[0].samples[1].metalProduced, 5000)
check('series team0 s1 frame', series.teams[0].samples[1].frame, 450)
check('series team1 samples', series.teams[1].samples.length, 1)
check('series periodSeconds', series.periodSeconds, 15)
check('mapname', game.keys['mapname'], 'All That Glitters v2.2.3')
check('gametype', game.keys['gametype'], 'Beyond All Reason test-31090')
check('modoptions.maxunits', findSection(game, 'modoptions').keys['maxunits'], '2000')
check('hostoptions.autohostname', findSection(game, 'hostoptions').keys['autohostname'], 'BArankTest')
check('player0.name', players[0].keys['name'], 'HammerHead')
check('player0.countrycode', players[0].keys['countrycode'], 'pl')
check('player0.skill', players[0].keys['skill'], '[i17.45]')
check('player2.spectator', players[2].keys['spectator'], '1')
check('team0.side', teams[0].keys['side'], 'Armada')
check('team1.allyteam', teams[1].keys['allyteam'], '1')
check('player count', Object.keys(players).length, 3)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
