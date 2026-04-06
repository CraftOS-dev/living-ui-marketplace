
import { Sidebar } from './Sidebar'
import type { ViewName, UserProfile, DashboardData } from '../../types'

interface AppLayoutProps {
  activeView: ViewName
  onNavigate: (view: ViewName) => void
  profile: UserProfile | null
  dashboard: DashboardData | null
  children: React.ReactNode
}

export function AppLayout({ activeView, onNavigate, profile, dashboard, children }: AppLayoutProps) {
  return (
    <div className="app-layout">
      <Sidebar
        activeView={activeView}
        onNavigate={onNavigate}
        profile={profile}
        dashboard={dashboard}
      />
      <main className="app-layout-content">
        {children}
      </main>

      <style>{`
        .app-layout {
          display: flex;
          min-height: 100vh;
          background-color: var(--bg-primary);
        }

        .app-layout-content {
          flex: 1;
          min-width: 0;
          padding: var(--space-6);
          overflow-y: auto;
        }

        @media (max-width: 767px) {
          .app-layout-content {
            padding: var(--space-4);
          }
        }
      `}</style>
    </div>
  )
}
