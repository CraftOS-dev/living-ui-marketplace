import { useEffect, useState, useRef } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { MainView } from './components/MainView'
import { AppController } from './AppController'
import { uiCapture } from './services/UICapture'
import { AuthProvider, useAuth } from './components/auth/AuthProvider'
import { LoginPage } from './components/auth/LoginPage'
import { RegisterPage } from './components/auth/RegisterPage'
import {
  applyThemeToDocument,
  DEFAULT_CUSTOM_COLORS,
  type CustomColors,
  type ThemeId,
} from './theme/themes'

// Initialize the controller
const controller = new AppController()

function AuthGate() {
  const { isAuthenticated, loading } = useAuth()
  const [page, setPage] = useState<'login' | 'register'>('login')

  useEffect(() => {
    if (isAuthenticated) {
      controller.initialize()
      uiCapture.registerComponent('App', { initialized: true, componentName: 'App' })
    }
    return () => {
      controller.cleanup()
      uiCapture.unregisterComponent('App')
    }
  }, [isAuthenticated])

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>Loading...</div>
  }

  if (!isAuthenticated) {
    return page === 'login'
      ? <LoginPage onSwitchToRegister={() => setPage('register')} />
      : <RegisterPage onSwitchToLogin={() => setPage('login')} />
  }

  return <MainView controller={controller} />
}

function App() {
  const themeIdRef = useRef<ThemeId>('craftbot')
  const modeRef = useRef<'dark' | 'light'>('dark')
  const customColorsRef = useRef<CustomColors>({ ...DEFAULT_CUSTOM_COLORS })

  useEffect(() => {
    applyThemeToDocument(themeIdRef.current, modeRef.current, customColorsRef.current)

    const onMessage = (e: MessageEvent) => {
      if (!e.data) return

      if (e.data.type === 'craftbot-theme') {
        const mode: 'dark' | 'light' = e.data.theme === 'light' ? 'light' : 'dark'
        modeRef.current = mode
        applyThemeToDocument(themeIdRef.current, mode, customColorsRef.current)
      }

      if (e.data.type === 'livingui-theme') {
        const themeId = e.data.themeId as ThemeId
        themeIdRef.current = themeId
        if (e.data.customColors) {
          customColorsRef.current = e.data.customColors as CustomColors
        }
        applyThemeToDocument(themeId, modeRef.current, customColorsRef.current)
      }
    }

    window.addEventListener('message', onMessage)

    try {
      window.parent.postMessage({ type: 'craftbot-theme-request' }, '*')
    } catch {}

    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <AuthProvider>
      <div className="app">
        <AuthGate />
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          pauseOnHover
          theme="colored"
        />
      </div>
    </AuthProvider>
  )
}

export default App