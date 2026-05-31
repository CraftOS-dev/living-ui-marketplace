import { useEffect, useState } from 'react'
import type { AppState } from '../types'
import type { AppController } from '../AppController'

export function useAppState(controller: AppController): AppState {
  const [state, setState] = useState<AppState>(() => controller.getState())
  useEffect(() => {
    const unsub = controller.subscribe(setState)
    setState(controller.getState())
    return () => {
      unsub()
    }
  }, [controller])
  return state
}
