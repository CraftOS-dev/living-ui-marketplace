import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { toast } from 'react-toastify'
import { Button } from './ui'
import { useAgentAware } from '../agent/hooks'
import type { CompileResponse } from '../types'

interface CompiledResultProps {
  compile: CompileResponse | null
}

export function CompiledResult({ compile }: CompiledResultProps) {
  const [copied, setCopied] = useState(false)

  useAgentAware('CompiledResult', {
    section: 'compiled-result',
    hasResult: compile !== null,
    copied,
  })

  const handleCopy = async () => {
    if (!compile) return
    try {
      await navigator.clipboard.writeText(compile.compiled)
      setCopied(true)
      toast.success('Compiled text copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not access the clipboard')
    }
  }

  if (!compile) {
    return (
      <div className="result result--empty">
        <p>Pick a variant on the left to populate the result.</p>
        <style>{`
          .result--empty {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: var(--space-3);
            color: var(--text-muted);
            font-size: var(--font-size-sm);
            font-style: italic;
            background-color: var(--bg-secondary);
            border-left: 1px solid var(--border-primary);
          }
        `}</style>
      </div>
    )
  }

  const wordsAdded = compile.diff
    .filter((s) => s.op === 'insert')
    .reduce((acc, s) => acc + s.text.trim().split(/\s+/).filter(Boolean).length, 0)
  const wordsRemoved = compile.diff
    .filter((s) => s.op === 'delete')
    .reduce((acc, s) => acc + s.text.trim().split(/\s+/).filter(Boolean).length, 0)
  const noChanges = compile.diff.length > 0 && compile.diff.every((s) => s.op === 'equal')

  return (
    <div className="result" role="dialog" aria-label="Compiled result">
      <header className="result__head">
        <div>
          <h2 className="result__title">Compiled result</h2>
          <p className="result__stats">
            <span className="stat stat--add">+{wordsAdded} words</span>
            <span className="stat stat--del">−{wordsRemoved} words</span>
          </p>
        </div>
        <div className="result__actions">
          <Button
            size="md"
            variant="primary"
            onClick={handleCopy}
            icon={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </header>

      <div className="result__body">
        <section className="result__section">
          <h3 className="result__sub">Diff vs original</h3>
          <div className="result__diff">
            {compile.diff.length === 0 ? (
              <span className="result__hint">No diff data.</span>
            ) : (
              compile.diff.map((seg, i) => (
                <span key={i} className={`diff-seg diff-seg--${seg.op}`}>
                  {seg.text}
                </span>
              ))
            )}
            {noChanges && (
              <p className="result__hint">No changes — the compiled output matches the original.</p>
            )}
          </div>
        </section>

        <section className="result__section">
          <h3 className="result__sub">Plain text</h3>
          <pre className="result__pre">{compile.compiled || '(empty)'}</pre>
        </section>
      </div>

      <style>{`
        .result {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          height: 100%;
          background-color: var(--bg-secondary);
          border-left: 1px solid var(--border-primary);
          padding: var(--space-2);
          min-height: 0;
        }
        .result__head {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-2);
        }
        .result__title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
        .result__stats {
          display: flex;
          gap: var(--space-3);
          flex-wrap: wrap;
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
          margin-top: var(--space-1);
        }
        .stat--add { color: var(--color-success); }
        .stat--del { color: var(--color-error); }
        .result__actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .result__body {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }
        .result__section { display: flex; flex-direction: column; gap: var(--space-1); }
        .result__sub {
          font-size: var(--font-size-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .result__diff {
          padding: var(--space-2);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          background-color: var(--bg-tertiary);
          font-family: var(--font-mono);
          font-size: var(--font-size-sm);
          line-height: var(--line-height-relaxed);
          white-space: pre-wrap;
          word-break: break-word;
        }
        .diff-seg--equal { color: var(--text-primary); }
        .diff-seg--insert {
          background-color: rgba(34, 197, 94, 0.18);
          color: var(--color-success);
          padding: 0 2px;
          border-radius: 2px;
        }
        .diff-seg--delete {
          background-color: rgba(239, 68, 68, 0.18);
          color: var(--color-error);
          padding: 0 2px;
          border-radius: 2px;
          text-decoration: line-through;
        }
        .result__pre {
          padding: var(--space-3);
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--font-size-sm);
          line-height: var(--line-height-relaxed);
          background-color: var(--bg-primary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-word;
        }
        .result__hint {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          font-style: italic;
        }
      `}</style>
    </div>
  )
}
