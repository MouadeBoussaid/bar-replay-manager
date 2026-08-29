import type { BackfillProgress, ReplayMeta } from '../shared/types'
import { setAnalyticsIndex } from './analytics'
import { fetchServerReplay } from './bar-api'
import { store } from './store'

/**
 * Slow background pass that fills the bar-rts.com response cache for every
 * indexed game, then rebuilds the analytics index so the confirmed in-game
 * faction / start positions / roles fill in over time. Deliberately gentle on
 * the public API — one request every few seconds — so a first run of a large
 * folder takes ~an hour. Safe to call after every scan; it only fetches games
 * with no cached record yet.
 */

/** Seconds between requests — keep this well above 1s to be a good API citizen. */
const REQUEST_INTERVAL_MS = 5000
/**
 * Rebuild the analytics index — and flush the store to disk — after this many
 * new fetches (and once at the end). Auto-writes are paused during the pass so
 * we don't rewrite the whole multi-MB db once per fetched record.
 */
const REINDEX_EVERY = 10
/** Give up this pass after this many consecutive network failures (API down). */
const MAX_CONSECUTIVE_FAILURES = 5

let running = false
let queued: ReplayMeta[] | null = null
let indexRev = 0
let notify: ((p: BackfillProgress) => void) | null = null

export function setBackfillNotifier(fn: (p: BackfillProgress) => void): void {
  notify = fn
}

/** (Re-)arm the backfill with the latest metadata. No-op without online lookup. */
export function scheduleServerBackfill(metas: ReplayMeta[]): void {
  if (!store.getSettings().onlineEnrich) return
  queued = metas
  if (!running) void run()
}

async function run(): Promise<void> {
  running = true
  try {
    while (queued) {
      const metas = queued
      queued = null
      await pass(metas)
    }
  } finally {
    running = false
  }
}

async function pass(metas: ReplayMeta[]): Promise<void> {
  const withId = metas.filter((m) => m.gameId)
  const total = withId.length
  const missing = withId.filter((m) => !store.getApiCache(m.gameId!))
  let done = total - missing.length
  let fetched = 0

  if (missing.length === 0) {
    emit({ active: false, done, total, fetched, indexRev })
    return
  }
  emit({ active: true, done, total, fetched, indexRev })

  store.pauseWrites()
  try {
    let consecutiveFailures = 0
    for (const m of missing) {
      if (queued) return // a newer scan arrived — run() will restart with it
      if (!store.getSettings().onlineEnrich) {
        emit({ active: false, done, total, fetched, indexRev })
        return
      }

      try {
        await fetchServerReplay(m.gameId!) // self-caches the record or a 404 sentinel
        consecutiveFailures = 0
      } catch {
        if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          emit({ active: false, done, total, fetched, indexRev })
          return // try the rest on the next scan
        }
      }

      done++
      fetched++
      if (fetched % REINDEX_EVERY === 0) {
        setAnalyticsIndex(metas)
        store.flush()
        indexRev++
      }
      emit({ active: true, done, total, fetched, indexRev })

      await sleep(REQUEST_INTERVAL_MS)
    }

    if (queued) return
    setAnalyticsIndex(metas)
    indexRev++
    emit({ active: false, done, total, fetched, indexRev })
  } finally {
    store.resumeWrites() // flushes anything still pending
  }
}

function emit(p: BackfillProgress): void {
  notify?.(p)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
