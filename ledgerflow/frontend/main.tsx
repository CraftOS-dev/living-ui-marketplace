/// <reference types="vite/client" />
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { uiCapture } from './services/UICapture'
import './styles/global.css'

const backendUrl = 'http://localhost:{{BACKEND_PORT}}/api'

uiCapture.initialize(backendUrl)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
