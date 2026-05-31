import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FiArrowRight,
  FiBookOpen,
  FiCalendar,
  FiFileText,
  FiHeart,
  FiMail,
  FiMessageCircle,
  FiPlus,
  FiSend,
  FiTag,
  FiUserPlus,
  FiZap,
} from 'react-icons/fi'
import type { IconType } from 'react-icons'
import { Panel } from '../Panel'
import { useAgentAware } from '../../agent/hooks'
import { useViewport } from '../../hooks/useViewport'
import type { AppController } from '../../AppController'
import type {
  Campaign,
  DashboardData,
  IntegrationsStatus,
  Subscriber,
  Template,
} from '../../types'

interface DashboardProps {
  controller: AppController
  dashboard: DashboardData | null
  subscribers: Subscriber[]
  campaigns: Campaign[]
  templates: Template[]
  integrations: IntegrationsStatus | null
  onEditCampaign: (id: number) => void
  onCreateFromTemplate: (templateId: number) => void
  onNewCampaign: () => void
  onOpenCampaigns: () => void
  onOpenSchedule: () => void
  onOpenSubscribers: () => void
}

const DAY = 86_400_000

const ICON_MAP: Record<string, IconType> = {
  FiMail,
  FiSend,
  FiFileText,
  FiUserPlus,
  FiZap,
  FiTag,
  FiCalendar,
  FiBookOpen,
  FiMessageCircle,
  FiHeart,
}

// ---------------------------------------------------------------------------

export function Dashboard(props: DashboardProps) {
  const {
    controller,
    dashboard,
    subscribers,
    campaigns,
    templates,
    integrations,
    onEditCampaign,
    onCreateFromTemplate,
    onNewCampaign,
    onOpenSubscribers,
  } = props
  const viewport = useViewport()

  useEffect(() => {
    controller.refreshDashboard()
    controller.refreshSubscribers()
    controller.refreshCampaigns()
    controller.refreshTemplates()
    controller.refreshIntegrations()
  }, [controller])

  useAgentAware('Dashboard', { hasData: !!dashboard })

  const isMobile = viewport.size === 'mobile'

  const drafts = useMemo(
    () =>
      campaigns
        .filter((c) => c.status === 'draft')
        .sort(
          (a, b) =>
            new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime(),
        ),
    [campaigns],
  )

  const scheduled = useMemo(
    () =>
      campaigns
        .filter((c) => c.status === 'scheduled' && c.scheduledAt)
        .sort(
          (a, b) =>
            new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime(),
        ),
    [campaigns],
  )

  const recentSends = useMemo(
    () =>
      campaigns
        .filter((c) => c.status === 'sent' && c.sentAt && c.sentCount > 0)
        .sort(
          (a, b) =>
            new Date(b.sentAt!).getTime() - new Date(a.sentAt!).getTime(),
        ),
    [campaigns],
  )

  const quickStart = useMemo(() => pickQuickStart(templates), [templates])
  const insight = useMemo(
    () => computeInsight({ dashboard, scheduled, drafts, recentSends, integrations }),
    [dashboard, scheduled, drafts, recentSends, integrations],
  )

  const headerBits = computeHeaderStats(dashboard, scheduled.length, recentSends)

  const gridTwoCol: React.CSSProperties = {
    display: 'grid',
    gap: 'var(--space-3)',
    gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
    alignItems: 'stretch',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <BriefingPanel insight={insight} headerBits={headerBits} />

      <CampaignsPanel
        drafts={drafts}
        scheduled={scheduled}
        onOpen={onEditCampaign}
        onNew={onNewCampaign}
      />

      <div style={gridTwoCol}>
        <QuickStartPanel templates={quickStart} onUse={onCreateFromTemplate} />
        <RecentSendsPanel recent={recentSends} onOpen={onEditCampaign} />
      </div>

      <GrowthChartPanel
        subscribers={subscribers}
        campaigns={campaigns}
        onEditCampaign={onEditCampaign}
      />

      <AudiencePanel
        dashboard={dashboard}
        onOpen={onOpenSubscribers}
      />
    </div>
  )
}

// ===========================================================================
// 1. BRIEFING
// ===========================================================================

