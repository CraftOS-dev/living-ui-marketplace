/**
 * The catalog's supporting lists, each as cards on the shell: categories
 * (color, line icon, whether their products go to the kitchen, order), option
 * groups (Milk, Size, Add-ons: the rule and the options with their prices,
 * which may be negative), and preset discounts the counter offers. A card
 * opens its editor in a dialog.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Banknote, ChefHat, Pencil, Percent, Plus, SlidersHorizontal, Tags, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { majorText, money, parseMoney, parsePercent, percent } from '../../lib/format.ts';
import { ICON_NAMES, catVars, iconFor } from '../../lib/icons.tsx';
import type { Category, Discount, ModifierGroup } from '../../lib/types.ts';
import { Badge, Button, Card, Empty, Field, IconBadge, IconButton, Modal, Segmented, TextField, Toggle, inputCls, rowCls, useConfirm } from '../ui.tsx';
import { ColorPicker, MoneyField } from './ProductEditor.tsx';

/** A white block inside a dialog. */
const subCard = 'ps-on-card rounded-[22px] bg-[var(--ps-card)] p-4';
/** The name on a card opens it: its click area covers the whole card. */
const cardOpener = 'block max-w-full truncate text-left text-[15px] font-bold leading-[22px] outline-none after:absolute after:inset-0 after:rounded-[24px] after:ring-[var(--ps-ink)] focus-visible:after:ring-2';
const cardCls = 'ps-on-card relative flex h-full flex-col gap-4 rounded-[24px] bg-[var(--ps-card)] p-5 transition-transform hover:-translate-y-0.5';
const invalid = 'ring-2 ring-[var(--ps-red)]';

