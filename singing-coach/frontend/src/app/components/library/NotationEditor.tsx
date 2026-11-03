/**
 * Writing a song in ABC notation with its words, checked as you type: the
 * problems by line, verse and bar, or what the app read (bars, key, metre,
 * tempo, the sung range and where it sits, words, phrases, the longest one).
 */
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import type { CheckResult } from '../../lib/types.ts';
import { Spinner, Textarea } from '../ui.tsx';

export const ABC_EXAMPLE = ['X:1', 'T:My song', 'C:Words and music by me', 'M:3/4', 'L:1/4', 'Q:1/4=96', '%%licence own', 'K:G', '"G" D | G2 A | "D" B2 A | "G" G2 B | "D" A2 !breath!D |', 'w: Come sing a-long the riv-er wide, and', '"G" G2 A | "C" B2 c | "D" d2 A | "G" G2 |]', 'w: let morn-ing light be our guide.'].join('\n');

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
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} minRows={rows} maxRows={rows + 6} spellCheck={false} placeholder={ABC_EXAMPLE} className="sc-mono text-[12px] leading-[18px]" aria-label="ABC notation" />
      <CheckLine result={result} busy={busy} />
    </div>
  );
}

export function CheckLine({ result, busy }: { result: CheckResult | null; busy: boolean }): React.JSX.Element | null {
  if (result === null && !busy) return null;
  if (result === null)
    return (
      <div className="flex items-center gap-2 text-[12px] text-[var(--sc-muted)]">
        <Spinner size={12} /> Checking…
      </div>
    );
  if (!result.ok)
    return (
      <div className={cn('flex flex-col gap-1 rounded-[var(--sc-radius-sm)] border border-[color-mix(in_srgb,var(--sc-bad),transparent_70%)] bg-[var(--sc-bad-soft)] px-2.5 py-2 transition-opacity', busy && 'opacity-60')}>
        {result.errors.slice(0, 6).map((e, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[12px] leading-[17px] text-[var(--sc-ink)]">
            <CircleAlert size={13} aria-hidden className="mt-0.5 shrink-0 text-[var(--sc-bad)]" />
            <span>
              {e.line > 0 && <span className="sc-mono mr-1 text-[var(--sc-muted)]">L{e.line}</span>}
              {e.message}
            </span>
          </div>
        ))}
        {result.errors.length > 6 && <div className="pl-5 text-[12px] text-[var(--sc-muted)]">and {result.errors.length - 6} more</div>}
      </div>
    );
  const s = result.summary;
  const fit = result.fit;
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-[var(--sc-radius-sm)] bg-[var(--sc-sunk)] px-2.5 py-2 text-[12px] transition-opacity', busy && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <CircleCheck size={13} aria-hidden className="text-[var(--sc-good)]" />
        {s !== undefined && (
          <span className="sc-mono text-[var(--sc-ink-2)]">
            {s.bars} bars · {s.key} · {s.meter} · ♩={s.tempo} · {s.sung_range} ({s.span} st) · {s.words ? `${s.syllables} syllables${s.verses > 1 ? ` · ${s.verses} verses` : ''}` : 'no words'} · {s.phrases} phrases · longest {s.longest_phrase_s}s
          </span>
        )}
        {result.sections !== undefined && <span className="sc-mono text-[var(--sc-muted)]">{result.sections.map((x) => `${x.name} ${x.from}–${x.to}`).join(' · ')}</span>}
      </div>
      {fit !== null && fit !== undefined && fit.voice_tested && (
        <div className={cn('flex items-center gap-1.5', fit.fits ? 'text-[var(--sc-ink-2)]' : 'text-[var(--sc-warn)]')}>
          {fit.fits ? <CircleCheck size={12} aria-hidden className="text-[var(--sc-good)]" /> : <TriangleAlert size={12} aria-hidden />}
          {fit.fits ? (fit.best_shift === 0 ? 'Fits your voice as written.' : `Fits your voice moved ${fit.best_shift > 0 ? 'up' : 'down'} ${Math.abs(fit.best_shift)} semitone${Math.abs(fit.best_shift) === 1 ? '' : 's'}.`) : `Wider than your comfortable range in any key: ${fit.over > 0 ? `${fit.over} st above` : ''}${fit.over > 0 && fit.under > 0 ? ', ' : ''}${fit.under > 0 ? `${fit.under} st below` : ''}.`}
        </div>
      )}
      {result.warnings.slice(0, 3).map((w, i) => (
        <div key={i} className="flex items-start gap-1.5 text-[var(--sc-muted)]">
          <TriangleAlert size={12} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {w.line > 0 && <span className="sc-mono mr-1">L{w.line}</span>}
            {w.message}
          </span>
        </div>
      ))}
    </div>
  );
}