function BriefingPanel({
  insight,
  headerBits,
}: {
  insight: { headline: string; support: string }
  headerBits: { label: string; value: string }[]
}) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  return (
    <header
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) 0',
      }}
    >
      <span
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontWeight: 600,
          color: 'var(--text-muted)',
        }}
      >
        {greetingFor(new Date())} · {today}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 880 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 700,
            lineHeight: 1.25,
            letterSpacing: -0.3,
            color: 'var(--text-primary)',
          }}
        >
          {insight.headline}
        </h1>
        {insight.support && (
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
            }}
          >
            {insight.support}
          </p>
        )}
      </div>
      {headerBits.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-4)',
            flexWrap: 'wrap',
            fontSize: 13,
          }}
        >
          {headerBits.map((b, i) => (
            <span key={i} style={{ color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{b.value}</strong>{' '}
              {b.label}
            </span>
          ))}
        </div>
      )}
    </header>
  )
}

function greetingFor(now: Date): string {
  const h = now.getHours()
  if (h < 5) return 'Late night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Late night'
}

function computeHeaderStats(
  dashboard: DashboardData | null,
  scheduledCount: number,
  recent: Campaign[],
): { label: string; value: string }[] {
  if (!dashboard) return []
  const ov = dashboard.overview
  const out: { label: string; value: string }[] = []
  out.push({
    value: ov.subscribers.newLast30Days.toLocaleString(),
    label: 'new in 30d',
  })
  if (recent.length > 0) {
    const avg =
      recent.slice(0, 5).reduce(
        (acc, c) => acc + c.opensUnique / Math.max(1, c.sentCount),
        0,
      ) / Math.min(5, recent.length)
    out.push({ value: `${(avg * 100).toFixed(0)}%`, label: 'avg open rate' })
  }
  out.push({
    value: String(scheduledCount),
    label: scheduledCount === 1 ? 'send queued' : 'sends queued',
  })
  return out
}

function computeInsight({
  dashboard,
  scheduled,
  drafts,
  recentSends,
  integrations,
}: {
  dashboard: DashboardData | null
  scheduled: Campaign[]
  drafts: Campaign[]
  recentSends: Campaign[]
  integrations: IntegrationsStatus | null
}): { headline: string; support: string } {
  if (!dashboard) return { headline: 'Loading…', support: '' }

  // Gmail not connected — supersedes everything except an imminent send.
  if (integrations && !integrations.gmail.google_workspace) {
    const next = scheduled[0]
    if (next && next.scheduledAt && new Date(next.scheduledAt).getTime() - Date.now() < DAY) {
      return {
        headline: `${next.name} is scheduled but Gmail isn't connected.`,
        support: `Open Settings and link Google Workspace in CraftBot or the send will fail when its time comes.`,
      }
    }
    return {
      headline: 'Connect Gmail to start sending.',
      support: `Link a Google Workspace account in CraftBot settings. Until then, drafts and schedules work but sends will fail.`,
    }
  }

  // Imminent scheduled
  const next = scheduled[0]
  if (next && next.scheduledAt && new Date(next.scheduledAt).getTime() - Date.now() < DAY) {
    const h = Math.max(1, Math.round((new Date(next.scheduledAt).getTime() - Date.now()) / 3_600_000))
    return {
      headline: `${next.name} sends in ${h} ${h === 1 ? 'hour' : 'hours'}.`,
      support: `Heading to ${next.totalRecipients.toLocaleString()} contacts. Make sure the draft looks the way you want.`,
    }
  }

  // Above-average recent send
  if (recentSends.length >= 2) {
    const latest = recentSends[0]
    const latestRate = latest.opensUnique / Math.max(1, latest.sentCount)
    const prior = recentSends.slice(1)
    const trailing =
      prior.reduce((a, c) => a + c.opensUnique / Math.max(1, c.sentCount), 0) /
      prior.length
    if (latestRate > trailing * 1.1) {
      const lift = ((latestRate - trailing) * 100).toFixed(0)
      return {
        headline: `${latest.name} opened ${(latestRate * 100).toFixed(0)}% — your best recent send.`,
        support: `That's ${lift}% above your trailing average. Whatever you did, do it again.`,
      }
    }
  }

  // Recent growth
  const ov = dashboard.overview
  if (ov.subscribers.newLast30Days > 0) {
    const base = Math.max(ov.subscribers.total - ov.subscribers.newLast30Days, 0)
    const pct = base > 0 ? (ov.subscribers.newLast30Days / base) * 100 : 100
    return {
      headline: `You've grown by ${ov.subscribers.newLast30Days.toLocaleString()} subscribers this month.`,
      support: `That's a ${pct.toFixed(0)}% lift on the ${base.toLocaleString()} contacts you started with.`,
    }
  }

  if (drafts.length > 0) {
    return {
      headline: `${drafts.length} ${drafts.length === 1 ? 'draft is' : 'drafts are'} waiting.`,
      support: 'Pick one up and ship it.',
    }
  }

  if (ov.subscribers.total === 0) {
    return {
      headline: "It's quiet in here.",
      support: 'Add your first subscriber to get going — paste a CSV or type an email.',
    }
  }

  return {
    headline: 'Quiet day.',
    support: 'Nothing scheduled and no drafts in progress. A good moment to plan the next send.',
  }
}

