/**
 * Services Layer - API clients, persistence, and UI capture utilities
 */

export { ApiService } from './ApiService'
export { StatePersistence, uiPreferences, draftStorage, stateCache } from './StatePersistence'
export type { PersistenceOptions } from './StatePersistence'
export { UICapture, uiCapture } from './UICapture'
export type { UISnapshot, ComponentRegistration } from './UICapture'
