import { useEffect } from 'react'
import { uiCapture } from '../services/UICapture'

export function useAgentAware(componentName: string, state: Record<string, unknown>) {
  useEffect(() => {
    uiCapture.registerComponent(componentName, state)
    return () => {
      uiCapture.unregisterComponent(componentName)
    }
  }, [componentName])

  return state
}
