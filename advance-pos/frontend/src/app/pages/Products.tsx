/**
 * The catalog: products (with their variants, prices and stock), the
 * categories the sell screen is organised by, and option groups (milk,
 * toppings, sizes that cost extra). Products import from and export to CSV.
 */
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Download, Layers, Package, Pencil, Plus, Star, Tags, Trash2, Upload } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { abbreviation, toMinor } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { download } from '../lib/print.ts';
import { href, navigate, replaceQuery } from '../lib/router.ts';
import type { Category, ModifierGroup, Product } from '../lib/types.ts';
import { LoadMore, MoneyField, SearchField, SlotPicker, StockBadge, tile, useDebounced } from '../components/common.tsx';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { ImportDialog } from '../components/ImportDialog.tsx';
import { Button, Empty, Field, IconButton, Modal, PageHeader, Panel, Select, Tabs, Toggle, inputCls } from '../components/ui.tsx';

type Tab = 'products' | 'categories' | 'options';

const PRODUCT_COLUMNS = ['name', 'category', 'price', 'cost', 'sku', 'barcode', 'stock', 'low_at', 'tax', 'description', 'favorite', 'sold_by', 'unit', 'option1_name', 'option1_value', 'option2_name', 'option2_value', 'option3_name', 'option3_value'];

function Thumb({ p }: { p: Product }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  if (p.image !== '' && !broken) return <img src={p.image + '?thumb=160x160'} alt="" onError={() => setBroken(true)} className="size-8 shrink-0 rounded-[var(--ps-r)] object-cover" />;
  return (
    <span aria-hidden style={tile(p.color)} className="flex size-8 shrink-0 items-center justify-center rounded-[var(--ps-r)] text-[12px] font-bold">
      {abbreviation(p.name)}
    </span>
  );
}