// ===========================================================================
// 2. CAMPAIGNS — incorporates both drafts and scheduled in one panel
// ===========================================================================

type CampaignKind = 'draft' | 'scheduled'

function CampaignsPanel({
  drafts,
  scheduled,
  onOpen,
  onNew,
}: {
  drafts: Campaign[]
  scheduled: Campaign[]
  onOpen: (id: number) => void
  onNew: () => void
}) {
  // Scheduled first (soonest to send first), then drafts (most recently edited first).
  const rows: { campaign: Campaign; kind: CampaignKind }[] = [
    ...scheduled.map((c) => ({ campaign: c, kind: 'scheduled' as const })),
    ...drafts.map((c) => ({ campaign: c, kind: 'draft' as const })),
  ].slice(0, 6)

  const totalCount = drafts.length + scheduled.length

  return (
    <Panel
      label={
        totalCount > 0
          ? `Campaigns · ${scheduled.length} scheduled · ${drafts.length} drafts`
          : 'Campaigns'
      }
      action={
        <ActionLink onClick={onNew}>
          New <FiPlus size={11} />
        </ActionLink>
      }
    >
      {rows.length === 0 ? (
        <EmptyLine>
          Nothing in progress. Start a new campaign or pick a Quick Start template below.
        </EmptyLine>
      ) : (
        <List>
          {rows.map(({ campaign: c, kind }) => (
            <CampaignRow
              key={`${kind}-${c.id}`}
              campaign={c}
              kind={kind}
              onClick={() => onOpen(c.id)}
            />
          ))}
        </List>
      )}
    </Panel>
  )
}

function CampaignRow({
  campaign: c,
  kind,
  onClick,
}: {
  campaign: Campaign
  kind: CampaignKind
  onClick: () => void
}) {
  const sub =
    kind === 'scheduled'
      ? `${c.totalRecipients.toLocaleString()} contacts`
      : c.subject || 'No subject yet'
  const meta =
    kind === 'scheduled' ? relFuture(c.scheduledAt!) : relPast(c.updatedAt)

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gap: 'var(--space-3)',
        alignItems: 'center',
        padding: '10px 4px',
        borderBottom: '1px solid var(--border-primary)',
        cursor: 'pointer',
        transition: 'var(--transition-fast)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <StatusPill kind={kind} />
      <RowMain title={c.name} sub={sub} />
      <RowMeta>{meta}</RowMeta>
    </li>
  )
}

function StatusPill({ kind }: { kind: CampaignKind }) {
  const isSched = kind === 'scheduled'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        padding: '3px 7px',
        borderRadius: 4,
        background: isSched ? 'var(--bg-tertiary)' : 'transparent',
        color: isSched ? 'var(--text-primary)' : 'var(--text-muted)',
        border: isSched ? '1px solid var(--border-primary)' : '1px solid var(--border-primary)',
        whiteSpace: 'nowrap',
      }}
    >
      {isSched ? 'Scheduled' : 'Draft'}
    </span>
  )
}

// ===========================================================================
// 4. QUICK START
// ===========================================================================

