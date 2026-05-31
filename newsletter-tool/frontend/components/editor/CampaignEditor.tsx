import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FiArrowLeft,
  FiCalendar,
  FiCheck,
  FiEye,
  FiLayers,
  FiSend,
  FiUsers,
  FiZap,
} from 'react-icons/fi'
import {
  Alert,
  Badge,
  Button,
  Input,
  Modal,
} from '../ui'
import { Panel } from '../Panel'
import { useAgentAware } from '../../agent/hooks'
import type { AppController } from '../../AppController'
import type {
  AIGenerationResult,
  Campaign,
  CampaignDesign,
  EmailBlock,
  Subscriber,
  TagCount,
} from '../../types'
import { CampaignCanvas } from './CampaignCanvas'
import { EditorSidebar } from './EditorSidebar'
import { AIPanel } from './AIPanel'

type Tab = 'content' | 'audience' | 'review'

interface CampaignEditorProps {
  controller: AppController
  campaignId: number
  tags: TagCount[]
  subscribers: Subscriber[]
  llmConnected: boolean
  gmailConnected: boolean
  onClose: () => void
}

export function CampaignEditor({
  controller,
  campaignId,
  tags,
  subscribers,
  llmConnected,
  gmailConnected,
  onClose,
}: CampaignEditorProps) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [tab, setTab] = useState<Tab>('content')
  const [showAI, setShowAI] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string>('')
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    controller.getCampaign(campaignId).then((c) => {
      if (alive) setCampaign(c)
    })
    return () => {
      alive = false
    }
  }, [controller, campaignId])

  useAgentAware('CampaignEditor', {
    campaignId,
    blocks: campaign?.blocks?.length || 0,
    status: campaign?.status,
  })

  // Auto-save after edits (debounced ~700ms)
  const lastSavedJson = useRef<string>('')
  useEffect(() => {
    if (!campaign) return
    const snapshot = JSON.stringify({
      name: campaign.name,
      subject: campaign.subject,
      preheader: campaign.preheader,
      fromName: campaign.fromName,
      fromEmail: campaign.fromEmail,
      replyTo: campaign.replyTo,
      blocks: campaign.blocks,
      targetTags: campaign.targetTags,
      targetAll: campaign.targetAll,
    })
    if (snapshot === lastSavedJson.current) return
    if (!lastSavedJson.current) {
      lastSavedJson.current = snapshot
      return
    }
    const handle = window.setTimeout(async () => {
      setSaving(true)
      const saved = await controller.saveCampaign(campaign)
      if (!isMounted.current) return
      if (saved) {
        lastSavedJson.current = snapshot
        setSavedFlash(true)
        window.setTimeout(() => isMounted.current && setSavedFlash(false), 1500)
      }
      setSaving(false)
    }, 700)
    return () => window.clearTimeout(handle)
  }, [campaign, controller])

  const update = useCallback((patch: Partial<Campaign>) => {
    setCampaign((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const refreshPreview = useCallback(async () => {
    const r = await controller.previewCampaign(campaignId)
    if (isMounted.current) setPreviewHtml(r.html || '')
  }, [controller, campaignId])

  useEffect(() => {
    if (tab === 'review') refreshPreview()
    // Re-fetch when the campaign body changes while the review tab is active.
  }, [tab, refreshPreview, campaign?.blocks, campaign?.subject, campaign?.preheader])

  if (!campaign) {
    return (
      <div style={{ color: 'var(--text-secondary)', padding: 'var(--space-5)' }}>
        Loading campaign…
      </div>
    )
  }

  const readonly = campaign.status === 'sent' || campaign.status === 'sending'

  function applyAI(result: AIGenerationResult) {
    update({
      subject: result.subject || campaign?.subject || '',
      preheader: result.preheader || campaign?.preheader || '',
      blocks: result.blocks as EmailBlock[],
    })
    setShowAI(false)
    setTab('content')
  }

  async function handleSendNow() {
    if (!campaign) return
    if (!gmailConnected) {
      if (
        !window.confirm(
          'Gmail is not connected via CraftBot — sending will fail. Continue anyway?',
        )
      )
        return
    } else if (
      !window.confirm(
        `Send "${campaign.name}" to ${campaign.totalRecipients || 'all'} subscribers now?`,
      )
    ) {
      return
    }
    const updated = await controller.sendCampaign(campaign.id)
    if (updated) setCampaign(updated)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          icon={<FiArrowLeft size={14} />}
          onClick={onClose}
        >
          Campaigns
        </Button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Input
            value={campaign.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Campaign name"
            disabled={readonly}
            style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)' }}
          />
        </div>
        <Badge variant={statusVariant(campaign.status)} size="sm">
          {campaign.status}
        </Badge>
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          {saving ? (
            'Saving…'
          ) : savedFlash ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--color-success)',
              }}
            >
              <FiCheck size={12} /> Saved
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<FiZap size={14} />}
          onClick={() => setShowAI(true)}
          disabled={readonly}
        >
          AI write
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<FiCalendar size={14} />}
          onClick={() => setScheduleOpen(true)}
          disabled={readonly}
        >
          Schedule
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<FiSend size={14} />}
          onClick={handleSendNow}
          disabled={readonly}
        >
          Send now
        </Button>
      </header>

      {campaign.errorMessage && (
        <Alert variant="error" title="Last action failed">
          {campaign.errorMessage}
        </Alert>
      )}

      <TabBar tab={tab} setTab={setTab} />

      {tab === 'content' && (
        <ContentTab
          campaign={campaign}
          update={update}
          readonly={readonly}
        />
      )}
      {tab === 'audience' && (
        <AudienceTab
          campaign={campaign}
          update={update}
          readonly={readonly}
          tags={tags}
          subscribers={subscribers}
        />
      )}
      {tab === 'review' && (
        <ReviewTab campaign={campaign} html={previewHtml} onRefresh={refreshPreview} />
      )}

      <Modal open={showAI} onClose={() => setShowAI(false)} title="AI writer" size="lg">
        <AIPanel
          controller={controller}
          llmConnected={llmConnected}
          onApply={applyAI}
        />
      </Modal>

      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onConfirm={async (iso) => {
          const updated = await controller.scheduleCampaign(campaign.id, iso)
          if (updated) setCampaign(updated)
          setScheduleOpen(false)
        }}
      />
    </div>
  )
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'content', label: 'Content', Icon: FiLayers },
    { id: 'audience', label: 'Audience', Icon: FiUsers },
    { id: 'review', label: 'Review', Icon: FiEye },
  ]
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--border-primary)',
        overflowX: 'auto',
      }}
    >
      {items.map(({ id, label, Icon }) => {
        const active = tab === id
        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 14px',
              border: 'none',
              background: 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -1,
              cursor: 'pointer',
              fontWeight: active ? 600 : 500,
              fontSize: 'var(--font-size-sm)',
              whiteSpace: 'nowrap',
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content tab — sender + subject + preheader + WYSIWYG canvas + block palette
// ---------------------------------------------------------------------------

function ContentTab({
  campaign,
  update,
  readonly,
}: {
  campaign: Campaign
  update: (patch: Partial<Campaign>) => void
  readonly: boolean
}) {
  const onAdd = (b: EmailBlock) =>
    update({ blocks: [...(campaign.blocks || []), b] })
  const setDesign = (design: CampaignDesign) => update({ design })

  const isWide =
    typeof window !== 'undefined' ? window.innerWidth >= 960 : true

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Sender + subject row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <SectionHeading>Sender & subject</SectionHeading>
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-3)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <Input
            label="From name"
            value={campaign.fromName || ''}
            onChange={(e) => update({ fromName: e.target.value })}
            placeholder="Uses Settings default"
            disabled={readonly}
          />
          <Input
            label="From email"
            type="email"
            value={campaign.fromEmail || ''}
            onChange={(e) => update({ fromEmail: e.target.value })}
            placeholder="Uses Settings default"
            disabled={readonly}
          />
          <Input
            label="Reply-to"
            type="email"
            value={campaign.replyTo || ''}
            onChange={(e) => update({ replyTo: e.target.value })}
            placeholder="Optional"
            disabled={readonly}
          />
        </div>
        <Input
          label="Subject line"
          value={campaign.subject}
          onChange={(e) => update({ subject: e.target.value })}
          hint="The first thing recipients see in their inbox."
          disabled={readonly}
        />
        <Input
          label="Preheader"
          value={campaign.preheader}
          onChange={(e) => update({ preheader: e.target.value })}
          hint="Short preview text shown after the subject."
          disabled={readonly}
        />
      </div>

      {/* Two-column: left sidebar (palette + design) | WYSIWYG canvas */}
      <div
        style={{
          display: 'grid',
          gap: 'var(--space-3)',
          gridTemplateColumns: isWide ? '240px minmax(0, 1fr)' : 'minmax(0, 1fr)',
          alignItems: 'flex-start',
        }}
      >
        <EditorSidebar
          design={campaign.design || {}}
          onChangeDesign={setDesign}
          onAddBlock={onAdd}
          readonly={readonly}
        />
        <CampaignCanvas
          blocks={campaign.blocks || []}
          design={campaign.design || {}}
          onChange={(blocks) => update({ blocks })}
          readonly={readonly}
        />
      </div>
    </div>
  )
}

function AudienceTab({
  campaign,
  update,
  readonly,
  tags,
  subscribers,
}: {
  campaign: Campaign
  update: (patch: Partial<Campaign>) => void
  readonly: boolean
  tags: TagCount[]
  subscribers: Subscriber[]
}) {
  const targetSet = useMemo(
    () => new Set(campaign.targetTags),
    [campaign.targetTags],
  )

  function toggle(tag: string) {
    const next = new Set(targetSet)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    update({ targetTags: Array.from(next) })
  }

  const active = useMemo(
    () => subscribers.filter((s) => s.status === 'subscribed'),
    [subscribers],
  )
  const unsubscribed = subscribers.filter((s) => s.status === 'unsubscribed').length
  const bounced = subscribers.filter((s) => s.status === 'bounced').length

  const recipients = useMemo(() => {
    if (campaign.targetAll) return active
    if (campaign.targetTags.length === 0) return []
    return active.filter((s) =>
      (s.tags || []).some((t) => campaign.targetTags.includes(t)),
    )
  }, [active, campaign.targetAll, campaign.targetTags])

  const sample = recipients.slice(0, 6)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        maxWidth: 880,
      }}
    >
      {/* Summary */}
      <Panel label="Audience">
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 36,
              fontWeight: 800,
              lineHeight: 1,
              color: recipients.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {recipients.length.toLocaleString()}
          </span>
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            {recipients.length === 1
              ? 'subscriber will receive this campaign'
              : 'subscribers will receive this campaign'}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-4)',
            flexWrap: 'wrap',
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}
        >
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>{active.length}</strong>{' '}
            active
          </span>
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>{unsubscribed}</strong>{' '}
            unsubscribed <span style={{ color: 'var(--text-muted)' }}>(excluded)</span>
          </span>
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>{bounced}</strong>{' '}
            bounced <span style={{ color: 'var(--text-muted)' }}>(excluded)</span>
          </span>
        </div>
      </Panel>

      {/* Targeting */}
      <Panel label="Who gets it">
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-2)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          <ChoiceCard
            active={campaign.targetAll}
            disabled={readonly}
            onClick={() => update({ targetAll: true })}
            title="Everyone subscribed"
            sub={`${active.length.toLocaleString()} contacts`}
          />
          <ChoiceCard
            active={!campaign.targetAll}
            disabled={readonly}
            onClick={() => update({ targetAll: false })}
            title="By tag"
            sub={
              campaign.targetTags.length > 0
                ? campaign.targetTags.join(' · ')
                : 'Pick one or more tags below'
            }
          />
        </div>

        {!campaign.targetAll && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <SectionHeading>Tags</SectionHeading>
            {tags.length === 0 ? (
              <div
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-muted)',
                  padding: 'var(--space-3) 0',
                }}
              >
                No tags yet. Tag some subscribers first.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tags.map((t) => {
                  const isActive = targetSet.has(t.name)
                  return (
                    <button
                      key={t.name}
                      onClick={() => toggle(t.name)}
                      type="button"
                      disabled={readonly}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        border: isActive
                          ? '1px solid var(--text-primary)'
                          : '1px solid var(--border-primary)',
                        padding: '5px 10px',
                        background: isActive ? 'var(--text-primary)' : 'transparent',
                        color: isActive ? 'var(--bg-primary)' : 'var(--text-primary)',
                        borderRadius: 999,
                        cursor: readonly ? 'not-allowed' : 'pointer',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 600,
                      }}
                    >
                      {t.name}
                      <span
                        style={{
                          opacity: 0.7,
                          fontWeight: 500,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {t.count}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Recipients are active subscribers tagged with <strong>any</strong> of the
              selected tags.
            </div>
          </div>
        )}
      </Panel>

      {/* Warning when nothing matches */}
      {!campaign.targetAll && recipients.length === 0 && tags.length > 0 && (
        <Alert variant="warning" title="No recipients">
          {campaign.targetTags.length === 0
            ? 'Pick at least one tag, or switch to "Everyone subscribed".'
            : "No active subscribers match these tags. Nothing will send."}
        </Alert>
      )}

      {/* Sample recipients */}
      {recipients.length > 0 && (
        <Panel
          label={`Sample recipients · ${recipients.length.toLocaleString()} total`}
        >
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {sample.map((s, i) => {
              const name = `${s.firstName || ''} ${s.lastName || ''}`.trim()
              return (
                <li
                  key={s.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr) auto',
                    gap: 'var(--space-3)',
                    alignItems: 'center',
                    padding: '8px 4px',
                    borderBottom:
                      i === sample.length - 1
                        ? 'none'
                        : '1px solid var(--border-primary)',
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                    }}
                  >
                    {s.email}
                  </span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {name || '—'}
                  </span>
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {(s.tags || []).slice(0, 3).map((t) => (
                      <Badge key={t} variant="default" size="sm">
                        {t}
                      </Badge>
                    ))}
                  </span>
                </li>
              )
            })}
          </ul>
          {recipients.length > sample.length && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                paddingTop: 8,
              }}
            >
              … and {(recipients.length - sample.length).toLocaleString()} more
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

