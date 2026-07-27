import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { AppController, ControllerSnapshot } from '../AppController'

const MOBILE_MAX = 767
const TABLET_MAX = 1023

export interface Viewport {
  width: number
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
}

/**
 * Track window width and expose discrete breakpoints. Updates on resize and
 * orientation change. Defaults to desktop during SSR / first paint.
 */
export function useViewport(): Viewport {
  const [width, setWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    let frame: number | null = null
    const onResize = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  return useMemo<Viewport>(
    () => ({
      width,
      isMobile: width <= MOBILE_MAX,
      isTablet: width > MOBILE_MAX && width <= TABLET_MAX,
      isDesktop: width > TABLET_MAX,
    }),
    [width],
  )
}

/**
 * Subscribe to the AppController's snapshot. Returns the current snapshot
 * and re-renders whenever it changes.
 */
export function useController(controller: AppController): ControllerSnapshot {
  return useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  )
}

/** Detects OS dark/light preference. */
export function useSystemTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])

  // Reflect to the body so the global.css [data-theme="light"] override applies.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return theme
}
