/**
 * Focus card bodies of the portfolio's Next items.
 *
 * kpis: every value your AI agent staged from one founder update, each
 * beside its source snippet; Verify all is the card's black button (the
 * kernel frame draws it), Fix one corrects a value in place and verifies it.
 *
 * alert: the figure against its threshold as a bar, and the small series
 * behind it.
 */
import { useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { Button, IconButton, Input, Tag } from '../ui.tsx';
import { Meter, Sparkline } from '../charts.tsx';
import { Snip, periodLong, periodShort } from './kit.tsx';
import { op } from '../../lib/api.ts';
import { act } from '../../lib/live.ts';
import { months } from '../../lib/format.ts';
import type { CardProps } from '../../lib/contract.ts';
import type { Alert, KpiValue } from '../../pages/portfolio/types.ts';

const READS = ['*'];
const CONTEXT = 48;

/** The last words before a quote (at most CONTEXT characters, cut at a space). */
function trimStart(t: string): string {
  if (t.length <= CONTEXT) return t;
  const cut = t.slice(-CONTEXT);
  const sp = cut.indexOf(' ');
  return '...' + (sp >= 0 ? cut.slice(sp + 1) : cut);
}

/** The first words after a quote. */
function trimEnd(t: string): string {
  if (t.length <= CONTEXT) return t;
  const cut = t.slice(0, CONTEXT);
  const sp = cut.lastIndexOf(' ');
  return (sp > 0 ? cut.slice(0, sp) : cut) + '...';
}

function Row({ v }: { v: KpiValue }): React.JSX.Element {
  const [fixing, setFixing] = useState(false);
  const [text, setText] = useState('');
  const [done, setDone] = useState(false);
  const fix = (): void => {
    const t = text.trim();
    if (t === '') return;
    void act([], () => op('kpis.verify', { id: v.id, value: t }), READS).then((r) => {
      if (r !== null) {
        setFixing(false);
        setDone(true);
      }
    });
  };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-[var(--vo-hair)] py-2.5 last:border-b-0 sm:grid-cols-[130px_110px_minmax(0,1fr)_auto] sm:items-center">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium">{v.label}</span>
        <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{v.months === 3 ? periodShort(v.period_end, 3) : periodLong(v.period_end)}</span>
      </span>
      {fixing ? (
        <Input autoFocus className="vo-mono h-8 w-28" aria-label={'Correct ' + v.label} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? fix() : e.key === 'Escape' ? (e.stopPropagation(), setFixing(false)) : undefined)} />
      ) : (
        <span className="vo-mono vo-num text-right text-[15px] sm:text-left">{v.value_text}</span>
      )}
      <span className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
        {v.snippet ? <Snip before={trimStart(v.snippet.before)} quote={v.snippet.quote} after={trimEnd(v.snippet.after)} /> : v.quote !== '' ? <Snip before="" quote={v.quote} after="" /> : null}
        {(v.flags.length > 0 || v.forecast) && (
          <span className="flex flex-wrap gap-1.5">
            {v.forecast && <Tag>Forecast</Tag>}
            {v.flags.map((f) => (
              <Tag key={f.code} tone="warn" title={f.note}>
                {f.label}
              </Tag>
            ))}
          </span>
        )}
      </span>
      <span className="col-span-2 flex justify-end sm:col-span-1">
        {done ? (
          <Tag tone="good" icon={Check}>
            Fixed
          </Tag>
        ) : fixing ? (
          <Button size="sm" disabled={text.trim() === ''} onClick={fix}>
            Verify
          </Button>
        ) : (
          <IconButton icon={Pencil} label="Fix one" onClick={() => (setText(''), setFixing(true))} />
        )}
      </span>
    </li>
  );
}

export function KpisCard({ item }: CardProps): React.JSX.Element {
  const values = ((item.data?.['values'] as KpiValue[] | undefined) ?? []).filter((v) => v.status === 'staged').sort((a, b) => Number(a.forecast) - Number(b.forecast));
  return (
    <ul aria-label="Staged values" className="vo-scroll max-h-[420px] overflow-y-auto rounded-[var(--vo-radius-sm)] border border-[var(--vo-hair)] bg-[var(--vo-raised)] px-4">
      {values.map((v) => (
        <Row key={v.id} v={v} />
      ))}
    </ul>
  );
}

export function AlertCard({ item }: CardProps): React.JSX.Element | null {
  const a = item.data?.['alert'] as Alert | undefined;
  if (a === undefined) return null;
  const f = a.figure;
  const series = (f.series ?? []).map((p) => p.value);
  return (
    <div className="flex flex-col gap-4">
      {f.unit === 'months' && <Meter value={f.value} max={Math.max(24, f.threshold * 2)} tone={a.level === 'bad' ? 'bad' : 'warn'} marks={[{ value: f.threshold, label: f.threshold + ' months', tone: 'bad' }]} format={(v) => months(v)} label="Runway" />}
      {series.length > 1 && <Sparkline values={series} width={320} height={56} area tone={a.level === 'bad' ? 'bad' : 'warn'} label={f.unit === 'months' ? 'Cash' : 'Net burn'} />}
    </div>
  );
}
