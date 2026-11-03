/**
 * One question as a soft row: a round badge for its state, the short name,
 * a preview of the answer (or what your AI agent asks) and a status pill.
 * It opens in place into the editor with speedrun's full wording, your AI
 * agent's suggestion and the reviewer's read. Typing saves on its own.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Check as CheckIcon, ChevronDown, CircleHelp, Link2, MessageCircleQuestion, Minus, Plus, Sparkles, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { registerEditor } from '../lib/editors.ts';
import { ReviewAgain } from './ReviewAgain.tsx';
import { monthLabel } from '../lib/format.ts';
import type { Answer } from '../lib/types.ts';
import { AutoText, CircleButton, IconBadge, PillButton, Segments, StatusPill, Tip, TwoWay, pillInput } from './ui.tsx';

const ISSUE_TONE: Record<string, 'bad' | 'warn' | 'tip'> = {
  marketing: 'bad',
  jargon: 'bad',
  overclaim: 'bad',
  ai_voice: 'bad',
  outsourced: 'bad',
  no_competitors: 'bad',
  buried_lede: 'warn',
  undersold: 'warn',
  top_down_market: 'warn',
  vague: 'warn',
  no_numbers: 'warn',
  weak_proof: 'warn',
  too_long: 'warn',
  off_question: 'warn',
  unclear: 'warn',
  grammar: 'warn',
};

function toneColor(t: 'bad' | 'warn' | 'tip'): string {
  return t === 'bad' ? 'var(--sr-red)' : t === 'warn' ? 'var(--sr-accent)' : 'var(--sr-muted)';
}

type Row = Record<string, string>;

function parseRows(v: string): Row[] {
  if (v === '') return [];
  try {
    const arr = JSON.parse(v) as Record<string, string | number | null>[];
    return Array.isArray(arr) ? arr.map((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x === null || x === undefined ? '' : String(x)]))) : [];
  } catch {
    return [];
  }
}

/** A number as the founders read it: dollars, percent, months or a count. */
export function numberText(a: Pick<Answer, 'unit'>, v: string): string {
  const n = Number(v);
  if (v === '' || !Number.isFinite(n)) return v;
  if (a.unit === 'usd') return '$' + n.toLocaleString('en-US');
  if (a.unit === 'percent') return n + '%';
  if (a.unit === 'months') return n + (n === 1 ? ' month' : ' months');
  return n.toLocaleString('en-US');
}

type State = 'done' | 'check' | 'flag' | 'empty' | 'ask';

export function stateOf(a: Answer): State {
  if (a.need !== '' && a.value === '') return 'ask';
  if (a.value === '') return 'empty';
  if (a.flags > 0) return 'flag';
  if (!a.confirmed) return 'check';
  return 'done';
}

const BADGE: Record<State, { icon: LucideIcon; tone: 'light' | 'solid' | 'accent' | 'good' | 'bad' | 'row' }> = {
  done: { icon: CheckIcon, tone: 'good' },
  check: { icon: Sparkles, tone: 'light' },
  flag: { icon: AlertTriangle, tone: 'accent' },
  empty: { icon: Minus, tone: 'light' },
  ask: { icon: MessageCircleQuestion, tone: 'solid' },
};

const STATE_TIP: Record<State, string> = {
  done: 'Answered and confirmed',
  check: 'Written by your AI agent: read it and confirm',
  flag: 'The reviewer flagged something',
  empty: 'Not answered yet',
  ask: 'Your AI agent needs something from you',
};

