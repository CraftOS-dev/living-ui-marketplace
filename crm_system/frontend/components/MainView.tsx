import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { AppState } from '../types'

import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { DashboardPage } from './pages/DashboardPage'
import { ContactsPage } from './pages/ContactsPage'
import { CompaniesPage } from './pages/CompaniesPage'
import { DealsPage } from './pages/DealsPage'
import { ActivitiesPage } from './pages/ActivitiesPage'
import { CalendarPage } from './pages/CalendarPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { CampaignsPage } from './pages/CampaignsPage'
import { FormsPage } from './pages/FormsPage'
import { ReportsPage } from './pages/ReportsPage'
import { ImportExportPage } from './pages/ImportExportPage'
import { SettingsPage } from './pages/SettingsPage'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [state, setState] = useState<AppState>(controller.getState())

  useEffect(() => {
    const unsubscribe = controller.subscribe((newState) => {
      setState(newState)
    })
    return unsubscribe
  }, [controller])

  useEffect(() => {
    controller.initialize()
    return () => controller.cleanup()
  }, [controller])

  const handleNavigate = (view: string) => {
    controller.navigateTo(view)
  }

  const handleToggleSidebar = () => {
    controller.setState({ sidebarCollapsed: !state.sidebarCollapsed })
  }

  const handleSearch = (query: string) => {
    controller.setState({ searchQuery: query }, false)
  }

  const handleSearchSubmit = () => {
    if (state.searchQuery.trim()) {
      controller.globalSearch(state.searchQuery.trim())
    }
  }


  const renderCurrentView = () => {
    const pageProps = { controller, state }

    switch (state.currentView) {
      case 'dashboard':
        return <DashboardPage {...pageProps} />
      case 'contacts':
        return <ContactsPage {...pageProps} />
      case 'companies':
        return <CompaniesPage {...pageProps} />
      case 'deals':
        return <DealsPage {...pageProps} />
      case 'activities':
        return <ActivitiesPage {...pageProps} />
      case 'calendar':
        return <CalendarPage {...pageProps} />
      case 'templates':
        return <TemplatesPage {...pageProps} />
      case 'campaigns':
        return <CampaignsPage {...pageProps} />
      case 'forms':
        return <FormsPage {...pageProps} />
      case 'reports':
        return <ReportsPage {...pageProps} />
      case 'import-export':
        return <ImportExportPage {...pageProps} />
      case 'settings':
        return <SettingsPage {...pageProps} />
      default:
        return <DashboardPage {...pageProps} />
    }
  }

  const counts: Record<string, number> = {}
  if (state.dashboardSummary) {
    counts['contacts'] = state.dashboardSummary.totalContacts
    counts['companies'] = state.dashboardSummary.totalCompanies
    counts['deals'] = state.dashboardSummary.openDeals
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <Sidebar
        collapsed={state.sidebarCollapsed}
        currentView={state.currentView}
        onNavigate={handleNavigate}
        onToggle={handleToggleSidebar}
        counts={counts}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <TopBar
          searchQuery={state.searchQuery}
          onSearch={handleSearch}
          onSearchSubmit={handleSearchSubmit}
        />

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 24,
            backgroundColor: 'var(--bg-primary)',
          }}
        >
          {state.loading && !state.initialized ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--text-secondary)',
                fontSize: 'var(--font-size-lg)',
              }}
            >
              Loading...
            </div>
          ) : (
            renderCurrentView()
          )}
        </div>
      </div>

    </div>
  )
}
