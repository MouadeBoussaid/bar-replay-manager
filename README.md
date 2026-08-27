# BAR Replay Manager

A Windows desktop app to browse, favourite, and prune **Beyond All Reason** `.sdfz`
replay files.

## Features

- Point at your replays folder (auto-detects the default BAR install path, or pick one).
- Frameless window with a custom title bar; the two-pane layout has a draggable,
  persisted divider between the replay list and the detail view.
- Virtualised, searchable, sortable list — every row shows the map thumbnail,
  favourite star, date / duration / size, team format (or winner) and average OS.
- **Overview** tab: hero with map title + **Play replay**, a start-position map,
  four match-stat cards and both team rosters with faction / flag / OS / value bar.
- **Details** tab: engine + game version, game id, spectators, the
  Host / SPADS / Game / Map settings, and the favourite note / tags editor.
- Metadata is parsed locally from the file; when **Online** is on it is also
  cross-referenced with `api.bar-rts.com` for ratings, start positions and stats.
  **Spoil** reveals winners and result badges (off by default).
- **Play replay** launches the local BAR client; disabled with a tooltip when the
  replay's engine build is not installed.
- Mark replays as **favourites**, with an optional note and tags.
- **Delete non-favourites** (footer) or <kbd>Del</kbd> on a row — both move files to
  the Windows Recycle Bin after a confirmation dialog stating the exact count / bytes.
- Keyboard: ↑/↓ + Home/End select, <kbd>Enter</kbd> plays, <kbd>Del</kbd> deletes,
  <kbd>F5</kbd> rescans, <kbd>Ctrl</kbd>+<kbd>F</kbd> focuses search.
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
