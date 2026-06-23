import { Sparkles, Loader } from 'lucide-react'
import type { InsightSummary } from '../types'

interface InsightCardProps {
  insight: InsightSummary | null
  loading: boolean
}

export function InsightCard({ insight, loading }: InsightCardProps) {
  return (
    <div className="insight-card">
      <div className="insight-header">
        <Sparkles size={14} />
        <span>AI Insights</span>
      </div>

      {loading && (
        <div className="insight-loading">
          <Loader size={14} className="spin" />
          <span>Generating summary…</span>
        </div>
      )}

      {!loading && insight && (
        <>
          {insight.summary && (
            <p className="insight-summary">{insight.summary}</p>
          )}
          {insight.points.length > 0 && (
            <ul className="insight-points">
              {insight.points.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {!loading && !insight && (
        <p className="insight-empty">No summary available yet.</p>
      )}

      <style>{`
        .insight-card {
          background: var(--color-accent-light);
          border: 1px solid var(--color-accent);
          border-radius: var(--radius-md);
          padding: var(--space-3);
          font-size: var(--font-size-xs);
        }

        .insight-header {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          color: var(--color-accent);
          font-weight: var(--font-weight-semibold);
          font-size: var(--font-size-xs);
          margin-bottom: var(--space-2);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .insight-loading {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          color: var(--text-secondary);
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        .insight-summary {
          color: var(--text-secondary);
          line-height: var(--line-height-relaxed);
          margin-bottom: var(--space-2);
        }

        .insight-points {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          color: var(--text-secondary);
          padding: 0;
        }

        .insight-points li::before {
          content: '•';
          color: var(--color-accent);
          margin-right: var(--space-2);
        }

        .insight-empty {
          color: var(--text-muted);
          font-style: italic;
        }
      `}</style>
    </div>
  )
}
