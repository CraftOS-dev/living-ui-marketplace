import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, Pencil } from 'lucide-react'
import { toast } from 'react-toastify'
import { Alert, Button } from './ui'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { AppState } from '../types'
import { SessionList } from './SessionList'
import { SessionInput } from './SessionInput'
import { MergeView } from './MergeView'
import { CompiledResult } from './CompiledResult'
import { RenameModal } from './RenameModal'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [state, setState] = useState<AppState>(controller.getState())
  const [renameTarget, setRenameTarget] = useState<{ id: number; title: string } | null>(null)
  const [resultWidth, setResultWidth] = useState(480)
  const [resultHeight, setResultHeight] = useState(320)
  const [resizing, setResizing] = useState(false)
  const [stacked, setStacked] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= 1024 : false
  )
  const dragRef = useRef<{
    startCoord: number
    startSize: number
    orientation: 'row' | 'col'
  } | null>(null)

  useEffect(() => {
    const update = () => setStacked(window.innerWidth <= 1024)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    const unsub = controller.subscribe(setState)
    return unsub
  }, [controller])

  useAgentAware('MainView', {
    section: 'main',
    activeSessionId: state.active?.id ?? null,
    sessionsCount: state.sessions.length,
    llmAvailable: state.llmAvailable,
    generating: state.generating,
    compiling: state.compiling,
  })

  const active = state.active
  const busy = state.loading || state.generating
  const hasVariants = !!active && active.segments.length > 0

  const handleDelete = async () => {
    if (!active) return
    if (!confirm('Delete this session? This cannot be undone.')) return
    await controller.deleteSession(active.id)
    toast.info('Session deleted')
  }

  const openRename = () => {
    if (!active) return
    setRenameTarget({ id: active.id, title: active.title })
  }

  const submitRename = async (title: string) => {
    if (!renameTarget) return
    await controller.renameSession(renameTarget.id, title)
    toast.success('Session renamed')
  }

  // Drag-to-resize the compiled-result pane. In side-by-side mode the divider
  // is vertical and resizing moves it left/right (changes width). In the
  // stacked layout below 1024 px the divider is horizontal and resizing moves
  // it up/down (changes height).
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const orientation: 'row' | 'col' = stacked ? 'row' : 'col'
    dragRef.current = {
      startCoord: orientation === 'row' ? e.clientY : e.clientX,
      startSize: orientation === 'row' ? resultHeight : resultWidth,
      orientation,
    }
    setResizing(true)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }, [stacked, resultHeight, resultWidth])

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const current = drag.orientation === 'row' ? e.clientY : e.clientX
    // Result pane sits to the right (row) or below (col); dragging *toward*
    // the merge pane (smaller coord) increases the result pane size.
    const delta = drag.startCoord - current
    const next = drag.startSize + delta
    if (drag.orientation === 'row') {
      setResultHeight(
        Math.min(
          Math.max(next, 160),
          Math.max(window.innerHeight * 0.8, 240)
        )
      )
    } else {
      setResultWidth(
        Math.min(
          Math.max(next, 280),
          Math.max(window.innerWidth * 0.75, 360)
        )
      )
    }
  }, [])

  const handleResizeEnd = useCallback(() => {
    dragRef.current = null
    setResizing(false)
  }, [])

  return (
    <div className="layout">
      <SessionList
        controller={controller}
        sessions={state.sessions}
        activeId={active?.id ?? null}
        llmAvailable={state.llmAvailable}
        onRequestRename={(id, title) => setRenameTarget({ id, title })}
      />

      <main className="main">
        {!active ? (
          <div className="main__empty">
            <SessionInput controller={controller} busy={busy} />
          </div>
        ) : (
          <>
            <header className="main__head">
              <div className="main__title-block">
                <h1 className="main__title">{active.title}</h1>
                <p className="main__meta">
                  <span className="meta-tag">{active.mode.replace('_', ' ')}</span>
                  {active.tone && <span className="meta-tag">{active.tone}</span>}
                  <span className="meta-tag">{active.variantCount} variants</span>
                </p>
              </div>
              <div className="main__actions">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil size={12} aria-hidden="true" />}
                  onClick={openRename}
                >
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={12} aria-hidden="true" />}
                  onClick={handleDelete}
                >
                  Delete
                </Button>
              </div>
            </header>

            {state.error && (
              <Alert variant="error" title="Something went wrong">
                {state.error}
              </Alert>
            )}

            <div className="main__pane">
              <div className="main__merge">
                {hasVariants ? (
                  state.generating || state.regenerating ? (
                    <div className="main__loading">
                      <div className="spinner" />
                      <p>Generating variants…</p>
                    </div>
                  ) : (
                    <MergeView
                      controller={controller}
                      session={active}
                      regenerating={state.regenerating}
                    />
                  )
                ) : state.generating ? (
                  <div className="main__loading">
                    <div className="spinner" />
                    <p>Generating variants…</p>
                  </div>
                ) : (
                  <div className="main__draft">
                    <p>This session has no variants yet.</p>
                    <Button variant="primary" onClick={() => controller.regenerate()}>
                      Generate variants
                    </Button>
                  </div>
                )}
              </div>

              {hasVariants && (
                <>
                  <div
                    role="separator"
                    aria-orientation={stacked ? 'horizontal' : 'vertical'}
                    aria-label="Resize compiled result panel"
                    className={[
                      'main__divider',
                      stacked ? 'main__divider--row' : 'main__divider--col',
                      resizing ? 'main__divider--dragging' : '',
                    ].filter(Boolean).join(' ')}
                    onPointerDown={handleResizeStart}
                    onPointerMove={handleResizeMove}
                    onPointerUp={handleResizeEnd}
                    onPointerCancel={handleResizeEnd}
                  />
                  <div
                    className="main__result"
                    style={
                      stacked
                        ? { height: `${resultHeight}px` }
                        : { width: `${resultWidth}px` }
                    }
                  >
                    <CompiledResult compile={state.lastCompile} />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </main>

      <RenameModal
        open={renameTarget !== null}
        currentTitle={renameTarget?.title || ''}
        onClose={() => setRenameTarget(null)}
        onSubmit={submitRename}
      />

      <style>{`
        .layout {
          display: grid;
          grid-template-columns: 220px 1fr;
          height: 100vh;
          width: 100%;
          overflow: hidden;
        }
        @media (max-width: 768px) {
          .layout { grid-template-columns: 180px 1fr; }
        }
        .main {
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          height: 100%;
          background-color: var(--bg-primary);
          overflow: hidden;
        }
        .main__empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-6);
          overflow-y: auto;
        }
        .main__head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          border-bottom: 1px solid var(--border-primary);
          background-color: var(--bg-primary);
        }
        .main__title-block { min-width: 0; flex: 1; }
        .main__title {
          font-size: var(--font-size-base);
          font-weight: var(--font-weight-semibold);
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .main__meta {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-wrap: wrap;
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
        }
        .meta-tag {
          padding: 1px var(--space-2);
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-full);
          text-transform: lowercase;
        }
        .main__actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .main__pane {
          display: flex;
          flex-direction: row;
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }
        .main__merge {
          display: flex;
          flex-direction: column;
          padding: var(--space-2) var(--space-3);
          min-height: 0;
          min-width: 0;
          overflow: hidden;
          flex: 1;
        }
        .main__divider {
          flex-shrink: 0;
          background-color: var(--border-primary);
          position: relative;
          touch-action: none;
          z-index: 1;
        }
        .main__divider--col {
          width: 1px;
          align-self: stretch;
        }
        .main__divider--col::before {
          content: '';
          position: absolute;
          inset: 0 -4px;
          cursor: col-resize;
        }
        .main__divider--row {
          height: 1px;
          width: 100%;
        }
        .main__divider--row::before {
          content: '';
          position: absolute;
          inset: -4px 0;
          cursor: row-resize;
        }
        .main__divider:hover,
        .main__divider--dragging {
          background-color: var(--color-gray-500);
        }
        .main__result {
          min-height: 0;
          min-width: 0;
          overflow: hidden;
          flex-shrink: 0;
        }
        @media (max-width: 1024px) {
          .main__pane { flex-direction: column; }
          .main__merge { flex: 1 1 auto; }
          .main__result { width: 100% !important; flex: 0 0 auto; }
        }
        .main__loading {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-3);
          color: var(--text-secondary);
          font-size: var(--font-size-sm);
        }
        .main__draft {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-3);
          color: var(--text-secondary);
        }
        .spinner {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 3px solid var(--bg-tertiary);
          border-top-color: var(--color-primary);
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  )
}
