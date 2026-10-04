/**
 * Recording events on any record: pick what happened and when, preview the
 * deadlines the rules would create (tick or untick each, see why), then
 * commit. Also the regenerate dialog shown after base dates change: a diff,
 * never silent. Event codes come from the server catalog (meta), filtered by
 * the record type each code applies to.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button, Dialog, Input, Select, cn, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { mergeSelection, useLiveReload } from '../lib/live.ts';
import { fmtDate, today } from '../lib/format.ts';
import { bi, enumLabel, t, tf, tn } from '../lib/i18n.ts';
import type { Proposal } from '../lib/shapes.ts';
import { kindHelp } from './deadlines.tsx';
import { UserSelect } from './pickers.tsx';
import { Checkbox, Field, Notice, Tag } from './ui.tsx';

/** Record types an event can be recorded on (server SUBJECTS keys). */
export type SubjectType =
  | 'matter'
  | 'agreement'
  | 'work'
  | 'character'
  | 'talent'
  | 'product'
  | 'approval'
  | 'permission'
  | 'committee'
  | 'case'
  | 'registration'
  | 'claim'
  | 'recordation'
  | 'society_contract'
  | 'fan_registration'
  | 'enrollment';

/** Event codes that apply to a record type, in catalog order. */
export function useEventCodes(subjectType: SubjectType): string[] {
  const { meta } = useApp();
  return useMemo(() => Object.entries(meta?.event_codes ?? {}).filter(([, d]) => d.subjects.includes(subjectType)).map(([c]) => c), [meta, subjectType]);
}

export function useEventLabel(): (code: string) => string {
  const { meta } = useApp();
  return (code: string) => {
    const d = meta?.event_codes[code];
    return d === undefined ? code : tf(d, 'label');
  };
}

