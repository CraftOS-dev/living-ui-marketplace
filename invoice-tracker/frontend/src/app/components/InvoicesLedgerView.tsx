import React from 'react'
import type { InvoiceReceipt } from '../types'
import { ALL_CATEGORIES } from '../types'
import { Card, Button, Badge, Input } from './ui'
import {
  Paperclip,
  Download,
  Trash2,
  Eye,
  Plus,
  UploadCloud
} from 'lucide-react'

interface Props {
  invoices: InvoiceReceipt[]
  searchQuery: string
  selectedCategory: string
  selectedPaymentType?: string
  allCategories?: string[]
  onSearchChange: (q: string) => void
  onCategoryChange: (cat: string) => void
  onPaymentTypeChange?: (type: string) => void
  onSelectInvoice: (inv: InvoiceReceipt) => void
  onDeleteInvoice: (id: string | number) => void
  onOpenAddModal: () => void
  onUpdateInvoice?: (id: string | number, data: Partial<InvoiceReceipt>) => Promise<void>
  currencySymbol?: string
}

const DEFAULT_CATEGORIES = ALL_CATEGORIES

export const InvoicesLedgerView: React.FC<Props> = ({
  invoices,
  searchQuery,
  selectedCategory,
  selectedPaymentType: _selectedPaymentType,
  allCategories,
  onSearchChange,
  onCategoryChange,
  onPaymentTypeChange: _onPaymentTypeChange,
  onSelectInvoice,
  onDeleteInvoice,
  onOpenAddModal,
  onUpdateInvoice,
  currencySymbol = '$',
}) => {
  const [activeUploadId, setActiveUploadId] = React.useState<string | number | null>(null)
  const rowFileInputRef = React.useRef<HTMLInputElement>(null)
  const [currentPage, setCurrentPage] = React.useState<number>(1)
  const pageSize = 12

  // Always retain and display all clean, valid available categories
  const categories = React.useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES)
    if (allCategories && Array.isArray(allCategories)) {
      allCategories.forEach((c) => {
        if (c && typeof c === 'string' && isNaN(Number(c)) && c.trim().length > 0) {
          set.add(c.trim())
        }
      })
    }
    invoices.forEach((i) => {
      if (i.category && typeof i.category === 'string' && isNaN(Number(i.category)) && i.category.trim().length > 0) {
        set.add(i.category.trim())
      }
    })
    return Array.from(set).sort()
  }, [allCategories, invoices])

  const filtered = React.useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase()
    return invoices.filter((i) => {
      const matchesCategory = selectedCategory === 'all' || i.category === selectedCategory
      if (!matchesCategory) return false
      if (!q) return true

      const vendor = (i.vendor || '').toLowerCase()
      const purpose = (i.purpose || '').toLowerCase()
      const invoiceNumber = (i.invoiceNumber || '').toLowerCase()
      const category = (i.category || '').toLowerCase()
      const amountStr = String(i.amount ?? '')
      const currency = (i.currency || '').toLowerCase()

      return (
        vendor.includes(q) ||
        purpose.includes(q) ||
        invoiceNumber.includes(q) ||
        category.includes(q) ||
        amountStr.includes(q) ||
        currency.includes(q)
      )
    })
  }, [invoices, searchQuery, selectedCategory])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const totalAmount = filtered.reduce((sum, i) => sum + i.amount, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* Standard Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 className="page-header-title">
              Invoices & Receipts Ledger
            </h2>
            <Badge variant="primary" size="sm">
              {filtered.length} STATEMENTS
            </Badge>
          </div>
          <p className="page-header-subtitle">
            All your receipts, bills, and one-time expenses in one place.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={onOpenAddModal}>
            Add Receipt
          </Button>
        </div>
      </div>

      {/* Top Filter and Action Bar */}
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
          <div style={{ width: '260px' }}>
            <Input
              value={searchQuery}
              onChange={(e) => {
                onSearchChange(e.target.value)
                setCurrentPage(1)
              }}
              placeholder="Search vendor, invoice #..."
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => {
              onCategoryChange(e.target.value)
              setCurrentPage(1)
            }}
            style={{
              padding: '8px 12px',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.84rem',
            }}
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
            Showing <strong>{filtered.length}</strong> items &bull; Total: <strong style={{ color: 'var(--text-primary)' }}>{currencySymbol}{totalAmount.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      {/* Invoices Table */}
      <Card padding="none">
        {filtered.length === 0 ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No receipts or invoices found matching criteria.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-primary)',
                    textAlign: 'left',
                    color: 'var(--text-muted)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  <th style={{ padding: '12px 16px' }}>Vendor & Purpose</th>
                  <th style={{ padding: '12px 16px' }}>Date</th>
                  <th style={{ padding: '12px 16px' }}>Category</th>
                  <th style={{ padding: '12px 16px' }}>Attachment</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((inv, idx) => {
                  return (
                    <tr
                      key={inv.id}
                      style={{
                        borderBottom: idx < paginated.length - 1 ? '1px solid var(--border-secondary)' : 'none',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      {/* Vendor & Purpose */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: 'var(--bg-secondary)',
                              border: '1px solid var(--border-primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              color: 'var(--color-primary)',
                              fontSize: '0.84rem',
                            }}
                          >
                            {inv.vendor.charAt(0)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.90rem' }}>{inv.vendor}</div>
                            <div style={{ fontSize: '0.80rem', color: 'var(--text-muted)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {inv.purpose || inv.emailSubject}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Date */}
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontSize: '0.84rem', whiteSpace: 'nowrap' }}>
                        {new Date(inv.invoiceDate || Date.now()).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Category */}
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                        {inv.category}
                      </td>

                      {/* PDF Attachment indicator & Direct Attach Button */}
                      <td style={{ padding: '12px 16px' }}>
                        {inv.hasPdfAttachment ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              onClick={() => onSelectInvoice(inv)}
                              title={inv.pdfFilename || 'Attached PDF Document'}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.74rem',
                                color: '#10b981',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                border: '1px solid rgba(16, 185, 129, 0.25)',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              <Paperclip size={12} /> {inv.pdfFilename ? (inv.pdfFilename.length > 14 ? inv.pdfFilename.substring(0, 12) + '...' : inv.pdfFilename) : 'PDF Attached'}
                            </span>
                            <a
                              href={inv.pdfDataBase64 || `/api/invoices/${inv.id}/download-pdf`}
                              download={inv.pdfFilename || `${inv.vendor}_Invoice_${inv.id}.pdf`}
                              title="Download attached PDF statement"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '4px 6px',
                                borderRadius: '4px',
                                backgroundColor: 'var(--bg-secondary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-secondary)',
                                textDecoration: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              <Download size={12} />
                            </a>
                          </div>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<UploadCloud size={12} />}
                            onClick={() => {
                              setActiveUploadId(inv.id)
                              rowFileInputRef.current?.click()
                            }}
                            style={{ fontSize: '0.74rem', height: '26px', padding: '0 8px' }}
                            title="Attach PDF invoice receipt"
                          >
                            Attach PDF
                          </Button>
                        )}
                      </td>

                      {/* Amount */}
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                          {currencySymbol}{inv.amount.toFixed(2)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<Eye size={13} />}
                            onClick={() => onSelectInvoice(inv)}
                            title="Inspect details & email source"
                          >
                            Inspect
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 size={13} />}
                            onClick={() => {
                              if (window.confirm(`Delete receipt from ${inv.vendor}?`)) {
                                onDeleteInvoice(inv.id)
                              }
                            }}
                            title="Delete receipt"
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {filtered.length > 0 && (
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
              Showing <strong style={{ color: 'var(--text-primary)' }}>{Math.min((currentPage - 1) * pageSize + 1, filtered.length)}</strong> to{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{Math.min(currentPage * pageSize, filtered.length)}</strong> of{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{filtered.length}</strong> invoices
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
      {/* Hidden File Input for Row-Level PDF Attachment */}
      <input
        type="file"
        ref={rowFileInputRef}
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file || activeUploadId === null || !onUpdateInvoice) return
          const reader = new FileReader()
          reader.onload = async () => {
            const base64 = reader.result as string
            try {
              await onUpdateInvoice(activeUploadId, {
                hasPdfAttachment: true,
                pdfFilename: file.name,
                pdfDataBase64: base64,
                pdfTextPreview: `Attached PDF: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`
              })
            } catch (err) {
              console.error('Failed to attach PDF:', err)
            } finally {
              setActiveUploadId(null)
              if (rowFileInputRef.current) rowFileInputRef.current.value = ''
            }
          }
          reader.readAsDataURL(file)
        }}
      />
    </div>
  )
}
