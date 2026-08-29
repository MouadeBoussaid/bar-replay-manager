import { useEffect, useState } from 'react'
import iconUrl from './assets/icon.png'

/**
 * Frameless-window title bar with Win11-style controls. The bar itself is a drag
 * region (`-webkit-app-region: drag`); interactive children opt back out via the
 * `.no-drag` class in styles.css.
 */
interface Props {
  onOpenSettings: () => void
  view: 'replays' | 'analytics'
  onSetView: (v: 'replays' | 'analytics') => void
}

export function TitleBar({ onOpenSettings, view, onSetView }: Props): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => window.api.onWindowMaximizeChange(setMaximized), [])

  return (
    <header className="titlebar">
      <img className="titlebar-mark" src={iconUrl} alt="" aria-hidden />
      <span className="titlebar-title">BAR Replay Browser</span>
      <nav className="tb-nav no-drag">
        <button
          className={`tb-nav-btn ${view === 'replays' ? 'tb-nav-on' : ''}`}
          onClick={() => onSetView('replays')}
        >
          Replays
        </button>
        <button
          className={`tb-nav-btn ${view === 'analytics' ? 'tb-nav-on' : ''}`}
          onClick={() => onSetView('analytics')}
        >
          Player analytics
        </button>
      </nav>
      <div className="titlebar-spacer" />
      <button
        className="tb-gear no-drag"
        title="Settings"
        aria-label="Settings"
        onClick={onOpenSettings}
      >
        ⚙
      </button>
      <div className="titlebar-controls no-drag">
        <button
          className="tb-btn"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => window.api.windowMinimize()}
        >
          &#x2013;
        </button>
        <button
          className="tb-btn"
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => window.api.windowToggleMaximize()}
        >
          {maximized ? '❐' : '▢'}
        </button>
        <button
          className="tb-btn tb-close"
          title="Close"
          aria-label="Close"
          onClick={() => window.api.windowClose()}
        >
          &#x2715;
        </button>
      </div>
    </header>
  )
}
