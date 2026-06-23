import { useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './ui'
import { EmailColumn } from './EmailColumn'
import type { AppState, Column } from '../types'
import type { AppController } from '../AppController'

interface ColumnBoardProps {
  state: AppState
  controller: AppController
}

export function ColumnBoard({ state, controller }: ColumnBoardProps) {
  const { columns, emails, insights, loadingEmails, loadingInsights } = state

  // On mount: fetch emails for all columns and start 60s polling
  useEffect(() => {
    columns.forEach((col) => controller.fetchEmails(col.id))
    controller.startPolling(60000)
    return () => controller.stopPolling()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdateColumn = useCallback(
    async (id: number, updates: Partial<Pick<Column, 'title' | 'query' | 'icon' | 'aiInstructions' | 'aiEnabled'>>) => {
      await controller.updateColumn(id, updates)
    },
    [controller],
  )

  const handleToggleInsights = useCallback(
    async (columnId: number, enabled: boolean) => {
      await controller.updateColumn(columnId, { aiEnabled: enabled })
    },
    [controller],
  )

  const handleGenerateInsights = useCallback(
    (columnId: number) => {
      controller.generateInsights(columnId)
    },
    [controller],
  )

  const handleRefreshAll = () => {
    columns.forEach((col) => {
      controller.fetchEmails(col.id)
    })
  }

  return (
    <div className="column-board-root">
      {/* Top bar */}
      <header className="cb-topbar">
        <div className="cb-topbar-left">
          <span className="cb-logo">📧</span>
          <h1 className="cb-title">Email Manager</h1>
        </div>
        <div className="cb-topbar-right">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshAll}
            title="Refresh all columns"
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </Button>
        </div>
      </header>

      {/* Board */}
      <div className="cb-board">
        {columns.map((col) => (
          <EmailColumn
            key={col.id}
            column={col}
            emails={emails[col.id] ?? []}
            insight={insights[col.id] ?? null}
            loadingEmails={loadingEmails[col.id] ?? false}
            loadingInsights={loadingInsights[col.id] ?? false}
            onUpdateColumn={handleUpdateColumn}
            onToggleInsights={handleToggleInsights}
            onGenerateInsights={handleGenerateInsights}
          />
        ))}
      </div>

      <style>{`
        .column-board-root {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: var(--bg-primary);
          overflow: hidden;
        }

        .cb-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-3) var(--space-5);
          border-bottom: 1px solid var(--border-primary);
          background: var(--bg-secondary);
          flex-shrink: 0;
        }

        .cb-topbar-left {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .cb-logo {
          font-size: 20px;
        }

        .cb-title {
          font-size: var(--font-size-lg);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }

        .cb-topbar-right {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .cb-topbar-right button {
          display: flex;
          align-items: center;
          gap: var(--space-1);
        }

        .cb-board {
          display: flex;
          gap: var(--space-4);
          padding: var(--space-4);
          overflow-x: auto;
          overflow-y: hidden;
          flex: 1;
          align-items: stretch;
        }

        /* Mobile: stack columns vertically */
        @media (max-width: 767px) {
          .cb-board {
            flex-direction: column;
            overflow-x: hidden;
            overflow-y: auto;
            align-items: stretch;
          }

          .email-column {
            width: 100% !important;
            min-width: unset !important;
            max-width: unset !important;
            height: auto !important;
            max-height: 50vh;
          }
        }

        /* Tablet: allow horizontal scroll with narrower columns */
        @media (min-width: 768px) and (max-width: 1200px) {
          .cb-board {
            padding: var(--space-3);
            gap: var(--space-3);
          }
        }
      `}</style>
    </div>
  )
}
