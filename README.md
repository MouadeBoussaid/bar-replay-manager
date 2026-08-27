# BAR Replay Manager

A Windows desktop app to browse, favourite, and prune **Beyond All Reason** `.sdfz`
replay files.

## Features

- Point at your replays folder (auto-detects the default BAR install path, or pick one).
- Searchable / sortable / filterable list of every replay.
- Click a replay for full metadata — map, duration, date, engine + game version,
  per-team rosters with faction / country / OpenSkill rating, spectators, and the
  Host / SPADS / Game / Map settings.
- Metadata is parsed locally from the file; when **Online enrich** is on it is also
  cross-referenced with `api.bar-rts.com` for ratings and win/loss.
- Mark replays as **favourites**, with an optional note and tags.
- **Clear non-favourites** — moves every non-favourited replay to the Windows Recycle
  Bin (recoverable) after a confirmation dialog.
- The list auto-refreshes when a new replay appears after a game.

## Development

```bash
npm install
npm run dev        # launch with hot reload
npm run typecheck  # tsc for main + renderer
npm run build      # production bundle into out/
npm run dist       # build + package a Windows NSIS installer into dist/
```

Requires Node 20+ (Node 22 LTS recommended).

## Project layout

| Path | Role |
|---|---|
| `src/main/` | Electron main process — filesystem, parsing, store, watcher, bar-rts.com client |
| `src/main/demo-header.ts` | In-house `.sdfz` reader (gzip + demo header + start script) |
| `src/main/tdf.ts` | Start-script (TDF) parser |
| `src/preload/` | `contextBridge` → `window.api` |
| `src/renderer/` | React UI |
| `src/shared/types.ts` | IPC contract + data models |

Local data (settings, favourites, parsed-metadata cache) lives in
`%APPDATA%/bar-replay-manager/store.json`.
