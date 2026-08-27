// Synthetic .sdfz round-trip test for demo-header.ts + tdf.ts.
// Run: node scripts/parser-smoke.mjs
import { gzipSync } from 'node:zlib'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readDemoFile } from '../src/main/demo-header.ts'
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

const buf = Buffer.alloc(HEADER + scriptBuf.length + demoStream.length + winning.length)
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
buf.writeInt32LE(2, 332) // numTeams
buf.writeInt32LE(1, 348) // winningAllyTeamsSize
scriptBuf.copy(buf, HEADER)
demoStream.copy(buf, HEADER + scriptBuf.length)
winning.copy(buf, HEADER + scriptBuf.length + demoStream.length)

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
