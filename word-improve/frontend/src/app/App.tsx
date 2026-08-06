/**
 * App entry for the V2 platform.
 *
 * Bootstraps the ORIGINAL V1 word-improve frontend unchanged — same components,
 * same "CraftBot Browser Interface" design system, same behavior. The
 * adaptation to the V2 (PocketBase) platform is a client-side API adapter
 * (./services/apiAdapter): it translates the V1 REST calls into PocketBase
 * collection ops AND reproduces every backend computation (sentence splitting,
 * variant alignment, git-style merge segments, word-level diff, compile) in the
 * browser. The one thing the browser can't do — reach the configured LLM — goes
 * through two server verbs (ai.generate / integrations.status) that call the
 * CraftBot bridge. Look and interactions are unchanged.
 *
 * The adapter import is FIRST on purpose — it sets
 * window.__CRAFTBOT_BACKEND_URL__ to a sentinel host at module-eval time,
 * before the component/controller modules (which read that global at their own
 * top level) are evaluated.
 */
import { installApiAdapter } from './services/apiAdapter'
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
import './styles/global.css'

// Patch fetch before any component effect or the controller can fire a request.
installApiAdapter()

// Preserve V1 main.tsx behavior: point instrumentation at the (sentinel)
// backend with auto-capture; the adapter neutralizes those calls.
const backendUrl =
  ((window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ ?? '') +
  '/api'
uiCapture.initialize(backendUrl, true, 2000)

// Initialize the controller (module singleton, exactly as in V1)
const controller = new AppController()

export function App(): React.JSX.Element {
  const themeIdRef = useRef<ThemeId>('craftbot')
  const modeRef = useRef<'dark' | 'light'>('dark')
  const customColorsRef = useRef<CustomColors>({ ...DEFAULT_CUSTOM_COLORS })

  useEffect(() => {
    controller.initialize()

    uiCapture.registerComponent('App', {
      initialized: true,
      componentName: 'App',
    })

    applyThemeToDocument(themeIdRef.current, modeRef.current, customColorsRef.current)

    const onMessage = (e: MessageEvent): void => {
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
    } catch {
      /* not embedded */
    }

    return () => {
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
