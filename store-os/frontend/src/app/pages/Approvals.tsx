/**
 * Approvals: the changes your AI agent proposes wait here, one card per set,
 * each change shown before and after with its risk and the reason. Approve
 * all or some, or reject with a note. J/K (or the arrow keys) move between
 * cards, A approves, R rejects. History keeps what was decided, with undo
 * where a change can be put back.
 */
import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, History, ListChecks, Sparkles, Undo2, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { LISTING_LABEL } from '../components/badges.tsx';
import { Button, Card, Checkbox, confirmAsk, Dialog, Empty, Field, IconBadge, PageHeader, Pill, Skeleton, Tabs, TextArea, Tip } from '../components/ui.tsx';
import type { Tone } from '../components/ui.tsx';
import { op } from '../lib/api.ts';
import { ago, dayTime, money, num, plural, STATUS_LABEL } from '../lib/format.ts';
import { changed, useLive } from '../lib/live.ts';
import type { Collection, Live } from '../lib/live.ts';
import { vanish } from '../lib/motion.tsx';
import { go } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';
import { useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { Proposal, ProposalField, ProposalItem } from '../lib/types.ts';

type Tab = 'pending' | 'history';

interface ProposalList {
  pending: number;
  proposals: Proposal[];
}

interface ApproveResult {
  proposal: Proposal;
  applied: number;
  failed: number;
}

/** A proposal decided on this page, kept in place to show what happened. */
interface Decided extends ApproveResult {
  at: number;
}

const READS: Collection[] = ['proposals', 'listings', 'variants', 'products', 'orders', 'stock_moves'];
const FIRST_ITEMS = 6;

const RISK: Record<Proposal['risk'], { tone: Tone; label: string }> = {
  low: { tone: 'neutral', label: 'Low risk' },
  medium: { tone: 'warn', label: 'Medium risk' },
  high: { tone: 'bad', label: 'High risk' },
};

const STATUS: Record<Proposal['status'], { tone: Tone; label: string }> = {
  pending: { tone: 'accent', label: 'Waiting' },
  applied: { tone: 'good', label: 'Applied' },
  partial: { tone: 'warn', label: 'Partly applied' },
  failed: { tone: 'bad', label: 'Failed' },
  rejected: { tone: 'neutral', label: 'Rejected' },
  withdrawn: { tone: 'neutral', label: 'Withdrawn' },
  expired: { tone: 'neutral', label: 'Expired' },
  undone: { tone: 'neutral', label: 'Undone' },
};

const ITEM_STATE: Record<ProposalItem['state'], { tone: Tone; label: string }> = {
  pending: { tone: 'neutral', label: 'Waiting' },
  applied: { tone: 'good', label: 'Applied' },
  stale: { tone: 'warn', label: 'Skipped' },
  failed: { tone: 'bad', label: 'Failed' },
  rejected: { tone: 'neutral', label: 'Rejected' },
  undone: { tone: 'neutral', label: 'Undone' },
};

const VALUE_LABEL: Record<string, string> = { ...LISTING_LABEL, ...STATUS_LABEL };

export function ApprovalsPage({ route }: { route: Route }): React.JSX.Element {
  const tab: Tab = route.sub === 'history' ? 'history' : 'pending';
  const { attention } = useStore();
  const pending = useLive<ProposalList>('approvals-pending', (signal) => op<ProposalList>('proposals.list', { status: 'pending' }, { signal, quiet: true }), READS, []);
  const waiting = pending.data?.pending ?? attention?.approvals ?? 0;
  return (
    <div className="max-w-[960px]">
      <PageHeader
        title="Approvals"
        subtitle={waiting === 0 ? 'Nothing waiting' : num(waiting) + ' waiting'}
        actions={
          <Tabs<Tab>
            value={tab}
            onChange={(k) => go('approvals', k)}
            items={[
              { key: 'pending', label: 'Waiting', count: waiting, alert: waiting > 0 },
              { key: 'history', label: 'History' },
            ]}
          />
        }
      />
      {tab === 'pending' ? <PendingList live={pending} /> : <HistoryList />}
    </div>
  );
}

/* ------------------------------------------------------------- formatting */

function fieldName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A field's value as text ('' when empty). */
function valueText(f: ProposalField, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (typeof v === 'number') return f.money !== '' ? money(v, f.money) : num(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return f.name === 'status' ? (VALUE_LABEL[v] ?? v) : v;
  return JSON.stringify(v);
}

function isLong(f: ProposalField, before: string, after: string): boolean {
  return f.name === 'description' || before.length > 80 || after.length > 80 || before.includes('\n') || after.includes('\n');
}

interface Seg {
  text: string;
  changed: boolean;
}

/** Word-level difference of two texts (unchanged words, removed words, added words). */
function wordDiff(a: string, b: string): { before: Seg[]; after: Seg[] } {
  const A = a.split(/(\s+)/).filter((x) => x !== '');
  const B = b.split(/(\s+)/).filter((x) => x !== '');
  const n = A.length;
  const m = B.length;
  if (n * m > 300000) return { before: [{ text: a, changed: false }], after: [{ text: b, changed: false }] };
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = A[i] === B[j] ? (dp[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(dp[(i + 1) * w + j] ?? 0, dp[i * w + j + 1] ?? 0);
    }
  }
  const before: Seg[] = [];
  const after: Seg[] = [];
  const push = (list: Seg[], text: string, changedWord: boolean): void => {
    const last = list[list.length - 1];
    if (last !== undefined && last.changed === changedWord) last.text += text;
    else list.push({ text, changed: changedWord });
  };
  const word = (s: string): boolean => s.trim() !== '';
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const x = A[i] ?? '';
    const y = B[j] ?? '';
    if (x === y) {
      push(before, x, false);
      push(after, y, false);
      i++;
      j++;
    } else if ((dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + j + 1] ?? 0)) {
      push(before, x, word(x));
      i++;
    } else {
      push(after, y, word(y));
      j++;
    }
  }
  for (; i < n; i++) push(before, A[i] ?? '', word(A[i] ?? ''));
  for (; j < m; j++) push(after, B[j] ?? '', word(B[j] ?? ''));
  return { before, after };
}

