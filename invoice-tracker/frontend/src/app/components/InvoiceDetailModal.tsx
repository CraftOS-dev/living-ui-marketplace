import React, { useRef, useState } from 'react'
import type { InvoiceReceipt } from '../types'
import { Modal, Button } from './ui'
import {
  FileText,
  Calendar,
  Tag,
  ShieldCheck,
  Paperclip,
  Trash2,
  Download,
  Eye,
  CheckCircle2
} from 'lucide-react'

interface Props {
  invoice: InvoiceReceipt | null
  onClose: () => void
  onDelete: (id: string | number) => void
  onUpdateInvoice?: (id: string | number, data: Partial<InvoiceReceipt>) => Promise<void>
  currencySymbol?: string
}

export const InvoiceDetailModal: React.FC<Props> = ({ invoice, onClose, onDelete, onUpdateInvoice, currencySymbol = '$' }) => {
  const [showFullPdfPreview, setShowFullPdfPreview] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!invoice) return null

  const hasPdf = Boolean(invoice.hasPdfAttachment || invoice.pdfFilename)
  const pdfName = invoice.pdfFilename || `${invoice.vendor.replace(/\s+/g, '_')}_Invoice_${invoice.invoiceNumber || invoice.id}.pdf`

  const handleDownloadPdf = () => {
    if (invoice.pdfDataBase64 && invoice.pdfDataBase64.length > 50) {
      const link = document.createElement('a')
      link.href = invoice.pdfDataBase64
      link.download = pdfName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } else {
      const link = document.createElement('a')
      link.href = `/api/invoices/${invoice.id}/download-pdf`
      link.download = pdfName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const handleAttachPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !onUpdateInvoice) return

    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result as string
      try {
        await onUpdateInvoice(invoice.id, {
          hasPdfAttachment: true,
          pdfFilename: file.name,
          pdfDataBase64: base64,
          pdfTextPreview: `Attached PDF document ${file.name} (${(file.size / 1024).toFixed(1)} KB)`
        })
      } catch (err) {
        console.error('Failed to attach PDF:', err)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <Modal
      open={!!invoice}
      onClose={onClose}
      title={`Invoice #${invoice.invoiceNumber || invoice.id}`}
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={15} />}
            onClick={() => {
              if (window.confirm(`Are you sure you want to delete this invoice from ${invoice.vendor}?`)) {
                onDelete(invoice.id)
                onClose()
              }
            }}
          >
            Delete Record
          </Button>

          <div style={{ display: 'flex', gap: '8px' }}>
            {hasPdf && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={14} />}
                onClick={handleDownloadPdf}
              >
                Download PDF
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close Inspector
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Top Header Card */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: 'var(--space-4)',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                {invoice.vendor}
              </h2>
              {invoice.isVerified && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.75rem',
                    color: '#10b981',
                    fontWeight: 600,
                  }}
                >
                  <ShieldCheck size={14} /> Verified ({Math.round((invoice.confidenceScore || 0.95) * 100)}%)
                </span>
              )}
            </div>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {invoice.purpose || 'Classified commercial expense'}
            </p>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-primary)' }}>
              {currencySymbol}{invoice.amount.toFixed(2)} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-muted)' }}>{invoice.currency}</span>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {new Date(invoice.invoiceDate || Date.now()).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
        </div>

        {/* Metadata Details Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
          <div
            style={{
              padding: 'var(--space-3)',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>
              <Tag size={13} /> Expense Category
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
              {invoice.category}
            </div>
          </div>

          <div
            style={{
              padding: 'var(--space-3)',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>
              <Calendar size={13} /> Invoice Date
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
              {new Date(invoice.invoiceDate || Date.now()).toLocaleDateString()}
            </div>
          </div>

          <div
            style={{
              padding: 'var(--space-3)',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>
              <FileText size={13} /> Reference ID
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem', fontFamily: 'monospace' }}>
              {invoice.invoiceNumber || `INV-${invoice.id}`}
            </div>
          </div>
        </div>

        {/* PDF Attachment Section */}
        <div>
          <h4 style={{ margin: '0 0 var(--space-2) 0', fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Attached PDF Document & Statement
          </h4>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleAttachPdf}
            accept=".pdf,application/pdf"
            style={{ display: 'none' }}
          />

          {hasPdf ? (
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: 'rgba(239, 68, 68, 0.05)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    color: '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FileText size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.92rem' }}>
                    {pdfName}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>PDF Statement Document</span>
                    <span>&bull;</span>
                    <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <CheckCircle2 size={12} /> Attached
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Eye size={13} />}
                  onClick={() => setShowFullPdfPreview(!showFullPdfPreview)}
                  style={{ fontSize: '0.78rem', height: '30px' }}
                >
                  {showFullPdfPreview ? 'Hide Text' : 'View Text Preview'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Download size={13} />}
                  onClick={handleDownloadPdf}
                  style={{ fontSize: '0.78rem', height: '30px' }}
                >
                  Download PDF
                </Button>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                No PDF document attached to this invoice record yet.
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<Paperclip size={13} />}
                onClick={() => fileInputRef.current?.click()}
                style={{ fontSize: '0.78rem' }}
              >
                Attach PDF File
              </Button>
            </div>
          )}

          {showFullPdfPreview && (
            <pre
              style={{
                marginTop: '10px',
                padding: 'var(--space-3)',
                backgroundColor: 'var(--bg-primary)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                maxHeight: '140px',
                overflowY: 'auto',
                border: '1px solid var(--border-secondary)',
              }}
            >
              {invoice.pdfTextPreview || `--- PDF Extracted Text ---\nVendor: ${invoice.vendor}\nAmount: ${currencySymbol}${invoice.amount.toFixed(2)}\nDate: ${invoice.invoiceDate}\nReference: ${invoice.invoiceNumber || invoice.id}\nStatus: Verified`}
            </pre>
          )}
        </div>
      </div>
    </Modal>
  )
}
