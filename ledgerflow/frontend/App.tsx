import { useEffect } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { MainView } from './components/MainView'
import { AppController } from './AppController'
import { uiCapture } from './services/UICapture'

const controller = new AppController()

function App() {
  useEffect(() => {
    controller.initialize()

    uiCapture.registerComponent('App', {
      initialized: true,
      componentName: 'LedgerFlow',
    })

    return () => {
      controller.cleanup()
      uiCapture.unregisterComponent('App')
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
        theme="dark"
      />
    </div>
  )
}

export default App
