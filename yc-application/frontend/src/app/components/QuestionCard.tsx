/**
 * One question as a soft row: a round badge for its state, the short name,
 * a preview of the answer (or what your AI agent asks) and a status pill.
 * It opens in place into the editor with YC's full wording, your AI
 * agent's suggestion and the reviewer's read. Typing saves on its own.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Check as CheckIcon, ChevronDown, CircleHelp, MessageCircleQuestion, Minus, Sparkles } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { monthLabel } from '../lib/format.ts';
import { setConfirm } from '../lib/actions.ts';
import type { Answer, Confirms } from '../lib/types.ts';
import { MonthBars } from './Charts.tsx';
import { AutoText, IconBadge, PillButton, Segments, StatusPill, Tip, Toggle, TwoWay, pillInput } from './ui.tsx';

const ISSUE_TONE: Record<string, 'bad' | 'warn' | 'tip'> = {
  marketing: 'bad',
  jargon: 'bad',
  overclaim: 'bad',
  ai_voice: 'bad',
  outsourced: 'bad',
  no_competitors: 'bad',
  top_down_market: 'warn',
  vague: 'warn',
  no_numbers: 'warn',
  weak_proof: 'warn',
  too_long: 'warn',
  off_question: 'warn',
  unclear: 'warn',
  grammar: 'tip',
};

function toneColor(t: 'bad' | 'warn' | 'tip'): string {
  return t === 'bad' ? 'var(--yc-red)' : t === 'warn' ? 'var(--yc-accent)' : 'var(--yc-muted)';
}

function parseMonths(v: string): Record<string, string> {
  if (v === '') return {};
  try {
    const o = JSON.parse(v) as Record<string, number>;
    const out: Record<string, string> = {};
    for (const [k, n] of Object.entries(o)) out[k] = String(n);
    return out;
  } catch {
    return {};
  }
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
  if (a.type === 'months') {
    const o = parseMonths(a.value);
    const keys = Object.keys(o).sort();
    const last = keys[keys.length - 1];
    return last !== undefined ? monthLabel(last) + ': $' + Number(o[last]).toLocaleString('en-US') : '';
  }
  if (a.type === 'yesno') return a.value === 'yes' ? 'Yes' : 'No';
  if (a.type === 'number') return a.key === 'e_runway' ? a.value + ' months' : '$' + Number(a.value).toLocaleString('en-US');
  return a.value.replace(/\s+/g, ' ');
}

export function QuestionCard({ a, months, confirms, open, onToggle, locked }: { a: Answer; months: string[]; confirms: Confirms; open: boolean; onToggle: () => void; locked: boolean }): React.JSX.Element {
  const [draft, setDraft] = useState(a.value);
  const [monthsDraft, setMonthsDraft] = useState<Record<string, string>>(() => parseMonths(a.value));
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
    setMonthsDraft(parseMonths(a.value));
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

  const later = (value: unknown): void => {
    pending.current = value;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save(value);
    }, 700);
  };

  const monthsValue = (d: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const m of months) if ((d[m] ?? '').trim() !== '') out[m] = d[m] ?? '';
    return out;
  };

  const st = stateOf(a);
  const badge = BADGE[st];
  const chars = Array.from(draft).length;
  const words = draft.trim() === '' ? 0 : draft.trim().split(/\s+/).length;
  const over = a.limit > 0 && chars > a.limit;
  const j = a.judge_current ? a.judge : null;
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
        <div className="relative max-w-[320px]">
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
          <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--yc-muted)]" />
        </div>
      );
    }
    if (a.type === 'months') {
      const values: Record<string, number> = {};
      for (const m of months) values[m] = Number(monthsDraft[m] ?? 0) || 0;
      return (
        <div className="grid gap-4 rounded-[20px] bg-[var(--yc-card)] p-4">
          <MonthBars months={months} values={values} />
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map((m) => (
              <input
                key={m}
                className="num h-10 w-full rounded-full bg-[var(--yc-row)] px-2 text-center text-[13px] font-semibold outline-none ring-[var(--yc-ink)] focus-visible:ring-2"
                inputMode="decimal"
                placeholder="$0"
                aria-label={'Revenue ' + monthLabel(m)}
                value={monthsDraft[m] ?? ''}
                disabled={locked}
                onFocus={focus}
                onChange={(e) => {
                  const next = { ...monthsDraft, [m]: e.target.value.replace(/[^0-9.]/g, '') };
                  setMonthsDraft(next);
                  later(monthsValue(next));
                }}
                onBlur={blur(monthsValue(monthsDraft))}
              />
            ))}
          </div>
          {a.value !== '' && (
            <label className="flex items-center justify-between gap-3 text-[13px] font-semibold">
              Each month on its own: not cumulative, not GMV
              <Toggle checked={confirms.revenue_monthly === true} disabled={locked} label="Revenue is monthly" onChange={(v) => setConfirm('revenue_monthly', v)} />
            </label>
          )}
        </div>
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
          className="bg-[var(--yc-card)]"
          onFocus={focus}
          onChange={(e) => {
            setDraft(e.target.value);
            later(e.target.value);
          }}
          onBlur={blur(draft)}
        />
      );
    }
    return (
      <input
        className={cn(pillInput, over && 'ring-2 ring-[var(--yc-red)]', a.type === 'number' && 'num max-w-[200px] text-right')}
        value={draft}
        inputMode={a.type === 'number' ? 'decimal' : a.type === 'url' ? 'url' : 'text'}
        placeholder={a.type === 'url' ? 'https://' : a.type === 'number' ? '0' : ''}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.type, a.key, a.short, a.choices, a.value, draft, monthsDraft, months, over, locked, confirms.revenue_monthly]);

  return (
    <div ref={box} id={'q-' + a.key} className={cn('min-w-0 scroll-mt-4 rounded-[20px] transition-colors', open ? 'bg-[var(--yc-row)]' : 'bg-[var(--yc-row)] hover:bg-[var(--yc-hover)]')}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <Tip text={STATE_TIP[st]}>
          <IconBadge icon={badge.icon} tone={badge.tone} />
        </Tip>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">
            {a.short}
            {!a.required && <span className="ml-1.5 font-medium text-[var(--yc-muted)]">optional</span>}
          </span>
          {!open && <span className="block truncate text-[12px] text-[var(--yc-muted)]">{preview(a)}</span>}
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          {a.suggestion !== '' && <StatusPill tone="warn">Suggestion</StatusPill>}
          {reading && <StatusPill tone="neutral" pulse>Reading</StatusPill>}
          {!reading && fixes > 0 && a.value !== '' && <StatusPill tone="bad">{fixes === 1 ? '1 fix' : fixes + ' fixes'}</StatusPill>}
          {!reading && j !== null && fixes === 0 && a.value !== '' && <Segments value={j.strength} max={3} count={3} tone="good" />}
        </span>
        <ChevronDown size={16} className="shrink-0 text-[var(--yc-muted)] transition-transform duration-200" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div className="yc-unfold grid gap-3 px-3 pb-4 sm:pl-[64px] sm:pr-5">
          <p className="text-[13px] text-[var(--yc-muted)]">
            {a.label}{' '}
            {a.tip !== '' && (
              <Tip text={a.tip}>
                <CircleHelp size={14} className="inline align-[-2px]" aria-label="What a strong answer has" tabIndex={0} />
              </Tip>
            )}
          </p>

          {a.need !== '' && (
            <div className="flex items-start gap-3 rounded-[18px] bg-[var(--yc-ink)] px-4 py-3 text-[13px] text-[var(--yc-shell)]">
              <MessageCircleQuestion size={16} className="mt-0.5 shrink-0 text-[var(--yc-accent)]" />
              <span>{a.need}</span>
            </div>
          )}

          {field}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn('num text-[12px]', over ? 'font-bold text-[var(--yc-red-text)]' : 'text-[var(--yc-muted)]')}>
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
            <div className="grid gap-3 rounded-[20px] border border-[var(--yc-border)] bg-[var(--yc-card)] p-4">
              <span className="flex items-center gap-2 text-[13px] font-bold">
                <Sparkles size={15} className="text-[var(--yc-accent)]" /> Your AI agent suggests
                {a.suggestion_why !== '' && (
                  <Tip text={a.suggestion_why}>
                    <CircleHelp size={13} tabIndex={0} aria-label="Why" />
                  </Tip>
                )}
              </span>
              <p className="whitespace-pre-wrap text-[15px] leading-[24px]">{a.suggestion}</p>
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

          {a.value !== '' && (a.judged || a.measures.em_dashes > 0 || over) && <Review a={a} locked={locked} over={over} />}
        </div>
      )}
    </div>
  );
}

function Review({ a, locked, over }: { a: Answer; locked: boolean; over: boolean }): React.JSX.Element {
  const j = a.judge_current ? a.judge : null;
  const items: { color: string; title: string; quote?: string; fix?: string }[] = [];
  if (over) items.push({ color: 'var(--yc-red)', title: 'Too long', fix: 'by ' + (a.measures.chars - a.limit) + ' characters' });
  if (a.measures.em_dashes > 0) items.push({ color: 'var(--yc-accent)', title: a.measures.em_dashes === 1 ? '1 em dash' : a.measures.em_dashes + ' em dashes', fix: 'reads as machine-written; use a comma' });
  for (const i of j?.issues ?? []) items.push({ color: toneColor(ISSUE_TONE[i.type] ?? 'warn'), title: i.label, quote: i.quote, fix: i.fix });
  for (const m of j?.missing ?? []) items.push({ color: 'var(--yc-accent)', title: 'Missing', fix: m });
  return (
    <div className="grid gap-3 rounded-[20px] bg-[var(--yc-card)] p-4">
      {a.judged && j === null ? (
        <p className="flex items-center gap-2 text-[13px] text-[var(--yc-muted)]">
          <Sparkles size={14} className="text-[var(--yc-accent)]" />
          {a.judge_state === 'offline' ? 'Your AI agent reads this as soon as it is online' : a.judge_state === 'error' ? 'Could not read this one' : 'Your AI agent is reading this'}
          {a.judge_state === 'error' && (
            <button type="button" className="font-semibold text-[var(--yc-ink)] underline underline-offset-4 hover:decoration-2" onClick={() => void op('answers.recheck', { key: a.key }).then(() => changed('answers'))}>
              Try again
            </button>
          )}
        </p>
      ) : j !== null ? (
        <div className="flex items-center gap-3">
          <Tip text={['Weak', 'Okay', 'Good', 'Strong'][j.strength] + ' answer'}>
            <span tabIndex={0}>
              <Segments value={j.strength} max={3} count={3} tone={j.strength >= 2 ? 'good' : 'accent'} />
            </span>
          </Tip>
          <span className="text-[13px] text-[var(--yc-muted)]">Reads as: {j.restated}</span>
        </div>
      ) : null}
      {items.length > 0 && (
        <ul className="grid gap-2">
          {items.map((it, n) => (
            <li key={n} className="flex items-start gap-2.5 text-[13px] leading-5">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: it.color }} />
              <span>
                <b>{it.title}</b>
                {it.quote !== undefined && it.quote !== '' && <span className="ml-1.5 rounded-full bg-[var(--yc-red)]/12 px-2 py-0.5">{it.quote}</span>}
                {it.fix !== undefined && it.fix !== '' && <span className="ml-1.5 text-[var(--yc-muted)]">{it.fix}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {j !== null && j.shorter !== '' && !locked && (
        <div className="grid gap-2 rounded-[18px] bg-[var(--yc-row)] p-4">
          <span className="text-[13px] font-bold">Shorter version</span>
          <p className="whitespace-pre-wrap text-[14px] leading-[22px]">{j.shorter}</p>
          <div>
            <PillButton variant="dark" onClick={() => void op('answers.use-shorter', { key: a.key }).then(() => changed('answers'))}>
              Use it
            </PillButton>
          </div>
        </div>
      )}
    </div>
  );
}
