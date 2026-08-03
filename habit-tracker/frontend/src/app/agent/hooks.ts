/**
 * Agent awareness hooks for Living UI.
 * Registers component state for agent observation via HTTP.
 */
import { useEffect } from 'react'
import { uiCapture } from '../services/UICapture'

/**
 * Make a component agent-aware by registering its state.
 * The agent can observe this state via GET /api/ui-snapshot.
 */
export function useAgentAware(componentName: string, state: Record<string, unknown>) {
  useEffect(() => {
    uiCapture.registerComponent(componentName, state)
    return () => {
      uiCapture.unregisterComponent(componentName)
    }
  }, [componentName])

  return state
}
