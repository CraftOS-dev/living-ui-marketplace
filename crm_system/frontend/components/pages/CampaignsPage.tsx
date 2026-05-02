import { useState, useEffect, useCallback } from 'react'
import { Button, Card, Table, Badge, Modal, Input, Select, Textarea, EmptyState } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, Campaign } from '../../types'

const BACKEND_URL = ((window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3111') + '/api'

interface CampaignsPageProps {
  controller: AppController
  state: AppState
}

const statusVariant: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'info' | 'error'> = {
  draft: 'default',
  scheduled: 'warning',
  sending: 'info',
  sent: 'success',
  failed: 'error',
}

export function CampaignsPage({ controller: _controller }: CampaignsPageProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [detail, setDetail] = useState<Campaign | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState('email')
  const [formSubject, setFormSubject] = useState('')
  const [formBody, setFormBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [addContactId, setAddContactId] = useState('')

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/campaigns`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setCampaigns(Array.isArray(data) ? data : data.items || [])
    } catch {
      showToast('Failed to load campaigns')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  const handleCreate = async () => {
    if (!formName.trim()) {
      showToast('Name is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          campaignType: formType,
          subject: formSubject || undefined,
          body: formBody || undefined,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Campaign created')
      setShowModal(false)
      setFormName('')
      setFormType('email')
      setFormSubject('')
      setFormBody('')
      loadCampaigns()
    } catch {
      showToast('Failed to create campaign')
    } finally {
      setSaving(false)
    }
  }

  const loadDetail = async (id: number) => {
    try {
      const res = await fetch(`${BACKEND_URL}/campaigns/${id}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setDetail(data)
    } catch {
      showToast('Failed to load campaign details')
    }
  }

  const handleAddContact = async () => {
    if (!detail || !addContactId) return
    try {
      const res = await fetch(`${BACKEND_URL}/campaigns/${detail.id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: [parseInt(addContactId)] }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Contact added')
      setAddContactId('')
      loadDetail(detail.id)
    } catch {
      showToast('Failed to add contact')
    }
  }

  const handleSend = async () => {
    if (!detail) return
    if (!confirm('Send this campaign now?')) return
    try {
      const res = await fetch(`${BACKEND_URL}/campaigns/${detail.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Campaign sent')
      loadDetail(detail.id)
      loadCampaigns()
    } catch {
      showToast('Failed to send campaign')
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (c: Campaign) => (
        <span style={{ fontWeight: 'var(--font-weight-medium)' as any, cursor: 'pointer', color: 'var(--color-primary)' }}>
          {c.name}
        </span>
      ),
    },
    {
      key: 'campaignType',
      header: 'Type',
      render: (c: Campaign) => <Badge variant="default">{c.campaignType}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c: Campaign) => (
        <Badge variant={statusVariant[c.status] || 'default'} dot>
          {c.status}
        </Badge>
      ),
    },
    {
      key: 'contactCount',
      header: 'Contacts',
      render: (c: Campaign) => c.contactCount ?? '--',
    },
    {
      key: 'sentAt',
      header: 'Sent',
      render: (c: Campaign) =>
        c.sentAt ? new Date(c.sentAt).toLocaleDateString() : '--',
    },
  ]

  if (detail) {
    const stats = detail.stats || {}
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {toast && (
          <div
            style={{
              position: 'fixed',
              top: 16,
              right: 16,
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 9999,
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
            }}
          >
            {toast}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>
            &larr; Back
          </Button>
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any }}>
            {detail.name}
          </h1>
          <Badge variant={statusVariant[detail.status] || 'default'} dot>
            {detail.status}
          </Badge>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {[
            { label: 'Sent', value: stats.sent ?? 0, color: 'var(--color-info)' },
            { label: 'Opened', value: stats.opened ?? 0, color: 'var(--color-success)' },
            { label: 'Clicked', value: stats.clicked ?? 0, color: 'var(--color-primary)' },
          ].map((s) => (
            <Card key={s.label} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: s.color }}>
                {s.value}
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{s.label}</div>
            </Card>
          ))}
        </div>

        {/* Add Contacts */}
        <Card>
          <h3 style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-semibold)' as any }}>
            Add Contacts
          </h3>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <Input
                label="Contact ID"
                type="number"
                value={addContactId}
                onChange={(e) => setAddContactId(e.target.value)}
                placeholder="Enter contact ID"
              />
            </div>
            <Button onClick={handleAddContact} disabled={!addContactId}>
              Add
            </Button>
          </div>
          {detail.contacts && detail.contacts.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              {detail.contacts.length} contact(s) in campaign
            </div>
          )}
        </Card>

        {/* Send */}
        {detail.status === 'draft' && (
          <div>
            <Button onClick={handleSend}>Send Campaign</Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 9999,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-primary)',
          }}
        >
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any }}>
          Campaigns
        </h1>
        <Button onClick={() => setShowModal(true)}>New Campaign</Button>
      </div>

      <Card padding="none">
        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading campaigns...
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            message="No campaigns yet"
            action={<Button onClick={() => setShowModal(true)}>New Campaign</Button>}
          />
        ) : (
          <Table
            columns={columns}
            data={campaigns}
            rowKey={(c) => c.id}
            onRowClick={(c) => loadDetail(c.id)}
          />
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="New Campaign"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={saving}>Create</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input
            label="Campaign Name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g., Q2 Newsletter"
          />
          <Select
            label="Type"
            options={[
              { value: 'email', label: 'Email' },
              { value: 'sms', label: 'SMS' },
            ]}
            value={formType}
            onChange={(e) => setFormType(e.target.value)}
          />
          <Input
            label="Subject"
            value={formSubject}
            onChange={(e) => setFormSubject(e.target.value)}
            placeholder="Email subject line"
          />
          <Textarea
            label="Body"
            value={formBody}
            onChange={(e) => setFormBody(e.target.value)}
            rows={6}
            placeholder="Campaign content"
          />
        </div>
      </Modal>
    </div>
  )
}
