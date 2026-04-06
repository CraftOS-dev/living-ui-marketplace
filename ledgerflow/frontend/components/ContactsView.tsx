import { useState, useEffect, useCallback } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { Contact } from '../types'
import { Card, Button, Input, Select, Textarea, Modal, Table, Badge, EmptyState } from './ui'
import type { TableColumn, SelectOption } from './ui'
import { toast } from 'react-toastify'

const contactTypes: SelectOption[] = [
  { value: 'customer', label: 'Customer' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'both', label: 'Both' },
]

const typeBadge: Record<string, 'success' | 'info' | 'primary'> = {
  customer: 'success', vendor: 'info', both: 'primary',
}

interface ContactsViewProps {
  controller: AppController
}

export function ContactsView({ controller }: ContactsViewProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [showDeactivateModal, setShowDeactivateModal] = useState<Contact | null>(null)
  const [saving, setSaving] = useState(false)

  // Form
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState('customer')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [formTaxId, setFormTaxId] = useState('')
  const [formNotes, setFormNotes] = useState('')

  useAgentAware('ContactsView', { loading, count: contacts.length })

  const loadContacts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await controller.getContacts()
      setContacts(data)
    } catch { toast.error('Failed to load contacts') }
    finally { setLoading(false) }
  }, [controller])

  useEffect(() => { loadContacts() }, [loadContacts])

  const filteredContacts = typeFilter
    ? contacts.filter(c => c.type === typeFilter || (typeFilter !== 'both' && c.type === 'both'))
    : contacts

  const resetForm = () => {
    setFormName(''); setFormType('customer'); setFormEmail(''); setFormPhone(''); setFormAddress(''); setFormTaxId(''); setFormNotes('')
  }

  const openCreate = () => {
    setEditingContact(null); resetForm(); setShowModal(true)
  }

  const openEdit = (contact: Contact) => {
    setEditingContact(contact)
    setFormName(contact.name); setFormType(contact.type); setFormEmail(contact.email || ''); setFormPhone(contact.phone || '')
    setFormAddress(contact.address || ''); setFormTaxId(contact.taxId || ''); setFormNotes(contact.notes || '')
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!formName || !formType) { toast.error('Name and type are required'); return }
    setSaving(true)
    try {
      if (editingContact) {
        await controller.updateContact(editingContact.id, {
          name: formName, type: formType,
          email: formEmail || undefined, phone: formPhone || undefined,
          address: formAddress || undefined, taxId: formTaxId || undefined,
          notes: formNotes || undefined,
        })
        toast.success('Contact updated')
      } else {
        await controller.createContact({
          name: formName, type: formType,
          email: formEmail || undefined, phone: formPhone || undefined,
          address: formAddress || undefined, taxId: formTaxId || undefined,
          notes: formNotes || undefined,
        })
        toast.success('Contact created')
      }
      setShowModal(false); resetForm(); loadContacts()
    } catch (e: any) { toast.error(e.message || 'Failed to save') }
    finally { setSaving(false) }
  }

  const handleDeactivate = async (contact: Contact) => {
    try {
      await controller.updateContact(contact.id, { isActive: false })
      toast.success('Contact deactivated')
      setShowDeactivateModal(null); loadContacts()
    } catch (e: any) { toast.error(e.message || 'Failed to deactivate') }
  }

  const columns: TableColumn<Contact>[] = [
    { key: 'name', header: 'Name', render: (c) => <span style={{ fontWeight: 'var(--font-weight-medium)' as any, opacity: c.isActive ? 1 : 0.5 }}>{c.name}</span> },
    {
      key: 'type', header: 'Type', width: '90px',
      render: (c) => <Badge variant={typeBadge[c.type] || 'default'} size="sm">{c.type}</Badge>,
    },
    { key: 'email', header: 'Email', render: (c) => <span style={{ color: 'var(--text-secondary)' }}>{c.email || '-'}</span> },
    { key: 'phone', header: 'Phone', width: '120px', render: (c) => <span style={{ color: 'var(--text-secondary)' }}>{c.phone || '-'}</span> },
    {
      key: 'actions', header: '', width: '120px',
      render: (c) => (
        <div style={{ display: 'flex', gap: 'var(--space-1)' }} onClick={e => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => openEdit(c)} style={{ fontSize: 'var(--font-size-xs)', padding: '0 var(--space-1)' }}>Edit</Button>
          {c.isActive && (
            <Button size="sm" variant="ghost" onClick={() => setShowDeactivateModal(c)} style={{ fontSize: 'var(--font-size-xs)', padding: '0 var(--space-1)', color: 'var(--color-error)' }}>Deactivate</Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)' }}>Contacts</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Select
            options={[{ value: '', label: 'All' }, ...contactTypes]}
            value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            style={{ fontSize: 'var(--font-size-xs)', width: 120 }}
          />
          <Button size="sm" onClick={openCreate}>+ New Contact</Button>
        </div>
      </div>

      <Card padding="none">
        {loading ? <EmptyState message="Loading..." /> : (
          <div style={{ fontSize: 'var(--font-size-xs)' }}>
            <Table columns={columns} data={filteredContacts} emptyMessage="No contacts found" rowKey={(c) => c.id} />
          </div>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingContact ? 'Edit Contact' : 'New Contact'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>{editingContact ? 'Update' : 'Create'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input label="Name *" value={formName} onChange={e => setFormName(e.target.value)} placeholder="Contact name" />
          <Select label="Type *" options={contactTypes} value={formType} onChange={e => setFormType(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <Input label="Email" type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="email@example.com" />
            <Input label="Phone" value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="+1 555..." />
          </div>
          <Textarea label="Address" value={formAddress} onChange={e => setFormAddress(e.target.value)} rows={2} />
          <Input label="Tax ID" value={formTaxId} onChange={e => setFormTaxId(e.target.value)} placeholder="EIN, GST #, etc." />
          <Textarea label="Notes" value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} />
        </div>
      </Modal>

      {/* Deactivate Confirmation */}
      <Modal open={showDeactivateModal !== null} onClose={() => setShowDeactivateModal(null)} title="Deactivate Contact"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeactivateModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => showDeactivateModal && handleDeactivate(showDeactivateModal)}>Deactivate</Button>
          </>
        }
      >
        <p style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}>
          Are you sure you want to deactivate "{showDeactivateModal?.name}"?
        </p>
      </Modal>
    </div>
  )
}
