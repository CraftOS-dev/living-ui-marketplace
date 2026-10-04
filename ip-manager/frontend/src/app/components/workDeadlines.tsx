/**
 * Deadlines page dialogs: add a deadline by hand (for dates no rule
 * covers) and the personal calendar feed (subscribe from Google Calendar,
 * Outlook or Apple Calendar; rotate the secret link if it leaks).
 */
import { useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, getPbClient, toast, useConfirm } from '../../kit/index.ts';
import { createRecord, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { CATEGORY_LABEL, KIND_HELP, KIND_LABEL } from '../lib/labels.ts';
import type { AgreementRec, Category, DeadlineKind, DeadlineRec, MatterRec } from '../lib/types.ts';
import { RecordPicker, UserSelect } from './pickers.tsx';
import { Field, Notice, Segmented } from './ui.tsx';
import { DateField, errMsg } from './workShared.tsx';

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as DeadlineKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));
const MATTER_SEARCH = ['ref', 'title', 'application_no', 'registration_no'];
const AGREEMENT_SEARCH = ['ref', 'title'];

function isKind(v: string): v is DeadlineKind {
  return v in KIND_LABEL;
}

function isCategory(v: string): v is Category {
  return v in CATEGORY_LABEL;
}

export function AddDeadlineDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (d: DeadlineRec) => void }): React.JSX.Element {
  const [subjectType, setSubjectType] = useState<'matter' | 'agreement'>('matter');
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DeadlineKind>('internal');
  const [category, setCategory] = useState<Category>('prosecution');
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [due, setDue] = useState('');
  const [finalDate, setFinalDate] = useState('');
  const [assignee, setAssignee] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const errors = {
    subject: subjectId === '' ? `Choose the ${subjectType === 'matter' ? 'record' : 'agreement'} this deadline belongs to.` : '',
    title: title.trim() === '' ? 'Say what needs to happen.' : '',
    due: d10(due) === '' ? 'Enter the due date.' : '',
    final: d10(finalDate) !== '' && d10(due) !== '' && finalDate < due ? 'The final date cannot be before the due date.' : '',
  };
  const invalid = Object.values(errors).some((e) => e !== '');
  const show = (e: string): string | undefined => (tried && e !== '' ? e : undefined);

  const switchSubject = (t: 'matter' | 'agreement'): void => {
    setSubjectType(t);
    setSubjectId('');
    if (!categoryTouched) setCategory(t === 'agreement' ? 'agreement' : 'prosecution');
  };

  const submit = async (): Promise<void> => {
    setTried(true);
    if (invalid) return;
    setBusy(true);
    try {
      const rec = await createRecord<DeadlineRec>('deadlines', {
        title: title.trim(),
        [subjectType]: subjectId,
        ...(subjectType === 'agreement' ? { ip_type: 'agreement' } : {}),
        kind,
        category,
        status: 'open',
        due_date: toPb(due),
        final_date: d10(finalDate) !== '' ? toPb(finalDate) : '',
        assignee,
        notes: notes.trim(),
        source: 'manual',
      });
      toast.success('Deadline added');
      onCreated(rec);
      onClose();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a deadline"
      description="For dates no rule covers, such as a client instruction date or an internal review. Deadlines from office actions are better recorded as events on the record."
      className="w-[min(94vw,38rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={tried && invalid}>
            Add deadline
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <Field label="Belongs to" required error={show(errors.subject)}>
          <div className="flex flex-col gap-2">
            <Segmented<'matter' | 'agreement'>
              size="sm"
              ariaLabel="Kind of record"
              value={subjectType}
              onChange={switchSubject}
              options={[
                { value: 'matter', label: 'Record' },
                { value: 'agreement', label: 'Agreement' },
              ]}
            />
            {subjectType === 'matter' ? (
              <RecordPicker<MatterRec>
                key="matter"
                collection="matters"
                value={subjectId}
                onChange={(id) => setSubjectId(id)}
                labelOf={(m) => `${m.ref} ${m.title}`.trim()}
                searchFields={MATTER_SEARCH}
                placeholder="Search by reference, title or office number"
              />
            ) : (
              <RecordPicker<AgreementRec>
                key="agreement"
                collection="agreements"
                value={subjectId}
                onChange={(id) => setSubjectId(id)}
                labelOf={(a) => `${a.ref} ${a.title}`.trim()}
                searchFields={AGREEMENT_SEARCH}
                placeholder="Search by reference or title"
              />
            )}
          </div>
        </Field>
        <Input label="What needs to happen" value={title} onChange={(e) => setTitle(e.target.value)} error={show(errors.title)} placeholder="For example: send instructions to local counsel" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind" help={KIND_HELP[kind]}>
            <Select aria-label="Kind" value={kind} options={KIND_OPTIONS} onChange={(e) => isKind(e.target.value) && setKind(e.target.value)} />
          </Field>
          <Field label="Category">
            <Select
              aria-label="Category"
              value={category}
              options={CATEGORY_OPTIONS}
              onChange={(e) => {
                if (isCategory(e.target.value)) {
                  setCategory(e.target.value);
                  setCategoryTouched(true);
                }
              }}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField label="Due date" value={due} onChange={setDue} required error={show(errors.due)} />
          <DateField
            label="Final date (optional)"
            value={finalDate}
            onChange={setFinalDate}
            error={show(errors.final)}
            help="The last possible date, for example with paid extensions."
          />
        </div>
        <UserSelect
          label="Assigned to"
          value={assignee}
          onChange={setAssignee}
          placeholder={subjectType === 'matter' ? "The record's owner" : 'Nobody'}
        />
        <Textarea label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the person doing it should know" />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar feed                                                       */
/* ------------------------------------------------------------------ */

type FeedScope = 'mine' | 'all';

function feedUrl(path: string): string {
  const base = getPbClient().pb.baseURL.replace(/\/$/, '');
  const origin = /^https?:\/\//.test(base) ? base : `${window.location.origin}${base}`;
  return `${origin}${path}`;
}

export function CalendarFeedDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { can } = useApp();
  const [confirmEl, confirm] = useConfirm();
  const [scope, setScope] = useState<FeedScope>('mine');
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = async (sc: FeedScope | null, rotate: boolean): Promise<void> => {
    setBusy(true);
    try {
      // No scope reads the current feed without changing it.
      const r = await op<{ path: string; scope: FeedScope }>('calendar/feed', { ...(sc !== null ? { scope: sc } : {}), ...(rotate ? { rotate: true } : {}) });
      setPath(r.path);
      setScope(r.scope);
      setError('');
      if (rotate) toast.success('New link created. The old link no longer works.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const url = path !== null ? feedUrl(path) : '';

  const copy = async (): Promise<void> => {
    if (url === '') return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      const el = inputRef.current;
      if (el === null) return;
      el.focus();
      el.select();
      // Fallback for browsers without clipboard access in this context.
      const ok = document.execCommand('copy');
      if (ok) toast.success('Link copied');
      else toast.info('The link is selected. Press Ctrl+C (Cmd+C on a Mac) to copy it.');
    }
  };

  const rotate = async (): Promise<void> => {
    const ok = await confirm(
      'Create a new link? The current link stops working in every calendar that subscribed to it, so you need to subscribe again with the new one.',
      'Replace the calendar link',
    );
    if (ok) await load(scope, true);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Calendar feed"
      description="Subscribe to your deadlines from your own calendar app. It updates on its own as dates change here."
      className="w-[min(94vw,36rem)]"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {confirmEl}
      <div className="flex flex-col gap-4">
        <Field label="Deadlines in the feed" help="The link stays the same when you switch; the calendar shows the new choice at its next refresh.">
          <Segmented<FeedScope>
            size="sm"
            ariaLabel="Deadlines in the feed"
            value={scope}
            onChange={(v) => {
              if (v !== scope) void load(v, false);
            }}
            options={can.edit ? [
              { value: 'mine', label: 'Assigned to me' },
              { value: 'all', label: 'All deadlines' },
            ] : [{ value: 'mine', label: 'Assigned to me' }]}
          />
        </Field>

        {error !== '' ? (
          <Notice tone="bad">{error}</Notice>
        ) : (
          <Field label="Subscription link">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                readOnly
                aria-label="Subscription link"
                value={path === null ? 'Creating your link...' : url}
                onFocus={(e) => e.target.select()}
                className="h-9 min-w-0 flex-1 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 font-mono text-[12px]"
              />
              <Button variant="outline" onClick={() => void copy()} disabled={path === null}>
                <Copy size={14} aria-hidden /> Copy
              </Button>
            </div>
          </Field>
        )}

        <div className="flex flex-col gap-2 border border-[var(--agent-app-border)] px-3 py-2.5 text-[13px] leading-relaxed">
          <p>
            <b>Google Calendar:</b> next to Other calendars choose +, then From URL. Paste the link and select Add calendar.
          </p>
          <p>
            <b>Outlook:</b> choose Add calendar, then Subscribe from web. Paste the link, name it and select Import.
          </p>
          <p>
            <b>Apple Calendar:</b> choose File, then New Calendar Subscription. Paste the link and select Subscribe.
          </p>
          <p className="text-xs text-[var(--agent-app-muted)]">Calendar apps refresh subscriptions every few hours, so a change here can take a while to show.</p>
        </div>

        <Notice tone="warn">
          Anyone with this link can see the deadlines in it. Keep it private. If it was shared by mistake, replace it.
        </Notice>
        <div>
          <Button variant="outline" size="sm" onClick={() => void rotate()} loading={busy && path !== null} disabled={path === null && error === ''}>
            <RefreshCw size={13} aria-hidden /> Replace the link
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
