/**
 * One inbound deal as a verdict card, in the order a person reads it, each
 * section separated from the next by a full-width hairline divider and
 * starting with its title at the top left (kernel Sections, Fix 4):
 *
 *   1. Who: the logo, the company, its one line, who sent it and when, and
 *      the reply-due chip.
 *   2. Key numbers: only the known ones (Raise, Valuation, ARR or Revenue,
 *      Growth), each with its label.
 *   3. About the deal: the other known facts as a label / value grid; the
 *      source is said once, at the right of the title row ("Source: email";
 *      each row's own source on hover).
 *   4. Fit with your theses: one line per thesis with a plain verdict; the
 *      checks show when the line is opened.
 *   5. Missing: what the deck leaves out, in words. Then Seen before.
 *   6. Deck and email: Open deck, Open email.
 *   7. The verdict bar, sticky at the bottom: Advance (the one primary),
 *      Pass (a reason chip; the drafted email shows after), Hold. Keys A, P, H.
 *
 * `compact` is the Focus mode body (the frame draws the title, chips and the
 * actions); the full card is the Inbox's right side.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, Clock, ExternalLink, FileText, Globe, History, Mail, RotateCcw, Send, Sparkle, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentTag, Bubble, Button, CheckChip, ChipPicker, DayPicker, Field, FigureStrip, Input, LinkButton, LoadError, More, Notice, Section, Sections, Sheet, SheetHeader, Skeleton, StatusDot, StepTrack, Tag, Textarea, Tip } from '../ui.tsx';
import type { Grade, Tone } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { fmtDay, humanize, today } from '../../lib/format.ts';
import { act, drop, patch, useOp } from '../../lib/live.ts';
import { go, href } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { CompanyLogo } from '../portfolio/Logo.tsx';
import { AskAgent, AskStatus } from '../agent.tsx';
import { openDeck } from './DeckPage.tsx';
import { HOLDS, INTAKE_READS } from './types.ts';
import type { Card, Fact, FitOut, MailState, PassOut } from './types.ts';

/** The reply day as the list and the card show it: amber when due, red when late. */
export function dueTone(state: string, left: number | null): Tone {
  if (state === 'overdue') return 'bad';
  if (state === 'due_today' || (left !== null && left <= 1)) return 'warn';
  return 'faint';
}

const FIGURE_TIP: Record<string, string> = {
  raise: 'The round the company is raising.',
  valuation: 'Post-money when stated, else pre-money.',
  arr: 'Annual recurring revenue as the deck states it.',
  revenue: 'Revenue as the deck states it.',
  growth: 'Month-over-month growth as the deck states it.',
};

const GRADE_TEXT: Record<Grade, string> = {
  artifact: 'Backed by a document',
  founder_reported: 'As the founder reports it',
  public: 'From a public source',
  unverifiable: 'Cannot be checked',
  unknown: 'Unknown',
};

/** Facts the key numbers already show (and the currency, which every amount carries). */
const SHOWN_AS_FIGURE = ['raise_minor', 'pre_money_minor', 'post_money_minor', 'arr_minor', 'revenue_minor', 'growth_mom_ppm', 'currency'];

async function undoable(word: string, entry: unknown): Promise<void> {
  if (typeof entry !== 'string' || entry === '') return;
  toast.undo(word, () => void act([], () => op('activity.undo', { entry }), INTAKE_READS));
}

/** Run one verdict with the item shown at once in its new state (and gone from the New list). */
export async function decide(id: string, opName: 'intake.advance' | 'intake.pass' | 'intake.hold', params: Record<string, unknown>, status: string, word: string): Promise<{ _activity?: string; deal?: { number: string; href: string } } | null> {
  const out = await act([drop(id), patch(id, { status })], () => op<{ _activity?: string; deal?: { number: string; href: string } }>(opName, { item: id, ...params }), INTAKE_READS);
  if (out !== null) void undoable(word, out._activity);
  return out;
}

/** A plain-words list: "Financials, Team and Competition". */
function words(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return list.slice(0, -1).join(', ') + ' and ' + (list.at(-1) ?? '');
}

