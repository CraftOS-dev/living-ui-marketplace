/**
 * The note editor: a sheet with the template's section headings as
 * placeholders, autosave, a transcript drop and consent chips. Save hands
 * the note to your AI agent; the StepTrack (Saved, Reading, Summary, Ready)
 * shows where its review is, then the summary, each proposed change with
 * its quote (Accept or Dismiss, one click each) and the tasks it opened
 * appear in place. Your AI agent never edits the person's text.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, FileText, RotateCcw, Sparkle, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentTag, Avatar, Button, ChipPicker, DayPicker, FileDrop, IconButton, LoadError, Section, Segmented, Sheet, SheetHeader, Skeleton, StatusDot, StepTrack, Tag, Textarea, Tip } from '../ui.tsx';
import { op, opForm } from '../../lib/api.ts';
import { compact, fmtDay, humanize, today } from '../../lib/format.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { AskAgent, AskStatus } from '../agent.tsx';
import { NOTE_READS, fieldLabel, roundLabel } from './types.ts';
import type { Consent, Note, ProposalView, TaskView, Template } from './types.ts';

const CONSENT: { value: Consent; label: string }[] = [
  { value: 'informed', label: 'Informed' },
  { value: 'not_recorded', label: 'Not recorded' },
  { value: 'unknown', label: 'Unknown' },
];
const TRANSCRIPT = '.txt,.vtt,.srt,.docx';
const READS = NOTE_READS.concat(['deals']);

/** Where the note lives: a deal (with its stage for the default template) or a company without a deal. */
export interface NoteHome {
  deal?: { id: string; stage: string; currency?: string | undefined } | undefined;
  company?: string | undefined;
}

function defaultTemplate(list: Template[], stage: string): Template | undefined {
  return list.find((t) => stage !== '' && t.stages.includes(stage)) ?? list.find((t) => t.key === 'first_call') ?? list[0];
}

const MONEY = ['raise', 'pre_money', 'post_money', 'check'];
const CODES = ['source', 'instrument'];

/** A proposed value as people read it: money in the deal's currency, codes as words. */
function shown(name: string, v: string, currency: string): string {
  if (v === '') return '';
  if (MONEY.includes(name) && Number.isFinite(Number(v))) return `${currency} ${compact(Number(v))}`;
  if (name === 'round_type') return roundLabel(v);
  if (CODES.includes(name)) return humanize(v);
  return v;
}

function ChangeRow({ p, currency }: { p: ProposalView; currency: string }): React.JSX.Element {
  const item = p.items[0];
  const f = item?.fields[0];
  const pending = p.status === 'pending';
  const decide = (accept: boolean): void => {
    void act([patch(p.id, { status: accept ? 'accepted' : 'dismissed' })], () => (accept ? op('proposals.accept', { proposal: p.id }) : op('proposals.dismiss', { proposal: p.id })), READS);
  };
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-[var(--vo-hair)] py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-24 shrink-0 truncate text-[12px] text-[var(--vo-muted)]">{f !== undefined ? fieldLabel(f.name) : p.title}</span>
        <span className="vo-mono vo-num min-w-0 flex-1 truncate text-[13px]">
          {f !== undefined && f.before !== '' && <span className="text-[var(--vo-muted)] line-through decoration-[var(--vo-line-2)]">{shown(f.name, f.before, currency)}</span>}
          {f !== undefined && f.before !== '' && <span className="px-1.5 text-[var(--vo-muted)]">to</span>}
          <span>{f !== undefined ? shown(f.name, f.after, currency) : ''}</span>
        </span>
        {pending ? (
          <span className="flex shrink-0 items-center gap-1">
            <IconButton icon={X} label="Dismiss" size={28} onClick={() => decide(false)} />
            <Button size="sm" icon={Check} onClick={() => decide(true)}>
              Accept
            </Button>
          </span>
        ) : (
          <Tag tone={p.status === 'accepted' || p.status === 'partial' ? 'good' : 'faint'}>{p.status === 'accepted' || p.status === 'partial' ? 'Accepted' : p.status === 'dismissed' ? 'Dismissed' : p.status === 'expired' ? 'Expired' : p.status === 'failed' ? 'Failed' : 'Closed'}</Tag>
        )}
      </div>
      {p.evidence?.quote !== undefined && p.evidence.quote !== '' && <q className="vo-wrap pl-[104px] text-[12px] italic leading-[18px] text-[var(--vo-ink-2)] max-sm:pl-0">{p.evidence.quote}</q>}
    </li>
  );
}