/* ------------------------------------------------------------ the pieces */

/** A muted text cut to three lines, with More. */
function Clamp({ text, className }: { text: string; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el !== null && !open) setOver(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div className={className}>
      <p ref={ref} className={cn('whitespace-pre-wrap break-words text-[13px] leading-5 text-[var(--so-muted)]', !open && 'line-clamp-3')}>
        {text}
      </p>
      {(over || open) && (
        <button type="button" onClick={() => setOpen(!open)} className="hit mt-1 rounded-full text-[13px] font-semibold text-[var(--so-ink-2)] hover:text-[var(--so-ink)] hover:underline">
          {open ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}

/** A long text before and after, side by side, the changed words marked. */
function LongDiff({ name, before, after }: { name: string; before: string; after: string }): React.JSX.Element {
  const [all, setAll] = useState(false);
  const [over, setOver] = useState(false);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const diff = useMemo(() => wordDiff(before, after), [before, after]);
  useLayoutEffect(() => {
    if (all) return;
    const tall = (el: HTMLDivElement | null): boolean => el !== null && el.scrollHeight > el.clientHeight + 1;
    setOver(tall(left.current) || tall(right.current));
  }, [diff, all]);
  const box = cn('whitespace-pre-wrap break-words rounded-[12px] bg-[var(--so-tile)] px-3 py-2 text-[13px] leading-5 text-[var(--so-ink-2)]', !all && 'max-h-[128px] overflow-hidden');
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-[var(--so-muted)]">{name}</span>
        {(over || all) && (
          <button type="button" onClick={() => setAll(!all)} className="hit rounded-full text-[12px] font-semibold text-[var(--so-ink-2)] hover:text-[var(--so-ink)] hover:underline">
            {all ? 'Show less' : 'Show all'}
          </button>
        )}
      </div>
      {before === '' ? (
        <div ref={right} className={box}>
          <span className="mb-1 block text-[12px] font-semibold text-[var(--so-green-text)]">New</span>
          {after}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div ref={left} className={box}>
            <span className="mb-1 block text-[12px] font-semibold text-[var(--so-red-text)]">Before</span>
            {diff.before.map((s, i) =>
              s.changed ? (
                <del key={i} className="rounded-[4px] bg-[var(--so-red-soft)] text-[var(--so-red-text)]">
                  {s.text}
                </del>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </div>
          <div ref={right} className={box}>
            <span className="mb-1 block text-[12px] font-semibold text-[var(--so-green-text)]">After</span>
            {after === ''
              ? 'Empty'
              : diff.after.map((s, i) =>
                  s.changed ? (
                    <ins key={i} className="rounded-[4px] bg-[var(--so-green-soft)] text-[var(--so-green-text)] no-underline">
                      {s.text}
                    </ins>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One field: the old value struck through, the new one beside it. */
function FieldChange({ f }: { f: ProposalField }): React.JSX.Element {
  const before = valueText(f, f.before);
  const after = valueText(f, f.after);
  if (isLong(f, before, after)) return <LongDiff name={fieldName(f.name)} before={before} after={after} />;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="w-24 shrink-0 text-[12px] font-semibold text-[var(--so-muted)]">{fieldName(f.name)}</span>
      {before !== '' ? (
        <del className="num max-w-full break-words rounded-[6px] bg-[var(--so-red-soft)] px-1.5 text-[13px] leading-6 text-[var(--so-red-text)]">{before}</del>
      ) : (
        <span className="text-[13px] leading-6 text-[var(--so-faint)]">None</span>
      )}
      <ArrowRight size={14} className="shrink-0 text-[var(--so-faint)]" aria-hidden />
      {after !== '' ? (
        <ins className="num max-w-full break-words rounded-[6px] bg-[var(--so-green-soft)] px-1.5 text-[13px] font-semibold leading-6 text-[var(--so-green-text)] no-underline">{after}</ins>
      ) : (
        <span className="text-[13px] leading-6 text-[var(--so-faint)]">None</span>
      )}
    </div>
  );
}

/** One change in a set: its label, what it changes, its notes and (once decided) what happened. */
function ItemBlock({ item, check, showState = false, fields = true }: { item: ProposalItem; check?: { checked: boolean; onChange: (v: boolean) => void } | undefined; showState?: boolean; fields?: boolean }): React.JSX.Element {
  return (
    <div className="flex gap-3 border-t border-[var(--so-line)] py-3 first:border-t-0">
      {check !== undefined && <Checkbox checked={check.checked} onChange={check.onChange} label={item.label} className="mt-[3px]" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 text-[14px] font-semibold leading-6">{item.label}</span>
          {item.irreversible && <Pill tone="bad">Cannot be undone</Pill>}
          {showState && <Pill tone={ITEM_STATE[item.state].tone}>{ITEM_STATE[item.state].label}</Pill>}
        </div>
        {fields && item.fields.length > 0 && (
          <div className="mt-2 space-y-2">
            {item.fields.map((f) => (
              <FieldChange key={f.name} f={f} />
            ))}
          </div>
        )}
        {fields &&
          item.notes.map((n) => (
            <p key={n} className="mt-2 flex items-start gap-1.5 text-[12px] font-medium leading-[18px] text-[var(--so-amber-text)]">
              <AlertTriangle size={13} strokeWidth={2.2} className="mt-0.5 shrink-0" aria-hidden />
              {n}
            </p>
          ))}
        {item.error !== '' && <p className={cn('mt-1.5 text-[12px] font-medium leading-[18px]', item.state === 'stale' ? 'text-[var(--so-amber-text)]' : 'text-[var(--so-red-text)]')}>{item.error}</p>}
      </div>
    </div>
  );
}

function openItems(p: Proposal): ProposalItem[] {
  return p.items.filter((i) => i.state === 'pending');
}

function ProposalCard({
  p,
  sel,
  onSel,
  focused,
  busy,
  onApprove,
  onReject,
  onFocus,
}: {
  p: Proposal;
  sel: number[];
  onSel: (next: number[]) => void;
  focused: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onFocus: () => void;
}): React.JSX.Element {
  const [more, setMore] = useState(false);
  const open = openItems(p);
  const shown = more ? p.items : p.items.slice(0, FIRST_ITEMS);
  const allOn = sel.length === open.length;
  const risk = RISK[p.risk];
  return (
    <div id={'proposal-' + p.id} onMouseDown={onFocus}>
      <Card className={cn(focused && 'shadow-[inset_0_0_0_2px_var(--so-ink)]')}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-[15px] font-semibold leading-[22px]">{p.title}</h2>
          <Pill tone={risk.tone} className="shrink-0">
            {risk.label}
          </Pill>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[13px] text-[var(--so-muted)]">
          <IconBadge icon={p.origin === 'agent' ? Sparkles : ListChecks} tone="accent" size={24} />
          <span>
            {p.origin === 'agent' ? 'From your AI agent' : 'From a rule'}, {ago(p.created)}
          </span>
        </div>
        {p.why !== '' && <Clamp text={p.why} className="mt-3" />}
        <div className="mt-4 border-t border-[var(--so-line)]">
          {open.length > 1 && (
            <div className="flex items-center gap-3 border-b border-[var(--so-line)] py-2.5">
              <Checkbox checked={allOn} indeterminate={sel.length > 0 && !allOn} onChange={(v) => onSel(v ? open.map((i) => i.index) : [])} label="Check all" />
              <span className="text-[12px] font-semibold text-[var(--so-muted)]">
                {num(sel.length)} of {plural(open.length, 'change')} checked
              </span>
            </div>
          )}
          {shown.map((it) => (
            <ItemBlock
              key={it.index}
              item={it}
              check={it.state === 'pending' ? { checked: sel.includes(it.index), onChange: (v) => onSel(v ? [...sel, it.index] : sel.filter((x) => x !== it.index)) } : undefined}
            />
          ))}
          {p.items.length > FIRST_ITEMS && (
            <button type="button" onClick={() => setMore(!more)} className="mb-1 h-8 rounded-full px-3 text-[13px] font-semibold text-[var(--so-ink-2)] hover:bg-[var(--so-row-hover)] hover:text-[var(--so-ink)]">
              {more ? 'Show fewer' : 'Show ' + (p.items.length - FIRST_ITEMS) + ' more'}
            </button>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-[var(--so-line)] pt-4">
          <Tip text="Approve the checked changes (A)">
            <Button icon={Check} loading={busy} disabled={sel.length === 0} onClick={onApprove}>
              {open.length <= 1 ? 'Approve' : 'Approve selected'}
            </Button>
          </Tip>
          <Tip text="Reject, with a note for your AI agent (R)">
            <Button variant="secondary" icon={X} disabled={busy} onClick={onReject}>
              Reject
            </Button>
          </Tip>
        </div>
      </Card>
    </div>
  );
}

function ResultCard({ d, busy, onUndo, onDismiss }: { d: Decided; busy: boolean; onUndo: () => void; onDismiss: () => void }): React.JSX.Element {
  const p = d.proposal;
  const st = STATUS[p.status];
  const left = p.items.filter((i) => i.state === 'rejected').length;
  const parts = [d.applied > 0 ? plural(d.applied, 'change') + ' applied' : 'Nothing applied'];
  if (d.failed > 0) parts.push(num(d.failed) + ' not applied');
  if (left > 0) parts.push(num(left) + ' left out');
  const icon = p.status === 'applied' ? CheckCheck : p.status === 'undone' ? Undo2 : AlertTriangle;
  const tone = p.status === 'applied' ? 'good' : p.status === 'failed' ? 'bad' : p.status === 'undone' ? 'tile' : 'warn';
  return (
    <div id={'proposal-' + p.id}>
      <Card>
        <div className="flex items-start gap-3">
          <IconBadge icon={icon} tone={tone} />
          <div className="min-w-0 flex-1">
            <p className="break-words text-[15px] font-semibold leading-[22px]">{p.title}</p>
            <p className="text-[13px] text-[var(--so-muted)]">{parts.join(', ')}</p>
          </div>
          <Pill tone={st.tone} className="shrink-0">
            {st.label}
          </Pill>
        </div>
        <div className="mt-3 border-t border-[var(--so-line)]">
          {p.items.map((it) => (
            <ItemBlock key={it.index} item={it} showState fields={false} />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-2 border-t border-[var(--so-line)] pt-4">
          {p.items.some((i) => i.undoable) && (
            <Button variant="secondary" icon={Undo2} loading={busy} onClick={onUndo}>
              Undo
            </Button>
          )}
          <Button variant="tile" onClick={onDismiss}>
            Done
          </Button>
        </div>
      </Card>
    </div>
  );
}

function RejectDialog({ p, onClose, onReject }: { p: Proposal | null; onClose: () => void; onReject: (p: Proposal, note: string) => void }): React.JSX.Element | null {
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [p]);
  if (p === null) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Reject this change?"
      subtitle={p.title}
      width={460}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={X} onClick={() => onReject(p, note)}>
            Reject
          </Button>
        </>
      }
    >
      <Field label="Note for your AI agent" hint="Optional">
        <TextArea
          rows={3}
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onReject(p, note);
            }
          }}
          placeholder="What should it do instead?"
        />
      </Field>
    </Dialog>
  );
}

async function confirmUndo(p: Proposal): Promise<boolean> {
  return confirmAsk('Undo "' + p.title + '"?', 'Listing text, prices and stock go back to what they were. Order changes stay as they are.', 'Undo', { danger: true });
}

/* ----------------------------------------------------------- waiting tab */

type Entry = { kind: 'pending'; p: Proposal } | { kind: 'done'; d: Decided };

function PendingList({ live }: { live: Live<ProposalList> }): React.JSX.Element {
  const [decided, setDecided] = useState<Record<string, Decided>>({});
  const [picked, setPicked] = useState<Record<string, number[]>>({});
  const [focus, setFocus] = useState('');
  const [kbd, setKbd] = useState(false);
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState<Proposal | null>(null);

  const server = live.data?.proposals ?? [];
  const entries: Entry[] = server.map((p) => {
    const d = decided[p.id];
    return d !== undefined ? { kind: 'done', d } : { kind: 'pending', p };
  });
  const listed = new Set(server.map((p) => p.id));
  for (const d of Object.values(decided)
    .filter((x) => !listed.has(x.proposal.id))
    .sort((a, b) => a.at - b.at)) {
    entries.splice(Math.min(d.at, entries.length), 0, { kind: 'done', d });
  }
  const waiting = entries.flatMap((e) => (e.kind === 'pending' ? [e.p] : []));
  const focused = waiting.find((p) => p.id === focus) ?? waiting[0] ?? null;

  const selection = (p: Proposal): number[] => picked[p.id] ?? openItems(p).map((i) => i.index);

  const approve = async (p: Proposal): Promise<void> => {
    if (busy !== '') return;
    const open = openItems(p);
    const sel = selection(p).filter((i) => open.some((x) => x.index === i));
    if (sel.length === 0) return;
    const chosen = open.filter((i) => sel.includes(i.index));
    const irreversible = chosen.some((i) => i.irreversible);
    if (p.risk === 'high' || irreversible) {
      const ok = await confirmAsk('Approve "' + p.title + '"?', irreversible ? 'Some of these changes cannot be undone.' : 'This is marked high risk.', 'Approve', { danger: true });
      if (!ok) return;
    }
    const at = entries.findIndex((e) => e.kind === 'pending' && e.p.id === p.id);
    const idx = waiting.findIndex((x) => x.id === p.id);
    setBusy(p.id);
    try {
      const r = await op<ApproveResult>('proposals.approve', sel.length === open.length ? { proposal: p.id } : { proposal: p.id, items: sel });
      setDecided((cur) => ({ ...cur, [p.id]: { ...r, at: Math.max(0, at) } }));
      notify.info(r.applied === 0 ? 'Nothing applied' : plural(r.applied, 'change') + ' applied');
      setFocus(waiting[idx + 1]?.id ?? waiting[idx - 1]?.id ?? '');
      changed(...READS);
    } catch {
      /* op showed why */
    } finally {
      setBusy('');
    }
  };

  const reject = async (p: Proposal, note: string): Promise<void> => {
    setRejecting(null);
    const idx = waiting.findIndex((x) => x.id === p.id);
    const putBack = await vanish(document.getElementById('proposal-' + p.id));
    try {
      await op('proposals.reject', { proposal: p.id, note: note.trim() || undefined });
      notify.info('Rejected');
      setFocus(waiting[idx + 1]?.id ?? waiting[idx - 1]?.id ?? '');
      changed('proposals');
    } catch {
      putBack();
    }
  };

  const undo = async (d: Decided): Promise<void> => {
    if (!(await confirmUndo(d.proposal))) return;
    setBusy(d.proposal.id);
    try {
      const r = await op<{ proposal: Proposal; undone: number }>('proposals.undo', { proposal: d.proposal.id });
      setDecided((cur) => ({ ...cur, [d.proposal.id]: { ...d, proposal: r.proposal } }));
      notify.info('Undone');
      changed(...READS);
    } catch {
      /* op showed why */
    } finally {
      setBusy('');
    }
  };

  const dismiss = (id: string): void => {
    setDecided((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  };

  // Keyboard: J/K or arrows move, A approves, R rejects. The handlers change each render; the listener stays.
  const keys = useRef<{ move: (step: number) => void; approve: () => void; reject: () => void }>({ move: () => undefined, approve: () => undefined, reject: () => undefined });
  keys.current = {
    move: (step) => {
      if (waiting.length === 0) return;
      const i = focused === null ? -1 : waiting.findIndex((p) => p.id === focused.id);
      const next = waiting[Math.max(0, Math.min(waiting.length - 1, i < 0 ? 0 : i + step))];
      if (next === undefined) return;
      setFocus(next.id);
      setKbd(true);
      document.getElementById('proposal-' + next.id)?.scrollIntoView({ block: 'nearest' });
    },
    approve: () => {
      if (focused !== null) void approve(focused);
    },
    reject: () => {
      if (focused !== null) setRejecting(focused);
    },
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target;
      if (el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]') !== null) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null) return;
      const k = e.key;
      if (k === 'j' || k === 'J' || k === 'ArrowDown') keys.current.move(1);
      else if (k === 'k' || k === 'K' || k === 'ArrowUp') keys.current.move(-1);
      else if (k === 'a' || k === 'A') keys.current.approve();
      else if (k === 'r' || k === 'R') keys.current.reject();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (live.data === null) {
    if (live.error !== null) return <p className="text-[13px] text-[var(--so-red-text)]">{live.error}</p>;
    return (
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[240px] rounded-[20px]" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map((e) =>
        e.kind === 'pending' ? (
          <ProposalCard
            key={e.p.id}
            p={e.p}
            sel={selection(e.p)}
            onSel={(next) => setPicked((cur) => ({ ...cur, [e.p.id]: next }))}
            focused={kbd && focused?.id === e.p.id}
            busy={busy === e.p.id}
            onApprove={() => void approve(e.p)}
            onReject={() => setRejecting(e.p)}
            onFocus={() => setFocus(e.p.id)}
          />
        ) : (
          <ResultCard key={e.d.proposal.id} d={e.d} busy={busy === e.d.proposal.id} onUndo={() => void undo(e.d)} onDismiss={() => dismiss(e.d.proposal.id)} />
        ),
      )}
      {waiting.length === 0 && (
        <Card>
          <Empty
            icon={CheckCheck}
            title="Nothing waiting"
            action={
              <Button variant="secondary" icon={History} onClick={() => go('approvals', 'history')}>
                See history
              </Button>
            }
          >
            Changes your AI agent proposes land here for you to approve.
          </Empty>
        </Card>
      )}
      <RejectDialog p={rejecting} onClose={() => setRejecting(null)} onReject={(p, note) => void reject(p, note)} />
    </div>
  );
}

/* ----------------------------------------------------------- history tab */

function HistoryRow({ p }: { p: Proposal }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = STATUS[p.status];
  const decidedAt = p.decided_at !== '' ? p.decided_at : p.created;

  const undo = async (): Promise<void> => {
    if (!(await confirmUndo(p))) return;
    setBusy(true);
    try {
      await op('proposals.undo', { proposal: p.id });
      notify.info('Undone');
      changed(...READS);
    } catch {
      /* op showed why */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-[var(--so-line)] first:border-t-0">
      <div className="flex items-center gap-2 px-2 py-1.5 sm:px-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 rounded-[12px] px-2 py-2 text-left hover:bg-[var(--so-row-hover)]">
          {open ? <ChevronDown size={16} className="shrink-0 text-[var(--so-muted)]" aria-hidden /> : <ChevronRight size={16} className="shrink-0 text-[var(--so-muted)]" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{p.title}</span>
            <span className="block truncate text-[12px] text-[var(--so-muted)]" title={dayTime(decidedAt)}>
              {plural(p.items.length, 'change')}, {ago(decidedAt)}
              {p.origin === 'agent' ? ', from your AI agent' : ''}
            </span>
          </span>
          <Pill tone={st.tone} className="shrink-0">
            {st.label}
          </Pill>
        </button>
        {p.items.some((i) => i.undoable) && (
          <Button size="sm" variant="secondary" icon={Undo2} loading={busy} onClick={() => void undo()}>
            Undo
          </Button>
        )}
      </div>
      {open && (
        <div className="px-4 pb-4 sm:pl-12 sm:pr-5">
          {p.why !== '' && <p className="mb-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-[var(--so-muted)]">{p.why}</p>}
          {p.note !== '' && (
            <p className="mb-2 rounded-[12px] bg-[var(--so-tile)] px-3 py-2 text-[13px] leading-5">
              <span className="font-semibold">Your note: </span>
              {p.note}
            </p>
          )}
          <div>
            {p.items.map((it) => (
              <ItemBlock key={it.index} item={it} showState />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryList(): React.JSX.Element {
  const live = useLive<ProposalList>('approvals-history', (signal) => op<ProposalList>('proposals.list', { status: 'decided' }, { signal, quiet: true }), READS, []);
  const rows = live.data?.proposals ?? [];
  if (live.data === null) {
    if (live.error !== null) return <p className="text-[13px] text-[var(--so-red-text)]">{live.error}</p>;
    return <Skeleton className="h-[320px] rounded-[20px]" />;
  }
  if (rows.length === 0) {
    return (
      <Card>
        <Empty
          icon={History}
          title="No decisions yet"
          action={
            <Button variant="secondary" onClick={() => go('approvals', 'pending')}>
              See waiting
            </Button>
          }
        >
          Changes you approve or reject show here, with undo where it applies.
        </Empty>
      </Card>
    );
  }
  return (
    <Card flush className="overflow-hidden py-1">
      {rows.map((p) => (
        <HistoryRow key={p.id} p={p} />
      ))}
    </Card>
  );
}
