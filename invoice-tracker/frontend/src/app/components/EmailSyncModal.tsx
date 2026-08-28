import React, { useState } from 'react'
import type { EmailAccount } from '../types'
import { Modal, Button, Badge, Input } from './ui'
import {
  Mail,
  RefreshCw,
  Plus,
  Trash2,
  Inbox,
  } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  emailAccount: EmailAccount | null
  emailAccounts: EmailAccount[]
  onSyncAll: () => void
  onSyncAccount: (id: string | number) => void
  onAddAccount: (email: string, provider: string) => Promise<boolean>
  onRemoveAccount: (id: string | number) => Promise<boolean>
  onClearDemoData?: () => void
}

export const EmailSyncModal: React.FC<Props> = ({
  isOpen,
  onClose,
  emailAccount,
  emailAccounts = [],
  onSyncAll,
  onSyncAccount,
  onAddAccount,
  onRemoveAccount,
  onClearDemoData,
}) => {
  // Add email form state
  const [newEmail, setNewEmail] = useState('')
  const [newProvider, setNewProvider] = useState('Gmail')
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const effectiveAccounts = emailAccounts.length > 0 ? emailAccounts : emailAccount ? [emailAccount] : []

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError(null)
    const trimmed = newEmail.trim()
    if (!trimmed || !trimmed.includes('@')) {
      setAddError('Please enter a valid email address.')
      return
    }

    setIsAdding(true)
    const success = await onAddAccount(trimmed, newProvider)
    setIsAdding(false)
    if (success) {
      setNewEmail('')
    }
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Connected Mailboxes & Email Management"
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {effectiveAccounts.length} mailbox{effectiveAccounts.length === 1 ? '' : 'es'} connected & monitored
          </span>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Header with Sync All and Clear Demo actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Active Email Accounts
            </h4>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Scans your connected accounts for receipts, bills, and active recurring subscriptions
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {onClearDemoData && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={13} />}
                onClick={() => {
                  if (window.confirm('Clear all default sample demo records? Only your own connected mailboxes will remain.')) {
                    onClearDemoData()
                  }
                }}
                title="Remove sample/demo invoices and subscriptions"
              >
                Clear Demo Data
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} />}
              onClick={() => onSyncAll()}
            >
              Scan All Inboxes
            </Button>
          </div>
        </div>

        {/* List of Connected Accounts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {effectiveAccounts.length === 0 ? (
            <div
              style={{
                padding: 'var(--space-6)',
                textAlign: 'center',
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <Mail size={32} color="var(--text-muted)" style={{ margin: '0 auto 8px auto' }} />
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                No email accounts connected yet
              </p>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Add your email address below to start tracking your invoices and subscriptions.
              </p>
            </div>
          ) : (
            effectiveAccounts.map((acc) => (
              <div
                key={acc.id}
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      color: 'var(--color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Inbox size={20} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                        {acc.emailAddress}
                      </span>
                      <Badge variant="success">Active &bull; {acc.provider || 'IMAP'}</Badge>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {acc.totalScannedCount || 0} scanned &bull; {acc.totalInvoicesFound || 0} invoices extracted &bull; Synced {acc.lastSyncedAt ? new Date(acc.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'recently'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw size={13} />}
                    onClick={() => onSyncAccount(acc.id)}
                  >
                    Sync
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 size={13} />}
                    onClick={() => onRemoveAccount(acc.id)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Connect a New Email Address Box */}
        <div
          style={{
            marginTop: 'var(--space-2)',
            padding: 'var(--space-4)',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-3)' }}>
            <Plus size={18} color="var(--color-primary)" />
            <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Connect Another Email Address
            </h4>
          </div>

          <form onSubmit={handleAddEmail} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Email Address
                </label>
                <Input
                  type="email"
                  placeholder="e.g. work@startup.io, finance@team.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Mailbox Provider
                </label>
                <select
                  value={newProvider}
                  onChange={(e) => setNewProvider(e.target.value)}
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 12px',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    outline: 'none',
                  }}
                >
                  <option value="Gmail">Google / Gmail</option>
                  <option value="Google Workspace">Google Workspace</option>
                  <option value="Microsoft Outlook">Microsoft Outlook / Office 365</option>
                  <option value="Apple iCloud">Apple iCloud Mail</option>
                  <option value="Custom IMAP">Custom IMAP / Domain</option>
                </select>
              </div>

              <Button
                type="submit"
                variant="primary"
                disabled={isAdding || !newEmail.trim()}
                icon={<Plus size={14} />}
              >
                {isAdding ? 'Connecting...' : 'Connect Email'}
              </Button>
            </div>

            {addError && (
              <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '2px' }}>
                {addError}
              </div>
            )}
          </form>
        </div>
      </div>
    </Modal>
  )
}
