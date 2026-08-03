import { useState } from 'react'
import type { AppController } from '../AppController'
import { Card, Button } from './ui'
import { Timer as TimerIcon, Play, Pause, RotateCcw, Flag } from 'lucide-react'
import { useTimer, formatDuration, TIMER_PRESETS_MIN } from '../hooks/useTimer'

interface TimerFullProps {
  controller: AppController
}

export function TimerFull({}: TimerFullProps) {
  const { mode, setMode, status, targetMs, setTargetMs, displayMs, start, pause, reset } = useTimer()
  const [laps, setLaps] = useState<number[]>([])
  const [customMinutes, setCustomMinutes] = useState('5')
  const [customSeconds, setCustomSeconds] = useState('0')

  const modeButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: 'var(--space-2) var(--space-3)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)' as any,
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    backgroundColor: active ? 'var(--color-primary-subtle)' : 'transparent',
    color: active ? 'var(--color-primary)' : 'var(--text-secondary)',
  })

  function applyCustomDuration() {
    const min = Math.max(0, parseInt(customMinutes, 10) || 0)
    const sec = Math.max(0, Math.min(59, parseInt(customSeconds, 10) || 0))
    setTargetMs((min * 60 + sec) * 1000)
  }

  function handleReset() {
    reset()
    setLaps([])
  }

  function addLap() {
    setLaps(prev => [...prev, displayMs])
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <TimerIcon size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>Timer</h2>
      </div>

      <Card padding="lg" style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <button style={modeButtonStyle(mode === 'countdown')} onClick={() => { setMode('countdown'); setLaps([]) }}>
            Countdown
          </button>
          <button style={modeButtonStyle(mode === 'stopwatch')} onClick={() => { setMode('stopwatch'); setLaps([]) }}>
            Stopwatch
          </button>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          fontSize: 'clamp(48px, 10vw, 72px)',
          fontWeight: 'var(--font-weight-bold)' as any,
          fontVariantNumeric: 'tabular-nums',
          color: status === 'finished' ? 'var(--color-error)' : 'var(--color-primary)',
          marginBottom: 'var(--space-4)',
        }}>
          {status === 'finished' ? "Time's up!" : formatDuration(displayMs, { showCentiseconds: true })}
        </div>

        {mode === 'countdown' && (status === 'idle') && (
          <>
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center', marginBottom: 'var(--space-3)' }}>
              {TIMER_PRESETS_MIN.map(min => (
                <button
                  key={min}
                  onClick={() => setTargetMs(min * 60 * 1000)}
                  style={{
                    padding: '4px 12px',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${targetMs === min * 60 * 1000 ? 'var(--color-primary)' : 'var(--border-primary)'}`,
                    background: targetMs === min * 60 * 1000 ? 'var(--color-primary-subtle)' : 'var(--bg-tertiary)',
                    color: targetMs === min * 60 * 1000 ? 'var(--color-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {min}m
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'center', marginBottom: 'var(--space-4)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Custom:</span>
              <input
                value={customMinutes}
                onChange={e => setCustomMinutes(e.target.value)}
                onBlur={applyCustomDuration}
                inputMode="numeric"
                style={{ width: 48, textAlign: 'center', padding: 'var(--space-1)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>min</span>
              <input
                value={customSeconds}
                onChange={e => setCustomSeconds(e.target.value)}
                onBlur={applyCustomDuration}
                inputMode="numeric"
                style={{ width: 48, textAlign: 'center', padding: 'var(--space-1)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>sec</span>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
          {status === 'running' ? (
            <Button variant="secondary" icon={<Pause size={16} />} onClick={pause}>Pause</Button>
          ) : (
            <Button variant="primary" icon={<Play size={16} />} onClick={start} disabled={status === 'finished'}>
              {status === 'paused' ? 'Resume' : 'Start'}
            </Button>
          )}
          {mode === 'stopwatch' && status === 'running' && (
            <Button variant="secondary" icon={<Flag size={16} />} onClick={addLap}>Lap</Button>
          )}
          <Button variant="ghost" icon={<RotateCcw size={16} />} onClick={handleReset}>Reset</Button>
        </div>
      </Card>

      {mode === 'stopwatch' && laps.length > 0 && (
        <Card padding="md">
          <div style={{ fontWeight: 'var(--font-weight-medium)' as any, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-2)' }}>
            Laps
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {laps.map((lap, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)',
                padding: 'var(--space-1) 0',
                borderBottom: i < laps.length - 1 ? '1px solid var(--border-secondary)' : 'none',
              }}>
                <span>Lap {i + 1}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDuration(lap, { showCentiseconds: true })}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
