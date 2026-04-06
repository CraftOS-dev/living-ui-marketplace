import { useEffect, useState, useCallback } from 'react'
import { Card, Button, Input, Select, Table, Badge, Modal, EmptyState } from '../ui'
import { XIcon } from '../Icons'
import type { TableColumn } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, Contact, Company } from '../../types'

interface ContactsPageProps {
  controller: AppController
}

const LEAD_STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'unqualified', label: 'Unqualified' },
  { value: 'nurturing', label: 'Nurturing' },
]

const leadStatusBadge = (status: string) => {
  const map: Record<string, 'info' | 'primary' | 'success' | 'warning' | 'error' | 'default'> = {
    new: 'info',
    contacted: 'primary',
    qualified: 'success',
    unqualified: 'error',
    nurturing: 'warning',
  }
  return map[status] || 'default'
}

// ============================================================================
// Contact Detail Panel
// ============================================================================

function ContactDetailPanel({
  contact,
  controller,
  onClose,
}: {
  contact: Contact
  controller: AppController
  onClose: () => void
}) {
  const [scoring, setScoring] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatedEmail, setGeneratedEmail] = useState<{ subject: string; body: string } | null>(null)

  const handleScoreLead = async () => {
    setScoring(true)
    try {
      await controller.scoreLead(contact.id)
      await controller.getContact(contact.id)
    } catch (err) {
      console.error('[ContactDetail] Score lead failed:', err)
    } finally {
      setScoring(false)
    }
  }

  const handleGenerateEmail = async () => {
    setGenerating(true)
    try {
      const result = await controller.generateEmail({
        contactId: contact.id,
        purpose: 'follow-up',
        tone: 'professional',
      })
      setGeneratedEmail(result)
    } catch (err) {
      console.error('[ContactDetail] Generate email failed:', err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        backgroundColor: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-primary)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.2)',
        animation: 'slideInRight 0.2s ease-out',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--border-primary)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)' }}>
          {contact.firstName} {contact.lastName}
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XIcon size={14} />
        </Button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
        {/* Contact Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <InfoRow label="Email" value={contact.email} />
          <InfoRow label="Phone" value={contact.phone} />
          <InfoRow label="Company" value={contact.companyName} />
          <InfoRow label="Job Title" value={contact.jobTitle} />
          <InfoRow label="Department" value={contact.department} />
          <InfoRow label="Source" value={contact.source} />
          <InfoRow label="City" value={contact.city} />
          <InfoRow label="Country" value={contact.country} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', width: 90 }}>
              Lead Status
            </span>
            <Badge variant={leadStatusBadge(contact.leadStatus)}>{contact.leadStatus}</Badge>
          </div>
          <InfoRow label="Lead Score" value={contact.leadScore != null ? String(contact.leadScore) : null} />
        </div>

        {/* Tags */}
        {contact.tags && contact.tags.length > 0 && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
              Tags
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {contact.tags.map((tag) => (
                <Badge key={tag.id} variant="primary" size="sm">
                  {tag.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* AI Actions */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--border-primary)',
          }}
        >
          <Button variant="secondary" size="sm" onClick={handleScoreLead} loading={scoring}>
            Score Lead
          </Button>
          <Button variant="secondary" size="sm" onClick={handleGenerateEmail} loading={generating}>
            Generate Email
          </Button>
        </div>

        {/* Generated Email Preview */}
        {generatedEmail && (
          <Card style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
              Generated Email
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
              {generatedEmail.subject}
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {generatedEmail.body}
            </div>
          </Card>
        )}

        {/* Timeline placeholder */}
        <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
            Timeline
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            Created: {contact.createdAt ? new Date(contact.createdAt).toLocaleDateString() : 'N/A'}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            Updated: {contact.updatedAt ? new Date(contact.updatedAt).toLocaleDateString() : 'N/A'}
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', width: 90, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

// ============================================================================
// New Contact Modal
// ============================================================================

function NewContactModal({
  open,
  onClose,
  controller,
  companies,
}: {
  open: boolean
  onClose: () => void
  controller: AppController
  companies: Company[]
}) {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    companyId: '',
    jobTitle: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('First and last name are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await controller.createContact({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        companyId: form.companyId ? Number(form.companyId) : undefined,
        jobTitle: form.jobTitle.trim() || undefined,
      } as any)
      setForm({ firstName: '', lastName: '', email: '', phone: '', companyId: '', jobTitle: '' })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contact')
    } finally {
      setSaving(false)
    }
  }

  const companyOptions = [
    { value: '', label: 'No Company' },
    ...companies.map((c) => ({ value: String(c.id), label: c.name })),
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Contact"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving}>Create Contact</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {error && (
          <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{error}</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <Input
            label="First Name"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            placeholder="John"
          />
          <Input
            label="Last Name"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            placeholder="Doe"
          />
        </div>
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="john@example.com"
        />
        <Input
          label="Phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="+1 555-0100"
        />
        <Select
          label="Company"
          options={companyOptions}
          value={form.companyId}
          onChange={(e) => setForm({ ...form, companyId: e.target.value })}
        />
        <Input
          label="Job Title"
          value={form.jobTitle}
          onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
          placeholder="Software Engineer"
        />
      </div>
    </Modal>
  )
}

