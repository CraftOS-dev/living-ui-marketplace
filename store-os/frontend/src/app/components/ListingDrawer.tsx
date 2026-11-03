/**
 * One shop's listing of a product, edited in a side panel: its own title
 * (counted against the shop's limit), description, price in the shop's
 * currency, keywords and draft or ready; the pre-flight checks for that
 * shop; and the ways it goes live (mark it live yourself, or ask your AI
 * agent to publish it).
 */
import { useEffect, useState } from 'react';
import { CircleCheck, ExternalLink, OctagonAlert, Pause, Play, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { useStore } from '../lib/store.tsx';
import { currencySign, money, num } from '../lib/format.ts';
import { notify } from '../lib/toast.tsx';
import type { Listing, ProductDetail } from '../lib/types.ts';
import { ListingPill } from './badges.tsx';
import { PlatformMark, PLATFORM_NAME } from './PlatformMark.tsx';
import { MarkLiveDialog, amountText, parseAmount } from './ProductDialogs.tsx';
import { ChipInput, Choice, HelpLabel, Labeled, chars, isOpenTask } from './ProductParts.tsx';
import { Button, Card, Drawer, Field, Menu, Pill, TaskBadge, TextArea, TextInput, Tip, confirmAsk } from './ui.tsx';
import type { MenuItem } from './ui.tsx';

type Editable = 'draft' | 'ready';

interface Form {
  title: string;
  desc: string;
  price: string;
  keywords: string[];
  status: Editable;
}

function formOf(l: Listing, p: ProductDetail): Form {
  return { title: l.title || p.title, desc: l.description || p.description, price: amountText(l.price, l.currency, true), keywords: l.keywords, status: l.status === 'ready' ? 'ready' : 'draft' };
}

/** The listing editor in a drawer; closed while `listing` is null. */
export function ListingDrawer({ product, listing, onClose }: { product: ProductDetail; listing: Listing | null; onClose: () => void }): React.JSX.Element | null {
  const [marking, setMarking] = useState<Listing | null>(null);
  return (
    <>
      {listing !== null && <ListingPanel product={product} l={listing} onClose={onClose} onMarkLive={setMarking} />}
      <MarkLiveDialog listing={marking} onClose={() => setMarking(null)} />
    </>
  );
}

function ListingPanel({ product: p, l, onClose, onMarkLive }: { product: ProductDetail; l: Listing; onClose: () => void; onMarkLive: (l: Listing) => void }): React.JSX.Element {
  const store = useStore();
  const shop = store.shop(l.shop.id);
  const titleMax = shop?.title_max ?? 0;
  const publishTask = shop?.task?.kind === 'publish' && isOpenTask(shop.task) ? shop.task : null;
  const editableStatus = l.status === 'draft' || l.status === 'ready';

  const [f, setF] = useState<Form>(() => formOf(l, p));
  const [busy, setBusy] = useState<'' | 'save' | 'publish' | 'status'>('');
  // A saved change (here or by your AI agent) starts the form over from the server.
  useEffect(() => {
    setF(formOf(l, p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l.id, l.updated]);

  const base = formOf(l, p);
  const priceN = parseAmount(f.price);
  const priceBad = priceN === null || (typeof priceN === 'number' && priceN < 0);
  const changes = {
    title: f.title !== base.title,
    desc: f.desc !== base.desc,
    price: typeof priceN === 'number' ? priceN !== l.price : f.price.trim() === '' && l.price !== 0,
    keywords: f.keywords.join('\n') !== l.keywords.join('\n'),
    status: editableStatus && f.status !== base.status,
  };
  const dirty = changes.title || changes.desc || changes.price || changes.keywords || changes.status;
  const titleLen = chars(f.title.trim() === '' ? p.title : f.title);
  const over = titleMax > 0 && titleLen > titleMax;
  const canPublish = l.status === 'ready' || l.needs_update || (editableStatus && f.status === 'ready');
  const catalogPrice = p.variants[0]?.price;
  const blocking = l.issues.filter((i) => i.level === 'blocking');
  const warnings = l.issues.filter((i) => i.level === 'warning');

  const save = async (): Promise<boolean> => {
    if (priceBad) return false;
    setBusy('save');
    try {
      await op<{ listing: Listing }>('listings.draft', {
        product: p.id,
        shop: l.shop.id,
        title: changes.title ? f.title.trim() : undefined,
        description: changes.desc ? f.desc : undefined,
        price: changes.price ? (priceN ?? 0) : undefined,
        keywords: changes.keywords ? f.keywords : undefined,
        status: changes.status ? f.status : undefined,
      });
      changed('listings', 'products', 'tasks');
      notify.info('Listing saved');
      return true;
    } catch {
      return false;
    } finally {
      setBusy('');
    }
  };
  const publish = async (): Promise<void> => {
    if (dirty && !(await save())) return;
    setBusy('publish');
    try {
      await op('listings.publish', { shop: l.shop.id, listings: [l.id] });
      changed('tasks', 'shops', 'listings');
      notify.info('Asked your AI agent to publish');
    } catch {
      /* op showed why */
    } finally {
      setBusy('');
    }
  };
  const setLive = async (st: 'paused' | 'live'): Promise<void> => {
    setBusy('status');
    try {
      await op('listings.status', { listing: l.id, status: st });
      changed('listings', 'products', 'tasks', 'shops');
      notify.info(st === 'paused' ? 'Paused' : 'Live again');
    } catch {
      /* op showed why */
    } finally {
      setBusy('');
    }
  };
  const remove = async (): Promise<void> => {
    const ok = await confirmAsk('Remove the ' + l.shop.name + ' listing?', 'It is not taken off ' + l.shop.name + ' itself.', 'Remove listing', { danger: true });
    if (!ok) return;
    try {
      await op('listings.remove', { listing: l.id });
      onClose();
      changed('listings', 'products', 'tasks');
      notify.info('Listing removed');
    } catch {
      /* op showed why */
    }
  };

  const menu: MenuItem[] = [];
  if (l.status === 'live') menu.push({ label: 'Pause', icon: Pause, onSelect: () => void setLive('paused') });
  if (l.status === 'paused') menu.push({ label: 'Live again', icon: Play, onSelect: () => void setLive('live') });
  menu.push({ label: 'Remove listing', icon: Trash2, danger: true, onSelect: () => void remove() });

  const platform = PLATFORM_NAME[l.shop.platform] ?? l.shop.name;

  return (
    <Drawer
      open
      onClose={onClose}
      width={560}
      title={
        <span className="flex min-w-0 items-center gap-2.5">
          <PlatformMark platform={l.shop.platform} size={28} onCard={false} />
          <span className="truncate">{l.shop.name}</span>
        </span>
      }
      subtitle={platform + ' listing, prices in ' + l.currency}
      actions={
        <>
          {l.url !== '' && (
            <Tip text={'Open on ' + l.shop.name}>
              <a href={l.url} target="_blank" rel="noreferrer" aria-label={'Open on ' + l.shop.name} className="hit flex size-[34px] items-center justify-center rounded-full bg-[var(--so-card)] text-[var(--so-ink)] shadow-[inset_0_0_0_1px_var(--so-border)] hover:bg-[var(--so-row-hover)]">
                <ExternalLink size={16} aria-hidden />
              </a>
            </Tip>
          )}
          <Menu items={menu} label={'More for the ' + l.shop.name + ' listing'} variant="card" size={34} />
        </>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={busy === 'save'} disabled={!dirty || priceBad || busy !== ''} onClick={() => void save()}>
            Save
          </Button>
          {editableStatus && (
            <Button variant="secondary" disabled={busy !== ''} onClick={() => onMarkLive(l)}>
              Mark as live
            </Button>
          )}
          {canPublish && (
            <Button variant="secondary" icon={Sparkles} loading={busy === 'publish'} disabled={busy !== '' || priceBad || publishTask !== null} onClick={() => void publish()}>
              Publish with your AI agent
            </Button>
          )}
        </div>
      }
    >
      <div className="grid gap-4">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <ListingPill status={l.status} blocking={l.blocking} />
            {l.needs_update && <Pill tone="warn">Changes not on the shop yet</Pill>}
            <TaskBadge task={publishTask} />
          </div>
          <div className="mt-3 border-t border-[var(--so-line)] pt-3">
          {l.issues.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--so-green-text)]">
              <CircleCheck size={16} aria-hidden />
              Passes every check for {platform}
            </p>
          ) : (
            <>
              <p className="mb-2 text-[12px] font-semibold text-[var(--so-muted)]">{blocking.length > 0 ? 'Fix before it goes live' : 'Worth fixing'}</p>
              <ul className="grid gap-1.5">
                {[...blocking, ...warnings].map((i) => (
                  <li key={i.level + i.field + i.text} className={cn('flex items-start gap-2 text-[13px] font-medium', i.level === 'blocking' ? 'text-[var(--so-red-text)]' : 'text-[var(--so-amber-text)]')}>
                    {i.level === 'blocking' ? <OctagonAlert size={15} className="mt-[2px] shrink-0" aria-hidden /> : <TriangleAlert size={15} className="mt-[2px] shrink-0" aria-hidden />}
                    <span>{i.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          </div>
        </Card>
        <Card className="grid gap-4">
          <Field label="Title" {...(titleMax > 0 ? { hint: <span className={cn('num', over && 'font-semibold text-[var(--so-red-text)]')}>{String(titleLen) + ' / ' + String(titleMax)}</span> } : {})} {...(over ? { error: platform + ' allows ' + String(titleMax) + ' characters' } : {})}>
            <TextInput value={f.title} placeholder={p.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-invalid={over || undefined} className={cn(over && 'ring-2 ring-[var(--so-red)]')} />
          </Field>
          <Field label="Description" hint={<span className="num">{num(chars(f.desc))} characters</span>}>
            <TextArea rows={8} value={f.desc} placeholder="Uses the product description when empty" onChange={(e) => setF({ ...f, desc: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={<HelpLabel label="Price" tip={"In the shop's currency (" + l.currency + ')'} />} {...(priceBad ? { error: 'Not a price' } : {})}>
              <TextInput prefix={currencySign(l.currency)} inputMode="decimal" placeholder="0.00" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
              {catalogPrice !== undefined && !priceBad && <span className="num mt-1 block text-[12px] font-medium text-[var(--so-muted)]">Catalog price {money(catalogPrice, p.currency)}</span>}
            </Field>
            {editableStatus && (
              <Labeled label={<HelpLabel label="Status" tip="Ready means checked and waiting to be published" />}>
                <Choice<Editable>
                  items={[
                    { key: 'draft', label: 'Draft' },
                    { key: 'ready', label: 'Ready' },
                  ]}
                  value={f.status}
                  onChange={(s) => setF({ ...f, status: s })}
                />
              </Labeled>
            )}
          </div>
          <Labeled label="Keywords" hint={f.keywords.length > 0 ? String(f.keywords.length) : undefined}>
            <ChipInput values={f.keywords} onChange={(k) => setF({ ...f, keywords: k })} label="Add keyword" placeholder="Add keywords, press Enter" />
          </Labeled>
        </Card>
      </div>
    </Drawer>
  );
}
