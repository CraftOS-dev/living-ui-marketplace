import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { uiCapture } from './services/UICapture'
import './styles/global.css'

// Backend URL
const backendUrl = 'http://localhost:3113/api'

// Initialize UI capture for agent observation
// This replaces WebSocket-based AgentBridge with HTTP
uiCapture.initialize(backendUrl)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
