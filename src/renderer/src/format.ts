export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—'
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let val = bytes / 1024
  let i = 0
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val.toFixed(1)} ${units[i]}`
}

/** Compact "duration" for list rows / hero — always mm:ss or h:mm:ss. */
export function fmtClock(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** "scanned 2m ago" style relative time. */
export function fmtRelative(ts: number | null | undefined): string {
  if (!ts) return 'not yet'
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/** "Wed 26 Aug 2026 · 22:56" for the detail hero. */
export function fmtHeroDateTime(iso: string | null | undefined): string {
  if (!iso) return 'date unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} · ${time}`
}

/** Footer total: "415 files · 1.9 GB". */
export function fmtGigabytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  return `${mb.toFixed(0)} MB`
}

/** "7.2k" from a raw metal figure. */
export function fmtK(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n)}`
}

/** Compact large number: "1.5M", "708k", "5.4k", "420". */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e5) return `${Math.round(n / 1e3)}k`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return `${Math.round(n)}`
}

/** Team format like "8v8" / "3v3v3" from ally-team sizes. */
export function fmtTeamFormat(sizes: number[]): string {
  if (sizes.length === 0) return '—'
  return sizes.join('v')
}

/** ISO 3166-1 alpha-2 country code -> flag emoji. */
export function flagEmoji(code: string | undefined): string {
  if (!code || code.length !== 2 || !/^[a-z]{2}$/i.test(code)) return ''
  const base = 0x1f1e6
  const cc = code.toUpperCase()
  return String.fromCodePoint(
    base + (cc.charCodeAt(0) - 65),
    base + (cc.charCodeAt(1) - 65)
  )
}
