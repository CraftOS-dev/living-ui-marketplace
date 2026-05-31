import { useEffect, useMemo, useState } from 'react'
import {
  FiDownload,
  FiSearch,
  FiTag,
  FiTrash2,
  FiUpload,
  FiUserPlus,
} from 'react-icons/fi'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Select,
  Textarea,
} from '../ui'
import { Drawer } from '../Drawer'
import { useAgentAware } from '../../agent/hooks'
import type { AppController } from '../../AppController'
import type { Subscriber, SubscriberStatus, TagCount } from '../../types'

interface SubscribersProps {
  controller: AppController
  subscribers: Subscriber[]
  tags: TagCount[]
}

export function Subscribers({ controller, subscribers, tags }: SubscribersProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | SubscriberStatus>('')
  const [tagFilter, setTagFilter] = useState('')
  const [drawerSub, setDrawerSub] = useState<Subscriber | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    controller.refreshSubscribers()
    controller.refreshTags()
  }, [controller])

  useAgentAware('Subscribers', {
    section: 'subscribers',
    count: subscribers.length,
  })

  const filtered = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase()
    return subscribers.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false
      if (tagFilter && !s.tags.includes(tagFilter)) return false
      if (lowerSearch) {
        const name = `${s.firstName || ''} ${s.lastName || ''}`.toLowerCase()
        if (
          !s.email.toLowerCase().includes(lowerSearch) &&
          !name.includes(lowerSearch)
        )
          return false
      }
      return true
    })
  }, [subscribers, search, statusFilter, tagFilter])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <SectionHeader
        title="Subscribers"
        subtitle={`${subscribers.length.toLocaleString()} total · ${subscribers.filter((s) => s.status === 'subscribed').length.toLocaleString()} active`}
        actions={[
          <Button
            key="import"
            variant="secondary"
            size="sm"
            icon={<FiUpload size={14} />}
            onClick={() => setShowImport(true)}
          >
            Import CSV
          </Button>,
          <a
            key="export"
            href={controller.exportSubscribersUrl()}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <Button variant="secondary" size="sm" icon={<FiDownload size={14} />}>
              Export
            </Button>
          </a>,
          <Button
            key="add"
            variant="primary"
            size="sm"
            icon={<FiUserPlus size={14} />}
            onClick={() => setShowAdd(true)}
          >
            Add subscriber
          </Button>,
        ]}
      />

      <Card padding="md">
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
            <Input
              placeholder="Search by email or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
            <FiSearch
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
          </div>
          <div style={{ minWidth: 140 }}>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | SubscriberStatus)}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'subscribed', label: 'Subscribed' },
                { value: 'unsubscribed', label: 'Unsubscribed' },
                { value: 'bounced', label: 'Bounced' },
              ]}
            />
          </div>
          <div style={{ minWidth: 140 }}>
            <Select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              options={[
                { value: '', label: 'All tags' },
                ...tags.map((t) => ({ value: t.name, label: `${t.name} (${t.count})` })),
              ]}
            />
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FiUserPlus />}
            title={subscribers.length === 0 ? 'No subscribers yet' : 'No matches'}
            message={
              subscribers.length === 0
                ? 'Add subscribers one at a time, or import a CSV in bulk.'
                : 'Try clearing the filters above.'
            }
            action={
              subscribers.length === 0 ? (
                <Button variant="primary" onClick={() => setShowAdd(true)}>
                  Add your first subscriber
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card padding="none">
          <SubscriberList
            subscribers={filtered}
            onClick={(s) => setDrawerSub(s)}
          />
        </Card>
      )}

      {drawerSub && (
        <SubscriberDrawer
          subscriber={drawerSub}
          onClose={() => setDrawerSub(null)}
          onSave={async (updates) => {
            const ok = await controller.updateSubscriber(drawerSub.id, updates)
            if (ok) setDrawerSub(null)
          }}
          onDelete={async () => {
            if (!window.confirm(`Remove ${drawerSub.email}?`)) return
            const ok = await controller.deleteSubscriber(drawerSub.id)
            if (ok) setDrawerSub(null)
          }}
        />
      )}

      <AddSubscriberModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={async (data) => {
          const created = await controller.addSubscriber(data)
          if (created) setShowAdd(false)
        }}
      />

      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={async (csv, importTags) => {
          await controller.importSubscribersCsv(csv, importTags)
          setShowImport(false)
        }}
      />
    </div>
  )
}

function SectionHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode[]
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 'var(--space-3)',
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{title}</h1>
        {subtitle && (
          <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>
    </div>
  )
}

