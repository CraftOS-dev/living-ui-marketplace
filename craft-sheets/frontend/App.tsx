import { useEffect, useMemo, useRef } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { MainView } from './components/MainView'
import { AppController } from './AppController'
import { uiCapture } from './services/UICapture'
import {
  applyThemeToDocument,
  loadCustomColors,
  loadStoredTheme,
  saveCustomColors,
  saveTheme,
  type CustomColors,
  type ThemeId,
} from './theme/themes'

function App() {
  const controller = useMemo(() => new AppController(), [])

  const themeIdRef = useRef<ThemeId>(loadStoredTheme())
  const modeRef = useRef<'dark' | 'light'>('dark')
  const customColorsRef = useRef<CustomColors>(loadCustomColors())

  useEffect(() => {
    uiCapture.registerComponent('App', { componentName: 'App', initialized: true })

    // Apply stored theme immediately using dark as default until parent responds
    applyThemeToDocument(themeIdRef.current, modeRef.current, customColorsRef.current)

    const onMessage = (e: MessageEvent) => {
      if (!e.data) return

      if (e.data.type === 'craftbot-theme') {
        // Parent broadcast its dark/light mode — re-apply current theme with new mode
        const mode: 'dark' | 'light' = e.data.theme === 'light' ? 'light' : 'dark'
        modeRef.current = mode
        applyThemeToDocument(themeIdRef.current, mode, customColorsRef.current)
      }

      if (e.data.type === 'livingui-theme') {
        // Parent sent a theme selection from the CraftBot shell modal
        const themeId = e.data.themeId as ThemeId
        themeIdRef.current = themeId
        saveTheme(themeId)
        if (e.data.customColors) {
          const colors = e.data.customColors as CustomColors
          customColorsRef.current = colors
          saveCustomColors(colors)
        }
        applyThemeToDocument(themeId, modeRef.current, customColorsRef.current)
      }
    }

    window.addEventListener('message', onMessage)

    // Request the current mode from the parent CraftBot shell
    try {
      window.parent.postMessage({ type: 'craftbot-theme-request' }, '*')
    } catch {}

    return () => {
      uiCapture.unregisterComponent('App')
      window.removeEventListener('message', onMessage)
    }
  }, [])

  return (
    <div className="app">
      <MainView controller={controller} />
      <ToastContainer
        position="top-right"
        autoClose={2500}
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