function ChoiceCard({
  active,
  disabled,
  onClick,
  title,
  sub,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  title: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        padding: '12px 14px',
        background: active ? 'var(--bg-tertiary)' : 'transparent',
        // box-shadow keeps the highlight visually distinct without changing
        // size (1 px border always, 2 px ring on active).
        border: '1px solid var(--border-primary)',
        boxShadow: active ? 'inset 0 0 0 1px var(--text-primary)' : 'none',
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
        transition: 'var(--transition-fast)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 2,
          background: active ? 'var(--text-primary)' : 'transparent',
          boxShadow: active
            ? 'inset 0 0 0 4px var(--bg-primary)'
            : 'inset 0 0 0 1px var(--border-primary)',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 320,
          }}
        >
          {sub}
        </span>
      </div>
    </button>
  )
}

function ReviewTab({
  campaign,
  html,
  onRefresh,
}: {
  campaign: Campaign
  html: string
  onRefresh: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <SectionHeading>Final check</SectionHeading>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          rowGap: 6,
          columnGap: 16,
          margin: 0,
          fontSize: 'var(--font-size-sm)',
        }}
      >
        <dt style={{ color: 'var(--text-muted)' }}>Subject</dt>
        <dd style={{ margin: 0 }}>
          {campaign.subject || <em style={{ color: 'var(--text-muted)' }}>empty</em>}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Preheader</dt>
        <dd style={{ margin: 0 }}>
          {campaign.preheader || <em style={{ color: 'var(--text-muted)' }}>empty</em>}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>From</dt>
        <dd style={{ margin: 0 }}>
          {campaign.fromName
            ? `${campaign.fromName} <${campaign.fromEmail || 'no-from-email'}>`
            : campaign.fromEmail || (
                <em style={{ color: 'var(--text-muted)' }}>uses Settings</em>
              )}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Audience</dt>
        <dd style={{ margin: 0 }}>
          {campaign.targetAll
            ? 'All subscribed contacts'
            : campaign.targetTags.join(', ') || (
                <em style={{ color: 'var(--text-muted)' }}>none</em>
              )}
        </dd>
      </dl>

      <SectionHeading>How recipients will see it</SectionHeading>
      <PreviewFrame html={html} onRequestRefresh={onRefresh} />
    </div>
  )
}

