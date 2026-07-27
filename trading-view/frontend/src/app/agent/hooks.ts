/**
 * Agent-aware hooks for Living UI components.
 *
 * Registers component state with the UICapture service so the agent
 * can observe the current UI through the HTTP snapshot endpoint.
 */

import { useEffect, useRef } from 'react'
import { uiCapture } from '../services/UICapture'

/**
 * Makes a component observable by the agent.
 *
 * Registers the component's state snapshot with UICapture on mount and
 * whenever the provided state object changes (shallow reference).
 *
 * @param componentName  Unique name for the component instance
 * @param state          Plain object describing current component state
 * @returns The same state object (pass-through for convenience)
 */
export function useAgentAware<T extends Record<string, unknown>>(
  componentName: string,
  state: T,
): T {
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    uiCapture.registerComponent(componentName, state as Record<string, unknown>)
    return () => {
      uiCapture.unregisterComponent(componentName)
    }
    // Only register/unregister on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentName])

  useEffect(() => {
    uiCapture.updateComponent(componentName, state as Record<string, unknown>)
  }, [componentName, state])

  return state
}
