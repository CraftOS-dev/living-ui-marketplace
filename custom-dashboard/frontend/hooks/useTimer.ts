import { useCallback, useEffect, useRef, useState } from 'react'

export type TimerMode = 'countdown' | 'stopwatch'
export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished'

export interface UseTimerResult {
  mode: TimerMode
  setMode: (mode: TimerMode) => void
  status: TimerStatus
  targetMs: number
  setTargetMs: (ms: number) => void
  displayMs: number
  start: () => void
  pause: () => void
  reset: () => void
}

const DEFAULT_TARGET_MS = 5 * 60 * 1000

/**
 * Shared countdown/stopwatch state, used by both the compact and full timer
 * views so their tick logic never diverges.
 *
 * Elapsed time is derived from a captured start timestamp plus previously
 * accumulated time (not a naive per-tick counter), so pausing/resuming or a
 * backgrounded tab doesn't cause drift.
 */
export function useTimer(): UseTimerResult {
  const [mode, setModeState] = useState<TimerMode>('countdown')
  const [status, setStatus] = useState<TimerStatus>('idle')
  const [targetMs, setTargetMs] = useState(DEFAULT_TARGET_MS)
  const [, forceTick] = useState(0)

  const accumulatedRef = useRef(0)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (status !== 'running') return
    const id = setInterval(() => forceTick(t => t + 1), 50)
    return () => clearInterval(id)
  }, [status])

  const elapsed = status === 'running' && startedAtRef.current !== null
    ? accumulatedRef.current + (Date.now() - startedAtRef.current)
    : accumulatedRef.current

  const start = useCallback(() => {
    setStatus(current => {
      if (current === 'running') return current
      startedAtRef.current = Date.now()
      return 'running'
    })
  }, [])

  const pause = useCallback(() => {
    setStatus(current => {
      if (current !== 'running') return current
      if (startedAtRef.current !== null) {
        accumulatedRef.current += Date.now() - startedAtRef.current
        startedAtRef.current = null
      }
      return 'paused'
    })
  }, [])

  const reset = useCallback(() => {
    accumulatedRef.current = 0
    startedAtRef.current = null
    setStatus('idle')
  }, [])

  const setMode = useCallback((m: TimerMode) => {
    accumulatedRef.current = 0
    startedAtRef.current = null
    setStatus('idle')
    setModeState(m)
  }, [])

  useEffect(() => {
    if (mode === 'countdown' && status === 'running' && elapsed >= targetMs) {
      accumulatedRef.current = targetMs
      startedAtRef.current = null
      setStatus('finished')
    }
  }, [elapsed, status, mode, targetMs])

  const displayMs = mode === 'countdown' ? Math.max(0, targetMs - elapsed) : elapsed

  return { mode, setMode, status, targetMs, setTargetMs, displayMs, start, pause, reset }
}

export function formatDuration(ms: number, options?: { showCentiseconds?: boolean }): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  const base = hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
  if (!options?.showCentiseconds) return base
  const centiseconds = Math.floor((ms % 1000) / 10)
  return `${base}.${String(centiseconds).padStart(2, '0')}`
}

export const TIMER_PRESETS_MIN = [1, 5, 10, 15, 30]
