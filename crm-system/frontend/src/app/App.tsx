/**
 * CRM System — multi-user CRM: dashboard, people, companies, a staged deal
 * pipeline (drag between stages), tabbed record pages (overview / notes /
 * tasks / timeline) with AI summaries, tasks, and a ⌘K command palette.
 * Every notable change writes an `activities` row (the timeline).
 */
import { useEffect, useMemo, useState } from 'react';
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

interface Company extends RecordModel {
  name: string;
  domain: string;
  industry: string;
  tags: string[];
}

interface Person extends RecordModel {
  name: string;
  email: string;
  phone: string;
  title: string;
  company: string;
  tags: string[];
}

interface Stage extends RecordModel {
  name: string;
  order: number;
  color: string;
  list: string;
}

interface RecordList extends RecordModel {
  name: string;
  entity: 'people' | 'companies' | 'deals' | '';
  description: string;
}

interface ListEntry extends RecordModel {
  list: string;
  record_id: string;
  stage: string;
  position: number;
}

interface Deal extends RecordModel {
  name: string;
  value: number;
  stage: string;
  company: string;
  person: string[];
  tags: string[];
  close_date: string;
}

interface Tag extends RecordModel {
  name: string;
  color: string;
}

interface Attachment extends RecordModel {
  name: string;
  file: string;
  person: string;
  company: string;
  deal: string;
}

interface SavedView extends RecordModel {
  name: string;
  kind: 'people' | 'companies' | 'deals' | '';
  config: { q?: string; stage?: string; tag?: string } | null;
}

interface AttributeDef extends RecordModel {
  entity: 'people' | 'companies' | 'deals' | '';
  name: string;
  type: 'text' | 'number' | 'select' | '';
  options: string;
}

interface AttributeValue extends RecordModel {
  attribute: string;
  record_id: string;
  value: string;
}

interface EmailRec extends RecordModel {
  to: string;
  subject: string;
  body: string;
  status: string;
  detail: string;
  person: string;
}

interface EmailTemplate extends RecordModel {
  name: string;
  subject: string;
  body: string;
}

interface Note extends RecordModel {
  body: string;
  person: string;
  company: string;
  deal: string;
}

interface Task extends RecordModel {
  title: string;
  due: string;
  done: boolean;
  deal: string;
  person: string;
}

interface Activity extends RecordModel {
  kind: string;
  body: string;
  person: string;
  company: string;
  deal: string;
}

type RefField = 'person' | 'company' | 'deal';

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

async function logActivity(
  kind: string,
  body: string,
  refs: Partial<Record<RefField, string>> = {},
): Promise<void> {
  try {
    await getPbClient().call((pb) => pb.collection('activities').create({ kind, body, ...refs }));
  } catch {
    /* timeline is best-effort */
  }
}

