import type { OpenTab } from '../types'

interface TabBarProps {
  tabs: OpenTab[]
  activeTab: string | null
  onSwitch: (path: string) => void
  onClose: (path: string) => void
}

function basename(path: string): string {
  return path.split('/').pop() || path
}

export function TabBar({ tabs, activeTab, onSwitch, onClose }: TabBarProps) {
  if (tabs.length === 0) return null

  return (
    <div className="tab-bar">
      {tabs.map(tab => {
        const dirty = tab.content !== tab.savedContent
        const active = tab.path === activeTab
        return (
          <div
            key={tab.path}
            className={`tab ${active ? 'tab-active' : ''}`}
            onClick={() => onSwitch(tab.path)}
            title={tab.path}
          >
            <span className="tab-name">{basename(tab.path)}</span>
            {dirty && <span className="tab-dirty" title="Unsaved changes">●</span>}
            <button
              className="tab-close"
              onClick={e => { e.stopPropagation(); onClose(tab.path) }}
              title="Close tab"
            >×</button>
          </div>
        )
      })}

      <style>{`
        .tab-bar {
          display: flex;
          align-items: stretch;
          background-color: var(--bg-secondary);
          border-bottom: 1px solid var(--border-primary);
          overflow-x: auto;
          scrollbar-width: none;
          flex-shrink: 0;
          height: 34px;
        }
        .tab-bar::-webkit-scrollbar { display: none; }

        .tab {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          padding: 0 var(--space-3);
          cursor: pointer;
          border-right: 1px solid var(--border-primary);
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          white-space: nowrap;
          user-select: none;
          transition: background var(--transition-fast), color var(--transition-fast);
          min-width: 0;
          max-width: 180px;
        }
        .tab:hover { background-color: var(--bg-hover); color: var(--text-primary); }
        .tab-active {
          background-color: var(--bg-primary);
          color: var(--text-primary);
          border-top: 2px solid var(--color-primary);
        }

        .tab-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tab-dirty {
          color: var(--color-primary);
          font-size: 10px;
          flex-shrink: 0;
        }

        .tab-close {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 14px;
          line-height: 1;
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          opacity: 0;
          transition: opacity var(--transition-fast), background var(--transition-fast);
        }
        .tab:hover .tab-close { opacity: 1; }
        .tab-close:hover { background-color: var(--color-error-light); color: var(--color-error); }
      `}</style>
    </div>
  )
}
