import { Check, RefreshCw, AlertTriangle, Layers } from 'lucide-react'
import { Button } from './ui'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { ChoiceNote, MergeSegment, SegmentChoice, SessionDetail } from '../types'

interface MergeViewProps {
  controller: AppController
  session: SessionDetail
  regenerating: boolean
}

const PARAGRAPH_BREAK = '\n\n'

function isParagraphBreakSegment(seg: MergeSegment): boolean {
  return seg.choices.some((c) => c.text === PARAGRAPH_BREAK)
}

function variantLabel(source: string, fallbackIdx: number): string {
  if (source === 'original') return 'Original'
  const m = /^variant_(\d+)$/.exec(source)
  if (m) return `Variant ${String.fromCharCode(65 + Number(m[1]))}`
  return `Choice ${fallbackIdx + 1}`
}

function noteLabel(note: ChoiceNote | undefined): string | null {
  switch (note) {
    case 'reordered': return 'reordered'
    case 'split': return 'merged from multiple'
    case 'removed': return 'remove this sentence'
    case 'added': return 'new content'
    case 'skip': return 'skip'
    default: return null
  }
}

function isResolved(seg: MergeSegment): boolean {
  if (seg.kind === 'auto') return true
  return seg.selection !== null && seg.selection >= 0 && seg.selection < seg.choices.length
}

export function MergeView({
  controller,
  session,
  regenerating,
}: MergeViewProps) {
  const segments = [...session.segments].sort((a, b) => a.position - b.position)
  const conflicts = segments.filter((s) => s.kind === 'conflict')
  const resolved = conflicts.filter(isResolved).length
  const allResolved = conflicts.length === 0 || resolved === conflicts.length

  useAgentAware('MergeView', {
    section: 'merge',
    sessionId: session.id,
    totalSegments: segments.length,
    conflicts: conflicts.length,
    resolved,
  })

  // Number conflicts and additions so users can refer to them sequentially.
  let conflictNumber = 0
  let additionNumber = 0

  return (
    <div className="merge-view">
      <header className="merge-view__head">
        <div className="merge-view__stats">
          <span className="merge-stat">
            <Layers size={12} aria-hidden="true" /> {segments.length} sentences
          </span>
          <span className="merge-stat">
            <Check size={12} aria-hidden="true" /> {resolved}/{conflicts.length} picked
          </span>
          {!allResolved && (
            <span className="merge-stat merge-stat--warn">
              <AlertTriangle size={12} aria-hidden="true" /> {conflicts.length - resolved} to go
            </span>
          )}
        </div>
        <div className="merge-view__actions">
          <Button
            size="md"
            variant="ghost"
            onClick={() => {
              // Errors land in state.error and render in the header Alert;
              // swallow here so the unhandled rejection doesn't hit the console.
              controller.regenerate().catch(() => {})
            }}
            loading={regenerating}
            icon={<RefreshCw size={14} aria-hidden="true" />}
          >
            Regenerate
          </Button>
        </div>
      </header>

      <div className="merge-view__body">
        {segments.map((seg) => {
          if (isParagraphBreakSegment(seg)) {
            return <div key={seg.id} className="seg-break" aria-hidden="true" />
          }
          if (seg.kind === 'auto') {
            return <AutoSegment key={seg.id} segment={seg} />
          }
          if (seg.kind === 'addition') {
            additionNumber += 1
            return (
              <AdditionSegment
                key={seg.id}
                segment={seg}
                number={additionNumber}
                controller={controller}
              />
            )
          }
          conflictNumber += 1
          return (
            <ConflictSegment
              key={seg.id}
              segment={seg}
              number={conflictNumber}
              controller={controller}
            />
          )
        })}
      </div>

      <style>{`
        .merge-view {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          height: 100%;
          min-height: 0;
        }
        .merge-view__head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2);
          flex-wrap: wrap;
        }
        .merge-view__stats {
          display: flex;
          gap: var(--space-2);
          flex-wrap: wrap;
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
        }
        .merge-stat { display: inline-flex; align-items: center; gap: var(--space-1); }
        .merge-stat--warn { color: var(--color-warning); }
        .merge-view__actions { display: flex; gap: var(--space-1); flex-wrap: wrap; }
        .merge-view__body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding-right: var(--space-1);
          display: flex;
          flex-direction: column;
        }
        .seg-break {
          height: var(--space-2);
        }
      `}</style>
    </div>
  )
}

