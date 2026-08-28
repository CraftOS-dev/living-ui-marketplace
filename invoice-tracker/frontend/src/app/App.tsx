import { useEffect } from 'react'
import { MainView } from './components/MainView'
import { AppController } from './AppController'
import './styles.css'

const controller = new AppController()

export function App() {
  useEffect(() => {
    controller.initialize()
  }, [])

  return (
    <div className="app" style={{ minHeight: '100vh', backgroundColor: '#0D0F12', color: '#F3F4F6' }}>
      <MainView appController={controller} />
    </div>
  )
}

export default App
