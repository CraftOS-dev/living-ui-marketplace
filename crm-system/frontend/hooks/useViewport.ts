import { useEffect, useState } from 'react'

export interface Viewport {
  width: number
  isMobile: boolean   // < 768
  isTablet: boolean   // < 1024
  isNarrow: boolean   // < 1100 (record page right panel collapses)
}

function compute(): Viewport {
  const width = window.innerWidth
  return { width, isMobile: width < 768, isTablet: width < 1024, isNarrow: width < 1100 }
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(compute)
  useEffect(() => {
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setViewport(compute()))
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return viewport
}
