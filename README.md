# BAR Replay Manager

A Windows desktop app to browse, favourite, and prune **Beyond All Reason** `.sdfz`
replay files.

## Features

- Point at your replays folder (auto-detects the default BAR install path, or pick one).
- Frameless window with a custom title bar; the two-pane layout has a draggable,
  persisted divider between the replay list and the detail view.
- Virtualised, searchable, sortable list — every row shows the favourite star,
  date / duration / size, winner (Team Blue / Red) and an OS-bracket tag.
- **Overview** tab: hero with real minimap + **Play replay**, a start-position
  map, per-team Metal / Energy / Damage cards, both rosters (faction / flag / OS /
  damage bar), and the favourite note editor when favourited.
- **Stats** tab: the full per-player end-game table (metal/energy produced &
  excess, damage, units made/killed/lost, ≈APM) with team totals.
- **Graphs** tab: per-player time-series of any economy / unit / combat stat,
  total or per-interval, linear or log, with a hover readout.
- **Details** tab: engine + game version, game id, spectators, and the
  Host / SPADS / Game / Map settings.
- Everything is parsed locally from the file — including the demo's per-team
  statistics trailer. **Online lookup** additionally cross-references
  `api.bar-rts.com` for verified ratings, colours, flags and start positions.
- Minimap textures and map metadata come from the bar-rts map API, cached under
  `%APPDATA%/bar-replay-manager/map-cache`.
- **Play replay** launches the local BAR client (or the `.sdfz` file association).
- Mark replays as **favourites**, with an optional note and tags.
- **Delete non-favourites** (footer) or <kbd>Del</kbd> on a row — both move files to
  the Windows Recycle Bin after a confirmation dialog stating the exact count / bytes.
- Keyboard: ↑/↓ + Home/End select, <kbd>Enter</kbd> plays, <kbd>Del</kbd> deletes,
  <kbd>F5</kbd> rescans, <kbd>Ctrl</kbd>+<kbd>F</kbd> focuses search.
- App icons are generated from a source PNG with `npm run icons`.
- The list auto-refreshes when a new replay appears after a game.
- Fonts (Barlow, Saira Condensed, JetBrains Mono) are bundled locally via
  `@fontsource` — the app never fetches fonts at runtime.

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
| `src/main/replay-scanner.ts` | Folder scan — parses each file on scan so list rows are rich |
| `src/main/launch.ts` | Locate the BAR client + installed engines; spawn a replay |
| `src/preload/` | `contextBridge` → `window.api` |
| `src/renderer/src/` | React UI — `TitleBar`, `ReplayList`, `DetailPane` → `OverviewTab` / `DetailsTab` |
| `src/renderer/src/players.ts` | Per-player colour, team avg OS, roster + start-pip math |
| `src/shared/types.ts` | IPC contract + data models |

The visual layer follows `design_handoff_bar_replay_browser` (approved option 1b);
tokens live at the top of `src/renderer/src/styles.css`.

Local data (settings, favourites, parsed-metadata cache) lives in
`%APPDATA%/bar-replay-manager/store.json`.
