/**
 * Recording events: pick what happened and when, preview the deadlines the
 * rules would create (tick or untick each, see why), then commit. Also the
 * regenerate dialog shown after base dates change: a diff, never silent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button, Dialog, Input, Select, cn, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { mergeSelection, useLiveReload } from '../lib/live.ts';
import { fmtDate, today } from '../lib/format.ts';
import { KIND_HELP, KIND_LABEL } from '../lib/labels.ts';
import type { IpType, Proposal } from '../lib/types.ts';
import { UserSelect } from './pickers.tsx';
import { Checkbox, Field, Notice, Tag } from './ui.tsx';

/** Event codes offered per record type, most common first. */
const EVENTS_BY_TYPE: Record<string, string[]> = {
  patent: [
    'FILED',
    'PUBLISHED',
    'SEARCH_REPORT_PUBLISHED',
    'EXAM_REQUESTED',
    'OA_NONFINAL',
    'OA_FINAL',
    'RESTRICTION',
    'OA_ISSUED',
    'RESPONSE_FILED',
    'NOTICE_ALLOWANCE',
    'R71_3',
    'GRANTED',
    'EP_GRANT_MENTION',
    'UNITARY_REGISTERED',
    'GAZETTE_PUBLISHED',
    'ANNUITY_PAID',
    'OPPOSITION_FILED',
    'APPEAL_FILED',
    'REFUSED',
    'ABANDONED',
    'WITHDRAWN',
    'LAPSED',
    'EXPIRED',
    'REVOKED',
    'ASSIGNED',
    'OTHER',
  ],
  trademark: [
    'FILED',
    'PUBLISHED',
    'OA_ISSUED',
    'RESPONSE_FILED',
    'NOTICE_ALLOWANCE',
    'REGISTERED',
    'GAZETTE_PUBLISHED',
    'DECLARATION_ACCEPTED',
    'RENEWED',
    'OPPOSITION_FILED',
    'APPEAL_FILED',
    'REFUSED',
    'ABANDONED',
    'WITHDRAWN',
    'LAPSED',
    'EXPIRED',
    'REVOKED',
    'ASSIGNED',
    'OTHER',
  ],
  design: ['FILED', 'PUBLISHED', 'OA_ISSUED', 'RESPONSE_FILED', 'NOTICE_ALLOWANCE', 'REGISTERED', 'GRANTED', 'RENEWED', 'ANNUITY_PAID', 'REFUSED', 'ABANDONED', 'LAPSED', 'EXPIRED', 'ASSIGNED', 'OTHER'],
  copyright: ['FILED', 'REGISTERED', 'ASSIGNED', 'OTHER'],
  domain: ['REGISTERED', 'RENEWED', 'EXPIRED', 'OTHER'],
  agreement: ['AUTHOR_GRANT_EXECUTED', 'OTHER'],
  work: ['WORK_PUBLISHED', 'OTHER'],
};

