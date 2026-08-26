import React, { useEffect, useState } from 'react'
import { AppController, ControllerState } from '../AppController'
import { DashboardView } from './DashboardView'
import { SubscriptionsView } from './SubscriptionsView'
import { InvoicesLedgerView } from './InvoicesLedgerView'
import { ActivityFeedView } from './ActivityFeedView'
import { YearlyHistoryView } from './YearlyHistoryView'
import { MonthlyCostsView } from './MonthlyCostsView'
import { InvoiceDetailModal } from './InvoiceDetailModal'
import { AddInvoiceModal } from './AddInvoiceModal'
import { AddSubscriptionModal } from './AddSubscriptionModal'
import { AddIngestionModal } from './AddIngestionModal'
import { GroupManageModal } from './GroupManageModal'
import { Button } from './ui'
import { getCurrencySymbol, CURRENCY_OPTIONS } from '../types'
import {
  Receipt,
  CreditCard,
  LayoutDashboard,
  Activity,
  History,
  Calendar,
  Plus,
  Layers,
} from 'lucide-react' 

interface MainViewProps {
  appController: AppController
}

export const MainView: React.FC<MainViewProps> = ({ appController }) => {
  const [state, setState] = useState<ControllerState>(appController.getState())

  useEffect(() => {
    const unsubscribe = appController.subscribe((newState) => {
      setState(newState)
    })
    return () => unsubscribe()
  }, [appController])

  if (!state.initialized && state.loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          gap: 'var(--space-4)',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '3px solid var(--border-primary)',
            borderTopColor: 'var(--color-primary)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Loading Invoice & Subscription Workspace...
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        padding: 'var(--space-4)',
        width: '100%',
        maxWidth: '1280px',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Application Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 'var(--space-3)',
          borderBottom: '1px solid var(--border-primary)',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
        }}
      >
        {/* Logo & Title */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Invoice & Subscription Tracker
          </h1>
        </div>

        {/* Group Selector, Currency Selector & Top Manual Entry Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {/* Workspace Group Selector Dropdown */}
          {(() => {
            const activeGroup = state.groups.find((g) => g.id === state.activeGroupId) || state.groups[0]
            const activeColor = activeGroup?.color || '#FF9900'
            const activeCurrency = activeGroup?.currency || 'USD'
            const activeSymbol = getCurrencySymbol(activeCurrency)

            return (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius-md)',
                    padding: '2px 10px',
                    gap: '8px',
                  }}
                >
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: activeColor,
                      display: 'inline-block',
                      flexShrink: 0,
                      boxShadow: `0 0 6px ${activeColor}`,
                    }}
                    title={`Workspace Color: ${activeColor}`}
                  />
                  <select
                    value={state.activeGroupId || ''}
                    onChange={(e) => appController.setActiveGroup(Number(e.target.value) || null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      padding: '6px 2px',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {state.groups.map((g) => (
                      <option key={g.id} value={g.id} style={{ backgroundColor: '#18181B', color: '#fff' }}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quick Currency Selector Dropdown */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius-md)',
                    padding: '2px 10px',
                    gap: '6px',
                  }}
                  title="Change Workspace Currency Type"
                >
                  <span style={{ fontSize: '0.90rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                    {activeSymbol}
                  </span>
                  <select
                    value={activeCurrency}
                    onChange={(e) => {
                      const newCurr = e.target.value
                      if (activeGroup) {
                        appController.updateGroup(activeGroup.id, { currency: newCurr })
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      padding: '6px 2px',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c.code} value={c.code} style={{ backgroundColor: '#18181B', color: '#fff' }}>
                        {c.code} ({c.symbol})
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )
          })()}

          <Button
            variant="secondary"
            size="sm"
            icon={<Layers size={13} />}
            onClick={() => appController.setAddGroupModalOpen(true)}
            style={{ fontSize: '0.78rem', padding: '0 10px', height: '32px' }}
          >
            Groups
          </Button>

          {/* Quick Manual Input Action Buttons */}
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => appController.setAddSubscriptionModalOpen(true)}
            style={{ fontSize: '0.78rem', padding: '0 10px', height: '32px', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }}
          >
            Subscription
          </Button>

          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => appController.setAddInvoiceModalOpen(true)}
            style={{ fontSize: '0.78rem', padding: '0 12px', height: '32px' }}
          >
            Add Invoice
          </Button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          borderBottom: '1px solid var(--border-primary)',
          paddingBottom: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
          overflowX: 'auto',
        }}
      >
        <Button
          variant={state.currentTab === 'dashboard' ? 'primary' : 'secondary'}
          size="sm"
          icon={<LayoutDashboard size={15} />}
          onClick={() => appController.setCurrentTab('dashboard')}
          style={{ fontSize: '0.84rem' }}
        >
          Overview Dashboard
        </Button>

        <Button
          variant={state.currentTab === 'subscriptions' ? 'primary' : 'secondary'}
          size="sm"
          icon={<CreditCard size={15} />}
          onClick={() => appController.setCurrentTab('subscriptions')}
          style={{ fontSize: '0.84rem' }}
        >
          Active Subscriptions ({state.subscriptions.filter((s) => s.status === 'active').length})
        </Button>

        <Button
          variant={state.currentTab === 'invoices' ? 'primary' : 'secondary'}
          size="sm"
          icon={<Receipt size={15} />}
          onClick={() => appController.setCurrentTab('invoices')}
          style={{ fontSize: '0.84rem' }}
        >
          Invoices & Receipts ({state.invoices.length})
        </Button>

        <Button
          variant={state.currentTab === 'feed' ? 'primary' : 'secondary'}
          size="sm"
          icon={<Activity size={15} />}
          onClick={() => appController.setCurrentTab('feed')}
          style={{ fontSize: '0.84rem' }}
        >
          Live Ingestion Feed
        </Button>

        <Button
          variant={state.currentTab === 'monthly-costs' ? 'primary' : 'secondary'}
          size="sm"
          icon={<Calendar size={15} />}
          onClick={() => appController.setCurrentTab('monthly-costs')}
          style={{ fontSize: '0.84rem' }}
        >
          Monthly Costs
        </Button>

        <Button
          variant={state.currentTab === 'yearly-history' ? 'primary' : 'secondary'}
          size="sm"
          icon={<History size={15} />}
          onClick={() => appController.setCurrentTab('yearly-history')}
          style={{ fontSize: '0.84rem' }}
        >
          Multi-Year History
        </Button>
      </nav>

      {/* Main Viewport Content */}
      <main style={{ flex: 1, width: '100%', maxWidth: '100%', boxSizing: 'border-box', minWidth: 0 }}>
        {(() => {
          const activeGroup = state.groups.find((g) => g.id === state.activeGroupId) || state.groups[0]
          const activeCurrency = activeGroup?.currency || 'USD'
          const currencySymbol = getCurrencySymbol(activeCurrency)

          return (
            <>
              {state.currentTab === 'dashboard' && (
                <DashboardView
                  stats={state.stats}
                  invoices={state.invoices}
                  subscriptions={state.subscriptions}
                  activities={state.activities}
                  onSelectInvoice={(inv) => appController.setSelectedInvoice(inv)}
                  onOpenSyncModal={() => appController.setAddSubscriptionModalOpen(true)}
                  onNavigateTab={(tab) => appController.setCurrentTab(tab)}
                  onSimulateQuick={(preset) => appController.simulateIncomingBill(preset)}
                  livePulseActive={state.livePulseActive}
                  currencySymbol={currencySymbol}
                />
              )}

              {state.currentTab === 'monthly-costs' && (
                <MonthlyCostsView
                  invoices={state.invoices}
                  subscriptions={state.subscriptions}
                  onSelectInvoice={(inv) => appController.setSelectedInvoice(inv)}
                  onOpenAddModal={() => appController.setAddInvoiceModalOpen(true)}
                  onNavigateTab={(tab) => appController.setCurrentTab(tab)}
                  activeGroupName={state.activeGroupName}
                  currencySymbol={currencySymbol}
                />
              )}

              {state.currentTab === 'subscriptions' && (
                <SubscriptionsView
                  subscriptions={state.subscriptions}
                  onUpdateStatus={(id, status) => appController.updateSubscriptionStatus(id, status)}
                  onDeleteSubscription={(id) => appController.deleteSubscription(id)}
                  onOpenAddModal={() => appController.setAddSubscriptionModalOpen(true)}
                  activeGroupName={state.activeGroupName}
                  currencySymbol={currencySymbol}
                />
              )}

              {state.currentTab === 'invoices' && (
                <InvoicesLedgerView
                  invoices={state.invoices}
                  searchQuery={state.searchQuery}
                  selectedCategory={state.selectedCategory}
                  selectedPaymentType={state.selectedPaymentType}
                  allCategories={state.allCategories}
                  onSearchChange={(q) => appController.setSearchQuery(q)}
                  onCategoryChange={(c) => appController.setSelectedCategory(c)}
                  onPaymentTypeChange={(pt) => appController.setSelectedPaymentType(pt)}
                  onSelectInvoice={(inv) => appController.setSelectedInvoice(inv)}
                  onDeleteInvoice={(id) => appController.deleteInvoice(id)}
                  onOpenAddModal={() => appController.setAddInvoiceModalOpen(true)}
                  currencySymbol={currencySymbol}
                />
              )}

              {state.currentTab === 'yearly-history' && (
                <YearlyHistoryView
                  invoices={state.invoices}
                  subscriptions={state.subscriptions}
                  onSelectInvoice={(inv) => appController.setSelectedInvoice(inv)}
                  onNavigateTab={(tab) => appController.setCurrentTab(tab)}
                  activeAccountId={state.activeGroupId}
                  currencySymbol={currencySymbol}
                />
              )}

              {state.currentTab === 'feed' && (
                <ActivityFeedView
                  activities={state.activities}
                  onSync={() => appController.triggerMailboxSync()}
                  onOpenAddModal={() => appController.setAddIngestionModalOpen(true)}
                  activeGroupName={state.activeGroupName}
                  currencySymbol={currencySymbol}
                />
              )}

              {/* Modals for Direct User Input */}
              <InvoiceDetailModal
                invoice={state.selectedInvoice}
                onClose={() => appController.setSelectedInvoice(null)}
                onDelete={(id) => appController.deleteInvoice(id)}
                onUpdateInvoice={(id, data) => appController.updateInvoice(id, data)}
                currencySymbol={currencySymbol}
              />
            </>
          )
        })()}
      </main>

      <AddInvoiceModal
        isOpen={state.isAddInvoiceModalOpen}
        onClose={() => appController.setAddInvoiceModalOpen(false)}
        onAdd={(data) => appController.createManualInvoice(data)}
      />

      <AddSubscriptionModal
        isOpen={state.isAddSubscriptionModalOpen}
        onClose={() => appController.setAddSubscriptionModalOpen(false)}
        activeGroupId={state.activeGroupId}
        activeGroupName={state.activeGroupName}
        onCreateSubscription={(data) => appController.createManualSubscription(data)}
      />

      <AddIngestionModal
        isOpen={state.isAddIngestionModalOpen}
        onClose={() => appController.setAddIngestionModalOpen(false)}
        activeGroupId={state.activeGroupId}
        activeGroupName={state.activeGroupName}
        onCreateEvent={(data) => appController.createManualIngestionEvent(data)}
      />

      <GroupManageModal
        isOpen={state.isAddGroupModalOpen}
        onClose={() => appController.setAddGroupModalOpen(false)}
        groups={state.groups}
        activeGroupId={state.activeGroupId}
        onSelectGroup={(id) => appController.setActiveGroup(id)}
        onCreateGroup={(data) => appController.createGroup(data)}
        onUpdateGroup={(id, data) => appController.updateGroup(id, data)}
        onDeleteGroup={(id) => appController.deleteGroup(id)}
      />
    </div>
  )
}
