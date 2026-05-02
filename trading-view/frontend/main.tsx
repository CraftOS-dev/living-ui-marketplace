import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { uiCapture } from './services/UICapture'
import './styles/global.css'

// Backend URL: prefer the runtime-injected global from index.html (set per-project),
// fall back to this project's allocated backend port (3105).
const backendUrl = ((window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3105') + '/api'

uiCapture.initialize(backendUrl)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