function pickQuickStart(templates: Template[]): Template[] {
  // 1. Templates the user has actually used (usageCount > 0), most-used first
  const used = templates
    .filter((t) => (t.usageCount || 0) > 0)
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))

  // 2. Back-fill with a curated set of built-ins (by name) for first-time users.
  const curated = ['Welcome new subscriber', 'Weekly newsletter', 'Limited-time promotion', 'Monthly digest']
  const backfill = curated
    .map((n) => templates.find((t) => t.name === n && t.isBuiltin))
    .filter((t): t is Template => !!t)

  // 3. If even curated isn't seeded yet, fall back to any built-in.
  const fallback = templates.filter((t) => t.isBuiltin)

  const out: Template[] = []
  const seen = new Set<number>()
  for (const t of [...used, ...backfill, ...fallback]) {
    if (out.length >= 4) break
    if (seen.has(t.id)) continue
    seen.add(t.id)
    out.push(t)
  }
  return out
}

function QuickStartPanel({
  templates,
  onUse,
}: {
  templates: Template[]
  onUse: (templateId: number) => void
}) {
  return (
    <Panel label="Quick start">
      {templates.length === 0 ? (
        <EmptyLine>Templates will appear here once they load.</EmptyLine>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-2)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          }}
        >
          {templates.map((t) => {
            const Icon = ICON_MAP[t.icon] || FiMail
            const used = (t.usageCount || 0) > 0
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onUse(t.id)}
                title={t.subject || t.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '12px',
                  background: 'transparent',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  color: 'var(--text-primary)',
                  transition: 'var(--transition-fast)',
                  minHeight: 84,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-tertiary)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Icon size={16} style={{ color: 'var(--text-secondary)' }} />
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {t.name}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginTop: 'auto',
                  }}
                >
                  {used ? `Used ${t.usageCount}×` : t.isBuiltin ? 'Built-in' : 'Custom'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

// ===========================================================================
// 5. RECENT SENDS
// ===========================================================================

function RecentSendsPanel({
  recent,
  onOpen,
}: {
  recent: Campaign[]
  onOpen: (id: number) => void
}) {
  return (
    <Panel label="Recent sends">
      {recent.length === 0 ? (
        <EmptyLine>No sends yet. Once you ship one, its stats show here.</EmptyLine>
      ) : (
        <List>
          {recent.slice(0, 4).map((c) => {
            const open = c.opensUnique / Math.max(1, c.sentCount)
            const click = c.clicksUnique / Math.max(1, c.sentCount)
            return (
              <Row key={c.id} onClick={() => onOpen(c.id)}>
                <RowMain title={c.name} sub={`${c.sentCount.toLocaleString()} sent`} />
                <RowMeta>
                  <span style={{ display: 'inline-flex', gap: 10 }}>
                    <span>
                      <strong style={{ color: 'var(--text-primary)' }}>{(open * 100).toFixed(0)}%</strong>{' '}
                      <span style={{ color: 'var(--text-muted)' }}>opens</span>
                    </span>
                    <span>
                      <strong style={{ color: 'var(--text-primary)' }}>{(click * 100).toFixed(0)}%</strong>{' '}
                      <span style={{ color: 'var(--text-muted)' }}>clicks</span>
                    </span>
                  </span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--text-muted)' }}>
                    {relPast(c.sentAt)}
                  </span>
                </RowMeta>
              </Row>
            )
          })}
        </List>
      )}
    </Panel>
  )
}

// ===========================================================================
// 6. GROWTH CHART
// ===========================================================================

function GrowthChartPanel({
  subscribers,
  campaigns,
  onEditCampaign,
}: {
  subscribers: Subscriber[]
  campaigns: Campaign[]
  onEditCampaign: (id: number) => void
}) {
  const PAST = 30
  const FUTURE = 14
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const start = useMemo(() => new Date(today.getTime() - PAST * DAY), [today])
  const end = useMemo(() => new Date(today.getTime() + (FUTURE + 1) * DAY), [today])
  const span = end.getTime() - start.getTime()

  const growth = useMemo(() => {
    const pts: { t: number; count: number }[] = []
    for (let i = 0; i <= PAST; i++) {
      const dayEnd = new Date(start.getTime() + i * DAY)
      dayEnd.setHours(23, 59, 59, 999)
      const count = subscribers.filter(
        (s) => s.createdAt && new Date(s.createdAt).getTime() <= dayEnd.getTime(),
      ).length
      pts.push({ t: dayEnd.getTime(), count })
    }
    return pts
  }, [subscribers, start])

  const maxCount = Math.max(...growth.map((p) => p.count), 1)
  const endCount = growth[growth.length - 1]?.count ?? 0

  const pastSends = campaigns.filter(
    (c) =>
      c.status === 'sent' &&
      c.sentAt &&
      new Date(c.sentAt).getTime() >= start.getTime() &&
      new Date(c.sentAt).getTime() <= today.getTime(),
  )
  const futureSends = campaigns.filter(
    (c) =>
      c.status === 'scheduled' &&
      c.scheduledAt &&
      new Date(c.scheduledAt).getTime() >= today.getTime() &&
      new Date(c.scheduledAt).getTime() <= end.getTime(),
  )
  const maxAudience = Math.max(
    ...[...pastSends, ...futureSends].map((c) => c.totalRecipients || c.sentCount || 0),
    1,
  )

  // Render the SVG at its actual rendered width so circles / text don't get
  // stretched by preserveAspectRatio.
  const containerRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(800)
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(320, Math.floor(e.contentRect.width))
        setW(w)
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const H = 200
  const padX = 24
  const padTop = 20
  const padBottom = 28
  const plotW = Math.max(0, W - padX * 2)
  const plotH = H - padTop - padBottom

  const xAt = (t: number) => padX + ((t - start.getTime()) / span) * plotW
  const yAt = (count: number) => padTop + plotH - (count / maxCount) * plotH

  const linePts = growth.map((p) => `${xAt(p.t)},${yAt(p.count)}`)
  const linePtsStr = linePts.join(' L ')
  const areaPath =
    linePts.length > 0
      ? `M ${padX},${padTop + plotH} L ${linePtsStr} L ${xAt(today.getTime())},${padTop + plotH} Z`
      : ''
  const linePath = linePts.length > 0 ? `M ${linePtsStr}` : ''

  const dotR = (audience: number) => 3.5 + (audience / maxAudience) * 6

  return (
    <Panel
      label="Subscriber growth & send activity"
      action={
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{endCount.toLocaleString()}</strong> contacts today
        </span>
      }
    >
      <div ref={containerRef} style={{ width: '100%' }}>
      <svg
        width={W}
        height={H}
        style={{ display: 'block' }}
        role="img"
        aria-label="Subscriber growth and send activity timeline"
      >
        {/* baseline */}
        <line
          x1={padX}
          x2={W - padX}
          y1={padTop + plotH}
          y2={padTop + plotH}
          stroke="var(--border-primary)"
        />
        {/* area + line */}
        <path d={areaPath} fill="var(--bg-tertiary)" />
        <path d={linePath} fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

        {/* today line — single orange accent */}
        <line
          x1={xAt(today.getTime())}
          x2={xAt(today.getTime())}
          y1={padTop}
          y2={padTop + plotH}
          stroke="var(--color-primary)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={xAt(today.getTime())}
          y={padTop - 4}
          textAnchor="middle"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.6,
            fill: 'var(--color-primary)',
          }}
        >
          TODAY
        </text>

        {/* axis ticks: start, today, end */}
        <text x={padX} y={padTop + plotH + 16} style={{ fontSize: 10, fill: 'var(--text-muted)' }}>
          30 days ago
        </text>
        <text
          x={W - padX}
          y={padTop + plotH + 16}
          textAnchor="end"
          style={{ fontSize: 10, fill: 'var(--text-muted)' }}
        >
          +2 weeks
        </text>

        {/* past send dots */}
        {pastSends.map((c) => {
          const t = new Date(c.sentAt!).getTime()
          const r = dotR(c.totalRecipients || c.sentCount || 0)
          const closest = growth.reduce((prev, p) =>
            Math.abs(p.t - t) < Math.abs(prev.t - t) ? p : prev,
          )
          return (
            <g key={`p-${c.id}`} style={{ cursor: 'pointer' }} onClick={() => onEditCampaign(c.id)}>
              <title>
                {`${c.name} · sent ${new Date(t).toLocaleDateString()} · ${c.opensUnique || 0}/${c.sentCount || 0} opens`}
              </title>
              <circle cx={xAt(t)} cy={yAt(closest.count) - r - 4} r={r} fill="var(--text-primary)" />
            </g>
          )
        })}

        {/* future send dots */}
        {futureSends.map((c) => {
          const t = new Date(c.scheduledAt!).getTime()
          const r = dotR(c.totalRecipients || 0)
          const y = yAt(endCount) - r - 4
          return (
            <g key={`f-${c.id}`} style={{ cursor: 'pointer' }} onClick={() => onEditCampaign(c.id)}>
              <title>
                {`${c.name} · scheduled ${new Date(t).toLocaleString()} · ${c.totalRecipients || 0} recipients`}
              </title>
              <circle
                cx={xAt(t)}
                cy={y}
                r={r}
                fill="var(--bg-secondary)"
                stroke="var(--text-primary)"
                strokeWidth={1.5}
              />
            </g>
          )
        })}
      </svg>
      </div>
    </Panel>
  )
}

