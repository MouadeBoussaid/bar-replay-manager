import { statSync } from 'node:fs'
import { basename } from 'node:path'
import type { AllyTeamMeta, PlayerMeta, ReplayMeta } from '../shared/types'
import { fetchServerReplay, mergeServerData } from './bar-api'
import { readDemoFile } from './demo-header'
import { store } from './store'
import { collectIndexed, findSection, parseTdf, type TdfSection } from './tdf'

/**
 * Resolve full detail for one replay: parse the local file (cached by mtime),
 * then optionally overlay bar-rts.com data.
 */
export async function getReplayDetail(
  filePath: string,
  onlineEnrich: boolean
): Promise<ReplayMeta> {
  const stat = statSync(filePath)

  const cached = store.getFreshCache(filePath, stat.mtimeMs)
  let localMeta: ReplayMeta
  if (cached?.meta) {
    localMeta = cached.meta
  } else {
    localMeta = parseLocal(filePath, stat.size)
    store.setCache(filePath, {
      mtimeMs: stat.mtimeMs,
      gameId: localMeta.gameId,
      meta: localMeta
    })
  }

  // Work on a copy so the cached local-only version is never mutated.
  let meta: ReplayMeta = structuredClone(localMeta)
  meta.fileSize = stat.size

  if (onlineEnrich && meta.gameId) {
    try {
      const server = await fetchServerReplay(meta.gameId)
      if (server) {
        meta = mergeServerData(meta, server)
        meta.source = 'local+online'
      }
    } catch (err) {
      meta.enrichError = err instanceof Error ? err.message : String(err)
    }
  }

  return meta
}