function TaskRow({ t }: { t: TaskView }): React.JSX.Element {
  const done = t.status === 'done';
  return (
    <li className="flex h-9 min-w-0 items-center gap-2.5 border-b border-[var(--vo-hair)] last:border-b-0">
      <CheckCircle2 size={15} aria-hidden className={done ? 'shrink-0 text-[var(--vo-good)]' : 'shrink-0 text-[var(--vo-muted)]'} />
      <span className={cn('min-w-0 flex-1 truncate text-[13px]', done && 'text-[var(--vo-muted)] line-through')}>{t.title}</span>
      {t.assignee_name !== '' && (
        <Tip text={t.assignee_name}>
          <Avatar name={t.assignee_name} size={20} />
        </Tip>
      )}
      <span className="vo-mono vo-num w-16 shrink-0 text-right text-[12px] text-[var(--vo-muted)]">{t.due_day !== '' ? fmtDay(t.due_day, { year: 'auto' }) : ''}</span>
    </li>
  );
}

/** The review in place: StepTrack while it runs, then the summary, the changes and the tasks. */
function Review({ note, currency }: { note: Note; currency: string }): React.JSX.Element | null {
  const r = note.review;
  if (note.status !== 'saved') return null;
  if (r.state === 'off')
    return (
      <div className="flex items-center gap-2">
        <Tag icon={Sparkle} tone="faint" title="This restricted deal is closed to your AI agent">
          Agent off
        </Tag>
      </div>
    );
  const proposals = r.proposals.filter((p): p is ProposalView => typeof p !== 'string');
  const tasks = r.tasks.filter((t): t is TaskView => typeof t !== 'string');
  const pending = proposals.filter((p) => p.status === 'pending');
  const sections = note.template.sections.filter((s) => (note.summary?.sections?.[s.key] ?? '') !== '');
  const askReview = (again: string): Promise<unknown> => op('notes.review', { note: note.id, ...(again !== '' ? { again } : {}) });
  const acceptAll = (): void => {
    void act(
      pending.map((p) => patch(p.id, { status: 'accepted' })),
      async () => {
        for (const p of pending) await op('proposals.accept', { proposal: p.id });
        return true;
      },
      READS,
    );
  };
  return (
    <div className="vo-in flex min-w-0 flex-col gap-5">
      {r.steps !== null && r.state !== 'ready' && (
        <div className="flex min-w-0 flex-col gap-2">
          <StepTrack labels={r.steps.labels} at={r.steps.at} />
          {r.state === 'waiting' && <AskStatus state={r.agent?.note_review} />}
          {r.state === 'saved' && <AskAgent label="Ask your AI agent to review" state={null} onAsk={askReview} reads={READS} />}
          {r.state === 'failed' && <AskAgent label="Ask your AI agent to review" state={r.agent?.note_review} onAsk={askReview} reads={READS} />}
        </div>
      )}
      {note.summary !== null && (note.summary.headline ?? '') !== '' && (
        <div className="flex min-w-0 items-start gap-2">
          <AgentTag className="mt-0.5" />
          <p className="vo-wrap min-w-0 text-[15px] leading-6">{note.summary.headline}</p>
        </div>
      )}
      {pending.length > 0 || proposals.length > 0 ? (
        <Section title="Changes" aside={pending.length > 1 ? <Button size="sm" variant="ghost" onClick={acceptAll}>Accept all</Button> : undefined}>
          <ul className="flex flex-col">
            {proposals.map((p) => (
              <ChangeRow key={p.id} p={p} currency={currency} />
            ))}
          </ul>
        </Section>
      ) : null}
      {tasks.length > 0 && (
        <Section title="Tasks">
          <ul className="flex flex-col">
            {tasks.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
          </ul>
        </Section>
      )}
      {sections.length > 0 && (
        <Section title="Summary">
          <dl className="flex flex-col gap-2.5">
            {sections.map((s) => (
              <div key={s.key} className="grid min-w-0 grid-cols-[104px_minmax(0,1fr)] gap-3 max-sm:grid-cols-1 max-sm:gap-0.5">
                <dt className="text-[12px] leading-5 text-[var(--vo-muted)]">{s.label}</dt>
                <dd className="vo-wrap text-[13px] leading-5">{note.summary?.sections?.[s.key]}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </div>
  );
}

/**
 * The sheet. `id` null starts a new note: nothing is stored until the first
 * word (or a dropped transcript), so an abandoned editor leaves nothing behind.
 */
export function NoteEditor({ id, home, onClose, onCreated }: { id: string | null; home: NoteHome; onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const [noteId, setNoteId] = useState<string | null>(id);
  const live = useOp<{ note: Note }>('notes.get', { note: noteId ?? '' }, READS, { name: 'notes.get', skip: noteId === null });
  const tpls = useOp<{ templates: Template[] }>('notes.templates', {}, ['note_templates'], { name: 'notes.templates' });
  const note = live.data?.note ?? null;
  const list = tpls.data?.templates ?? [];
  const [tplKey, setTplKey] = useState('');
  const [body, setBody] = useState<Record<string, string>>({});
  const [day, setDay] = useState(today());
  const [consent, setConsent] = useState<Consent>('unknown');
  const [loadedFor, setLoadedFor] = useState('');
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved'>('');
  const [finishing, setFinishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dirty = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creating = useRef<Promise<string> | null>(null);

  // The person's own text is the editor's: load it once per note, never over what they are typing.
  useEffect(() => {
    if (note !== null && loadedFor !== note.id) {
      setBody(note.body);
      setTplKey(note.template.key);
      setDay(note.meeting_day || today());
      setConsent(note.consent);
      setLoadedFor(note.id);
    }
  }, [note, loadedFor]);
  useEffect(() => {
    if (noteId === null && tplKey === '' && list.length > 0) setTplKey(defaultTemplate(list, home.deal?.stage ?? '')?.key ?? '');
  }, [noteId, tplKey, list, home.deal]);

  const tpl = list.find((t) => t.key === tplKey) ?? (note !== null ? { ...note.template, id: '', stages: [], sort: 0, archived: false, builtin: true } : undefined);
  const canEdit = note === null ? true : note.can_edit;
  const isEmpty = Object.values(body).every((v) => v.trim() === '') && (note?.transcript ?? null) === null;

  /** The note's id, creating it first when this is a new note. */
  const ensure = useCallback(async (extra: Record<string, unknown> = {}): Promise<string> => {
    if (noteId !== null) return noteId;
    if (creating.current === null) {
      creating.current = op<{ note: Note }>('notes.create', { deal: home.deal?.id, company: home.deal === undefined ? home.company : undefined, template: tplKey || undefined, meeting_day: day, consent, ...extra }).then((r) => {
        setNoteId(r.note.id);
        setLoadedFor(r.note.id);
        onCreated(r.note.id);
        return r.note.id;
      });
    }
    return creating.current;
  }, [noteId, home, tplKey, day, consent, onCreated]);

  const flush = useCallback(async (): Promise<string | null> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const keys = [...dirty.current];
    if (keys.length === 0) return noteId;
    dirty.current = new Set();
    const changed: Record<string, string> = {};
    for (const k of keys) changed[k] = body[k] ?? '';
    setSaveState('saving');
    try {
      if (noteId === null) {
        // The first words create the note; words typed while it is being created follow as an update.
        const first = creating.current === null;
        const nid = await ensure({ sections: changed });
        if (!first) await op('notes.update', { note: nid, sections: changed });
        setSaveState('saved');
        return nid;
      }
      await op('notes.update', { note: noteId, sections: changed }, { quiet: false });
      setSaveState('saved');
      return noteId;
    } catch {
      for (const k of keys) dirty.current.add(k);
      setSaveState('');
      return null;
    }
  }, [body, noteId, ensure]);

  // Autosave 800 ms after the last keystroke.
  useEffect(() => {
    if (dirty.current.size === 0) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [body, flush]);

  const type = (key: string, v: string): void => {
    dirty.current.add(key);
    setBody((b) => ({ ...b, [key]: v }));
  };

  const setMeta = async (fields: Record<string, unknown>): Promise<void> => {
    if (noteId === null) return;
    await act([], () => op('notes.update', { note: noteId, ...fields }), READS);
  };

  const finish = async (): Promise<void> => {
    setFinishing(true);
    const nid = await flush();
    if (nid !== null) await act([patch(nid, { status: 'saved' })], () => op('notes.update', { note: nid, save: true }), READS);
    setFinishing(false);
  };

  const attach = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (f === undefined) return;
    setUploading(true);
    try {
      const nid = await ensure();
      await act([], () => opForm('notes.attach-transcript', { note: nid, consent: consent === 'not_recorded' ? undefined : consent === 'unknown' ? 'informed' : consent }, { file: f }), READS);
      if (consent !== 'informed') setConsent('informed');
    } finally {
      setUploading(false);
    }
  };

  const close = (): void => {
    void flush();
    onClose();
  };

  const saved = note?.status === 'saved';
  const pendingEdits = saveState === 'saving' || dirty.current.size > 0;
  const title = tpl?.name ?? 'Note';
  return (
    <Sheet open onClose={close} label={title} width={640}>
      <SheetHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{title}</span>
            {note?.author !== null && note?.author !== undefined && (
              <Tip text={note.author.name}>
                <Avatar name={note.author.name} size={20} />
              </Tip>
            )}
          </span>
        }
        onClose={close}
        actions={
          <>
            <span className="vo-mono text-[12px] text-[var(--vo-muted)]" aria-live="polite">
              {saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : ''}
            </span>
            {canEdit && (!saved || pendingEdits) && (
              <Button variant="primary" busy={finishing} disabled={isEmpty} onClick={() => void finish()}>
                Save
              </Button>
            )}
          </>
        }
      />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        {noteId !== null && note === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-60 w-full" />
        ) : (
          <>
            {note !== null && <Review note={note} currency={home.deal?.currency ?? ''} />}
            {canEdit && (
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                {isEmpty && list.length > 1 ? (
                  <ChipPicker
                    label="Template"
                    options={list.map((t) => ({ value: t.key, label: t.name }))}
                    value={tplKey}
                    onChange={(k) => {
                      setTplKey(k);
                      if (noteId !== null) void setMeta({ template: k });
                    }}
                  />
                ) : null}
                <span className="flex-1" />
                <DayPicker
                  label="Meeting day"
                  value={day}
                  onChange={(d) => {
                    setDay(d);
                    void setMeta({ meeting_day: d });
                  }}
                  className="w-[150px]"
                />
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-3">
              {(tpl?.sections ?? []).map((s) => {
                const v = body[s.key] ?? '';
                return (
                  <div key={s.key} className="flex min-w-0 flex-col gap-1">
                    {v !== '' && <span className="text-[12px] font-medium text-[var(--vo-ink-2)]">{s.label}</span>}
                    {canEdit ? (
                      <Textarea aria-label={s.label} placeholder={s.label} value={v} minRows={s.key === 'notes' ? 6 : 2} maxRows={18} onChange={(e) => type(s.key, e.target.value)} className="text-[14px] leading-[22px]" />
                    ) : (
                      <p className="vo-wrap whitespace-pre-wrap text-[14px] leading-[22px]">{v}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--vo-hair)] pt-5">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Tip text="Did everyone in the meeting know it was recorded">
                  <span className="text-[12px] text-[var(--vo-muted)]">Consent</span>
                </Tip>
                <Segmented
                  label="Consent"
                  size="sm"
                  value={consent}
                  onChange={(c) => {
                    if (!canEdit) return;
                    setConsent(c);
                    void setMeta({ consent: c });
                  }}
                  options={CONSENT.map((c) => ({ value: c.value, label: c.label }))}
                />
              </div>
              {note?.transcript !== null && note?.transcript !== undefined ? (
                <div className="flex h-9 min-w-0 items-center gap-2.5 rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] px-3">
                  <FileText size={15} aria-hidden className="shrink-0 text-[var(--vo-ink-2)]" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{note.transcript.name}</span>
                  <StatusDot tone={note.transcript.text_state === 'ready' ? 'good' : note.transcript.text_state === 'failed' || note.transcript.text_state === 'none' ? 'bad' : 'faint'} pulse={note.transcript.text_state === 'waiting' || note.transcript.text_state === 'extracting'} label={note.transcript.text_state === 'ready' ? 'Read' : note.transcript.text_state === 'failed' || note.transcript.text_state === 'none' ? 'Unreadable' : 'Reading'} />
                </div>
              ) : canEdit && consent !== 'not_recorded' ? (
                <FileDrop label={uploading ? 'Adding' : 'Transcript'} accept={TRANSCRIPT} onFiles={(f) => void attach(f)} className="py-4" />
              ) : null}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