/** Where one fact came from, in words ("From the deck, page 4"). */
function sourceOf(f: Fact): string {
  if (f.source === 'deck') return f.page !== null ? `From the deck, page ${f.page}` : 'From the deck';
  if (f.source === 'email') return 'From the email';
  if (f.source === 'public') return 'From the web';
  return 'Entered by your team';
}

/** The source of a list of facts, said once ("Source: email", "Source: deck and email"), with each source and its facts on hover. */
function sourcesOf(facts: Fact[]): { text: string; detail: string; deck: Fact | null } {
  const name: Record<string, string> = { deck: 'deck', email: 'email', public: 'web', person: 'your team' };
  const kinds = [...new Set(facts.map((f) => f.source))];
  const deck = facts.find((f) => f.source === 'deck' && f.file !== '') ?? null;
  const text = kinds.length === 0 ? '' : 'Source: ' + words(kinds.map((k) => name[k] ?? k));
  const groups = new Map<string, string[]>();
  for (const f of facts) groups.set(sourceOf(f), [...(groups.get(sourceOf(f)) ?? []), f.label]);
  const detail = [...groups.entries()].map(([where, labels]) => `${where}: ${words(labels)}.`).join(' ');
  return { text, detail, deck };
}

/** A hover explanation for a control (a button): the kernel bubble, no underline. */
function HoverTip({ text, children, className }: { text: string; children: React.ReactNode; className?: string | undefined }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span ref={ref} className={cn('inline-flex', className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocusCapture={() => setOpen(true)} onBlurCapture={() => setOpen(false)}>
        {children}
      </span>
      <Bubble anchor={ref} open={open}>
        {text}
      </Bubble>
    </>
  );
}

/** About the deal: the known facts as a clean label / value list; the source once, each row's own on hover. */
export function Facts({ facts }: { facts: Fact[] }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-[minmax(96px,140px)_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px] leading-5" data-data="">
      {facts.map((f) => {
        const how = sourceOf(f) + '. ' + GRADE_TEXT[f.grade] + (f.quote !== '' ? ': "' + f.quote + '"' : '.');
        return (
          <div key={f.key} className="contents">
            <dt title={how} className="text-[var(--vo-muted)]">
              {f.label}
            </dt>
            <dd title={how} className={cn('vo-wrap min-w-0 text-[var(--vo-ink)]', (f.type === 'money' || f.type === 'int' || f.type === 'num') && 'vo-mono vo-num')}>
              {f.text}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const FIT_ORDER: Record<string, number> = { met: 0, unknown: 1, unmet: 2 };

/** "Fits Climate software: 2 of 3 checks met" */
function fitText(t: FitOut): string {
  const total = t.counts.met + t.counts.unmet + t.counts.unknown;
  const verdict = t.state === 'met' ? 'Fits ' : t.state === 'unmet' ? 'Does not fit ' : 'Unclear fit with ';
  return `${verdict}${t.thesis.name}: ${t.counts.met} of ${total} ${total === 1 ? 'check' : 'checks'} met`;
}

function FitRow({ t }: { t: FitOut }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const Icon = t.state === 'met' ? Check : t.state === 'unmet' ? X : CircleHelp;
  const checks = t.checks ?? [];
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        disabled={checks.length === 0}
        onClick={() => setOpen((v) => !v)}
        className="vo-focus -mx-2 flex min-h-8 w-[calc(100%+16px)] min-w-0 items-center gap-2 rounded-[var(--vo-radius-sm)] px-2 text-left text-[13px] transition-colors duration-150 hover:bg-[var(--vo-hover)] disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full', t.state === 'met' ? 'bg-[var(--vo-good-soft)] text-[var(--vo-good)]' : t.state === 'unmet' ? 'bg-[var(--vo-bad-soft)] text-[var(--vo-bad)]' : 'border border-dashed border-[var(--vo-line-2)] text-[var(--vo-muted)]')}>
          <Icon size={12} strokeWidth={2.4} aria-hidden />
        </span>
        <span data-data="" className="vo-wrap min-w-0 flex-1 text-[var(--vo-ink)]">
          {fitText(t)}
        </span>
        {checks.length > 0 && (open ? <ChevronDown size={14} aria-hidden className="shrink-0 text-[var(--vo-muted)]" /> : <ChevronRight size={14} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />)}
      </button>
      {open && (
        <div className="vo-in flex flex-wrap gap-1.5 pb-2 pl-7 pt-1">
          {checks.map((c) => (
            <CheckChip key={c.key + c.op} state={c.status} label={c.label} title={(c.status === 'met' ? 'Met' : c.status === 'unmet' ? 'Not met' : 'Unknown') + (c.required ? ', required' : '') + (c.reason !== null && c.reason !== '' ? ': ' + c.reason : '')} />
          ))}
        </div>
      )}
    </li>
  );
}

/** Fit with your theses: one line per thesis, fits first. */
export function Theses({ fit }: { fit: FitOut[] }): React.JSX.Element {
  const list = [...fit].sort((a, b) => (FIT_ORDER[a.state] ?? 1) - (FIT_ORDER[b.state] ?? 1));
  return (
    <ul className="flex flex-col" data-data="">
      {list.map((t) => (
        <FitRow key={t.thesis.id} t={t} />
      ))}
    </ul>
  );
}

function priorText(p: Card['history']['prior'][number]): string {
  const st = p.kind === 'deal' ? humanize(p.status) + (p.stage !== undefined && p.status === 'open' ? ' ' + humanize(p.stage) : '') : humanize(p.status);
  return [p.label, st, p.reason !== '' ? humanize(p.reason) : '', p.day !== '' ? fmtDay(p.day, { year: 'auto' }) : ''].filter((x) => x !== '').join(', ');
}

/** Who sent it and when: "From Chris Doyle, 6 Nov", "Uploaded 6 Nov". */
function senderLine(c: Card): string {
  const day = fmtDay(c.received_at, { year: 'auto' });
  const k = c.source.kind;
  if (k === 'email' || k === 'person' || k === 'scout') return `From ${c.source.label}${day !== '' ? ', ' + day : ''}`;
  if (k === 'upload') return `Uploaded ${day}`;
  if (k === 'csv') return `Imported ${day}`;
  if (k === 'sourced') return `Sourced ${day}`;
  return `${c.source.label} ${day}`.trim();
}

/** The reply-due status as one chip. */
function DueChip({ c }: { c: Card }): React.JSX.Element | null {
  if (c.status === 'held' && c.hold_until !== '')
    return (
      <Tag tone="faint" icon={Clock} title="Held: it comes back to New on this day">
        Held until {fmtDay(c.hold_until, { year: 'auto' })}
      </Tag>
    );
  if (c.status !== 'new' || c.due.state === 'none' || c.due.day === '') return null;
  const day = fmtDay(c.due.day, { year: 'auto' });
  if (c.due.state === 'overdue')
    return (
      <Tag tone="bad" icon={Clock} title={`The reply was due ${day}`}>
        Reply overdue
      </Tag>
    );
  if (c.due.state === 'due_today')
    return (
      <Tag tone="warn" icon={Clock} title="Reply to the founder today">
        Reply today
      </Tag>
    );
  return (
    <Tag tone={dueTone(c.due.state, c.due.left) === 'warn' ? 'warn' : 'faint'} icon={Clock} title="The day the founder should have an answer">
      Reply by {day}
    </Tag>
  );
}

function MailStateDot({ state }: { state: MailState }): React.JSX.Element {
  if (state === 'waiting') return <StatusDot tone="faint" pulse label="Waiting for your AI agent" />;
  if (state === 'draft') return <StatusDot tone="neutral" label="Draft" />;
  if (state === 'approved') return <StatusDot tone="neutral" pulse label="Sending" />;
  if (state === 'sent') return <StatusDot tone="good" label="Sent" />;
  if (state === 'failed') return <StatusDot tone="bad" label="Not sent" />;
  if (state === 'cancelled') return <StatusDot tone="faint" label="Cancelled" />;
  return <StatusDot tone="faint" label="No email" />;
}

/** The pass and its email: waiting for your AI agent (or write it now), the draft to approve, sent. */
function PassBlock({ card, pass }: { card: Card; pass: PassOut }): React.JSX.Element {
  const o = pass.outbound;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(o?.body ?? '');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!editing) setBody(o?.body ?? '');
  }, [o?.body, editing]);
  const write = async (): Promise<void> => {
    setBusy('write');
    await act([patch(pass.id, { email_state: 'draft' })], () => op('passes.write', { pass: pass.id }), INTAKE_READS);
    setBusy('');
  };
  const send = async (): Promise<void> => {
    if (o === null) return;
    setBusy('send');
    if (editing && body !== o.body) await op('outbound.update', { outbound: o.id, body });
    setEditing(false);
    await act([patch(pass.id, { email_state: 'approved' })], () => op('outbound.approve', { outbound: o.id }), INTAKE_READS);
    setBusy('');
  };
  const state = pass.email_state;
  return (
    <Section title="Passed" aside={<MailStateDot state={state} />}>
      <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="bad">{pass.reason_label}</Tag>
        {pass.criterion !== '' && <span data-data="" className="vo-wrap text-[13px] text-[var(--vo-ink-2)]">{pass.criterion}</span>}
        {pass.revisit_milestone !== '' && <Tag tone="faint" icon={RotateCcw}>{pass.revisit_milestone}</Tag>}
        {pass.revisit_day !== '' && <Tag tone="faint" icon={Clock}>Look again {fmtDay(pass.revisit_day)}</Tag>}
      </div>
      {(state === 'waiting' || (state === 'failed' && o === null)) && card.may_decide && (
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={Mail} busy={busy === 'write'} onClick={() => void write()}>
            Write it myself
          </Button>
        </div>
      )}
      {o !== null && (state === 'draft' || state === 'failed' || state === 'approved' || state === 'sent') && (
        <div className="rounded-[var(--vo-radius)] border border-[var(--vo-line)] bg-[var(--vo-raised)]">
          <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-[var(--vo-hair)] px-4 py-2 text-[13px]">
            {o.actor === 'agent' && <AgentTag />}
            <span data-data="" className="vo-wrap min-w-0 flex-1 font-medium">{o.subject}</span>
            <span className="vo-wrap text-[12px] text-[var(--vo-muted)]">To {o.to.join(', ')}</span>
          </div>
          {editing ? (
            <div className="p-3">
              <Textarea value={body} minRows={6} maxRows={20} onChange={(e) => setBody(e.target.value)} aria-label="Email" autoFocus />
            </div>
          ) : (
            <div data-data="" className="vo-wrap whitespace-pre-wrap px-4 py-3 text-[13px] leading-[20px] text-[var(--vo-ink)]">{o.body}</div>
          )}
          {o.error !== '' && state === 'failed' && <Notice tone="bad" className="mx-3 mb-3">{o.error}</Notice>}
          {(state === 'draft' || state === 'failed') && card.may_decide && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--vo-hair)] px-3 py-2">
              {!editing && (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              <Button icon={Send} busy={busy === 'send'} onClick={() => void send()}>
                {state === 'failed' ? 'Send again' : 'Approve and send'}
              </Button>
            </div>
          )}
        </div>
      )}
      </div>
    </Section>
  );
}

type Choosing = 'pass' | 'hold' | 'company' | null;

/** The verdict bar: Advance (the one primary), Pass (reason chips), Hold (how long); keys A, P, H. */
function Verdict({ card, onDone }: { card: Card; onDone?: ((what: string) => void) | undefined }): React.JSX.Element {
  const [choosing, setChoosing] = useState<Choosing>(null);
  const [busy, setBusy] = useState('');
  const [criterion, setCriterion] = useState('');
  const [milestone, setMilestone] = useState('');
  const [revisit, setRevisit] = useState('');
  const [company, setCompany] = useState('');
  const reasons = useOp<{ pass_reasons: { value: string; label: string; on: boolean }[] }>('intake.settings', {}, ['settings'], { name: 'intake.settings' });
  const chips = (reasons.data?.pass_reasons ?? []).filter((r) => r.on).map((r) => ({ value: r.value, label: r.label }));

  const advance = async (): Promise<void> => {
    if (card.company === null && company.trim() === '') {
      setChoosing('company');
      return;
    }
    setBusy('advance');
    const out = await decide(card.id, 'intake.advance', card.company === null ? { company: company.trim() } : {}, 'advanced', 'Advanced');
    setBusy('');
    if (out !== null) {
      setChoosing(null);
      onDone?.('advanced');
    }
  };
  const pass = async (reason: string): Promise<void> => {
    setBusy('pass');
    const p: Record<string, unknown> = { reason };
    if (criterion.trim() !== '') p['criterion'] = criterion.trim();
    if (milestone.trim() !== '') p['revisit_milestone'] = milestone.trim();
    if (revisit !== '') p['revisit_day'] = revisit;
    const out = await decide(card.id, 'intake.pass', p, 'passed', 'Passed');
    setBusy('');
    setChoosing(null);
    if (out !== null) onDone?.('passed');
  };
  const hold = async (days: string): Promise<void> => {
    setBusy('hold');
    const out = await decide(card.id, 'intake.hold', { days: Number(days) }, 'held', 'Held');
    setBusy('');
    setChoosing(null);
    if (out !== null) onDone?.('held');
  };

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const tg = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || tg.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') !== null) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' && choosing !== null) {
        setChoosing(null);
        return;
      }
      if (busy !== '' || choosing !== null) return;
      if (k === 'a') {
        e.preventDefault();
        void advance();
      } else if (k === 'p') {
        e.preventDefault();
        setChoosing('pass');
      } else if (k === 'h') {
        e.preventDefault();
        setChoosing('hold');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div className="flex flex-col gap-3">
      {choosing === 'pass' && (
        <div className="vo-in flex flex-col gap-3">
          <ChipPicker label="Why pass?" options={chips} value="" onChange={(v) => void pass(v)} keys />
          <More label="Add a note or a day to look again">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="What was missing">
                <Input value={criterion} onChange={(e) => setCriterion(e.target.value)} aria-label="What was missing" placeholder="Revenue under 10K" />
              </Field>
              <Field label="Look again at">
                <Input value={milestone} onChange={(e) => setMilestone(e.target.value)} aria-label="Look again at a milestone" placeholder="USD 1M ARR" />
              </Field>
              <Field label="Look again on">
                <DayPicker value={revisit} onChange={setRevisit} label="Look again on" min={today()} clearable />
              </Field>
            </div>
          </More>
        </div>
      )}
      {choosing === 'company' && (
        <form
          className="vo-in flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (company.trim() !== '') void advance();
          }}
        >
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company or website" aria-label="Company" autoFocus className="w-64" />
          <Button type="submit" icon={ArrowRight} busy={busy === 'advance'} disabled={company.trim() === ''}>
            Advance
          </Button>
        </form>
      )}
      {choosing === 'hold' && <ChipPicker label="Hold for" options={HOLDS} value="" onChange={(v) => void hold(v)} keys className="vo-in" />}
      <div className="flex flex-wrap items-center gap-2">
        <HoverTip text="Pass on it: pick a reason; your AI agent drafts the email to the founder for you to approve. Key P.">
          <Button kbd="P" busy={busy === 'pass'} onClick={() => setChoosing(choosing === 'pass' ? null : 'pass')} aria-expanded={choosing === 'pass'}>
            Pass
          </Button>
        </HoverTip>
        <HoverTip text="Decide later: it leaves New and comes back after a week, a month or three months. Key H.">
          <Button kbd="H" busy={busy === 'hold'} onClick={() => setChoosing(choosing === 'hold' ? null : 'hold')} aria-expanded={choosing === 'hold'}>
            Hold
          </Button>
        </HoverTip>
        <span className="flex-1" />
        <HoverTip text="Take it forward: it opens as a deal at the first stage of Deal flow. Key A.">
          <Button variant="primary" icon={ArrowRight} kbd="A" busy={busy === 'advance'} onClick={() => void advance()}>
            Advance
          </Button>
        </HoverTip>
      </div>
    </div>
  );
}