export function App(): React.JSX.Element {
  const { records: companies } = useCollection<Company>('companies', { sort: 'name' });
  const { records: people } = useCollection<Person>('people', { sort: 'name' });
  const { records: allStages } = useCollection<Stage>('stages', { sort: 'order' });
  // Stages with no list belong to the main deal pipeline.
  const stages = allStages.filter((s) => s.list === '');
  const { records: deals } = useCollection<Deal>('deals', { sort: '-created' });
  const { records: notes } = useCollection<Note>('notes', { sort: '-created' });
  const { records: tasks } = useCollection<Task>('tasks', { sort: 'done,due' });
  const { records: activities } = useCollection<Activity>('activities', { sort: '-created' });
  const { records: tags } = useCollection<Tag>('tags', { sort: 'name' });
  const { records: attachments } = useCollection<Attachment>('attachments', { sort: '-created' });
  const { records: savedViews } = useCollection<SavedView>('saved_views', { sort: 'name' });
  const { records: attributes } = useCollection<AttributeDef>('attributes', { sort: 'name' });
  const { records: attributeValues } = useCollection<AttributeValue>('attribute_values', {});
  const { records: emails } = useCollection<EmailRec>('emails', { sort: '-created' });
  const { records: emailTemplates } = useCollection<EmailTemplate>('email_templates', {
    sort: 'name',
  });
  const { records: recordLists } = useCollection<RecordList>('lists', { sort: 'name' });
  const { records: listEntries } = useCollection<ListEntry>('list_entries', { sort: 'position' });

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [stageManagerOpen, setStageManagerOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quickTask, setQuickTask] = useState('');
  const [openRecord, setOpenRecord] = useState<
    | { kind: 'person'; id: string }
    | { kind: 'company'; id: string }
    | { kind: 'deal'; id: string }
    | { kind: 'new-person' }
    | { kind: 'new-deal' }
    | null
  >(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key.toLowerCase() === 'd') {
        setOpenRecord({ kind: 'new-deal' });
      } else if (e.key.toLowerCase() === 'p') {
        setOpenRecord({ kind: 'new-person' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const addQuickTask = async (): Promise<void> => {
    const title = quickTask.trim();
    if (title === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('tasks').create({ title, due: '', done: false }),
      );
      setQuickTask('');
      toast.success('Task added');
    } catch {
      /* surfaced by shell */
    }
  };

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const shared = {
    companies,
    people,
    stages,
    allStages,
    deals,
    notes,
    tasks,
    activities,
    companyById,
    personById,
    tags,
    attachments,
    savedViews,
    attributes,
    attributeValues,
    emails,
    emailTemplates,
    recordLists,
    listEntries,
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">CRM</h1>
        <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)}>
          ⌘K Search & commands
        </Button>
        <Button variant="outline" size="sm" onClick={() => setTagManagerOpen(true)}>
          Tags
        </Button>
        <Button variant="outline" size="sm" onClick={() => setStageManagerOpen(true)}>
          Stages
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDataOpen(true)}>
          Import / Export
        </Button>
        <Input
          className="ml-auto h-8 w-52"
          value={quickTask}
          placeholder="+ Quick task (Enter)"
          onChange={(e) => setQuickTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addQuickTask();
          }}
        />
        <Button variant="outline" size="sm" onClick={() => setShortcutsOpen(true)}>
          ?
        </Button>
        <Button variant="outline" size="sm" onClick={() => setChatOpen(true)}>
          ✨ AI assistant
        </Button>
      </header>
      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="deals">Deals</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="lists">Lists</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard">
          <DashboardTab {...shared} onOpen={setOpenRecord} />
        </TabsContent>
        <TabsContent value="deals">
          <DealsBoard {...shared} onOpen={setOpenRecord} />
        </TabsContent>
        <TabsContent value="people">
          <PeopleTab {...shared} onOpen={setOpenRecord} />
        </TabsContent>
        <TabsContent value="companies">
          <CompaniesTab {...shared} onOpen={setOpenRecord} />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksTab tasks={tasks} personById={personById} />
        </TabsContent>
        <TabsContent value="lists">
          <ListsTab {...shared} onOpen={setOpenRecord} />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab {...shared} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab emailTemplates={emailTemplates} />
        </TabsContent>
      </Tabs>

      {chatOpen && <ChatDialog onClose={() => setChatOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {tagManagerOpen && <TagManagerDialog tags={tags} onClose={() => setTagManagerOpen(false)} />}
      {stageManagerOpen && (
        <StageManagerDialog
          stages={stages}
          countFor={(stageId) => deals.filter((d) => d.stage === stageId).length}
          onClose={() => setStageManagerOpen(false)}
        />
      )}
      {dataOpen && (
        <DataDialog
          people={people}
          companies={companies}
          deals={deals}
          stages={stages}
          companyById={companyById}
          onClose={() => setDataOpen(false)}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          people={people}
          companies={companies}
          deals={deals}
          onSelect={(target) => {
            setOpenRecord(target);
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {openRecord?.kind === 'person' && (
        <PersonDialog
          person={personById.get(openRecord.id)}
          {...shared}
          onClose={() => setOpenRecord(null)}
        />
      )}
      {openRecord?.kind === 'new-person' && (
        <PersonDialog person={undefined} {...shared} onClose={() => setOpenRecord(null)} />
      )}
      {openRecord?.kind === 'company' && companyById.get(openRecord.id) !== undefined && (
        <CompanyDialog
          company={companyById.get(openRecord.id)!}
          {...shared}
          onClose={() => setOpenRecord(null)}
        />
      )}
      {openRecord?.kind === 'deal' && (
        <DealDialog
          deal={deals.find((d) => d.id === openRecord.id)}
          {...shared}
          onClose={() => setOpenRecord(null)}
        />
      )}
      {openRecord?.kind === 'new-deal' && (
        <DealDialog deal={undefined} {...shared} onClose={() => setOpenRecord(null)} />
      )}
    </div>
  );
}

type Shared = {
  companies: Company[];
  people: Person[];
  stages: Stage[];
  allStages: Stage[];
  deals: Deal[];
  notes: Note[];
  tasks: Task[];
  activities: Activity[];
  companyById: Map<string, Company>;
  personById: Map<string, Person>;
  tags: Tag[];
  attachments: Attachment[];
  savedViews: SavedView[];
  attributes: AttributeDef[];
  attributeValues: AttributeValue[];
  emails: EmailRec[];
  emailTemplates: EmailTemplate[];
  recordLists: RecordList[];
  listEntries: ListEntry[];
};

type OpenTarget =
  | { kind: 'person'; id: string }
  | { kind: 'company'; id: string }
  | { kind: 'deal'; id: string }
  | { kind: 'new-person' }
  | { kind: 'new-deal' }
  | null;

/* ------------------------------ dashboard ------------------------------ */

function DashboardTab({
  deals,
  stages,
  people,
  companies,
  tasks,
  activities,
  onOpen,
}: Shared & { onOpen: (t: OpenTarget) => void }): React.JSX.Element {
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const wonLost = new Set(
    stages.filter((s) => s.name === 'Won' || s.name === 'Lost').map((s) => s.id),
  );
  const open = deals.filter((d) => !wonLost.has(d.stage));
  const openValue = open.reduce((sum, d) => sum + (d.value || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const dueTasks = tasks.filter((t) => !t.done && t.due !== '' && t.due <= today);

  const stat = (label: string, value: string | number): React.JSX.Element => (
    <div className="rounded-lg border p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs opacity-60">{label}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stat('Open pipeline', `$${money(openValue)}`)}
        {stat('Open deals', open.length)}
        {stat('Tasks due', dueTasks.length)}
        {stat('People', people.length)}
        {stat('Companies', companies.length)}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
            Pipeline by stage
          </p>
          {stages.map((stage) => {
            const inStage = deals.filter((d) => d.stage === stage.id);
            const total = inStage.reduce((sum, d) => sum + (d.value || 0), 0);
            const max = Math.max(1, ...stages.map((s) =>
              deals.filter((d) => d.stage === s.id).reduce((sum, d) => sum + (d.value || 0), 0),
            ));
            return (
              <div key={stage.id} className="mb-1 flex items-center gap-2 text-sm">
                <span className="w-20" style={{ color: stage.color || 'inherit' }}>
                  {stage.name}
                </span>
                <div className="h-3 flex-1 rounded bg-black/5 dark:bg-white/10">
                  <div
                    className="h-3 rounded"
                    style={{ width: `${(total / max) * 100}%`, backgroundColor: stage.color || '#3b82f6' }}
                  />
                </div>
                <span className="w-20 text-right text-xs tabular-nums opacity-60">
                  ${money(total)} ({inStage.length})
                </span>
              </div>
            );
          })}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">My work</p>
          <div className="mb-4 flex flex-col gap-1">
            {tasks
              .filter((t) => !t.done)
              .slice(0, 6)
              .map((task) => (
                <div key={task.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() =>
                      void getPbClient().call((pb) =>
                        pb.collection('tasks').update(task.id, { done: true }),
                      )
                    }
                  />
                  <span>{task.title}</span>
                  {task.due !== '' && (
                    <span
                      className={`ml-auto text-xs tabular-nums ${task.due <= today ? 'text-red-500' : 'opacity-60'}`}
                    >
                      {task.due}
                    </span>
                  )}
                </div>
              ))}
            {tasks.filter((t) => !t.done).length === 0 && (
              <p className="text-sm opacity-60">All clear 🎉</p>
            )}
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
            Recent activity
          </p>
          <div className="flex flex-col gap-1">
            {activities.slice(0, 10).map((activity) => (
              <button
                key={activity.id}
                type="button"
                className="rounded-md px-1 py-0.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  if (activity.deal !== '') onOpen({ kind: 'deal', id: activity.deal });
                  else if (activity.person !== '') onOpen({ kind: 'person', id: activity.person });
                  else if (activity.company !== '') onOpen({ kind: 'company', id: activity.company });
                }}
              >
                {activity.body}{' '}
                <span className="text-xs opacity-50">
                  {new Date(activity.created).toLocaleString()}
                </span>
              </button>
            ))}
            {activities.length === 0 && <p className="text-sm opacity-60">No activity yet.</p>}
          </div>
        </div>
      </div>
      {stageById.size === 0 && <p className="text-sm opacity-60">Loading…</p>}
    </div>
  );
}

/* --------------------------- command palette --------------------------- */

function CommandPalette({
  people,
  companies,
  deals,
  onSelect,
  onClose,
}: {
  people: Person[];
  companies: Company[];
  deals: Deal[];
  onSelect: (target: OpenTarget) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const results: { label: string; hint: string; target: OpenTarget }[] = [
    { label: '＋ New deal', hint: 'command', target: { kind: 'new-deal' } as OpenTarget },
    { label: '＋ New person', hint: 'command', target: { kind: 'new-person' } as OpenTarget },
    ...people.map((p) => ({
      label: p.name,
      hint: `person${p.title !== '' ? ` · ${p.title}` : ''}`,
      target: { kind: 'person', id: p.id } as OpenTarget,
    })),
    ...companies.map((c) => ({
      label: c.name,
      hint: 'company',
      target: { kind: 'company', id: c.id } as OpenTarget,
    })),
    ...deals.map((d) => ({
      label: d.name,
      hint: `deal · $${money(d.value || 0)}`,
      target: { kind: 'deal', id: d.id } as OpenTarget,
    })),
  ].filter((r) => q === '' || r.label.toLowerCase().includes(q));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Search & commands"
    >
      <div className="flex flex-col gap-2">
        <Input
          value={query}
          placeholder="Type a name or command…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length > 0) onSelect(results[0]!.target);
          }}
          autoFocus
        />
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {results.slice(0, 12).map((result, i) => (
            <button
              key={`${result.hint}-${result.label}-${i}`}
              type="button"
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => onSelect(result.target)}
            >
              <span>{result.label}</span>
              <span className="text-xs opacity-50">{result.hint}</span>
            </button>
          ))}
          {results.length === 0 && <p className="p-2 text-sm opacity-60">No matches.</p>}
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------- record tabs (shared sections) --------------------- */

function RecordTabs({
  refField,
  refId,
  kind,
  overview,
  notes,
  tasks,
  activities,
  shared,
  recordTags,
  onToggleTag,
}: {
  refField: RefField;
  refId: string;
  kind: 'people' | 'companies' | 'deals';
  overview: React.ReactNode;
  notes: Note[];
  tasks: Task[];
  activities: Activity[];
  shared?: Shared | undefined;
  recordTags?: string[] | undefined;
  onToggleTag?: ((tagId: string) => void) | undefined;
}): React.JSX.Element {
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const summarize = async (): Promise<void> => {
    setSummarizing(true);
    try {
      const res = await fetch('/api/ops/records/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id: refId }),
      });
      const data = (await res.json()) as { summary?: string; error?: string };
      if (!res.ok || data.summary === undefined) {
        toast.error(data.error ?? 'Summarize failed');
        return;
      }
      setSummary(data.summary);
    } catch {
      toast.error('Summarize failed');
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <Tabs defaultValue="overview">
      <div className="flex items-center gap-2">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          {shared !== undefined && <TabsTrigger value="files">Files</TabsTrigger>}
          {shared !== undefined && kind === 'people' && (
            <TabsTrigger value="emails">Emails</TabsTrigger>
          )}
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void summarize()}
          disabled={summarizing}
        >
          {summarizing ? '…' : '✨ AI summary'}
        </Button>
      </div>
      {summary !== null && (
        <div className="mt-2 whitespace-pre-wrap rounded-md border p-2 text-sm">{summary}</div>
      )}
      <TabsContent value="overview">
        <div className="flex flex-col gap-3 pt-3">
          {overview}
          {shared !== undefined && recordTags !== undefined && onToggleTag !== undefined && (
            <div>
              <p className="mb-1 text-xs opacity-70">Tags</p>
              <div className="flex flex-wrap gap-1">
                {shared.tags.map((tag) => {
                  const active = recordTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => onToggleTag(tag.id)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium text-white ${active ? '' : 'opacity-35'}`}
                      style={{ backgroundColor: tag.color || '#64748b' }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
                {shared.tags.length === 0 && (
                  <p className="text-xs opacity-50">No tags defined — use the Tags button.</p>
                )}
              </div>
            </div>
          )}
          {shared !== undefined && (
            <CustomFieldsSection
              entity={kind}
              recordId={refId}
              attributes={shared.attributes}
              attributeValues={shared.attributeValues}
            />
          )}
        </div>
      </TabsContent>
      {shared !== undefined && (
        <TabsContent value="files">
          <div className="pt-3">
            <FilesSection attachments={shared.attachments} refField={refField} refId={refId} />
          </div>
        </TabsContent>
      )}
      {shared !== undefined && kind === 'people' && (
        <TabsContent value="emails">
          <div className="pt-3">
            <EmailsSection
              personId={refId}
              emails={shared.emails}
              templates={shared.emailTemplates}
              people={shared.people}
            />
          </div>
        </TabsContent>
      )}
      <TabsContent value="notes">
        <div className="pt-3">
          <NotesSection notes={notes} refField={refField} refId={refId} />
        </div>
      </TabsContent>
      <TabsContent value="tasks">
        <div className="pt-3">
          <RecordTasks tasks={tasks} refField={refField} refId={refId} />
        </div>
      </TabsContent>
      <TabsContent value="timeline">
        <div className="flex flex-col gap-1 pt-3">
          {activities
            .filter((a) => a[refField] === refId)
            .map((a) => (
              <p key={a.id} className="text-sm">
                {a.body}{' '}
                <span className="text-xs opacity-50">{new Date(a.created).toLocaleString()}</span>
              </p>
            ))}
          {activities.filter((a) => a[refField] === refId).length === 0 && (
            <p className="text-sm opacity-60">No activity yet.</p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function NotesSection({
  notes,
  refField,
  refId,
}: {
  notes: Note[];
  refField: RefField;
  refId: string;
}): React.JSX.Element {
  const [body, setBody] = useState('');
  const related = notes.filter((note) => note[refField] === refId);

  const add = async (): Promise<void> => {
    const trimmed = body.trim();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('notes').create({ body: trimmed, [refField]: refId }),
      );
      void logActivity('note', `Note added: ${trimmed.slice(0, 60)}`, { [refField]: refId });
      setBody('');
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div>
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {related.map((note) => (
          <div key={note.id} className="rounded-md border p-2 text-sm">
            <p className="whitespace-pre-wrap">{note.body}</p>
            <p className="mt-0.5 text-[10px] opacity-50">
              {new Date(note.created).toLocaleString()}
            </p>
          </div>
        ))}
        {related.length === 0 && <p className="text-xs opacity-50">No notes yet.</p>}
      </div>
      <Input
        className="mt-2"
        value={body}
        placeholder="+ Add note (Enter)"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void add();
        }}
      />
    </div>
  );
}

function RecordTasks({
  tasks,
  refField,
  refId,
}: {
  tasks: Task[];
  refField: 'person' | 'deal' | 'company';
  refId: string;
}): React.JSX.Element {
  const [title, setTitle] = useState('');
  const related = tasks.filter((t) => (refField === 'company' ? false : t[refField] === refId));

  const add = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed === '' || refField === 'company') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('tasks').create({ title: trimmed, due: '', done: false, [refField]: refId }),
      );
      void logActivity('task', `Task added: ${trimmed.slice(0, 60)}`, { [refField]: refId });
      setTitle('');
    } catch {
      /* surfaced by shell */
    }
  };

  const toggle = async (task: Task): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('tasks').update(task.id, { done: !task.done }));
      if (!task.done) {
        void logActivity('task', `Task completed: ${task.title.slice(0, 60)}`, {
          [refField]: refId,
        });
      }
    } catch {
      /* surfaced by shell */
    }
  };

  if (refField === 'company') {
    return <p className="text-sm opacity-60">Tasks attach to people and deals.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {related.map((task) => (
        <label key={task.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={task.done} onChange={() => void toggle(task)} />
          <span className={task.done ? 'line-through opacity-50' : ''}>{task.title}</span>
        </label>
      ))}
      <Input
        value={title}
        placeholder="+ Add task (Enter)"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void add();
        }}
      />
    </div>
  );
}

/* -------------------------- custom fields (EAV) -------------------------- */

function CustomFieldsSection({
  entity,
  recordId,
  attributes,
  attributeValues,
}: {
  entity: 'people' | 'companies' | 'deals';
  recordId: string;
  attributes: AttributeDef[];
  attributeValues: AttributeValue[];
}): React.JSX.Element {
  const [manageOpen, setManageOpen] = useState(false);
  const defs = attributes.filter((a) => a.entity === entity);
  const valueFor = (attributeId: string): AttributeValue | undefined =>
    attributeValues.find((v) => v.attribute === attributeId && v.record_id === recordId);

  const setValue = async (attribute: AttributeDef, value: string): Promise<void> => {
    const existing = valueFor(attribute.id);
    try {
      if (existing !== undefined) {
        await getPbClient().call((pb) =>
          pb.collection('attribute_values').update(existing.id, { value }),
        );
      } else {
        await getPbClient().call((pb) =>
          pb
            .collection('attribute_values')
            .create({ attribute: attribute.id, record_id: recordId, value }),
        );
      }
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <p className="text-xs opacity-70">Custom fields</p>
        <button
          type="button"
          className="text-xs underline-offset-2 opacity-60 hover:underline"
          onClick={() => setManageOpen(true)}
        >
          manage
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {defs.map((def) => {
          const current = valueFor(def.id)?.value ?? '';
          if (def.type === 'select') {
            const options = def.options.split(',').map((o) => o.trim()).filter((o) => o !== '');
            return (
              <div key={def.id} className="flex items-center gap-2 text-sm">
                <label className="w-32 truncate opacity-70">{def.name}</label>
                <select
                  className="rounded-md border bg-transparent px-2 py-1"
                  value={current}
                  onChange={(e) => void setValue(def, e.target.value)}
                >
                  <option value="">—</option>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div key={def.id} className="flex items-center gap-2 text-sm">
              <label className="w-32 truncate opacity-70">{def.name}</label>
              <Input
                className="h-8"
                type={def.type === 'number' ? 'number' : 'text'}
                defaultValue={current}
                onBlur={(e) => {
                  if (e.target.value !== current) void setValue(def, e.target.value);
                }}
              />
            </div>
          );
        })}
        {defs.length === 0 && <p className="text-xs opacity-50">No custom fields defined.</p>}
      </div>
      {manageOpen && (
        <ManageFieldsDialog entity={entity} attributes={defs} onClose={() => setManageOpen(false)} />
      )}
    </div>
  );
}

function ManageFieldsDialog({
  entity,
  attributes,
  onClose,
}: {
  entity: 'people' | 'companies' | 'deals';
  attributes: AttributeDef[];
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [type, setType] = useState<'text' | 'number' | 'select'>('text');
  const [options, setOptions] = useState('');

  const add = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('attributes').create({
          entity,
          name: trimmed,
          type,
          options: type === 'select' ? options : '',
        }),
      );
      setName('');
      setOptions('');
      toast.success(`Field "${trimmed}" added`);
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (attribute: AttributeDef): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('attributes').delete(attribute.id));
      toast.success(`Field "${attribute.name}" deleted (values removed)`);
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
      title={`Custom fields — ${entity}`}
    >
      <div className="flex flex-col gap-2">
        {attributes.map((attribute) => (
          <div key={attribute.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{attribute.name}</span>
            <Badge variant="outline">{attribute.type || 'text'}</Badge>
            <button
              type="button"
              className="text-xs opacity-50 hover:opacity-100"
              onClick={() => void remove(attribute)}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            className="w-40"
            value={name}
            placeholder="Field name"
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="rounded-md border bg-transparent px-2 py-1 text-sm"
            value={type}
            onChange={(e) =>
              setType(e.target.value === 'number' ? 'number' : e.target.value === 'select' ? 'select' : 'text')
            }
          >
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="select">select</option>
          </select>
          {type === 'select' && (
            <Input
              className="w-44"
              value={options}
              placeholder="options, comma,separated"
              onChange={(e) => setOptions(e.target.value)}
            />
          )}
          <Button size="sm" onClick={() => void add()} disabled={name.trim() === ''}>
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------- files ------------------------------- */

function FilesSection({
  attachments,
  refField,
  refId,
}: {
  attachments: Attachment[];
  refField: RefField;
  refId: string;
}): React.JSX.Element {
  const related = attachments.filter((a) => a[refField] === refId);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      await getPbClient().call((pb) =>
        pb.collection('attachments').create({ name: file.name, file, [refField]: refId }),
      );
      void logActivity('file', `File attached: ${file.name}`, { [refField]: refId });
      toast.success(`${file.name} attached`);
    } catch {
      /* surfaced by shell */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (attachment: Attachment): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('attachments').delete(attachment.id));
    } catch {
      /* surfaced by shell */
    }
  };

  const fileUrl = (attachment: Attachment): string =>
    getPbClient().pb.files.getURL(attachment, attachment.file);

  return (
    <div className="flex flex-col gap-2">
      {related.map((attachment) => (
        <div key={attachment.id} className="group flex items-center gap-2 rounded-md border p-2 text-sm">
          <a
            href={fileUrl(attachment)}
            target="_blank"
            rel="noreferrer"
            className="flex-1 truncate hover:underline"
          >
            📎 {attachment.name || attachment.file}
          </a>
          <span className="text-xs opacity-50">
            {new Date(attachment.created).toLocaleDateString()}
          </span>
          <button
            type="button"
            className="text-xs opacity-0 transition-opacity group-hover:opacity-50 hover:!opacity-100"
            onClick={() => void remove(attachment)}
          >
            ✕
          </button>
        </div>
      ))}
      {related.length === 0 && <p className="text-sm opacity-60">No files yet.</p>}
      <label className="mt-1 inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10">
        {busy ? 'Uploading…' : '＋ Attach file'}
        <input
          type="file"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void upload(file);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

/* ------------------------------- emails ------------------------------- */

function EmailsSection({
  personId,
  emails,
  templates,
  people,
}: {
  personId: string;
  emails: EmailRec[];
  templates: EmailTemplate[];
  people: Person[];
}): React.JSX.Element {
  const [composeOpen, setComposeOpen] = useState(false);
  const person = people.find((p) => p.id === personId);
  const related = emails.filter((e) => e.person === personId);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" onClick={() => setComposeOpen(true)} disabled={person?.email === ''}>
          Compose email
        </Button>
        {person?.email === '' && (
          <span className="ml-2 text-xs opacity-60">Add an email address first.</span>
        )}
      </div>
      {related.map((email) => (
        <div key={email.id} className="rounded-md border p-2 text-sm">
          <div className="flex items-center gap-2">
            <p className="font-medium">{email.subject}</p>
            <Badge variant={email.status === 'sent' ? 'default' : 'outline'}>{email.status}</Badge>
            <span className="ml-auto text-xs opacity-50">
              {new Date(email.created).toLocaleString()}
            </span>
          </div>
          {email.body !== '' && (
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs opacity-70">{email.body}</p>
          )}
          {email.detail !== '' && <p className="mt-1 text-xs text-amber-600">{email.detail}</p>}
        </div>
      ))}
      {related.length === 0 && <p className="text-sm opacity-60">No emails yet.</p>}
      {composeOpen && person !== undefined && (
        <ComposeEmailDialog person={person} templates={templates} onClose={() => setComposeOpen(false)} />
      )}
    </div>
  );
}

function ComposeEmailDialog({
  person,
  templates,
  onClose,
}: {
  person: Person;
  templates: EmailTemplate[];
  onClose: () => void;
}): React.JSX.Element {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (): Promise<void> => {
    setSending(true);
    try {
      const res = await fetch('/api/ops/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: person.email, subject, body, person_id: person.id }),
      });
      const data = (await res.json()) as { status?: string; error?: string };
      if (!res.ok || data.status === undefined) {
        toast.error(data.error ?? 'Send failed');
        return;
      }
      toast.success(data.status === 'sent' ? 'Email sent via Gmail' : 'Email recorded (no Gmail integration)');
      void logActivity('email', `Email to ${person.name}: ${subject.slice(0, 50)}`, {
        person: person.id,
      });
      onClose();
    } catch {
      toast.error('Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Email ${person.name}`}
      description={person.email}
      className="max-w-2xl"
      footer={
        <Button onClick={() => void send()} disabled={sending || subject.trim() === ''}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {templates.length > 0 && (
          <select
            className="w-fit rounded-md border bg-transparent px-2 py-1 text-sm"
            defaultValue=""
            onChange={(e) => {
              const template = templates.find((t) => t.id === e.target.value);
              if (template !== undefined) {
                setSubject(template.subject);
                setBody(template.body);
              }
            }}
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
        <Input value={subject} placeholder="Subject" onChange={(e) => setSubject(e.target.value)} />
        <textarea
          className="min-h-40 rounded-md border bg-transparent p-2 text-sm"
          placeholder="Write your email…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

/* ------------------------------ AI chat ------------------------------ */

function ChatDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (): Promise<void> => {
    const message = input.trim();
    if (message === '' || busy) return;
    const nextMessages = [...messages, { role: 'user' as const, content: message }];
    setMessages(nextMessages);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/ops/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: messages }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || data.reply === undefined) {
        toast.error(data.error ?? 'Chat failed');
        return;
      }
      setMessages([...nextMessages, { role: 'assistant', content: data.reply }]);
    } catch {
      toast.error('Chat failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="✨ CRM assistant"
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-2">
        <div className="flex max-h-80 min-h-32 flex-col gap-2 overflow-y-auto">
          {messages.map((message, i) => (
            <div
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg p-2 text-sm ${
                message.role === 'user'
                  ? 'self-end bg-blue-500 text-white'
                  : 'self-start border'
              }`}
            >
              {message.content}
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-sm opacity-60">
              Ask about your pipeline, contacts or what to do next.
            </p>
          )}
          {busy && <p className="text-xs opacity-60">Thinking…</p>}
        </div>
        <div className="flex gap-2">
          <Input
            value={input}
            placeholder="Message the assistant…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
            autoFocus
          />
          <Button onClick={() => void send()} disabled={busy || input.trim() === ''}>
            Send
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------- tag manager ---------------------------- */

const TAG_PALETTE = ['#64748b', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];

function TagManagerDialog({ tags, onClose }: { tags: Tag[]; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState('');

  const add = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('tags').create({
          name: trimmed,
          color: TAG_PALETTE[tags.length % TAG_PALETTE.length],
        }),
      );
      setName('');
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
      title="Manage tags"
    >
      <div className="flex flex-col gap-2">
        {tags.map((tag) => (
          <div key={tag.id} className="flex items-center gap-2 text-sm">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: tag.color || '#64748b' }}
            >
              {tag.name}
            </span>
            {TAG_PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() =>
                  void getPbClient().call((pb) => pb.collection('tags').update(tag.id, { color: swatch }))
                }
                className={`h-4 w-4 rounded-full ${tag.color === swatch ? 'ring-2 ring-offset-1' : ''}`}
                style={{ backgroundColor: swatch }}
              />
            ))}
            <button
              type="button"
              className="ml-auto text-xs opacity-50 hover:opacity-100"
              onClick={() => void getPbClient().call((pb) => pb.collection('tags').delete(tag.id))}
            >
              ✕
            </button>
          </div>
        ))}
        <Input
          value={name}
          placeholder="+ New tag (Enter)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
      </div>
    </Dialog>
  );
}

/* --------------------------- stage manager --------------------------- */

function StageManagerDialog({
  stages,
  countFor,
  listId,
  onClose,
}: {
  stages: Stage[];
  countFor: (stageId: string) => number;
  listId?: string | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState('');

  const add = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('stages').create({
          name: trimmed,
          order: Math.max(0, ...stages.map((s) => s.order + 1)),
          color: TAG_PALETTE[stages.length % TAG_PALETTE.length],
          ...(listId !== undefined ? { list: listId } : {}),
        }),
      );
      setName('');
    } catch {
      /* surfaced by shell */
    }
  };

  const update = async (stage: Stage, patch: Record<string, unknown>): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('stages').update(stage.id, patch));
    } catch {
      /* surfaced by shell */
    }
  };

  const move = async (index: number, delta: number): Promise<void> => {
    const ordered = [...stages].sort((a, b) => a.order - b.order);
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const [item] = ordered.splice(index, 1);
    ordered.splice(target, 0, item!);
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i]!.order === i) continue;
      await update(ordered[i]!, { order: i });
    }
  };

  const remove = async (stage: Stage): Promise<void> => {
    const count = countFor(stage.id);
    if (count > 0) {
      toast.error(`Move its ${count} record(s) to another stage first`);
      return;
    }
    try {
      await getPbClient().call((pb) => pb.collection('stages').delete(stage.id));
      toast.success(`Stage "${stage.name}" deleted`);
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
      title="Pipeline stages"
      description="Rename, recolor, reorder or remove the stages of your deal pipeline."
    >
      <div className="flex flex-col gap-2">
        {[...stages]
          .sort((a, b) => a.order - b.order)
          .map((stage, index) => (
            <div key={stage.id} className="flex items-center gap-2 text-sm">
              <Input
                className="h-8 w-36"
                defaultValue={stage.name}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value !== '' && value !== stage.name) void update(stage, { name: value });
                }}
              />
              {TAG_PALETTE.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => void update(stage, { color: swatch })}
                  className={`h-4 w-4 rounded-full ${stage.color === swatch ? 'ring-2 ring-offset-1' : ''}`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
              <span className="text-xs opacity-50">{countFor(stage.id)} records</span>
              <button type="button" className="opacity-60 hover:opacity-100" onClick={() => void move(index, -1)}>
                ↑
              </button>
              <button type="button" className="opacity-60 hover:opacity-100" onClick={() => void move(index, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="ml-auto text-xs opacity-50 hover:opacity-100"
                onClick={() => void remove(stage)}
              >
                ✕
              </button>
            </div>
          ))}
        <Input
          value={name}
          placeholder="+ New stage (Enter)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
      </div>
    </Dialog>
  );
}

/* ---------------------------- record lists ---------------------------- */

function ListsTab(props: Shared & { onOpen: (t: OpenTarget) => void }): React.JSX.Element {
  const { recordLists } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const list = recordLists.find((l) => l.id === selectedId) ?? recordLists[0] ?? null;

  return (
    <div className="flex gap-4 pt-3">
      <aside className="w-56 shrink-0">
        <Button size="sm" className="mb-2 w-full" onClick={() => setNewOpen(true)}>
          New list
        </Button>
        <div className="flex flex-col gap-1">
          {recordLists.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`rounded-md px-2 py-1.5 text-left text-sm ${item.id === list?.id ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
            >
              <span className="font-medium">{item.name}</span>
              <span className="ml-1 text-xs opacity-50">{item.entity}</span>
            </button>
          ))}
          {recordLists.length === 0 && (
            <p className="px-2 text-xs opacity-60">
              No lists yet. A list groups records of one type and can have its own board stages.
            </p>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {list === null ? (
          <p className="text-sm opacity-60">Create a list to get started.</p>
        ) : (
          <ListView
            key={list.id}
            list={list}
            {...props}
            onDeleted={() => setSelectedId(null)}
          />
        )}
      </div>
      {newOpen && (
        <NewListDialog
          onCreated={(id) => {
            setSelectedId(id);
            setNewOpen(false);
          }}
          onClose={() => setNewOpen(false)}
        />
      )}
    </div>
  );
}

function NewListDialog({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [entity, setEntity] = useState<'people' | 'companies' | 'deals'>('people');
  const [description, setDescription] = useState('');

  const create = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    try {
      const record = await getPbClient().call((pb) =>
        pb.collection('lists').create<RecordList>({
          name: trimmed,
          entity,
          description: description.trim(),
        }),
      );
      toast.success(`List "${trimmed}" created`);
      onCreated(record.id);
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
      title="New record list"
      description="A list groups records of one entity. Give it stages to turn it into its own board."
      footer={
        <Button onClick={() => void create()} disabled={name.trim() === ''}>
          Create
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Input value={name} placeholder="List name" onChange={(e) => setName(e.target.value)} />
        <div className="flex items-center gap-2 text-sm">
          <label className="opacity-70">Records</label>
          <select
            className="rounded-md border bg-transparent px-2 py-1"
            value={entity}
            onChange={(e) =>
              setEntity(
                e.target.value === 'companies'
                  ? 'companies'
                  : e.target.value === 'deals'
                    ? 'deals'
                    : 'people',
              )
            }
          >
            <option value="people">People</option>
            <option value="companies">Companies</option>
            <option value="deals">Deals</option>
          </select>
        </div>
        <Input
          value={description}
          placeholder="Description (optional)"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

function ListView({
  list,
  people,
  companies,
  deals,
  allStages,
  listEntries,
  onOpen,
  onDeleted,
}: Shared & {
  list: RecordList;
  onOpen: (t: OpenTarget) => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const [stagesOpen, setStagesOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const stages = allStages.filter((s) => s.list === list.id).sort((a, b) => a.order - b.order);
  const entries = listEntries.filter((entry) => entry.list === list.id);

  const pool: { id: string; label: string; sub: string }[] =
    list.entity === 'companies'
      ? companies.map((c) => ({ id: c.id, label: c.name, sub: c.industry }))
      : list.entity === 'deals'
        ? deals.map((d) => ({ id: d.id, label: d.name, sub: `$${money(d.value || 0)}` }))
        : people.map((p) => ({ id: p.id, label: p.name, sub: p.title }));
  const byId = new Map(pool.map((row) => [row.id, row]));

  const openRecord = (recordId: string): void => {
    if (list.entity === 'companies') onOpen({ kind: 'company', id: recordId });
    else if (list.entity === 'deals') onOpen({ kind: 'deal', id: recordId });
    else onOpen({ kind: 'person', id: recordId });
  };

  const removeEntry = async (entry: ListEntry): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('list_entries').delete(entry.id));
    } catch {
      /* surfaced by shell */
    }
  };

  const moveEntry = async (entryId: string, stageId: string): Promise<void> => {
    try {
      await getPbClient().call((pb) =>
        pb.collection('list_entries').update(entryId, { stage: stageId }),
      );
    } catch {
      /* surfaced by shell */
    }
  };

  const deleteList = async (): Promise<void> => {
    if (!window.confirm(`Delete list "${list.name}"? Its stages and membership are removed.`)) {
      return;
    }
    try {
      await getPbClient().call((pb) => pb.collection('lists').delete(list.id));
      toast.success('List deleted');
      onDeleted();
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{list.name}</h2>
        <Badge variant="outline">{list.entity}</Badge>
        <span className="text-sm opacity-60">{entries.length} record(s)</span>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          Add records
        </Button>
        <Button size="sm" variant="outline" onClick={() => setStagesOpen(true)}>
          Stages ({stages.length})
        </Button>
        <Button size="sm" variant="outline" onClick={() => void deleteList()}>
          Delete list
        </Button>
      </header>
      {list.description !== '' && <p className="text-sm opacity-60">{list.description}</p>}

      {stages.length === 0 ? (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => {
            const row = byId.get(entry.record_id);
            return (
              <div key={entry.id} className="group flex items-center gap-2 rounded-md border p-2 text-sm">
                <button
                  type="button"
                  className="flex-1 text-left hover:underline"
                  onClick={() => openRecord(entry.record_id)}
                >
                  {row?.label ?? '(deleted record)'}
                  {row?.sub !== undefined && row.sub !== '' && (
                    <span className="ml-2 text-xs opacity-60">{row.sub}</span>
                  )}
                </button>
                <button
                  type="button"
                  className="text-xs opacity-0 transition-opacity group-hover:opacity-50 hover:!opacity-100"
                  onClick={() => void removeEntry(entry)}
                >
                  ✕
                </button>
              </div>
            );
          })}
          {entries.length === 0 && (
            <p className="text-sm opacity-60">
              Empty list — add records, or add stages to make it a board.
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-3 overflow-x-auto">
          {stages.map((stage) => {
            const inStage = entries.filter((entry) => entry.stage === stage.id);
            return (
              <StageColumn
                key={stage.id}
                stage={stage}
                total={inStage.length}
                showCount
                onDropDeal={(entryId) => void moveEntry(entryId, stage.id)}
              >
                {inStage.map((entry) => {
                  const row = byId.get(entry.record_id);
                  return (
                    <div
                      key={entry.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', entry.id)}
                      onClick={() => openRecord(entry.record_id)}
                      className="cursor-pointer rounded-md border p-2 text-sm shadow-sm hover:shadow"
                    >
                      <p className="font-medium">{row?.label ?? '(deleted record)'}</p>
                      {row?.sub !== undefined && row.sub !== '' && (
                        <p className="mt-0.5 text-xs opacity-60">{row.sub}</p>
                      )}
                    </div>
                  );
                })}
              </StageColumn>
            );
          })}
          {/* Unstaged entries land in a leading bucket so nothing is hidden. */}
          <StageColumn
            stage={{ id: '', name: 'Unstaged', order: -1, color: '', list: list.id } as Stage}
            total={entries.filter((entry) => entry.stage === '').length}
            showCount
            onDropDeal={(entryId) => void moveEntry(entryId, '')}
          >
            {entries
              .filter((entry) => entry.stage === '')
              .map((entry) => {
                const row = byId.get(entry.record_id);
                return (
                  <div
                    key={entry.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', entry.id)}
                    onClick={() => openRecord(entry.record_id)}
                    className="cursor-pointer rounded-md border p-2 text-sm shadow-sm hover:shadow"
                  >
                    <p className="font-medium">{row?.label ?? '(deleted record)'}</p>
                  </div>
                );
              })}
          </StageColumn>
        </div>
      )}

      {stagesOpen && (
        <StageManagerDialog
          stages={stages}
          listId={list.id}
          countFor={(stageId) => entries.filter((entry) => entry.stage === stageId).length}
          onClose={() => setStagesOpen(false)}
        />
      )}
      {addOpen && (
        <AddToListDialog
          list={list}
          pool={pool}
          existing={entries.map((entry) => entry.record_id)}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

function AddToListDialog({
  list,
  pool,
  existing,
  onClose,
}: {
  list: RecordList;
  pool: { id: string; label: string; sub: string }[];
  existing: string[];
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const q = query.trim().toLowerCase();
  const candidates = pool.filter(
    (row) => !existing.includes(row.id) && (q === '' || row.label.toLowerCase().includes(q)),
  );

  const add = async (recordId: string): Promise<void> => {
    setBusy(true);
    try {
      await getPbClient().call((pb) =>
        pb.collection('list_entries').create({
          list: list.id,
          record_id: recordId,
          position: existing.length,
        }),
      );
    } catch {
      /* surfaced by shell */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Add ${list.entity} to "${list.name}"`}
    >
      <div className="flex flex-col gap-2">
        <Input
          value={query}
          placeholder="Search…"
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {candidates.map((row) => (
            <div key={row.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {row.label}
                {row.sub !== '' && <span className="ml-2 text-xs opacity-60">{row.sub}</span>}
              </span>
              <Button size="sm" disabled={busy} onClick={() => void add(row.id)}>
                Add
              </Button>
            </div>
          ))}
          {candidates.length === 0 && (
            <p className="text-sm opacity-60">Nothing left to add.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------- import / export --------------------------- */

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function DataDialog({
  people,
  companies,
  deals,
  stages,
  companyById,
  onClose,
}: {
  people: Person[];
  companies: Company[];
  deals: Deal[];
  stages: Stage[];
  companyById: Map<string, Company>;
  onClose: () => void;
}): React.JSX.Element {
  const [importKind, setImportKind] = useState<'people' | 'companies'>('people');
  const [busy, setBusy] = useState(false);

  const exportCsv = async (kind: 'people' | 'companies' | 'deals'): Promise<void> => {
    let csv = '';
    if (kind === 'people') {
      csv = ['name,email,phone,title,company']
        .concat(
          people.map((p) =>
            [p.name, p.email, p.phone, p.title, companyById.get(p.company)?.name ?? '']
              .map(csvEscape)
              .join(','),
          ),
        )
        .join('\n');
    } else if (kind === 'companies') {
      csv = ['name,domain,industry']
        .concat(companies.map((c) => [c.name, c.domain, c.industry].map(csvEscape).join(',')))
        .join('\n');
    } else {
      const stageById = new Map(stages.map((s) => [s.id, s]));
      csv = ['name,value,stage,company,close_date']
        .concat(
          deals.map((d) =>
            [
              d.name,
              d.value,
              stageById.get(d.stage)?.name ?? '',
              companyById.get(d.company)?.name ?? '',
              d.close_date,
            ]
              .map(csvEscape)
              .join(','),
          ),
        )
        .join('\n');
    }
    try {
      await navigator.clipboard.writeText(csv);
      toast.success(`${kind} CSV copied to clipboard`);
    } catch {
      toast.error('Copy failed');
    }
  };

  /** CSV import. people: name,email[,title[,company]] · companies: name[,domain[,industry]] */
  const importCsv = async (file: File): Promise<void> => {
    setBusy(true);
    let added = 0;
    let skipped = 0;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
      for (const line of lines) {
        const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
        const first = cells[0];
        if (first === undefined || first === '' || /^name$/i.test(first)) {
          skipped += 1;
          continue;
        }
        try {
          if (importKind === 'companies') {
            await getPbClient().call((pb) =>
              pb.collection('companies').create({
                name: first,
                domain: cells[1] ?? '',
                industry: cells[2] ?? '',
              }),
            );
          } else {
            const companyName = cells[3] ?? '';
            const company = companies.find(
              (c) => c.name.toLowerCase() === companyName.toLowerCase(),
            );
            await getPbClient().call((pb) =>
              pb.collection('people').create({
                name: first,
                email: cells[1] ?? '',
                title: cells[2] ?? '',
                company: company?.id ?? '',
              }),
            );
          }
          added += 1;
        } catch {
          skipped += 1;
        }
      }
      toast.success(`Imported ${added} ${importKind}${skipped > 0 ? `, skipped ${skipped}` : ''}`);
    } catch {
      toast.error('Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Import / export"
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">Export</p>
          <div className="flex gap-2">
            {(['people', 'companies', 'deals'] as const).map((kind) => (
              <Button key={kind} variant="outline" size="sm" onClick={() => void exportCsv(kind)}>
                {kind} CSV
              </Button>
            ))}
          </div>
          <p className="mt-1 text-xs opacity-50">Copies to your clipboard.</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">Import</p>
          <div className="flex items-center gap-2">
            <select
              className="rounded-md border bg-transparent px-2 py-1 text-sm"
              value={importKind}
              onChange={(e) => setImportKind(e.target.value === 'companies' ? 'companies' : 'people')}
            >
              <option value="people">People</option>
              <option value="companies">Companies</option>
            </select>
            <label className="cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10">
              {busy ? 'Importing…' : 'Choose CSV'}
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file !== undefined) void importCsv(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="mt-1 text-xs opacity-50">
            {importKind === 'people'
              ? 'Columns: name, email, title, company name'
              : 'Columns: name, domain, industry'}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ reports ------------------------------ */

function ReportsTab({ deals, stages, companies }: Shared): React.JSX.Element {
  const stageByName = new Map(stages.map((s) => [s.name, s]));
  const won = deals.filter((d) => d.stage === stageByName.get('Won')?.id);
  const lost = deals.filter((d) => d.stage === stageByName.get('Lost')?.id);
  const closed = won.length + lost.length;
  const winRate = closed === 0 ? null : Math.round((won.length / closed) * 100);
  const wonValue = won.reduce((sum, d) => sum + (d.value || 0), 0);

  // Deals created per month (last 6 months).
  const months: { key: string; label: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    months.push({
      key,
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      count: deals.filter((d) => d.created.startsWith(key)).length,
    });
  }
  const maxMonth = Math.max(1, ...months.map((m) => m.count));

  const byCompany = companies
    .map((company) => ({
      company,
      value: deals
        .filter((d) => d.company === company.id)
        .reduce((sum, d) => sum + (d.value || 0), 0),
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const maxCompany = Math.max(1, ...byCompany.map((row) => row.value));

  return (
    <div className="flex flex-col gap-5 pt-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-2xl font-semibold tabular-nums">{winRate === null ? '—' : `${winRate}%`}</p>
          <p className="text-xs opacity-60">Win rate ({won.length}W / {lost.length}L)</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-2xl font-semibold tabular-nums">${money(wonValue)}</p>
          <p className="text-xs opacity-60">Value won</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-2xl font-semibold tabular-nums">{deals.length}</p>
          <p className="text-xs opacity-60">All deals</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
          Deals created (6 months)
        </p>
        <div className="flex h-28 items-end gap-3">
          {months.map((month) => (
            <div key={month.key} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs tabular-nums opacity-60">{month.count}</span>
              <div
                className="w-full rounded-t bg-blue-500"
                style={{ height: `${(month.count / maxMonth) * 80}px` }}
              />
              <span className="text-xs opacity-60">{month.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
          Top companies by deal value
        </p>
        {byCompany.map((row) => (
          <div key={row.company.id} className="mb-1 flex items-center gap-2 text-sm">
            <span className="w-40 truncate">{row.company.name}</span>
            <div className="h-3 flex-1 rounded bg-black/5 dark:bg-white/10">
              <div
                className="h-3 rounded bg-emerald-500"
                style={{ width: `${(row.value / maxCompany) * 100}%` }}
              />
            </div>
            <span className="w-20 text-right text-xs tabular-nums opacity-60">${money(row.value)}</span>
          </div>
        ))}
        {byCompany.length === 0 && <p className="text-sm opacity-60">No deal values yet.</p>}
      </div>
    </div>
  );
}

/* ------------------------------ deals ------------------------------ */

function DealsBoard({
  deals,
  stages,
  companyById,
  savedViews,
  tags,
  onOpen,
}: Shared & { onOpen: (t: OpenTarget) => void }): React.JSX.Element {
  const [filter, setFilter] = useState<ListFilterState>({ q: '', tag: '' });
  const visibleDeals = deals.filter((d) => matchesFilter(filter, d.name, d.tags));

  const moveDeal = async (dealId: string, stageId: string): Promise<void> => {
    const deal = deals.find((d) => d.id === dealId);
    const stage = stages.find((s) => s.id === stageId);
    if (deal === undefined || stage === undefined || deal.stage === stageId) return;
    try {
      await getPbClient().call((pb) => pb.collection('deals').update(dealId, { stage: stageId }));
      void logActivity('stage', `"${deal.name}" moved to ${stage.name}`, { deal: dealId });
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="pt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onOpen({ kind: 'new-deal' })}>
          New deal
        </Button>
        <ListFilter kind="deals" savedViews={savedViews} tags={tags} filter={filter} setFilter={setFilter} />
      </div>
      <div className="flex items-start gap-3 overflow-x-auto">
        {stages.map((stage) => {
          const inStage = visibleDeals.filter((deal) => deal.stage === stage.id);
          const total = inStage.reduce((sum, deal) => sum + (deal.value || 0), 0);
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              total={total}
              onDropDeal={(dealId) => void moveDeal(dealId, stage.id)}
            >
              {inStage.map((deal) => (
                <div
                  key={deal.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', deal.id)}
                  onClick={() => onOpen({ kind: 'deal', id: deal.id })}
                  className="cursor-pointer rounded-md border p-2 text-sm shadow-sm hover:shadow"
                >
                  <p className="font-medium">{deal.name}</p>
                  <div className="mt-1 flex items-center justify-between text-xs opacity-70">
                    <span>
                      {companyById.get(deal.company)?.name ?? ''}
                      {deal.person.length > 0 && ` · ${deal.person.length}👤`}
                    </span>
                    <span className="tabular-nums">${money(deal.value || 0)}</span>
                  </div>
                </div>
              ))}
            </StageColumn>
          );
        })}
      </div>
    </div>
  );
}

function StageColumn({
  stage,
  total,
  children,
  onDropDeal,
  showCount = false,
}: {
  stage: Stage;
  total: number;
  children: React.ReactNode;
  onDropDeal: (dealId: string) => void;
  showCount?: boolean;
}): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`w-60 shrink-0 rounded-lg border p-2 ${dragOver ? 'ring-2 ring-blue-400' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const dealId = e.dataTransfer.getData('text/plain');
        if (dealId !== '') onDropDeal(dealId);
      }}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-sm font-medium" style={{ color: stage.color || 'inherit' }}>
          {stage.name}
        </span>
        <span className="text-xs tabular-nums opacity-60">
          {showCount ? total : `$${money(total)}`}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function DealDialog(props: Shared & { deal?: Deal | undefined; onClose: () => void }): React.JSX.Element {
  const { deal, stages, companies, people, notes, tasks, activities, onClose } = props;
  const [name, setName] = useState(deal?.name ?? '');
  const [value, setValue] = useState(String(deal?.value ?? ''));
  const [stage, setStage] = useState(deal?.stage ?? stages[0]?.id ?? '');
  const [company, setCompany] = useState(deal?.company ?? '');
  const [person, setPerson] = useState<string[]>(deal?.person ?? []);

  const toggleContact = (personId: string): void => {
    setPerson((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId],
    );
  };

  const toggleTag = (tagId: string): void => {
    if (deal === undefined) return;
    const next = deal.tags.includes(tagId)
      ? deal.tags.filter((id) => id !== tagId)
      : [...deal.tags, tagId];
    void getPbClient().call((pb) => pb.collection('deals').update(deal.id, { tags: next }));
  };

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '' || stage === '') return;
    const payload = { name: trimmed, value: Number(value) || 0, stage, company, person };
    try {
      if (deal === undefined) {
        const created = await getPbClient().call((pb) =>
          pb.collection('deals').create<Deal>(payload),
        );
        void logActivity('deal', `Deal created: ${trimmed}`, { deal: created.id });
        toast.success('Deal created');
      } else {
        await getPbClient().call((pb) => pb.collection('deals').update(deal.id, payload));
      }
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (): Promise<void> => {
    if (deal === undefined) return;
    try {
      await getPbClient().call((pb) => pb.collection('deals').delete(deal.id));
      toast.success('Deal deleted');
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const overview = (
    <div className="flex flex-col gap-3">
      <Input value={name} placeholder="Deal name" onChange={(e) => setName(e.target.value)} />
      <div className="flex items-center gap-2 text-sm">
        <label className="opacity-70">Value $</label>
        <Input className="w-28" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        <label className="ml-2 opacity-70">Stage</label>
        <select
          className="rounded-md border bg-transparent px-2 py-1"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label className="opacity-70">Company</label>
        <select
          className="rounded-md border bg-transparent px-2 py-1"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        >
          <option value="">—</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <p className="mb-1 text-xs opacity-70">Contacts</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={person.includes(p.id)}
                onChange={() => toggleContact(p.id)}
              />
              {p.name}
            </label>
          ))}
          {people.length === 0 && <p className="text-xs opacity-50">No people yet.</p>}
        </div>
      </div>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={deal === undefined ? 'New deal' : deal.name}
      className="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between">
          {deal !== undefined ? (
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
      {deal === undefined ? (
        overview
      ) : (
        <RecordTabs
          refField="deal"
          refId={deal.id}
          kind="deals"
          overview={overview}
          notes={notes}
          tasks={tasks}
          activities={activities}
          shared={props}
          recordTags={deal.tags}
          onToggleTag={toggleTag}
        />
      )}
    </Dialog>
  );
}

/* --------------------------- list filtering --------------------------- */

interface ListFilterState {
  q: string;
  tag: string;
}

function ListFilter({
  kind,
  savedViews,
  tags,
  filter,
  setFilter,
}: {
  kind: 'people' | 'companies' | 'deals';
  savedViews: SavedView[];
  tags: Tag[];
  filter: ListFilterState;
  setFilter: (f: ListFilterState) => void;
}): React.JSX.Element {
  const views = savedViews.filter((v) => v.kind === kind);

  const saveView = async (): Promise<void> => {
    const name = window.prompt('Name this view:');
    if (name === null || name.trim() === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('saved_views').create({ name: name.trim(), kind, config: filter }),
      );
      toast.success(`View "${name.trim()}" saved`);
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-56"
        value={filter.q}
        placeholder="🔍 Filter…"
        onChange={(e) => setFilter({ ...filter, q: e.target.value })}
      />
      <select
        className="rounded-md border bg-transparent px-2 py-1 text-sm"
        value={filter.tag}
        onChange={(e) => setFilter({ ...filter, tag: e.target.value })}
      >
        <option value="">All tags</option>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>
      {(filter.q !== '' || filter.tag !== '') && (
        <Button variant="outline" size="sm" onClick={() => void saveView()}>
          Save view
        </Button>
      )}
      {views.map((view) => (
        <span key={view.id} className="group flex items-center">
          <button
            type="button"
            className="rounded-l-full border px-2 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setFilter({ q: view.config?.q ?? '', tag: view.config?.tag ?? '' })}
          >
            {view.name}
          </button>
          <button
            type="button"
            className="rounded-r-full border border-l-0 px-1.5 py-0.5 text-xs opacity-40 hover:opacity-100"
            onClick={() =>
              void getPbClient().call((pb) => pb.collection('saved_views').delete(view.id))
            }
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

function matchesFilter(
  filter: ListFilterState,
  text: string,
  recordTags: string[] | undefined,
): boolean {
  const q = filter.q.trim().toLowerCase();
  if (q !== '' && !text.toLowerCase().includes(q)) return false;
  if (filter.tag !== '' && !(recordTags ?? []).includes(filter.tag)) return false;
  return true;
}

function TagChips({ ids, tags }: { ids: string[]; tags: Tag[] }): React.JSX.Element | null {
  const matched = ids.map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => t !== undefined);
  if (matched.length === 0) return null;
  return (
    <span className="ml-2 inline-flex gap-1 align-middle">
      {matched.map((tag) => (
        <span
          key={tag.id}
          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
          style={{ backgroundColor: tag.color || '#64748b' }}
        >
          {tag.name}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------ people ------------------------------ */

function PeopleTab({
  people,
  companyById,
  savedViews,
  tags,
  onOpen,
}: Shared & { onOpen: (t: OpenTarget) => void }): React.JSX.Element {
  const [filter, setFilter] = useState<ListFilterState>({ q: '', tag: '' });
  const visible = people.filter((p) =>
    matchesFilter(filter, `${p.name} ${p.email} ${p.title}`, p.tags),
  );
  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onOpen({ kind: 'new-person' })}>
          New person
        </Button>
        <ListFilter kind="people" savedViews={savedViews} tags={tags} filter={filter} setFilter={setFilter} />
      </div>
      <Table<Person>
        rows={visible}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (row) => (
              <button
                type="button"
                className="font-medium underline-offset-2 hover:underline"
                onClick={() => onOpen({ kind: 'person', id: row.id })}
              >
                {row.name}
              </button>
            ),
          },
          {
            key: 'tags',
            header: 'Tags',
            render: (row) => <TagChips ids={row.tags} tags={tags} />,
          },
          { key: 'title', header: 'Title', render: (row) => row.title || '—' },
          {
            key: 'company',
            header: 'Company',
            render: (row) => companyById.get(row.company)?.name ?? '—',
          },
          { key: 'email', header: 'Email', render: (row) => row.email || '—' },
        ]}
        emptyMessage="No people yet."
      />
    </div>
  );
}

function PersonDialog(props: Shared & { person?: Person | undefined; onClose: () => void }): React.JSX.Element {
  const { person, companies, notes, tasks, activities, onClose } = props;
  const [name, setName] = useState(person?.name ?? '');

  const toggleTag = (tagId: string): void => {
    if (person === undefined) return;
    const next = person.tags.includes(tagId)
      ? person.tags.filter((id) => id !== tagId)
      : [...person.tags, tagId];
    void getPbClient().call((pb) => pb.collection('people').update(person.id, { tags: next }));
  };
  const [email, setEmail] = useState(person?.email ?? '');
  const [title, setTitle] = useState(person?.title ?? '');
  const [company, setCompany] = useState(person?.company ?? '');

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const payload = { name: trimmed, email: email.trim(), title: title.trim(), company };
    try {
      if (person === undefined) {
        const created = await getPbClient().call((pb) =>
          pb.collection('people').create<Person>(payload),
        );
        void logActivity('person', `Person added: ${trimmed}`, { person: created.id });
        toast.success('Person added');
      } else {
        await getPbClient().call((pb) => pb.collection('people').update(person.id, payload));
      }
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (): Promise<void> => {
    if (person === undefined) return;
    try {
      await getPbClient().call((pb) => pb.collection('people').delete(person.id));
      toast.success('Person deleted');
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const overview = (
    <div className="flex flex-col gap-3">
      <Input value={name} placeholder="Full name" onChange={(e) => setName(e.target.value)} />
      <div className="flex gap-2">
        <Input value={email} placeholder="Email" onChange={(e) => setEmail(e.target.value)} />
        <Input value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label className="opacity-70">Company</label>
        <select
          className="rounded-md border bg-transparent px-2 py-1"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        >
          <option value="">—</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={person === undefined ? 'New person' : person.name}
      className="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between">
          {person !== undefined ? (
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
      {person === undefined ? (
        overview
      ) : (
        <RecordTabs
          refField="person"
          refId={person.id}
          kind="people"
          overview={overview}
          notes={notes}
          tasks={tasks}
          activities={activities}
          shared={props}
          recordTags={person.tags}
          onToggleTag={toggleTag}
        />
      )}
    </Dialog>
  );
}

/* ----------------------------- companies ----------------------------- */

function CompaniesTab({
  companies,
  people,
  savedViews,
  tags,
  onOpen,
}: Shared & { onOpen: (t: OpenTarget) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [filter, setFilter] = useState<ListFilterState>({ q: '', tag: '' });
  const visible = companies.filter((c) =>
    matchesFilter(filter, `${c.name} ${c.domain} ${c.industry}`, c.tags),
  );

  const add = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    try {
      const created = await getPbClient().call((pb) =>
        pb.collection('companies').create<Company>({ name: trimmed }),
      );
      void logActivity('company', `Company added: ${trimmed}`, { company: created.id });
      setName('');
      toast.success('Company added');
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex gap-2">
        <Input
          className="w-64"
          value={name}
          placeholder="+ Add company (Enter)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <ListFilter kind="companies" savedViews={savedViews} tags={tags} filter={filter} setFilter={setFilter} />
      </div>
      <Table<Company>
        rows={visible}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (row) => (
              <button
                type="button"
                className="font-medium underline-offset-2 hover:underline"
                onClick={() => onOpen({ kind: 'company', id: row.id })}
              >
                {row.name}
              </button>
            ),
          },
          { key: 'domain', header: 'Domain', render: (row) => row.domain || '—' },
          { key: 'industry', header: 'Industry', render: (row) => row.industry || '—' },
          {
            key: 'people',
            header: 'People',
            render: (row) => String(people.filter((p) => p.company === row.id).length),
          },
        ]}
        emptyMessage="No companies yet."
      />
    </div>
  );
}

function CompanyDialog(props: Shared & { company: Company; onClose: () => void }): React.JSX.Element {
  const { company, people, notes, tasks, activities, onClose } = props;
  const [name, setName] = useState(company.name);

  const toggleTag = (tagId: string): void => {
    const next = company.tags.includes(tagId)
      ? company.tags.filter((id) => id !== tagId)
      : [...company.tags, tagId];
    void getPbClient().call((pb) => pb.collection('companies').update(company.id, { tags: next }));
  };
  const [domain, setDomain] = useState(company.domain);
  const [industry, setIndustry] = useState(company.industry);
  const members = people.filter((p) => p.company === company.id);

  const save = async (): Promise<void> => {
    if (name.trim() === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('companies').update(company.id, {
          name: name.trim(),
          domain: domain.trim(),
          industry: industry.trim(),
        }),
      );
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('companies').delete(company.id));
      toast.success('Company deleted');
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const overview = (
    <div className="flex flex-col gap-3">
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex gap-2">
        <Input value={domain} placeholder="Domain" onChange={(e) => setDomain(e.target.value)} />
        <Input value={industry} placeholder="Industry" onChange={(e) => setIndustry(e.target.value)} />
      </div>
      {members.length > 0 && (
        <div className="text-sm">
          <p className="mb-1 text-xs opacity-70">People</p>
          {members.map((p) => (
            <p key={p.id}>
              {p.name} <span className="opacity-60">{p.title}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={company.name}
      className="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="destructive" size="sm" onClick={() => void remove()}>
            Delete
          </Button>
          <Button onClick={() => void save()} disabled={name.trim() === ''}>
            Save
          </Button>
        </div>
      }
    >
      <RecordTabs
        refField="company"
        refId={company.id}
        kind="companies"
        overview={overview}
        notes={notes}
        tasks={tasks}
        activities={activities}
        shared={props}
        recordTags={company.tags}
        onToggleTag={toggleTag}
      />
    </Dialog>
  );
}

/* ------------------------------ tasks ------------------------------ */

function TasksTab({
  tasks,
  personById,
}: {
  tasks: Task[];
  personById: Map<string, Person>;
}): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  const add = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('tasks').create({ title: trimmed, due, done: false }),
      );
      setTitle('');
      setDue('');
    } catch {
      /* surfaced by shell */
    }
  };

  const toggle = async (task: Task): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('tasks').update(task.id, { done: !task.done }));
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (task: Task): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('tasks').delete(task.id));
    } catch {
      /* surfaced by shell */
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex max-w-2xl flex-col gap-3 pt-3">
      <div className="flex gap-2">
        <Input
          value={title}
          placeholder="+ Add task"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <input
          type="date"
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <Button onClick={() => void add()} disabled={title.trim() === ''}>
          Add
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        {tasks.map((task) => (
          <div key={task.id} className="group flex items-center gap-2 rounded-md border p-2 text-sm">
            <input type="checkbox" checked={task.done} onChange={() => void toggle(task)} />
            <span className={task.done ? 'line-through opacity-50' : ''}>{task.title}</span>
            {task.person !== '' && (
              <Badge variant="outline">{personById.get(task.person)?.name ?? ''}</Badge>
            )}
            {task.due !== '' && (
              <span
                className={`ml-auto text-xs tabular-nums ${!task.done && task.due < today ? 'text-red-500' : 'opacity-60'}`}
              >
                {task.due}
              </span>
            )}
            <button
              type="button"
              className="text-xs opacity-0 transition-opacity group-hover:opacity-50 hover:!opacity-100"
              onClick={() => void remove(task)}
            >
              ✕
            </button>
          </div>
        ))}
        {tasks.length === 0 && <p className="text-sm opacity-60">No tasks.</p>}
      </div>
    </div>
  );
}

/* ---------------------------- settings tab ---------------------------- */

function SettingsTab({
  emailTemplates,
}: {
  emailTemplates: EmailTemplate[];
}): React.JSX.Element {
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-5 pt-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">
          Email templates
        </p>
        <p className="mb-2 text-xs opacity-60">
          Reusable subject + body pairs offered when composing an email to a contact.
        </p>
        <div className="flex flex-col gap-2">
          {emailTemplates.map((template) => (
            <div key={template.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{template.name}</p>
                <p className="truncate text-xs opacity-60">{template.subject}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(template)}>
                Edit
              </Button>
            </div>
          ))}
          {emailTemplates.length === 0 && (
            <p className="text-sm opacity-60">No email templates yet.</p>
          )}
        </div>
        <Button className="mt-2" size="sm" onClick={() => setEditing('new')}>
          New template
        </Button>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">
          Email delivery
        </p>
        <p className="text-xs opacity-70">
          Emails are sent through the CraftBot Gmail integration — connect Gmail in CraftBot and
          sending works from any record's Emails tab. No SMTP credentials are stored in this app.
          When the integration is unavailable, emails are recorded locally with a "logged" status.
        </p>
      </div>

      {editing !== null && (
        <EmailTemplateDialog
          template={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EmailTemplateDialog({
  template,
  onClose,
}: {
  template?: EmailTemplate | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const payload = { name: trimmed, subject: subject.trim(), body };
    try {
      if (template === undefined) {
        await getPbClient().call((pb) => pb.collection('email_templates').create(payload));
        toast.success('Template created');
      } else {
        await getPbClient().call((pb) =>
          pb.collection('email_templates').update(template.id, payload),
        );
      }
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (): Promise<void> => {
    if (template === undefined) return;
    try {
      await getPbClient().call((pb) => pb.collection('email_templates').delete(template.id));
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
      title={template === undefined ? 'New email template' : 'Edit email template'}
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
        <textarea
          className="min-h-40 rounded-md border bg-transparent p-2 text-sm"
          placeholder="Email body…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const rows: [string, string][] = [
    ['⌘K / Ctrl+K', 'Search & commands palette'],
    ['D', 'New deal'],
    ['P', 'New person'],
    ['?', 'This help'],
    ['Enter', 'Submit the focused quick-add field'],
    ['Esc', 'Close a dialog'],
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Keyboard shortcuts"
      description="Shortcuts are ignored while typing in a field."
    >
      <div className="flex flex-col gap-1">
        {rows.map(([keys, what]) => (
          <div key={keys} className="flex items-center gap-3 text-sm">
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
            <span className="opacity-80">{what}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