// ===========================================================================
// 7. AUDIENCE
// ===========================================================================

function AudiencePanel({
  dashboard,
  onOpen,
}: {
  dashboard: DashboardData | null
  onOpen: () => void
}) {
  if (!dashboard) return null
  const s = dashboard.overview.subscribers
  const total = s.total
  const seg = [
    { label: 'subscribed', value: s.active, color: 'var(--text-primary)' },
    { label: 'unsubscribed', value: s.unsubscribed, color: 'var(--text-muted)' },
    { label: 'bounced', value: s.bounced, color: 'var(--color-warning)' },
  ]
  return (
    <Panel
      label="Audience"
      action={
        <ActionLink onClick={onOpen}>
          Manage <FiArrowRight size={11} />
        </ActionLink>
      }
    >
      {total === 0 ? (
        <EmptyLine>Add your first subscriber to populate this.</EmptyLine>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
            Of <strong style={{ color: 'var(--text-primary)' }}>{total.toLocaleString()}</strong> contacts:{' '}
            {seg
              .map((x) => `${((x.value / total) * 100).toFixed(0)}% ${x.label}`)
              .join(' · ')}
            .
          </p>
          <div
            style={{
              display: 'flex',
              height: 8,
              borderRadius: 4,
              overflow: 'hidden',
              gap: 1,
              background: 'var(--bg-tertiary)',
            }}
          >
            {seg.map((x) => {
              if (!x.value) return null
              return (
                <div
                  key={x.label}
                  style={{
                    flex: x.value,
                    background: x.color,
                  }}
                  title={`${x.value.toLocaleString()} ${x.label}`}
                />
              )
            })}
          </div>
        </>
      )}
    </Panel>
  )
}

