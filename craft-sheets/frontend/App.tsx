import { useEffect, useMemo } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { MainView } from './components/MainView'
import { AppController } from './AppController'
import { uiCapture } from './services/UICapture'

function App() {
  // One controller instance for the app lifetime.
  const controller = useMemo(() => new AppController(), [])

  useEffect(() => {
    uiCapture.registerComponent('App', { componentName: 'App', initialized: true })
    return () => uiCapture.unregisterComponent('App')
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
