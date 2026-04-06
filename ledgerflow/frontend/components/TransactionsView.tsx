import { useState, useEffect, useCallback } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { JournalEntry, Account, Category, Contact, TransactionFilters } from '../types'
import { Card, Button, Input, Select, Table, Badge, Modal, Tabs, TabList, Tab, TabPanel, EmptyState } from './ui'
import type { TableColumn, SelectOption } from './ui'
import { toast } from 'react-toastify'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

interface TransactionsViewProps {
  controller: AppController
  initialTab?: string
}

export function TransactionsView({ controller, initialTab }: TransactionsViewProps) {
  const [transactions, setTransactions] = useState<JournalEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(!!initialTab)
  const [showDeleteModal, setShowDeleteModal] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // Filters
  const [filterFromDate, setFilterFromDate] = useState('')
  const [filterToDate, setFilterToDate] = useState('')
  const [filterAccountId, setFilterAccountId] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterSearch, setFilterSearch] = useState('')

  // Pagination
  const [page, setPage] = useState(0)
  const pageSize = 25

  // Form state - Income
  const [incDate, setIncDate] = useState(todayStr())
  const [incAmount, setIncAmount] = useState('')
  const [incDepositAccountId, setIncDepositAccountId] = useState('')
  const [incRevenueAccountId, setIncRevenueAccountId] = useState('')
  const [incDescription, setIncDescription] = useState('')
  const [incContactId, setIncContactId] = useState('')
  const [incCategoryId, setIncCategoryId] = useState('')
  const [incReference, setIncReference] = useState('')

  // Form state - Expense
  const [expDate, setExpDate] = useState(todayStr())
  const [expAmount, setExpAmount] = useState('')
  const [expPayFromAccountId, setExpPayFromAccountId] = useState('')
  const [expExpenseAccountId, setExpExpenseAccountId] = useState('')
  const [expDescription, setExpDescription] = useState('')
  const [expContactId, setExpContactId] = useState('')
  const [expCategoryId, setExpCategoryId] = useState('')
  const [expReference, setExpReference] = useState('')

  // Form state - Transfer
  const [trfDate, setTrfDate] = useState(todayStr())
  const [trfAmount, setTrfAmount] = useState('')
  const [trfFromAccountId, setTrfFromAccountId] = useState('')
  const [trfToAccountId, setTrfToAccountId] = useState('')
  const [trfDescription, setTrfDescription] = useState('')
  const [trfReference, setTrfReference] = useState('')

  useAgentAware('TransactionsView', { loading, count: transactions.length, page })

  const assetAccounts = accounts.filter(a => a.type === 'asset' && a.isActive)
  const revenueAccounts = accounts.filter(a => a.type === 'revenue' && a.isActive)
  const expenseAccounts = accounts.filter(a => a.type === 'expense' && a.isActive)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const filters: TransactionFilters = { limit: pageSize, offset: page * pageSize }
      if (filterFromDate) filters.fromDate = filterFromDate
      if (filterToDate) filters.toDate = filterToDate
      if (filterAccountId) filters.accountId = Number(filterAccountId)
      if (filterCategoryId) filters.categoryId = Number(filterCategoryId)
      if (filterType) filters.type = filterType
      if (filterSearch) filters.search = filterSearch

      const [txns, accts, cats, ctcts] = await Promise.all([
        controller.getTransactions(filters),
        controller.getAccounts(),
        controller.getCategories(),
        controller.getContacts(),
      ])
      setTransactions(txns)
      setAccounts(accts)
      setCategories(cats)
      setContacts(ctcts)
    } catch {
      toast.error('Failed to load transactions')
    } finally {
      setLoading(false)
    }
  }, [controller, page, filterFromDate, filterToDate, filterAccountId, filterCategoryId, filterType, filterSearch])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (initialTab) setShowModal(true)
  }, [initialTab])

  const resetForms = () => {
    setIncDate(todayStr()); setIncAmount(''); setIncDepositAccountId(''); setIncRevenueAccountId(''); setIncDescription(''); setIncContactId(''); setIncCategoryId(''); setIncReference('')
    setExpDate(todayStr()); setExpAmount(''); setExpPayFromAccountId(''); setExpExpenseAccountId(''); setExpDescription(''); setExpContactId(''); setExpCategoryId(''); setExpReference('')
    setTrfDate(todayStr()); setTrfAmount(''); setTrfFromAccountId(''); setTrfToAccountId(''); setTrfDescription(''); setTrfReference('')
  }

  const handleSaveIncome = async () => {
    if (!incAmount || !incDepositAccountId || !incRevenueAccountId || !incDescription) {
      toast.error('Please fill required fields'); return
    }
    setSaving(true)
    try {
      await controller.recordIncome({
        date: incDate,
        amount: parseFloat(incAmount),
        depositAccountId: Number(incDepositAccountId),
        revenueAccountId: Number(incRevenueAccountId),
        description: incDescription,
        contactId: incContactId ? Number(incContactId) : undefined,
        categoryId: incCategoryId ? Number(incCategoryId) : undefined,
        reference: incReference || undefined,
      })
      toast.success('Income recorded')
      setShowModal(false)
      resetForms()
      loadData()
    } catch (e: any) {
      toast.error(e.message || 'Failed to record income')
    } finally { setSaving(false) }
  }

  const handleSaveExpense = async () => {
    if (!expAmount || !expPayFromAccountId || !expExpenseAccountId || !expDescription) {
      toast.error('Please fill required fields'); return
    }
    setSaving(true)
    try {
      await controller.recordExpense({
        date: expDate,
        amount: parseFloat(expAmount),
        payFromAccountId: Number(expPayFromAccountId),
        expenseAccountId: Number(expExpenseAccountId),
        description: expDescription,
        contactId: expContactId ? Number(expContactId) : undefined,
        categoryId: expCategoryId ? Number(expCategoryId) : undefined,
        reference: expReference || undefined,
      })
      toast.success('Expense recorded')
      setShowModal(false)
      resetForms()
      loadData()
    } catch (e: any) {
      toast.error(e.message || 'Failed to record expense')
    } finally { setSaving(false) }
  }

  const handleSaveTransfer = async () => {
    if (!trfAmount || !trfFromAccountId || !trfToAccountId || !trfDescription) {
      toast.error('Please fill required fields'); return
    }
    setSaving(true)
    try {
      await controller.recordTransfer({
        date: trfDate,
        amount: parseFloat(trfAmount),
        fromAccountId: Number(trfFromAccountId),
        toAccountId: Number(trfToAccountId),
        description: trfDescription,
        reference: trfReference || undefined,
      })
      toast.success('Transfer recorded')
      setShowModal(false)
      resetForms()
      loadData()
    } catch (e: any) {
      toast.error(e.message || 'Failed to record transfer')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    try {
      await controller.deleteTransaction(id)
      toast.success('Transaction deleted')
      setShowDeleteModal(null)
      loadData()
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete')
    }
  }

  const accountOptions: SelectOption[] = accounts.filter(a => a.isActive).map(a => ({ value: String(a.id), label: `${a.code} - ${a.name}` }))
  const categoryOptions: SelectOption[] = categories.filter(c => c.isActive).map(c => ({ value: String(c.id), label: c.name }))
  const contactOptions: SelectOption[] = contacts.filter(c => c.isActive).map(c => ({ value: String(c.id), label: c.name }))
  const assetOptions: SelectOption[] = assetAccounts.map(a => ({ value: String(a.id), label: `${a.code} - ${a.name}` }))
  const revenueOptions: SelectOption[] = revenueAccounts.map(a => ({ value: String(a.id), label: `${a.code} - ${a.name}` }))
  const expenseOptions: SelectOption[] = expenseAccounts.map(a => ({ value: String(a.id), label: `${a.code} - ${a.name}` }))

  const columns: TableColumn<JournalEntry>[] = [
    { key: 'date', header: 'Date', width: '95px', render: (t) => formatDate(t.date) },
    { key: 'description', header: 'Description' },
    {
      key: 'type', header: 'Type', width: '85px',
      render: (t) => <Badge variant={t.type === 'income' ? 'success' : t.type === 'expense' ? 'error' : 'info'} size="sm">{t.type}</Badge>,
    },
    { key: 'contactName', header: 'Contact', width: '110px', render: (t) => <span style={{ color: 'var(--text-secondary)' }}>{t.contactName || '-'}</span> },
    { key: 'categoryName', header: 'Category', width: '100px', render: (t) => <span style={{ color: 'var(--text-secondary)' }}>{t.categoryName || '-'}</span> },
    {
      key: 'totalAmount', header: 'Amount', width: '110px', align: 'right',
      render: (t) => <span style={{ fontWeight: 'var(--font-weight-medium)' as any, color: t.type === 'income' ? 'var(--color-success)' : t.type === 'expense' ? 'var(--color-error)' : 'var(--text-primary)' }}>{formatMoney(t.totalAmount)}</span>,
    },
    {
      key: 'actions', header: '', width: '50px',
      render: (t) => (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setShowDeleteModal(t.id) }}
          style={{ color: 'var(--color-error)', padding: '0 var(--space-1)' }}>Del</Button>
      ),
    },
  ]

  const formGap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)' }}>Transactions</h2>
        <Button size="sm" onClick={() => { resetForms(); setShowModal(true) }}>+ New Transaction</Button>
      </div>

      {/* Filters */}
      <Card padding="sm" style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 130 }}>
            <Input label="From" type="date" value={filterFromDate} onChange={e => { setFilterFromDate(e.target.value); setPage(0) }} style={{ fontSize: 'var(--font-size-xs)' }} />
          </div>
          <div style={{ minWidth: 130 }}>
            <Input label="To" type="date" value={filterToDate} onChange={e => { setFilterToDate(e.target.value); setPage(0) }} style={{ fontSize: 'var(--font-size-xs)' }} />
          </div>
          <div style={{ minWidth: 140 }}>
            <Select label="Type" options={[{ value: '', label: 'All' }, { value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }, { value: 'transfer', label: 'Transfer' }]}
              value={filterType} onChange={e => { setFilterType(e.target.value); setPage(0) }} style={{ fontSize: 'var(--font-size-xs)' }} />
          </div>
          <div style={{ minWidth: 160 }}>
            <Select label="Account" options={[{ value: '', label: 'All Accounts' }, ...accountOptions]}
              value={filterAccountId} onChange={e => { setFilterAccountId(e.target.value); setPage(0) }} style={{ fontSize: 'var(--font-size-xs)' }} />
          </div>
          <div style={{ minWidth: 140 }}>
            <Select label="Category" options={[{ value: '', label: 'All Categories' }, ...categoryOptions]}
              value={filterCategoryId} onChange={e => { setFilterCategoryId(e.target.value); setPage(0) }} style={{ fontSize: 'var(--font-size-xs)' }} />
          </div>
          <div style={{ minWidth: 150, flex: 1 }}>
            <Input label="Search" placeholder="Search..." value={filterSearch} onChange={e => { setFilterSearch(e.target.value); setPage(0) }} style={{ fontSize: 'var(--font-size-xs)' }} />
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card padding="none">
        {loading ? <EmptyState message="Loading..." /> : (
          <>
            <div style={{ fontSize: 'var(--font-size-xs)' }}>
              <Table columns={columns} data={transactions} emptyMessage="No transactions found" rowKey={(t) => t.id} />
            </div>
            {transactions.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--border-primary)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Page {page + 1}</span>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                  <Button size="sm" variant="secondary" disabled={transactions.length < pageSize} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* New Transaction Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Transaction" size="lg">
        <Tabs defaultTab={initialTab || 'income'}>
          <TabList>
            <Tab id="income">Income</Tab>
            <Tab id="expense">Expense</Tab>
            <Tab id="transfer">Transfer</Tab>
          </TabList>

          <TabPanel id="income">
            <div style={formGap}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <Input label="Date *" type="date" value={incDate} onChange={e => setIncDate(e.target.value)} />
                <Input label="Amount ($) *" type="number" step="0.01" min="0" value={incAmount} onChange={e => setIncAmount(e.target.value)} placeholder="0.00" />
              </div>
              <Select label="Deposit To (Asset Account) *" options={assetOptions} value={incDepositAccountId} onChange={e => setIncDepositAccountId(e.target.value)} placeholder="Select account" />
              <Select label="Revenue Account *" options={revenueOptions} value={incRevenueAccountId} onChange={e => setIncRevenueAccountId(e.target.value)} placeholder="Select account" />
              <Input label="Description *" value={incDescription} onChange={e => setIncDescription(e.target.value)} placeholder="Payment received..." />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <Select label="Contact" options={[{ value: '', label: 'None' }, ...contactOptions]} value={incContactId} onChange={e => setIncContactId(e.target.value)} />
                <Select label="Category" options={[{ value: '', label: 'None' }, ...categoryOptions]} value={incCategoryId} onChange={e => setIncCategoryId(e.target.value)} />
              </div>
              <Input label="Reference" value={incReference} onChange={e => setIncReference(e.target.value)} placeholder="INV-001, Check #..." />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button onClick={handleSaveIncome} loading={saving}>Save Income</Button>
              </div>
            </div>
          </TabPanel>

          <TabPanel id="expense">
            <div style={formGap}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <Input label="Date *" type="date" value={expDate} onChange={e => setExpDate(e.target.value)} />
                <Input label="Amount ($) *" type="number" step="0.01" min="0" value={expAmount} onChange={e => setExpAmount(e.target.value)} placeholder="0.00" />
              </div>
              <Select label="Pay From (Asset Account) *" options={assetOptions} value={expPayFromAccountId} onChange={e => setExpPayFromAccountId(e.target.value)} placeholder="Select account" />
              <Select label="Expense Account *" options={expenseOptions} value={expExpenseAccountId} onChange={e => setExpExpenseAccountId(e.target.value)} placeholder="Select account" />
              <Input label="Description *" value={expDescription} onChange={e => setExpDescription(e.target.value)} placeholder="Office supplies, rent..." />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <Select label="Contact" options={[{ value: '', label: 'None' }, ...contactOptions]} value={expContactId} onChange={e => setExpContactId(e.target.value)} />
                <Select label="Category" options={[{ value: '', label: 'None' }, ...categoryOptions]} value={expCategoryId} onChange={e => setExpCategoryId(e.target.value)} />
              </div>
              <Input label="Reference" value={expReference} onChange={e => setExpReference(e.target.value)} placeholder="Receipt #, PO #..." />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button onClick={handleSaveExpense} loading={saving}>Save Expense</Button>
              </div>
            </div>
          </TabPanel>

          <TabPanel id="transfer">
            <div style={formGap}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <Input label="Date *" type="date" value={trfDate} onChange={e => setTrfDate(e.target.value)} />
                <Input label="Amount ($) *" type="number" step="0.01" min="0" value={trfAmount} onChange={e => setTrfAmount(e.target.value)} placeholder="0.00" />
              </div>
              <Select label="From Account *" options={assetOptions} value={trfFromAccountId} onChange={e => setTrfFromAccountId(e.target.value)} placeholder="Select account" />
              <Select label="To Account *" options={assetOptions} value={trfToAccountId} onChange={e => setTrfToAccountId(e.target.value)} placeholder="Select account" />
              <Input label="Description *" value={trfDescription} onChange={e => setTrfDescription(e.target.value)} placeholder="Transfer between accounts..." />
              <Input label="Reference" value={trfReference} onChange={e => setTrfReference(e.target.value)} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button onClick={handleSaveTransfer} loading={saving}>Save Transfer</Button>
              </div>
            </div>
          </TabPanel>
        </Tabs>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={showDeleteModal !== null} onClose={() => setShowDeleteModal(null)} title="Delete Transaction"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeleteModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => showDeleteModal && handleDelete(showDeleteModal)}>Delete</Button>
          </>
        }
      >
        <p style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}>
          Are you sure you want to delete this transaction? This will reverse all journal entries.
        </p>
      </Modal>
    </div>
  )
}
