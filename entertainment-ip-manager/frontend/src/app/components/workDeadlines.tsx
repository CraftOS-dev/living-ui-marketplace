/**
 * Deadlines page pieces: a deadline entered by hand (deadlines/create, for
 * dates no rule covers) and the personal calendar feed (calendar/feed:
 * subscribe from Google Calendar, Outlook or Apple Calendar; replace the
 * secret link if it leaks).
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarPlus, Copy, RefreshCw } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { useConfirm } from './confirm.tsx';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10 } from '../lib/format.ts';
import { enumOptions, t } from '../lib/i18n.ts';
import { kindHelp } from './deadlines.tsx';
import { UserSelect } from './pickers.tsx';
import { Field, Notice, Section, Segmented } from './ui.tsx';
import { DateField, SubjectPicker, absoluteUrl, errMsg } from './workShared.tsx';
import type { PickType } from './workShared.tsx';

/** The usual area of a deadline on each record type (until the person picks one). */
const CATEGORY_FOR: Record<PickType, string> = {
  matter: 'prosecution',
  agreement: 'agreement',
  work: 'copyright',
  character: 'other',
  talent: 'talent',
  product: 'licensing',
  committee: 'committee',
  case: 'enforcement',
  permission: 'permission',
};

export function NewDeadlineDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const [subjectType, setSubjectType] = useState<PickType | ''>('matter');
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [titleJa, setTitleJa] = useState('');
  const [due, setDue] = useState('');
  const [finalDate, setFinalDate] = useState('');
  const [kind, setKind] = useState('internal');
  const [category, setCategory] = useState(CATEGORY_FOR.matter);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [citation, setCitation] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const errors = {
    subject: subjectType !== '' && subjectId === '' ? t('Choose the record, or choose No record.') : '',
    title: title.trim() === '' ? t('Say what needs to happen.') : '',
    due: d10(due) === '' ? t('Enter the due date.') : '',
    final: d10(finalDate) !== '' && d10(due) !== '' && finalDate < due ? t('The final date cannot be before the due date.') : '',
  };
  const invalid = Object.values(errors).some((e) => e !== '');
  const show = (e: string): string | undefined => (tried && e !== '' ? e : undefined);

  const submit = async (): Promise<void> => {
    setTried(true);
    if (invalid) return;
    setBusy(true);
    try {
      const r = await op<{ id: string }>('deadlines/create', {
        ...(subjectType !== '' ? { subject_type: subjectType, subject_id: subjectId } : {}),
        title: title.trim(),
        title_ja: titleJa.trim(),
        due_date: d10(due),
        final_date: d10(finalDate),
        kind,
        category,
        assignee,
        citation: citation.trim(),
        notes: notes.trim(),
      });
      toast.success(t('Deadline added'));
      onCreated(r.id);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('New deadline')}
      description={t('For dates no rule covers, such as a licensor instruction or an internal review. Dates that follow from an event are better recorded as the event on the record.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={tried && invalid}>
            {t('Add deadline')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <Field label={t('Belongs to')} error={show(errors.subject)}>
          <SubjectPicker
            type={subjectType}
            id={subjectId}
            allowNone
            onChange={(ty, id) => {
              setSubjectType(ty);
              setSubjectId(id);
              if (!categoryTouched) setCategory(ty !== '' ? CATEGORY_FOR[ty] : 'other');
            }}
          />
        </Field>
        <Input label={t('What needs to happen')} value={title} onChange={(e) => setTitle(e.target.value)} error={show(errors.title)} placeholder={t('For example: send the renewal instruction to local counsel')} />
        <Input label={t('Japanese title (optional)')} value={titleJa} onChange={(e) => setTitleJa(e.target.value)} placeholder={t('Shown to people who read the app in Japanese')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField label={t('Due date')} value={due} onChange={setDue} required error={show(errors.due)} />
          <DateField label={t('Final date (optional)')} value={finalDate} onChange={setFinalDate} error={show(errors.final)} help={t('The last possible date, for example with paid extensions.')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Kind')} help={kindHelp(kind)}>
            <Select aria-label={t('Kind')} value={kind} options={enumOptions('deadlines.kind').map(([value, label]) => ({ value, label }))} onChange={(e) => setKind(e.target.value)} />
          </Field>
          <Field label={t('Category')}>
            <Select
              aria-label={t('Category')}
              value={category}
              options={enumOptions('deadlines.category').map(([value, label]) => ({ value, label }))}
              onChange={(e) => {
                setCategory(e.target.value);
                setCategoryTouched(true);
              }}
            />
          </Field>
        </div>
        <UserSelect label={t('Assigned to')} value={assignee} onChange={setAssignee} placeholder={t('Nobody')} />
        <Input label={t('Legal basis or clause (optional)')} value={citation} onChange={(e) => setCitation(e.target.value)} placeholder={t('For example: Article 12 of the licence agreement')} />
        <Textarea label={t('Notes (optional)')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Anything the person doing it should know')} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar feed                                                       */
/* ------------------------------------------------------------------ */

type FeedScope = 'mine' | 'all';

export function CalendarFeedPanel({ defaultOpen = false }: { defaultOpen?: boolean | undefined }): React.JSX.Element {
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
      // Without a scope the current feed is read as it is.
      const r = await op<{ path: string; scope: FeedScope }>('calendar/feed', { ...(sc !== null ? { scope: sc } : {}), ...(rotate ? { rotate: true } : {}) });
      setPath(r.path);
      setScope(r.scope);
      setError('');
      if (rotate) toast.success(t('New link created. The old link no longer works.'));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // Opened from a link ("#/deadlines?feed=1"): show the link straight away.
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!defaultOpen) return;
    void load(null, false);
    const timer = setTimeout(() => boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const url = path !== null ? absoluteUrl(path) : '';

  const copy = async (): Promise<void> => {
    if (url === '') return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('Link copied'));
    } catch {
      const el = inputRef.current;
      if (el === null) return;
      el.focus();
      el.select();
      toast.info(t('The link is selected. Press Ctrl+C (Cmd+C on a Mac) to copy it.'));
    }
  };

  const rotate = async (): Promise<void> => {
    const ok = await confirm(
      t('Create a new link? The current link stops working in every calendar that subscribed to it, so you need to subscribe again with the new one.'),
      t('Replace the calendar link'),
    );
    if (ok) await load(scope, true);
  };

  return (
    <div ref={boxRef} className="scroll-mt-4">
      <Section title={t('Calendar feed')} meta={path !== null ? (scope === 'all' ? t('All deadlines') : t('Assigned to me')) : undefined}>
        {confirmEl}
        {path === null && error === '' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
              {t('Subscribe to your deadlines from your own calendar app. It updates on its own as dates change here.')}
            </p>
            <Button
              variant="outline"
              loading={busy}
              onClick={() => void load(null, false)}
            >
              <CalendarPlus size={14} aria-hidden /> {t('Show my calendar link')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {can.edit && (
              <Field label={t('Deadlines in the feed')} help={t('The link stays the same when you switch; calendars show the new choice at their next refresh.')}>
                <div>
                  <Segmented<FeedScope>
                    size="sm"
                    ariaLabel={t('Deadlines in the feed')}
                    value={scope}
                    onChange={(v) => {
                      if (v !== scope) void load(v, false);
                    }}
                    options={[
                      { value: 'mine', label: t('Assigned to me') },
                      { value: 'all', label: t('All deadlines') },
                    ]}
                  />
                </div>
              </Field>
            )}
            {error !== '' ? (
              <Notice tone="bad">{error}</Notice>
            ) : (
              <Field label={t('Subscription link')}>
                <div className="flex min-w-0 gap-2">
                  <input
                    ref={inputRef}
                    readOnly
                    aria-label={t('Subscription link')}
                    value={url}
                    onFocus={(e) => e.target.select()}
                    className="h-9 min-w-0 flex-1 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 font-mono text-[12px]"
                  />
                  <Button variant="outline" onClick={() => void copy()}>
                    <Copy size={14} aria-hidden /> <span className="hidden sm:inline">{t('Copy')}</span>
                  </Button>
                </div>
              </Field>
            )}
            <div className="flex flex-col gap-1.5 border border-[var(--agent-app-border)] px-3 py-2.5 text-[13px] leading-relaxed">
              <p>{t('Google Calendar: next to Other calendars choose +, then From URL, paste the link and add the calendar.')}</p>
              <p>{t('Outlook: choose Add calendar, then Subscribe from web, paste the link and import it.')}</p>
              <p>{t('Apple Calendar: choose File, then New Calendar Subscription, paste the link and subscribe.')}</p>
              <p className="text-xs text-[var(--agent-app-muted)]">{t('Calendar apps refresh subscriptions every few hours, so a change here can take a while to show.')}</p>
            </div>
            <Notice tone="warn">{t('Anyone with this link can see the deadlines in it. Keep it private. If it was shared by mistake, replace it.')}</Notice>
            <div>
              <Button variant="outline" size="sm" onClick={() => void rotate()} loading={busy && path !== null}>
                <RefreshCw size={13} aria-hidden /> {t('Replace the link')}
              </Button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
