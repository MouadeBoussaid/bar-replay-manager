import type { PlayerMeta, PlayerStats, ReplayMeta } from '../../shared/types'
import { fmtCompact } from './format'
import { buildRosters, teamColorNames, teamLabel } from './players'

interface Props {
  meta: ReplayMeta
}

const COLS: { key: keyof PlayerStats | 'efficiency'; label: string; kind: 'k' | 'int' | 'pct' }[] =
  [
    { key: 'metalProduced', label: 'Metal', kind: 'k' },
    { key: 'metalExcess', label: 'M-excess', kind: 'k' },
    { key: 'energyProduced', label: 'Energy', kind: 'k' },
    { key: 'energyExcess', label: 'E-excess', kind: 'k' },
    { key: 'damageDealt', label: 'Dmg dealt', kind: 'k' },
    { key: 'damageReceived', label: 'Dmg taken', kind: 'k' },
    { key: 'efficiency', label: 'Eff', kind: 'pct' },
    { key: 'unitsProduced', label: 'Made', kind: 'int' },
    { key: 'unitsKilled', label: 'Killed', kind: 'int' },
    { key: 'unitsLost', label: 'Lost', kind: 'int' },
    { key: 'cmdPerMin', label: 'CMD/min', kind: 'int' }
  ]

export function StatsTab({ meta }: Props): JSX.Element {
  const rosters = buildRosters(meta)
  const colors = teamColorNames(meta)
  const hasAny = meta.allyTeams.some((t) => t.players.some((p) => p.stats))

  if (!hasAny) {
    return (
      <div className="stats-tab">
        <p className="stats-empty">
          This replay has no end-game statistics — the game crashed or ended before the
          first stats snapshot (they are written every 15&nbsp;seconds).
        </p>
      </div>
    )
  }

  return (
    <div className="stats-tab">
      <div className="stats-scroll">
        <table className="stats-table">
          <thead>
            <tr>
              <th className="stats-name-col">Player</th>
              {COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          {meta.allyTeams.map((team, ti) => {
            const entries = rosters[ti] ?? []
            const totals = sumStats(team.players)
            return (
              <tbody key={team.id}>
                <tr className={`stats-team-row team-${colors[ti] ?? 'none'}`}>
                  <th colSpan={COLS.length + 1}>
                    {teamLabel(ti, colors[ti] ?? null).toUpperCase()}
                    {team.won === true && <span className="result-badge result-win">VICTORY</span>}
                    {team.won === false && (
                      <span className="result-badge result-loss">DEFEAT</span>
                    )}
                  </th>
                </tr>
                {entries.map((e, i) => (
                  <tr key={i} className={i % 2 ? 'stats-row-alt' : ''}>
                    <td className="stats-name-col">
                      <span className="stats-swatch" style={{ background: e.color }} />
                      {e.player.name}
                      {e.player.isAi && <span className="ai-tag">AI</span>}
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key}>{cell(e.player.stats, c)}</td>
                    ))}
                  </tr>
                ))}
                <tr className="stats-total-row">
                  <td className="stats-name-col">Team total</td>
                  {COLS.map((c) => (
                    <td key={c.key}>{totalCell(totals, c)}</td>
                  ))}
                </tr>
              </tbody>
            )
          })}
        </table>
      </div>
      <p className="stats-note">
        Per-team totals from the demo file. “CMD/min” is engine command count over game
        time — close to APM, not identical to BAR’s in-game figure.
      </p>
    </div>
  )
}

type Totals = ReturnType<typeof sumStats>

function sumStats(players: PlayerMeta[]): PlayerStats & { rated: number } {
  const acc: PlayerStats & { rated: number } = {
    metalProduced: 0,
    metalExcess: 0,
    energyProduced: 0,
    energyExcess: 0,
    damageDealt: 0,
    damageReceived: 0,
    unitsProduced: 0,
    unitsKilled: 0,
    unitsLost: 0,
    cmdPerMin: 0,
    rated: 0
  }
  for (const p of players) {
    if (!p.stats) continue
    acc.rated++
    acc.metalProduced += p.stats.metalProduced
    acc.metalExcess += p.stats.metalExcess
    acc.energyProduced += p.stats.energyProduced
    acc.energyExcess += p.stats.energyExcess
    acc.damageDealt += p.stats.damageDealt
    acc.damageReceived += p.stats.damageReceived
    acc.unitsProduced += p.stats.unitsProduced
    acc.unitsKilled += p.stats.unitsKilled
    acc.unitsLost += p.stats.unitsLost
    acc.cmdPerMin = (acc.cmdPerMin ?? 0) + (p.stats.cmdPerMin ?? 0)
  }
  return acc
}

function cell(
  s: PlayerStats | undefined,
  c: (typeof COLS)[number]
): string {
  if (!s) return '—'
  if (c.key === 'efficiency') return efficiency(s.damageDealt, s.damageReceived)
  const v = s[c.key]
  if (v == null) return '—'
  return c.kind === 'k' ? fmtCompact(v) : v.toLocaleString()
}

function totalCell(t: Totals, c: (typeof COLS)[number]): string {
  if (c.key === 'efficiency') return efficiency(t.damageDealt, t.damageReceived)
  if (c.key === 'cmdPerMin') return t.rated > 0 ? Math.round((t.cmdPerMin ?? 0)).toLocaleString() : '—'
  const v = t[c.key as keyof PlayerStats] as number
  return c.kind === 'k' ? fmtCompact(v) : v.toLocaleString()
}

function efficiency(dealt: number, received: number): string {
  if (received <= 0) return dealt > 0 ? '∞' : '—'
  return `${Math.round((dealt / received) * 100)}%`
}
