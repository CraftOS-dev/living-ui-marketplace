import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { uiCapture } from './services/UICapture'
import './styles/global.css'

// Get backend URL from environment
const backendPort = (import.meta as any).env?.VITE_BACKEND_PORT || '3101'
const backendUrl = `http://localhost:${backendPort}/api`

// Initialize UI capture for agent observation
// This replaces WebSocket-based AgentBridge with HTTP
uiCapture.initialize(backendUrl)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