// ===========================================================================
// Shared row primitives — used for Drafts / Scheduled / Recent Sends
// ===========================================================================

function List({ children }: { children: React.ReactNode }) {
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </ul>
  )
}

function Row({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <li
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 'var(--space-3)',
        alignItems: 'center',
        padding: '10px 4px',
        borderBottom: '1px solid var(--border-primary)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'var(--transition-fast)',
      }}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.background = 'var(--bg-tertiary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </li>
  )
}

function RowMain({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

function RowMeta({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        textAlign: 'right',
        fontSize: 12,
        color: 'var(--text-secondary)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
      {children}
    </div>
  )
}

function ActionLink({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'transparent',
        border: 'none',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        padding: 0,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
    >
      {children}
    </button>
  )
}

// ===========================================================================
// Date helpers
// ===========================================================================

function relPast(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`
  if (diff < DAY) return `${Math.round(diff / 3_600_000)}h ago`
  if (diff < 7 * DAY) {
    const d = Math.round(diff / DAY)
    return `${d} ${d === 1 ? 'day' : 'days'} ago`
  }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function relFuture(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 3_600_000) return `in ${Math.max(1, Math.round(diff / 60_000)) } min`
  if (diff < DAY) return `in ${Math.round(diff / 3_600_000)}h`
  const d = Math.max(1, Math.round(diff / DAY))
  return `in ${d} ${d === 1 ? 'day' : 'days'}`
}
