import { useEffect, useState } from 'react'

import { MainView } from './components/MainView'
import { uiCapture } from './services/UICapture'
import { AuthProvider, useAuth } from './components/auth/AuthProvider'
import { LoginPage } from './components/auth/LoginPage'
import { RegisterPage } from './components/auth/RegisterPage'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { Skeleton } from './components/ui/skeleton'

function AuthGate() {
  const { isAuthenticated, loading } = useAuth()
  const [page, setPage] = useState<'login' | 'register'>('login')

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-3 p-6">
          <Skeleton className="h-10 w-10 rounded-lg mx-auto" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3 mx-auto" />
        </div>
      </div>
    )
  }
  if (!isAuthenticated) {
    return page === 'login' ? (
      <LoginPage onSwitchToRegister={() => setPage('register')} />
    ) : (
      <RegisterPage onSwitchToLogin={() => setPage('login')} />
    )
  }
  return <MainView />
}

function App() {
  useEffect(() => {
    // Agent awareness: expose app presence to the UI-snapshot capture
    uiCapture.registerComponent('App', { initialized: true, componentName: 'App' })
    return () => uiCapture.unregisterComponent('App')
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full">
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  )
}

export default App
