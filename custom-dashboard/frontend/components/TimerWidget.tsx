import { useState } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView } from '../types'
import { Play, Pause, RotateCcw } from 'lucide-react'
import { Button } from './ui'
import { useTimer, formatDuration, TIMER_PRESETS_MIN } from '../hooks/useTimer'

interface TimerWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

export function TimerWidget({}: TimerWidgetProps) {
  const { mode, setMode, status, setTargetMs, displayMs, start, pause, reset } = useTimer()
  const [customMinutes, setCustomMinutes] = useState('5')
  const [customSeconds, setCustomSeconds] = useState('0')

  function applyCustomDuration() {
    const min = Math.max(0, parseInt(customMinutes, 10) || 0)
    const sec = Math.max(0, Math.min(59, parseInt(customSeconds, 10) || 0))
    setTargetMs((min * 60 + sec) * 1000)
  }

  const modeButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: 'var(--space-1) var(--space-2)',
    fontSize: 'var(--font-size-xs)',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    backgroundColor: active ? 'var(--color-primary-subtle)' : 'transparent',
    color: active ? 'var(--color-primary)' : 'var(--text-secondary)',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' }}>
        <button style={modeButtonStyle(mode === 'countdown')} onClick={() => setMode('countdown')}>Countdown</button>
        <button style={modeButtonStyle(mode === 'stopwatch')} onClick={() => setMode('stopwatch')}>Stopwatch</button>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'center',
        fontSize: 'clamp(24px, 4vw, 32px)',
        fontWeight: 'var(--font-weight-bold)' as any,
        fontVariantNumeric: 'tabular-nums',
        color: status === 'finished' ? 'var(--color-error)' : 'var(--text-primary)',
        marginBottom: 'var(--space-2)',
      }}>
        {status === 'finished' ? "Time's up!" : formatDuration(displayMs, { showCentiseconds: true })}
      </div>

      {mode === 'countdown' && status === 'idle' && (
        <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'center', marginBottom: 'var(--space-2)' }}>
          {TIMER_PRESETS_MIN.slice(0, 3).map(min => (
            <button
              key={min}
              onClick={() => setTargetMs(min * 60 * 1000)}
              style={{
                padding: '2px 8px',
                fontSize: 'var(--font-size-xs)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {min}m
            </button>
          ))}
        </div>
      )}

      {mode === 'countdown' && status === 'idle' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', justifyContent: 'center', marginBottom: 'var(--space-2)' }}>
          <input
            value={customMinutes}
            onChange={e => setCustomMinutes(e.target.value)}
            onBlur={applyCustomDuration}
            inputMode="numeric"
            aria-label="Custom minutes"
            style={{ width: 32, textAlign: 'center', fontSize: 'var(--font-size-xs)', padding: '2px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
          />
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>m</span>
          <input
            value={customSeconds}
            onChange={e => setCustomSeconds(e.target.value)}
            onBlur={applyCustomDuration}
            inputMode="numeric"
            aria-label="Custom seconds"
            style={{ width: 32, textAlign: 'center', fontSize: 'var(--font-size-xs)', padding: '2px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
          />
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>s</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center', marginTop: 'auto' }}>
        {status === 'running' ? (
          <Button size="sm" variant="secondary" icon={<Pause size={14} />} onClick={pause}>Pause</Button>
        ) : (
          <Button size="sm" variant="primary" icon={<Play size={14} />} onClick={start} disabled={status === 'finished'}>
            {status === 'paused' ? 'Resume' : 'Start'}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={reset}>Reset</Button>
      </div>
    </div>
  )
}
