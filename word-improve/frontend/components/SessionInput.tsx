import { useState } from 'react'
import { Wand2, Mic, Sparkles, Send } from 'lucide-react'
import { toast } from 'react-toastify'
import { Button, Textarea, Select } from './ui'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { Mode, Tone } from '../types'
import { TONES } from '../types'

// Compact Select sizing — matches the form labels (13px) and replaces the
// browser's native chevron with an inline SVG so it sits cleanly on the right.
const COMPACT_SELECT_STYLE: React.CSSProperties = {
  height: 'var(--input-height-sm)',
  fontSize: 'var(--font-size-sm)',
  paddingRight: '26px',
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none' as any,
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23a3a3a3' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  width: 'auto',
  minWidth: '160px',
}

interface SessionInputProps {
  controller: AppController
  busy: boolean
}

const MODE_OPTIONS: Array<{
  value: Mode
  label: string
  description: string
  Icon: typeof Wand2
}> = [
  { value: 'improve', label: 'Improve', description: 'Polish wording, keep meaning', Icon: Wand2 },
  { value: 'tone_shift', label: 'Tone shift', description: 'Rewrite in a tone', Icon: Mic },
  { value: 'custom', label: 'Custom', description: 'Free-form instruction', Icon: Sparkles },
]

export function SessionInput({ controller, busy }: SessionInputProps) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>('improve')
  const [tone, setTone] = useState<Tone>('Formal')
  const [customInstruction, setCustomInstruction] = useState('')
  const [variantCount, setVariantCount] = useState(3)

  useAgentAware('SessionInput', {
    section: 'session-input',
    mode,
    variantCount,
    textLength: text.length,
  })

  const handleSubmit = async () => {
    if (!text.trim()) {
      toast.warn('Paste some text first')
      return
    }
    if (mode === 'custom' && !customInstruction.trim()) {
      toast.warn('Add a custom instruction or pick a different mode')
      return
    }
    try {
      await controller.createAndGenerate({
        original_text: text,
        mode,
        tone: mode === 'tone_shift' ? tone : null,
        custom_instruction: mode === 'custom' ? customInstruction : null,
        variant_count: variantCount,
      })
      toast.success('Variants ready — pick the best lines')
    } catch {
      toast.error('Generation failed')
    }
  }

  return (
    <div className="session-input">
      <header className="session-input__head">
        <h2 className="session-input__title">Start a new improvement session</h2>
        <p className="session-input__sub">
          The LLM will produce {variantCount} whole-text variants in a single call. You'll then
          merge sentence-by-sentence in a git-style diff view.
        </p>
      </header>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste a paragraph (or several) you want to improve, continue, or rewrite..."
        rows={8}
        disabled={busy}
        className="session-input__textarea"
      />

      <div className="session-input__modes">
        {MODE_OPTIONS.map(({ value, label, description, Icon }) => {
          const selected = mode === value
          return (
            <button
              key={value}
              type="button"
              className={`mode-chip ${selected ? 'mode-chip--selected' : ''}`}
              onClick={() => setMode(value)}
              disabled={busy}
              aria-pressed={selected}
            >
              <Icon size={14} aria-hidden="true" />
              <div className="mode-chip__text">
                <span className="mode-chip__label">{label}</span>
                <span className="mode-chip__desc">{description}</span>
              </div>
            </button>
          )
        })}
      </div>

      {mode === 'tone_shift' && (
        <div className="session-input__row">
          <label className="session-input__label">Tone</label>
          <Select
            value={tone}
            onChange={(e) => setTone(e.target.value as Tone)}
            disabled={busy}
            options={TONES.map((t) => ({ value: t, label: t }))}
            style={COMPACT_SELECT_STYLE}
          />
        </div>
      )}

      {mode === 'custom' && (
        <div className="session-input__row session-input__row--col">
          <label className="session-input__label">Instruction</label>
          <Textarea
            value={customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
            placeholder="e.g. Make it sound like an internal Slack message from a manager"
            rows={2}
            disabled={busy}
          />
        </div>
      )}

      <div className="session-input__row session-input__row--end">
        <div className="session-input__variant-count">
          <label className="session-input__label" htmlFor="variant-count">
            Variants
          </label>
          <Select
            id="variant-count"
            value={String(variantCount)}
            onChange={(e) => setVariantCount(Number(e.target.value))}
            disabled={busy}
            options={[2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
            style={{ ...COMPACT_SELECT_STYLE, minWidth: '64px' }}
          />
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={handleSubmit}
          loading={busy}
          icon={<Send size={14} aria-hidden="true" />}
        >
          Generate variants
        </Button>
      </div>

      <style>{`
        .session-input {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          max-width: 720px;
          margin: 0 auto;
          width: 100%;
        }
        .session-input__head { display: flex; flex-direction: column; gap: 2px; }
        .session-input__title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); }
        .session-input__sub { color: var(--text-secondary); font-size: var(--font-size-xs); }
        .session-input__textarea { width: 100%; font-family: var(--font-sans); }
        .session-input__modes {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: var(--space-2);
        }
        .mode-chip {
          display: flex;
          align-items: flex-start;
          gap: var(--space-2);
          padding: var(--space-2);
          background-color: var(--bg-secondary);
          color: var(--text-primary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          cursor: pointer;
          text-align: left;
          font-family: var(--font-sans);
          transition: var(--transition-base);
        }
        .mode-chip > svg { color: var(--text-secondary); margin-top: 2px; flex-shrink: 0; }
        .mode-chip:hover:not(:disabled) {
          border-color: var(--text-secondary);
        }
        .mode-chip:disabled { opacity: 0.5; cursor: not-allowed; }
        .mode-chip--selected {
          border-color: var(--border-primary);
          background-color: var(--bg-tertiary);
          box-shadow: inset 3px 0 0 var(--color-primary);
        }
        .mode-chip--selected > svg { color: var(--color-primary); }
        .mode-chip__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .mode-chip__label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
        .mode-chip__desc { font-size: var(--font-size-xs); color: var(--text-secondary); }
        .session-input__row {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-wrap: wrap;
        }
        .session-input__row--col { flex-direction: column; align-items: stretch; }
        .session-input__row--end { justify-content: flex-end; }
        .session-input__label {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          font-weight: var(--font-weight-medium);
          line-height: var(--input-height-sm);
        }
        .session-input__variant-count {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          margin-right: auto;
        }
      `}</style>
    </div>
  )
}
