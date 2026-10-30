/**
 * Every shop as a card: platform, status, how its data comes in, what is
 * waiting there and, while it is being opened, how far its setup is.
 */
import { useState } from 'react';
import { FileUp, PenLine, Plus, Sparkles, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { AddShopDialog, countryName } from '../components/AddShopDialog.tsx';
import { PlatformMark } from '../components/PlatformMark.tsx';
import { Button, Card, Meter, PageHeader, Pill, Skeleton, TaskBadge } from '../components/ui.tsx';
import type { Tone } from '../components/ui.tsx';
import { ago, num, plural } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { useStore } from '../lib/store.tsx';
import type { Shop } from '../lib/types.ts';

export const SHOP_STATUS: Record<Shop['status'], { label: string; tone: Tone }> = {
  setting_up: { label: 'Setting up', tone: 'accent' },
  active: { label: 'Active', tone: 'good' },
  paused: { label: 'Paused', tone: 'warn' },
};

export const CONNECTION_ICON: Record<Shop['connection'], LucideIcon> = { agent: Sparkles, files: FileUp, manual: PenLine };

/** "Synced by your AI agent, 2 h ago", "Imports, 3 days ago"; nothing for a shop kept by hand. */
export function connectionLine(s: Pick<Shop, 'connection' | 'sync_at'>): string {
  const when = s.sync_at !== '' ? ago(s.sync_at) : '';
  if (s.connection === 'agent') return when !== '' ? 'Synced by your AI agent, ' + when : 'Your AI agent syncs it';
  if (s.connection === 'files') return when !== '' ? 'Imports, ' + when : 'Imports';
  return '';
}

export function ShopsPage(): React.JSX.Element {
  const { shops, catalog, error } = useStore();
  const [adding, setAdding] = useState(false);
  const online = shops.filter((s) => s.platform !== 'direct');
  const loading = shops.length === 0 && error === null;

  return (
    <div>
      <PageHeader
        title="Shops"
        {...(shops.length > 0 ? { subtitle: plural(shops.length, 'shop') } : {})}
        actions={
          <Button icon={Plus} onClick={() => setAdding(true)}>
            Add shop
          </Button>
        }
      />
      {error !== null && shops.length === 0 && <p className="text-[13px] text-[var(--so-red-text)]">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[248px] rounded-[20px]" />)}
        {shops.map((s) => (
          <ShopCard key={s.id} shop={s} country={countryName(catalog, s.region)} />
        ))}
        {!loading && online.length === 0 && (
          <Card className="flex flex-col items-start justify-between gap-5">
            <div>
              <span className="mb-4 flex size-10 items-center justify-center rounded-full bg-[var(--so-tile)]">
                <Store size={18} strokeWidth={2} aria-hidden />
              </span>
              <p className="text-[15px] font-semibold">Add your first online shop</p>
              <p className="mt-1 text-[13px] leading-5 text-[var(--so-muted)]">Shopee, Lazada, Shopify, TikTok Shop and more, in one place.</p>
            </div>
            <Button icon={Plus} onClick={() => setAdding(true)}>
              Add shop
            </Button>
          </Card>
        )}
      </div>
      <AddShopDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function ShopCard({ shop: s, country }: { shop: Shop; country: string }): React.JSX.Element {
  const status = SHOP_STATUS[s.status] ?? SHOP_STATUS.active;
  const Conn = CONNECTION_ICON[s.connection] ?? PenLine;
  const line = connectionLine(s);
  const figures: { label: string; title: string; value: number; bad?: boolean }[] = [
    { label: 'To ship', title: 'Orders to ship', value: s.to_ship },
    { label: 'Late', title: 'Orders past their ship-by time', value: s.late, bad: s.late > 0 },
    { label: 'Messages', title: 'Open buyer messages', value: s.open_threads },
    { label: 'Live', title: 'Live listings', value: s.live_listings },
  ];
  return (
    <a href={href('shop', s.id)} className="so-rise so-edge flex min-w-0 flex-col rounded-[20px] bg-[var(--so-card)] p-5 text-[var(--so-ink)]">
      <div className="flex items-start gap-3">
        <PlatformMark platform={s.platform} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-[22px]">{s.name}</p>
          <p className="truncate text-[12px] text-[var(--so-muted)]">{[s.platform_name, country].filter((x) => x !== '').join(' · ')}</p>
        </div>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>
      {line !== '' && (
        <p className="mt-4 flex items-center gap-1.5 text-[12px] font-medium text-[var(--so-ink-2)]">
          <Conn size={13} strokeWidth={2} aria-hidden className="shrink-0" />
          <span className="truncate">{line}</span>
        </p>
      )}
      <div className={cn('grid grid-cols-4 gap-1.5 sm:gap-2', line !== '' ? 'mt-3' : 'mt-4')}>
        {figures.map((f) => (
          <div key={f.label} title={f.title} className="min-w-0 rounded-[12px] bg-[var(--so-tile)] px-2 py-2 sm:px-2.5">
            <p className={cn('num text-[15px] font-semibold leading-[22px]', f.bad === true && 'text-[var(--so-red-text)]')}>{num(f.value)}</p>
            <p className="truncate text-[12px] text-[var(--so-muted)]">{f.label}</p>
          </div>
        ))}
      </div>
      {s.status === 'setting_up' && s.setup.total > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[12px]">
            <span className="font-semibold">Setup</span>
            <span className="num text-[var(--so-muted)]">
              {s.setup.done} of {s.setup.total} done
            </span>
          </div>
          <Meter value={s.setup.done} max={s.setup.total} />
        </div>
      )}
      {s.task !== null && (
        <div className="mt-4">
          <TaskBadge task={s.task} />
        </div>
      )}
    </a>
  );
}