function preview(a: Answer): string {
  if (a.need !== '' && a.value === '') return 'Your AI agent asks: ' + a.need;
  if (a.value === '') return a.required ? 'Empty' : 'Optional';
  if (a.type === 'yesno') return a.value === 'yes' ? 'Yes' : 'No';
  if (a.type === 'number') return numberText(a, a.value);
  if (a.type === 'month') return monthLabel(a.value);
  if (a.type === 'date') return new Date(a.value + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  if (a.type === 'rows') {
    const rows = parseRows(a.value);
    const first = a.columns[0]?.key ?? 'name';
    return rows.map((r) => r[first] || '?').join(', ');
  }
  return a.value.replace(/\s+/g, ' ');
}

const UNIT_MARK: Record<string, { before?: string; after?: string }> = { usd: { before: '$' }, percent: { after: '%' }, months: { after: 'months' } };

/** The investor or referral rows: one line per row with a cell per column, add and remove in place. */
function RowsEditor({ a, rows, locked, onChange, onFocus, onBlur }: { a: Answer; rows: Row[]; locked: boolean; onChange: (rows: Row[]) => void; onFocus: () => void; onBlur: () => void }): React.JSX.Element {
  const shown = rows.length === 0 ? [{}] : rows;
  return (
    <div className="grid gap-2 rounded-[20px] bg-[var(--sr-card)] p-3">
      <div className="hidden gap-2 px-1 sm:grid" style={{ gridTemplateColumns: `repeat(${a.columns.length}, minmax(0, 1fr)) 36px` }}>
        {a.columns.map((c) => (
          <span key={c.key} className="text-[12px] font-semibold text-[var(--sr-muted)]">
            {c.label}
          </span>
        ))}
      </div>
      {shown.map((r, i) => (
        <div key={i} className="grid gap-2 sm:items-center" style={{ gridTemplateColumns: `repeat(${a.columns.length}, minmax(0, 1fr)) 36px` }}>
          {a.columns.map((c) => (
            <input
              key={c.key}
              className={cn(pillInput, 'h-10 bg-[var(--sr-row)] text-[13px]', c.num === true && 'num text-right')}
              value={(r as Row)[c.key] ?? ''}
              placeholder={c.label}
              aria-label={c.label + ', row ' + (i + 1)}
              inputMode={c.num === true ? 'decimal' : c.key === 'email' ? 'email' : 'text'}
              disabled={locked}
              onFocus={onFocus}
              onBlur={onBlur}
              onChange={(e) => {
                const next = shown.map((x) => ({ ...(x as Row) }));
                const cell = next[i] ?? {};
                cell[c.key] = c.num === true ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value;
                next[i] = cell;
                onChange(next);
              }}
            />
          ))}
          {!locked && rows.length > 0 ? (
            <CircleButton icon={X} label={'Remove row ' + (i + 1)} variant="row" size={36} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
          ) : (
            <span />
          )}
        </div>
      ))}
      {!locked && (
        <div>
          <PillButton variant="row" icon={Plus} className="h-9" onClick={() => onChange([...shown.map((x) => ({ ...(x as Row) })), {}])}>
            Add a row
          </PillButton>
        </div>
      )}
    </div>
  );
}

export function QuestionCard({ a, open, onToggle, locked }: { a: Answer; open: boolean; onToggle: () => void; locked: boolean }): React.JSX.Element {
  const [draft, setDraft] = useState(a.value);
  const [rowsDraft, setRowsDraft] = useState<Row[]>(() => parseRows(a.value));
  const [saving, setSaving] = useState(false);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<unknown>(undefined);
  const saveRef = useRef<(value: unknown) => Promise<void>>(async () => {});
  const lastSent = useRef(a.value);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing.current || timer.current !== null) return;
    setDraft(a.value);
    setRowsDraft(parseRows(a.value));
    lastSent.current = a.value;
  }, [a.value]);

  useEffect(() => {
    if (open) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);

  useEffect(
    () => () => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      timer.current = null;
      void saveRef.current(pending.current);
    },
    [],
  );

  const save = async (value: unknown): Promise<void> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text === lastSent.current) return;
    lastSent.current = text;
    setSaving(true);
    try {
      await op('answers.set', { key: a.key, value });
      changed('answers');
    } catch {
      lastSent.current = '\u0000';
    } finally {
      setSaving(false);
    }
  };

  saveRef.current = save;
  useEffect(() => registerEditor(async () => {
    if (timer.current !== null) await saveRef.current(pending.current);
  }), []);

  const later = (value: unknown): void => {
    pending.current = value;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save(value);
    }, 700);
  };

  /** Rows with something in them, as the operation takes them. */
  const rowsValue = (rows: Row[]): Row[] => rows.filter((r) => Object.values(r).some((x) => String(x).trim() !== ''));

  const st = stateOf(a);
  const badge = BADGE[st];
  const chars = Array.from(draft).length;
  const words = draft.trim() === '' ? 0 : draft.trim().split(/\s+/).length;
  const over = a.limit > 0 && chars > a.limit;
  const j = a.judge;
  const fixes = (j?.issues.length ?? 0) + (j?.missing.length ?? 0) + (over ? 1 : 0) + (a.measures.em_dashes > 0 ? 1 : 0);
  const reading = a.judge_state === 'queued' || a.judge_state === 'running';

  const field = useMemo(() => {
    const focus = (): void => {
      editing.current = true;
    };
    const blur = (v: unknown) => (): void => {
      editing.current = false;
      void save(v);
    };
    if (a.type === 'yesno') {
      return (
        <div>
          <TwoWay
            label={a.short}
            labels={['Yes', 'No']}
            value={draft === 'yes' ? 0 : draft === 'no' ? 1 : null}
            disabled={locked}
            className="min-w-[160px]"
            onPick={(i) => {
              const v = i === 0 ? 'yes' : 'no';
              setDraft(v);
              void save(v);
            }}
          />
        </div>
      );
    }
    if (a.type === 'choice') {
      return (
        <div className="relative max-w-[360px]">
          <select
            className={cn(pillInput, 'appearance-none pr-11 font-medium')}
            value={draft}
            disabled={locked}
            aria-label={a.short}
            onChange={(e) => {
              setDraft(e.target.value);
              void save(e.target.value);
            }}
          >
            <option value="">Choose</option>
            {a.choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--sr-muted)]" />
        </div>
      );
    }
    if (a.type === 'month' || a.type === 'date') {
      return (
        <input
          type={a.type}
          className={cn(pillInput, 'num max-w-[220px] font-semibold')}
          value={draft}
          aria-label={a.short}
          disabled={locked}
          onFocus={focus}
          onChange={(e) => {
            setDraft(e.target.value);
            later(e.target.value);
          }}
          onBlur={blur(draft)}
        />
      );
    }
    if (a.type === 'rows') {
      return (
        <RowsEditor
          a={a}
          rows={rowsDraft}
          locked={locked}
          onFocus={focus}
          onBlur={blur(rowsValue(rowsDraft))}
          onChange={(rows) => {
            setRowsDraft(rows);
            later(rowsValue(rows));
          }}
        />
      );
    }
    if (a.type === 'long') {
      return (
        <AutoText
          bad={over}
          value={draft}
          minRows={3}
          placeholder="In your own words"
          aria-label={a.short}
          disabled={locked}
          className="bg-[var(--sr-card)]"
          onFocus={focus}
          onChange={(e) => {
            setDraft(e.target.value);
            later(e.target.value);
          }}
          onBlur={blur(draft)}
        />
      );
    }
    const mark = a.type === 'number' ? (UNIT_MARK[a.unit] ?? {}) : {};
    const input = (
      <input
        className={cn(pillInput, over && 'ring-2 ring-[var(--sr-red)]', a.type === 'number' && 'num text-right', mark.before !== undefined && 'pl-8', mark.after !== undefined && (mark.after.length > 2 ? 'pr-[72px]' : 'pr-9'))}
        value={draft}
        inputMode={a.type === 'number' ? 'decimal' : a.type === 'url' ? 'url' : 'text'}
        placeholder={a.type === 'url' ? (a.key === 'x_video' || a.key === 'x_deck' ? 'File path on this computer, or a link' : 'https://') : a.type === 'number' ? '0' : ''}
        aria-label={a.short}
        disabled={locked}
        onFocus={focus}
        onChange={(e) => {
          const v = a.type === 'number' ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value;
          setDraft(v);
          later(v);
        }}
        onBlur={blur(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    );
    if (a.type !== 'number') return input;
    return (
      <span className="relative block max-w-[220px]">
        {input}
        {mark.before !== undefined && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[13px] text-[var(--sr-muted)]">{mark.before}</span>}
        {mark.after !== undefined && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-[var(--sr-muted)]">{mark.after}</span>}
      </span>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.type, a.key, a.short, a.choices, a.columns, a.unit, a.value, draft, rowsDraft, over, locked]);

  return (
    <div ref={box} id={'q-' + a.key} className={cn('min-w-0 scroll-mt-4 rounded-[20px] transition-colors', open ? 'bg-[var(--sr-row)]' : 'bg-[var(--sr-row)] hover:bg-[var(--sr-hover)]')}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <Tip text={STATE_TIP[st]}>
          <IconBadge icon={badge.icon} tone={badge.tone} />
        </Tip>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">
            {a.short}
            {!a.required && <span className="ml-1.5 font-medium text-[var(--sr-muted)]">optional</span>}
          </span>
          {!open && <span className="block truncate text-[12px] text-[var(--sr-muted)]">{preview(a)}</span>}
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          {a.suggestion !== '' && <StatusPill tone="warn">Suggestion</StatusPill>}
          {reading && <StatusPill tone="neutral" pulse>Reading</StatusPill>}
          {fixes > 0 && a.value !== '' && <StatusPill tone="bad">{fixes === 1 ? '1 fix' : fixes + ' fixes'}</StatusPill>}
          {j !== null && fixes === 0 && a.value !== '' && <Segments value={j.strength} max={3} count={3} tone="good" />}
        </span>
        <ChevronDown size={16} className="shrink-0 text-[var(--sr-muted)] transition-transform duration-200" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div className="sr-unfold grid gap-3 px-3 pb-4 sm:pl-[64px] sm:pr-5">
          <p className="text-[13px] text-[var(--sr-muted)]">
            {a.label}{' '}
            {a.tip !== '' && (
              <Tip text={a.tip}>
                <CircleHelp size={14} className="inline align-[-2px]" aria-label="What a strong answer has" tabIndex={0} />
              </Tip>
            )}
          </p>

          {a.need !== '' && (
            <div className="flex items-start gap-3 rounded-[18px] bg-[var(--sr-ink)] px-4 py-3 text-[13px] text-[var(--sr-shell)]">
              <MessageCircleQuestion size={16} className="mt-0.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{a.need}</span>
            </div>
          )}

          {field}

          {a.derived && a.origin === 'system' && (
            <p className="flex items-center gap-2 text-[12px] text-[var(--sr-muted)]">
              <Link2 size={13} aria-hidden /> Filled from your team page. Change the founders there, or write it here to set it by hand.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn('num text-[12px]', over ? 'font-bold text-[var(--sr-red-text)]' : 'text-[var(--sr-muted)]')}>
              {(a.type === 'long' || a.type === 'short') && (a.limit > 0 ? chars + ' / ' + a.limit : words > 0 ? words + ' words' + (a.words_hint > 0 && words > a.words_hint ? ', aim for ' + a.words_hint : '') : '')}
              {saving && ' · saving'}
            </span>
            {a.value !== '' && !a.confirmed && !locked && (
              <PillButton variant="dark" dot icon={CheckIcon} className="h-10" onClick={() => void op('answers.confirm', { key: a.key }).then(() => changed('answers'))}>
                Looks right
              </PillButton>
            )}
            {a.value !== '' && a.confirmed && <StatusPill tone="good">Confirmed</StatusPill>}
          </div>

          {a.suggestion !== '' && !locked && (
            <div className="grid gap-3 rounded-[20px] border border-[var(--sr-border)] bg-[var(--sr-card)] p-4">
              <span className="flex items-center gap-2 text-[13px] font-bold">
                <Sparkles size={15} className="text-[var(--sr-accent)]" /> Your AI agent suggests
                {a.suggestion_why !== '' && (
                  <Tip text={a.suggestion_why}>
                    <CircleHelp size={13} tabIndex={0} aria-label="Why" />
                  </Tip>
                )}
              </span>
              <p className="whitespace-pre-wrap text-[15px] leading-[24px] [overflow-wrap:anywhere]">{a.type === 'number' ? numberText(a, a.suggestion) : a.type === 'rows' ? parseRows(a.suggestion).map((r) => a.columns.map((c) => r[c.key] || '-').join(', ')).join('\n') : a.suggestion}</p>
              <div className="flex flex-wrap gap-2">
                <PillButton variant="dark" onClick={() => void op('answers.accept', { key: a.key }).then(() => changed('answers'))}>
                  Use it
                </PillButton>
                <PillButton variant="row" onClick={() => void op('answers.dismiss', { key: a.key }).then(() => changed('answers'))}>
                  Keep mine
                </PillButton>
              </div>
            </div>
          )}

          {(a.judge !== null || (a.value !== '' && (a.judged || a.measures.em_dashes > 0 || over))) && <Review a={a} locked={locked} over={over} draftChanged={draft !== a.value} saving={saving} />}
        </div>
      )}
    </div>
  );
}

function Review({ a, locked, over, draftChanged, saving }: { a: Answer; locked: boolean; over: boolean; draftChanged: boolean; saving: boolean }): React.JSX.Element {
  const j = a.judge;
  const items: { color: string; title: string; quote?: string; fix?: string }[] = [];
  if (over) items.push({ color: 'var(--sr-red)', title: 'Too long', fix: 'by ' + (a.measures.chars - a.limit) + ' characters; the form stops at ' + a.limit });
  if (a.measures.em_dashes > 0) items.push({ color: 'var(--sr-accent)', title: a.measures.em_dashes === 1 ? '1 em dash' : a.measures.em_dashes + ' em dashes', fix: 'reads as machine-written; use a comma' });
  for (const i of j?.issues ?? []) items.push({ color: toneColor(ISSUE_TONE[i.type] ?? 'warn'), title: i.label, quote: i.quote, fix: i.fix });
  for (const m of j?.missing ?? []) items.push({ color: 'var(--sr-accent)', title: 'Missing', fix: m });
  return (
    <div className="grid gap-3 rounded-[20px] bg-[var(--sr-card)] p-4">
      {a.judged && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-[12px] text-[var(--sr-muted)]">
            {a.judge_state === 'queued' || a.judge_state === 'running'
              ? 'Reviewing the requested saved version. Previous feedback stays visible.'
              : a.judge_state === 'error' || a.judge_state === 'offline'
                ? 'Review could not finish. Previous feedback is still shown; click Review again to retry.'
                : j === null ? 'Not reviewed yet. Click Review again when ready.'
                  : !a.judge_current || draftChanged ? 'Changed since review. This feedback is from the previous version.'
                    : 'Last review'}
          </p>
          {!locked && a.value !== '' && <ReviewAgain answerKey={a.key} locked={saving || a.judge_state === 'queued' || a.judge_state === 'running'} />}
        </div>
      )}
      {j !== null && (
        <div className="flex items-center gap-3">
          <Tip text={['Weak', 'Okay', 'Good', 'Strong'][j.strength] + ' answer'}>
            <span tabIndex={0}><Segments value={j.strength} max={3} count={3} tone={j.strength >= 2 ? 'good' : 'accent'} /></span>
          </Tip>
          <span className="text-[13px] text-[var(--sr-muted)]">Reads as: {j.restated}</span>
        </div>
      )}
      {items.length > 0 && (
        <ul className="grid gap-2">
          {items.map((it, n) => (
            <li key={n} className="flex items-start gap-2.5 text-[13px] leading-5">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: it.color }} />
              <span>
                <b>{it.title}</b>
                {it.quote !== undefined && it.quote !== '' && <span className="ml-1.5 rounded-full bg-[var(--sr-red)]/12 px-2 py-0.5">{it.quote}</span>}
                {it.fix !== undefined && it.fix !== '' && <span className="ml-1.5 text-[var(--sr-muted)]">{it.fix}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {j !== null && j.shorter !== '' && !locked && (
        <div className="grid gap-2 rounded-[18px] bg-[var(--sr-row)] p-4">
          <span className="text-[13px] font-bold">Shorter version</span>
          <p className="whitespace-pre-wrap text-[14px] leading-[22px] [overflow-wrap:anywhere]">{j.shorter}</p>
          <div>
            <PillButton variant="dark" disabled={!a.judge_current || draftChanged || saving} title={!a.judge_current || draftChanged ? 'Review the changed answer before applying a shorter version' : undefined} onClick={() => void op('answers.use-shorter', { key: a.key }).then(() => changed('answers'))}>
              Use it
            </PillButton>
          </div>
        </div>
      )}
    </div>
  );
}
