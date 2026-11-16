/**
 * The deal page's Diligence tab. The answers waiting for a person come
 * first, one row each (the question above its answer, grade and source,
 * Reject and Confirm) with Confirm all and a High grade filter chip. Then
 * the checklist folded by area: each area row shows its ring (confirmed of
 * total), its counts and how many answers wait; a click unfolds its
 * questions. Nothing answered yet: one empty state with Ask your AI agent.
 * Then the references.
 *
 * A partner never types answers: your AI agent proposes them with the
 * exact quote; one click confirms one, one click confirms all. A citation
 * opens the reader at the page with the quote highlighted.
 */
import { useState } from 'react';
import { CheckCheck, ChevronDown, ChevronRight, FileText, FolderOpen, ListChecks, Pencil, ScanText, SearchX, Sparkle } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { Ring } from '../charts.tsx';
import { AgentTag, Button, ChipPicker, DayPicker, Empty, GradeDot, IconButton, Input, LoadError, Menu, MenuItem, Segmented, Skeleton, StepTrack, Tag, Tip } from '../ui.tsx';
import { References } from './References.tsx';
import { ReaderSheet } from './Reader.tsx';
import { AnswerText, CheckRow, CiteChips, DecideButtons, decide, readTarget, shown } from './parts.tsx';
import type { CheckItem } from './parts.tsx';
import type { Answer, Area, Cite, DdView, JobStep, Question, ReadTarget, Room } from './types.ts';
import { DD_READS } from './types.ts';
import { AgentSteps, AskAgent, stateOfTrack } from '../agent.tsx';

type Open = (c: Cite, a: Answer | null, q?: string) => void;

/** The answer waiting for a person on a question: a proposal beside a confirmed answer, or the proposed answer shown. */
function pendingOf(q: Question): Answer | null {
  if (q.proposal !== null && q.proposal.status === 'agent_proposed') return q.proposal;
  if (q.answer !== null && q.answer.status === 'agent_proposed') return q.answer;
  return null;
}

export function DiligenceTab({ dealId }: { dealId: string }): React.JSX.Element {
  const me = useMe();
  const edit = can(me, 'diligence', 'edit');
  const live = useOp<DdView>('dd.get', { deal: dealId }, DD_READS, { name: 'dd.get' });
  const [reading, setReading] = useState<ReadTarget | null>(null);
  const [byHand, setByHand] = useState(false);
  const v = live.data;
  if (v === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />;
  if (v.questions.length === 0) return <NoChecklist v={v} edit={edit} />;
  const open: Open = (c, a, q) => setReading(readTarget(c, a, q));
  const answered = v.counts.proposed + v.counts.confirmed > 0;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {!answered && !byHand ? (
        <NoAnswers v={v} edit={edit} onByHand={() => setByHand(true)} />
      ) : (
        <>
          <Strip v={v} edit={edit} />
          {edit && <ToCheck v={v} onOpen={open} />}
          <AreaList v={v} edit={edit} onOpen={open} currency={me.firm.base_currency} />
        </>
      )}
      <References dealId={v.deal.id} edit={edit} />
      <ReaderSheet target={reading} onClose={() => setReading(null)} />
    </div>
  );
}

