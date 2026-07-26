/**
 * Newsletter Tool — dashboard, audience management, campaigns (AI-drafted,
 * template-based, schedulable), templates and sender settings.
 * "Send" snapshots the subscribed audience; SMTP delivery is out of scope —
 * export the audience as CSV for a real email service.
 */
import { useState } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  Badge,
  Button,
  Dialog,
  Input,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  getPbClient,
  toast,
  useCollection,
} from '../kit/index.ts';

interface Subscriber extends RecordModel {
  email: string;
  name: string;
  status: '' | 'subscribed' | 'unsubscribed';
  tags: string;
}

interface Block {
  type: 'heading' | 'paragraph' | 'button' | 'divider';
  text?: string;
  url?: string;
}

interface Campaign extends RecordModel {
  subject: string;
  body: string;
  blocks: Block[] | null;
  status: '' | 'draft' | 'sent';
  scheduled_at: string;
  sent_at: string;
  recipients_count: number;
  deliver: boolean;
  delivered_count: number;
}

interface Recipient extends RecordModel {
  campaign: string;
  email: string;
  name: string;
  status: 'delivered' | 'logged' | 'failed' | '';
  detail: string;
}

interface Template extends RecordModel {
  name: string;
  subject: string;
  body: string;
  blocks: Block[] | null;
}

/** Plain-text projection of the block content (list previews, exports). */
function blocksToText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'divider') return '―――';
      if (block.type === 'button') return `[${block.text ?? 'Click'}](${block.url ?? ''})`;
      return block.text ?? '';
    })
    .join('\n\n');
}

function textToBlocks(text: string): Block[] {
  return text
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
    .map((chunk) => ({ type: 'paragraph' as const, text: chunk }));
}

interface Settings extends RecordModel {
  sender_name: string;
  sender_email: string;
}

