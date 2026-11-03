/**
 * Settings: the business, what your AI agent may change on its own, the
 * guards on prices, stock and buyer-data defaults, exchange rates, a full
 * download and the activity trail. Every field saves when you leave it.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Boxes, Building2, Clock, Coins, Database, Download, History, Lock, RefreshCw, ShieldCheck, Sparkles, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Button, Card, CardHeader, Empty, Field, IconBadge, LinkButton, PageHeader, Segmented, Select, Skeleton, Tabs, Tip } from '../components/ui.tsx';
import { download, op } from '../lib/api.ts';
import { ago, day, dayTime, num } from '../lib/format.ts';
import { changed, useLive } from '../lib/live.ts';
import { go, href, targetHref } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';
import { useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { Activity, Autonomy, AutonomyKind, Catalog, ProductList, Settings } from '../lib/types.ts';
import { SaveNumber, SaveText } from './Shop.tsx';

type Section = 'business' | 'agent' | 'guards' | 'stock' | 'buyers' | 'fx' | 'data' | 'activity';

const SECTIONS: { key: Section; label: string; icon: LucideIcon }[] = [
  { key: 'business', label: 'Business', icon: Building2 },
  { key: 'agent', label: 'Your AI agent', icon: Sparkles },
  { key: 'guards', label: 'Guards', icon: ShieldCheck },
  { key: 'stock', label: 'Stock', icon: Boxes },
  { key: 'buyers', label: 'Buyer data', icon: Lock },
  { key: 'fx', label: 'Exchange rates', icon: Coins },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'activity', label: 'Activity', icon: History },
];

async function saveSettings(fields: Record<string, unknown>): Promise<void> {
  await op('settings.update', fields);
  changed('settings', 'activity');
}

export function SettingsPage({ route }: { route: Route }): React.JSX.Element {
  const { settings, catalog, error } = useStore();
  const section: Section = SECTIONS.some((x) => x.key === route.sub) ? (route.sub as Section) : 'business';
  const open = (k: Section): void => go('settings', k);

  let body: ReactNode;
  if (settings === null) {
    body = error !== null ? <p className="text-[13px] text-[var(--so-red-text)]">{error}</p> : <Skeleton className="h-[320px] rounded-[20px]" />;
  } else if (section === 'business') body = <BusinessSection settings={settings} catalog={catalog} />;
  else if (section === 'agent') body = <AgentSection settings={settings} />;
  else if (section === 'guards') body = <GuardsSection settings={settings} />;
  else if (section === 'stock') body = <StockSection settings={settings} />;
  else if (section === 'buyers') body = <BuyersSection settings={settings} />;
  else if (section === 'fx') body = <FxSection settings={settings} />;
  else if (section === 'data') body = <DataSection />;
  else body = <ActivitySection />;

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="mb-4 lg:hidden">
        <Tabs size="sm" items={SECTIONS.map((x) => ({ key: x.key, label: x.label }))} value={section} onChange={open} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="hidden p-2 lg:block">
          <nav role="tablist" aria-orientation="vertical" aria-label="Settings" className="grid gap-0.5">
            {SECTIONS.map((x) => {
              const on = x.key === section;
              const Icon = x.icon;
              return (
                <button
                  key={x.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => open(x.key)}
                  className={cn('so-press flex h-10 w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-[14px] font-medium', on ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'text-[var(--so-ink-2)] hover:bg-[var(--so-row-hover)] hover:text-[var(--so-ink)]')}
                >
                  <Icon size={16} strokeWidth={2} aria-hidden />
                  {x.label}
                </button>
              );
            })}
          </nav>
        </Card>
        <div className="min-w-0">{body}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- business */

function timeZones(current: string): string[] | null {
  if (typeof Intl.supportedValuesOf !== 'function') return null;
  try {
    const list = Intl.supportedValuesOf('timeZone');
    return current !== '' && !list.includes(current) ? [current, ...list] : list;
  } catch {
    return null;
  }
}

