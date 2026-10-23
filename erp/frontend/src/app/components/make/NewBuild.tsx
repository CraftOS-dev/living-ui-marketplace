/**
 * Plan a build: choose what to make (its bill of materials), how many and
 * where. Every component shows what the build needs against what that
 * warehouse holds, shortages in red, with the estimated cost. "Plan build"
 * saves a draft to complete when it is made.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Factory, Layers, Warehouse as WarehouseIcon } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { errMessage, op } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { decimalsOf, money, normalizeNumber, plain, price, qty } from '../../lib/format.ts';
import type { BomDetail, BomList, BuildDetail, LevelList, WarehouseList } from '../../lib/types/stock.ts';
import { ProgressBar, Stepper } from '../controls.tsx';
import { ScreenBar, useFullScreen } from '../FullScreen.tsx';
import { DateField } from '../pickers.tsx';
import { Card, Field, Notice, PillButton, PillSelect, Skeleton, softInput } from '../ui.tsx';

export interface NewBuildPreset {
  bom?: string | undefined;
  item?: string | undefined;
}

export function useNewBuild(opts: { onCreated: (b: BuildDetail) => void; onClosed?: (() => void) | undefined }): { open: (from: Element | null, preset?: NewBuildPreset) => void; node: React.ReactNode } {
  const [state, setState] = useState<{ n: number; preset: NewBuildPreset }>({ n: 0, preset: {} });
  const fs = useFullScreen(opts.onClosed);
  const open = (from: Element | null, preset: NewBuildPreset = {}): void => {
    setState((s) => ({ n: s.n + 1, preset }));
    fs.open(from);
  };
  const node = fs.node(
    <NewBuildScreen
      key={state.n}
      preset={state.preset}
      onClose={fs.close}
      onCreated={(b) => {
        fs.close();
        opts.onCreated(b);
      }}
    />,
    { title: 'New build' },
  );
  return { open, node };
}

function NewBuildScreen({ preset, onClose, onCreated }: { preset: NewBuildPreset; onClose: () => void; onCreated: (b: BuildDetail) => void }): React.JSX.Element {
  const [boms, setBoms] = useState<BomList['boms'] | null>(null);
  const [whs, setWhs] = useState<WarehouseList['warehouses']>([]);
  const [bomId, setBomId] = useState(preset.bom ?? '');
  const [bom, setBom] = useState<BomDetail | null>(null);
  const [warehouse, setWarehouse] = useState('');
  const [levels, setLevels] = useState<Map<string, number> | null>(null);
  const [count, setCount] = useState('1');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    op<BomList>('boms.list', {}, { quiet: true })
      .then((r) => {
        const active = r.boms.filter((b) => b.active);
        setBoms(active);
        setBomId((cur) => {
          if (cur !== '') return cur;
          const forItem = preset.item !== undefined ? active.find((b) => b.item?.id === preset.item) : undefined;
          return forItem?.id ?? (active.length === 1 ? (active[0]?.id ?? '') : '');
        });
      })
      .catch((e: unknown) => setError(errMessage(e)));
    op<WarehouseList>('warehouses.list', {}, { quiet: true })
      .then((r) => setWhs(r.warehouses.filter((w) => !w.archived)))
      .catch(() => undefined);
  }, [preset.item]);

  // The chosen bill of materials, and the warehouse that can build the most.
  useEffect(() => {
    if (bomId === '') {
      setBom(null);
      return;
    }
    let live = true;
    op<BomDetail>('boms.get', { bom: bomId }, { quiet: true })
      .then((b) => {
        if (!live) return;
        setBom(b);
        setCount(plain(Math.max(b.step, b.output_qty)));
        setWarehouse((cur) => {
          if (cur !== '') return cur;
          const best = [...b.can_build].sort((x, y) => y.qty - x.qty)[0];
          return best !== undefined && best.qty > 0 ? best.warehouse.id : (b.can_build.find((w) => w.default)?.warehouse.id ?? b.can_build[0]?.warehouse.id ?? '');
        });
      })
      .catch((e: unknown) => {
        if (live) setError(errMessage(e));
      });
    return () => {
      live = false;
    };
  }, [bomId]);

  useEffect(() => {
    if (warehouse === '') return;
    let live = true;
    setLevels(null);
    op<LevelList>('stock.levels', { warehouse, limit: 1000 }, { quiet: true })
      .then((r) => {
        if (live) setLevels(new Map(r.levels.map((l) => [l.item.id, l.qty])));
      })
      .catch(() => {
        if (live) setLevels(new Map());
      });
    return () => {
      live = false;
    };
  }, [warehouse]);

  const n = Number(normalizeNumber(count, 3) ?? 'NaN');
  const valid = Number.isFinite(n) && n > 0;
  const comps = useMemo(() => {
    if (bom === null) return [];
    return bom.components.map((c) => {
      const need = valid ? Math.round(((n * c.qty) / bom.output_qty) * 1000) / 1000 : 0;
      const have = c.item !== null ? (levels?.get(c.item.id) ?? 0) : 0;
      return { c, need, have, short: Math.max(0, Math.round((need - have) * 1000) / 1000) };
    });
  }, [bom, n, valid, levels]);
  const shortCount = comps.filter((x) => x.short > 0).length;
  const cur = bom?.currency ?? 'USD';
  const scale = 10 ** decimalsOf(cur);
  const compCost = comps.reduce((s, x) => s + Math.round((x.need * x.c.avg_cost_e4 * scale) / 10000), 0);
  const extraCost = bom !== null && valid ? Math.round((n * bom.extra_cost_e4 * scale) / 10000) : 0;
  const step = bom?.step ?? 1;
  const offStep = valid && step > 0 && Math.abs(Math.round(n / step) * step - n) > 1e-9;
  const canHere = bom?.can_build.find((w) => w.warehouse.id === warehouse)?.qty ?? null;

  const save = async (): Promise<void> => {
    if (bom === null || !valid || warehouse === '') return;
    setBusy(true);
    setError(null);
    try {
      const r = await op<BuildDetail>('builds.create', { bom: bom.id, qty: normalizeNumber(count, 3) ?? count, warehouse, date, note: note.trim() === '' ? undefined : note.trim() }, { quiet: true });
      toast.success(`${r.number} planned`);
      onCreated(r);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const unit = bom?.item?.unit ?? '';
  return (
    <div className="pb-28 md:pb-12">
      <ScreenBar title="New build" sub={bom?.item?.name} onClose={onClose} />
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-5 px-4 @min-[640px]:px-8 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex flex-col gap-5 @min-[900px]:col-span-5">
          <Card delay={1}>
            <h2 className="mb-4 text-[15px] font-bold">What to make</h2>
            {boms === null ? (
              // When the list fails, the error shows by the buttons below.
              error === null ? <Skeleton className="h-11" rounded="rounded-full" /> : <p className="text-[13px] text-[var(--erp-muted)]">The bills of materials did not load.</p>
            ) : boms.length === 0 ? (
              <Notice tone="neutral" icon={Layers}>
                There is no bill of materials in use yet. Add one first, so a build knows what it takes.
              </Notice>
            ) : boms.length <= 6 ? (
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Bill of materials">
                {boms.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={bomId === b.id}
                    onClick={() => {
                      setBomId(b.id);
                      setWarehouse('');
                    }}
                    className={cn('flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-left transition-colors', bomId === b.id ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]')}
                  >
                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', bomId === b.id ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]' : 'bg-[var(--erp-card)]')}>
                      <Factory size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold">{b.item?.name ?? b.name}</span>
                      <span className={cn('block truncate text-[12px]', bomId === b.id ? 'text-[var(--erp-shell)]/70' : 'text-[var(--erp-muted)]')}>{b.name !== b.item?.name ? b.name : `${b.lines_count} components`}</span>
                    </span>
                    <span className="num text-[13px] font-bold">{price(b.unit_cost, b.currency)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <PillSelect soft ariaLabel="Bill of materials" value={bomId} onChange={(v) => setBomId(v)} options={[{ value: '', label: 'Choose what to make' }, ...boms.map((b) => ({ value: b.id, label: b.item?.name !== undefined && b.item.name !== b.name ? `${b.item.name} (${b.name})` : b.name }))]} />
            )}
          </Card>

          {bom !== null && (
            <Card delay={2}>
              <div className="flex flex-col gap-4">
                <Field label="How many" hint={step > 1 ? `In multiples of ${qty(step)} (one batch makes ${qty(bom.output_qty)})` : canHere !== null ? `${qty(canHere)} ${unit} can be built here now` : undefined} error={offStep ? `Build a multiple of ${qty(step)}` : null}>
                  <Stepper value={count} onChange={setCount} fractional={bom.item?.fractional === true} min={0} ariaLabel="how many to build" className="self-start" />
                </Field>
                <Field label="Where">
                  <div className="flex flex-wrap gap-2">
                    {whs.map((w) => {
                      const cb = bom.can_build.find((x) => x.warehouse.id === w.id);
                      return (
                        <button
                          key={w.id}
                          type="button"
                          aria-pressed={warehouse === w.id}
                          onClick={() => setWarehouse(w.id)}
                          className={cn('inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors', warehouse === w.id ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]')}
                        >
                          <WarehouseIcon size={14} aria-hidden />
                          {w.name}
                          {cb !== undefined && <span className={cn('num rounded-full px-1.5 text-[12px] font-bold', warehouse === w.id ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]' : 'bg-[var(--erp-card)]')}>{qty(cb.qty)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2">
                  <Field label="Planned for">
                    <DateField value={date} onChange={setDate} ariaLabel="Planned for" />
                  </Field>
                  <Field label="Note" optional>
                    <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. For the Lumen order" aria-label="Note" className={softInput} />
                  </Field>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5 @min-[900px]:col-span-7">
          {bom !== null && (
            <Card delay={2}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-bold">Components</h2>
                  <p className="text-[13px] text-[var(--erp-muted)]">{warehouse !== '' ? `Needed against what ${whs.find((w) => w.id === warehouse)?.name ?? 'the warehouse'} holds` : 'Choose a warehouse'}</p>
                </div>
                {shortCount > 0 ? <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--erp-red)]/12 px-3 py-1 text-[12px] font-bold text-[var(--erp-red-text)]">{shortCount} short</span> : valid && levels !== null ? <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--erp-green)]/12 px-3 py-1 text-[12px] font-bold text-[var(--erp-green-text)]">All there</span> : null}
              </div>
              <ul className="flex flex-col gap-2">
                {comps.map(({ c, need, have, short }) => (
                  <li key={c.line} className={cn('rounded-[18px] px-3 py-2.5', short > 0 ? 'bg-[var(--erp-red)]/8' : 'bg-[var(--erp-row)]')}>
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">{c.item?.name ?? 'Missing item'}</span>
                        <span className="num block truncate text-[12px] text-[var(--erp-muted)]">
                          {qty(c.qty)} per batch · {price(c.avg_cost, cur)} each
                        </span>
                      </span>
                      <span className="num text-right">
                        <span className="block text-[14px] font-bold">
                          {qty(need)} <span className="text-[12px] font-semibold text-[var(--erp-muted)]">of {levels === null ? '...' : qty(have)} here</span>
                        </span>
                        <span className={cn('block text-[12px] font-semibold', short > 0 ? 'text-[var(--erp-red-text)]' : 'text-[var(--erp-muted)]')}>{short > 0 ? `${qty(short)} short` : 'In stock'}</span>
                      </span>
                    </div>
                    <ProgressBar value={need > 0 ? Math.min(1, have / need) : 1} tone={short > 0 ? 'red' : 'ink'} className="mt-2" />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card tone="dark" delay={3}>
            <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Estimated cost</p>
            <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{bom !== null ? money(compCost + extraCost, cur) : '...'}</p>
            {bom !== null && valid && (
              <p className="num mt-1 text-[13px] text-[var(--erp-on-dark-muted)]">
                {money(compCost, cur)} components + {money(extraCost, cur)} labor and overhead · {money(Math.round((compCost + extraCost) / n), cur)} each
              </p>
            )}
          </Card>
          {shortCount > 0 && (
            <Notice tone="warn" icon={AlertTriangle}>
              A planned build can wait for stock: it is completed only when the components are there.
            </Notice>
          )}
          {error !== null && (
            <Notice tone="bad" icon={AlertTriangle}>
              {error}
            </Notice>
          )}
          <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--erp-line)] bg-[var(--erp-shell)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
            <PillButton icon={Check} dot loading={busy} disabled={bom === null || !valid || offStep || warehouse === ''} onClick={() => void save()} className="h-14 w-full text-[15px]">
              {bom !== null && valid ? `Plan build of ${qty(n)} ${unit}` : 'Plan build'}
            </PillButton>
          </div>
        </div>
      </div>
    </div>
  );
}
