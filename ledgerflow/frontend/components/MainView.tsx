import { useState, useEffect, useCallback } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { ActiveView, Settings } from '../types'
import { Button } from './ui'
import { Sidebar } from './Sidebar'
import { DashboardView } from './DashboardView'
import { TransactionsView } from './TransactionsView'
import { AccountsView } from './AccountsView'
import { AccountLedgerView } from './AccountLedgerView'
import { InvoicesView } from './InvoicesView'
import { BillsView } from './BillsView'
import { ContactsView } from './ContactsView'
import { ReportsView } from './ReportsView'
import { SettingsView } from './SettingsView'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [activeView, setActiveView] = useState<ActiveView>('dashboard')
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [transactionInitialTab, setTransactionInitialTab] = useState<string | undefined>(undefined)

  useAgentAware('MainView', { activeView, selectedAccountId })

  useEffect(() => {
    controller.getSettings().then(setSettings).catch(() => {})
  }, [controller])

  const handleNavigate = useCallback((view: ActiveView) => {
    setActiveView(view)
    setTransactionInitialTab(undefined)
    if (view !== 'accountLedger') {
      setSelectedAccountId(null)
    }
  }, [])

  const handleViewLedger = useCallback((accountId: number) => {
    setSelectedAccountId(accountId)
    setActiveView('accountLedger')
  }, [])

  const handleNewTransaction = useCallback((tab?: string) => {
    setTransactionInitialTab(tab || 'income')
    setActiveView('transactions')
  }, [])

  const businessName = settings?.businessName || 'LedgerFlow'

  const renderContent = () => {
    switch (activeView) {
      case 'dashboard':
        return <DashboardView controller={controller} onNavigate={handleNavigate} onNewTransaction={handleNewTransaction} />
      case 'transactions':
        return <TransactionsView controller={controller} initialTab={transactionInitialTab} />
      case 'accounts':
        return <AccountsView controller={controller} onViewLedger={handleViewLedger} />
      case 'accountLedger':
        return selectedAccountId ? (
          <AccountLedgerView controller={controller} accountId={selectedAccountId} onBack={() => handleNavigate('accounts')} />
        ) : null
      case 'invoices':
        return <InvoicesView controller={controller} />
      case 'bills':
        return <BillsView controller={controller} />
      case 'contacts':
        return <ContactsView controller={controller} />
      case 'reports':
        return <ReportsView controller={controller} />
      case 'settings':
        return <SettingsView controller={controller} />
      default:
        return <DashboardView controller={controller} onNavigate={handleNavigate} onNewTransaction={handleNewTransaction} />
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <header
        style={{
          height: 48,
          minHeight: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 var(--space-4)',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-primary)',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              display: 'none',
              background: 'none',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '20px',
              cursor: 'pointer',
              padding: 'var(--space-1)',
            }}
            className="hamburger-btn"
          >
            &#9776;
          </button>
          <span
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-bold)' as any,
              color: 'var(--color-primary)',
              letterSpacing: '-0.5px',
            }}
          >
            {businessName}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button size="sm" onClick={() => handleNewTransaction('income')}>
            + New Transaction
          </Button>
        </div>
      </header>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar - desktop always visible, mobile toggle */}
        <div className="sidebar-desktop">
          <Sidebar
            activeView={activeView}
            onNavigate={handleNavigate}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
        {sidebarOpen && (
          <div
            className="sidebar-mobile"
            style={{
              position: 'fixed',
              top: 48,
              left: 0,
              bottom: 0,
              zIndex: 50,
              width: 200,
              backgroundColor: 'var(--bg-secondary)',
              borderRight: '1px solid var(--border-primary)',
            }}
          >
            <Sidebar
              activeView={activeView}
              onNavigate={handleNavigate}
              isOpen={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        )}

        {/* Content */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-4)',
            backgroundColor: 'var(--bg-primary)',
          }}
        >
          {renderContent()}
        </main>
      </div>

      <style>{`
        .hamburger-btn { display: none !important; }
        .sidebar-mobile { display: none !important; }
        @media (max-width: 768px) {
          .hamburger-btn { display: block !important; }
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile { display: block !important; }
        }
      `}</style>
    </div>
  )
}
