/**
 * Services layer.
 *
 * - AuthService: login/register + authenticated fetch (JWT)
 * - UICapture: HTTP-based UI observation for CraftBot agents
 *
 * All CRM data access goes through frontend/api.ts (typed authFetch client).
 */

export { authService } from './AuthService'

// UI capture for agent observation (HTTP-based, replaces WebSocket)
export { UICapture, uiCapture } from './UICapture'
export type { UISnapshot, ComponentRegistration } from './UICapture'