function ProductList(): React.JSX.Element {
  const { money, catalog } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [stock, setStock] = useState('');
  const [archived, setArchived] = useState(false);
  const [pages, setPages] = useState(1);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const term = useDebounced(q, 250);
  useEffect(() => setPages(1), [term, cat, stock, archived]);
  const list = useLive(() => api.products({ q: term.trim() || undefined, category: cat || undefined, stock: stock || undefined, archived, limit: 100 * pages }), ['products', 'variants', 'categories'], [term, cat, stock, archived, pages]);
  const rows = list.data?.products ?? [];

  const toggleFavorite = async (p: Product): Promise<void> => {
    try {
      await api.saveProduct({ id: p.id, favorite: !p.favorite });
    } catch {
      // Shown by the transport.
    }
  };

  const exportAll = async (): Promise<void> => {
    setExporting(true);
    try {
      download(await api.exportProducts(archived));
    } catch {
      // Shown by the transport.
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Name, SKU or barcode" className="w-full sm:w-64" />
        <Select
          ariaLabel="Category"
          value={cat}
          onChange={setCat}
          className="w-44"
          options={[{ value: '', label: 'All categories' }, { value: 'none', label: 'No category' }, ...(catalog?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]}
        />
        <Select
          ariaLabel="Stock"
          value={stock}
          onChange={setStock}
          className="w-40"
          options={[
            { value: '', label: 'Any stock' },
            { value: 'low', label: 'Low or out' },
            { value: 'out', label: 'Out of stock' },
            { value: 'tracked', label: 'Stock counted' },
          ]}
        />
        <label className="flex items-center gap-2 text-[12px] font-semibold text-[var(--ps-ink-2)]">
          <Toggle checked={archived} onChange={setArchived} label="Show archived" />
          Archived
        </label>
        <span className="flex-1" />
        <Button icon={Upload} onClick={() => setImporting(true)}>
          Import
        </Button>
        <Button icon={Download} loading={exporting} onClick={() => void exportAll()}>
          Export
        </Button>
      </div>
      <Panel padded={false}>
        {list.loading && rows.length === 0 ? (
          <div className="py-10" />
        ) : rows.length === 0 ? (
          <Empty icon={Package} title={term !== '' || cat !== '' || stock !== '' ? 'No products match' : archived ? 'No archived products' : 'No products yet'} action={!archived && term === '' ? <Button variant="primary" icon={Plus} onClick={() => navigate('product', { id: 'new' })}>New product</Button> : undefined} compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="ps-table">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Product</th>
                  <th className="hidden md:table-cell">Category</th>
                  <th className="hidden lg:table-cell">SKU</th>
                  <th className="text-right">Price</th>
                  <th>Stock</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const live = p.variants.filter((v) => !v.archived);
                  return (
                    <tr key={p.id} className="cursor-pointer" onClick={() => navigate('product', { id: p.id })}>
                      <td>
                        <Thumb p={p} />
                      </td>
                      <td>
                        <a href={href('product', { id: p.id })} onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline">
                          {p.name}
                        </a>
                        {live.length > 1 && <span className="ml-2 text-[12px] text-[var(--ps-muted)]">{live.length} variants</span>}
                      </td>
                      <td className="hidden text-[var(--ps-ink-2)] md:table-cell">{p.category?.name ?? ''}</td>
                      <td className="mono hidden text-[var(--ps-ink-2)] lg:table-cell">{live.length === 1 ? (live[0]?.sku ?? '') : ''}</td>
                      <td className="num text-right font-semibold">
                        {money.fmt(p.price_min)}
                        {p.price_max !== p.price_min ? ' to ' + money.fmt(p.price_max) : ''}
                        {p.sold_by === 'weight' && p.unit !== '' ? ' / ' + p.unit : ''}
                      </td>
                      <td>
                        <StockBadge status={p.status} stock={p.stock} unit={p.unit} />
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={p.favorite ? 'Remove from favorites' : 'Add to favorites'}
                          title={p.favorite ? 'Remove from favorites' : 'Add to favorites'}
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleFavorite(p);
                          }}
                          className={cn('flex size-7 items-center justify-center rounded-[var(--ps-r)] hover:bg-[var(--ps-row-hover)]', p.favorite ? 'text-[var(--ps-amber-text)]' : 'text-[var(--ps-muted)]')}
                        >
                          <Star size={15} fill={p.favorite ? 'currentColor' : 'none'} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore more={list.data?.more === true} loading={list.loading} onMore={() => setPages((n) => n + 1)} />
      </Panel>
      <ImportDialog open={importing} onClose={() => setImporting(false)} title="Import products" columns={PRODUCT_COLUMNS} required={['name', 'price']} run={(csv, dry) => api.importProducts(csv, dry)} />
    </>
  );
}

/* ------------------------------------------------------------ categories */

function Categories(): React.JSX.Element {
  const list = useLive(() => api.categories(), ['categories', 'products'], []);
  const [edit, setEdit] = useState<Category | 'new' | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('neutral');
  const [busy, setBusy] = useState(false);
  const rows = list.data?.categories ?? [];

  useEffect(() => {
    if (edit === 'new') {
      setName('');
      setColor('neutral');
    } else if (edit !== null) {
      setName(edit.name);
      setColor(edit.color);
    }
  }, [edit]);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.saveCategory({ id: edit !== 'new' && edit !== null ? edit.id : undefined, name: name.trim(), color });
      setEdit(null);
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };

  const move = async (i: number, dir: -1 | 1): Promise<void> => {
    const a = rows[i];
    const b = rows[i + dir];
    if (a === undefined || b === undefined) return;
    try {
      // Number every category in the new order so ties cannot remain.
      const order = [...rows];
      order[i] = b;
      order[i + dir] = a;
      await Promise.all(order.map((c, k) => (c.sort !== k ? api.saveCategory({ id: c.id, sort: k }) : Promise.resolve(null))));
    } catch {
      // Shown by the transport.
    }
  };

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setEdit('new')}>
          New category
        </Button>
      </div>
      <Panel padded={false}>
        {rows.length === 0 ? (
          <Empty icon={Tags} title="No categories yet" compact>
            Categories are the tabs on the sell screen.
          </Empty>
        ) : (
          <ul className="divide-y divide-[var(--ps-hair)]">
            {rows.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: `var(--ps-dot-${c.color})` }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{c.name}</span>
                  <span className="block text-[12px] text-[var(--ps-muted)]">{c.products ?? 0} products</span>
                </span>
                <IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => void move(i, -1)} />
                <IconButton icon={ArrowDown} label="Move down" disabled={i === rows.length - 1} onClick={() => void move(i, 1)} />
                <IconButton icon={Pencil} label={'Edit ' + c.name} onClick={() => setEdit(c)} />
                <DeleteButton collection="categories" id={c.id} name={c.name} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Modal
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit === 'new' ? 'New category' : 'Edit category'}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" icon={Check} loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() !== '') void save();
          }}
        >
          <Field label="Name">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Field group label="Color">
            <SlotPicker value={color} onChange={setColor} />
          </Field>
        </form>
      </Modal>
    </>
  );
}

/* --------------------------------------------------------- option groups */

interface OptionRow {
  id?: string;
  name: string;
  price: string;
}

