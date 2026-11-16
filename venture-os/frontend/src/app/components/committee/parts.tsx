/**
 * Committee parts: vote dots, the cooling-off countdown, cited text, the
 * revealed tally with rationales, the bear case, the vote dialog.
 */
import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, CircleSlash, Sparkle, Timer, TriangleAlert } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Tally } from '../charts.tsx';
import { AgentTag, Avatar, Button, ChipPicker, Citation, Dialog, Input, StepTrack, Tag, Tip, Toggle } from '../ui.tsx';
import { download, op } from '../../lib/api.ts';
import { act } from '../../lib/live.ts';
import { choiceLabel, leanTone, type BearPoint, type Cite, type Item, type JobBrief, type TallyData, type VoteMember } from './types.ts';
import { AgentSteps, AskAgent, AskStatus, stateOfTrack } from '../agent.tsx';

/** The collections a committee view reads (every committee op reloads on them). */
export const READS = ['ic_meetings', 'agenda_items', 'votes', 'decisions', 'conditions', 'memos', 'memo_blocks', 'agent_requests', 'deals'];

/* ------------------------------------------------------------- vote dots */

const DOT_LEAN: Record<string, string> = {
  for: 'border-[var(--vo-good)] bg-[var(--vo-good)]',
  against: 'border-[var(--vo-bad)] bg-[var(--vo-bad)]',
  neutral: 'border-[var(--vo-muted)] bg-[var(--vo-muted)]',
};

/** One dot per member who votes: hollow waiting, grey voted (sealed), coloured after the reveal. */
export function VoteDots({ members, size = 10, className }: { members: VoteMember[]; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)} role="img" aria-label={`${members.filter((m) => m.voted).length} of ${members.length} voted`}>
      {members.map((m) => {
        const revealed = m.choice !== undefined && m.choice !== null;
        const title = revealed ? `${m.name}: ${choiceLabel(m.choice ?? '')}${m.veto === true ? ', veto' : ''}` : `${m.name}: ${m.voted ? 'voted' : 'waiting'}`;
        return (
          <span
            key={m.id}
            title={title}
            className={cn('shrink-0 rounded-full border-[1.5px]', revealed ? DOT_LEAN[m.lean ?? 'neutral'] : m.voted ? 'border-[var(--vo-ink-2)] bg-[var(--vo-ink-2)]' : 'border-[var(--vo-line-2)] bg-transparent', m.veto === true && 'ring-2 ring-[var(--vo-bad)] ring-offset-1 ring-offset-[var(--vo-raised)]')}
            style={{ width: size, height: size }}
          />
        );
      })}
    </span>
  );
}

/* ------------------------------------------------------------ countdown */

