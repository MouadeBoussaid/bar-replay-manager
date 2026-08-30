/**
 * Option C — offensive share of build investment from the demo command stream.
 *
 * The trailer only gives per-team aggregates, so `onField` in comparison.ts counts
 * every unit type. This module is meant to narrow that to combat units by reading
 * the demo's command packets:
 *
 *   1. Walk the demo stream (between the start script and the trailer). Each chunk
 *      is `float modGameTime | uint32 length | <packet>`; packet[0] is the msg id.
 *   2. Track the sim frame: +1 per NETMSG_NEWFRAME, absolute on NETMSG_KEYFRAME.
 *      Time = frame / 30.
 *   3. On a build command (NETMSG_COMMAND / NETMSG_AICOMMAND with `cmdID < 0`,
 *      where `unitDefID = -cmdID`), attribute `metalCost[unitDefID]` to the
 *      issuing player's team, split into offensive vs. total buckets, bucketed to
 *      the 15-s sample grid. NETMSG_COMMAND applies to the sender's current
 *      selection, so selection (NETMSG_SELECT) has to be tracked too.
 *   4. Return, per team, `offensiveMetalOrdered[i] / totalMetalOrdered[i]` — a
 *      slowly-varying ratio robust to the stream's over-counting (area orders,
 *      cancels and factory-repeat inflate numerator and denominator together).
 *
 * Two things are still needed before this can run and are the reason it returns
 * `null` today:
 *
 *   A. A `unitDefID → { metalCost, offensive }` table per BAR version. `cmdID`
 *      carries the *numeric* def id the engine assigned from archive load order;
 *      it is not in the demo and bar-rts.com does not publish it. Options: parse
 *      the BAR game archive on disk in load order, or vendor a generated table
 *      (see scripts/) keyed by `gameVersion`.
 *   B. Confirmation of the NETMSG_* ids and byte layouts for the engine builds in
 *      the wild, validated against real replays.
 *
 * Until then comparison.ts reports `source: 'trailer-estimate'`.
 */

/** `unitDefID → { metalCost, offensive }`, per BAR version. Empty until generated (see the file header). */
const UNIT_DEFS_BY_VERSION: Record<string, Record<number, { metalCost: number; offensive: boolean }>> =
  {}

/**
 * Per-team offensive share of build spend, one value per entry in `sampleTimes`
 * (0..1). Returns `null` when the data needed isn't available yet — callers must
 * treat that as "no offensive filtering".
 */
export function offensiveMetalShare(
  _filePath: string,
  _teamIds: number[],
  _sampleTimes: number[]
): Map<number, number[]> | null {
  // Blocked on the unit-def id table (A) and packet-layout validation (B) above.
  if (Object.keys(UNIT_DEFS_BY_VERSION).length === 0) return null
  return null
}
