import type { AllyTeamMeta, PlayerMeta, ReplayMeta } from '../../shared/types'
import { fmtCompact, fmtK, flagEmoji } from './format'
import { buildPips, buildRosters, teamAvgOs, type RosterEntry } from './players'
import { useMapImage } from './useMapImage'
import { useMapInfo } from './useMapInfo'

interface Props {
  meta: ReplayMeta
}

export function OverviewTab({ meta }: Props): JSX.Element {
  const rosters = buildRosters(meta)
  const slots = meta.allyTeams.reduce((n, t) => n + t.players.length, 0)

  return (
    <div className="overview">
      <div className="overview-top">
        <MapPanel meta={meta} slots={slots} />
        <StatGrid meta={meta} />
      </div>

      <div className="rosters">
        {meta.allyTeams.map((team, i) => (
          <TeamRoster key={team.id} team={team} ordinal={i} entries={rosters[i] ?? []} />
        ))}
      </div>
    </div>
  )
}

function MapPanel({ meta, slots }: { meta: ReplayMeta; slots: number }): JSX.Element {
  const twoZone = meta.allyTeams.length === 2
  const photo = useMapImage(meta.map.name, 'thumb')
  const mapInfo = useMapInfo(meta.map.name)
  const pipRows = buildPips(meta, mapInfo)
  const approx = pipRows.some((row) => row.some((p) => p.approx))

  return (
    <div className="map-panel">
      <div className="map-frame">
        <div className="map-base" />
        {photo && (
          <img
            className="map-photo"
            src={photo}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        )}
        {twoZone && <div className="map-tint" />}
        {twoZone && (
          <>
            <span className="zone-caption zone-caption-top">NORTH · TEAM 1</span>
            <span className="zone-caption zone-caption-bottom">SOUTH · TEAM 2</span>
          </>
        )}
        {pipRows.map((row, ti) =>
          row.map((pip, pi) => {
            const flipX = pip.x > 0.74
            return (
              <div
                key={`${ti}-${pi}`}
                className={`pip ${flipX ? 'pip-flip' : ''} ${pip.approx ? 'pip-approx' : ''}`}
                style={{ left: `${pip.x * 100}%`, top: `${pip.y * 100}%` }}
              >
                <span className="pip-dot" style={{ background: pip.color }} />
                <span className="pip-label" style={{ color: pip.color }}>
                  {pip.name}
                </span>
              </div>
            )
          })
        )}
      </div>
      <div className="map-caption">
        {approx ? 'start areas (approx)' : 'player start positions'} · {slots} slot
        {slots === 1 ? '' : 's'}
      </div>
    </div>
  )
}

function StatGrid({ meta }: { meta: ReplayMeta }): JSX.Element {
  const winnerIdx = meta.allyTeams.findIndex((t) => t.won === true)
  const decided = meta.allyTeams.some((t) => t.won != null)
  const dim = meta.map.width && meta.map.height ? `${meta.map.width} × ${meta.map.height}` : null
  const teamFmt = meta.allyTeams.map((t) => t.players.length).join('v')

  return (
    <div className="stat-grid">
      <StatCard
        label="Winner"
        value={winnerIdx >= 0 ? `Team ${winnerIdx + 1}` : decided ? 'Draw' : '—'}
        sub={
          winnerIdx >= 0
            ? `${teamFmt} · ${meta.endedNormally ? 'game finished' : 'host ended early'}`
            : decided
              ? 'no surviving side'
              : 'game did not finish'
        }
        rule
      />
      <TeamStatCard label="Metal produced" meta={meta} pick={(s) => s.metalProduced} />
      <TeamStatCard label="Energy produced" meta={meta} pick={(s) => s.energyProduced} />
      <TeamStatCard label="Damage done" meta={meta} pick={(s) => s.damageDealt} />
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

/** A stat card that breaks the figure down per ally-team. */
function TeamStatCard({
  label,
  meta,
  pick
}: {
  label: string
  meta: ReplayMeta
  pick: (s: NonNullable<PlayerMeta['stats']>) => number
}): JSX.Element {
  const rows = meta.allyTeams.map((team, i) => {
    const rated = team.players.map((p) => p.stats).filter(Boolean) as NonNullable<
      PlayerMeta['stats']
    >[]
    return {
      ordinal: i,
      won: team.won === true,
      value: rated.length ? rated.reduce((a, s) => a + pick(s), 0) : null
    }
  })
  const anyValue = rows.some((r) => r.value != null)

  return (
    <div className="stat-card stat-card-rule">
      <div className="stat-label">{label}</div>
      {anyValue ? (
        <div className="stat-teams">
          {rows.map((r) => (
            <div key={r.ordinal} className={`stat-team-row ${r.won ? 'stat-team-win' : ''}`}>
              <span className="stat-team-name">Team {r.ordinal + 1}</span>
              <span className="stat-team-val">{r.value == null ? '—' : fmtCompact(r.value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="stat-value">—</div>
      )}
      {!anyValue && <div className="stat-sub">no end-game stats in file</div>}
    </div>
  )
}

function TeamRoster({
  team,
  ordinal,
  entries
}: {
  team: AllyTeamMeta
  ordinal: number
  entries: RosterEntry[]
}): JSX.Element {
  const avg = teamAvgOs(team)
  const won = team.won === true
  const lost = team.won === false

  return (
    <div className="roster">
      <div className="roster-head">
        <span className="roster-title">TEAM {ordinal + 1}</span>
        {won && <span className="result-badge result-win">VICTORY</span>}
        {lost && <span className="result-badge result-loss">DEFEAT</span>}
        {avg != null && <span className="roster-avg">avg {avg.toFixed(2)} OS</span>}
      </div>
      {entries.map((entry, i) => (
        <PlayerLine key={i} entry={entry} winning={won} />
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
  const st = player.stats
  return (
    <div className="player-line" style={{ borderLeftColor: color }}>
      <div className="player-top">
        <span className={`faction faction-${factionKey(player)}`}>{factionLetter(player)}</span>
        <span className="player-flag">{flagEmoji(player.countryCode) || '🏳'}</span>
        <span className="player-name">
          {player.name}
          {player.isAi && <span className="ai-tag">AI</span>}
        </span>
        {st && (
          <span className="player-eff" title="damage dealt ÷ damage taken">
            {damageEfficiency(st)} eff
          </span>
        )}
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
        <span className="player-metal">{st ? `${fmtK(st.damageDealt)} dmg` : '—'}</span>
      </div>
    </div>
  )
}

function damageEfficiency(st: NonNullable<PlayerMeta['stats']>): string {
  if (st.damageReceived > 0) return `${Math.round((st.damageDealt / st.damageReceived) * 100)}%`
  return st.damageDealt > 0 ? '∞' : '—'
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
