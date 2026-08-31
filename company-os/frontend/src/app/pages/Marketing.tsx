/**
 * Marketing: a small-business marketing command center built on the pieces a
 * real marketing system needs — campaigns as the organizing unit (a funnel
 * GOAL + budget + spend + target + result), a content pipeline on a calendar
 * (idea → draft → scheduled → published), channels with a spend mix, and plain
 * computed readings: cost per customer and return on spend, wired to the Money
 * and Customers modules. Still records & plans only — no sending, no posting —
 * with optional CraftBot AI to draft campaign ideas and content copy.
 *
 * Design language reused wholesale from the ui/viz kit: one accent, status as
 * color only, tabular numbers, hover actions, honest empty states.
 */
import { useMemo, useState } from 'react';
import { BadgePlus, CalendarDays, Lightbulb, Megaphone, Plus, Radio, Sparkles, Wallet } from 'lucide-react';
import {
  Button,
  Dialog,
  EntityForm,
  NumberInput,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  getPbClient,
  toast,
  useCollection,
  useConfirm,
  cn,
} from '../../kit/index.ts';
import type { EntityField } from '../../kit/index.ts';
import type {
  Campaign,
  CampaignGoal,
  CampaignStatus,
  Channel,
  ContentFormat,
  ContentStatus,
  Customer,
  MoneyEntry,
  Promo,
  Vocab,
} from '../lib/types.ts';
import { CAMPAIGN_GOALS } from '../lib/types.ts';
import {
  DeleteButton,
  EditButton,
  GhostCards,
  GhostRows,
  GhostState,
  GroupHeader,
  IdentityChip,
  ListRow,
  PageHeader,
  Pill,
  ProgressRing,
  RelDate,
  StatTile,
  fmtMoney,
  type Tone,
} from '../components/ui.tsx';
import { MonthCalendar, type CalEvent } from '../components/viz.tsx';
import { callOp, OpError } from '../lib/ops.ts';
import { todayStr } from '../lib/useCompany.ts';

/* ------------------------------------------------------------------ */
/* Vocabulary: goals, statuses, formats                                */
/* ------------------------------------------------------------------ */

const GOAL_META: Record<CampaignGoal, { label: string; tone: Tone; blurb: string; unit: string; money: boolean }> = {
  awareness: { label: 'Get known', tone: 'info', blurb: 'Reach new people who have never heard of you.', unit: 'reached', money: false },
  leads: { label: 'Get leads', tone: 'accent', blurb: 'Turn strangers into people who show interest.', unit: 'leads', money: false },
  sales: { label: 'Get sales', tone: 'good', blurb: 'Turn interest into money in.', unit: 'in sales', money: true },
  loyalty: { label: 'Keep customers', tone: 'warn', blurb: 'Repeat business and referrals from people you already won.', unit: 'repeat', money: false },
};

const CAMPAIGN_STATUS_META: Record<CampaignStatus, { label: string; tone: Tone }> = {
  planned: { label: 'Planned', tone: 'neutral' },
  active: { label: 'Active', tone: 'accent' },
  paused: { label: 'Paused', tone: 'warn' },
  done: { label: 'Done', tone: 'good' },
};
const CAMPAIGN_STATUS_ORDER: CampaignStatus[] = ['active', 'planned', 'paused', 'done'];

const CONTENT_STATUS_META: Record<ContentStatus, { label: string; tone: Tone }> = {
  idea: { label: 'Idea', tone: 'neutral' },
  draft: { label: 'Draft', tone: 'info' },
  scheduled: { label: 'Scheduled', tone: 'accent' },
  published: { label: 'Published', tone: 'good' },
};
const CONTENT_STATUS_ORDER: ContentStatus[] = ['idea', 'draft', 'scheduled', 'published'];
const CONTENT_NEXT: Record<ContentStatus, ContentStatus | null> = {
  idea: 'draft',
  draft: 'scheduled',
  scheduled: 'published',
  published: null,
};

const FORMAT_LABEL: Record<ContentFormat, string> = {
  post: 'Post',
  email: 'Email',
  ad: 'Ad',
  article: 'Article',
  event: 'Event',
  other: 'Other',
};

/* ------------------------------------------------------------------ */
/* Form field definitions                                              */
/* ------------------------------------------------------------------ */

const CAMPAIGN_FIELDS: EntityField[] = [
  { name: 'name', type: 'text', required: true, placeholder: 'e.g. Spring launch, Referral push' },
  {
    name: 'goal',
    type: 'select',
    required: true,
    options: CAMPAIGN_GOALS.map((g) => ({ value: g, label: GOAL_META[g].label })),
  },
  {
    name: 'status',
    type: 'select',
    required: true,
    options: (Object.keys(CAMPAIGN_STATUS_META) as CampaignStatus[]).map((s) => ({ value: s, label: CAMPAIGN_STATUS_META[s].label })),
  },
  { name: 'channel', label: 'Main channel', type: 'ref', ref: { collection: 'channels', labelField: 'name' } },
  { name: 'start', type: 'date' },
  { name: 'end', type: 'date' },
  { name: 'budget', label: 'Budget (planned spend)', type: 'number' },
  { name: 'spend', label: 'Spent so far', type: 'number' },
  { name: 'target', label: 'Target number (e.g. 20 leads)', type: 'number' },
  { name: 'result', label: 'Result so far', type: 'number' },
  { name: 'note', type: 'textarea' },
];

