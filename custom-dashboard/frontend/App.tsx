import { useEffect, useRef } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { MainView } from './components/MainView'
import { AppController } from './AppController'
import { uiCapture } from './services/UICapture'
import {
  applyThemeToDocument,
  DEFAULT_CUSTOM_COLORS,
  type CustomColors,
  type ThemeId,
} from './theme/themes'

// Initialize the controller
const controller = new AppController()

function App() {
  const themeIdRef = useRef<ThemeId>('craftbot')
  const modeRef = useRef<'dark' | 'light'>('dark')
  const customColorsRef = useRef<CustomColors>({ ...DEFAULT_CUSTOM_COLORS })

  useEffect(() => {
    // Start the controller on mount
    controller.initialize()

    // Register app state for UI capture (agent observation via HTTP)
    uiCapture.registerComponent('App', {
      initialized: true,
      componentName: 'App',
    })

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

    return () => {
      // Cleanup on unmount
      controller.cleanup()
      uiCapture.unregisterComponent('App')
      window.removeEventListener('message', onMessage)
    }
  }, [])

  return (
    <div className="app">
      <MainView controller={controller} />
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
  )
}

export default App
