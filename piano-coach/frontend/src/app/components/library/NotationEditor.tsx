/**
 * Writing a song in ABC notation, checked as you type: the problems by line
 * and bar, or what the app read (bars, key, metre, tempo, range, hands).
 */
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import type { CheckResult } from '../../lib/types.ts';
import { Spinner, Textarea } from '../ui.tsx';

export const ABC_EXAMPLE = ['X:1', 'T:My song', 'C:Composer', 'M:4/4', 'L:1/4', 'Q:1/4=90', 'V:RH clef=treble', 'V:LH clef=bass', 'K:C', '[V:RH] E D C D | E E E2 |', '[V:LH] C,4 | G,4 |'].join('\n');

/** Live check of notation (debounced). */
export function useCheck(abc: string, sections = ''): { result: CheckResult | null; busy: boolean } {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (abc.trim() === '') {
      setResult(null);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const t = window.setTimeout(() => {
      api
        .check(abc, sections)
        .then((r) => mine === seq.current && setResult(r))
        .catch(() => mine === seq.current && setResult({ ok: false, errors: [{ line: 0, message: 'Could not check the notation.' }], warnings: [] }))
        .finally(() => mine === seq.current && setBusy(false));
    }, 380);
    return () => window.clearTimeout(t);
  }, [abc, sections]);
  return { result, busy };
}

export function NotationEditor({ value, onChange, result, busy, rows = 12 }: { value: string; onChange: (v: string) => void; result: CheckResult | null; busy: boolean; rows?: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} minRows={rows} maxRows={rows + 6} spellCheck={false} placeholder={ABC_EXAMPLE} className="pc-mono text-[12px] leading-[18px]" aria-label="ABC notation" />
      <CheckLine result={result} busy={busy} />
    </div>
  );
}

export function CheckLine({ result, busy }: { result: CheckResult | null; busy: boolean }): React.JSX.Element | null {
  if (result === null && !busy) return null;
  if (result === null)
    return (
      <div className="flex items-center gap-2 text-[12px] text-[var(--pc-muted)]">
        <Spinner size={12} /> Checking…
      </div>
    );
  if (!result.ok)
    return (
      <div className={cn('flex flex-col gap-1 rounded-[var(--pc-radius-sm)] border border-[color-mix(in_srgb,var(--pc-bad),transparent_70%)] bg-[var(--pc-bad-soft)] px-2.5 py-2 transition-opacity', busy && 'opacity-60')}>
        {result.errors.slice(0, 6).map((e, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[12px] leading-[17px] text-[var(--pc-ink)]">
            <CircleAlert size={13} aria-hidden className="mt-0.5 shrink-0 text-[var(--pc-bad)]" />
            <span>
              {e.line > 0 && <span className="pc-mono mr-1 text-[var(--pc-muted)]">L{e.line}</span>}
              {e.message}
            </span>
          </div>
        ))}
        {result.errors.length > 6 && <div className="pl-5 text-[12px] text-[var(--pc-muted)]">and {result.errors.length - 6} more</div>}
      </div>
    );
  const s = result.summary;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--pc-radius-sm)] bg-[var(--pc-sunk)] px-2.5 py-2 text-[12px] transition-opacity', busy && 'opacity-60')}>
      <CircleCheck size={13} aria-hidden className="text-[var(--pc-good)]" />
      {s !== undefined && (
        <span className="pc-mono text-[var(--pc-ink-2)]">
          {s.bars} bars · {s.key} · {s.meter} · ♩={s.tempo} · {s.range} · {s.hands === 'both' ? 'both hands' : `${s.hands} hand`}
        </span>
      )}
      {result.sections !== undefined && <span className="pc-mono text-[var(--pc-muted)]">{result.sections.map((x) => `${x.name} ${x.from}–${x.to}`).join(' · ')}</span>}
    </div>
  );
}