export function App(): React.JSX.Element {
  const { records: subscribers } = useCollection<Subscriber>('subscribers', { sort: 'email' });
  const { records: campaigns } = useCollection<Campaign>('campaigns', { sort: '-created' });
  const { records: templates } = useCollection<Template>('templates', { sort: 'name' });
  const { records: settingsRows } = useCollection<Settings>('settings', {});
  const settings = settingsRows[0];

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Newsletter Tool</h1>
      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="subscribers">Subscribers</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard">
          <DashboardTab subscribers={subscribers} campaigns={campaigns} />
        </TabsContent>
        <TabsContent value="subscribers">
          <SubscribersTab subscribers={subscribers} />
        </TabsContent>
        <TabsContent value="campaigns">
          <CampaignsTab campaigns={campaigns} templates={templates} settings={settings} />
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleTab campaigns={campaigns} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab templates={templates} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab settings={settings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------ dashboard ------------------------------ */

function DashboardTab({
  subscribers,
  campaigns,
}: {
  subscribers: Subscriber[];
  campaigns: Campaign[];
}): React.JSX.Element {
  const subscribed = subscribers.filter((s) => s.status === 'subscribed').length;
  const unsubscribed = subscribers.length - subscribed;
  const sent = campaigns.filter((c) => c.status === 'sent');
  const scheduled = campaigns.filter((c) => c.status === 'draft' && c.scheduled_at !== '');
  const totalRecipients = sent.reduce((sum, c) => sum + (c.recipients_count || 0), 0);
  const maxRecipients = Math.max(1, ...sent.map((c) => c.recipients_count || 0));

  const stat = (label: string, value: string | number): React.JSX.Element => (
    <div className="rounded-lg border p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs opacity-60">{label}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stat('Subscribed', subscribed)}
        {stat('Unsubscribed', unsubscribed)}
        {stat('Campaigns sent', sent.length)}
        {stat('Scheduled', scheduled.length)}
        {stat('Total recipients', totalRecipients)}
      </div>
      {sent.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
            Recipients per campaign
          </p>
          <div className="flex flex-col gap-1">
            {sent.slice(0, 8).map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="w-56 truncate">{c.subject}</span>
                <div className="h-3 flex-1 rounded bg-black/5 dark:bg-white/10">
                  <div
                    className="h-3 rounded bg-blue-500"
                    style={{ width: `${((c.recipients_count || 0) / maxRecipients) * 100}%` }}
                  />
                </div>
                <span className="w-10 text-right text-xs tabular-nums opacity-60">
                  {c.recipients_count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- subscribers ----------------------------- */

function SubscribersTab({ subscribers }: { subscribers: Subscriber[] }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [filterText, setFilterText] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [editing, setEditing] = useState<Subscriber | null>(null);
  const [importing, setImporting] = useState(false);

  const subscribed = subscribers.filter((s) => s.status === 'subscribed').length;

  const allTags = [
    ...new Set(
      subscribers
        .flatMap((s) => s.tags.split(','))
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    ),
  ].sort();

  const q = filterText.trim().toLowerCase();
  const visible = subscribers.filter((s) => {
    if (q !== '' && !`${s.email} ${s.name}`.toLowerCase().includes(q)) return false;
    if (filterTag !== '' && !s.tags.split(',').map((t) => t.trim()).includes(filterTag)) {
      return false;
    }
    return true;
  });

  /** CSV import: expects email[,name[,tags]] per line; a header row is skipped. */
  const importCsv = async (file: File): Promise<void> => {
    setImporting(true);
    let added = 0;
    let skipped = 0;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
      for (const line of lines) {
        const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
        const [csvEmail, csvName, csvTags] = cells;
        if (csvEmail === undefined || !csvEmail.includes('@')) {
          skipped += 1;
          continue;
        }
        try {
          await getPbClient().call((pb) =>
            pb.collection('subscribers').create({
              email: csvEmail.toLowerCase(),
              name: csvName ?? '',
              status: 'subscribed',
              tags: csvTags ?? '',
            }),
          );
          added += 1;
        } catch {
          skipped += 1; // duplicate email or invalid row
        }
      }
      toast.success(`Imported ${added} subscriber(s)${skipped > 0 ? `, skipped ${skipped}` : ''}`);
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

  const add = async (): Promise<void> => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('subscribers').create({
          email: trimmed,
          name: name.trim(),
          status: 'subscribed',
          tags: '',
        }),
      );
      setEmail('');
      setName('');
      toast.success(`${trimmed} subscribed`);
    } catch {
      /* surfaced by shell (e.g. duplicate email) */
    }
  };

  const toggleStatus = async (subscriber: Subscriber): Promise<void> => {
    const next = subscriber.status === 'subscribed' ? 'unsubscribed' : 'subscribed';
    try {
      await getPbClient().call((pb) =>
        pb.collection('subscribers').update(subscriber.id, { status: next }),
      );
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (subscriber: Subscriber): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('subscribers').delete(subscriber.id));
      toast.success(`${subscriber.email} removed`);
    } catch {
      /* surfaced by shell */
    }
  };

  const exportCsv = async (): Promise<void> => {
    try {
      const res = await fetch('/api/ops/subscribers/export');
      const data = (await res.json()) as { count: number; csv: string };
      await navigator.clipboard.writeText(data.csv);
      toast.success(`${data.count} subscriber(s) copied as CSV`);
    } catch {
      toast.error('Export failed');
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-64"
          value={email}
          placeholder="email@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          className="w-48"
          value={name}
          placeholder="Name (optional)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <Button onClick={() => void add()} disabled={email.trim() === ''}>
          Add
        </Button>
        <span className="ml-auto text-sm opacity-60">{subscribed} subscribed</span>
        <label className="cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10">
          {importing ? 'Importing…' : 'Import CSV'}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) void importCsv(file);
              e.target.value = '';
            }}
          />
        </label>
        <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
          Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-56"
          value={filterText}
          placeholder="🔍 Filter subscribers…"
          onChange={(e) => setFilterText(e.target.value)}
        />
        <select
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
        >
          <option value="">All tags</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        {(q !== '' || filterTag !== '') && (
          <span className="text-xs opacity-60">
            {visible.length} of {subscribers.length}
          </span>
        )}
      </div>

      <Table<Subscriber>
        rows={visible}
        rowKey={(row) => row.id}
        columns={[
          { key: 'email', header: 'Email', render: (row) => row.email },
          { key: 'name', header: 'Name', render: (row) => row.name || '—' },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <Badge variant={row.status === 'subscribed' ? 'default' : 'outline'}>
                {row.status || 'subscribed'}
              </Badge>
            ),
          },
          { key: 'tags', header: 'Tags', render: (row) => row.tags || '—' },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => void toggleStatus(row)}>
                  {row.status === 'subscribed' ? 'Unsubscribe' : 'Resubscribe'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void remove(row)}>
                  ✕
                </Button>
              </div>
            ),
          },
        ]}
        emptyMessage="No subscribers yet."
      />
      {editing !== null && (
        <SubscriberDialog subscriber={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function SubscriberDialog({
  subscriber,
  onClose,
}: {
  subscriber: Subscriber;
  onClose: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState(subscriber.email);
  const [name, setName] = useState(subscriber.name);
  const [tags, setTags] = useState(subscriber.tags);

  const save = async (): Promise<void> => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('subscribers').update(subscriber.id, {
          email: trimmed,
          name: name.trim(),
          tags: tags.trim(),
        }),
      );
      toast.success('Subscriber updated');
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Edit subscriber"
      footer={
        <Button onClick={() => void save()} disabled={email.trim() === ''}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <Input value={email} placeholder="Email" onChange={(e) => setEmail(e.target.value)} />
        <Input value={name} placeholder="Name" onChange={(e) => setName(e.target.value)} />
        <Input
          value={tags}
          placeholder="tags, comma, separated"
          onChange={(e) => setTags(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

/* ------------------------------ campaigns ------------------------------ */

function CampaignsTab({
  campaigns,
  templates,
  settings,
}: {
  campaigns: Campaign[];
  templates: Template[];
  settings: Settings | undefined;
}): React.JSX.Element {
  const { records: recipients } = useCollection<Recipient>('campaign_recipients', {
    sort: '-created',
  });
  const [composeOpen, setComposeOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<Campaign | null>(null);
  const [sendDeliver, setSendDeliver] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [resultsFor, setResultsFor] = useState<Campaign | null>(null);

  const duplicate = async (campaign: Campaign): Promise<void> => {
    try {
      await getPbClient().call((pb) =>
        pb.collection('campaigns').create({
          subject: `${campaign.subject} (copy)`,
          body: campaign.body,
          blocks: campaign.blocks,
          status: 'draft',
        }),
      );
      toast.success('Campaign duplicated as a draft');
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (campaign: Campaign): Promise<void> => {
    if (!window.confirm(`Delete campaign "${campaign.subject}"?`)) return;
    try {
      await getPbClient().call((pb) => pb.collection('campaigns').delete(campaign.id));
      toast.success('Campaign deleted');
    } catch {
      /* surfaced by shell */
    }
  };

  const unschedule = async (campaign: Campaign): Promise<void> => {
    try {
      await getPbClient().call((pb) =>
        pb.collection('campaigns').update(campaign.id, { scheduled_at: '' }),
      );
      toast.success('Schedule cancelled');
    } catch {
      /* surfaced by shell */
    }
  };

  const send = async (campaign: Campaign, deliver: boolean): Promise<void> => {
    try {
      const res = await fetch('/api/ops/campaigns/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaign.id, deliver }),
      });
      const data = (await res.json()) as {
        sent?: boolean;
        recipients?: number;
        delivered?: number;
        failed?: number;
        mode?: string;
        error?: string;
      };
      if (!res.ok || data.sent !== true) {
        toast.error(data.error ?? 'Send failed');
        return;
      }
      if (!deliver) {
        toast.success(`Campaign recorded for ${data.recipients} recipient(s)`);
      } else if ((data.delivered ?? 0) > 0 && (data.failed ?? 0) === 0) {
        toast.success(`Sent to ${data.delivered} recipient(s) via Gmail`);
      } else if ((data.delivered ?? 0) > 0) {
        toast.success(`Sent ${data.delivered}, failed ${data.failed} — see results`);
      } else {
        toast.error('Delivery failed for every recipient — see results');
      }
    } catch {
      toast.error('Send failed');
    } finally {
      setSendTarget(null);
      setSendDeliver(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div>
        <Button onClick={() => setComposeOpen(true)}>New campaign</Button>
      </div>

      <div className="flex flex-col gap-2">
        {campaigns.map((campaign) => (
          <div key={campaign.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{campaign.subject}</p>
              <Badge variant={campaign.status === 'sent' ? 'default' : 'secondary'}>
                {campaign.status || 'draft'}
              </Badge>
              {campaign.status === 'draft' && campaign.scheduled_at !== '' && (
                <Badge variant="outline">
                  ⏰ {new Date(campaign.scheduled_at).toLocaleString()}
                </Badge>
              )}
              {campaign.status === 'sent' ? (
                <span className="ml-auto flex items-center gap-2 text-xs opacity-60">
                  <span>
                    {campaign.recipients_count} recipient(s)
                    {campaign.delivered_count > 0 && ` · ${campaign.delivered_count} delivered`}
                    {campaign.sent_at !== '' && ` · ${new Date(campaign.sent_at).toLocaleString()}`}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setResultsFor(campaign)}>
                    Results
                  </Button>
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => setEditing(campaign)}>
                    Edit
                  </Button>
                  {campaign.scheduled_at !== '' && (
                    <Button variant="outline" size="sm" onClick={() => void unschedule(campaign)}>
                      Cancel schedule
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setSendTarget(campaign)}>
                    Send now
                  </Button>
                </span>
              )}
              <span className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => void duplicate(campaign)}>
                  Duplicate
                </Button>
                <button
                  type="button"
                  className="px-1 text-xs opacity-40 hover:opacity-100"
                  onClick={() => void remove(campaign)}
                >
                  ✕
                </button>
              </span>
            </div>
            {campaign.body !== '' && (
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm opacity-70">
                {campaign.body}
              </p>
            )}
          </div>
        ))}
        {campaigns.length === 0 && (
          <p className="text-sm opacity-60">No campaigns yet — compose one.</p>
        )}
      </div>

      {composeOpen && (
        <ComposeDialog templates={templates} onClose={() => setComposeOpen(false)} />
      )}
      {editing !== null && (
        <ComposeDialog
          templates={templates}
          campaign={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {resultsFor !== null && (
        <ResultsDialog
          campaign={resultsFor}
          recipients={recipients.filter((r) => r.campaign === resultsFor.id)}
          onClose={() => setResultsFor(null)}
        />
      )}

      {sendTarget !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSendTarget(null);
          }}
          title="Send campaign?"
          description={`"${sendTarget.subject}" goes to the current subscribed audience${settings !== undefined ? ` as ${settings.sender_name} <${settings.sender_email}>` : ''}. This cannot be undone.`}
          footer={
            <Button onClick={() => void send(sendTarget, sendDeliver)}>
              {sendDeliver ? 'Send emails now' : 'Record send'}
            </Button>
          }
        >
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={sendDeliver}
                onChange={(e) => setSendDeliver(e.target.checked)}
              />
              <span>
                <strong>Actually email everyone</strong> via the CraftBot Gmail integration.
                Requires Gmail to be connected in CraftBot; each recipient's outcome is recorded.
              </span>
            </label>
            {!sendDeliver && (
              <p className="opacity-70">
                Unchecked: the audience snapshot is recorded only (no email leaves this machine).
                Use Export CSV to deliver elsewhere.
              </p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ComposeDialog({
  templates,
  campaign,
  onClose,
}: {
  templates: Template[];
  campaign?: Campaign | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [subject, setSubject] = useState(campaign?.subject ?? '');
  const [blocks, setBlocks] = useState<Block[]>(
    campaign?.blocks !== null && campaign?.blocks !== undefined && campaign.blocks.length > 0
      ? campaign.blocks
      : campaign !== undefined
        ? textToBlocks(campaign.body)
        : [{ type: 'paragraph', text: '' }],
  );
  const [scheduledAt, setScheduledAt] = useState(
    campaign?.scheduled_at !== undefined && campaign.scheduled_at !== ''
      ? new Date(campaign.scheduled_at).toISOString().slice(0, 16)
      : '',
  );
  const [aiTopic, setAiTopic] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [deliverOnSchedule, setDeliverOnSchedule] = useState(campaign?.deliver ?? false);

  const applyTemplate = (id: string): void => {
    const template = templates.find((t) => t.id === id);
    if (template === undefined) return;
    setSubject(template.subject);
    setBlocks(
      template.blocks !== null && template.blocks.length > 0
        ? template.blocks
        : textToBlocks(template.body),
    );
  };

  const aiDraft = async (): Promise<void> => {
    const topic = aiTopic.trim();
    if (topic === '') return;
    setDrafting(true);
    try {
      const res = await fetch('/api/ops/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
      const data = (await res.json()) as { subject?: string; body?: string; error?: string };
      if (!res.ok || data.body === undefined) {
        toast.error(data.error ?? 'AI draft failed');
        return;
      }
      setSubject(data.subject ?? topic);
      setBlocks([{ type: 'heading', text: data.subject ?? topic }, ...textToBlocks(data.body)]);
      toast.success('Draft written — edit away');
    } catch {
      toast.error('AI draft failed');
    } finally {
      setDrafting(false);
    }
  };

  const create = async (): Promise<void> => {
    const trimmed = subject.trim();
    if (trimmed === '') return;
    const payload = {
      subject: trimmed,
      body: blocksToText(blocks),
      blocks,
      status: 'draft',
      scheduled_at: scheduledAt === '' ? '' : new Date(scheduledAt).toISOString(),
      deliver: deliverOnSchedule,
    };
    try {
      if (campaign === undefined) {
        await getPbClient().call((pb) => pb.collection('campaigns').create(payload));
        toast.success(scheduledAt === '' ? 'Draft saved' : 'Campaign scheduled');
      } else {
        await getPbClient().call((pb) => pb.collection('campaigns').update(campaign.id, payload));
        toast.success('Campaign updated');
      }
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={campaign === undefined ? 'New campaign' : 'Edit campaign'}
      className="max-w-2xl"
      footer={
        <div className="flex w-full items-center gap-2">
          <label className="text-xs opacity-70">Schedule</label>
          <input
            type="datetime-local"
            className="rounded-md border bg-transparent px-2 py-1 text-sm"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          {scheduledAt !== '' && (
            <label className="flex items-center gap-1 text-xs opacity-70">
              <input
                type="checkbox"
                checked={deliverOnSchedule}
                onChange={(e) => setDeliverOnSchedule(e.target.checked)}
              />
              email for real
            </label>
          )}
          <Button className="ml-auto" onClick={() => void create()} disabled={subject.trim() === ''}>
            {scheduledAt === '' ? 'Save draft' : 'Schedule'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {templates.length > 0 && (
            <select
              className="rounded-md border bg-transparent px-2 py-1 text-sm"
              defaultValue=""
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="" disabled>
                Start from template…
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <Input
            className="w-56"
            value={aiTopic}
            placeholder="✨ AI: topic to write about…"
            onChange={(e) => setAiTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void aiDraft();
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void aiDraft()}
            disabled={drafting || aiTopic.trim() === ''}
          >
            {drafting ? 'Writing…' : 'AI draft'}
          </Button>
        </div>
        <Input value={subject} placeholder="Subject" onChange={(e) => setSubject(e.target.value)} />
        <BlockEditor blocks={blocks} onChange={setBlocks} />
      </div>
    </Dialog>
  );
}

/* ----------------------------- block editor ----------------------------- */

function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
}): React.JSX.Element {
  const update = (index: number, patch: Partial<Block>): void => {
    onChange(blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  };
  const remove = (index: number): void => {
    onChange(blocks.filter((_, i) => i !== index));
  };
  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    onChange(next);
  };
  const add = (type: Block['type']): void => {
    onChange([...blocks, type === 'divider' ? { type } : { type, text: '', ...(type === 'button' ? { url: '' } : {}) }]);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {(['heading', 'paragraph', 'button', 'divider'] as const).map((type) => (
            <Button key={type} variant="outline" size="sm" onClick={() => add(type)}>
              ＋ {type}
            </Button>
          ))}
        </div>
        {blocks.map((block, index) => (
          <div key={index} className="rounded-md border p-2">
            <div className="mb-1 flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wide opacity-50">{block.type}</span>
              <button type="button" className="ml-auto text-xs opacity-50 hover:opacity-100" onClick={() => move(index, -1)}>
                ↑
              </button>
              <button type="button" className="text-xs opacity-50 hover:opacity-100" onClick={() => move(index, 1)}>
                ↓
              </button>
              <button type="button" className="text-xs opacity-50 hover:opacity-100" onClick={() => remove(index)}>
                ✕
              </button>
            </div>
            {block.type === 'paragraph' && (
              <textarea
                className="min-h-16 w-full rounded-md border bg-transparent p-1.5 text-sm"
                value={block.text ?? ''}
                placeholder="Paragraph text…"
                onChange={(e) => update(index, { text: e.target.value })}
              />
            )}
            {block.type === 'heading' && (
              <Input
                value={block.text ?? ''}
                placeholder="Heading…"
                onChange={(e) => update(index, { text: e.target.value })}
              />
            )}
            {block.type === 'button' && (
              <div className="flex gap-1">
                <Input
                  value={block.text ?? ''}
                  placeholder="Button label"
                  onChange={(e) => update(index, { text: e.target.value })}
                />
                <Input
                  value={block.url ?? ''}
                  placeholder="https://…"
                  onChange={(e) => update(index, { url: e.target.value })}
                />
              </div>
            )}
          </div>
        ))}
        {blocks.length === 0 && (
          <p className="text-xs opacity-50">Add blocks to build the newsletter.</p>
        )}
      </div>
      <div className="rounded-md border p-3">
        <p className="mb-2 text-[10px] uppercase tracking-wide opacity-50">Preview</p>
        <BlockPreview blocks={blocks} />
      </div>
    </div>
  );
}

function BlockPreview({ blocks }: { blocks: Block[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h3 key={index} className="text-lg font-semibold">
              {block.text || '…'}
            </h3>
          );
        }
        if (block.type === 'button') {
          return (
            <span
              key={index}
              className="w-fit rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              {block.text || 'Click here'}
            </span>
          );
        }
        if (block.type === 'divider') {
          return <hr key={index} className="border-t opacity-30" />;
        }
        return (
          <p key={index} className="whitespace-pre-wrap text-sm">
            {block.text || '…'}
          </p>
        );
      })}
      {blocks.length === 0 && <p className="text-sm opacity-40">Nothing yet.</p>}
    </div>
  );
}

/* ------------------------------ templates ------------------------------ */

function TemplatesTab({ templates }: { templates: Template[] }): React.JSX.Element {
  const [editing, setEditing] = useState<Template | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div>
        <Button size="sm" onClick={() => setEditing('new')}>
          New template
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {templates.map((template) => (
          <div key={template.id} className="flex items-center gap-2 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{template.name}</p>
              <p className="truncate text-sm opacity-60">{template.subject}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(template)}>
              Edit
            </Button>
          </div>
        ))}
        {templates.length === 0 && <p className="text-sm opacity-60">No templates yet.</p>}
      </div>
      {editing !== null && (
        <TemplateDialog
          template={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  template,
  onClose,
}: {
  template?: Template | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [blocks, setBlocks] = useState<Block[]>(
    template?.blocks !== null && template?.blocks !== undefined && template.blocks.length > 0
      ? template.blocks
      : template !== undefined
        ? textToBlocks(template.body)
        : [{ type: 'paragraph', text: '' }],
  );

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const payload = { name: trimmed, subject: subject.trim(), body: blocksToText(blocks), blocks };
    try {
      if (template === undefined) {
        await getPbClient().call((pb) => pb.collection('templates').create(payload));
        toast.success('Template created');
      } else {
        await getPbClient().call((pb) => pb.collection('templates').update(template.id, payload));
      }
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (): Promise<void> => {
    if (template === undefined) return;
    try {
      await getPbClient().call((pb) => pb.collection('templates').delete(template.id));
      toast.success('Template deleted');
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={template === undefined ? 'New template' : 'Edit template'}
      className="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between">
          {template !== undefined ? (
            <Button variant="destructive" size="sm" onClick={() => void remove()}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => void save()} disabled={name.trim() === ''}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Input value={name} placeholder="Template name" onChange={(e) => setName(e.target.value)} />
        <Input value={subject} placeholder="Subject" onChange={(e) => setSubject(e.target.value)} />
        <BlockEditor blocks={blocks} onChange={setBlocks} />
      </div>
    </Dialog>
  );
}

/* ------------------------------ settings ------------------------------ */

function SettingsTab({ settings }: { settings: Settings | undefined }): React.JSX.Element {
  const [name, setName] = useState(settings?.sender_name ?? '');
  const [email, setEmail] = useState(settings?.sender_email ?? '');

  const save = async (): Promise<void> => {
    try {
      if (settings === undefined) {
        await getPbClient().call((pb) =>
          pb.collection('settings').create({ sender_name: name.trim(), sender_email: email.trim() }),
        );
      } else {
        await getPbClient().call((pb) =>
          pb
            .collection('settings')
            .update(settings.id, { sender_name: name.trim(), sender_email: email.trim() }),
        );
      }
      toast.success('Settings saved');
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="flex max-w-md flex-col gap-3 pt-3">
      <p className="text-xs opacity-70">
        Sender identity — shown on campaign sends and available to agents via the data API.
      </p>
      <Input value={name} placeholder="Sender name" onChange={(e) => setName(e.target.value)} />
      <Input
        value={email}
        placeholder="sender@example.com"
        onChange={(e) => setEmail(e.target.value)}
      />
      <div>
        <Button onClick={() => void save()}>Save</Button>
      </div>
    </div>
  );
}

function ResultsDialog({
  campaign,
  recipients,
  onClose,
}: {
  campaign: Campaign;
  recipients: Recipient[];
  onClose: () => void;
}): React.JSX.Element {
  const delivered = recipients.filter((r) => r.status === 'delivered').length;
  const failed = recipients.filter((r) => r.status === 'failed');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Results — ${campaign.subject}`}
      description={
        campaign.deliver
          ? `${delivered} delivered, ${failed.length} failed of ${recipients.length}`
          : `${recipients.length} recipient(s) recorded (no emails were sent)`
      }
      className="max-w-2xl"
    >
      <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {recipients.map((recipient) => (
          <div key={recipient.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {recipient.email}
              {recipient.name !== '' && <span className="opacity-60"> · {recipient.name}</span>}
            </span>
            <Badge
              variant={
                recipient.status === 'delivered'
                  ? 'default'
                  : recipient.status === 'failed'
                    ? 'destructive'
                    : 'outline'
              }
            >
              {recipient.status || 'logged'}
            </Badge>
          </div>
        ))}
        {recipients.length === 0 && <p className="text-sm opacity-60">No recipient rows.</p>}
      </div>
      {failed.length > 0 && failed[0]?.detail !== '' && (
        <p className="mt-2 text-xs text-amber-600">First failure: {failed[0]?.detail}</p>
      )}
    </Dialog>
  );
}

/* ------------------------------ schedule ------------------------------ */

function ScheduleTab({ campaigns }: { campaigns: Campaign[] }): React.JSX.Element {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear();
  const month = base.getMonth();

  const dayKeyOf = (iso: string): string => (iso === '' ? '' : new Date(iso).toDateString());
  // Campaigns that occupy a calendar day: scheduled drafts and sent ones.
  const byDay = new Map<string, Campaign[]>();
  for (const campaign of campaigns) {
    const iso = campaign.status === 'sent' ? campaign.sent_at : campaign.scheduled_at;
    const key = dayKeyOf(iso);
    if (key === '') continue;
    const list = byDay.get(key) ?? [];
    list.push(campaign);
    byDay.set(key, list);
  }

  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  const upcoming = campaigns
    .filter((c) => c.status === 'draft' && c.scheduled_at !== '')
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const today = new Date().toDateString();

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setMonthOffset(monthOffset - 1)}>
          ←
        </Button>
        <span className="text-sm font-medium">
          {base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <Button variant="outline" size="sm" onClick={() => setMonthOffset(monthOffset + 1)}>
          →
        </Button>
        {monthOffset !== 0 && (
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(0)}>
            Today
          </Button>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
          <div key={label} className="p-1 text-center font-medium opacity-60">
            {label}
          </div>
        ))}
        {cells.map((date, i) => {
          if (date === null) return <div key={`pad-${i}`} />;
          const key = date.toDateString();
          const items = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`min-h-16 rounded-md border p-1 ${key === today ? 'ring-1 ring-blue-400' : ''}`}
            >
              <div className={`mb-0.5 tabular-nums ${key === today ? 'font-semibold' : 'opacity-60'}`}>
                {date.getDate()}
              </div>
              {items.slice(0, 3).map((campaign) => (
                <div
                  key={campaign.id}
                  title={campaign.subject}
                  className={`mb-0.5 truncate rounded px-1 py-0.5 text-[10px] text-white ${
                    campaign.status === 'sent' ? 'bg-emerald-600' : 'bg-blue-500'
                  }`}
                >
                  {campaign.subject}
                </div>
              ))}
              {items.length > 3 && <div className="opacity-60">+{items.length - 3}</div>}
            </div>
          );
        })}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
          Upcoming sends
        </p>
        <div className="flex flex-col gap-1">
          {upcoming.map((campaign) => (
            <div key={campaign.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <span className="flex-1 truncate">{campaign.subject}</span>
              {campaign.deliver && <Badge variant="outline">emails for real</Badge>}
              <span className="text-xs tabular-nums opacity-60">
                {new Date(campaign.scheduled_at).toLocaleString()}
              </span>
            </div>
          ))}
          {upcoming.length === 0 && <p className="text-sm opacity-60">Nothing scheduled.</p>}
        </div>
      </div>
    </div>
  );
}
