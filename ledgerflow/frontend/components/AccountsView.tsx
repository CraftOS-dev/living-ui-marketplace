import { useState, useEffect, useCallback } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { Account } from '../types'
import { Card, Button, Input, Select, Textarea, Modal, EmptyState } from './ui'
import type { SelectOption } from './ui'
import { toast } from 'react-toastify'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

const accountTypes: SelectOption[] = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'expense', label: 'Expense' },
]

const typeLabels: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
}

interface AccountsViewProps {
  controller: AppController
  onViewLedger: (accountId: number) => void
}

export function AccountsView({ controller, onViewLedger }: AccountsViewProps) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [showDeactivateModal, setShowDeactivateModal] = useState<Account | null>(null)
  const [saving, setSaving] = useState(false)

  // Form
  const [formCode, setFormCode] = useState('')
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState('')
  const [formSubType, setFormSubType] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formOpeningBalance, setFormOpeningBalance] = useState('')

  useAgentAware('AccountsView', { loading, count: accounts.length })

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await controller.getAccounts()
      setAccounts(data)
    } catch {
      toast.error('Failed to load accounts')
    } finally { setLoading(false) }
  }, [controller])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const resetForm = () => {
    setFormCode(''); setFormName(''); setFormType(''); setFormSubType(''); setFormDescription(''); setFormOpeningBalance('')
  }

  const openCreateModal = () => {
    setEditingAccount(null)
    resetForm()
    setShowModal(true)
  }

  const openEditModal = (account: Account) => {
    setEditingAccount(account)
    setFormCode(account.code)
    setFormName(account.name)
    setFormType(account.type)
    setFormSubType(account.subType || '')
    setFormDescription(account.description || '')
    setFormOpeningBalance(String(account.openingBalance || 0))
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!formCode || !formName || !formType) {
      toast.error('Code, Name, and Type are required'); return
    }
    setSaving(true)
    try {
      if (editingAccount) {
        await controller.updateAccount(editingAccount.id, {
          code: formCode,
          name: formName,
          type: formType,
          subType: formSubType || undefined,
          description: formDescription || undefined,
        })
        toast.success('Account updated')
      } else {
        await controller.createAccount({
          code: formCode,
          name: formName,
          type: formType,
          subType: formSubType || undefined,
          description: formDescription || undefined,
          openingBalance: formOpeningBalance ? parseFloat(formOpeningBalance) : undefined,
        })
        toast.success('Account created')
      }
      setShowModal(false)
      resetForm()
      loadAccounts()
    } catch (e: any) {
      toast.error(e.message || 'Failed to save account')
    } finally { setSaving(false) }
  }

  const handleDeactivate = async (account: Account) => {
    try {
      await controller.updateAccount(account.id, { isActive: false })
      toast.success('Account deactivated')
      setShowDeactivateModal(null)
      loadAccounts()
    } catch (e: any) {
      toast.error(e.message || 'Failed to deactivate')
    }
  }

  if (loading) return <EmptyState message="Loading accounts..." />

  // Group by type
  const grouped: Record<string, Account[]> = {}
  const typeOrder = ['asset', 'liability', 'equity', 'revenue', 'expense']
  typeOrder.forEach(t => { grouped[t] = [] })
  accounts.forEach(a => {
    if (!grouped[a.type]) grouped[a.type] = []
    grouped[a.type].push(a)
  })

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)' }}>Chart of Accounts</h2>
        <Button size="sm" onClick={openCreateModal}>+ New Account</Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState message="No accounts yet" action={<Button onClick={openCreateModal}>Create Account</Button>} />
      ) : (
        <Card padding="none">
          {typeOrder.map(type => {
            const typeAccounts = grouped[type] || []
            if (typeAccounts.length === 0) return null
            return (
              <div key={type}>
                {/* Section Header */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: 'var(--space-2) var(--space-3)',
                  backgroundColor: 'var(--bg-tertiary)',
                  borderBottom: '1px solid var(--border-primary)',
                }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {typeLabels[type] || type}
                  </span>
                </div>
                {/* Rows */}
                {typeAccounts.map(account => (
                  <div
                    key={account.id}
                    onClick={() => onViewLedger(account.id)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '80px 1fr 120px 100px 110px',
                      alignItems: 'center',
                      padding: 'var(--space-2) var(--space-3)',
                      borderBottom: '1px solid var(--border-primary)',
                      fontSize: 'var(--font-size-xs)',
                      cursor: 'pointer',
                      transition: 'var(--transition-fast)',
                      opacity: account.isActive ? 1 : 0.5,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{account.code}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{account.name}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{account.subType || '-'}</span>
                    <span style={{
                      textAlign: 'right',
                      fontWeight: 'var(--font-weight-medium)' as any,
                      color: account.openingBalance >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      {formatMoney(account.openingBalance || 0)}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-1)' }} onClick={e => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" onClick={() => openEditModal(account)} style={{ padding: '0 var(--space-1)', fontSize: 'var(--font-size-xs)' }}>Edit</Button>
                      {account.isActive && (
                        <Button size="sm" variant="ghost" onClick={() => setShowDeactivateModal(account)} style={{ padding: '0 var(--space-1)', fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' }}>Deactivate</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingAccount ? 'Edit Account' : 'New Account'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>{editingAccount ? 'Update' : 'Create'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--space-3)' }}>
            <Input label="Code *" value={formCode} onChange={e => setFormCode(e.target.value)} placeholder="1000" />
            <Input label="Name *" value={formName} onChange={e => setFormName(e.target.value)} placeholder="Cash" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <Select label="Type *" options={accountTypes} value={formType} onChange={e => setFormType(e.target.value)} placeholder="Select type" />
            <Input label="Sub-Type" value={formSubType} onChange={e => setFormSubType(e.target.value)} placeholder="e.g., Current Asset" />
          </div>
          <Textarea label="Description" value={formDescription} onChange={e => setFormDescription(e.target.value)} rows={2} />
          {!editingAccount && (
            <Input label="Opening Balance" type="number" step="0.01" value={formOpeningBalance} onChange={e => setFormOpeningBalance(e.target.value)} placeholder="0.00" />
          )}
        </div>
      </Modal>

      {/* Deactivate Confirmation */}
      <Modal open={showDeactivateModal !== null} onClose={() => setShowDeactivateModal(null)} title="Deactivate Account"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeactivateModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => showDeactivateModal && handleDeactivate(showDeactivateModal)}>Deactivate</Button>
          </>
        }
      >
        <p style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}>
          Are you sure you want to deactivate account "{showDeactivateModal?.name}"? It will no longer appear in dropdown selections.
        </p>
      </Modal>
    </div>
  )
}
