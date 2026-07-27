import { useEffect, useState } from 'react'
import {
  FiCheck,
  FiClock,
  FiCopy,
  FiEdit3,
  FiPlus,
  FiSend,
  FiTrash2,
} from 'react-icons/fi'
import { Badge, Button, Card, EmptyState, Modal, Input } from '../ui'
import { useAgentAware } from '../../agent/hooks'
import type { AppController } from '../../AppController'
import type { Campaign, CampaignStatus } from '../../types'

interface CampaignsProps {
  controller: AppController
  campaigns: Campaign[]
  onEdit: (id: number) => void
  initialOpenId?: number | null
}

const STATUS_VARIANT: Record<CampaignStatus, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
  draft: 'default',
  scheduled: 'info',
  sending: 'warning',
  sent: 'success',
  failed: 'error',
  cancelled: 'default',
}

export function Campaigns({ controller, campaigns, onEdit, initialOpenId }: CampaignsProps) {
  const [showNew, setShowNew] = useState(false)
  const [filter, setFilter] = useState<'all' | CampaignStatus>('all')

  useEffect(() => {
    controller.refreshCampaigns()
  }, [controller])

  useEffect(() => {
    if (initialOpenId) {
      onEdit(initialOpenId)
    }
  }, [initialOpenId, onEdit])

  useAgentAware('Campaigns', {
    section: 'campaigns',
    count: campaigns.length,
  })

  const filtered =
    filter === 'all' ? campaigns : campaigns.filter((c) => c.status === filter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Campaigns</h1>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            Write, schedule, and send newsletters to your subscribers.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<FiPlus size={14} />}
          onClick={() => setShowNew(true)}
        >
          New campaign
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['all', 'draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            style={{
              border:
                filter === f
                  ? '1px solid var(--text-primary)'
                  : '1px solid var(--border-primary)',
              padding: '5px 12px',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
              textTransform: 'capitalize',
              background: filter === f ? 'var(--text-primary)' : 'transparent',
              color: filter === f ? 'var(--bg-primary)' : 'var(--text-secondary)',
              borderRadius: 999,
              cursor: 'pointer',
              transition: 'var(--transition-fast)',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FiSend />}
            title={campaigns.length === 0 ? 'No campaigns yet' : `No ${filter} campaigns`}
            message={
              campaigns.length === 0
                ? 'Start your first newsletter with a built-in template or from scratch.'
                : 'Try a different filter.'
            }
            action={
              campaigns.length === 0 ? (
                <Button variant="primary" onClick={() => setShowNew(true)}>
                  Create your first campaign
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-3)',
            // Fixed-width tracks so cards never stretch — leftover space sits
            // on the right instead of resizing every card based on row count.
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 300px))',
            justifyContent: 'start',
          }}
        >
          {filtered.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onEdit={() => onEdit(c.id)}
              onDuplicate={async () => {
                const copy = await controller.duplicateCampaign(c.id)
                if (copy) onEdit(copy.id)
              }}
              onDelete={async () => {
                if (window.confirm(`Delete "${c.name}"?`)) {
                  await controller.deleteCampaign(c.id)
                }
              }}
              onCancel={async () => {
                if (window.confirm(`Cancel the schedule for "${c.name}"?`)) {
                  await controller.cancelCampaign(c.id)
                }
              }}
            />
          ))}
        </div>
      )}

      <NewCampaignModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreate={async (name) => {
          const created = await controller.createCampaign(name)
          if (created) {
            setShowNew(false)
            onEdit(created.id)
          }
        }}
      />
    </div>
  )
}

function CampaignCard({
  campaign,
  onEdit,
  onDuplicate,
  onDelete,
  onCancel,
}: {
  campaign: Campaign
  onEdit: () => void
  onDuplicate: () => void | Promise<void>
  onDelete: () => void | Promise<void>
  onCancel: () => void | Promise<void>
}) {
  const openRate =
    campaign.sentCount > 0
      ? `${((campaign.opensUnique / campaign.sentCount) * 100).toFixed(1)}%`
      : '—'
  const clickRate =
    campaign.sentCount > 0
      ? `${((campaign.clicksUnique / campaign.sentCount) * 100).toFixed(1)}%`
      : '—'

  const isScheduled = campaign.status === 'scheduled' && !!campaign.scheduledAt

  return (
    <Card
      padding="md"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 220,
      }}
    >
      {/* Top row: status + (optional) scheduled time inline — keeps a steady
          card height across draft / scheduled / sent variants. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 'var(--space-2)',
        }}
      >
        <Badge variant={STATUS_VARIANT[campaign.status]} size="sm">
          {campaign.status}
        </Badge>
        {isScheduled && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--text-muted)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={new Date(campaign.scheduledAt!).toLocaleString()}
          >
            <FiClock size={11} />
            {fmtScheduled(campaign.scheduledAt!)}
          </span>
        )}
        {campaign.status === 'sent' && (
          <FiCheck size={14} color="var(--color-success)" />
        )}
      </div>

      {/* Title + subject — both single-line ellipsis so the card height
          doesn't drift with long names. */}
      <div
        style={{
          fontWeight: 700,
          fontSize: 'var(--font-size-base)',
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 2,
        }}
        title={campaign.name}
      >
        {campaign.name}
      </div>
      <div
        style={{
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={campaign.subject || undefined}
      >
        {campaign.subject || 'No subject yet'}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <Mini label="Recipients" value={campaign.totalRecipients.toLocaleString()} />
        <Mini label="Opens" value={openRate} />
        <Mini label="Clicks" value={clickRate} />
      </div>

      {/* Error pill — single line, truncated */}
      {campaign.errorMessage && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-error)',
            background: 'var(--color-error-light)',
            padding: '4px 8px',
            borderRadius: 4,
            marginTop: 'var(--space-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={campaign.errorMessage}
        >
          {campaign.errorMessage}
        </div>
      )}

      {/* Action row — pinned to the bottom of the card */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginTop: 'auto',
          paddingTop: 'var(--space-3)',
          alignItems: 'center',
        }}
      >
        <Button
          size="sm"
          variant="primary"
          icon={<FiEdit3 size={12} />}
          onClick={onEdit}
        >
          Open
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<FiCopy size={12} />}
          onClick={onDuplicate}
          aria-label="Duplicate"
          title="Duplicate"
        >
          {''}
        </Button>
        {isScheduled && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <span style={{ flex: 1 }} />
        <Button
          size="sm"
          variant="ghost"
          icon={<FiTrash2 size={12} />}
          onClick={onDelete}
          aria-label={`Delete ${campaign.name}`}
          title="Delete"
        >
          {''}
        </Button>
      </div>
    </Card>
  )
}

function fmtScheduled(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const dayMs = 86_400_000
  if (diff > 0 && diff < dayMs) {
    const h = Math.max(1, Math.round(diff / 3_600_000))
    return `in ${h}h`
  }
  if (diff > 0 && diff < 7 * dayMs) {
    const days = Math.max(1, Math.round(diff / dayMs))
    return `in ${days}d`
  }
  // Same year — short date. Different year — include the year.
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  return d.toLocaleString(undefined, opts)
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 700, fontSize: 'var(--font-size-sm)' }}>{value}</div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function NewCampaignModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName('')
  }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New campaign"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim())}
          >
            Create draft
          </Button>
        </>
      }
    >
      <Input
        label="Campaign name"
        autoFocus
        placeholder="e.g. October newsletter"
        value={name}
        onChange={(e) => setName(e.target.value)}
        hint="Just for you — recipients won't see this."
      />
    </Modal>
  )
}