// ============================================================================
// Contacts Page
// ============================================================================

export function ContactsPage({ controller }: ContactsPageProps) {
  const [state, setState] = useState<AppState>(controller.getState())
  const [search, setSearch] = useState('')
  const [leadFilter, setLeadFilter] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<Company[]>([])

  useEffect(() => {
    const unsub = controller.subscribe(setState)
    return unsub
  }, [controller])

  const loadContacts = useCallback(async () => {
    setLoading(true)
    try {
      await controller.fetchContacts({
        page,
        perPage: 20,
        search: search || undefined,
        leadStatus: leadFilter || undefined,
      })
    } catch (err) {
      console.error('[ContactsPage] Failed to load contacts:', err)
    } finally {
      setLoading(false)
    }
  }, [controller, page, search, leadFilter])

  useEffect(() => {
    loadContacts()
  }, [loadContacts])

  // Load companies for form select
  useEffect(() => {
    controller.fetchCompanies({ perPage: 100 }).then((res) => {
      setCompanies(res.items)
    }).catch(() => {})
  }, [controller])

  const contacts = state.contacts
  const items = contacts?.items || []

  const handleSearch = () => {
    setPage(1)
    loadContacts()
  }

  const handleRowClick = async (contact: Contact) => {
    try {
      await controller.getContact(contact.id)
    } catch (err) {
      console.error('[ContactsPage] Failed to get contact:', err)
    }
  }

  const handleCloseDetail = () => {
    controller.setState({ selectedContact: null }, false)
  }

  const columns: TableColumn<Contact>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <span style={{ fontWeight: 500 }}>
          {c.firstName} {c.lastName}
        </span>
      ),
    },
    { key: 'email', header: 'Email' },
    { key: 'companyName', header: 'Company', render: (c) => c.companyName || '\u2014' },
    {
      key: 'leadStatus',
      header: 'Lead Status',
      render: (c) => <Badge variant={leadStatusBadge(c.leadStatus)}>{c.leadStatus}</Badge>,
    },
    {
      key: 'leadScore',
      header: 'Lead Score',
      align: 'center',
      render: (c) => (
        <span style={{ color: c.leadScore != null && c.leadScore >= 70 ? 'var(--color-success)' : 'var(--text-primary)' }}>
          {c.leadScore ?? '\u2014'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (c) => (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '\u2014'),
    },
  ]

  return (
    <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
          Contacts
          {contacts && (
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginLeft: 'var(--space-2)' }}>
              ({contacts.total})
            </span>
          )}
        </h2>
        <Button onClick={() => controller.setState({ showContactForm: true }, false)}>
          New Contact
        </Button>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, maxWidth: 320 }}>
          <Input
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <div style={{ width: 180 }}>
          <Select
            options={LEAD_STATUS_OPTIONS}
            value={leadFilter}
            onChange={(e) => {
              setLeadFilter(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={handleSearch}>
          Search
        </Button>
      </div>

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading contacts...
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No contacts found"
            message="Create your first contact to get started"
            action={
              <Button onClick={() => controller.setState({ showContactForm: true }, false)}>
                New Contact
              </Button>
            }
          />
        ) : (
          <Table
            columns={columns}
            data={items}
            onRowClick={handleRowClick}
            rowKey={(c) => c.id}
          />
        )}
      </Card>

      {/* Pagination */}
      {contacts && contacts.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            Page {contacts.page} of {contacts.pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= contacts.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Detail Panel */}
      {state.selectedContact && (
        <ContactDetailPanel
          contact={state.selectedContact}
          controller={controller}
          onClose={handleCloseDetail}
        />
      )}

      {/* New Contact Modal */}
      <NewContactModal
        open={state.showContactForm}
        onClose={() => controller.setState({ showContactForm: false }, false)}
        controller={controller}
        companies={companies}
      />
    </div>
  )
}