export function eventCodesFor(ipType: IpType | 'agreement' | 'work'): string[] {
  if (ipType === 'utility_model') return EVENTS_BY_TYPE['patent'] ?? [];
  return EVENTS_BY_TYPE[ipType] ?? EVENTS_BY_TYPE['patent'] ?? [];
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
    return <p className="text-[13px] text-[var(--agent-app-muted)]">No rule creates a deadline for this event here. You can still record it; add deadlines by hand if needed.</p>;
  }
  return (
    <div className="border border-[var(--agent-app-border)]">
      {proposals.map((p) => {
        const disabled = p.exists;
        return (
          <div key={p.key} className={cn('border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0', p.past && 'opacity-70')}>
            <div className="flex items-start gap-2.5">
              <div className="pt-0.5">
                <Checkbox checked={selected.has(p.key) && !disabled} disabled={disabled} onChange={(v) => onToggle(p.key, v)} ariaLabel={`Create ${p.title}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{p.title}</span>
                  <Tag title={KIND_HELP[p.kind]}>{KIND_LABEL[p.kind]}</Tag>
                  {p.exists && <Tag>Already on the docket</Tag>}
                  {p.past && !p.exists && <Tag>Already past</Tag>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs tabular-nums text-[var(--agent-app-muted)]">
                  {p.target_date !== p.due_date && <span>Target {fmtDate(p.target_date)}</span>}
                  <span className="text-[var(--agent-app-text)]/85">Due {fmtDate(p.due_date)}</span>
                  {p.final_date !== '' && <span>Final {fmtDate(p.final_date)}</span>}
                  {p.grace_end !== '' && <span>Grace to {fmtDate(p.grace_end)}</span>}
                  <button type="button" className="inline-flex items-center gap-1 text-[var(--agent-app-accent)] hover:underline" onClick={() => setWhy(why === p.key ? null : p.key)}>
                    <HelpCircle size={11} aria-hidden /> Why
                  </button>
                </div>
                {why === p.key && (
                  <div className="mt-2 border-l-2 border-[var(--agent-app-accent)] pl-3 text-xs leading-relaxed">
                    <ol className="list-decimal pl-4">
                      {p.steps.map((s, i) => (
                        <li key={`${i}-${s}`}>{s}</li>
                      ))}
                    </ol>
                    {p.citation !== '' && <div className="mt-1 text-[var(--agent-app-muted)]">Basis: {p.citation}</div>}
                    {p.notes !== '' && <div className="mt-1 text-[var(--agent-app-muted)]">{p.notes}</div>}
                  </div>
                )}
              </div>
              {showAssign && onAssign !== undefined && selected.has(p.key) && !disabled && (
                <div className="w-40 shrink-0">
                  <UserSelect value={assignees?.[p.key] ?? ''} onChange={(id) => onAssign(p.key, id)} placeholder="Default owner" />
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
  subjectId,
  subjectType = 'matter',
  ipType,
  jurisdiction,
  initialCode,
  onClose,
  onDone,
}: {
  subjectId: string;
  subjectType?: 'matter' | 'agreement' | 'work' | undefined;
  ipType: IpType | 'agreement' | 'work';
  jurisdiction?: string | undefined;
  initialCode?: string | undefined;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { meta } = useApp();
  const codes = eventCodesFor(ipType);
  const [code, setCode] = useState(initialCode ?? codes[0] ?? 'OTHER');
  const [date, setDate] = useState(today());
  const [label, setLabel] = useState('');
  const [periodMonths, setPeriodMonths] = useState('');
  const [periodDays, setPeriodDays] = useState('');
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Deadlines another person or an agent adds meanwhile change what this
  // event would create ("already on the docket"); re-preview, keep the ticks.
  const [liveTick, setLiveTick] = useState(0);
  const seenTick = useRef(0);
  const proposalsRef = useRef<Proposal[] | null>(null);
  proposalsRef.current = proposals;
  useLiveReload(['deadlines', 'rules', 'office_calendars', 'events'], () => setLiveTick((t) => t + 1));
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const data = useMemo(() => {
    const d: Record<string, unknown> = {};
    if (Number(periodMonths) > 0) d['period_months'] = Number(periodMonths);
    if (Number(periodDays) > 0) d['period_days'] = Number(periodDays);
    return d;
  }, [periodMonths, periodDays]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let cancelled = false;
    const fromLive = seenTick.current !== liveTick;
    seenTick.current = liveTick;
    const t = setTimeout(() => {
      op<{ proposals: Proposal[] }>('matters/preview-event', { matter_id: subjectId, subject_type: subjectType, code, date, data })
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
      clearTimeout(t);
    };
  }, [subjectId, subjectType, code, date, data, liveTick]);

  const designated = (proposals ?? []).some((p) => p.kind === 'designated');

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ created: { title: string; due_date: string }[] }>('matters/record-event', {
        matter_id: subjectId,
        subject_type: subjectType,
        code,
        date,
        label,
        data,
        select: [...selected],
        assignees: Object.entries(assignees).map(([key, assignee]) => ({ key, assignee })),
      });
      toast.success(r.created.length ? `Recorded. ${r.created.length} deadline${r.created.length === 1 ? '' : 's'} created.` : 'Recorded.');
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const eventLabel = (c: string): string => meta?.event_codes[c]?.label ?? c;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record what happened"
      description="Events drive deadlines. Nothing is created until you confirm."
      className="w-[min(94vw,44rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {selected.size > 0 ? `Record and create ${selected.size} deadline${selected.size === 1 ? '' : 's'}` : 'Record event'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Event" value={code} options={codes.map((c) => ({ value: c, label: eventLabel(c) }))} onChange={(e) => setCode(e.target.value)} />
          <Field label="Date" help="The mailing, notification or dispatch date printed on the document.">
            <input type="date" className="h-9 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Input label="Description (optional)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={eventLabel(code)} />
        {(designated || code === 'OA_ISSUED') && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Reply period set by the office (months)" type="number" min={0} value={periodMonths} onChange={(e) => setPeriodMonths(e.target.value)} placeholder="e.g. 4" />
            <Input label="or in days" type="number" min={0} value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} placeholder="e.g. 60" />
          </div>
        )}
        {jurisdiction !== undefined && jurisdiction !== '' && designated && (
          <Notice>
            The {jurisdiction} office sets this reply period in each communication. Enter it from the document; the usual period is used otherwise.
          </Notice>
        )}
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Deadlines this creates</h4>
          {error !== '' ? (
            <Notice tone="bad">{error}</Notice>
          ) : proposals === null ? (
            <p className="text-sm text-[var(--agent-app-muted)]">Working out deadlines...</p>
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
  moved: { id: string; title: string; from: string; to: string; final_from: string; final_to: string }[];
  unchanged: number;
}

/** After base dates change: show which deadlines would move, apply on confirm. */
export function RegenerateDialog({
  subjectId,
  subjectType = 'matter',
  onClose,
  onDone,
}: {
  subjectId: string;
  subjectType?: 'matter' | 'agreement' | 'work' | undefined;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element | null {
  const [diff, setDiff] = useState<RegenResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    op<RegenResult>('matters/regenerate', { matter_id: subjectId, subject_type: subjectType, apply: false })
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
      await op<RegenResult>('matters/regenerate', { matter_id: subjectId, subject_type: subjectType, apply: true });
      toast.success(`${diff.moved.length} deadline${diff.moved.length === 1 ? '' : 's'} moved`);
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
      title="Your change moves deadlines"
      description={`${diff.moved.length} move, ${diff.unchanged} stay as they are. Locked dates never move.`}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Keep current dates
          </Button>
          <Button onClick={() => void apply()} loading={busy}>
            Move {diff.moved.length} deadline{diff.moved.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="max-h-72 overflow-y-auto border border-[var(--agent-app-border)] text-[13px]">
        {diff.moved.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 border-b border-[var(--agent-app-border)]/60 px-3 py-2 last:border-0">
            <span className="min-w-0 truncate">{m.title}</span>
            <span className="shrink-0 tabular-nums">
              <span className="text-[var(--agent-app-muted)] line-through">{fmtDate(m.from)}</span> → <b>{fmtDate(m.to)}</b>
            </span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
