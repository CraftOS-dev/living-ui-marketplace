import type { AppController } from '../AppController'
import { Card, Select } from './ui'
import { Ruler, ArrowLeftRight } from 'lucide-react'
import { type Category, CATEGORY_LABELS } from '../lib/unitConversion'
import { useUnitConverter, formatConvertedValue } from '../hooks/useUnitConverter'

interface UnitConverterFullProps {
  controller: AppController
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[]

const formatValue = formatConvertedValue

const columnControlWidth = 160

const columnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-2)',
}

export function UnitConverterFull({}: UnitConverterFullProps) {
  const { category, setCategory, fromUnit, setFromUnit, toUnit, setToUnit, fromValue, setFromValue, units, result, swap } = useUnitConverter()

  const unitOptions = Object.entries(units).map(([key, meta]) => ({ value: key, label: meta.label }))

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <Ruler size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>Unit Converter</h2>
      </div>

      <Card padding="lg">
        <Select
          label="Category"
          value={category}
          onChange={e => setCategory(e.target.value as Category)}
          options={CATEGORIES.map(c => ({ value: c, label: CATEGORY_LABELS[c] }))}
          style={{ marginBottom: 'var(--space-4)' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)' }}>
          <div style={columnStyle}>
            <input
              value={fromValue}
              onChange={e => setFromValue(e.target.value)}
              inputMode="decimal"
              style={{
                width: columnControlWidth,
                height: 'var(--input-height-lg)',
                padding: '0 var(--space-3)',
                fontSize: 'var(--font-size-xl)',
                textAlign: 'center',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)',
                outline: 'none',
              }}
            />
            <Select
              value={fromUnit}
              onChange={e => setFromUnit(e.target.value)}
              options={unitOptions}
              style={{ width: columnControlWidth, textAlign: 'center', textAlignLast: 'center' } as React.CSSProperties}
            />
          </div>

          <button
            onClick={swap}
            title="Swap units"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              color: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              flexShrink: 0,
            }}
          >
            <ArrowLeftRight size={16} />
          </button>

          <div style={columnStyle}>
            <div style={{
              width: columnControlWidth,
              height: 'var(--input-height-lg)',
              padding: '0 var(--space-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--font-size-xl)',
              fontWeight: 'var(--font-weight-semibold)' as any,
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--color-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
            }}>
              {result !== null ? formatValue(result) : '—'}
            </div>
            <Select
              value={toUnit}
              onChange={e => setToUnit(e.target.value)}
              options={unitOptions}
              style={{ width: columnControlWidth, textAlign: 'center', textAlignLast: 'center' } as React.CSSProperties}
            />
          </div>
        </div>
      </Card>
    </div>
  )
}
