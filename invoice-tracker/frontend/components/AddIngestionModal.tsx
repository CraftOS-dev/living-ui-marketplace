import React, { useState } from 'react'
import { Modal, Button, Input } from './ui'
import { Sparkles, Zap } from 'lucide-react'
import { CURRENCY_OPTIONS } from '../types'

interface Props {
  isOpen: boolean
  onClose: () => void
  activeGroupId?: number | null
  activeGroupName?: string
  onCreateEvent: (data: {
    event_type: string
    title: string
    description?: string
    amount?: number
    currency?: string
    vendor?: string
    group_id?: number
  }) => Promise<void>
}

const EVENT_PRESETS = [
  {
    type: 'invoice_detected',
    title: 'Invoice Detected: OpenAI API Tokens',
    vendor: 'OpenAI',
    amount: '120.00',
    desc: 'Parsed monthly API token statement with 2 GPT-4o keys',
  },
  {
    type: 'subscription_renewed',
    title: 'Renewal Processed: Cursor AI Pro',
    vendor: 'Cursor AI',
    amount: '20.00',
    desc: 'Automatic monthly developer seat renewal recorded',
  },
  {
    type: 'invoice_detected',
    title: 'Cloud Statement: AWS EC2 & RDS',
    vendor: 'AWS',
    amount: '3700.71',
    desc: 'Ingested production infrastructure billing breakdown',
  },
  {
    type: 'payment_processed',
    title: 'Receipt Captured: Figma Design Team',
    vendor: 'Figma',
    amount: '45.00',
    desc: 'Receipt verified for 3 Figma editor licenses',
  },
]

export const AddIngestionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  activeGroupId,
  activeGroupName,
  onCreateEvent,
}) => {
  const [eventType, setEventType] = useState('invoice_detected')
  const [title, setTitle] = useState('')
  const [vendor, setVendor] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApplyPreset = (p: typeof EVENT_PRESETS[0]) => {
    setEventType(p.type)
    setTitle(p.title)
    setVendor(p.vendor)
    setAmount(p.amount)
    setDescription(p.desc)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Please provide an event title.')
      return
    }

    const parsedAmount = amount.trim() ? parseFloat(amount) : undefined
    if (parsedAmount !== undefined && (isNaN(parsedAmount) || parsedAmount < 0)) {
      setError('Please provide a valid positive amount.')
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await onCreateEvent({
        event_type: eventType,
        title: title.trim(),
        vendor: vendor.trim() || undefined,
        amount: parsedAmount,
        currency,
        description: description.trim() || undefined,
        group_id: activeGroupId || undefined,
      })
      // Reset form
      setTitle('')
      setVendor('')
      setAmount('')
      setDescription('')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to log ingestion event')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Log Live Ingestion / Audit Event"
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Logging Event...' : 'Record Ingestion Event'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {/* Workspace Indicator */}
        {activeGroupName && (
          <div
            style={{
              padding: '6px 10px',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.80rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Zap size={14} color="var(--color-primary)" />
            Target Workspace: <strong style={{ color: 'var(--text-primary)' }}>{activeGroupName}</strong>
          </div>
        )}

        {/* Quick Auto-Fill Presets */}
        <div>
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginBottom: '6px',
            }}
          >
            <Sparkles size={12} color="var(--color-primary)" /> Quick Auto-Fill Presets
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {EVENT_PRESETS.map((p) => (
              <button
                key={p.title}
                type="button"
                onClick={() => handleApplyPreset(p)}
                style={{
                  padding: '4px 10px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.76rem',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {p.vendor} (${p.amount})
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              color: '#ef4444',
              fontSize: '0.82rem',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Event Type & Vendor */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Event Category / Type *
              </label>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
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
                <option value="invoice_detected">Invoice Detected (Receipt)</option>
                <option value="subscription_renewed">Subscription Renewed</option>
                <option value="payment_processed">Payment Processed</option>
                <option value="contract_updated">Contract / Plan Updated</option>
                <option value="manual_audit">Manual Audit Log</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Vendor / Service Name
              </label>
              <Input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="e.g. AWS, OpenAI, GitHub"
              />
            </div>
          </div>

          {/* Event Title */}
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Event Title / Header *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Ingested AWS Production Receipt"
              required
            />
          </div>

          {/* Amount and Currency */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Amount ($ USD, optional)
              </label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
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

          {/* Description */}
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Ingestion Details / Extraction Summary
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Scanned receipt attachment, parsed line items & compute bandwidth"
            />
          </div>
        </form>
      </div>
    </Modal>
  )
}
