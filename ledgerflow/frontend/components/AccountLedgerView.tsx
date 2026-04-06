import { useState, useEffect } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { Account, AccountLedgerEntry, AccountBalance } from '../types'
import { Card, Button, Table, EmptyState } from './ui'
import type { TableColumn } from './ui'
import { toast } from 'react-toastify'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface AccountLedgerViewProps {
  controller: AppController
  accountId: number
  onBack: () => void
}

export function AccountLedgerView({ controller, accountId, onBack }: AccountLedgerViewProps) {
  const [account, setAccount] = useState<Account | null>(null)
  const [balance, setBalance] = useState<AccountBalance | null>(null)
  const [entries, setEntries] = useState<AccountLedgerEntry[]>([])
  const [loading, setLoading] = useState(true)

  useAgentAware('AccountLedgerView', { accountId, loading })

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [acct, bal, ledger] = await Promise.all([
          controller.getAccount(accountId),
          controller.getAccountBalance(accountId),
          controller.getAccountLedger(accountId),
        ])
        setAccount(acct)
        setBalance(bal)
        setEntries(ledger)
      } catch {
        toast.error('Failed to load account ledger')
      } finally { setLoading(false) }
    }
    load()
  }, [controller, accountId])

  if (loading) return <EmptyState message="Loading ledger..." />

  const columns: TableColumn<AccountLedgerEntry>[] = [
    { key: 'date', header: 'Date', width: '100px', render: (e) => formatDate(e.date) },
    { key: 'description', header: 'Description' },
    { key: 'reference', header: 'Reference', width: '100px', render: (e) => <span style={{ color: 'var(--text-muted)' }}>{e.reference || '-'}</span> },
    {
      key: 'debit', header: 'Debit', width: '100px', align: 'right',
      render: (e) => e.debit > 0 ? <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{formatMoney(e.debit)}</span> : <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
    {
      key: 'credit', header: 'Credit', width: '100px', align: 'right',
      render: (e) => e.credit > 0 ? <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{formatMoney(e.credit)}</span> : <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
    {
      key: 'runningBalance', header: 'Balance', width: '110px', align: 'right',
      render: (e) => (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 'var(--font-weight-medium)' as any,
          color: e.runningBalance >= 0 ? 'var(--color-success)' : 'var(--color-error)',
        }}>
          {formatMoney(e.runningBalance)}
        </span>
      ),
    },
  ]

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <Button size="sm" variant="ghost" onClick={onBack} style={{ padding: '0 var(--space-2)' }}>
          &larr; Back
        </Button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)' }}>
            {account?.name || 'Account Ledger'}
            {account && <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--font-weight-normal)' as any, marginLeft: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>({account.code})</span>}
          </h2>
        </div>
        {balance && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Current Balance</div>
            <div style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: 'var(--font-weight-bold)' as any,
              color: balance.balance >= 0 ? 'var(--color-success)' : 'var(--color-error)',
              fontFamily: 'var(--font-mono)',
            }}>
              {formatMoney(balance.balance)}
            </div>
          </div>
        )}
      </div>

      {/* Ledger Table */}
      <Card padding="none">
        <div style={{ fontSize: 'var(--font-size-xs)' }}>
          <Table columns={columns} data={entries} emptyMessage="No ledger entries found" rowKey={(e) => e.id} />
        </div>
      </Card>
    </div>
  )
}