/** Focus mode: name the company of an item that has none, so Advance can open the deal. */
function NameCompany({ card }: { card: Card }): React.JSX.Element {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    await act([], () => op('intake.update', { item: card.id, company: name.trim() }), INTAKE_READS);
    setBusy(false);
  };
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() !== '') void save();
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company or website" aria-label="Company" className="w-64" />
      <Button type="submit" busy={busy} disabled={name.trim() === ''}>
        Save
      </Button>
    </form>
  );
}

/** What a decided item shows instead of the verdict bar. */
function Outcome({ card }: { card: Card }): React.JSX.Element | null {
  const [busy, setBusy] = useState('');
  const run = async (name: 'intake.reopen' | 'intake.keep'): Promise<void> => {
    setBusy(name);
    await act([patch(card.id, name === 'intake.reopen' ? { status: 'new' } : { revisit_day: '' })], () => op(name, { item: card.id }), INTAKE_READS);
    setBusy('');
  };
  if (card.status === 'advanced' && card.deal !== null)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <StatusDot tone="good" label="Advanced to Deal flow" />
        <Button icon={ArrowRight} onClick={() => go('#/deals/' + (card.deal?.number ?? ''))}>
          Open deal {card.deal.number}
        </Button>
      </div>
    );
  if (card.status === 'merged' && card.merged_into !== null)
    return (
      <div className="flex items-center gap-3">
        <StatusDot tone="faint" label="Merged into" />
        <LinkButton onClick={() => go(href('/inbox', { item: card.merged_into?.number }))}>{card.merged_into.number}</LinkButton>
      </div>
    );
  if (card.status === 'passed' && card.revisit_day !== '' && card.revisit_day <= today() && card.may_decide)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={RotateCcw} busy={busy === 'intake.reopen'} onClick={() => void run('intake.reopen')}>
          Re-open
        </Button>
        <Button variant="ghost" busy={busy === 'intake.keep'} onClick={() => void run('intake.keep')}>
          Keep passed
        </Button>
      </div>
    );
  return null;
}

