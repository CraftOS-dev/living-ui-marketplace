import React, { useState } from 'react'
import type { Subscription } from '../types'
import { ALL_CATEGORIES } from '../types'
import { Card, Button, Badge, Input } from './ui'
import {
  Plus,
  Calendar,
} from 'lucide-react' 

interface Props {
  subscriptions: Subscription[]
  onUpdateStatus?: (id: number, status: 'active' | 'paused' | 'cancelled') => void
  onDeleteSubscription?: (id: number) => void
  onOpenAddModal: () => void
  activeGroupName?: string
  currencySymbol?: string
}

export const SubscriptionsView: React.FC<Props> = ({
  subscriptions,
  onUpdateStatus,
  onDeleteSubscription,
  onOpenAddModal,
  activeGroupName: _activeGroupName,
  currencySymbol = '$',
}) => {
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const pageSize = 12

  // Calculate MRR and totals
  const activeSubs = subscriptions.filter((s) => s.status === 'active')
  const monthlyBurn = activeSubs.reduce((sum, s) => {
    if (s.billingFrequency === 'monthly') return sum + s.amount
    if (s.billingFrequency === 'yearly') return sum + s.amount / 12.0
    if (s.billingFrequency === 'weekly') return sum + s.amount * 4.33
    if (s.billingFrequency === 'quarterly') return sum + s.amount / 3.0
    return sum + s.amount
  }, 0)

  const annualBurn = monthlyBurn * 12

  const categories = Array.from(
    new Set([...ALL_CATEGORIES, ...subscriptions.map((s) => s.category).filter(Boolean)])
  )

  const filtered = React.useMemo(() => {
    const q = (searchTerm || '').trim().toLowerCase()
    return subscriptions.filter((s) => {
      const matchesCategory = filterCategory === 'all' || s.category === filterCategory
      const matchesStatus = filterStatus === 'all' || s.status === filterStatus
      if (!matchesCategory || !matchesStatus) return false
      if (!q) return true

      const name = (s.name || '').toLowerCase()
      const vendor = (s.vendor || '').toLowerCase()
      const purpose = (s.purpose || '').toLowerCase()
      const category = (s.category || '').toLowerCase()
      const billingFreq = (s.billingFrequency || '').toLowerCase()
      const amountStr = String(s.amount ?? '')

      return (
        name.includes(q) ||
        vendor.includes(q) ||
        purpose.includes(q) ||
        category.includes(q) ||
        billingFreq.includes(q) ||
        amountStr.includes(q)
      )
    })
  }, [subscriptions, searchTerm, filterCategory, filterStatus])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* Standard Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 className="page-header-title">
              Active Subscriptions
            </h2>
            <Badge variant="success" size="sm">
              {currencySymbol}{monthlyBurn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/MO BURN
            </Badge>
          </div>
          <p className="page-header-subtitle">
            Track recurring services and licenses. Annual run rate: <strong>{currencySymbol}{annualBurn.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/yr</strong>
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={onOpenAddModal}>
            Add Subscription
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {/* Search Input */}
          <div style={{ width: '240px' }}>
            <Input
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              placeholder="Search subscriptions, vendors..."
            />
          </div>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value)
              setCurrentPage(1)
            }}
            style={{
              padding: '8px 12px',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.85rem',
            }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Category Filter */}
          <select
            value={filterCategory}
            onChange={(e) => {
              setFilterCategory(e.target.value)
              setCurrentPage(1)
            }}
            style={{
              padding: '8px 12px',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.85rem',
            }}
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Showing <strong style={{ color: 'var(--text-primary)' }}>{filtered.length}</strong> subscriptions
        </div>
      </div>

      {/* Subscriptions Grid / List */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 'var(--space-3)', width: '100%', boxSizing: 'border-box' }}>
        {paginated.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
            No subscriptions found matching your filters.{' '}
            <button
              onClick={onOpenAddModal}
              style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              Add your first subscription &rarr;
            </button>
          </div>
        ) : (
          paginated.map((sub) => {
            const isActive = sub.status === 'active'
            const isPaused = sub.status === 'paused'

            return (
              <Card key={sub.id} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                          {sub.name}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.80rem', color: 'var(--text-muted)' }}>
                        {sub.vendor} &bull; {sub.category}
                      </span>
                    </div>

                    <Badge
                      variant={isActive ? 'success' : isPaused ? 'warning' : 'error'}
                      size="sm"
                    >
                      {sub.status.toUpperCase()}
                    </Badge>
                  </div>

                  {sub.purpose && (
                    <p style={{ margin: '6px 0 12px 0', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {sub.purpose}
                    </p>
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '10px', marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {currencySymbol}{sub.amount.toFixed(2)}
                      <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                        /{sub.billingFrequency === 'monthly' ? 'mo' : sub.billingFrequency === 'yearly' ? 'yr' : sub.billingFrequency}
                      </span>
                    </div>
                    {sub.nextRenewalDate && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <Calendar size={12} /> Renews {new Date(sub.nextRenewalDate).toLocaleDateString()}
                      </div>
                    )}
                  </div>

                  {onUpdateStatus && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {sub.status !== 'active' && (
                        <button
                          type="button"
                          onClick={() => onUpdateStatus(sub.id, 'active')}
                          title="Activate Subscription"
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            borderRadius: '4px',
                            color: '#10b981',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          Activate
                        </button>
                      )}
                      {sub.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => onUpdateStatus(sub.id, 'paused')}
                          title="Pause Subscription"
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            borderRadius: '4px',
                            color: '#f59e0b',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          Pause
                        </button>
                      )}
                      {onDeleteSubscription && (
                        <button
                          type="button"
                          onClick={() => onDeleteSubscription(sub.id)}
                          title="Remove Subscription"
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '4px',
                            color: '#ef4444',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            )
          })
        )}
      </div>

      {/* Pagination Controls */}
      {filtered.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            marginTop: '12px',
            padding: '14px 18px',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-primary)',
            fontSize: '0.84rem',
            color: 'var(--text-secondary)',
          }}
        >
          <div>
            Showing <strong style={{ color: 'var(--text-primary)' }}>{Math.min((currentPage - 1) * pageSize + 1, filtered.length)}</strong> to{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{Math.min(currentPage * pageSize, filtered.length)}</strong> of{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{filtered.length}</strong> subscriptions
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
    </div>
  )
}
