import React, { useState } from 'react'
import { Modal, Button, Input } from './ui'
import { Info } from 'lucide-react'
import { CURRENCY_OPTIONS, ALL_CATEGORIES } from '../types'

interface AddSubscriptionModalProps {
  isOpen: boolean
  onClose: () => void
  activeGroupId?: number | null
  activeGroupName?: string
  onCreateSubscription: (data: {
    name: string
    vendor?: string
    amount: number
    currency?: string
    billing_frequency?: string
    category?: string
    purpose?: string
    status?: string
    group_id?: number
    next_renewal_date?: string
    auto_renew?: boolean
    icon_name?: string
  }) => Promise<void>
}

const CATEGORIES = ALL_CATEGORIES

export const AddSubscriptionModal: React.FC<AddSubscriptionModalProps> = ({
  isOpen,
  onClose,
  activeGroupId,
  activeGroupName: _activeGroupName,
  onCreateSubscription,
}) => {
  const [name, setName] = useState('')
  const [vendor, setVendor] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [frequency, setFrequency] = useState('monthly')
  const [category, setCategory] = useState('Software & SaaS')
  const [purpose, setPurpose] = useState('')
  const [nextRenewal, setNextRenewal] = useState('')
  const [autoRenew, setAutoRenew] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Please enter a subscription name.')
      return
    }
    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      setError('Please enter a valid positive amount.')
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await onCreateSubscription({
        name: name.trim(),
        vendor: vendor.trim() || name.trim(),
        amount: parsedAmount,
        currency,
        billing_frequency: frequency,
        category,
        purpose: purpose.trim(),
        status: 'active',
        group_id: activeGroupId ? activeGroupId : undefined,
        next_renewal_date: nextRenewal || undefined,
        auto_renew: autoRenew,
        icon_name: 'CreditCard',
      })
      // Reset form
      setName('')
      setVendor('')
      setAmount('')
      setPurpose('')
      setNextRenewal('')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create subscription')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Add Recurring Subscription"
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Adding...' : 'Add Subscription'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {error && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              color: '#ef4444',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Info size={14} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Subscription Name *
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. AWS Compute Cluster"
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Vendor / Service
              </label>
              <Input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="e.g. Amazon Web Services"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Amount *
              </label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Billing Frequency
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="weekly">Weekly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.85rem',
                }}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.85rem',
                }}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Next Renewal Date
              </label>
              <input
                type="date"
                value={nextRenewal}
                onChange={(e) => setNextRenewal(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.85rem',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Purpose / Description
            </label>
            <Input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Details on seats, tier, compute specifications, licenses..."
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
            <input
              type="checkbox"
              id="autoRenewCheck"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <label htmlFor="autoRenewCheck" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Auto-renews automatically at billing cycle
            </label>
          </div>
        </form>
      </div>
    </Modal>
  )
}