function PreviewFrame({
  html,
  onRequestRefresh,
}: {
  html: string
  onRequestRefresh: () => void
}) {
  if (!html) {
    return (
      <div
        style={{
          minHeight: 240,
          border: '1px dashed var(--border-primary)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 'var(--font-size-sm)' }}>Rendering preview…</span>
        <Button size="sm" variant="ghost" onClick={onRequestRefresh}>
          Refresh
        </Button>
      </div>
    )
  }
  return (
    <iframe
      title="Email preview"
      srcDoc={html}
      sandbox=""
      style={{
        width: '100%',
        height: 640,
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-md)',
        background: '#fff',
      }}
    />
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 'var(--font-size-xs)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        marginBottom: 'var(--space-2)',
      }}
    >
      {children}
    </div>
  )
}

function ScheduleModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (iso: string) => Promise<void>
}) {
  const tomorrow = useMemo(() => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return localInputValue(d)
  }, [])
  const [when, setWhen] = useState(tomorrow)
  useEffect(() => {
    if (open) setWhen(tomorrow)
  }, [open, tomorrow])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule send"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!when}
            onClick={() => onConfirm(localToIso(when))}
          >
            Schedule
          </Button>
        </>
      }
    >
      <Input
        label="Send date & time"
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        hint="The scheduler checks every 20 seconds. Tracking links use your Settings tracking URL."
      />
    </Modal>
  )
}

function statusVariant(s: Campaign['status']) {
  switch (s) {
    case 'sent':
      return 'success'
    case 'sending':
      return 'warning'
    case 'failed':
      return 'error'
    case 'scheduled':
      return 'info'
    default:
      return 'default'
  }
}

function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localToIso(local: string): string {
  const d = new Date(local)
  return d.toISOString()
}
