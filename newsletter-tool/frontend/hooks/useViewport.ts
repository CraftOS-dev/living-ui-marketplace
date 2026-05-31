import { useEffect, useState } from 'react'

export type ViewportSize = 'mobile' | 'tablet' | 'desktop'

const BREAKPOINTS = {
  mobile: 640,
  tablet: 960,
}

function classify(width: number): ViewportSize {
  if (width < BREAKPOINTS.mobile) return 'mobile'
  if (width < BREAKPOINTS.tablet) return 'tablet'
  return 'desktop'
}

export function useViewport(): { width: number; size: ViewportSize } {
  const [state, setState] = useState(() => {
    const w = typeof window === 'undefined' ? 1280 : window.innerWidth
    return { width: w, size: classify(w) }
  })

  useEffect(() => {
    function onResize() {
      const w = window.innerWidth
      setState({ width: w, size: classify(w) })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return state
}