export function ProposalList({
  proposals,
  selected,
  onToggle,
  assignees,
  onAssign,
  showAssign = false,
}: {
  proposals: Proposal[];
  selected: Set<string>;
  onToggle: (key: string, v: boolean) => void;
  assignees?: Record<string, string> | undefined;
  onAssign?: ((key: string, userId: string) => void) | undefined;
  showAssign?: boolean | undefined;
}): React.JSX.Element {
  const [why, setWhy] = useState<string | null>(null);
  if (proposals.length === 0) {
    return <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No rule creates a deadline for this event here. You can still record it and add deadlines by hand.')}</p>;
  }
  return (
    <div className="border border-[var(--agent-app-border)]">
      {proposals.map((p) => {
        const disabled = p.exists;
        return (
          <div key={p.key} className={cn('border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0', p.past && 'opacity-70')}>
            <div className="flex flex-wrap items-start gap-2.5 sm:flex-nowrap">
              <div className="pt-0.5">
                <Checkbox checked={selected.has(p.key) && !disabled} disabled={disabled} onChange={(v) => onToggle(p.key, v)} ariaLabel={t('Create {title}', { title: tf(p, 'title') })} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{tf(p, 'title')}</span>
                  <Tag title={kindHelp(p.kind)}>{enumLabel('deadlines.kind', p.kind)}</Tag>
                  {p.exists && <Tag>{t('Already on the list')}</Tag>}
                  {p.past && !p.exists && <Tag>{t('Already past')}</Tag>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs tabular-nums text-[var(--agent-app-muted)]">
                  {p.target_date !== '' && p.target_date !== p.due_date && <span>{t('Target {date}', { date: fmtDate(p.target_date) })}</span>}
                  <span className="text-[var(--agent-app-text)]/85">{t('Due {date}', { date: fmtDate(p.due_date) })}</span>
                  {p.final_date !== '' && <span>{t('Final {date}', { date: fmtDate(p.final_date) })}</span>}
                  {p.grace_end !== '' && <span>{t('Grace to {date}', { date: fmtDate(p.grace_end) })}</span>}
                  <button type="button" className="inline-flex items-center gap-1 text-[var(--agent-app-accent)] hover:underline" onClick={() => setWhy(why === p.key ? null : p.key)}>
                    <HelpCircle size={11} aria-hidden /> {t('Why')}
                  </button>
                </div>
                {why === p.key && (
                  <div className="mt-2 border-l-2 border-[var(--agent-app-accent)] pl-3 text-xs leading-relaxed">
                    <ol className="list-decimal pl-4">
                      {p.steps.map((s, i) => (
                        <li key={i}>{bi(s)}</li>
                      ))}
                    </ol>
                    {p.citation !== '' && <div className="mt-1 text-[var(--agent-app-muted)]">{t('Basis: {citation}', { citation: p.citation })}</div>}
                    {p.notes !== '' && <div className="mt-1 text-[var(--agent-app-muted)]">{p.notes}</div>}
                  </div>
                )}
              </div>
              {showAssign && onAssign !== undefined && selected.has(p.key) && !disabled && (
                <div className="w-full shrink-0 sm:w-40">
                  <UserSelect value={assignees?.[p.key] ?? ''} onChange={(id) => onAssign(p.key, id)} placeholder={t('Default owner')} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EventDialog({
  subjectType,
  subjectId,
  codes: codesIn,
  initialCode,
  jurisdiction,
  onClose,
  onDone,
}: {
  subjectType: SubjectType;
  subjectId: string;
  codes?: string[] | undefined;
  initialCode?: string | undefined;
  jurisdiction?: string | undefined;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const catalog = useEventCodes(subjectType);
  const codes = codesIn ?? catalog;
  const eventLabel = useEventLabel();
  const [code, setCode] = useState(initialCode ?? codes[0] ?? '');
  const [date, setDate] = useState(today());
  const [label, setLabel] = useState('');
  const [periodMonths, setPeriodMonths] = useState('');
  const [periodDays, setPeriodDays] = useState('');
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Deadlines another person or an agent adds meanwhile change what this
  // event would create ("already on the list"); re-preview, keep the ticks.
  const [liveTick, setLiveTick] = useState(0);
  const seenTick = useRef(0);
  const proposalsRef = useRef<Proposal[] | null>(null);
  proposalsRef.current = proposals;
  useLiveReload(['deadlines', 'rules', 'office_calendars', 'events'], () => setLiveTick((x) => x + 1));
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (code === '' && codes[0] !== undefined) setCode(codes[0]);
  }, [code, codes]);

  const data = useMemo(() => {
    const d: Record<string, unknown> = {};
    if (Number(periodMonths) > 0) d['period_months'] = Number(periodMonths);
    if (Number(periodDays) > 0) d['period_days'] = Number(periodDays);
    return d;
  }, [periodMonths, periodDays]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || code === '') return;
    let cancelled = false;
    const fromLive = seenTick.current !== liveTick;
    seenTick.current = liveTick;
    const timer = setTimeout(() => {
      op<{ proposals: Proposal[] }>('events/preview', { subject_type: subjectType, subject_id: subjectId, code, date, data })
        .then((r) => {
          if (cancelled) return;
          const prev = fromLive ? proposalsRef.current : null;
          setProposals(r.proposals);
          setSelected((sel) => mergeSelection(sel, prev, r.proposals, (p) => p.selected));
          setError('');
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setProposals([]);
            setError(e instanceof Error ? e.message : String(e));
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [subjectId, subjectType, code, date, data, liveTick]);

  const designated = (proposals ?? []).some((p) => p.kind === 'designated');

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ created: { title: string; due_date: string }[] }>('events/record', {
        subject_type: subjectType,
        subject_id: subjectId,
        code,
        date,
        label,
        data,
        select: [...selected],
        assignees: Object.entries(assignees).map(([key, assignee]) => ({ key, assignee })),
      });
      toast.success(r.created.length ? tn(r.created.length, 'Recorded. {n} deadline created.', 'Recorded. {n} deadlines created.') : t('Recorded.'));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Record what happened')}
      description={t('Events drive deadlines. Nothing is created until you confirm.')}
      className="w-[min(94vw,44rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={code === ''}>
            {selected.size > 0 ? tn(selected.size, 'Record and create {n} deadline', 'Record and create {n} deadlines') : t('Record event')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Event')} value={code} options={codes.map((c) => ({ value: c, label: eventLabel(c) }))} onChange={(e) => setCode(e.target.value)} />
          <Field label={t('Date')} help={t('The date printed on the document (dispatch, notification or mailing date).')}>
            <input type="date" className="h-9 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Input label={t('Description (optional)')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={eventLabel(code)} />
        {(designated || code === 'OA_ISSUED') && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('Reply period set in the letter (months)')} type="number" min={0} value={periodMonths} onChange={(e) => setPeriodMonths(e.target.value)} />
            <Input label={t('or in days')} type="number" min={0} value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} />
          </div>
        )}
        {jurisdiction !== undefined && jurisdiction !== '' && designated && <Notice>{t('This office sets the reply period in each letter. Enter it from the document; the usual period is used otherwise.')}</Notice>}
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Deadlines this creates')}</h4>
          {error !== '' ? (
            <Notice tone="bad">{error}</Notice>
          ) : proposals === null ? (
            <p className="text-sm text-[var(--agent-app-muted)]">{t('Working out deadlines...')}</p>
          ) : (
            <ProposalList
              proposals={proposals}
              selected={selected}
              onToggle={(k, v) =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (v) n.add(k);
                  else n.delete(k);
                  return n;
                })
              }
              showAssign
              assignees={assignees}
              onAssign={(k, id) => setAssignees((a) => ({ ...a, [k]: id }))}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

interface RegenResult {
  moved: { id: string; title: string; title_ja: string; from: string; to: string; final_from: string; final_to: string }[];
  unchanged: number;
}

/** After base dates change: show which deadlines would move, apply on confirm. Closes itself when nothing moves. */
export function RegenerateDialog({ subjectType, subjectId, onClose, onDone }: { subjectType: SubjectType; subjectId: string; onClose: () => void; onDone: () => void }): React.JSX.Element | null {
  const [diff, setDiff] = useState<RegenResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    op<RegenResult>('events/regenerate', { subject_type: subjectType, subject_id: subjectId, apply: false })
      .then((r) => {
        if (cancelled) return;
        if (r.moved.length === 0) {
          onClose();
          return;
        }
        setDiff(r);
      })
      .catch(() => onClose());
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);
  if (diff === null) return null;
  const apply = async (): Promise<void> => {
    setBusy(true);
    try {
      await op<RegenResult>('events/regenerate', { subject_type: subjectType, subject_id: subjectId, apply: true });
      toast.success(tn(diff.moved.length, '{n} deadline moved', '{n} deadlines moved'));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Your change moves deadlines')}
      description={t('{moved} move, {kept} stay as they are. Locked dates never move.', { moved: diff.moved.length, kept: diff.unchanged })}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Keep current dates')}
          </Button>
          <Button onClick={() => void apply()} loading={busy}>
            {tn(diff.moved.length, 'Move {n} deadline', 'Move {n} deadlines')}
          </Button>
        </>
      }
    >
      <div className="max-h-72 overflow-y-auto border border-[var(--agent-app-border)] text-[13px]">
        {diff.moved.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 border-b border-[var(--agent-app-border)]/60 px-3 py-2 last:border-0">
            <span className="min-w-0 truncate">{tf(m, 'title')}</span>
            <span className="shrink-0 tabular-nums">
              <span className="text-[var(--agent-app-muted)] line-through">{fmtDate(m.from)}</span> {'>'} <b>{fmtDate(m.to)}</b>
            </span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
