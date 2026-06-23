import { useState, useEffect } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { AppState } from '../types'
import { GmailGate } from './GmailGate'
import { ColumnBoard } from './ColumnBoard'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [state, setState] = useState<AppState>(controller.getState())

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState)
    return unsubscribe
  }, [controller])

  useAgentAware('MainView', {
    currentSection: state.gmailConnected ? 'board' : 'gate',
    columnCount: state.columns.length,
    gmailConnected: state.gmailConnected,
  })

  if (!state.initialized || state.loading) {
    return (
      <div className="mv-loading">
        <span className="mv-spinner" aria-label="Loading" />
        <span>Loading Email Manager…</span>
        <style>{`
          .mv-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-3);
            color: var(--text-muted);
            font-size: var(--font-size-sm);
            background: var(--bg-primary);
          }
          .mv-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid var(--border-primary);
            border-top-color: var(--color-accent);
            border-radius: var(--radius-full);
            animation: spin 0.8s linear infinite;
            display: inline-block;
          }
        `}</style>
      </div>
    )
  }

  if (!state.gmailConnected) {
    return <GmailGate />
  }

  return <ColumnBoard state={state} controller={controller} />
}
