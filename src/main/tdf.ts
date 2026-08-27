/**
 * Minimal parser for Spring/Recoil "TDF" start scripts:
 *
 *   [GAME]
 *   {
 *     Mapname=Foo;
 *     [PLAYER0] { name=bob; team=0; }
 *     [ALLYTEAM0] { numallies=0; }
 *   }
 *
 * Produces a nested tree. Section names are lower-cased; keys are lower-cased,
 * values are kept verbatim (trimmed).
 */

export interface TdfSection {
  keys: Record<string, string>
  sections: Record<string, TdfSection>
}

export function parseTdf(text: string): TdfSection {
  // Strip /* block */ and // line comments.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n\r]*/g, '')

  const root: TdfSection = { keys: {}, sections: {} }
  const stack: TdfSection[] = [root]
  let pendingName: string | null = null
  let i = 0
  const n = clean.length

  const top = (): TdfSection => stack[stack.length - 1]!

  while (i < n) {
    const ch = clean[i]!

    if (ch === '[') {
      const end = clean.indexOf(']', i)
      if (end === -1) break
      pendingName = clean.slice(i + 1, end).trim().toLowerCase()
      i = end + 1
      continue
    }

    if (ch === '{') {
      const parent = top()
      const child: TdfSection = { keys: {}, sections: {} }
      const name = pendingName ?? `anon${Object.keys(parent.sections).length}`
      parent.sections[name] = child
      stack.push(child)
      pendingName = null
      i++
      continue
    }

    if (ch === '}') {
      if (stack.length > 1) stack.pop()
      i++
      continue
    }

    if (ch === ';' || ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') {
      i++
      continue
    }

    // Otherwise: read a `key=value` statement up to ; } or newline.
    let end = i
    while (
      end < n &&
      clean[end] !== ';' &&
      clean[end] !== '}' &&
      clean[end] !== '{' &&
      clean[end] !== '\n' &&
      clean[end] !== '\r'
    ) {
      end++
    }
    const stmt = clean.slice(i, end).trim()
    i = end
    if (stmt) {
      const eq = stmt.indexOf('=')
      if (eq !== -1) {
        const key = stmt.slice(0, eq).trim().toLowerCase()
        const value = stmt.slice(eq + 1).trim()
        if (key) top().keys[key] = value
      }
    }
  }

  return root
}

export function findSection(sec: TdfSection, name: string): TdfSection | undefined {
  return sec.sections[name.toLowerCase()]
}

/** Collect `player0`, `player1`, ... style child sections into an index map. */
export function collectIndexed(sec: TdfSection, prefix: string): Record<number, TdfSection> {
  const out: Record<number, TdfSection> = {}
  const re = new RegExp(`^${prefix}(\\d+)$`)
  for (const [k, v] of Object.entries(sec.sections)) {
    const m = re.exec(k)
    if (m) out[Number(m[1])] = v
  }
  return out
}