/** The founder's email, read in a side sheet. */
function EmailSheet({ card, onClose }: { card: Card; onClose: () => void }): React.JSX.Element {
  return (
    <Sheet open onClose={onClose} width={620} label="Email">
      <SheetHeader title={card.email_subject !== '' ? card.email_subject : 'Email'} onClose={onClose} />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
        <div className="text-[12px] text-[var(--vo-muted)]">{senderLine(card) + (card.email_from !== '' ? ' (' + card.email_from + ')' : '')}</div>
        <div data-data="" className="vo-wrap whitespace-pre-wrap text-[14px] leading-[22px] text-[var(--vo-ink)]">{card.text}</div>
      </div>
    </Sheet>
  );
}

/** What the Open section offers, in words: "Deck and email", "Deck", "Email", "Link". */
function opensTitle(deck: boolean, email: boolean, link: boolean): string {
  const parts = [deck ? 'deck' : '', email ? 'email' : '', link ? 'link' : ''].filter((x) => x !== '');
  const t = words(parts);
  return t === '' ? 'Open' : t.charAt(0).toUpperCase() + t.slice(1);
}

export function ItemCard({ id, compact, onDone }: { id: string; compact?: boolean | undefined; onDone?: ((what: string) => void) | undefined }): React.JSX.Element {
  const live = useOp<Card>('intake.get', { item: id }, INTAKE_READS, { name: 'intake.get' });
  const [mail, setMail] = useState(false);
  const c = live.data;
  if (c === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-72 w-full" />;
  const full = compact !== true;
  const reading = (c.status === 'new' || c.status === 'held') && c.steps.at < 3;
  const figures = c.figures.filter((f) => f.text !== 'Unknown');
  const facts = c.facts.filter((f) => f.text !== 'Unknown' && f.grade !== 'unknown' && !SHOWN_AS_FIGURE.includes(f.key));
  const src = sourcesOf(facts);
  const decks = c.files_list;
  const deciding = full && c.may_decide && (c.status === 'new' || c.status === 'held');
  const trigger = c.read_trigger === 'deck_fetch' ? 'deck_fetch' : 'deck_triage';
  const askState = c.agent?.[trigger] ?? null;
  const askRead = (again: string): Promise<unknown> => op('intake.retriage', { item: c.id, ...(again !== '' ? { again } : {}) });
  const email = full && c.text !== '';
  const link = c.url !== '' || c.website !== '';
  const opens = decks.length > 0 || email || link;
  const passed = full && c.pass !== null && c.status === 'passed';
  const outcome = full && ((c.status === 'advanced' && c.deal !== null) || (c.status === 'merged' && c.merged_into !== null) || (c.status === 'passed' && c.revisit_day !== '' && c.revisit_day <= today() && c.may_decide));
  const note = !reading && c.triage_note !== '' && c.facts.length === 0;
  return (
    <article className={full ? 'vo-panel vo-in flex min-w-0 flex-col' : 'flex min-w-0 flex-col'} aria-label={c.name} data-vo-card="">
      <Sections pad={full ? 'card' : 'flush'}>
        {full ? (
          <header className="flex min-w-0 items-start gap-3.5" data-vo-part="who">
            <CompanyLogo name={c.name} domain={c.logo_domain ?? ''} logoUrl={c.company?.logo_url ?? ''} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h2 data-data="" className="vo-wrap min-w-0 text-[15px] font-semibold leading-6">
                  {c.name}
                </h2>
                {c.licence === 'internal_only' && (
                  <Tag tone="warn" title="From a licensed source: never in LP outputs">
                    Internal
                  </Tag>
                )}
              </div>
              {c.one_liner !== '' && (
                <p className="vo-wrap mt-0.5 flex items-start gap-1.5 text-[14px] leading-[22px] text-[var(--vo-ink-2)]">
                  <span data-data="" className="min-w-0">
                    {c.one_liner}
                  </span>
                  {c.agent_facts && <AgentTag className="mt-[3px]" />}
                </p>
              )}
              <p data-data="" className="vo-wrap mt-1 text-[12px] text-[var(--vo-muted)]">
                {senderLine(c)}
              </p>
              <span className="mt-2 flex empty:hidden sm:hidden">
                <DueChip c={c} />
              </span>
            </div>
            <span className="hidden shrink-0 pt-0.5 sm:block">
              <DueChip c={c} />
            </span>
          </header>
        ) : (
          c.one_liner !== '' && (
            <p className="vo-wrap flex items-start gap-2 text-[14px] leading-[22px] text-[var(--vo-ink)]">
              <span data-data="" className="min-w-0">
                {c.one_liner}
              </span>
              {c.agent_facts && <AgentTag className="mt-[3px]" />}
            </p>
          )
        )}

        {reading && (
          <div className="flex flex-col gap-3" data-vo-part="reading">
            <StepTrack labels={c.steps.labels} at={c.steps.at} className="max-w-[420px]" />
            {c.triage_state === 'failed' ? (
              <Notice tone="warn" action={c.may_decide ? <AskAgent label="Ask again" state={null} onAsk={askRead} reads={INTAKE_READS} /> : undefined}>
                {c.triage_note !== '' ? c.triage_note : 'Your AI agent could not read it.'}
              </Notice>
            ) : askState ? (
              c.may_decide ? <AskAgent label="Ask your AI agent" state={askState} onAsk={askRead} reads={INTAKE_READS} /> : <AskStatus state={askState} />
            ) : c.triage_state === 'none' && c.may_decide && (decks.length > 0 || c.url !== '' || c.text !== '') ? (
              <Notice action={<AskAgent label="Ask your AI agent" state={null} onAsk={askRead} reads={INTAKE_READS} />}>Not read yet. Your AI agent reads it into facts when you ask.</Notice>
            ) : null}
          </div>
        )}
        {note && (
          <div data-vo-part="note">
            <Notice tone="agent">
              <span className="inline-flex items-start gap-2">
                <Sparkle size={13} className="mt-[3px] shrink-0" aria-hidden />
                {c.triage_note}
              </span>
            </Notice>
          </div>
        )}

        {figures.length > 0 && (
          <Section title="Key numbers" tip="The figures the deck or the email states.">
            <FigureStrip
              items={figures.map((f) => ({
                label: f.label,
                tip: (FIGURE_TIP[f.key] ?? '') + ' ' + GRADE_TEXT[f.grade] + '.',
                value: f.key === 'growth' ? f.text.replace(' MoM', ' a month') : f.text,
              }))}
            />
          </Section>
        )}

        {facts.length > 0 && (
          <Section
            title="About the deal"
            aside={
              src.text !== '' &&
              (src.deck !== null ? (
                <button type="button" title={src.detail} onClick={() => src.deck !== null && openDeck({ file: src.deck.file, name: src.deck.file_name, page: src.deck.page ?? 1, anchor: src.deck.anchor !== '' ? src.deck.anchor : undefined })} className="vo-focus -mr-1 rounded-[4px] px-1 text-[12px] text-[var(--vo-muted)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
                  {src.text}
                </button>
              ) : (
                <Tip text={src.detail} className="text-[12px] text-[var(--vo-muted)]">
                  {src.text}
                </Tip>
              ))
            }
          >
            <Facts facts={facts} />
          </Section>
        )}

        {c.fit.length > 0 && (
          <Section title="Fit with your theses">
            <Theses fit={c.fit} />
          </Section>
        )}

        {c.missing.length > 0 && (
          <Section title="Missing">
            <p data-data="" className="vo-wrap text-[13px] text-[var(--vo-ink)]">
              {words(c.missing.map((m) => m.label))}
            </p>
          </Section>
        )}

        {c.history.prior.length > 0 && (
          <Section title="Seen before">
            <ul className="flex flex-col gap-1">
              {c.history.prior.slice(0, 4).map((p) => (
                <li key={p.kind + p.id} className="flex min-w-0 items-center gap-2 text-[13px]">
                  <History size={13} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
                  <a href={p.href} className="vo-focus vo-wrap rounded-[4px] text-[var(--vo-ink-2)] underline-offset-2 transition-colors duration-150 hover:text-[var(--vo-ink)] hover:underline">
                    {priorText(p)}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {opens && (
          <Section title={opensTitle(decks.length > 0, email, link)}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {decks.map((f, i) => (
                <Button key={f.id} icon={FileText} onClick={() => openDeck({ file: f.id, name: f.name, page: 1 })} title={f.name + (f.pages > 0 ? `, ${f.pages} pages` : '')}>
                  {i === 0 ? 'Open deck' : 'Open ' + f.name}
                </Button>
              ))}
              {email && (
                <Button icon={Mail} onClick={() => setMail(true)}>
                  Open email
                </Button>
              )}
              {c.url !== '' && (
                <a href={c.url} target="_blank" rel="noreferrer" className="vo-focus vo-tap inline-flex h-8 items-center gap-1.5 rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)] px-3 text-[13px] font-medium text-[var(--vo-ink)] transition-colors duration-150 hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)]">
                  <ExternalLink size={14} aria-hidden />
                  {c.link_kind !== '' ? 'Open ' + humanize(c.link_kind).toLowerCase() : 'Open link'}
                </a>
              )}
              {c.website !== '' && c.website !== c.url && (
                <a href={/^https?:\/\//.test(c.website) ? c.website : 'https://' + c.website} target="_blank" rel="noreferrer" className="vo-focus vo-tap inline-flex h-8 items-center gap-1.5 rounded-[var(--vo-radius-sm)] px-2 text-[13px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
                  <Globe size={14} aria-hidden />
                  Website
                </a>
              )}
            </div>
          </Section>
        )}

        {!full && c.company === null && c.may_decide && c.status === 'new' && (
          <Section title="Company">
            <NameCompany card={c} />
          </Section>
        )}
        {passed && c.pass !== null && <PassBlock card={c} pass={c.pass} />}
        {outcome && (
          <div data-vo-part="outcome">
            <Outcome card={c} />
          </div>
        )}
      </Sections>
      {deciding && (
        <div className="sticky bottom-14 z-[2] mt-auto rounded-b-[var(--vo-radius)] border-t border-[var(--vo-line)] bg-[var(--vo-panel)] px-5 py-3 md:bottom-0 md:px-6">
          <Verdict card={c} onDone={onDone} />
        </div>
      )}
      {mail && <EmailSheet card={c} onClose={() => setMail(false)} />}
    </article>
  );
}
