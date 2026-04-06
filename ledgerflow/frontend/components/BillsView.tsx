import { useState, useEffect, useCallback } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { Bill, Contact, Account } from '../types'
import { Card, Button, Input, Select, Textarea, Modal, Table, Badge, EmptyState } from './ui'
import type { TableColumn, SelectOption } from './ui'
import { toast } from 'react-toastify'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function todayStr(): string { return new Date().toISOString().split('T')[0] }
function futureDate(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]
}

const statusBadge: Record<string, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  draft: 'default', received: 'info', paid: 'success', overdue: 'error', void: 'warning',
}

interface BillsViewProps {
  controller: AppController
}

interface LineItem {
  description: string
  quantity: number
  unitPrice: number
}

export function BillsView({ controller }: BillsViewProps) {
  const [bills, setBills] = useState<Bill[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState<Bill | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState<Bill | null>(null)
  const [saving, setSaving] = useState(false)

  // Form
  const [vendorId, setVendorId] = useState('')
  const [issueDate, setIssueDate] = useState(todayStr())
  const [dueDate, setDueDate] = useState(futureDate(30))
  const [taxRate, setTaxRate] = useState('0')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineItem[]>([{ description: '', quantity: 1, unitPrice: 0 }])

  // Payment form
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentAccountId, setPaymentAccountId] = useState('')

  useAgentAware('BillsView', { loading, count: bills.length, statusFilter })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [bs, ctcts, accts] = await Promise.all([
        controller.getBills(statusFilter || undefined),
        controller.getContacts(),
        controller.getAccounts(),
      ])
      setBills(bs)
      setContacts(ctcts)
      setAccounts(accts)
    } catch { toast.error('Failed to load bills') }
    finally { setLoading(false) }
  }, [controller, statusFilter])

  useEffect(() => { loadData() }, [loadData])

  const vendorOptions: SelectOption[] = contacts.filter(c => c.isActive && (c.type === 'vendor' || c.type === 'both')).map(c => ({ value: String(c.id), label: c.name }))
  const assetOptions: SelectOption[] = accounts.filter(a => a.type === 'asset' && a.isActive).map(a => ({ value: String(a.id), label: `${a.code} - ${a.name}` }))

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const taxAmt = subtotal * (parseFloat(taxRate) || 0) / 100
  const total = subtotal + taxAmt

  const resetForm = () => {
    setVendorId(''); setIssueDate(todayStr()); setDueDate(futureDate(30)); setTaxRate('0'); setNotes('')
    setLines([{ description: '', quantity: 1, unitPrice: 0 }])
  }

  const handleSave = async () => {
    if (!vendorId || lines.length === 0 || lines.some(l => !l.description)) {
      toast.error('Vendor and line items are required'); return
    }
    setSaving(true)
    try {
      await controller.createBill({
        vendorId: Number(vendorId),
        issueDate,
        dueDate,
        taxRate: parseFloat(taxRate) || 0,
        notes: notes || undefined,
        lines: lines.map(l => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
      })
      toast.success('Bill created')
      setShowModal(false)
      resetForm()
      loadData()
    } catch (e: any) { toast.error(e.message || 'Failed to create bill') }
    finally { setSaving(false) }
  }

  const handleReceive = async (id: number) => {
    try {
      await controller.receiveBill(id)
      toast.success('Bill received')
      loadData()
    } catch (e: any) { toast.error(e.message || 'Failed to receive bill') }
  }

  const handlePayment = async () => {
    if (!showPaymentModal || !paymentAmount || !paymentAccountId) {
      toast.error('Amount and pay-from account required'); return
    }
    try {
      await controller.recordBillPayment(showPaymentModal.id, {
        amount: parseFloat(paymentAmount),
        payFromAccountId: Number(paymentAccountId),
      })
      toast.success('Payment recorded')
      setShowPaymentModal(null)
      setPaymentAmount(''); setPaymentAccountId('')
      loadData()
    } catch (e: any) { toast.error(e.message || 'Failed to record payment') }
  }

  const handleDelete = async (bill: Bill) => {
    try {
      await controller.deleteBill(bill.id)
      toast.success('Bill deleted')
      setShowDeleteModal(null)
      loadData()
    } catch (e: any) { toast.error(e.message || 'Failed to delete') }
  }

  const addLine = () => setLines([...lines, { description: '', quantity: 1, unitPrice: 0 }])
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx))
  const updateLine = (idx: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lines]
    updated[idx] = { ...updated[idx], [field]: value }
    setLines(updated)
  }

  const columns: TableColumn<Bill>[] = [
    { key: 'billNumber', header: '#', width: '80px', render: (b) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{b.billNumber}</span> },
    { key: 'vendorName', header: 'Vendor' },
    { key: 'issueDate', header: 'Issue Date', width: '95px', render: (b) => formatDate(b.issueDate) },
    { key: 'dueDate', header: 'Due Date', width: '95px', render: (b) => formatDate(b.dueDate) },
    {
      key: 'status', header: 'Status', width: '80px',
      render: (b) => <Badge variant={statusBadge[b.status] || 'default'} size="sm">{b.status}</Badge>,
    },
    { key: 'total', header: 'Total', width: '100px', align: 'right', render: (b) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(b.total)}</span> },
    { key: 'balanceDue', header: 'Balance', width: '100px', align: 'right', render: (b) => <span style={{ fontFamily: 'var(--font-mono)', color: b.balanceDue > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>{formatMoney(b.balanceDue)}</span> },
    {
      key: 'actions', header: '', width: '130px',
      render: (b) => (
        <div style={{ display: 'flex', gap: 'var(--space-1)' }} onClick={e => e.stopPropagation()}>
          {b.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => handleReceive(b.id)} style={{ fontSize: 'var(--font-size-xs)', padding: '0 var(--space-1)' }}>Receive</Button>}
          {b.status === 'received' && <Button size="sm" variant="ghost" onClick={() => { setShowPaymentModal(b); setPaymentAmount(String(b.balanceDue)) }} style={{ fontSize: 'var(--font-size-xs)', padding: '0 var(--space-1)' }}>Pay</Button>}
          {b.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => setShowDeleteModal(b)} style={{ fontSize: 'var(--font-size-xs)', padding: '0 var(--space-1)', color: 'var(--color-error)' }}>Del</Button>}
        </div>
      ),
    },
  ]

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)' }}>Bills</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Select
            options={[{ value: '', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'received', label: 'Received' }, { value: 'paid', label: 'Paid' }, { value: 'overdue', label: 'Overdue' }, { value: 'void', label: 'Void' }]}
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ fontSize: 'var(--font-size-xs)', width: 120 }}
          />
          <Button size="sm" onClick={() => { resetForm(); setShowModal(true) }}>+ New Bill</Button>
        </div>
      </div>

      <Card padding="none">
        {loading ? <EmptyState message="Loading..." /> : (
          <div style={{ fontSize: 'var(--font-size-xs)' }}>
            <Table columns={columns} data={bills} emptyMessage="No bills found" rowKey={(b) => b.id} />
          </div>
        )}
      </Card>

      {/* New Bill Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Bill" size="lg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Select label="Vendor *" options={vendorOptions} value={vendorId} onChange={e => setVendorId(e.target.value)} placeholder="Select vendor" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
            <Input label="Issue Date" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            <Input label="Due Date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            <Input label="Tax Rate (%)" type="number" step="0.01" min="0" value={taxRate} onChange={e => setTaxRate(e.target.value)} />
          </div>
          <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />

          {/* Line Items */}
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>Line Items</div>
            {lines.map((line, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px 90px 30px', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', alignItems: 'end' }}>
                <Input placeholder="Description" value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} />
                <Input placeholder="Qty" type="number" min="1" value={String(line.quantity)} onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                <Input placeholder="Price" type="number" step="0.01" min="0" value={String(line.unitPrice)} onChange={e => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)} />
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', textAlign: 'right', paddingBottom: 8 }}>
                  {formatMoney(line.quantity * line.unitPrice)}
                </div>
                <button onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: '16px', paddingBottom: 8 }}>x</button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={addLine}>+ Add Line</Button>
          </div>

          {/* Totals */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)', borderTop: '1px solid var(--border-primary)', paddingTop: 'var(--space-2)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--font-size-sm)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Subtotal:</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(subtotal)}</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--font-size-sm)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Tax ({taxRate}%):</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(taxAmt)}</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)' as any }}>
              <span>Total:</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(total)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Save as Draft</Button>
          </div>
        </div>
      </Modal>

      {/* Payment Modal */}
      <Modal open={showPaymentModal !== null} onClose={() => setShowPaymentModal(null)} title="Record Payment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowPaymentModal(null)}>Cancel</Button>
            <Button onClick={handlePayment}>Record Payment</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {showPaymentModal && (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              Bill {showPaymentModal.billNumber} - Balance: {formatMoney(showPaymentModal.balanceDue)}
            </div>
          )}
          <Input label="Amount" type="number" step="0.01" min="0" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} />
          <Select label="Pay From Account" options={assetOptions} value={paymentAccountId} onChange={e => setPaymentAccountId(e.target.value)} placeholder="Select account" />
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={showDeleteModal !== null} onClose={() => setShowDeleteModal(null)} title="Delete Bill"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeleteModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => showDeleteModal && handleDelete(showDeleteModal)}>Delete</Button>
          </>
        }
      >
        <p style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}>
          Are you sure you want to delete bill {showDeleteModal?.billNumber}?
        </p>
      </Modal>
    </div>
  )
}
