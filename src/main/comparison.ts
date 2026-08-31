import type { ComparisonRequest, ComparisonSeries, ReplayGraph } from '../shared/types'
import { loadDemoBuffer } from './demo-header'
import { buildReplayGraph } from './replay-graph'
import { offensiveMetalShare } from './army-orders'

/**
 * Energy is ~20× metal in BAR, so weighting energy at 1/20 would make it and metal
 * contribute about equally. We deliberately go much lighter (1/100): a good player
 * runs energy efficiently, so metal (mex) is the real economic differentiator. This
 * puts the summed figure at roughly 83% metal / 17% energy.
 */
const ENERGY_WEIGHT = 1 / 100

/**
 * Build the two-player series for the comparison drawer from the per-team demo
 * trailer. Everything here is exact except `onField`, which is an estimate:
 *
 *   spent(t)   = cumulative metal spent on everything (engine-reported)
 *   onField(t) = spent(t) × survivingShare(t) × offensiveShare(t)
 *
 * `survivingShare` = units still alive ÷ units ever produced (a count ratio, from
 * the trailer). `offensiveShare` = the fraction of build investment that went to
 * combat units, from demo build-order parsing (army-orders.ts); it is 1 whenever
 * no unit-def table is bundled for the replay's version, which makes `onField` an
 * all-unit-types figure. `source` records which case applied.
 */
export function buildComparison(req: ComparisonRequest): ComparisonSeries | null {
  // One read + decompress of the demo feeds both the trailer and the stream parse.
  let buf: Buffer
  try {
    buf = loadDemoBuffer(req.filePath)
  } catch {
    return null
  }

  const graph = buildReplayGraph(req.filePath, buf)
  if (!graph || graph.times.length < 2) return null

  const idxOf = (name: string): number =>
    graph.teams.findIndex((t) => t.name.toLowerCase() === name.trim().toLowerCase())
  const ia = idxOf(req.players[0])
  const ib = idxOf(req.players[1])
  if (ia < 0 || ib < 0) return null

  // Offensive share of build spend, per sample, per team. null → not available.
  const offByTeam = offensiveMetalShare(
    req.filePath,
    [graph.teams[ia]!.teamId, graph.teams[ib]!.teamId],
    graph.times,
    buf
  )
  const offA = offByTeam?.get(graph.teams[ia]!.teamId) ?? null
  const offB = offByTeam?.get(graph.teams[ib]!.teamId) ?? null
  const streamBacked = offA != null && offB != null

  const a = teamSeries(graph, ia, offA)
  const b = teamSeries(graph, ib, offB)

  return {
    times: graph.times,
    periodSeconds: graph.periodSeconds,
    economy: [a.economy, b.economy],
    spent: [a.spent, b.spent],
    onField: [a.onField, b.onField],
    excess: [a.excess, b.excess],
    source: streamBacked ? 'stream-estimate' : 'trailer-estimate',
    caveat: streamBacked
      ? '“on field” = offensive metal spent × surviving-unit share — an estimate from build orders'
      : '“on field” = metal spent × surviving-unit share (all unit types) — an estimate'
  }
}

interface TeamSeries {
  economy: number[]
  spent: number[]
  onField: number[]
  excess: number[]
}

function teamSeries(graph: ReplayGraph, ti: number, off: number[] | null): TeamSeries {
  const f = graph.fields
  const at = (key: string): number[] => f[key]?.[ti] ?? []
  const met = at('metalProduced')
  const en = at('energyProduced')
  const used = at('metalUsed')
  const exc = at('metalExcess')
  const made = at('unitsProduced')
  const died = at('unitsDied')
  const recv = at('unitsReceived')
  const sent = at('unitsSent')
  const capt = at('unitsCaptured')
  const lost = at('unitsOutCaptured')

  const economy: number[] = []
  const spent: number[] = []
  const onField: number[] = []
  const excess: number[] = []
  for (let i = 0; i < graph.times.length; i++) {
    economy.push((met[i] ?? 0) + (en[i] ?? 0) * ENERGY_WEIGHT)
    excess.push(exc[i] ?? 0)

    const share = off ? clamp01(off[i] ?? 1) : 1
    const invested = (used[i] ?? 0) * share
    spent.push(invested)

    const produced = made[i] ?? 0
    const alive =
      produced -
      (died[i] ?? 0) +
      (recv[i] ?? 0) -
      (sent[i] ?? 0) +
      (capt[i] ?? 0) -
      (lost[i] ?? 0)
    const surviving = produced > 0 ? clamp01(alive / produced) : 0
    onField.push(invested * surviving)
  }
  return { economy, spent, onField, excess }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}
