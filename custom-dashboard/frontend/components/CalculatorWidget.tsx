import { useState } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView } from '../types'
import { Copy } from 'lucide-react'
import { Input } from './ui'
import { toast } from 'react-toastify'
import { evaluateExpression, formatResult, CalculatorError } from '../lib/calculator'
import { copyToClipboard } from '../lib/clipboard'

interface CalculatorWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

async function copy(text: string) {
  if (!text) return
  try {
    await copyToClipboard(text)
    toast.success('Copied!')
  } catch {
    toast.error('Failed to copy')
  }
}

export function CalculatorWidget({ navigate }: CalculatorWidgetProps) {
  const [expression, setExpression] = useState('')

  let result = ''
  let error = ''
  if (expression.trim()) {
    try {
      result = formatResult(evaluateExpression(expression))
    } catch (e) {
      error = e instanceof CalculatorError ? e.message : 'Invalid expression'
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <div style={{ flex: 1 }}>
          <Input
            value={expression}
            onChange={e => setExpression(e.target.value)}
            placeholder="2 + 2 * sqrt(9)"
            style={{ borderColor: error ? 'var(--color-error)' : undefined }}
          />
        </div>
        <button
          onClick={() => copy(expression)}
          disabled={!expression}
          title="Copy expression"
          style={{ background: 'none', border: 'none', cursor: expression ? 'pointer' : 'not-allowed', color: 'var(--text-muted)', display: 'flex', opacity: expression ? 1 : 0.4, flexShrink: 0 }}
        >
          <Copy size={14} />
        </button>
      </div>

      <div style={{ minHeight: 16, fontSize: 'var(--font-size-xs)', color: 'var(--color-error)', marginTop: 'var(--space-1)' }}>
        {error}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <div style={{
          flex: 1,
          fontSize: 'clamp(20px, 4vw, 28px)',
          fontWeight: 'var(--font-weight-bold)' as any,
          color: error ? 'var(--text-muted)' : 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {result || '—'}
        </div>
        <button
          onClick={() => copy(result)}
          disabled={!result}
          title="Copy result"
          style={{ background: 'none', border: 'none', cursor: result ? 'pointer' : 'not-allowed', color: 'var(--text-muted)', display: 'flex', opacity: result ? 1 : 0.4, flexShrink: 0 }}
        >
          <Copy size={16} />
        </button>
      </div>

      <button
        onClick={() => navigate('calculator')}
        style={{
          marginTop: 'auto',
          padding: 'var(--space-2) 0 0 0',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-primary)',
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        Open calculator →
      </button>
    </div>
  )
}