/** What a list is, and the pill that adds to it. */
function ListHead({ title, subtitle, action }: { title: string; subtitle: string; action: ReactNode }): React.JSX.Element {
  return (
    <div className="ps-rise ps-d1 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold leading-[22px]">{title}</h2>
        <p className="mt-0.5 text-[13px] text-[var(--ps-muted)]">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function stagger(i: number): string {
  return `ps-rise ps-d${Math.min(5, (i % 5) + 1)}`;
}

/* ------------------------------------------------------------ categories */

function CategoryDialog({ cat, onClose }: { cat: Category | null; onClose: () => void }): React.JSX.Element {
  const { catalog } = useApp();
  const [name, setName] = useState(cat?.name ?? '');
  const [color, setColor] = useState(cat?.color ?? (((catalog?.categories.length ?? 0) % 8) + 1));
  const [icon, setIcon] = useState(cat?.icon ?? 'tag');
  const [kitchen, setKitchen] = useState(cat?.kitchen ?? false);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      if (cat === null) await api.addCategory({ name: name.trim(), color, icon, kitchen });
      else await api.updateCategory({ category: cat.id, name: name.trim(), color, icon, kitchen });
      toast.success(cat === null ? `Added ${name.trim()}` : 'Saved');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const c = catVars(color);
  const Picked = iconFor(icon);
  return (
    <Modal
      open
      onClose={onClose}
      title={cat === null ? 'New category' : `Edit ${cat.name}`}
      wide
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={name.trim() === ''} loading={busy} onClick={() => void save()}>
            {cat === null ? 'Add category' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className={cn(subCard, 'flex items-end gap-3')}>
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ background: c.soft, color: c.text }}>
            <Picked size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <TextField label="Name" value={name} onChange={setName} autoFocus maxLength={40} onEnter={() => void save()} />
          </div>
        </div>
        <div className={subCard}>
          <Field label="Color">
            <ColorPicker value={color} onChange={setColor} allowNone={false} noneLabel="" />
          </Field>
        </div>
        <div className={subCard}>
          <Field label="Icon">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5">
              {ICON_NAMES.map((n) => {
                const I = iconFor(n);
                const on = n === icon;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={n}
                    title={n}
                    aria-pressed={on}
                    onClick={() => setIcon(n)}
                    style={on ? { background: c.soft, color: c.text } : undefined}
                    className={cn('ps-press flex aspect-square items-center justify-center rounded-full', on ? 'ring-2 ring-[var(--ps-ink)]' : 'bg-[var(--ps-row)] text-[var(--ps-ink)] hover:bg-[var(--ps-row-hover)]')}
                  >
                    <I size={17} strokeWidth={1.9} aria-hidden />
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <label className={cn(subCard, 'flex cursor-pointer items-center justify-between gap-3 text-[13px] font-semibold')}>
          <span className="flex min-w-0 items-center gap-3">
            <IconBadge icon={ChefHat} size={36} /> Its products go to the kitchen screen
          </span>
          <Toggle checked={kitchen} onChange={setKitchen} label="Kitchen" />
        </label>
      </div>
    </Modal>
  );
}

export function CategoriesTab(): React.JSX.Element {
  const { catalog } = useApp();
  const cats = catalog?.categories ?? [];
  const [editing, setEditing] = useState<Category | null | 'new'>(null);
  const [confirmEl, confirm] = useConfirm();
  const move = async (i: number, d: -1 | 1): Promise<void> => {
    const ids = cats.map((c) => c.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const a = ids[i];
    const b = ids[j];
    if (a === undefined || b === undefined) return;
    ids[i] = b;
    ids[j] = a;
    try {
      await api.reorderCategories(ids);
    } catch {
      /* toasted */
    }
  };
  const remove = async (c: Category): Promise<void> => {
    const ok = await confirm(c.products > 0 ? `${c.products === 1 ? 'Its product stays' : `Its ${c.products} products stay`}, without a category.` : 'It has no products.', `Delete ${c.name}?`, 'Delete');
    if (!ok) return;
    try {
      await api.deleteCategory(c.id);
      toast.success(`Deleted ${c.name}`);
    } catch {
      /* toasted */
    }
  };
  return (
    <>
      <ListHead
        title="Categories"
        subtitle="Their order is the order of the register's tabs"
        action={
          <Button variant="primary" icon={Plus} dot onClick={() => setEditing('new')}>
            New category
          </Button>
        }
      />
      {cats.length === 0 ? (
        <Card>
          <Empty
            icon={Tags}
            title="No categories yet"
            action={
              <Button variant="primary" icon={Plus} dot onClick={() => setEditing('new')}>
                New category
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cats.map((c, i) => {
            const I = iconFor(c.icon);
            const v = catVars(c.color);
            return (
              <li key={c.id} className={stagger(i)}>
                <div className={cardCls}>
                  <div className="flex items-start justify-between gap-2">
                    <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ background: v.soft, color: v.text }}>
                      <I size={19} />
                    </span>
                    <div className="relative z-10 flex shrink-0 items-center gap-1">
                      <IconButton icon={ArrowUp} label="Move up" variant="secondary" size={36} disabled={i === 0} onClick={() => void move(i, -1)} />
                      <IconButton icon={ArrowDown} label="Move down" variant="secondary" size={36} disabled={i === cats.length - 1} onClick={() => void move(i, 1)} />
                      <IconButton icon={Trash2} label={`Delete ${c.name}`} variant="danger" size={36} onClick={() => void remove(c)} />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <button type="button" onClick={() => setEditing(c)} className={cardOpener}>
                      {c.name}
                    </button>
                    <div className="mt-1 flex min-h-7 flex-wrap items-center gap-2 text-[12px] text-[var(--ps-muted)]">
                      <span className="whitespace-nowrap">{c.products === 1 ? '1 product' : `${c.products} products`}</span>
                      {c.kitchen && (
                        <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--ps-row)] px-3 font-semibold text-[var(--ps-ink-2)]">
                          <ChefHat size={13} aria-hidden /> Kitchen
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing !== null && <CategoryDialog cat={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {confirmEl}
    </>
  );
}

/* ------------------------------------------------------------ option groups */

interface OptionRow {
  id: string;
  name: string;
  price: string;
  is_default: boolean;
  available: boolean;
}

/** The columns of an option row on wide dialogs: name, price, default, for sale, remove. */
const optionGrid = 'sm:grid-cols-[minmax(0,1fr)_112px_60px_60px_40px]';
const optionInput = cn(inputCls, 'bg-[var(--ps-card)] px-4');

function GroupDialog({ group, onClose }: { group: ModifierGroup | null; onClose: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const [name, setName] = useState(group?.name ?? '');
  const [min, setMin] = useState(String(group?.min ?? 0));
  const [max, setMax] = useState(String(group?.max ?? 1));
  const [rows, setRows] = useState<OptionRow[]>(
    group?.options.map((o) => ({ id: o.id, name: o.name, price: o.price === 0 ? '' : majorText(o.price, exp), is_default: o.is_default, available: o.available })) ?? [
      { id: '', name: '', price: '', is_default: false, available: true },
      { id: '', name: '', price: '', is_default: false, available: true },
    ],
  );
  const [busy, setBusy] = useState(false);
  const filled = rows.filter((r) => r.name.trim() !== '');
  const badPrice = filled.some((r) => r.price.trim() !== '' && parseMoney(r.price, exp, true) === null);
  const save = async (): Promise<void> => {
    setBusy(true);
    const options = filled.map((r) => ({ ...(r.id !== '' ? { id: r.id } : {}), name: r.name.trim(), price: r.price.trim() === '' ? '0' : r.price.trim(), is_default: r.is_default, available: r.available }));
    try {
      if (group === null) await api.addGroup({ name: name.trim(), min, max, options });
      else await api.updateGroup({ group: group.id, name: name.trim(), min, max, options });
      toast.success(group === null ? `Added ${name.trim()}` : 'Saved');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const rule = (m: string, x: string): string => {
    const a = Number(m);
    const b = Number(x);
    if (a === 1 && b === 1) return 'Pick exactly 1';
    if (a === 0 && b === 0) return 'Pick any';
    if (a === 0) return `Optional, up to ${b}`;
    if (b === 0) return `At least ${a}`;
    return `Pick ${a} to ${b}`;
  };
  const patch = (i: number, p: Partial<OptionRow>): void => setRows(rows.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <Modal
      open
      onClose={onClose}
      title={group === null ? 'New option group' : `Edit ${group.name}`}
      wide
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={name.trim() === '' || filled.length === 0 || badPrice} loading={busy} onClick={() => void save()}>
            {group === null ? 'Add group' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className={cn(subCard, 'flex flex-col gap-3')}>
          <TextField label="Name" value={name} onChange={setName} autoFocus maxLength={40} placeholder="Milk" />
          <div className="grid grid-cols-1 items-end gap-3 min-[420px]:grid-cols-2">
            <TextField label="Must pick" value={min} onChange={(v) => setMin(v.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" />
            <TextField label="May pick (0: any number)" value={max} onChange={(v) => setMax(v.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" />
          </div>
          <Badge tone="neutral" className="self-start">
            {rule(min || '0', max || '0')}
          </Badge>
        </div>
        <div className={cn(subCard, 'flex flex-col gap-2 p-3 sm:p-4')}>
          <div className={cn('hidden gap-2 px-2 text-[12px] font-semibold text-[var(--ps-ink-2)] sm:grid', optionGrid)}>
            <span className="px-1">Option</span>
            <span className="px-1">Price (+ or −)</span>
            <span className="text-center">Default</span>
            <span className="text-center">For sale</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className={cn(rowCls, 'grid grid-cols-[minmax(0,1fr)_40px] items-center gap-2 p-2', optionGrid)}>
              <input value={r.name} maxLength={40} placeholder="Oat milk" aria-label="Option name" onChange={(e) => patch(i, { name: e.target.value })} className={cn(optionInput, 'order-1 sm:order-none')} />
              <input
                value={r.price}
                inputMode="decimal"
                placeholder={money(0, currency, exp)}
                aria-label="Option price"
                onChange={(e) => patch(i, { price: e.target.value })}
                className={cn(optionInput, 'num order-3 col-span-2 px-4 text-right sm:order-none sm:col-span-1 sm:px-3', r.price.trim() !== '' && parseMoney(r.price, exp, true) === null && invalid)}
              />
              <div className="order-4 col-span-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-2 pb-1 sm:order-none sm:contents">
                <span className="flex items-center justify-center gap-2 text-[12px] font-semibold text-[var(--ps-ink-2)]">
                  <span className="sm:hidden">Default</span>
                  <Toggle checked={r.is_default} onChange={(v) => patch(i, { is_default: v })} label="Picked by default" />
                </span>
                <span className="flex items-center justify-center gap-2 text-[12px] font-semibold text-[var(--ps-ink-2)]">
                  <span className="sm:hidden">For sale</span>
                  <Toggle checked={r.available} onChange={(v) => patch(i, { available: v })} label="For sale" />
                </span>
              </div>
              <IconButton icon={Trash2} label="Remove this option" variant="light" className="order-2 hover:bg-[var(--ps-row-hover)] hover:text-[var(--ps-red-text)] sm:order-none" onClick={() => setRows(rows.filter((_, k) => k !== i))} />
            </div>
          ))}
          <Button icon={Plus} className="self-start" onClick={() => setRows([...rows, { id: '', name: '', price: '', is_default: false, available: true }])}>
            Another option
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function OptionsTab(): React.JSX.Element {
  const { catalog, currency, exp } = useApp();
  const groups = catalog?.groups ?? [];
  const [editing, setEditing] = useState<ModifierGroup | null | 'new'>(null);
  const [confirmEl, confirm] = useConfirm();
  const remove = async (g: ModifierGroup): Promise<void> => {
    const ok = await confirm(g.products > 0 ? `It is taken off ${g.products === 1 ? 'the product that offers it' : `the ${g.products} products that offer it`}.` : 'No product offers it.', `Delete ${g.name}?`, 'Delete');
    if (!ok) return;
    try {
      await api.deleteGroup(g.id);
      toast.success(`Deleted ${g.name}`);
    } catch {
      /* toasted */
    }
  };
  const flip = async (id: string, available: boolean): Promise<void> => {
    try {
      await api.setOptionAvailable(id, available);
    } catch {
      /* toasted */
    }
  };
  return (
    <>
      <ListHead
        title="Options"
        subtitle="Choices offered with products: milk, sizes of a side, add-ons"
        action={
          <Button variant="primary" icon={Plus} dot onClick={() => setEditing('new')}>
            New option group
          </Button>
        }
      />
      {groups.length === 0 ? (
        <Card>
          <Empty
            icon={SlidersHorizontal}
            title="No option groups yet"
            action={
              <Button variant="primary" icon={Plus} dot onClick={() => setEditing('new')}>
                New option group
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {groups.map((g, i) => (
            <li key={g.id} className={stagger(i)}>
              <div className="ps-on-card flex h-full flex-col gap-4 rounded-[24px] bg-[var(--ps-card)] p-5">
                <div className="flex items-start gap-2">
                  <button type="button" onClick={() => setEditing(g)} className="min-w-0 flex-1 rounded-[14px] text-left outline-none ring-[var(--ps-ink)] ring-offset-4 ring-offset-[var(--ps-card)] focus-visible:ring-2">
                    <span className="block truncate text-[15px] font-bold leading-[22px]">{g.name}</span>
                    <span className="mt-0.5 block text-[13px] text-[var(--ps-muted)]">
                      {g.min > 0 ? `Must pick ${g.min}` : 'Optional'}
                      {g.max > 0 ? `, up to ${g.max}` : ''} · {g.products === 1 ? '1 product' : `${g.products} products`}
                    </span>
                  </button>
                  <IconButton icon={Pencil} label="Edit" variant="secondary" size={36} onClick={() => setEditing(g)} />
                  <IconButton icon={Trash2} label={`Delete ${g.name}`} variant="danger" size={36} onClick={() => void remove(g)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => void flip(o.id, !o.available)}
                      title={o.available ? 'Mark as sold out' : 'Back in stock'}
                      className={cn('ps-press flex min-h-10 max-w-full items-center gap-2 rounded-full bg-[var(--ps-row)] py-1.5 pl-4 text-[13px] font-semibold hover:bg-[var(--ps-row-hover)]', o.is_default || !o.available ? 'pr-1.5' : 'pr-4', !o.available && 'text-[var(--ps-ink-2)]')}
                    >
                      <span className={cn('truncate', !o.available && 'line-through')}>{o.name}</span>
                      {o.price !== 0 && <span className="num shrink-0 font-medium text-[var(--ps-ink-2)]">{`${o.price > 0 ? '+' : ''}${money(o.price, currency, exp)}`}</span>}
                      {o.is_default && (
                        <Badge tone="neutral" className="bg-[var(--ps-card)]">
                          Default
                        </Badge>
                      )}
                      {!o.available && (
                        <Badge tone="bad" className="bg-[var(--ps-card)]">
                          Sold out
                        </Badge>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== null && <GroupDialog group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {confirmEl}
    </>
  );
}

/* ------------------------------------------------------------ discounts */

function DiscountEditor({ d, onClose }: { d: Discount | null; onClose: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const [name, setName] = useState(d?.name ?? '');
  const [kind, setKind] = useState<'percent' | 'amount'>(d?.kind ?? 'percent');
  const [value, setValue] = useState(d !== null ? d.value_text : '');
  const [scope, setScope] = useState<'order' | 'item'>(d?.scope ?? 'order');
  const [busy, setBusy] = useState(false);
  const ok = name.trim() !== '' && (kind === 'percent' ? (parsePercent(value) ?? 0) > 0 : (parseMoney(value, exp) ?? 0) > 0);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      if (d === null) await api.addDiscount({ name: name.trim(), kind, value: value.trim(), scope });
      else await api.updateDiscount({ discount: d.id, name: name.trim(), kind, value: value.trim(), scope });
      toast.success(d === null ? `Added ${name.trim()}` : 'Saved');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={d === null ? 'New discount' : `Edit ${d.name}`}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok} loading={busy} onClick={() => void save()}>
            {d === null ? 'Add discount' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className={subCard}>
          <TextField label="Name" value={name} onChange={setName} autoFocus maxLength={40} placeholder="Staff" />
        </div>
        <div className={cn(subCard, 'flex flex-col gap-4')}>
          <Field label="Kind">
            <Segmented
              label="Kind"
              className="self-start"
              value={kind}
              onChange={(k) => {
                setKind(k);
                setValue('');
              }}
              options={[
                { value: 'percent', label: 'Percent', icon: Percent },
                { value: 'amount', label: 'Amount' },
              ]}
            />
          </Field>
          {kind === 'percent' ? <TextField label="Percent off" value={value} onChange={setValue} inputMode="decimal" placeholder="10" /> : <MoneyField label="Amount off" value={value} onChange={setValue} currency={currency} exp={exp} />}
        </div>
        <div className={subCard}>
          <Field label="On">
            <Segmented
              label="On"
              className="self-start"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'order', label: 'The whole order' },
                { value: 'item', label: 'One item' },
              ]}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function DiscountsTab(): React.JSX.Element {
  const { catalog, currency, exp } = useApp();
  const list = catalog?.discounts ?? [];
  const [editing, setEditing] = useState<Discount | null | 'new'>(null);
  const [confirmEl, confirm] = useConfirm();
  const remove = async (d: Discount): Promise<void> => {
    const ok = await confirm('Past sales keep the discount they had.', `Delete ${d.name}?`, 'Delete');
    if (!ok) return;
    try {
      await api.deleteDiscount(d.id);
      toast.success(`Deleted ${d.name}`);
    } catch {
      /* toasted */
    }
  };
  return (
    <>
      <ListHead
        title="Discounts"
        subtitle="Ready-made discounts on the register's Discount button"
        action={
          <Button variant="primary" icon={Plus} dot onClick={() => setEditing('new')}>
            New discount
          </Button>
        }
      />
      {list.length === 0 ? (
        <Card>
          <Empty
            icon={Percent}
            title="No discounts yet"
            action={
              <Button variant="primary" icon={Plus} dot onClick={() => setEditing('new')}>
                New discount
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {list.map((d, i) => (
            <li key={d.id} className={stagger(i)}>
              <div className={cardCls}>
                <div className="flex items-start justify-between gap-2">
                  <IconBadge icon={d.kind === 'percent' ? Percent : Banknote} size={44} />
                  <IconButton icon={Trash2} label={`Delete ${d.name}`} variant="danger" size={36} className="relative z-10" onClick={() => void remove(d)} />
                </div>
                <div className="min-w-0">
                  <button type="button" onClick={() => setEditing(d)} className={cardOpener}>
                    {d.name}
                  </button>
                  <p className="num mt-1 text-[13px] text-[var(--ps-muted)]">
                    {d.kind === 'percent' ? percent(d.value) : money(d.value, currency, exp)} off {d.scope === 'order' ? 'the whole order' : 'one item'}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== null && <DiscountEditor d={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {confirmEl}
    </>
  );
}