function AutoSegment({ segment }: { segment: MergeSegment }) {
  const idx = segment.selection ?? 0
  const text = segment.choices[idx]?.text || segment.choices[0]?.text || ''
  return (
    <div className="auto-seg">
      <p>{text}</p>
      <style>{`
        .auto-seg {
          padding: var(--space-2) 0;
          border-bottom: 1px solid var(--border-primary);
        }
        .auto-seg p {
          font-size: var(--font-size-sm);
          line-height: var(--line-height-normal);
          color: var(--text-primary);
          padding: 0 var(--space-2);
        }
      `}</style>
    </div>
  )
}

interface ConflictSegmentProps {
  segment: MergeSegment
  number: number
  controller: AppController
}

function ConflictSegment({ segment, number, controller }: ConflictSegmentProps) {
  const resolved = segment.selection !== null
  return (
    <section className={`conflict ${resolved ? 'conflict--resolved' : 'conflict--unresolved'}`}>
      <header className="conflict__head">
        <span className="conflict__num">#{number}</span>
        <span className="conflict__status">
          {resolved ? (
            <>
              <Check size={12} aria-hidden="true" /> Picked
            </>
          ) : (
            <>
              <AlertTriangle size={12} aria-hidden="true" /> Choose a version
            </>
          )}
        </span>
      </header>

      <div className="conflict__choices">
        {segment.choices.map((choice, idx) => {
          const selected = segment.selection === idx
          // Original (idx 0) is never dimmed; only sibling variants are dimmed
          // once another variant has been picked.
          const unpicked =
            segment.selection !== null &&
            segment.selection !== idx &&
            idx !== 0
          return (
            <ChoiceCard
              key={idx}
              choice={choice}
              label={variantLabel(choice.source, idx)}
              selected={selected}
              unpicked={unpicked}
              onPick={() => {
                const next = segment.selection === idx ? null : idx
                controller.selectSegment(segment.id, next)
              }}
            />
          )
        })}
      </div>

      <style>{`
        .conflict {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          padding: var(--space-3) 0;
          border-bottom: 1px solid var(--border-primary);
        }
        .conflict__head {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: 0 var(--space-2);
          margin-bottom: var(--space-1);
        }
        .conflict__num {
          font-size: var(--font-size-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          padding: 1px var(--space-2);
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-full);
        }
        .conflict__status {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
          font-size: var(--font-size-xs);
          font-weight: var(--font-weight-medium);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .conflict__choices {
          display: flex;
          flex-direction: column;
        }
      `}</style>
    </section>
  )
}

interface ChoiceCardProps {
  choice: SegmentChoice
  label: string
  selected: boolean
  unpicked: boolean
  onPick: () => void
}