function useNow(active: boolean, every = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

/** Hours and minutes left as "18:42" (or "2d 04h"); '' once over. */
export function left(endsAt: string, now: number): string {
  const ms = Date.parse(endsAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const mins = Math.ceil(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 48) return `${Math.floor(h / 24)}d ${String(h % 24).padStart(2, '0')}h`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The cooling-off countdown in mono; nothing once it is over. */
export function Cooling({ endsAt, className, big }: { endsAt: string; className?: string | undefined; big?: boolean | undefined }): React.JSX.Element | null {
  const now = useNow(endsAt !== '');
  const t = left(endsAt, now);
  if (t === '') return null;
  return (
    <Tip text="Cooling-off: no discussion until it ends">
      <span className={cn('inline-flex items-center gap-1 text-[var(--vo-warn)]', className)}>
        <Timer size={big === true ? 18 : 13} strokeWidth={1.9} aria-hidden />
        <span className={cn('vo-mono vo-num', big === true ? 'text-[26px] font-light leading-8' : 'text-[12px]')}>{t}</span>
      </span>
    </Tip>
  );
}

/* ------------------------------------------------------------ cited text */

/** Text with [n] as citation chips and [?] as an uncited mark; paragraphs on blank lines. */
export function CitedText({ text, citations, className }: { text: string; citations: Cite[]; className?: string | undefined }): React.JSX.Element {
  const paras = useMemo(() => text.split(/\n\s*\n/).filter((p) => p.trim() !== ''), [text]);
  return (
    <div className={cn('vo-wrap flex flex-col gap-2 text-[14px] leading-6', className)}>
      {paras.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {p.split(/(\[\d{1,3}\]|\[\?\])/g).map((part, j) => {
            const m = /^\[(\d{1,3}|\?)\]$/.exec(part);
            if (m === null) return <span key={j}>{part}</span>;
            if (m[1] === '?')
              return (
                <Tip key={j} text="No source for this figure">
                  <span className="mx-0.5 inline-flex h-[18px] items-center rounded-[3px] border border-dashed border-[var(--vo-warn)] px-1 align-[1px] text-[10.5px] text-[var(--vo-warn)]">?</span>
                </Tip>
              );
            const c = citations[Number(m[1]) - 1];
            if (c === undefined) return <span key={j}>{part}</span>;
            return (
              <span key={j} className="mx-0.5">
                <CiteChip c={c} />
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

/** One citation as a chip: a file opens at its page, a public source opens its link. */
export function CiteChip({ c }: { c: Cite }): React.JSX.Element {
  const label = c.kind === 'anchor' && c.page !== undefined && c.page > 0 ? `${c.n} p.${c.page}` : `${c.n} ${c.kind === 'url' ? c.source ?? '' : c.kind === 'note' ? 'Note' : ''}`.trim();
  const quote = c.ok ? (c.kind === 'url' ? `${c.source ?? ''}${c.title ? ': ' + c.title : ''}` : c.kind === 'anchor' ? `${c.label}${c.quote ? ': ' + c.quote : c.hidden === true ? ': under NDA' : ''}` : c.label) : 'Source not available';
  if (c.kind === 'url' && c.url !== undefined) return <Citation label={label} quote={quote} href={c.url} />;
  if (c.kind === 'anchor' && c.hidden !== true && c.file !== undefined && c.file !== '') return <Citation label={label} quote={quote} onOpen={() => void download('files.download', { file: c.file }, 'open', c.label)} />;
  return <Citation label={label} quote={quote} />;
}

/* --------------------------------------------------------- revealed tally */

const RULE_WORD: Record<string, string> = { consensus: 'Consensus', champion: 'Champion', majority: 'Majority' };

/** The revealed tally (chart) and every vote with its one-line rationale, junior first. */
export function TallyView({ tally, members }: { tally: TallyData; members: VoteMember[] }): React.JSX.Element {
  const result = tally.result === 'invest' ? 'Invest' : tally.result === 'pass' ? 'Pass' : 'No result';
  return (
    <div className="flex min-w-0 flex-col gap-5 md:flex-row md:items-start md:gap-8">
      <div className="flex shrink-0 flex-col gap-3">
        <Tally options={tally.choices.map((c) => ({ label: choiceLabel(c.choice), count: c.n, tone: leanTone(c.lean) }))} height={72} label="Votes" />
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone={tally.result === 'invest' ? 'good' : tally.result === 'pass' ? 'bad' : 'faint'}>
            {RULE_WORD[tally.rule] ?? 'Rule'}: {result}
          </Tag>
          {tally.vetoes > 0 && <Tag tone="bad">Veto</Tag>}
        </div>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col">
        {members
          .filter((m) => m.voted)
          .map((m) => (
            <li key={m.id} className="flex min-h-9 min-w-0 items-start gap-3 border-b border-[var(--vo-hair)] py-2 last:border-b-0">
              <Avatar name={m.name} size={24} />
              <span className="w-28 shrink-0 truncate pt-0.5 text-[13px] font-medium">{m.name}</span>
              <span className={cn('vo-mono vo-num flex h-6 min-w-8 shrink-0 items-center justify-center rounded-[4px] px-1.5 text-[13px]', m.lean === 'for' ? 'bg-[var(--vo-good-soft)] text-[var(--vo-good)]' : m.lean === 'against' ? 'bg-[var(--vo-bad-soft)] text-[var(--vo-bad)]' : 'bg-[var(--vo-sunk)] text-[var(--vo-ink-2)]')}>{choiceLabel(m.choice ?? '')}</span>
              {m.veto === true && <Tag tone="bad">Veto</Tag>}
              <span className="vo-wrap min-w-0 flex-1 pt-0.5 text-[13px] text-[var(--vo-ink-2)]">{m.rationale}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------- bear case */

/** Your AI agent's ask as a picture (Asked, Working, Ready) and its state in words, followed live. */
export function JobTrack({ job, className }: { job: JobBrief; className?: string | undefined }): React.JSX.Element {
  const track = { ...job, labels: ['Asked', 'Working', 'Ready'], at: job.done_at !== '' ? 2 : 0 };
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <AgentSteps track={track} className="max-w-[320px]" />
      <AskStatus state={stateOfTrack(job)} />
    </div>
  );
}

/** The bear case points (risks and contrary evidence) with their citations, or the ask. */
export function BearCase({ item, canAsk }: { item: Item; canAsk: boolean }): React.JSX.Element {
  const points: BearPoint[] = item.bearcase?.points ?? [];
  const job = item.bearcase_ask;
  if (points.length === 0) {
    if (job !== null && job.open) return <JobTrack job={job} />;
    if (!canAsk || item.deal === null) return job !== null ? <AskStatus state={stateOfTrack(job)} /> : <span className="text-[13px] text-[var(--vo-muted)]">No bear case</span>;
    return <AskAgent label="Bear case" size="md" state={stateOfTrack(job)} onAsk={(again) => op('bearcase.request', { item: item.id, ...(again !== '' ? { again } : {}) })} reads={READS} />;
  }
  return (
    <ul className="flex min-w-0 flex-col gap-2.5">
      {points.map((p, i) => (
        <li key={i} className="flex min-w-0 items-start gap-2.5">
          <Tip text={p.kind === 'risk' ? 'Risk' : 'Contrary evidence'}>
            <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[4px]', p.kind === 'risk' ? 'bg-[var(--vo-warn-soft)] text-[var(--vo-warn)]' : 'bg-[var(--vo-bad-soft)] text-[var(--vo-bad)]')}>{p.kind === 'risk' ? <TriangleAlert size={12} strokeWidth={2} aria-hidden /> : <CircleSlash size={12} strokeWidth={2} aria-hidden />}</span>
          </Tip>
          <CitedText text={p.text} citations={p.citations} className="min-w-0 flex-1 text-[13px] leading-5" />
          {i === 0 && item.bearcase_by === 'agent' && <AgentTag className="mt-0.5" />}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------ vote dialog */

/** Vote: one chip on the scale and the PIN; a one-line rationale and the veto are there when wanted. */
export function VoteDialog({ item, open, onClose }: { item: Pick<Item, 'id' | 'title' | 'scale_choices' | 'scale_label'>; open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [why, setWhy] = useState('');
  const [veto, setVeto] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setWhy('');
      setVeto(false);
    }
  }, [open]);
  const cast = async (choice: string): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('votes.cast', { item: item.id, choice, rationale: why.trim(), veto }, { pin: { title: `Vote ${choiceLabel(choice)}` } }), READS);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={item.title} width={440}>
      <div className="flex flex-col gap-4">
        <ChipPicker label={item.scale_label} options={item.scale_choices.map((c) => ({ value: c, label: choiceLabel(c) }))} value="" onChange={(v) => void cast(v)} className={cn('[&>button]:h-12 [&>button]:min-w-12 [&>button]:justify-center [&>button]:text-[15px]', busy && 'pointer-events-none opacity-60')} />
        <Input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder="Why, in one line" aria-label="Rationale" />
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-[13px]">
            <Toggle checked={veto} onChange={setVeto} label="Veto" />
            <Tip text="A veto blocks the deal whatever the rule">
              <span className={veto ? 'font-medium text-[var(--vo-bad)]' : 'text-[var(--vo-ink-2)]'}>Veto</span>
            </Tip>
          </span>
          <Tip text="Sealed until the facilitator reveals">
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--vo-muted)]">
              <CircleAlert size={12} aria-hidden />
              Blind
            </span>
          </Tip>
        </div>
      </div>
    </Dialog>
  );
}