/** No checklist yet: one button applies the checklist for the round; the menu holds the others. */
function NoChecklist({ v, edit }: { v: DdView; edit: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const pick = v.templates.find((t) => t.key === v.suggested_template) ?? v.templates[0];
  const apply = async (key: string): Promise<void> => {
    setBusy(true);
    await act([], () => op('dd.template-apply', { deal: v.deal.id, template: key }), DD_READS);
    setBusy(false);
  };
  return (
    <div className="vo-panel vo-in">
      <Empty
        icon={ListChecks}
        title="No checklist"
        action={
          edit && pick !== undefined ? (
            <span className="inline-flex items-center">
              <Button busy={busy} onClick={() => void apply(pick.key)} className="rounded-r-none">{`Apply ${pick.name}`}</Button>
              {v.templates.length > 1 && (
                <span className="-ml-px flex h-8 items-center rounded-r-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)]">
                <Menu label="Other checklists" icon={ChevronDown} width={200}>
                  {(close) =>
                    v.templates
                      .filter((t) => t.key !== pick.key)
                      .map((t) => (
                        <MenuItem key={t.key} onClick={() => (close(), void apply(t.key))}>
                          {t.name}
                        </MenuItem>
                      ))
                  }
                </Menu>
                </span>
              )}
            </span>
          ) : undefined
        }
      />
    </div>
  );
}

/** Ask your AI agent to answer the open questions (trigger diligence_answers; off for a restricted deal it may not work on). */
function AskButton({ v }: { v: DdView }): React.JSX.Element {
  const off = v.deal.restricted === true && v.deal.agent_allowed !== true;
  return (
    <AskAgent
      label="Ask your AI agent"
      size="md"
      state={stateOfTrack(v.ask)}
      onAsk={(again) => op('dd.ask', { deal: v.deal.id, ...(again !== '' ? { again } : {}) })}
      reads={DD_READS}
      disabled={off}
      title={off ? 'Your AI agent is off for this restricted deal' : 'Answers the open questions from the room and public sources'}
    />
  );
}

/** Nothing answered yet: one empty state (your AI agent at work, or Ask your AI agent). */
function NoAnswers({ v, edit, onByHand }: { v: DdView; edit: boolean; onByHand: () => void }): React.JSX.Element {
  const job = v.ask;
  if (job !== null && job.open)
    return (
      <div className="vo-panel vo-in">
        <Empty icon={Sparkle} title="Waiting for your AI agent" action={<AgentSteps track={job} className="w-[260px] max-w-full" />} />
      </div>
    );
  return (
    <div className="vo-panel vo-in">
      <Empty
        icon={ListChecks}
        title="No answers yet"
        action={
          edit ? (
            <>
              <AskButton v={v} />
              <IconButton icon={Pencil} label="Answer by hand" size={32} onClick={onByHand} />
            </>
          ) : undefined
        }
      />
    </div>
  );
}

/** The room in figures, your AI agent's progress and Ask your AI agent. */
function Strip({ v, edit }: { v: DdView; edit: boolean }): React.JSX.Element {
  const job = v.ask;
  return (
    <div className="vo-in flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
      <RoomFigures room={v.room} dealNumber={v.deal.number} />
      <span className="hidden flex-1 md:block" />
      {job !== null && job.open && <AgentSteps track={job} className="w-[260px] max-w-full" />}
      {edit && v.counts.open > 0 && (
        <div className="ml-auto flex items-center">
          <AskButton v={v} />
        </div>
      )}
    </div>
  );
}

function RoomFigures({ room, dealNumber }: { room: Room; dealNumber: string }): React.JSX.Element {
  return (
    <a href={`#/deals/${dealNumber}?tab=files`} className="vo-focus vo-tap group -mx-2 flex min-w-0 items-center gap-4 rounded-[var(--vo-radius-sm)] px-2 py-1 transition-colors duration-150 hover:bg-[var(--vo-hover)]" aria-label="Open the room">
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--vo-muted)]">
        <FolderOpen size={14} strokeWidth={1.8} aria-hidden />
        <span>Room</span>
        <span className="vo-mono vo-num text-[13px] text-[var(--vo-ink)]">{room.files}</span>
      </span>
      <Tip text="Pages read">
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--vo-muted)]">
          <FileText size={14} strokeWidth={1.8} aria-hidden />
          <span className="vo-mono vo-num text-[13px] text-[var(--vo-ink)]">{`${room.pages_read}/${room.pages}`}</span>
        </span>
      </Tip>
      {room.pages_ocr > 0 && (
        <Tip text="Pages waiting for OCR">
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--vo-warn)]">
            <ScanText size={14} strokeWidth={1.8} aria-hidden />
            <span className="vo-mono vo-num text-[13px]">{room.pages_ocr}</span>
          </span>
        </Tip>
      )}
    </a>
  );
}