function ChoiceCard({ choice, label, selected, unpicked, onPick }: ChoiceCardProps) {
  const isEmpty = !choice.text
  const note = noteLabel(choice.note)
  const isAcceptableEmpty = choice.note === 'removed' || choice.note === 'skip'
  return (
    <button
      type="button"
      className={[
        'choice',
        selected ? 'choice--selected' : '',
        unpicked ? 'choice--unpicked' : '',
        isEmpty && !isAcceptableEmpty ? 'choice--empty' : '',
      ].filter(Boolean).join(' ')}
      onClick={onPick}
      aria-pressed={selected}
      aria-label={`${label}: ${choice.text || note || 'empty'}`}
      disabled={isEmpty && !isAcceptableEmpty}
    >
      <div className="choice__head">
        <span className="choice__label">{label}</span>
        {note && <span className="choice__note">{note}</span>}
        {selected && <Check size={14} aria-hidden="true" className="choice__check" />}
      </div>
      <div className="choice__text">
        {isEmpty
          ? <em className="choice__placeholder">{isAcceptableEmpty ? '— nothing here —' : 'no text in this variant'}</em>
          : choice.text}
      </div>

      <style>{`
        .choice {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: var(--space-2);
          background-color: transparent;
          color: var(--text-primary);
          border: none;
          cursor: pointer;
          font-family: var(--font-sans);
          text-align: left;
          transition: var(--transition-base);
          width: 100%;
        }
        .choice:hover:not(:disabled):not(.choice--selected) {
          background-color: var(--bg-secondary);
        }
        .choice:disabled { opacity: 0.5; cursor: not-allowed; }
        .choice--selected {
          background-color: var(--color-success-light);
          box-shadow: inset 3px 0 0 var(--color-success);
        }
        .choice--selected .choice__check { color: var(--color-success); }
        .choice--unpicked { opacity: 0.4; }
        .choice--unpicked:hover:not(:disabled) { opacity: 0.85; background-color: var(--bg-secondary); }
        .choice__head {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .choice__label {
          font-size: var(--font-size-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .choice__note {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          font-style: italic;
          font-weight: var(--font-weight-normal);
          text-transform: none;
          letter-spacing: 0;
        }
        .choice__note::before { content: '· '; }
        .choice__check { color: var(--text-secondary); margin-left: auto; }
        .choice__text {
          font-size: var(--font-size-sm);
          line-height: var(--line-height-normal);
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-word;
        }
        .choice__placeholder {
          color: var(--text-muted);
          font-style: italic;
          font-size: var(--font-size-xs);
        }
      `}</style>
    </button>
  )
}

interface AdditionSegmentProps {
  segment: MergeSegment
  number: number
  controller: AppController
}

function AdditionSegment({ segment, number, controller }: AdditionSegmentProps) {
  // Addition segments always have exactly two choices: [skip, the variant's
  // added text]. Picking selection=1 includes it in the compile output.
  const includeChoice = segment.choices[1]
  const include = segment.selection === 1
  const variantSource = includeChoice?.source || ''
  const label = variantLabel(variantSource, 1)

  return (
    <article className={`addition ${include ? 'addition--include' : ''}`}>
      <div className="addition__head">
        <span className="addition__num">+{number}</span>
        <span className="addition__label">{label} adds</span>
      </div>
      <p className="addition__text">{includeChoice?.text || ''}</p>
      <div className="addition__actions">
        <button
          type="button"
          className={`addition__btn ${!include ? 'addition__btn--skip-active' : ''}`}
          onClick={() => controller.selectSegment(segment.id, 0)}
          aria-pressed={!include}
        >
          Skip
        </button>
        <button
          type="button"
          className={`addition__btn ${include ? 'addition__btn--include-active' : ''}`}
          onClick={() => controller.selectSegment(segment.id, 1)}
          aria-pressed={include}
        >
          Include
        </button>
      </div>

      <style>{`
        .addition {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
          padding: var(--space-3) var(--space-2);
          background-color: transparent;
          border-bottom: 1px solid var(--border-primary);
          transition: var(--transition-base);
        }
        .addition--include {
          background-color: var(--color-success-light);
          box-shadow: inset 3px 0 0 var(--color-success);
        }
        .addition__head {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }
        .addition__num {
          font-size: var(--font-size-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          padding: 1px var(--space-2);
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-full);
        }
        .addition__label {
          font-size: var(--font-size-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .addition__text {
          font-size: var(--font-size-sm);
          line-height: var(--line-height-normal);
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-word;
        }
        .addition__actions { display: flex; gap: var(--space-1); }
        .addition__btn {
          padding: 2px var(--space-2);
          font-size: var(--font-size-xs);
          font-family: var(--font-sans);
          color: var(--text-secondary);
          background-color: transparent;
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: var(--transition-base);
        }
        .addition__btn:hover { color: var(--text-primary); border-color: var(--text-secondary); }
        .addition__btn--skip-active {
          color: var(--text-primary);
          border-color: var(--text-secondary);
          background-color: var(--bg-tertiary);
        }
        .addition__btn--include-active {
          color: var(--color-success);
          border-color: var(--color-success);
          background-color: var(--color-success-light);
        }
      `}</style>
    </article>
  )
}
