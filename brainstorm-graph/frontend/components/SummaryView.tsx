import { useState, useEffect, useRef } from 'react'
import { Lightbulb, Tag, RefreshCw, Loader2 } from 'lucide-react'
import type { AppController } from '../AppController'
import type { BrainstormNode, SessionSummary } from '../types'

interface Props {
  nodes: BrainstormNode[]
  activeSessionId: number | null
  controller: AppController
}

export function SummaryView({ nodes, activeSessionId, controller }: Props) {
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastSessionId = useRef<number | null>(null)
  const lastNodeCount = useRef<number>(0)

  async function load() {
    if (!activeSessionId || nodes.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const result = await controller.generateSummary()
      setSummary(result)
      lastSessionId.current = activeSessionId
      lastNodeCount.current = nodes.length
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Failed to generate summary')
    } finally {
      setLoading(false)
    }
  }

  // Auto-load when switching to this view or when session changes
  useEffect(() => {
    if (
      activeSessionId !== lastSessionId.current ||
      nodes.length !== lastNodeCount.current
    ) {
      if (activeSessionId && nodes.length > 0) {
        load()
      }
    }
  }, [activeSessionId, nodes.length])

  if (!activeSessionId || nodes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>
        Create a session and add some nodes first.
      </div>
    )
  }

  const qCount = nodes.filter(n => n.nodeType === 'question').length
  const aCount = nodes.filter(n => n.nodeType === 'answer').length
  const iCount = nodes.filter(n => n.nodeType === 'idea').length
  const maxDepth = Math.max(...nodes.map(n => n.depth), 0)

  return (
    <div className="summary-view">
      {/* Stats strip */}
      <div className="stats-strip">
        <div className="stat"><span className="stat-num">{nodes.length}</span><span className="stat-label">nodes</span></div>
        <div className="stat"><span className="stat-num" style={{ color: 'var(--color-info)' }}>{qCount}</span><span className="stat-label">questions</span></div>
        <div className="stat"><span className="stat-num" style={{ color: 'var(--color-success)' }}>{aCount}</span><span className="stat-label">answers</span></div>
        <div className="stat"><span className="stat-num" style={{ color: 'var(--color-primary)' }}>{iCount}</span><span className="stat-label">ideas</span></div>
        <div className="stat"><span className="stat-num">{maxDepth + 1}</span><span className="stat-label">levels deep</span></div>
        <button className="refresh-btn" onClick={load} disabled={loading} title="Refresh summary">
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          {loading ? 'Generating…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 20px', color: 'var(--color-error, #ef4444)', fontSize: 13 }}>{error}</div>
      )}

      {loading && !summary && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Loader2 size={20} className="spin" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 13 }}>Synthesizing your brainstorming session…</p>
        </div>
      )}

      {summary && (
        <div className="summary-content">
          {/* Summary paragraphs */}
          <section className="summary-section">
            <h3 className="section-title">Session Summary</h3>
            <div className="summary-text">
              {summary.summary.split('\n').filter(Boolean).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </section>

          {/* Key themes */}
          {summary.themes.length > 0 && (
            <section className="summary-section">
              <h3 className="section-title">
                <Tag size={14} style={{ marginRight: 6 }} />
                Key Themes
              </h3>
              <div className="tag-list">
                {summary.themes.map((theme, i) => (
                  <span key={i} className="theme-tag">{theme}</span>
                ))}
              </div>
            </section>
          )}

          {/* Insights */}
          {summary.insights.length > 0 && (
            <section className="summary-section">
              <h3 className="section-title">
                <Lightbulb size={14} style={{ marginRight: 6 }} />
                Key Insights
              </h3>
              <ul className="insight-list">
                {summary.insights.map((insight, i) => (
                  <li key={i} className="insight-item">
                    <span className="insight-dot" />
                    {insight}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Node outline */}
          <section className="summary-section">
            <h3 className="section-title">Explored Nodes</h3>
            <div className="node-outline">
              {nodes
                .slice()
                .sort((a, b) => a.depth - b.depth || a.id - b.id)
                .map(node => (
                  <div key={node.id} className="outline-row" style={{ paddingLeft: node.depth * 16 + 8 }}>
                    <span className={`outline-dot dot-${node.nodeType}`} />
                    <span className="outline-content">{node.content}</span>
                    <span className="outline-type">{node.nodeType}</span>
                  </div>
                ))}
            </div>
          </section>
        </div>
      )}

      <style>{`
        .summary-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
        .stats-strip {
          display: flex; align-items: center; gap: 20px; padding: 10px 20px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
          background: var(--bg-secondary); flex-shrink: 0; flex-wrap: wrap;
        }
        .stat { display: flex; flex-direction: column; align-items: center; gap: 1px; }
        .stat-num { font-size: 18px; font-weight: 700; color: var(--text-primary); line-height: 1; }
        .stat-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .refresh-btn {
          display: flex; align-items: center; gap: 5px; margin-left: auto;
          background: var(--bg-tertiary); border: 1px solid var(--border-color, rgba(255,255,255,0.1));
          border-radius: var(--radius-md); padding: 5px 12px; cursor: pointer;
          font-size: 12px; color: var(--text-secondary); transition: all 0.15s;
        }
        .refresh-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-secondary); }
        .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .summary-content { flex: 1; overflow-y: auto; padding: 24px 32px; display: flex; flex-direction: column; gap: 28px; max-width: 800px; }
        .summary-section { display: flex; flex-direction: column; gap: 12px; }
        .section-title {
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--text-secondary); display: flex; align-items: center; margin: 0;
        }
        .summary-text { display: flex; flex-direction: column; gap: 10px; }
        .summary-text p { font-size: 14px; line-height: 1.7; color: var(--text-primary); margin: 0; }

        .tag-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .theme-tag {
          background: color-mix(in srgb, var(--color-primary) 15%, transparent);
          border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
          color: var(--color-primary); border-radius: 9999px;
          padding: 4px 12px; font-size: 12px; font-weight: 500;
        }

        .insight-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
        .insight-item {
          display: flex; align-items: flex-start; gap: 10px;
          font-size: 13.5px; line-height: 1.6; color: var(--text-primary);
        }
        .insight-dot {
          width: 6px; height: 6px; border-radius: 50%; background: var(--color-primary);
          flex-shrink: 0; margin-top: 7px;
        }

        .node-outline { display: flex; flex-direction: column; gap: 2px; }
        .outline-row {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 8px; border-radius: var(--radius-sm); transition: background 0.1s;
        }
        .outline-row:hover { background: var(--bg-tertiary); }
        .outline-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .dot-question { background: var(--color-info, #3b82f6); }
        .dot-answer { background: var(--color-success, #22c55e); }
        .dot-idea { background: var(--color-primary, #FF4F18); }
        .outline-content { flex: 1; font-size: 12.5px; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .outline-type { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }
      `}</style>
    </div>
  )
}