function OptionGroups(): React.JSX.Element {
  const { money } = useStore();
  const list = useLive(() => api.modifiers(), ['modifier_groups'], []);
  const [edit, setEdit] = useState<ModifierGroup | 'new' | null>(null);
  const [name, setName] = useState('');
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(1);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const rows = list.data?.modifier_groups ?? [];

  useEffect(() => {
    if (edit === 'new') {
      setName('');
      setMin(0);
      setMax(1);
      setOptions([{ name: '', price: '' }]);
    } else if (edit !== null) {
      setName(edit.name);
      setMin(edit.min);
      setMax(edit.max);
      setOptions(edit.options.map((o) => ({ id: o.id, name: o.name, price: o.price === 0 ? '' : money.plain(o.price) })));
    }
  }, [edit, money]);

  const clean = options.filter((o) => o.name.trim() !== '');
  const pricesOk = clean.every((o) => o.price.trim() === '' || toMinor(o.price, money.digits) !== null);
  const rulesOk = min >= 0 && (max === 0 || max >= Math.max(min, 1)) && min <= clean.length;
  const ok = name.trim() !== '' && clean.length > 0 && pricesOk && rulesOk;

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.saveModifiers({ id: edit !== 'new' && edit !== null ? edit.id : undefined, name: name.trim(), min, max, options: clean.map((o) => ({ id: o.id, name: o.name.trim(), price: o.price.trim() === '' ? '0' : o.price.trim() })) });
      setEdit(null);
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setEdit('new')}>
          New option group
        </Button>
      </div>
      <Panel padded={false}>
        {rows.length === 0 ? (
          <Empty icon={Layers} title="No option groups yet" compact>
            Choices sold with a product, such as milk or toppings, with their own prices.
          </Empty>
        ) : (
          <ul className="divide-y divide-[var(--ps-hair)]">
            {rows.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{g.name}</span>
                  <span className="block truncate text-[12px] text-[var(--ps-muted)]">
                    {g.min > 0 ? 'Required' : 'Optional'}
                    {g.max > 0 ? ', up to ' + g.max : ', any number'} &middot; {g.options.map((o) => o.name + (o.price !== 0 ? ' ' + money.signed(o.price) : '')).join(', ')}
                  </span>
                </span>
                <IconButton icon={Pencil} label={'Edit ' + g.name} onClick={() => setEdit(g)} />
                <DeleteButton collection="modifier_groups" id={g.id} name={g.name} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Modal
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit === 'new' ? 'New option group' : 'Edit option group'}
        wide
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" icon={Check} loading={busy} disabled={!ok} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_96px_96px] gap-2">
            <Field label="Name">
              <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Milk" />
            </Field>
            <Field label="Choose at least">
              <input className={inputCls + ' num text-right'} inputMode="numeric" value={String(min)} onChange={(e) => setMin(Number(e.target.value.replace(/\D/g, '') || '0'))} />
            </Field>
            <Field label="At most" hint="0 for any">
              <input className={inputCls + ' num text-right'} inputMode="numeric" value={String(max)} onChange={(e) => setMax(Number(e.target.value.replace(/\D/g, '') || '0'))} />
            </Field>
          </div>
          {!rulesOk && <p className="text-[12px] font-semibold text-[var(--ps-red-text)]">At most must be 0 (any) or at least the minimum, and the minimum cannot be more than the options.</p>}
          <div>
            <p className="mb-1 text-[12px] font-semibold text-[var(--ps-ink-2)]">Options</p>
            <ul className="flex flex-col gap-1.5">
              {options.map((o, i) => (
                <li key={o.id ?? 'n' + i} className="flex items-center gap-2">
                  <input className={inputCls + ' flex-1'} value={o.name} onChange={(e) => setOptions(options.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} placeholder="Oat" maxLength={60} aria-label="Option name" />
                  <MoneyField value={o.price} onChange={(v) => setOptions(options.map((x, k) => (k === i ? { ...x, price: v } : x)))} money={money} label="Extra price" placeholder="0" className="w-28" allowNegative />
                  <IconButton icon={Trash2} label="Remove this option" variant="danger" onClick={() => setOptions(options.filter((_, k) => k !== i))} disabled={options.length === 1} />
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" icon={Plus} className="mt-1.5" onClick={() => setOptions([...options, { name: '', price: '' }])}>
              Add an option
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function ProductsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>((query.get('tab') as Tab | null) ?? 'products');
  useEffect(() => replaceQuery('products', { tab: tab === 'products' ? '' : tab }), [tab]);
  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="What you sell, how it is grouped and the options sold with it"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => navigate('product', { id: 'new' })}>
            New product
          </Button>
        }
      />
      <Tabs
        label="Catalog"
        value={tab}
        onChange={setTab}
        className="mb-3 px-0"
        options={[
          { value: 'products', label: 'Products' },
          { value: 'categories', label: 'Categories' },
          { value: 'options', label: 'Option groups' },
        ]}
      />
      {tab === 'products' ? <ProductList /> : tab === 'categories' ? <Categories /> : <OptionGroups />}
    </div>
  );
}

/** Toast after saving a product: what the server noted (variants archived, a category made). */
export function noteSaved(name: string, notes: string[]): void {
  toast.success(notes.length > 0 ? 'Saved ' + name + ': ' + notes.join('; ') : 'Saved ' + name);
}
