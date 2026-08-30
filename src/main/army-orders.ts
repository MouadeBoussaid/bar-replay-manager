import { readDemoStream } from './demo-stream'
import { loadUnitDefs } from './unit-defs'

/**
 * Option C — offensive share of build investment, per team, one value per
 * `sampleTimes` entry (0..1):
 *
 *   share(t) = Σ metalCost[offensive builds ≤ t] ÷ Σ metalCost[all builds ≤ t]
 *
 * comparison.ts multiplies this into `onField` to narrow the estimate from
 * "value of everything on the field" toward "value of the army on the field".
 * Using the *cumulative* ratio keeps it slowly varying and largely cancels the
 * stream's over-counting (area orders, cancels and factory-repeat inflate both
 * sums together).
 *
 * Returns `null` — callers treat that as "no offensive filtering" — when:
 *   - no unit-def table is bundled for the replay's version (none are yet; see
 *     src/main/data/README.md), or
 *   - the demo has no readable command stream.
 */
export function offensiveMetalShare(
  filePath: string,
  teamIds: number[],
  sampleTimes: number[]
): Map<number, number[]> | null {
  if (teamIds.length === 0 || sampleTimes.length === 0) return null

  const stream = readDemoStream(filePath)
  if (!stream) return null
  const defs = loadUnitDefs(stream.gameVersion)
  if (!defs) return null

  const want = new Set(teamIds)
  const offBin = new Map<number, number[]>()
  const totBin = new Map<number, number[]>()
  for (const id of teamIds) {
    offBin.set(id, new Array<number>(sampleTimes.length).fill(0))
    totBin.set(id, new Array<number>(sampleTimes.length).fill(0))
  }

  for (const order of stream.orders) {
    if (order.teamId == null || !want.has(order.teamId)) continue
    const def = defs.get(order.unitDefId)
    if (!def || def.metalCost <= 0) continue
    const bin = sampleIndex(sampleTimes, order.t)
    totBin.get(order.teamId)![bin] += def.metalCost
    if (def.offensive) offBin.get(order.teamId)![bin] += def.metalCost
  }

  const out = new Map<number, number[]>()
  let anyData = false
  for (const id of teamIds) {
    const off = offBin.get(id)!
    const tot = totBin.get(id)!
    const share = new Array<number>(sampleTimes.length)
    let cumOff = 0
    let cumTot = 0
    let last = 0
    for (let i = 0; i < sampleTimes.length; i++) {
      cumOff += off[i]!
      cumTot += tot[i]!
      if (cumTot > 0) {
        last = cumOff / cumTot
        anyData = true
      }
      share[i] = last
    }
    out.set(id, share)
  }
  return anyData ? out : null
}

/** Index of the first sample at or after `t`, clamped to the last sample. */
function sampleIndex(times: number[], t: number): number {
  for (let i = 0; i < times.length; i++) if (times[i]! >= t) return i
  return times.length - 1
}