const CONTENT_FIELDS: EntityField[] = [
  { name: 'title', type: 'text', required: true, placeholder: 'e.g. Behind-the-scenes reel' },
  { name: 'campaign', type: 'ref', ref: { collection: 'campaigns', labelField: 'name' } },
  { name: 'channel', type: 'ref', ref: { collection: 'channels', labelField: 'name' } },
  {
    name: 'format',
    type: 'select',
    options: (Object.keys(FORMAT_LABEL) as ContentFormat[]).map((f) => ({ value: f, label: FORMAT_LABEL[f] })),
  },
  { name: 'date', label: 'Publish date', type: 'date' },
  {
    name: 'status',
    type: 'select',
    required: true,
    options: CONTENT_STATUS_ORDER.map((s) => ({ value: s, label: CONTENT_STATUS_META[s].label })),
  },
  { name: 'note', label: 'Copy / notes', type: 'textarea' },
];

const CHANNEL_FIELDS: EntityField[] = [
  { name: 'name', type: 'text', required: true, placeholder: 'e.g. Instagram, flyers, referrals' },
  { name: 'monthly_cost', label: 'Cost per month', type: 'number' },
  { name: 'active', label: 'Currently using it', type: 'boolean' },
  { name: 'note', label: 'What it brings you', type: 'textarea' },
];

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const DAY = 24 * 3600 * 1000;
const dstr = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function formatResult(goal: CampaignGoal, n: number): string {
  if (n === 0) return '0';
  return GOAL_META[goal].money ? fmtMoney(n) : String(n);
}

