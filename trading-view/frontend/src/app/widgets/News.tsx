/**
 * Headlines for the linked symbol, or the market at large.
 */
import { useEffect, useState } from 'react';
import { Newspaper, RefreshCw } from 'lucide-react';
import { Empty, IconBtn, Seg } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { ago, short } from '../lib/format.ts';
import { useApp } from '../lib/store.tsx';
import type { NewsItem, Widget } from '../lib/types.ts';
import { Title, WidgetShell } from '../workspace/WidgetShell.tsx';

export function NewsWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const { symbol } = app.shows(w);
  const scope = w.config.scope ?? 'symbol';
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError('');
    const load = (): void => {
      api
        .news(scope === 'symbol' ? { symbol, limit: 20 } : { q: 'stock market', limit: 20 })
        .then((r) => !cancelled && setItems(r.news))
        .catch((err: unknown) => {
          if (cancelled) return;
          setItems([]);
          setError((err as { message?: string }).message ?? 'Could not load news');
        });
    };
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [symbol, scope, tick]);

  return (
    <WidgetShell
      w={w}
      title={<Title detail={scope === 'symbol' ? short(symbol) : 'Markets'}>News</Title>}
      actions={
        <>
          <Seg
            size="xs"
            value={scope}
            onChange={(v) => app.configure(w, { scope: v })}
            options={[
              { value: 'symbol', label: short(symbol).slice(0, 10), title: 'Headlines about the linked symbol' },
              { value: 'market', label: 'Market', title: 'Market headlines' },
            ]}
          />
          <IconBtn icon={RefreshCw} label="Refresh" size={24} onClick={() => setTick((n) => n + 1)} />
        </>
      }
    >
      <div className="h-full overflow-y-auto">
        {items === null ? (
          <div className="flex flex-col gap-2 p-2.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="tv-skeleton h-9 rounded-[3px]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty icon={Newspaper} title="No headlines">
            {error !== '' ? error : 'Nothing recent about ' + short(symbol) + '.'}
          </Empty>
        ) : (
          items.map((n) => (
            <a key={n.id} href={n.link} target="_blank" rel="noopener noreferrer" className="block border-b border-[var(--tv-hair)] px-2.5 py-1.5 hover:bg-[var(--tv-row)]">
              <span className="line-clamp-2 text-[12.5px] font-semibold leading-[17px]">{n.title}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--tv-muted)]">
                <span className="truncate">{n.publisher}</span>
                <span>·</span>
                <span className="shrink-0">{ago(n.time)}</span>
                {n.tickers.slice(0, 3).map((t) => (
                  <span key={t} className="shrink-0 rounded-[3px] bg-[var(--tv-row)] px-1 text-[10px] font-bold text-[var(--tv-ink-2)]">
                    {t}
                  </span>
                ))}
              </span>
            </a>
          ))
        )}
      </div>
    </WidgetShell>
  );
}