/** Parse just the local `.sdfz` into a ReplayMeta (source: 'local'). Never throws. */
export function parseLocal(filePath: string, fileSize: number): ReplayMeta {
  const fileName = basename(filePath)

  let raw: ReturnType<typeof readDemoFile>
  try {
    raw = readDemoFile(filePath)
  } catch (err) {
    return {
      gameId: null,
      filePath,
      fileName,
      fileSize,
      map: { name: mapFromFileName(fileName) ?? 'Unknown' },
      startTime: startTimeFromFileName(fileName),
      durationMs: 0,
      engineVersion: '',
      gameVersion: '',
      endedNormally: false,
      allyTeams: [],
      spectators: [],
      hostSettings: {},
      gameSettings: {},
      mapSettings: {},
      spadsSettings: {},
      source: 'local',
      parseError: `Could not parse replay: ${
        err instanceof Error ? err.message : String(err)
      }`
    }
  }

  const root = parseTdf(raw.scriptText)
  const game = findSection(root, 'game') ?? root

  const players = collectIndexed(game, 'player')
  const ais = collectIndexed(game, 'ai')
  const teams = collectIndexed(game, 'team')
  const allyteams = collectIndexed(game, 'allyteam')

  // Final per-team economy/combat totals from the demo trailer, indexed by teamId.
  const teamStatById = new Map(raw.teamStats.map((s) => [s.teamId, s]))
  const playerStatById = new Map(raw.playerStats.map((s) => [s.playerId, s]))
  const gameMinutes = raw.gameTimeSeconds > 0 ? raw.gameTimeSeconds / 60 : 0

  const buildStats = (
    teamId: number | undefined,
    playerId?: number
  ): PlayerMeta['stats'] => {
    const ts = teamId !== undefined ? teamStatById.get(teamId) : undefined
    if (!ts) return undefined
    const ps = playerId !== undefined ? playerStatById.get(playerId) : undefined
    return {
      metalProduced: Math.round(ts.metalProduced),
      metalExcess: Math.round(ts.metalExcess),
      energyProduced: Math.round(ts.energyProduced),
      energyExcess: Math.round(ts.energyExcess),
      damageDealt: Math.round(ts.damageDealt),
      damageReceived: Math.round(ts.damageReceived),
      unitsProduced: ts.unitsProduced,
      unitsKilled: ts.unitsKilled,
      unitsLost: ts.unitsDied,
      cmdPerMin:
        ps && gameMinutes > 0 ? Math.round(ps.numCommands / gameMinutes) : undefined
    }
  }

  const allyMap = new Map<number, AllyTeamMeta>()
  const ensureAlly = (id: number): AllyTeamMeta => {
    let a = allyMap.get(id)
    if (!a) {
      a = { id, players: [] }
      const at = allyteams[id]
      if (at) {
        const l = num(at.keys['startrectleft'])
        const t = num(at.keys['startrecttop'])
        const r = num(at.keys['startrectright'])
        const b = num(at.keys['startrectbottom'])
        if ([l, t, r, b].every((x) => x !== undefined)) {
          a.startBox = { left: l!, top: t!, right: r!, bottom: b! }
        }
      }
      allyMap.set(id, a)
    }
    return a
  }

  const spectators: PlayerMeta[] = []

  for (const [pid, p] of Object.entries(players)) {
    const isSpec = p.keys['spectator'] === '1'
    const teamId = num(p.keys['team'])
    const team = teamId !== undefined ? teams[teamId] : undefined

    const ts = teamId !== undefined ? teamStatById.get(teamId) : undefined
    const pm: PlayerMeta = {
      name: p.keys['name'] ?? `Player ${pid}`,
      countryCode: p.keys['countrycode'] || undefined,
      rank: num(p.keys['rank']),
      skillOS: parseSkill(p.keys['skill']),
      skillSigma: num(p.keys['skilluncertainty']),
      faction: team?.keys['side'] || undefined,
      rgbColor: rgb(team?.keys['rgbcolor']),
      startPos: startPosOf(team),
      metal: ts ? Math.round(ts.metalProduced) : undefined,
      stats: buildStats(teamId, Number(pid))
    }

    if (isSpec || teamId === undefined || team === undefined) {
      spectators.push(pm)
    } else {
      const allyId = num(team.keys['allyteam']) ?? 0
      ensureAlly(allyId).players.push(pm)
    }
  }

  for (const [aid, ai] of Object.entries(ais)) {
    const teamId = num(ai.keys['team'])
    const team = teamId !== undefined ? teams[teamId] : undefined
    const allyId = num(team?.keys['allyteam']) ?? 0
    const ts = teamId !== undefined ? teamStatById.get(teamId) : undefined
    ensureAlly(allyId).players.push({
      name: ai.keys['name'] ?? ai.keys['shortname'] ?? `AI ${aid}`,
      faction: team?.keys['side'] || undefined,
      rgbColor: rgb(team?.keys['rgbcolor']),
      startPos: startPosOf(team),
      metal: ts ? Math.round(ts.metalProduced) : undefined,
      stats: buildStats(teamId),
      isAi: true
    })
  }

  if (raw.winningAllyTeams.length > 0) {
    for (const a of allyMap.values()) {
      a.won = raw.winningAllyTeams.includes(a.id)
    }
  }

  const modoptions = findSection(game, 'modoptions')
  const hostoptions = findSection(game, 'hostoptions')

  const allyTeams = [...allyMap.values()].sort((a, b) => a.id - b.id)

  const startTime =
    raw.startTimeUnix > 0
      ? new Date(raw.startTimeUnix * 1000).toISOString()
      : startTimeFromFileName(fileName)

  // Match-wide aggregates from the per-team demo trailer (both sides combined).
  let stats: ReplayMeta['stats'] | undefined
  if (raw.teamStats.length > 0) {
    const sum = (pick: (s: (typeof raw.teamStats)[number]) => number): number =>
      raw.teamStats.reduce((acc, s) => acc + pick(s), 0)
    stats = {
      metalProduced: Math.round(sum((s) => s.metalProduced)),
      energyProduced: Math.round(sum((s) => s.energyProduced)),
      unitsLost: sum((s) => s.unitsDied),
      unitsKilled: sum((s) => s.unitsKilled),
      damageDealt: Math.round(sum((s) => s.damageDealt))
    }
  }

  return {
    gameId: raw.gameId,
    filePath,
    fileName,
    fileSize,
    map: { name: game.keys['mapname'] ?? mapFromFileName(fileName) ?? 'Unknown' },
    startTime,
    durationMs: (raw.gameTimeSeconds || 0) * 1000,
    engineVersion: raw.engineVersion,
    gameVersion: game.keys['gametype'] ?? '',
    endedNormally: raw.demoStreamSize > 0,
    allyTeams,
    spectators,
    hostSettings: sectionKeys(hostoptions),
    gameSettings: sectionKeys(modoptions),
    mapSettings: {},
    spadsSettings: {},
    stats,
    source: 'local'
  }
}

// ---- helpers -----------------------------------------------------------

function sectionKeys(sec: TdfSection | undefined): Record<string, string> {
  return sec ? { ...sec.keys } : {}
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Fixed / pre-placed start position (world elmos) from a `[TEAM_n]` section. */
function startPosOf(
  team: TdfSection | undefined
): { x: number; z: number } | undefined {
  const x = num(team?.keys['startposx'])
  const z = num(team?.keys['startposz'])
  if (x === undefined || z === undefined) return undefined
  if (x === 0 && z === 0) return undefined
  return { x, z }
}

/** SPADS writes skill like `[i22.55]`, `(22.55)`, or plain `22.55`. */
function parseSkill(v: string | undefined): number | undefined {
  if (!v) return undefined
  const m = v.match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : undefined
}

function rgb(v: string | undefined): string | undefined {
  if (!v) return undefined
  const parts = v.trim().split(/\s+/).map(Number)
  if (parts.length === 3 && parts.every((x) => Number.isFinite(x))) {
    const [r, g, b] = parts.map((x) => Math.round((x <= 1 ? x * 255 : x)))
    return `rgb(${r}, ${g}, ${b})`
  }
  return v
}

function mapFromFileName(fileName: string): string | undefined {
  const m = fileName
    .replace(/\.sdfz?$/i, '')
    .match(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?_(.+)_[^_]+$/)
  return m ? m[1]!.replace(/_/g, ' ').trim() : undefined
}

function startTimeFromFileName(fileName: string): string | null {
  const m = fileName.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}