function BusinessSection({ settings: st, catalog }: { settings: Settings; catalog: Catalog | null }): React.JSX.Element {
  const products = useLive<ProductList>('settings:products', (signal) => op<ProductList>('products.list', { status: 'all', limit: 1 }, { signal, quiet: true }), ['products'], []);
  const hasProducts = products.data !== null && products.data.counts.all + products.data.counts.archived > 0;
  const zones = useMemo(() => timeZones(st.timezone), [st.timezone]);
  const currencies = catalog?.currencies ?? [];
  const curList = st.base_currency !== '' && !currencies.includes(st.base_currency) ? [st.base_currency, ...currencies] : currencies;

  const pick = (k: string) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    saveSettings({ [k]: e.target.value })
      .then(() => notify.info('Saved'))
      .catch(() => undefined);
  };

  const base = (
    <Select value={st.base_currency} disabled={hasProducts} onChange={pick('base_currency')} aria-label="Base currency">
      {st.base_currency === '' && <option value="">Choose</option>}
      {curList.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );

  return (
    <Card>
      <CardHeader title="Business" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name">
          <SaveText label="Business name" value={st.business_name} maxLength={120} onSave={(v) => saveSettings({ business_name: v })} />
        </Field>
        <Field label="Your name">
          <SaveText label="Your name" value={st.owner_name} maxLength={80} onSave={(v) => saveSettings({ owner_name: v })} />
        </Field>
        <Field label="Country">
          <Select value={st.country} onChange={pick('country')}>
            {st.country === '' && <option value="">Choose</option>}
            {(catalog?.countries ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={<Tip text="Product prices, costs and reports are in this currency">Base currency</Tip>}>
          {hasProducts ? (
            <Tip text={'Prices and costs are in ' + st.base_currency} className="block w-full">
              <span className="block w-full [&_select]:pointer-events-none">{base}</span>
            </Tip>
          ) : (
            base
          )}
        </Field>
        <Field label="Time zone" className="sm:col-span-2">
          {zones !== null ? (
            <Select value={st.timezone} onChange={pick('timezone')}>
              {st.timezone === '' && <option value="">Choose</option>}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          ) : (
            <SaveText label="Time zone" value={st.timezone} placeholder="Asia/Kuala_Lumpur" onSave={(v) => saveSettings({ timezone: v })} />
          )}
        </Field>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------- your AI agent */

const KINDS: { key: AutonomyKind; label: string }[] = [
  { key: 'listings', label: 'Listing text and price' },
  { key: 'prices', label: 'SKU prices' },
  { key: 'stock', label: 'Stock changes' },
  { key: 'replies', label: 'Sending buyer replies' },
  { key: 'orders', label: 'Cancelling and refunding orders' },
];

const LEVELS: { key: Autonomy; label: string }[] = [
  { key: 'ask', label: 'Ask me' },
  { key: 'auto', label: 'Automatic' },
];

function AgentSection({ settings: st }: { settings: Settings }): React.JSX.Element {
  const [local, setLocal] = useState<Partial<Record<AutonomyKind, Autonomy>>>({});
  const set = (k: AutonomyKind, v: Autonomy): void => {
    setLocal((m) => ({ ...m, [k]: v }));
    op('settings.autonomy', { [k]: v })
      .then(() => {
        changed('settings', 'activity');
        notify.info('Saved');
      })
      .catch(() => undefined)
      .finally(() =>
        setLocal((m) => {
          const next = { ...m };
          delete next[k];
          return next;
        }),
      );
  };
  return (
    <Card>
      <CardHeader title="Your AI agent" subtitle="Ask me: changes wait in Approvals." />
      <ul>
        {KINDS.map((k) => (
          <li key={k.key} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--so-line)] py-3 first:border-t-0">
            <span className="text-[14px] font-medium">{k.label}</span>
            <Segmented items={LEVELS} value={local[k.key] ?? st.autonomy[k.key] ?? 'ask'} onChange={(v) => set(k.key, v)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------------------------------------------- guards, stock, pii */

function GuardsSection({ settings: st }: { settings: Settings }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Guards" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={<Tip text="A proposed price drop bigger than this is marked high risk">Largest price drop</Tip>}>
          <SaveNumber label="Largest price drop" value={st.guards.max_price_drop_pct} suffix="%" min={0} max={100} onSave={(v) => saveSettings({ max_price_drop_pct: v })} />
        </Field>
        <Field label={<Tip text="Prices with a margin below this are flagged">Minimum margin</Tip>}>
          <SaveNumber label="Minimum margin" value={st.guards.min_margin_pct} suffix="%" min={-100} max={100} onSave={(v) => saveSettings({ min_margin_pct: v })} />
        </Field>
      </div>
    </Card>
  );
}

function StockSection({ settings: st }: { settings: Settings }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Stock" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={<Tip text="A SKU at or below this many available is low. Each SKU can set its own.">Low-stock level</Tip>}>
          <SaveNumber label="Low-stock level" value={st.low_stock} suffix="units" integer min={0} onSave={(v) => saveSettings({ low_stock: v })} />
        </Field>
      </div>
    </Card>
  );
}

function BuyersSection({ settings: st }: { settings: Settings }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Buyer data" subtitle="Addresses and phone numbers of finished orders are removed after this." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={<Tip text="Names, emails and the orders themselves stay">Keep for</Tip>} hint="7 to 3650">
          <SaveNumber label="Keep for" value={st.pii_days} suffix="days" integer min={7} max={3650} onSave={(v) => saveSettings({ pii_days: v })} />
        </Field>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------- exchange rates */

function FxSection({ settings: st }: { settings: Settings }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const fx = st.fx;
  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('settings.fx-refresh');
      changed('settings');
      notify.info('Rates refreshed');
    } catch {
      /* the notice says why */
    } finally {
      setBusy(false);
    }
  };
  if (st.base_currency === '') {
    return (
      <Card>
        <Empty icon={Coins} title="No base currency yet" action={<Button onClick={() => go('settings', 'business')}>Set it</Button>}>
          Rates follow your base currency.
        </Empty>
      </Card>
    );
  }
  const rows: { label: string; value: string }[] = [
    { label: 'Base currency', value: fx.base !== '' ? fx.base : st.base_currency },
    { label: 'Date', value: fx.date !== '' ? day(/^\d{4}-\d{2}-\d{2}$/.test(fx.date) ? fx.date + ' 00:00' : fx.date) : 'Not fetched yet' },
    { label: 'Source', value: fx.source !== '' ? fx.source : '' },
    { label: 'Currencies', value: fx.currencies > 0 ? num(fx.currencies) : '' },
  ];
  return (
    <Card>
      <CardHeader
        title={<Tip text="Orders in other currencies count in your base currency at these rates. They refresh every six hours.">Exchange rates</Tip>}
        action={
          <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy} onClick={() => void refresh()}>
            Refresh now
          </Button>
        }
      />
      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="rounded-[14px] bg-[var(--so-tile)] px-4 py-3">
            <dt className="text-[12px] font-semibold text-[var(--so-muted)]">{r.label}</dt>
            <dd className="num mt-0.5 truncate text-[14px] font-semibold">{r.value !== '' ? r.value : 'None'}</dd>
          </div>
        ))}
      </dl>
      {fx.error !== '' && <p className="mt-3 rounded-[12px] bg-[var(--so-red-soft)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--so-red-text)]">{fx.error}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ data */

function DataSection(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const data = await op<unknown>('app.export');
      const date = new Date().toISOString().slice(0, 10);
      download('store-os-export-' + date + '.json', JSON.stringify(data, null, 2), 'application/json');
      notify.info('Downloaded');
    } catch {
      /* the notice says why */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Data" />
      <div className="flex flex-wrap items-center gap-4 rounded-[14px] bg-[var(--so-tile)] p-4">
        <IconBadge icon={Database} tone="card" size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">Everything in one file</p>
          <p className="mt-0.5 text-[12px] leading-[18px] text-[var(--so-muted)]">Shops, products, stock, orders, customers and conversations as JSON.</p>
        </div>
        <Button icon={Download} loading={busy} onClick={() => void save()}>
          Download everything
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- activity */

const ACTOR: Record<Activity['actor'], { icon: LucideIcon; label: string }> = {
  person: { icon: User, label: 'You' },
  agent: { icon: Sparkles, label: 'Your AI agent' },
  system: { icon: Clock, label: 'Store OS' },
};

function ActivitySection(): React.JSX.Element {
  const live = useLive<{ activity: Activity[] }>('settings:activity', (signal) => op<{ activity: Activity[] }>('activity.list', { limit: 100 }, { signal, quiet: true }), ['activity'], []);
  const list = live.data?.activity ?? [];
  return (
    <Card>
      <CardHeader title="Activity" subtitle={list.length > 0 ? 'The last ' + num(list.length) + ' changes' : undefined} />
      {live.data === null && live.loading && (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {live.error !== null && live.data === null && <p className="text-[13px] text-[var(--so-red-text)]">{live.error}</p>}
      {live.data !== null && list.length === 0 && (
        <Empty icon={History} title="Nothing yet" action={<LinkButton href={href('shops')}>Open shops</LinkButton>}>
          Changes by you and your AI agent show here.
        </Empty>
      )}
      {list.length > 0 && (
        <ol>
          {list.map((a, i) => {
            const who = ACTOR[a.actor] ?? ACTOR.system;
            const link = a.target !== '' ? targetHref(a.target) : '';
            const inner = (
              <>
                <span
                  title={who.label}
                  className={cn(
                    'relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full',
                    a.actor === 'agent' ? 'bg-[var(--so-accent-soft)] text-[var(--so-accent-text)]' : 'bg-[var(--so-card)] text-[var(--so-ink)] shadow-[inset_0_0_0_1px_var(--so-border)]',
                  )}
                >
                  <who.icon size={15} strokeWidth={2} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 pt-1.5">
                  <span className="block text-[13px] leading-5">{a.text}</span>
                  <span className="mt-0.5 block text-[12px] text-[var(--so-muted)]" title={dayTime(a.created)}>
                    {who.label}, {ago(a.created)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={a.id} className="relative">
                {i < list.length - 1 && <span aria-hidden className="absolute bottom-0 left-[27px] top-11 w-px bg-[var(--so-line)]" />}
                {link !== '' ? (
                  <a href={link} className="flex items-start gap-3 rounded-[14px] px-3 py-2 hover:bg-[var(--so-row-hover)]">
                    {inner}
                  </a>
                ) : (
                  <div className="flex items-start gap-3 px-3 py-2">{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
