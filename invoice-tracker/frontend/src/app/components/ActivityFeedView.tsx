import React, { useState } from 'react'
import type { ActivityEvent } from '../types'
import { Card, Button, Badge } from './ui'
import { Activity, Bell, FileText, RefreshCw } from 'lucide-react'

interface Props {
  activities: ActivityEvent[]
  onSync: () => void
  onOpenAddModal?: () => void
  activeGroupName?: string
  currencySymbol?: string
}

export const ActivityFeedView: React.FC<Props> = ({ activities, onSync, onOpenAddModal: _onOpenAddModal, activeGroupName: _activeGroupName, currencySymbol = '$' }) => {
  const [currentPage, setCurrentPage] = useState<number>(1)
  const pageSize = 10

  const totalPages = Math.max(1, Math.ceil(activities.length / pageSize))
  const paginated = activities.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 className="page-header-title">
              Live Ingestion & Processing Feed
            </h2>
            <Badge variant="primary" size="sm">
              LIVE
            </Badge>
          </div>
          <p className="page-header-subtitle">
            Recent bill scans, incoming invoices, and renewals.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={onSync}>
            Refresh Feed
          </Button>
        </div>
      </div>

      <Card>
        {activities.length === 0 ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No activity recorded in this workspace yet. Invoices, receipts, and scans will appear here automatically.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {paginated.map((act) => {
              const isInvoice = act.eventType === 'invoice_detected'
              const isRenewal = act.eventType === 'subscription_renewed'

              return (
                <div
                  key={act.id}
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        backgroundColor: isInvoice
                          ? 'rgba(16, 185, 129, 0.15)'
                          : isRenewal
                          ? 'rgba(239, 68, 68, 0.15)'
                          : 'rgba(59, 130, 246, 0.15)',
                        color: isInvoice ? '#10b981' : isRenewal ? '#ef4444' : '#3b82f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isInvoice ? <FileText size={18} /> : isRenewal ? <Bell size={18} /> : <Activity size={18} />}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.90rem' }}>
                          {act.title}
                        </span>
                        {act.vendor && (
                          <Badge variant="primary" size="sm">{act.vendor}</Badge>
                        )}
                      </div>
                      <div style={{ fontSize: '0.80rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {act.description}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', minWidth: '100px' }}>
                    {act.amount ? (
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>
                        {currencySymbol}{act.amount.toFixed(2)}
                      </div>
                    ) : null}
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {new Date(act.createdAt || act.created || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination Footer */}
        {activities.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '16px',
              marginTop: '20px',
              padding: '14px 18px',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-primary)',
              fontSize: '0.84rem',
              color: 'var(--text-secondary)',
            }}
          >
            <div>
              Showing <strong style={{ color: 'var(--text-primary)' }}>{Math.min((currentPage - 1) * pageSize + 1, activities.length)}</strong> to{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{Math.min(currentPage * pageSize, activities.length)}</strong> of{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{activities.length}</strong> activity events
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{ padding: '6px 14px' }}
              >
                Previous
              </Button>

              <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-muted)', padding: '0 8px' }}>
                Page {currentPage} of {totalPages}
              </span>

              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{ padding: '6px 14px' }}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
