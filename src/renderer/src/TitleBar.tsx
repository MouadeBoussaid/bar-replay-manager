import { useEffect, useState } from 'react'

/**
 * Frameless-window title bar with Win11-style controls. The bar itself is a drag
 * region (`-webkit-app-region: drag`); interactive children opt back out via the
 * `.no-drag` class in styles.css.
 */
export function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => window.api.onWindowMaximizeChange(setMaximized), [])

  return (
    <header className="titlebar">
      <span className="titlebar-mark" aria-hidden />
      <span className="titlebar-title">BAR Replay Browser</span>
      <div className="titlebar-spacer" />
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