/** The answers waiting for a person, first: Confirm all (the High grade chip narrows it) and one row each. */
function ToCheck({ v, onOpen }: { v: DdView; onOpen: Open }): React.JSX.Element | null {
  const [highOnly, setHighOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows: { item: CheckItem; a: Answer; high: boolean }[] = [];
  for (const q of v.questions) {
    const a = pendingOf(q);
    if (a === null) continue;
    rows.push({ a, high: a.high, item: { id: a.id, question: q.text, type: q.type, value: a.value, raw: a.raw, unit: a.unit, formula: a.formula, grade: a.grade, cites: a.cites, sources: a.sources, struck: q.proposal !== null && q.answer !== null && q.answer.status === 'confirmed' ? shown(q.answer) : undefined } });
  }
  if (rows.length === 0) return null;
  const high = rows.filter((r) => r.high).length;
  const mixed = high > 0 && high < rows.length;
  const shownRows = mixed && highOnly ? rows.filter((r) => r.high) : rows;
  const confirmAll = async (): Promise<void> => {
    setBusy(true);
    await decide(
      shownRows.map((r) => r.a.id),
      true,
    );
    setBusy(false);
  };
  return (
    <section aria-label="To check" className="vo-panel vo-in min-w-0">
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b border-[var(--vo-hair)] px-4 py-2">
        <span className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
          <AgentTag />
          <span className="vo-label">To check</span>
          <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{shownRows.length}</span>
        </span>
        <span className="flex items-center gap-2">
          {mixed && <ChipPicker multiple label="Filter" options={[{ value: 'high', label: 'High grade' }]} value={highOnly ? ['high'] : []} onChange={(x) => setHighOnly(x.includes('high'))} />}
          <Button icon={CheckCheck} busy={busy} onClick={() => void confirmAll()}>
            Confirm all
          </Button>
        </span>
      </header>
      <ul className="min-w-0 divide-y divide-[var(--vo-hair)]">
        {shownRows.map((r) => (
          <CheckRow key={r.a.id} item={r.item} busy={busy} onDecide={(c) => void decide(r.a.id, c)} onOpen={(c) => onOpen(c, r.a, r.item.question)} />
        ))}
      </ul>
    </section>
  );
}

/** The checklist folded by area: ring, counts and the answers waiting; a click unfolds the questions. */
function AreaList({ v, edit, onOpen, currency }: { v: DdView; edit: boolean; onOpen: Open; currency: string }): React.JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="vo-panel vo-in min-w-0 divide-y divide-[var(--vo-hair)] overflow-hidden">
      {v.areas.map((area) => {
        const qs = v.questions.filter((q) => q.area === area.key);
        const waiting = qs.filter((q) => pendingOf(q) !== null).length;
        const isOpen = open[area.key] === true;
        // Proposed answers first, then the confirmed ones, then the open questions.
        const rank = (q: Question): number => (pendingOf(q) !== null ? 0 : q.state === 'confirmed' ? 1 : 2);
        const ordered = qs.map((q, i) => ({ q, i })).sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i).map((x) => x.q);
        return (
          <section key={area.key} aria-label={area.label} className="min-w-0">
            <AreaRow area={area} waiting={waiting} open={isOpen} onToggle={() => setOpen((o) => ({ ...o, [area.key]: !isOpen }))} />
            {isOpen && (
              <ul className="min-w-0 border-t border-[var(--vo-hair)] bg-[var(--vo-raised)] py-1">
                {ordered.map((q) => (
                  <QuestionRow key={q.id} q={q} edit={edit} onOpen={onOpen} currency={currency} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function AreaRow({ area, waiting, open, onToggle }: { area: Area; waiting: number; open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="vo-focus flex h-12 w-full min-w-0 items-center gap-3 px-4 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]">
      <span className="pointer-events-none flex shrink-0">
        <Ring value={area.confirmed} max={Math.max(1, area.total)} size={30} thickness={4} tone="a" label={`${area.label}: ${area.confirmed} of ${area.total} confirmed`} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--vo-ink)]">{area.label}</span>
      {waiting > 0 && (
        <span title={`${waiting} to check`} className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[4px] border border-[var(--vo-line)] px-1.5 text-[var(--vo-ink)]">
          <Sparkle size={11} strokeWidth={2} aria-hidden />
          <span className="vo-mono vo-num text-[12px]">{waiting}</span>
        </span>
      )}
      <span title={`${area.confirmed} confirmed of ${area.total}`} className="vo-mono vo-num w-12 shrink-0 text-right text-[12px] text-[var(--vo-muted)]">{`${area.confirmed}/${area.total}`}</span>
      <ChevronRight size={14} strokeWidth={1.8} aria-hidden className={cn('shrink-0 text-[var(--vo-muted)] transition-transform duration-150', open && 'rotate-90')} />
    </button>
  );
}

/** One question: its text, the answer shown (or what is waiting), Confirm and Reject on the row. */
function QuestionRow({ q, edit, onOpen, currency }: { q: Question; edit: boolean; onOpen: Open; currency: string }): React.JSX.Element {
  const [typing, setTyping] = useState(false);
  const pending = pendingOf(q);
  const cur = q.proposal ?? q.answer;
  const first = cur?.cites.find((c) => !c.hidden);
  return (
    <li className={cn('group flex min-h-9 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1 transition-colors duration-150 hover:bg-[var(--vo-hover)] sm:flex-nowrap', first !== undefined && !typing && 'cursor-pointer')} onClick={(e) => first !== undefined && !typing && (e.target as HTMLElement).closest('button,a,input') === null && onOpen(first, pending ?? cur ?? null, q.text)}>
      <span className="vo-wrap min-w-0 grow basis-[180px] text-[13px] leading-5 text-[var(--vo-ink)] sm:basis-auto sm:flex-1">{q.text}</span>
      {typing ? (
        <ByHand q={q} currency={currency} onDone={() => setTyping(false)} />
      ) : cur !== null ? (
        <span className="ml-auto flex min-w-0 max-w-full items-center justify-end gap-2 sm:max-w-[52%]">
          {q.proposal !== null && q.answer !== null && <span data-data className="vo-wrap hidden min-w-0 text-[12px] text-[var(--vo-muted)] line-through decoration-[var(--vo-line-2)] sm:inline">{shown(q.answer)}</span>}
          <AnswerText a={{ ...cur, type: q.type }} className="text-right text-[13px] text-[var(--vo-ink)]" />
          <GradeDot grade={cur.grade} />
          {cur.status === 'agent_proposed' && <AgentTag />}
          <CiteChips cites={cur.cites} sources={cur.sources} onOpen={(c) => onOpen(c, pending ?? cur, q.text)} />
        </span>
      ) : q.checked_at !== '' ? (
        <Tip text={q.check_note !== '' ? q.check_note : 'Not found in the room'}>
          <span className="ml-auto flex items-center gap-1 text-[12px] text-[var(--vo-muted)]">
            <SearchX size={13} strokeWidth={1.8} aria-hidden />
            Not found
          </span>
        </Tip>
      ) : (
        <span aria-label="Open" title="Open" className="ml-auto size-2 shrink-0 rounded-full border-[1.5px] border-dashed border-[var(--vo-line-2)]" />
      )}
      {edit && !typing && pending !== null && <DecideButtons id={pending.id} />}
      {edit && !typing && pending === null && (
        <span className="flex shrink-0 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <IconButton icon={Pencil} label="Answer by hand" size={28} onRow onClick={() => setTyping(true)} />
        </span>
      )}
    </li>
  );
}

/** A person answers one question by hand (it is confirmed at once). */
function ByHand({ q, currency, onDone }: { q: Question; currency: string; onDone: () => void }): React.JSX.Element {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(q.unit === 'money' ? currency : q.unit === '%' ? '%' : q.unit);
  const [busy, setBusy] = useState(false);
  const save = async (val: string): Promise<void> => {
    if (val.trim() === '') return;
    setBusy(true);
    const item: Record<string, string> = { question: q.id, value: val.trim() };
    if (q.type === 'number' && unit !== '') item['unit'] = unit;
    const out = await act([patch(q.id, { state: 'confirmed' })], () => op('dd.answer', { answers: [item] }), DD_READS);
    setBusy(false);
    if (out !== null) onDone();
  };
  const keys = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') void save(value);
    if (e.key === 'Escape') onDone();
  };
  if (q.type === 'yes_no')
    return (
      <span className="ml-auto flex items-center gap-1">
        <Segmented size="sm" label={q.text} value={'' as 'yes' | 'no'} onChange={(x) => void save(x)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </span>
    );
  if (q.type === 'date')
    return (
      <span className="ml-auto flex items-center gap-1">
        <DayPicker label={q.text} value={value} onChange={(d) => (setValue(d), void save(d))} />
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </span>
    );
  return (
    <span className="ml-auto flex min-w-0 items-center gap-1.5">
      <Input autoFocus aria-label={q.text} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={keys} disabled={busy} className={cn('h-7', q.type === 'number' ? 'vo-mono w-32 text-right' : 'w-56 max-w-[60vw]')} />
      {q.type === 'number' && q.unit === 'money' && <Input aria-label="Currency" value={unit} maxLength={3} onChange={(e) => setUnit(e.target.value.toUpperCase())} onKeyDown={keys} className="vo-mono h-7 w-14 text-center" />}
      {q.type === 'number' && q.unit !== 'money' && unit !== '' && <span className="text-[12px] text-[var(--vo-muted)]">{unit}</span>}
      <Button size="sm" busy={busy} onClick={() => void save(value)}>
        Save
      </Button>
    </span>
  );
}

export type { JobStep };
