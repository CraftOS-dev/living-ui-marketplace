import { useEffect, useState } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { MainView } from './components/MainView'
import { AppController } from './AppController'
import { uiCapture } from './services/UICapture'
import { AuthProvider, useAuth } from './components/auth/AuthProvider'
import { LoginPage } from './components/auth/LoginPage'
import { RegisterPage } from './components/auth/RegisterPage'

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