function fmtRange(start: string, end: string): string {
  const f = (iso: string): string =>
    new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (start === '' && end === '') return 'No dates';
  if (start !== '' && end !== '') return `${f(start)} – ${f(end)}`;
  return start !== '' ? `from ${f(start)}` : `until ${f(end)}`;
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export function MarketingPage({ vocab }: { vocab: Vocab }): React.JSX.Element {
  const { records: campaigns } = useCollection<Campaign>('campaigns', { sort: '-created' });
  const { records: channels } = useCollection<Channel>('channels', { sort: 'name' });
  const { records: content } = useCollection<Promo>('promos', { sort: '-date' });
  const { records: money } = useCollection<MoneyEntry>('money_entries');
  const { records: customers } = useCollection<Customer>('customers');
  const [confirmEl, confirm] = useConfirm();

  // Dialog state
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [campaignDefaults, setCampaignDefaults] = useState<Record<string, unknown>>({});
  const [contentOpen, setContentOpen] = useState(false);
  const [editingContent, setEditingContent] = useState<Promo | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [spendFor, setSpendFor] = useState<Campaign | null>(null);
  const [goalFilter, setGoalFilter] = useState<CampaignGoal | 'all'>('all');

  const channelName = (id: string): string => channels.find((c) => c.id === id)?.name ?? '';
  const campaignName = (id: string): string => campaigns.find((c) => c.id === id)?.name ?? '';

  /* ---------- Derived metrics (wired to Money + Customers) ---------- */
  const metrics = useMemo(() => {
    const activeChannels = channels.filter((c) => c.active);
    const monthlyChannelCost = activeChannels.reduce((s, c) => s + (c.monthly_cost || 0), 0);
    const campaignSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
    const totalBudget = campaigns.reduce((s, c) => s + (c.budget || 0), 0);

    const since90 = dstr(Date.now() - 90 * DAY);
    const newCustomers = customers.filter((c) => (c.created ?? '').slice(0, 10) >= since90).length;
    const salesIn90 = money
      .filter((m) => m.kind === 'in' && m.date.slice(0, 10) >= since90)
      .reduce((s, m) => s + m.amount, 0);
    const campaignSpend90 = campaigns
      .filter((c) => c.start === '' || c.start.slice(0, 10) >= since90)
      .reduce((s, c) => s + (c.spend || 0), 0);
    const spendBasis90 = monthlyChannelCost * 3 + campaignSpend90;

    const cac = newCustomers > 0 && spendBasis90 > 0 ? spendBasis90 / newCustomers : null;
    const ros = spendBasis90 > 0 ? salesIn90 / spendBasis90 : null;

    return { activeChannels, monthlyChannelCost, campaignSpend, totalBudget, newCustomers, cac, ros, spendBasis90, salesIn90 };
  }, [channels, campaigns, customers, money]);

  const custWord = vocab.customer_one.toLowerCase();

  /* ---------- Mutations ---------- */
  const setCampaignStatus = async (c: Campaign, status: CampaignStatus): Promise<void> => {
    await getPbClient().call((pb) => pb.collection('campaigns').update(c.id, { status })).catch(() => undefined);
  };
  const deleteCampaign = async (c: Campaign): Promise<void> => {
    if (!(await confirm(`Delete campaign "${c.name}"?`))) return;
    await getPbClient().call((pb) => pb.collection('campaigns').delete(c.id)).catch(() => undefined);
  };
  const setContentStatus = async (p: Promo, status: ContentStatus): Promise<void> => {
    await getPbClient().call((pb) => pb.collection('promos').update(p.id, { status })).catch(() => undefined);
  };
  const deleteContent = async (p: Promo): Promise<void> => {
    if (!(await confirm(`Delete "${p.title}"?`))) return;
    await getPbClient().call((pb) => pb.collection('promos').delete(p.id)).catch(() => undefined);
  };
  const deleteChannel = async (c: Channel): Promise<void> => {
    if (!(await confirm(`Delete channel "${c.name}"?`))) return;
    await getPbClient().call((pb) => pb.collection('channels').delete(c.id)).catch(() => undefined);
  };

  const draftCopy = async (p: Promo): Promise<void> => {
    try {
      const res = await callOp<{ copy: string; saved: boolean }>('/api/ops/ai-content-draft', { promoId: p.id });
      if (res.saved) toast.success('Draft copy written into the notes. Edit until it sounds like you.');
      else {
        await getPbClient().call((pb) => pb.collection('promos').update(p.id, { note: res.copy })).catch(() => undefined);
        toast.success('Draft copy ready. Edit until it sounds like you.');
      }
    } catch (err) {
      if (err instanceof OpError && err.status === 503) toast.info('AI assist unavailable — write the copy yourself for now.');
      else toast.error(err instanceof Error ? err.message : 'Draft failed');
    }
  };

  const openNewCampaign = (defaults: Record<string, unknown>): void => {
    setEditingCampaign(null);
    setCampaignDefaults(defaults);
    setCampaignOpen(true);
  };

  /* ---------- Content calendar events ---------- */
  const calEvents: CalEvent[] = content
    .filter((p) => p.date !== '')
    .map((p) => ({ key: p.id, date: p.date, title: p.title, kind: 'promo', page: p.id }));
  const openContentById = (id: string): void => {
    const p = content.find((c) => c.id === id);
    if (p !== undefined) {
      setEditingContent(p);
      setContentOpen(true);
    }
  };

  const filteredCampaigns = goalFilter === 'all' ? campaigns : campaigns.filter((c) => c.goal === goalFilter);

  return (
    <div>
      <PageHeader
        icon={Megaphone}
        title="Marketing"
        meta={campaigns.length > 0 ? `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}` : undefined}
        subtitle="Plan campaigns, run a content calendar, and watch what your channels cost versus what they bring. One channel done well beats five done halfway."
      />

      {/* ---------- KPI strip ---------- */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Channel spend"
          value={`${fmtMoney(metrics.monthlyChannelCost)}/mo`}
          tone="neutral"
          sub={`${metrics.activeChannels.length} active channel${metrics.activeChannels.length === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Campaign spend"
          value={fmtMoney(metrics.campaignSpend)}
          tone="neutral"
          sub={metrics.totalBudget > 0 ? `of ${fmtMoney(metrics.totalBudget)} budgeted` : 'no budgets set'}
        />
        <StatTile
          label={`Cost per ${custWord}`}
          value={metrics.cac !== null ? fmtMoney(Math.round(metrics.cac)) : '—'}
          tone="accent"
          sub={metrics.cac !== null ? `${metrics.newCustomers} new in 90 days` : 'needs spend + new customers'}
        />
        <StatTile
          label="Return on spend"
          value={metrics.ros !== null ? `${metrics.ros.toFixed(1)}×` : '—'}
          tone={metrics.ros !== null ? (metrics.ros >= 1 ? 'good' : 'bad') : 'neutral'}
          sub={metrics.ros !== null ? 'sales per $1, last 90 days' : 'needs spend + sales'}
        />
      </div>
      <p className="mb-5 max-w-2xl text-[13px] leading-relaxed text-[var(--lui-muted)]">
        {readingSentence(metrics, custWord)}
      </p>

      <Tabs defaultValue="content">
        <TabsList className="mb-4">
          <TabsTrigger value="campaigns" className="inline-flex items-center gap-1.5">
            <Megaphone size={14} aria-hidden />
            Campaigns
          </TabsTrigger>
          <TabsTrigger value="content" className="inline-flex items-center gap-1.5">
            <CalendarDays size={14} aria-hidden />
            Content calendar
          </TabsTrigger>
          <TabsTrigger value="channels" className="inline-flex items-center gap-1.5">
            <Radio size={14} aria-hidden />
            Channels
          </TabsTrigger>
          <TabsTrigger value="insights" className="inline-flex items-center gap-1.5">
            <Lightbulb size={14} aria-hidden />
            Insights
          </TabsTrigger>
        </TabsList>

        {/* ============ CAMPAIGNS ============ */}
        <TabsContent value="campaigns">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              <GoalChip active={goalFilter === 'all'} onClick={() => setGoalFilter('all')} tone="neutral">
                All
              </GoalChip>
              {CAMPAIGN_GOALS.map((g) => (
                <GoalChip key={g} active={goalFilter === g} onClick={() => setGoalFilter(g)} tone={GOAL_META[g].tone}>
                  {GOAL_META[g].label}
                </GoalChip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setIdeasOpen(true)}>
                <Sparkles size={14} aria-hidden />
                Suggest ideas
              </Button>
              <Button size="sm" onClick={() => openNewCampaign({ status: 'planned', goal: goalFilter === 'all' ? 'leads' : goalFilter, start: todayStr() })}>
                <Plus size={14} aria-hidden />
                New campaign
              </Button>
            </div>
          </div>

          {campaigns.length === 0 ? (
            <GhostState
              icon={Megaphone}
              title="No campaigns yet"
              message="A campaign is one focused push toward a goal — get known, get leads, get sales, or keep customers — with a budget and a target. Start one, or let CraftBot suggest a few."
              action={
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setIdeasOpen(true)}>
                    <Sparkles size={14} aria-hidden />
                    Suggest ideas
                  </Button>
                  <Button onClick={() => openNewCampaign({ status: 'planned', goal: 'leads', start: todayStr() })}>
                    New campaign
                  </Button>
                </div>
              }
            >
              <GhostCards count={2} columns={2} />
            </GhostState>
          ) : filteredCampaigns.length === 0 ? (
            <p className="border border-dashed border-[var(--lui-border)] px-4 py-10 text-center text-sm text-[var(--lui-muted)]">
              No campaigns for this goal yet.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {CAMPAIGN_STATUS_ORDER.map((status) => {
                const group = filteredCampaigns.filter((c) => c.status === status);
                if (group.length === 0) return null;
                return (
                  <div key={status}>
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--lui-muted)]">
                        {CAMPAIGN_STATUS_META[status].label}
                      </h3>
                      <span className="text-[11px] tabular-nums text-[var(--lui-muted)]">{group.length}</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {group.map((c) => (
                        <CampaignCard
                          key={c.id}
                          campaign={c}
                          channelName={channelName(c.channel)}
                          contentCount={content.filter((p) => p.campaign === c.id).length}
                          onEdit={() => {
                            setEditingCampaign(c);
                            setCampaignOpen(true);
                          }}
                          onRecordSpend={() => setSpendFor(c)}
                          onSetStatus={(s) => void setCampaignStatus(c, s)}
                          onDelete={() => void deleteCampaign(c)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ============ CONTENT CALENDAR ============ */}
        <TabsContent value="content">
          <div className="mb-3 flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                setEditingContent(null);
                setContentOpen(true);
              }}
            >
              <Plus size={14} aria-hidden />
              Add content
            </Button>
          </div>

          {/* The calendar is the point of this tab — always show it, even empty. */}
          <div className="mb-4 border border-[var(--lui-border)] bg-[var(--lui-surface)] p-4">
            <MonthCalendar events={calEvents} onOpen={openContentById} />
          </div>

          {content.length === 0 ? (
            <div className="flex flex-col items-center gap-3 border border-dashed border-[var(--lui-border)] px-6 py-8 text-center">
              <p className="text-sm font-medium">Nothing planned yet</p>
              <p className="max-w-sm text-[13px] leading-relaxed text-[var(--lui-muted)]">
                Pick one channel, one message, one date. Content moves from idea to draft to scheduled to published — small and
                real beats big and vague.
              </p>
              <Button
                onClick={() => {
                  setEditingContent(null);
                  setContentOpen(true);
                }}
              >
                <Plus size={14} aria-hidden />
                Plan a piece
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {CONTENT_STATUS_ORDER.map((status) => {
                const group = content.filter((p) => p.status === status);
                if (group.length === 0) return null;
                return (
                  <div key={status} className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
                    <GroupHeader label={CONTENT_STATUS_META[status].label} count={group.length} />
                    {group.map((p) => {
                      const next = CONTENT_NEXT[p.status];
                      const fmt = (p.format || '') as ContentFormat | '';
                      return (
                        <ListRow
                          key={p.id}
                          leading={<IdentityChip name={p.title} square />}
                          primary={p.title}
                          secondary={
                            [channelName(p.channel) !== '' ? `on ${channelName(p.channel)}` : '', campaignName(p.campaign)]
                              .filter((s) => s !== '')
                              .join(' · ') || undefined
                          }
                          trailing={
                            <>
                              {fmt !== '' && (
                                <span className="hidden text-[11px] uppercase tracking-wide text-[var(--lui-muted)] sm:inline">
                                  {FORMAT_LABEL[fmt]}
                                </span>
                              )}
                              <RelDate iso={p.date} className="w-16 text-right" />
                              <Pill tone={CONTENT_STATUS_META[p.status].tone}>{CONTENT_STATUS_META[p.status].label}</Pill>
                            </>
                          }
                          hoverActions={
                            <>
                              {next !== null && (
                                <Button variant="ghost" size="sm" onClick={() => void setContentStatus(p, next)}>
                                  → {CONTENT_STATUS_META[next].label}
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => void draftCopy(p)}>
                                <Sparkles size={13} aria-hidden />
                                Draft copy
                              </Button>
                              <EditButton
                                onClick={() => {
                                  setEditingContent(p);
                                  setContentOpen(true);
                                }}
                              />
                              <DeleteButton onClick={() => void deleteContent(p)} />
                            </>
                          }
                          onClick={() => {
                            setEditingContent(p);
                            setContentOpen(true);
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ============ CHANNELS ============ */}
        <TabsContent value="channels">
          <div className="mb-3 flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                setEditingChannel(null);
                setChannelOpen(true);
              }}
            >
              <Plus size={14} aria-hidden />
              Add channel
            </Button>
          </div>

          {channels.length === 0 ? (
            <GhostState
              icon={Radio}
              title="No channels yet"
              message="Where could your next customer come from? Add that channel and what it costs you — then hang campaigns and content off it."
              action={
                <Button
                  onClick={() => {
                    setEditingChannel(null);
                    setChannelOpen(true);
                  }}
                >
                  Add a channel
                </Button>
              }
            >
              <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
                <GhostRows rows={4} />
              </div>
            </GhostState>
          ) : (
            <>
              <ChannelMix channels={metrics.activeChannels} />
              <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
                {channels.map((c) => {
                  const camps = campaigns.filter((k) => k.channel === c.id).length;
                  const pieces = content.filter((p) => p.channel === c.id).length;
                  return (
                    <ListRow
                      key={c.id}
                      leading={<IdentityChip name={c.name} square />}
                      primary={c.name}
                      secondary={c.note !== '' ? c.note : undefined}
                      trailing={
                        <>
                          <span className="hidden text-xs tabular-nums text-[var(--lui-muted)] sm:inline">
                            {camps} campaign{camps === 1 ? '' : 's'} · {pieces} piece{pieces === 1 ? '' : 's'}
                          </span>
                          <span className="w-16 text-right text-xs tabular-nums text-[var(--lui-muted)]">
                            {c.monthly_cost > 0 ? `${fmtMoney(c.monthly_cost)}/mo` : 'free'}
                          </span>
                          <Pill tone={c.active ? 'good' : 'neutral'}>{c.active ? 'Active' : 'Paused'}</Pill>
                        </>
                      }
                      hoverActions={
                        <>
                          <EditButton
                            onClick={() => {
                              setEditingChannel(c);
                              setChannelOpen(true);
                            }}
                          />
                          <DeleteButton onClick={() => void deleteChannel(c)} />
                        </>
                      }
                      onClick={() => {
                        setEditingChannel(c);
                        setChannelOpen(true);
                      }}
                    />
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>

        {/* ============ INSIGHTS ============ */}
        <TabsContent value="insights">
          <GoalCoverage campaigns={campaigns} onNewForGoal={(g) => openNewCampaign({ status: 'planned', goal: g, start: todayStr() })} />
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--lui-muted)]">What stands out</h3>
            </div>
            <InsightList
              campaigns={campaigns}
              channels={channels}
              content={content}
              metrics={metrics}
              custWord={custWord}
            />
          </div>
        </TabsContent>
      </Tabs>

      {confirmEl}

      {/* ---------- Dialogs ---------- */}
      <Dialog open={campaignOpen} onOpenChange={setCampaignOpen} title={editingCampaign !== null ? 'Edit campaign' : 'New campaign'}>
        <EntityForm
          collection="campaigns"
          fields={CAMPAIGN_FIELDS}
          {...(editingCampaign !== null ? { initial: editingCampaign } : { defaults: campaignDefaults })}
          onSaved={() => setCampaignOpen(false)}
          onCancel={() => setCampaignOpen(false)}
        />
      </Dialog>

      <Dialog open={contentOpen} onOpenChange={setContentOpen} title={editingContent !== null ? 'Edit content' : 'Add content'}>
        <EntityForm
          collection="promos"
          fields={CONTENT_FIELDS}
          {...(editingContent !== null ? { initial: editingContent } : { defaults: { status: 'idea', format: 'post', date: todayStr() } })}
          onSaved={() => setContentOpen(false)}
          onCancel={() => setContentOpen(false)}
        />
      </Dialog>

      <Dialog open={channelOpen} onOpenChange={setChannelOpen} title={editingChannel !== null ? 'Edit channel' : 'Add channel'}>
        <EntityForm
          collection="channels"
          fields={CHANNEL_FIELDS}
          {...(editingChannel !== null ? { initial: editingChannel } : { defaults: { active: true } })}
          onSaved={() => setChannelOpen(false)}
          onCancel={() => setChannelOpen(false)}
        />
      </Dialog>

      {spendFor !== null && (
        <RecordSpendDialog
          campaign={spendFor}
          onClose={() => setSpendFor(null)}
        />
      )}

      <IdeasDialog
        open={ideasOpen}
        goal={goalFilter === 'all' ? 'leads' : goalFilter}
        onOpenChange={setIdeasOpen}
        onUse={(idea, goal) => {
          setIdeasOpen(false);
          openNewCampaign({ status: 'planned', goal, name: idea.name, note: idea.angle, start: todayStr() });
        }}
      />
    </div>
  );
}

/* ================================================================== */
/* Sub-components                                                      */
/* ================================================================== */

function GoalChip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: Tone;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-[var(--lui-accent)] bg-[var(--lui-accent)]/10 text-[var(--lui-text)]'
          : 'border-[var(--lui-border)] text-[var(--lui-muted)] hover:text-[var(--lui-text)]',
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', TONE_DOT_BG(tone))} />
      {children}
    </button>
  );
}

function TONE_DOT_BG(tone: Tone): string {
  return {
    good: 'bg-emerald-500',
    warn: 'bg-amber-500',
    bad: 'bg-red-500',
    info: 'bg-sky-500',
    accent: 'bg-[var(--lui-accent)]',
    neutral: 'bg-[var(--lui-muted)]/60',
  }[tone];
}

function CampaignCard({
  campaign,
  channelName,
  contentCount,
  onEdit,
  onRecordSpend,
  onSetStatus,
  onDelete,
}: {
  campaign: Campaign;
  channelName: string;
  contentCount: number;
  onEdit: () => void;
  onRecordSpend: () => void;
  onSetStatus: (s: CampaignStatus) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const goal = GOAL_META[campaign.goal];
  const budget = campaign.budget || 0;
  const spend = campaign.spend || 0;
  const target = campaign.target || 0;
  const result = campaign.result || 0;
  const budgetPct = budget > 0 ? Math.min(100, (spend / budget) * 100) : 0;
  const overBudget = budget > 0 && spend > budget;
  const targetPct = target > 0 ? Math.min(1, result / target) : 0;

  return (
    <div className="group flex flex-col border border-[var(--lui-border)] bg-[var(--lui-surface)] p-4">
      {/* header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" onClick={onEdit} className="truncate text-left text-sm font-semibold hover:underline">
            {campaign.name}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--lui-muted)]">
            <Pill tone={goal.tone}>{goal.label}</Pill>
            {channelName !== '' && <span className="truncate">on {channelName}</span>}
            <span>·</span>
            <span>{fmtRange(campaign.start, campaign.end)}</span>
          </div>
        </div>
        <Pill tone={CAMPAIGN_STATUS_META[campaign.status].tone}>{CAMPAIGN_STATUS_META[campaign.status].label}</Pill>
      </div>

      {/* budget bar */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-[var(--lui-muted)]">Spend</span>
          <span className={cn('tabular-nums', overBudget ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-[var(--lui-muted)]')}>
            {fmtMoney(spend)}
            {budget > 0 ? ` / ${fmtMoney(budget)}` : ''}
            {overBudget ? ' · over' : ''}
          </span>
        </div>
        <Progress value={budgetPct} className={cn('mt-1 h-1', overBudget && '[&>div]:bg-amber-500')} />
      </div>

      {/* target progress */}
      <div className="mt-3 flex items-center gap-2.5">
        <ProgressRing value={targetPct} size={22} />
        <div className="min-w-0 flex-1 text-xs">
          {target > 0 ? (
            <span className="tabular-nums">
              <span className="font-medium text-[var(--lui-text)]">{formatResult(campaign.goal, result)}</span>
              <span className="text-[var(--lui-muted)]"> of {formatResult(campaign.goal, target)} {goal.unit}</span>
            </span>
          ) : result > 0 ? (
            <span className="tabular-nums">
              <span className="font-medium text-[var(--lui-text)]">{formatResult(campaign.goal, result)}</span>
              <span className="text-[var(--lui-muted)]"> {goal.unit} · no target set</span>
            </span>
          ) : (
            <span className="text-[var(--lui-muted)]">No target set</span>
          )}
        </div>
        {contentCount > 0 && (
          <span className="shrink-0 text-[11px] text-[var(--lui-muted)]">
            {contentCount} piece{contentCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* actions on hover */}
      <div className="mt-3 flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button variant="ghost" size="sm" onClick={onRecordSpend}>
          <Wallet size={13} aria-hidden />
          Record spend
        </Button>
        {campaign.status !== 'active' && (
          <Button variant="ghost" size="sm" onClick={() => onSetStatus('active')}>
            Set active
          </Button>
        )}
        {campaign.status === 'active' && (
          <Button variant="ghost" size="sm" onClick={() => onSetStatus('done')}>
            Mark done
          </Button>
        )}
        <EditButton onClick={onEdit} />
        <DeleteButton onClick={onDelete} />
      </div>
    </div>
  );
}

function ChannelMix({ channels }: { channels: Channel[] }): React.JSX.Element | null {
  const paid = channels.filter((c) => c.monthly_cost > 0);
  const total = paid.reduce((s, c) => s + c.monthly_cost, 0);
  if (total <= 0) return null;
  const hues = ['bg-orange-500', 'bg-sky-500', 'bg-emerald-500', 'bg-violet-500', 'bg-rose-500', 'bg-teal-500', 'bg-amber-500'];
  return (
    <div className="mb-3 border border-[var(--lui-border)] bg-[var(--lui-surface)] px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--lui-muted)]">Where the money goes</p>
        <p className="text-xs tabular-nums text-[var(--lui-muted)]">{fmtMoney(total)}/mo</p>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
        {paid.map((c, i) => (
          <div
            key={c.id}
            className={cn(hues[i % hues.length])}
            style={{ width: `${(c.monthly_cost / total) * 100}%` }}
            title={`${c.name}: ${fmtMoney(c.monthly_cost)}/mo`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {paid.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1.5 text-[11px] text-[var(--lui-muted)]">
            <span aria-hidden className={cn('size-2 rounded-full', hues[i % hues.length])} />
            {c.name} <span className="tabular-nums">{Math.round((c.monthly_cost / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function GoalCoverage({
  campaigns,
  onNewForGoal,
}: {
  campaigns: Campaign[];
  onNewForGoal: (g: CampaignGoal) => void;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--lui-muted)]">Funnel coverage</h3>
        <span className="text-[11px] text-[var(--lui-muted)]">a campaign for every stage, from getting known to keeping customers</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CAMPAIGN_GOALS.map((g) => {
          const list = campaigns.filter((c) => c.goal === g);
          const active = list.filter((c) => c.status === 'active').length;
          const result = list.reduce((s, c) => s + (c.result || 0), 0);
          const gap = list.length === 0;
          return (
            <div
              key={g}
              className={cn(
                'flex flex-col border bg-[var(--lui-surface)] p-3',
                gap ? 'border-dashed border-[var(--lui-border)]' : 'border-[var(--lui-border)]',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2 rounded-full', TONE_DOT_BG(GOAL_META[g].tone))} />
                <p className="text-[13px] font-semibold">{GOAL_META[g].label}</p>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-[var(--lui-muted)]">{GOAL_META[g].blurb}</p>
              {gap ? (
                <button
                  type="button"
                  onClick={() => onNewForGoal(g)}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-[var(--lui-accent)] hover:underline"
                >
                  <Plus size={12} aria-hidden />
                  No campaign yet
                </button>
              ) : (
                <p className="mt-2 text-xs tabular-nums text-[var(--lui-muted)]">
                  {list.length} campaign{list.length === 1 ? '' : 's'}
                  {active > 0 ? ` · ${active} active` : ''}
                  {result > 0 ? ` · ${formatResult(g, result)} ${GOAL_META[g].unit}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Insight {
  tone: Tone;
  text: string;
}

function InsightList({
  campaigns,
  channels,
  content,
  metrics,
  custWord,
}: {
  campaigns: Campaign[];
  channels: Channel[];
  content: Promo[];
  metrics: { monthlyChannelCost: number; cac: number | null; ros: number | null };
  custWord: string;
}): React.JSX.Element {
  const insights: Insight[] = [];

  // Return on spend reading
  if (metrics.ros !== null) {
    insights.push(
      metrics.ros >= 1
        ? { tone: 'good', text: `For every $1 on marketing in the last 90 days, about ${fmtMoney(Number(metrics.ros.toFixed(2)))} came back in sales.` }
        : { tone: 'warn', text: `Marketing is costing more than it brings right now: about ${fmtMoney(Number(metrics.ros.toFixed(2)))} in sales per $1 spent. Early days can look like this — watch the trend.` },
    );
  }
  if (metrics.cac !== null) {
    insights.push({ tone: 'info', text: `Each new ${custWord} has cost roughly ${fmtMoney(Math.round(metrics.cac))} in marketing over the last 90 days.` });
  }

  // Goal gaps
  const activeGoals = new Set(campaigns.filter((c) => c.status === 'active').map((c) => c.goal));
  for (const g of CAMPAIGN_GOALS) {
    if (!campaigns.some((c) => c.goal === g)) {
      insights.push({ tone: 'neutral', text: `No campaign yet for “${GOAL_META[g].label}”. ${GOAL_META[g].blurb}` });
    }
  }
  if (activeGoals.size === 0 && campaigns.length > 0) {
    insights.push({ tone: 'warn', text: 'No campaign is currently active. Set one to Active to start working it.' });
  }

  // Most-used channel
  const byChannel = new Map<string, number>();
  for (const p of content) if (p.channel !== '') byChannel.set(p.channel, (byChannel.get(p.channel) ?? 0) + 1);
  let topId = '';
  let topN = 0;
  for (const [id, n] of byChannel) if (n > topN) { topN = n; topId = id; }
  if (topId !== '') {
    const name = channels.find((c) => c.id === topId)?.name ?? '';
    if (name !== '') insights.push({ tone: 'info', text: `Your most-used channel is ${name} (${topN} piece${topN === 1 ? '' : 's'} of content).` });
  }

  // Paid-but-idle channels
  for (const c of channels) {
    if (c.active && c.monthly_cost > 0) {
      const used = content.some((p) => p.channel === c.id) || campaigns.some((k) => k.channel === c.id);
      if (!used) insights.push({ tone: 'warn', text: `You pay ${fmtMoney(c.monthly_cost)}/mo for ${c.name} but have nothing running on it yet.` });
    }
  }

  // Upcoming content
  const today = todayStr();
  const soon = dstr(Date.now() + 14 * DAY);
  const upcoming = content.filter((p) => p.date !== '' && p.date.slice(0, 10) >= today && p.date.slice(0, 10) <= soon && p.status !== 'published').length;
  insights.push(
    upcoming > 0
      ? { tone: 'good', text: `${upcoming} piece${upcoming === 1 ? '' : 's'} of content scheduled in the next two weeks.` }
      : { tone: 'neutral', text: 'Nothing scheduled in the next two weeks. A steady drip keeps you top of mind.' },
  );

  if (insights.length === 0) {
    return (
      <p className="border border-dashed border-[var(--lui-border)] px-4 py-8 text-center text-sm text-[var(--lui-muted)]">
        Add channels, campaigns, and content and useful readings will appear here.
      </p>
    );
  }

  return (
    <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
      {insights.map((ins, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-[var(--lui-border)]/70 px-4 py-2.5 last:border-0">
          <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', TONE_DOT_BG(ins.tone))} />
          <p className="text-[13px] leading-relaxed">{ins.text}</p>
        </div>
      ))}
    </div>
  );
}

function RecordSpendDialog({ campaign, onClose }: { campaign: Campaign; onClose: () => void }): React.JSX.Element {
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    if (amount === null || amount <= 0) return;
    setBusy(true);
    try {
      const pb = getPbClient();
      await pb.call((p) =>
        p.collection('money_entries').create({
          kind: 'out',
          amount,
          category: 'Marketing',
          note: `Campaign: ${campaign.name}`,
          date: todayStr(),
        }),
      );
      await pb.call((p) => p.collection('campaigns').update(campaign.id, { spend: (campaign.spend || 0) + amount }));
      toast.success('Recorded as a Marketing expense in Money and added to this campaign.');
      onClose();
    } catch {
      /* surfaced by shell */
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Record spend · ${campaign.name}`}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-[var(--lui-muted)]">
          Adds to this campaign’s spend and records a “Marketing” expense in Money, so your cost per customer and return on
          spend stay honest.
        </p>
        <NumberInput label="Amount spent" value={amount} onValue={setAmount} placeholder="0" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={amount === null || amount <= 0 || busy} loading={busy} onClick={() => void save()}>
            Record
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

interface Idea {
  name: string;
  angle: string;
  first_step?: string;
}

function IdeasDialog({
  open,
  goal,
  onOpenChange,
  onUse,
}: {
  open: boolean;
  goal: CampaignGoal;
  onOpenChange: (o: boolean) => void;
  onUse: (idea: Idea, goal: CampaignGoal) => void;
}): React.JSX.Element {
  const [pickGoal, setPickGoal] = useState<CampaignGoal>(goal);
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const generate = async (g: CampaignGoal): Promise<void> => {
    setBusy(true);
    setUnavailable(false);
    setIdeas(null);
    try {
      const res = await callOp<{ ideas: Idea[] }>('/api/ops/ai-campaign-ideas', { goal: g });
      setIdeas(res.ideas);
    } catch (err) {
      if (err instanceof OpError && err.status === 503) setUnavailable(true);
      else toast.error(err instanceof Error ? err.message : 'Could not get ideas');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Suggest campaign ideas">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-[var(--lui-muted)]">
          CraftBot drafts a few concrete, low-cost ideas from your company profile. Pick a goal, then use any idea to start a
          campaign.
        </p>
        <div className="flex flex-wrap gap-1">
          {CAMPAIGN_GOALS.map((g) => (
            <GoalChip key={g} active={pickGoal === g} tone={GOAL_META[g].tone} onClick={() => setPickGoal(g)}>
              {GOAL_META[g].label}
            </GoalChip>
          ))}
        </div>
        <div>
          <Button size="sm" loading={busy} onClick={() => void generate(pickGoal)}>
            <Sparkles size={14} aria-hidden />
            {ideas !== null ? 'Regenerate' : 'Generate ideas'}
          </Button>
        </div>

        {unavailable && (
          <p className="border border-dashed border-[var(--lui-border)] px-3 py-4 text-center text-[13px] text-[var(--lui-muted)]">
            AI assist is unavailable right now. You can still plan campaigns by hand — the page works fine without it.
          </p>
        )}

        {ideas !== null && ideas.length > 0 && (
          <div className="flex flex-col gap-2">
            {ideas.map((idea, i) => (
              <div key={i} className="border border-[var(--lui-border)] bg-[var(--lui-surface)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold">{idea.name}</p>
                  <Button size="sm" variant="secondary" onClick={() => onUse(idea, pickGoal)}>
                    <BadgePlus size={13} aria-hidden />
                    Use
                  </Button>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--lui-muted)]">{idea.angle}</p>
                {idea.first_step !== undefined && idea.first_step !== '' && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--lui-muted)]">
                    <Lightbulb size={13} aria-hidden className="mt-0.5 shrink-0 text-[var(--lui-accent)]" />
                    First step: {idea.first_step}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Reading sentence under the KPI strip                                */
/* ------------------------------------------------------------------ */

function readingSentence(
  m: { monthlyChannelCost: number; campaignSpend: number; cac: number | null; ros: number | null; newCustomers: number; salesIn90: number },
  custWord: string,
): string {
  if (m.monthlyChannelCost === 0 && m.campaignSpend === 0) {
    return 'Add your channels and start a campaign, and your spend, cost per customer, and return on spend will appear here — pulled from your Money and Customers records.';
  }
  if (m.ros !== null) {
    const verdict =
      m.ros >= 2
        ? 'Marketing is paying for itself well.'
        : m.ros >= 1
          ? 'Marketing is roughly breaking even against sales.'
          : 'Marketing is costing more than it brings so far — normal early on, but worth watching.';
    return `Over the last 90 days you brought in ${m.newCustomers} new ${custWord}${m.newCustomers === 1 ? '' : 's'} and ${fmtMoney(m.salesIn90)} in sales. ${verdict}`;
  }
  return 'Record a few sales in Money and add customers, and the cost-per-customer and return-on-spend readings will fill in.';
}