function SubscriberList({
  subscribers,
  onClick,
}: {
  subscribers: Subscriber[]
  onClick: (s: Subscriber) => void
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {subscribers.map((s, i) => {
          const fullName = `${s.firstName || ''} ${s.lastName || ''}`.trim()
          return (
            <li
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => onClick(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onClick(s)
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(160px, 1fr) auto auto',
                gap: 16,
                alignItems: 'center',
                padding: '14px var(--space-4)',
                borderBottom:
                  i === subscribers.length - 1 ? 'none' : '1px solid var(--border-primary)',
                cursor: 'pointer',
                transition: 'var(--transition-fast)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {fullName || s.email}
                </div>
                {fullName && (
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                    {s.email}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {s.tags.slice(0, 3).map((t) => (
                  <Badge key={t} variant="default" size="sm">
                    {t}
                  </Badge>
                ))}
                {s.tags.length > 3 && (
                  <Badge size="sm">+{s.tags.length - 3}</Badge>
                )}
              </div>
              <Badge
                variant={
                  s.status === 'subscribed'
                    ? 'success'
                    : s.status === 'bounced'
                    ? 'warning'
                    : 'default'
                }
                size="sm"
              >
                {s.status}
              </Badge>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SubscriberDrawer({
  subscriber,
  onClose,
  onSave,
  onDelete,
}: {
  subscriber: Subscriber
  onClose: () => void
  onSave: (updates: { email: string; firstName: string; lastName: string; tags: string[]; status: SubscriberStatus }) => Promise<void>
  onDelete: () => void | Promise<void>
}) {
  const [email, setEmail] = useState(subscriber.email)
  const [firstName, setFirstName] = useState(subscriber.firstName || '')
  const [lastName, setLastName] = useState(subscriber.lastName || '')
  const [tagsText, setTagsText] = useState(subscriber.tags.join(', '))
  const [status, setStatus] = useState<SubscriberStatus>(subscriber.status)

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${firstName || subscriber.email}`}
      subtitle={`Joined ${subscriber.createdAt ? new Date(subscriber.createdAt).toLocaleDateString() : '—'}`}
      footer={
        <>
          <Button
            variant="danger"
            size="sm"
            icon={<FiTrash2 size={14} />}
            onClick={onDelete}
          >
            Remove
          </Button>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              onSave({
                email,
                firstName,
                lastName,
                tags: tagsText
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
                status,
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: '1fr 1fr' }}>
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <Input
          label="Tags"
          hint="Comma-separated"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as SubscriberStatus)}
          options={[
            { value: 'subscribed', label: 'Subscribed' },
            { value: 'unsubscribed', label: 'Unsubscribed' },
            { value: 'bounced', label: 'Bounced' },
          ]}
        />
        <div
          style={{
            padding: 'var(--space-3)',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <FiTag size={12} />
            <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>Unsubscribe link</span>
          </div>
          <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
            /api/unsubscribe/{subscriber.unsubscribeToken}
          </code>
        </div>
      </div>
    </Drawer>
  )
}

function AddSubscriberModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (data: { email: string; firstName?: string; lastName?: string; tags?: string[] }) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [tagsText, setTagsText] = useState('')

  useEffect(() => {
    if (open) {
      setEmail('')
      setFirstName('')
      setLastName('')
      setTagsText('')
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add subscriber"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!email.includes('@')}
            onClick={() =>
              onAdd({
                email,
                firstName,
                lastName,
                tags: tagsText
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          >
            Add
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="Email"
          type="email"
          placeholder="alice@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: '1fr 1fr' }}>
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <Input
          label="Tags"
          hint="Comma-separated"
          placeholder="customer, vip"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
        />
      </div>
    </Modal>
  )
}

function ImportModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onImport: (csv: string, tags: string[]) => Promise<void>
}) {
  const [csv, setCsv] = useState('')
  const [tagsText, setTagsText] = useState('')

  useEffect(() => {
    if (open) {
      setCsv('')
      setTagsText('')
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import subscribers"
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!csv.trim()}
            onClick={() =>
              onImport(
                csv,
                tagsText
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              )
            }
          >
            Import
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          Paste a CSV. One row per subscriber, with columns: email, first name, last name (last two optional). Lines starting with{' '}
          <code>#</code> are ignored.
        </p>
        <Textarea
          label="CSV content"
          rows={10}
          placeholder={'alice@example.com,Alice,Smith\nbob@example.com\ncarol@example.com,Carol'}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <Input
          label="Tags to apply"
          hint="Comma-separated. Applied to every imported subscriber."
          placeholder="lead, fall-launch"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
        />
      </div>
    </Modal>
  )
}
