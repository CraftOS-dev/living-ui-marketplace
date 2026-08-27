import React, { useState, useRef } from 'react'
import type { InvoiceReceipt } from '../types'
import { CURRENCY_OPTIONS, ALL_CATEGORIES } from '../types'
import { Modal, Button, Input } from './ui'
import { FileText, Paperclip, X, UploadCloud, CheckCircle2 } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  onAdd: (data: Partial<InvoiceReceipt>) => void
}

export const AddInvoiceModal: React.FC<Props> = ({ isOpen, onClose, onAdd }) => {
  const [vendor, setVendor] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [category, setCategory] = useState('Software & SaaS')
  const [purpose, setPurpose] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [attachedPdf, setAttachedPdf] = useState<{
    name: string
    size: number
    base64?: string
    textPreview?: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      alert('Please select a valid PDF document.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result as string
      setAttachedPdf({
        name: file.name,
        size: file.size,
        base64,
        textPreview: `PDF Invoice Statement extracted from ${file.name} (${(file.size / 1024).toFixed(1)} KB)`
      })

      // Auto-populate vendor or invoice number if empty
      if (!vendor) {
        const cleanName = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ')
        if (/aws|amazon/i.test(cleanName)) setVendor('Amazon Web Services')
        else if (/openai/i.test(cleanName)) setVendor('OpenAI')
        else if (/cursor/i.test(cleanName)) setVendor('Cursor AI')
        else if (/figma/i.test(cleanName)) setVendor('Figma')
        else if (/vercel/i.test(cleanName)) setVendor('Vercel')
        else if (/stripe/i.test(cleanName)) setVendor('Stripe')
        else if (/google/i.test(cleanName)) setVendor('Google Workspace')
      }
      if (!invoiceNumber) {
        const match = file.name.match(/(INV|REC|BILL)[-_]?[0-9A-Z]+/i)
        if (match) setInvoiceNumber(match[0].toUpperCase())
      }
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!vendor || !amount) return

    const newInvPayload: any = {
      vendor,
      amount: parseFloat(amount) || 0,
      currency: currency || 'USD',
      paymentType: 'one_time',
      billingFrequency: 'none',
      category,
      purpose,
      invoiceNumber: invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
      invoiceDate: new Date().toISOString(),
      emailSubject: `Receipt from ${vendor}`,
      hasPdfAttachment: !!attachedPdf,
    }
    if (attachedPdf?.name) newInvPayload.pdfFilename = attachedPdf.name
    if (attachedPdf?.textPreview) newInvPayload.pdfTextPreview = attachedPdf.textPreview
    if (attachedPdf?.base64) newInvPayload.pdfDataBase64 = attachedPdf.base64

    onAdd(newInvPayload)

    setVendor('')
    setAmount('')
    setPurpose('')
    setInvoiceNumber('')
    setAttachedPdf(null)
    onClose()
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Add Receipt or Invoice"
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit}>
            Save Record
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
            Merchant / Vendor Name *
          </label>
          <Input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="e.g. Supabase, Apple, DigitalOcean"
            required
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Amount *
            </label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25.00"
              required
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
              {ALL_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Invoice / Reference Number
            </label>
            <Input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="e.g. INV-99021"
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
            placeholder="e.g. Database compute instance for app backend"
          />
        </div>

        {/* PDF Attachment Upload Dropzone */}
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <Paperclip size={14} color="var(--color-primary)" />
            <strong>Attach PDF Invoice / Receipt</strong> (Optional)
          </label>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".pdf,application/pdf"
            style={{ display: 'none' }}
          />

          {!attachedPdf ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                if (file && fileInputRef.current) {
                  const dataTransfer = new DataTransfer()
                  dataTransfer.items.add(file)
                  fileInputRef.current.files = dataTransfer.files
                  fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
                }
              }}
              style={{
                border: '2px dashed var(--border-primary)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                textAlign: 'center',
                cursor: 'pointer',
                backgroundColor: 'var(--bg-secondary)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
            >
              <UploadCloud size={24} color="var(--color-primary)" style={{ margin: '0 auto 6px auto' }} />
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Click to browse or drag & drop PDF
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Supports standard invoice statements (.pdf up to 25MB)
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    color: '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FileText size={18} />
                </div>
                <div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {attachedPdf.name}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{(attachedPdf.size / 1024).toFixed(1)} KB</span>
                    <span>&bull;</span>
                    <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <CheckCircle2 size={12} /> Ready to attach
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAttachedPdf(null)}
                style={{
                  padding: '4px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: '4px',
                }}
                title="Remove attached PDF"
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
