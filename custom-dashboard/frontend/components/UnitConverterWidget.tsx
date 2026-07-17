import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView } from '../types'
import { ArrowLeftRight } from 'lucide-react'
import { Select } from './ui'
import { CATEGORY_LABELS, type Category } from '../lib/unitConversion'
import { useUnitConverter, formatConvertedValue } from '../hooks/useUnitConverter'

interface UnitConverterWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[]

const smallControlStyle: React.CSSProperties = {
  height: 'var(--input-height-sm)',
  fontSize: 'var(--font-size-xs)',
  padding: '0 var(--space-2)',
  textAlign: 'center',
}

const centeredSelectStyle: React.CSSProperties = {
  ...smallControlStyle,
  textAlignLast: 'center' as any,
}

const columnControlWidth = 100

const columnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-1)',
}

export function UnitConverterWidget({ navigate }: UnitConverterWidgetProps) {
  const { category, setCategory, fromUnit, setFromUnit, toUnit, setToUnit, fromValue, setFromValue, units, result, swap } = useUnitConverter()

  const unitOptions = Object.entries(units).map(([key, meta]) => ({ value: key, label: meta.label }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 'var(--space-2)' }}>
        <Select
          aria-label="Category"
          value={category}
          onChange={e => setCategory(e.target.value as Category)}
          options={CATEGORIES.map(c => ({ value: c, label: CATEGORY_LABELS[c] }))}
          style={centeredSelectStyle}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
          <div style={columnStyle}>
            <input
              value={fromValue}
              onChange={e => setFromValue(e.target.value)}
              inputMode="decimal"
              aria-label="Value"
              style={{
                ...smallControlStyle,
                width: columnControlWidth,
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)',
                outline: 'none',
              }}
            />
            <Select
              aria-label="From unit"
              value={fromUnit}
              onChange={e => setFromUnit(e.target.value)}
              options={unitOptions}
              style={{ ...centeredSelectStyle, width: columnControlWidth }}
            />
          </div>

          <button
            onClick={swap}
            title="Swap units"
            style={{
              flexShrink: 0,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              color: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
            }}
          >
            <ArrowLeftRight size={12} />
          </button>

          <div style={columnStyle}>
            <div style={{
              ...smallControlStyle,
              width: columnControlWidth,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'var(--font-weight-semibold)' as any,
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--color-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {result !== null ? formatConvertedValue(result) : '—'}
            </div>
            <Select
              aria-label="To unit"
              value={toUnit}
              onChange={e => setToUnit(e.target.value)}
              options={unitOptions}
              style={{ ...centeredSelectStyle, width: columnControlWidth }}
            />
          </div>
        </div>
      </div>

      <button
        onClick={() => navigate('converter')}
        style={{
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-primary)',
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
          padding: 0,
        }}
      >
        Open converter →
      </button>
    </div>
  )
}
