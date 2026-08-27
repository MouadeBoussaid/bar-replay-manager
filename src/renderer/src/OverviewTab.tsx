import type { AllyTeamMeta, PlayerMeta, ReplayMeta } from '../../shared/types'
import { fmtClock, fmtK, flagEmoji } from './format'
import { buildRosters, pipPosition, teamAvgOs, type RosterEntry } from './players'

interface Props {
  meta: ReplayMeta
  spoil: boolean
}

export function OverviewTab({ meta, spoil }: Props): JSX.Element {
  const rosters = buildRosters(meta)
  const slots = meta.allyTeams.reduce((n, t) => n + t.players.length, 0)
  const winnerIdx = meta.allyTeams.findIndex((t) => t.won === true)

  return (
    <div className="overview">
      <div className="overview-top">
        <MapPanel meta={meta} rosters={rosters} slots={slots} />
        <StatGrid meta={meta} spoil={spoil} winnerIdx={winnerIdx} />
      </div>

      <div className="rosters">
        {meta.allyTeams.map((team, i) => (
          <TeamRoster
            key={team.id}
            team={team}
            ordinal={i}
            entries={rosters[i] ?? []}
            spoil={spoil}
          />
        ))}
      </div>
    </div>
  )
}

function MapPanel({
  meta,
  rosters,
  slots
}: {
  meta: ReplayMeta
  rosters: RosterEntry[][]
  slots: number
}): JSX.Element {
  const zoneCount = Math.max(2, meta.allyTeams.length)
  const twoZone = meta.allyTeams.length === 2

  return (
    <div className="map-panel">
      <div className="map-frame">
        <div className={`map-image ${twoZone ? 'map-zones-2' : ''}`} />
        {twoZone && (
          <>
            <span className="zone-caption zone-caption-top">NORTH · TEAM 1</span>
            <span className="zone-caption zone-caption-bottom">SOUTH · TEAM 2</span>
          </>
        )}
        {meta.allyTeams.map((team, ti) =>
          team.players.map((p, pi) => {
            const entry = rosters[ti]?.[pi]
            const pos = pipPosition(p, team, pi, team.players.length, ti, zoneCount)
            const flipX = pos.x > 0.74
            return (
              <div
                key={`${ti}-${pi}`}
                className={`pip ${flipX ? 'pip-flip' : ''}`}
                style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
              >
                <span className="pip-dot" style={{ background: entry?.color }} />
                <span className="pip-label" style={{ color: entry?.color }}>
                  {p.name}
                </span>
              </div>
            )
          })
        )}
      </div>
      <div className="map-caption">
        start positions · {slots} slot{slots === 1 ? '' : 's'}
      </div>
    </div>
  )
}

function StatGrid({
  meta,
  spoil,
  winnerIdx
}: {
  meta: ReplayMeta
  spoil: boolean
  winnerIdx: number
}): JSX.Element {
  const s = meta.stats
  const dim = meta.map.width && meta.map.height ? `${meta.map.width} × ${meta.map.height}` : null

  const winnerValue = winnerIdx >= 0 ? `Team ${winnerIdx + 1}` : meta.endedNormally ? 'Draw' : '—'
  const winnerSub =
    winnerIdx >= 0
      ? [s?.winReason, s?.peakArmyValueAtMs ? fmtClock(s.peakArmyValueAtMs) : null]
          .filter(Boolean)
          .join(' · ') || 'result recorded'
      : meta.endedNormally
        ? 'no surviving side'
        : 'game did not finish'

  return (
    <div className="stat-grid">
      <StatCard
        label="Winner"
        value={spoil ? winnerValue : 'Hidden'}
        sub={spoil ? winnerSub : 'enable Spoil to reveal'}
        rule
      />
      <StatCard
        label="Peak army value"
        value={fmtK(s?.peakArmyValue)}
        sub={
          s?.peakArmyValue == null
            ? 'online only'
            : s.peakArmyValueTeamId != null
              ? `Team ${s.peakArmyValueTeamId + 1}${s.peakArmyValueAtMs ? ` at ${fmtClock(s.peakArmyValueAtMs)}` : ''}`
              : 'match peak'
        }
        rule
      />
      <StatCard
        label="Metal produced"
        value={fmtK(s?.metalProduced)}
        sub={s?.metalProduced == null ? 'online only' : 'both teams'}
        rule
      />
      <StatCard
        label="Units lost"
        value={s?.unitsLost != null ? s.unitsLost.toLocaleString() : '—'}
        sub={
          s?.unitsLost == null
            ? 'online only'
            : s.unitsLostPerMinutePeak
              ? `${Math.round(s.unitsLostPerMinutePeak).toLocaleString()} / minute peak`
              : 'both teams'
        }
        rule
      />
      <div className="stat-card stat-card-map">
        <div className="stat-card-row">
          <span className="stat-label">Map</span>
          <span className="stat-map-meta">{dim ?? '—'}</span>
        </div>
        <div className="stat-map-name">{meta.map.name}</div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  rule
}: {
  label: string
  value: string
  sub?: string
  rule?: boolean
}): JSX.Element {
  return (
    <div className={`stat-card ${rule ? 'stat-card-rule' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function TeamRoster({
  team,
  ordinal,
  entries,
  spoil
}: {
  team: AllyTeamMeta
  ordinal: number
  entries: RosterEntry[]
  spoil: boolean
}): JSX.Element {
  const avg = teamAvgOs(team)
  const won = team.won === true
  const lost = team.won === false

  return (
    <div className="roster">
      <div className="roster-head">
        <span className="roster-title">TEAM {ordinal + 1}</span>
        {spoil && won && <span className="result-badge result-win">VICTORY</span>}
        {spoil && lost && <span className="result-badge result-loss">DEFEAT</span>}
        {avg != null && <span className="roster-avg">avg {avg.toFixed(2)} OS</span>}
      </div>
      {entries.map((entry, i) => (
        <PlayerLine key={i} entry={entry} winning={spoil && won} />
      ))}
    </div>
  )
}

function PlayerLine({
  entry,
  winning
}: {
  entry: RosterEntry
  winning: boolean
}): JSX.Element {
  const { player, color, valueShare } = entry
  return (
    <div className="player-line" style={{ borderLeftColor: color }}>
      <div className="player-top">
        <span className={`faction faction-${factionKey(player)}`}>{factionLetter(player)}</span>
        <span className="player-flag">{flagEmoji(player.countryCode) || '🏳'}</span>
        <span className="player-name">
          {player.name}
          {player.isAi && <span className="ai-tag">AI</span>}
        </span>
        <span className="player-os">
          {typeof player.skillOS === 'number' ? `${player.skillOS.toFixed(2)} OS` : '—'}
        </span>
      </div>
      <div className="player-bottom">
        <span className="value-track">
          <span
            className={`value-fill ${winning ? 'value-fill-win' : ''}`}
            style={{ width: `${Math.round(valueShare * 100)}%` }}
          />
        </span>
        <span className="player-metal">
          {player.metal != null ? `${fmtK(player.metal)} metal` : '—'}
        </span>
      </div>
    </div>
  )
}

function factionKey(p: PlayerMeta): string {
  const f = (p.faction ?? '').toLowerCase()
  if (f.startsWith('cor')) return 'cortex'
  if (f.startsWith('arm')) return 'armada'
  if (f.startsWith('leg')) return 'legion'
  return 'other'
}

function factionLetter(p: PlayerMeta): string {
  const f = (p.faction ?? '').trim()
  return f ? f[0]!.toUpperCase() : '·'
}
