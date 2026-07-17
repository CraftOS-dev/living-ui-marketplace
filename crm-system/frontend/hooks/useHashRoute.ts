import { useCallback, useEffect, useState } from 'react'

/**
 * Tiny hash router. Routes:
 *   #/home  #/my-work  #/people  #/companies  #/deals
 *   #/lists/:id  #/reports  #/settings
 *   #/records/:type/:id
 */
export interface Route {
  page: string
  parts: string[]
}

function parse(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const parts = hash.split('/').filter(Boolean)
  return { page: parts[0] || 'home', parts }
}

export function useHashRoute(): [Route, (path: string) => void] {
  const [route, setRoute] = useState<Route>(parse)

  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((path: string) => {
    window.location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`
  }, [])

  return [route, navigate]
}

export function navigateTo(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`
}

export function recordPath(recordType: string, id: number): string {
  return `records/${recordType}/${id}`
}
