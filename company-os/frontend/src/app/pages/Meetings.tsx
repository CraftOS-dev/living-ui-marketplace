/**
 * Meetings: ritual cards with agendas, a date-grouped notes timeline where
 * decisions read as highlighted callouts (Notion pattern), and the Issues
 * list with status dots and hover-revealed solving. Every collection is
 * fetched once (no duplicate queries: SDK auto-cancellation).
 */
import { useState } from 'react';
import { CalendarCheck, CircleAlert, Plus } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  EntityForm,
  Textarea,
  getPbClient,
  toast,
  useCollection,
  useConfirm,
  cn,
} from '../../kit/index.ts';
import type { EntityField } from '../../kit/index.ts';
import type { Issue, Meeting, MeetingNote } from '../lib/types.ts';
import {
  AgoDate,
  DeleteButton,
  Dot,
  EditButton,
  EmptyHint,
  GhostRows,
  GhostState,
  GroupHeader,
  ListRow,
  PageHeader,
  Pill,
} from '../components/ui.tsx';
import { todayStr } from '../lib/useCompany.ts';

const MEETING_FIELDS: EntityField[] = [
  { name: 'name', type: 'text', required: true },
  {
    name: 'cadence',
    type: 'select',
    required: true,
    options: [
      { value: 'weekly', label: 'Weekly' },
      { value: 'monthly', label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' },
      { value: 'yearly', label: 'Yearly' },
    ],
  },
  { name: 'agenda', label: 'Agenda points', type: 'tags' },
];

const NOTE_FIELDS: EntityField[] = [
  { name: 'date', type: 'date', required: true },
  { name: 'notes', type: 'textarea' },
  { name: 'decisions', label: 'Decisions made', type: 'textarea' },
];

const ISSUE_FIELDS: EntityField[] = [
  { name: 'title', type: 'text', required: true },
  { name: 'detail', type: 'textarea' },
];

type Tab = 'rituals' | 'issues';

export function MeetingsPage(): React.JSX.Element {
  const { records: meetings } = useCollection<Meeting>('meetings', { sort: 'name' });
  const { records: notes } = useCollection<MeetingNote>('meeting_notes', { sort: '-date' });
  const { records: issues } = useCollection<Issue>('issues', { sort: '-created' });
  const [tab, setTab] = useState<Tab>('rituals');
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [noteFor, setNoteFor] = useState<Meeting | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [solving, setSolving] = useState<Issue | null>(null);
  const [solution, setSolution] = useState('');
  const [confirmEl, confirm] = useConfirm();

  const openIssues = issues.filter((i) => i.status === 'open');
  const solvedIssues = issues.filter((i) => i.status === 'solved');

  const solve = async (): Promise<void> => {
    if (solving === null) return;
    try {
      await getPbClient().call((pb) => pb.collection('issues').update(solving.id, { status: 'solved', solution }));
      toast.success('Issue solved');
      setSolving(null);
      setSolution('');
    } catch {
      /* surfaced by shell */
    }
  };

  const removeNote = async (n: MeetingNote): Promise<void> => {
    if (!(await confirm('Delete these notes?'))) return;
    await getPbClient()
      .call((pb) => pb.collection('meeting_notes').delete(n.id))
      .catch(() => undefined);
  };

  const removeMeeting = async (m: Meeting): Promise<void> => {
    const n = notes.filter((x) => x.meeting === m.id).length;
    const extra = n > 0 ? ` Its ${n} logged note${n === 1 ? '' : 's'} will be removed too.` : '';
    if (!(await confirm(`Delete ritual "${m.name}"?${extra}`))) return;
    await getPbClient()
      .call((pb) => pb.collection('meetings').delete(m.id))
      .catch(() => undefined);
  };

  const removeIssue = async (i: Issue): Promise<void> => {
    if (!(await confirm(`Delete issue "${i.title}"?`))) return;
    await getPbClient()
      .call((pb) => pb.collection('issues').delete(i.id))
      .catch(() => undefined);
  };

  return (
    <div>
      <PageHeader
        icon={CalendarCheck}
        title="Meetings"
        meta={openIssues.length > 0 ? `${openIssues.length} open issue${openIssues.length === 1 ? '' : 's'}` : undefined}
        actions={
          tab === 'rituals' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditingMeeting(null);
                setMeetingOpen(true);
              }}
            >
              <Plus size={14} aria-hidden />
              Add ritual
            </Button>
          ) : (
            <Button size="sm" onClick={() => setIssueOpen(true)}>
              <Plus size={14} aria-hidden />
              Raise issue
            </Button>
          )
        }
      />

      <div className="mb-4 flex gap-1 border-b border-[var(--lui-border)]">
        {(
          [
            { key: 'rituals', label: 'Rituals', icon: CalendarCheck },
            { key: 'issues', label: `Issues${openIssues.length > 0 ? ` · ${openIssues.length}` : ''}`, icon: CircleAlert },
          ] as Array<{ key: Tab; label: string; icon: typeof CalendarCheck }>
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2 text-[13px] transition-colors',
                tab === t.key ? 'font-medium text-[var(--lui-text)]' : 'text-[var(--lui-muted)] hover:text-[var(--lui-text)]',
              )}
            >
              <Icon size={14} aria-hidden />
              {t.label}
              {tab === t.key && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--lui-accent)]" />}
            </button>
          );
        })}
      </div>

      {tab === 'rituals' && (
        <div className="flex flex-col gap-5">
          {meetings.length === 0 ? (
            <GhostState
              icon={CalendarCheck}
              title="No meeting rituals yet"
              message="Define a recurring ritual with a fixed agenda. The habit matters more than the format."
              action={
                <Button size="sm" onClick={() => setMeetingOpen(true)}>
                  Create a ritual
                </Button>
              }
            >
              <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
                <GhostRows rows={3} />
              </div>
            </GhostState>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {meetings.map((m) => {
                const meetingNotes = notes.filter((n) => n.meeting === m.id);
                const last = meetingNotes[0];
                return (
                  <Card key={m.id}>
                    <CardContent className="flex h-full flex-col gap-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{m.name}</p>
                          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-[var(--lui-muted)]">
                            {m.cadence}
                            {last !== undefined ? (
                              <>
                                {' · last held '}
                                <AgoDate iso={last.date} className="normal-case" />
                              </>
                            ) : (
                              ' · never held yet'
                            )}
                          </p>
                        </div>
                        <Button size="sm" onClick={() => setNoteFor(m)}>
                          Log notes
                        </Button>
                      </div>
                      <ol className="flex flex-1 flex-col gap-1">
                        {(m.agenda ?? []).map((a, i) => (
                          <li key={a} className="flex items-baseline gap-2 text-[13px] text-[var(--lui-muted)]">
                            <span className="text-[10px] font-semibold tabular-nums text-[var(--lui-muted)]/70">{i + 1}</span>
                            {a}
                          </li>
                        ))}
                      </ol>
                      <div className="flex items-center gap-1">
                        <EditButton
                          label="Edit ritual"
                          onClick={() => {
                            setEditingMeeting(m);
                            setMeetingOpen(true);
                          }}
                        />
                        <DeleteButton onClick={() => void removeMeeting(m)} />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {notes.length > 0 && (
            <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
              <GroupHeader label="Notes timeline" count={notes.length} />
              {notes.map((n) => {
                const ritual = meetings.find((m) => m.id === n.meeting);
                return (
                  <div key={n.id} className="group border-b border-[var(--lui-border)]/70 px-4 py-3 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-[var(--lui-muted)]">
                        {new Date(n.date.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {ritual !== undefined ? ` · ${ritual.name}` : ''}
                      </p>
                      <DeleteButton
                        label="Delete notes"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => void removeNote(n)}
                      />
                    </div>
                    {n.notes !== '' && (
                      <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed">{n.notes}</p>
                    )}
                    {n.decisions !== '' && (
                      <div className="mt-2 border-l-2 border-[var(--lui-accent)] bg-[var(--lui-accent)]/[0.05] px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--lui-accent)]">
                          Decided
                        </p>
                        <p className="mt-0.5 whitespace-pre-line text-[13px]">{n.decisions}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'issues' && (
        <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
          {issues.length === 0 ? (
            <EmptyHint
              icon={CalendarCheck}
              title="No issues"
              message="Raise one the moment something gets stuck. A written issue is halfway solved."
              action={
                <Button size="sm" onClick={() => setIssueOpen(true)}>
                  Raise an issue
                </Button>
              }
            />
          ) : (
            <>
              {openIssues.length > 0 && <GroupHeader label="Open" count={openIssues.length} />}
              {openIssues.map((issue) => (
                <ListRow
                  key={issue.id}
                  leading={<Dot tone="warn" />}
                  primary={issue.title}
                  secondary={issue.detail !== '' ? issue.detail : undefined}
                  hoverActions={
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSolving(issue);
                          setSolution('');
                        }}
                      >
                        Solve
                      </Button>
                      <DeleteButton onClick={() => void removeIssue(issue)} />
                    </>
                  }
                />
              ))}
              {solvedIssues.length > 0 && <GroupHeader label="Solved" count={solvedIssues.length} />}
              {solvedIssues.map((issue) => (
                <ListRow
                  key={issue.id}
                  leading={<Dot tone="good" />}
                  primary={<span className="text-[var(--lui-muted)]">{issue.title}</span>}
                  secondary={issue.solution !== '' ? `Solved: ${issue.solution}` : undefined}
                  trailing={<Pill tone="neutral">Solved</Pill>}
                  hoverActions={<DeleteButton onClick={() => void removeIssue(issue)} />}
                />
              ))}
            </>
          )}
        </div>
      )}

      {confirmEl}

      <Dialog open={meetingOpen} onOpenChange={setMeetingOpen} title={editingMeeting !== null ? 'Edit ritual' : 'New ritual'}>
        <EntityForm
          collection="meetings"
          fields={MEETING_FIELDS}
          {...(editingMeeting !== null ? { initial: editingMeeting } : { defaults: { cadence: 'weekly' } })}
          onSaved={() => setMeetingOpen(false)}
          onCancel={() => setMeetingOpen(false)}
        />
      </Dialog>

      <Dialog
        open={noteFor !== null}
        onOpenChange={(open) => {
          if (!open) setNoteFor(null);
        }}
        title={noteFor !== null ? `Notes: ${noteFor.name}` : 'Notes'}
      >
        {noteFor !== null && (
          <EntityForm
            collection="meeting_notes"
            fields={NOTE_FIELDS}
            defaults={{ meeting: noteFor.id, date: todayStr() }}
            onSaved={() => {
              setNoteFor(null);
              toast.success('Notes logged. The Journey sees this too.');
            }}
            onCancel={() => setNoteFor(null)}
          />
        )}
      </Dialog>

      <Dialog open={issueOpen} onOpenChange={setIssueOpen} title="Raise an issue">
        <EntityForm
          collection="issues"
          fields={ISSUE_FIELDS}
          defaults={{ status: 'open' }}
          onSaved={() => setIssueOpen(false)}
          onCancel={() => setIssueOpen(false)}
        />
      </Dialog>

      <Dialog
        open={solving !== null}
        onOpenChange={(open) => {
          if (!open) setSolving(null);
        }}
        title={solving !== null ? `Solve: ${solving.title}` : 'Solve issue'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSolving(null)}>
              Cancel
            </Button>
            <Button onClick={() => void solve()}>Mark solved</Button>
          </>
        }
      >
        <Textarea
          label="What did you decide or do?"
          rows={3}
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
        />
      </Dialog>
    </div>
  );
}
