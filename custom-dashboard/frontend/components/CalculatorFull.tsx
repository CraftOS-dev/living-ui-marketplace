import { useState } from 'react'
import type { AppController } from '../AppController'
import { Card } from './ui'
import { Calculator as CalculatorIcon, Copy } from 'lucide-react'
import { toast } from 'react-toastify'
import { evaluateExpression, formatResult, CalculatorError } from '../lib/calculator'
import { copyToClipboard } from '../lib/clipboard'

interface CalculatorFullProps {
  controller: AppController
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

export function CalculatorFull({}: CalculatorFullProps) {
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
    <div style={{ maxWidth: 500, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <CalculatorIcon size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>Calculator</h2>
      </div>

      <Card padding="lg" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input
            value={expression}
            onChange={e => setExpression(e.target.value)}
            placeholder="2 + 2 * sqrt(9)"
            autoFocus
            style={{
              flex: 1,
              height: 'var(--input-height-lg)',
              padding: '0 var(--space-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-lg)',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: `1px solid ${error ? 'var(--color-error)' : 'var(--border-primary)'}`,
              borderRadius: 'var(--radius-md)',
              outline: 'none',
            }}
          />
          <button
            onClick={() => copy(expression)}
            disabled={!expression}
            title="Copy expression"
            style={{ background: 'none', border: 'none', cursor: expression ? 'pointer' : 'not-allowed', color: 'var(--text-muted)', display: 'flex', opacity: expression ? 1 : 0.4, flexShrink: 0 }}
          >
            <Copy size={18} />
          </button>
        </div>
        <div style={{ minHeight: 20, fontSize: 'var(--font-size-xs)', color: 'var(--color-error)', marginTop: 'var(--space-2)' }}>
          {error}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div style={{
            flex: 1,
            fontSize: 'clamp(32px, 6vw, 48px)',
            fontWeight: 'var(--font-weight-bold)' as any,
            color: error ? 'var(--text-muted)' : 'var(--color-primary)',
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
            <Copy size={20} />
          </button>
        </div>
      </Card>

      <Card padding="md">
        <div style={{ fontWeight: 'var(--font-weight-medium)' as any, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-1)' }}>
          Supported syntax
        </div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 'var(--line-height-relaxed)' }}>
          + − × ÷ (as * and /) · ^ for exponents · ( ) for grouping · sqrt(x) · log(x) (base 10) · ln(x) (natural log) · pi · e
        </div>
      </Card>
    </div>
  )
}
