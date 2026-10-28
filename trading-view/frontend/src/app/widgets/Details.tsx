/**
 * Symbol details: live price with pre/post-market price and market state,
 * day and 52-week ranges, key statistics from daily bars, performance,
 * trading hours in the exchange's time, dividends and splits.
 */
import { useEffect, useState } from 'react';
import { BellPlus, Info as InfoIcon, Sparkles } from 'lucide-react';
import { Change, Chip, Empty, IconBtn, RangeBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { compact, num, pct, plainPct, price, short, signed, tone, TONE_TEXT } from '../lib/format.ts';
import { useQuote } from '../lib/live.ts';
import { useApp } from '../lib/store.tsx';
import { zoneLabel } from '../lib/time.ts';
import type { Info, Widget } from '../lib/types.ts';
import { useDialogs } from '../workspace/Dialogs.tsx';
import { Title, WidgetShell } from '../workspace/WidgetShell.tsx';
import { cn } from '../../kit/index.ts';

function hhmm(m: number): string {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

const STATE: Record<string, string> = { open: 'Market open', pre: 'Pre-market', post: 'After hours', closed: 'Market closed', unknown: '' };

export function DetailsWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const dialogs = useDialogs();
  const { symbol, interval } = app.shows(w);
  const q = useQuote(symbol);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setError('');
    const load = (): void => {
      api
        .info(symbol)
        .then((r) => !cancelled && setInfo(r))
        .catch((err: unknown) => !cancelled && setError((err as { message?: string }).message ?? 'Could not load'));
    };
    load();
    const t = setInterval(load, 120000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [symbol]);

  const meta = info?.meta;
  const st = info?.stats ?? null;
  const live = q ?? info?.quote ?? undefined;
  const hint = live?.price_hint ?? meta?.price_hint;
  const sessions = meta?.sessions ?? null;
  const lastDiv = info?.events?.dividends.at(-1);
  const lastSplit = info?.events?.splits.at(-1);

  const stat = (label: string, value: React.ReactNode, title?: string): React.JSX.Element => (
    <div className="flex items-baseline justify-between gap-2 py-[3px]" title={title}>
      <span className="truncate text-[11.5px] text-[var(--tv-muted)]">{label}</span>
      <span className="num shrink-0 text-[12px] font-semibold">{value}</span>
    </div>
  );

  return (
    <WidgetShell
      w={w}
      title={<Title detail={meta?.exchange}>{short(symbol)}</Title>}
      actions={
        <>
          <IconBtn icon={BellPlus} label="New alert" size={24} onClick={() => dialogs.newAlert({ symbol, interval, ...(live?.price !== null && live?.price !== undefined ? { price: live.price } : {}) })} />
          <IconBtn icon={Sparkles} label="Ask AI" size={24} onClick={() => dialogs.askAI({ symbol, interval })} />
        </>
      }
    >
      <div className="h-full overflow-y-auto px-2.5 py-2">
        {error !== '' && info === null ? (
          <Empty icon={InfoIcon} title={'No details for ' + short(symbol)}>
            {error}
          </Empty>
        ) : (
          <>
            <div className="truncate text-[12.5px] font-semibold" title={meta?.name}>
              {meta?.name ?? live?.name ?? <span className="tv-skeleton inline-block h-3.5 w-40 rounded-[3px]" />}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-[var(--tv-muted)]">
              {meta !== undefined && (
                <span>
                  {[meta.type, meta.currency].filter((x) => x !== '').join(' · ')}
                  {meta.provider === 'yahoo' ? ' · Yahoo Finance, may be delayed' : ' · Binance live'}
                </span>
              )}
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="num text-[22px] font-bold leading-7">{live?.price !== undefined ? price(live.price, hint) : '-'}</span>
              <span className={cn('num text-[13px] font-semibold', TONE_TEXT[tone(live?.change)])}>{signed(live?.change, hint)}</span>
              <Change value={live?.change_pct} className="text-[13px] font-semibold" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {live !== undefined && live.state !== 'unknown' && <Chip tone={live.state === 'open' ? 'ink' : 'neutral'}>{STATE[live.state]}</Chip>}
              {live?.ext_price !== null && live?.ext_price !== undefined && (
                <span className="num text-[11.5px] font-semibold text-[var(--tv-ink-2)]">
                  {live.state === 'pre' ? 'Pre' : 'Post'} {price(live.ext_price, hint)} <Change value={live.ext_change_pct} />
                </span>
              )}
              {live?.stale === true && <Chip tone="warn">Cached</Chip>}
            </div>

            <div className="mt-3">
              <div className="flex justify-between text-[11px] text-[var(--tv-muted)]">
                <span>Day range</span>
              </div>
              <div className="num mt-1 flex items-center gap-2 text-[11.5px] font-semibold">
                <span>{price(live?.low, hint)}</span>
                <RangeBar low={live?.low} high={live?.high} value={live?.price} />
                <span>{price(live?.high, hint)}</span>
              </div>
            </div>
            <div className="mt-2">
              <div className="text-[11px] text-[var(--tv-muted)]">52-week range</div>
              <div className="num mt-1 flex items-center gap-2 text-[11.5px] font-semibold">
                <span>{price(live?.low_52w ?? st?.low_52w, hint)}</span>
                <RangeBar low={live?.low_52w ?? st?.low_52w} high={live?.high_52w ?? st?.high_52w} value={live?.price} />
                <span>{price(live?.high_52w ?? st?.high_52w, hint)}</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 border-t border-[var(--tv-hair)] pt-2">
              {stat('Open', price(st?.open, hint))}
              {stat('Prev close', price(live?.prev_close, hint))}
              {stat('Volume', compact(live?.volume))}
              {stat('Avg vol 30D', compact(st?.avg_volume_30d))}
              {stat('Rel. volume', st?.rvol !== null && st?.rvol !== undefined ? num(st.rvol, 2) + '×' : '-', 'Today against the 20-day average')}
              {stat('ATR 14', st?.atr14 !== null && st?.atr14 !== undefined ? price(st.atr14, hint) + ' · ' + plainPct(st.atr_pct) : '-', 'Average true range, daily')}
              {stat('RSI 14', num(st?.rsi14, 1))}
              {stat('Volatility 20D', plainPct(st?.hv20), 'Annualized')}
              {stat('vs SMA 50', <span className={TONE_TEXT[tone(st?.sma50_dist)]}>{pct(st?.sma50_dist)}</span>)}
              {stat('vs SMA 200', <span className={TONE_TEXT[tone(st?.sma200_dist)]}>{pct(st?.sma200_dist)}</span>)}
            </div>

            <div className="mt-2 border-t border-[var(--tv-hair)] pt-2">
              <div className="mb-1 text-[11px] text-[var(--tv-muted)]">Performance</div>
              <div className="grid grid-cols-6 gap-1">
                {(
                  [
                    ['1W', st?.perf_1w],
                    ['1M', st?.perf_1m],
                    ['3M', st?.perf_3m],
                    ['6M', st?.perf_6m],
                    ['YTD', st?.perf_ytd],
                    ['1Y', st?.perf_1y],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-[4px] bg-[var(--tv-row)] px-1 py-1 text-center">
                    <div className="text-[10px] font-bold text-[var(--tv-muted)]">{k}</div>
                    <Change value={v ?? null} digits={1} className="text-[11.5px] font-semibold" />
                  </div>
                ))}
              </div>
            </div>

            {(sessions !== null || lastDiv !== undefined || lastSplit !== undefined) && (
              <div className="mt-2 border-t border-[var(--tv-hair)] pt-2">
                {sessions !== null && meta !== undefined && (
                  <>
                    {stat('Regular hours', hhmm(sessions.regular[0]) + '–' + hhmm(sessions.regular[1]) + ' ' + zoneLabel(meta.tz))}
                    {sessions.pre !== undefined && stat('Pre-market', hhmm(sessions.pre[0]) + '–' + hhmm(sessions.pre[1]))}
                    {sessions.post !== undefined && stat('After hours', hhmm(sessions.post[0]) + '–' + hhmm(sessions.post[1]))}
                  </>
                )}
                {meta?.provider === 'binance' && stat('Trading hours', 'Around the clock')}
                {lastDiv !== undefined && stat('Last dividend', lastDiv.amount.toFixed(4) + ' · ' + new Date(lastDiv.t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}
                {lastSplit !== undefined && stat('Last split', lastSplit.ratio + ' · ' + new Date(lastSplit.t * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))}
              </div>
            )}
          </>
        )}
      </div>
    </WidgetShell>
  );
}
