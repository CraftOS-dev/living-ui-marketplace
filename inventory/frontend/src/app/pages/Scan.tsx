/**
 * Scan: a workspace for a barcode scanner (USB or Bluetooth, typing like a
 * keyboard; typing a code and pressing Enter works too).
 *
 *   Look up    scan to see an item and act on it
 *   Receive    each scan adds to a list of stock coming in
 *   Take out   each scan adds to a list of stock going out
 *   Move       scan the place it comes from and the place it goes, then items
 *
 * Scanning a location label sets the place. The list is recorded as one
 * change (one Undo). A code nothing has yet can become a new item or be
 * added to an existing one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, Link2, MoveRight, PackagePlus, Plus, ScanBarcode, ScanSearch, Volume2, VolumeX, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { ItemSearch, LocationSelect } from '../components/pickers.tsx';
import { Segmented, StatusBadge, Stepper } from '../components/controls.tsx';
import { useItemEditor } from '../components/ItemEditor.tsx';
import { useStockChange } from '../components/StockChange.tsx';
import { Card, CardHeader, CircleButton, Empty, Field, Modal, PageHeader, PillButton, PillSelect, TextLink, errMessage, pillInput } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import type { StockLine } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { normalizeNumber, plain, plural, qty } from '../lib/format.ts';
import { ItemThumb, kindIcon } from '../lib/icons.tsx';
import { navigate } from '../lib/router.ts';
import { useScanner } from '../lib/scanner.ts';
import { beep, setSound, soundOn } from '../lib/sound.ts';
import type { ItemDetail } from '../lib/types.ts';

type Mode = 'lookup' | 'in' | 'out' | 'move';

const MODES: { value: Mode; label: string; icon: LucideIcon }[] = [
  { value: 'lookup', label: 'Look up', icon: ScanSearch },
  { value: 'in', label: 'Receive', icon: ArrowDownLeft },
  { value: 'out', label: 'Take out', icon: ArrowUpRight },
  { value: 'move', label: 'Move', icon: MoveRight },
];

const OUT_REASONS = [
  { value: 'used', label: 'Used' },
  { value: 'sold', label: 'Sold' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost or stolen' },
  { value: 'expired', label: 'Expired' },
  { value: 'sample', label: 'Sample or gift' },
  { value: 'returned', label: 'Returned to supplier' },
];

const IN_REASONS = [
  { value: 'received', label: 'Received' },
  { value: 'returned', label: 'Returned' },
  { value: 'found', label: 'Found' },
  { value: 'produced', label: 'Made' },
];

interface Line {
  key: string;
  item: ItemDetail;
  location: string;
  to: string;
  qty: string;
  touched: number;
}

type Feedback = { kind: 'ok'; text: string } | { kind: 'miss'; code: string } | { kind: 'info'; text: string } | null;

export function ScanPage(): React.JSX.Element {
  const { locationById, locations } = useApp();
  const change = useStockChange();
  const editor = useItemEditor();
  const [mode, setMode] = useState<Mode>('in');
  const [place, setPlace] = useState('');
  const [to, setTo] = useState('');
  const [perScan, setPerScan] = useState('1');
  const [lines, setLines] = useState<Line[]>([]);
  const [reason, setReason] = useState('received');
  const [looked, setLooked] = useState<ItemDetail | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sound, setSoundState] = useState(soundOn);
  const [linking, setLinking] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setReason(mode === 'out' ? 'used' : 'received');
    setFeedback(null);
  }, [mode]);

  const flash = (): void => {
    const el = flashRef.current;
    if (el === null) return;
    el.classList.remove('iv-flash');
    void el.offsetWidth;
    el.classList.add('iv-flash');
  };

  const placeFor = useCallback(
    (item: ItemDetail): string => {
      if (mode === 'in') return place !== '' ? place : (item.default_location?.id ?? locations.find((l) => l.depth === 0)?.id ?? '');
      const held = item.stock.map((s) => s.location.id);
      if (place !== '' && (held.includes(place) || mode === 'out')) return place;
      if (item.default_location !== null && held.includes(item.default_location.id)) return item.default_location.id;
      return held[0] ?? place;
    },
    [mode, place, locations],
  );

  const addLine = useCallback(
    (item: ItemDetail) => {
      const loc = mode === 'move' ? place : placeFor(item);
      const key = `${item.id}|${loc}|${mode === 'move' ? to : ''}`;
      const step = Number(perScan) > 0 ? Number(perScan) : 1;
      setLines((ls) => {
        const found = ls.find((l) => l.key === key);
        if (found !== undefined) {
          return ls.map((l) => (l.key === key ? { ...l, qty: plain(Number(l.qty) + step), touched: Date.now() } : l));
        }
        return [{ key, item, location: loc, to: mode === 'move' ? to : '', qty: plain(step), touched: Date.now() }, ...ls];
      });
      setFeedback({ kind: 'ok', text: `${item.name} +${qty(step)}` });
      flash();
    },
    [mode, place, to, perScan, placeFor],
  );

  const handle = useCallback(
    async (raw: string) => {
      const c = raw.trim();
      if (c === '') return;
      setCode('');
      try {
        const hit = await api.lookup(c);
        if (hit.type === 'none') {
          beep('miss');
          setFeedback({ kind: 'miss', code: c });
          return;
        }
        beep('ok');
        if (hit.type === 'location') {
          if (mode === 'lookup') {
            navigate('locations', { id: hit.location.id });
            return;
          }
          if (mode === 'move') {
            if (place === '' || (place !== '' && to !== '')) {
              setPlace(hit.location.id);
              setTo('');
              setFeedback({ kind: 'info', text: `Moving from ${hit.location.path}. Now scan where it goes.` });
            } else {
              setTo(hit.location.id);
              setFeedback({ kind: 'info', text: `Moving to ${hit.location.path}. Now scan the items.` });
            }
          } else {
            setPlace(hit.location.id);
            setFeedback({ kind: 'info', text: `Place set to ${hit.location.path}` });
          }
          flash();
          return;
        }
        if (mode === 'lookup') {
          setLooked(hit.item);
          setFeedback({ kind: 'ok', text: hit.item.name });
          flash();
          return;
        }
        if (mode === 'move' && (place === '' || to === '')) {
          beep('miss');
          setFeedback({ kind: 'info', text: place === '' ? 'Scan (or choose) where it comes from first.' : 'Scan (or choose) where it goes first.' });
          return;
        }
        addLine(hit.item);
      } catch {
        beep('miss');
      }
    },
    [mode, place, to, addLine],
  );

  useScanner((c) => void handle(c));

  const record = async (): Promise<void> => {
    if (lines.length === 0) return;
    const out: StockLine[] = [];
    for (const l of lines) {
      const n = normalizeNumber(l.qty, l.item.fractional ? 3 : 0);
      if (n === null || Number(n) <= 0) {
        toast.error(`Check the quantity of ${l.item.name}`);
        return;
      }
      if (mode === 'move') out.push({ kind: 'move', item: l.item.id, qty: n, from: l.location, to: l.to });
      else if (l.location === '') {
        toast.error(`Choose where ${l.item.name} ${mode === 'in' ? 'goes' : 'comes from'}`);
        return;
      } else out.push({ kind: mode === 'in' ? 'in' : 'out', item: l.item.id, qty: n, location: l.location, reason });
    }
    setBusy(true);
    try {
      const r = await api.stockBatch(out);
      change.saved(r.message, r.batch);
      setLines([]);
      setFeedback(null);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const units = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const placeLoc = place !== '' ? locationById.get(place) : undefined;
  const toLoc = to !== '' ? locationById.get(to) : undefined;
  const verb = mode === 'in' ? 'Receive' : mode === 'out' ? 'Take out' : 'Move';

  return (
    <div>
      <PageHeader
        title="Scan"
        subtitle="Point a barcode scanner at a label, or type a code and press Enter."
        actions={
          <CircleButton
            icon={sound ? Volume2 : VolumeX}
            label={sound ? 'Turn scan sounds off' : 'Turn scan sounds on'}
            onClick={() => {
              setSound(!sound);
              setSoundState(!sound);
            }}
          />
        }
      />
      <div className="iv-rise iv-d1 mb-5">
        <Segmented ariaLabel="What are you doing" value={mode} onChange={setMode} options={MODES} className="w-full md:w-auto" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        {/* The scanner */}
        <div className="flex flex-col gap-5 lg:col-span-7">
          <Card tone="dark" delay={2}>
            <div ref={flashRef} className="relative overflow-hidden rounded-[22px] bg-[var(--iv-dark-2)] px-5 py-8">
              <span aria-hidden className="iv-sweep pointer-events-none absolute inset-x-6 top-1/2 h-[2px] rounded-full bg-[var(--iv-accent)] opacity-70" />
              <div className="relative flex flex-col items-center gap-3 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-[var(--iv-accent)] text-[var(--iv-on-accent)]">
                  <ScanBarcode size={24} aria-hidden />
                </span>
                <p className="text-[15px] font-bold">
                  {mode === 'lookup' ? 'Scan anything to look it up' : mode === 'move' ? (place === '' ? 'Scan where it comes from' : to === '' ? 'Now scan where it goes' : 'Scan the items to move') : `Scan items to ${verb.toLowerCase()}`}
                </p>
                <p className="min-h-5 text-[13px] text-[var(--iv-on-dark-muted)]" aria-live="polite">
                  {feedback === null
                    ? 'Ready'
                    : feedback.kind === 'ok'
                      ? feedback.text
                      : feedback.kind === 'info'
                        ? feedback.text
                        : `Nothing has the code ${feedback.code}`}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handle(code);
                  }
                }}
                placeholder="Or type a code"
                aria-label="Code"
                className={cn(pillInput, 'num iv-on-card')}
              />
              <PillButton variant="accent" disabled={code.trim() === ''} onClick={() => void handle(code)}>
                Go
              </PillButton>
            </div>

            {feedback?.kind === 'miss' && (
              <div className="iv-shake mt-4 flex flex-wrap items-center gap-2 rounded-[20px] bg-[var(--iv-dark-2)] p-3">
                <span className="min-w-0 flex-1 text-[13px]">
                  <span className="num font-bold">{feedback.code}</span> is new.
                </span>
                <PillButton
                  variant="accent"
                  icon={PackagePlus}
                  onClick={(e) => {
                    const c = feedback.code;
                    editor.create(e.currentTarget, {
                      barcode: c,
                      onSaved: (item) => {
                        if (mode === 'lookup') setLooked(item);
                        else if (mode !== 'move' || (place !== '' && to !== '')) addLine(item);
                        setFeedback({ kind: 'ok', text: `${item.name} added` });
                      },
                    });
                  }}
                >
                  New item
                </PillButton>
                <PillButton variant="light" icon={Link2} onClick={() => setLinking(feedback.code)}>
                  Add to an item
                </PillButton>
              </div>
            )}

          </Card>

          {mode !== 'lookup' && (
            <Card delay={3}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {mode === 'move' ? (
                  <>
                    <Field label="From">
                      <LocationSelect value={place} onChange={setPlace} soft placeholder="Scan or choose" ariaLabel="Move from" />
                    </Field>
                    <Field label="To">
                      <LocationSelect value={to} onChange={setTo} soft placeholder="Scan or choose" ariaLabel="Move to" />
                    </Field>
                  </>
                ) : (
                  <Field label={mode === 'in' ? 'Goes to' : 'Comes from'} hint="Scanning a place's label sets it too.">
                    <LocationSelect value={place} onChange={setPlace} soft allowNone noneLabel={mode === 'in' ? "Each item's home" : 'Where each item is'} ariaLabel="Place" />
                  </Field>
                )}
                <Field label="Each scan counts">
                  <Stepper value={perScan} onChange={(v) => setPerScan(Number(v) > 0 ? v : '1')} min={1} ariaLabel="per scan" className="self-start" />
                </Field>
              </div>
            </Card>
          )}

          {mode === 'lookup' && (
            <Card delay={3}>
              {looked === null ? (
                <Empty icon={ScanSearch} title="Nothing scanned yet">
                  Scan an item to see how many there are and where. Scan a location label to see what is in it.
                </Empty>
              ) : (
                <LookedUp item={looked} />
              )}
            </Card>
          )}
        </div>

        {/* The list */}
        {mode !== 'lookup' && (
          <Card className="lg:sticky lg:top-8 lg:col-span-5" delay={3}>
            <CardHeader
              title={lines.length === 0 ? `To ${verb.toLowerCase()}` : `${plural(lines.length, 'line')}, ${qty(units)} units`}
              subtitle={mode === 'move' && placeLoc !== undefined && toLoc !== undefined ? `${placeLoc.name} to ${toLoc.name}` : 'Recorded together, with one Undo'}
              action={lines.length > 0 ? <TextLink tone="muted" onClick={() => setLines([])}>Clear</TextLink> : undefined}
            />
            {lines.length === 0 ? (
              <div className="flex flex-col gap-3">
                <p className="rounded-[18px] bg-[var(--iv-row)] px-4 py-3 text-[13px] text-[var(--iv-ink-2)]">Scanned items land here. Scanning the same item again adds to its line.</p>
                <AddByHand onPick={(it) => void api.item(it.id).then(addLine)} disabled={mode === 'move' && (place === '' || to === '')} />
              </div>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {lines.map((l) => {
                    const loc = l.location !== '' ? locationById.get(l.location) : undefined;
                    const held = l.item.stock.find((s) => s.location.id === l.location)?.qty ?? 0;
                    const short = mode !== 'in' && Number(l.qty) > held;
                    const Icon = kindIcon(loc?.kind);
                    return (
                      <li key={l.key} className={cn('flex flex-col gap-2 rounded-[18px] bg-[var(--iv-row)] p-3', Date.now() - l.touched < 900 && 'iv-flash')}>
                        <div className="flex items-center gap-3">
                          <ItemThumb photo={l.item.photo} icon={l.item.icon} size={40} tone="card" rounded="rounded-[12px]" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-bold">{l.item.name}</span>
                            <span className="flex items-center gap-1.5 truncate text-[12px] text-[var(--iv-muted)]">
                              <Icon size={12} aria-hidden />
                              {loc !== undefined ? loc.name : 'Choose a place'}
                              {mode === 'move' && l.to !== '' && (
                                <>
                                  <ArrowRight size={12} aria-hidden /> {locationById.get(l.to)?.name}
                                </>
                              )}
                            </span>
                          </span>
                          <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove ${l.item.name}`} className="flex size-8 items-center justify-center rounded-full hover:bg-[var(--iv-row-hover)]">
                            <X size={14} />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Stepper
                            size="sm"
                            value={l.qty}
                            onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: v } : x)))}
                            fractional={l.item.fractional}
                            min={0}
                            ariaLabel={`${l.item.name} quantity`}
                          />
                          {mode !== 'move' && (
                            <LocationSelect
                              value={l.location}
                              onChange={(id) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, location: id, key: `${x.item.id}|${id}|` } : x)))}
                              {...(mode === 'out' ? { only: l.item.stock.map((s) => s.location.id) } : {})}
                              ariaLabel={`${l.item.name} place`}
                              className="w-48"
                              align="right"
                            />
                          )}
                          {short && <span className="w-full text-[12px] font-semibold text-[var(--iv-red-text)]">Only {qty(held)} {l.item.unit} there</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4 flex flex-col gap-3">
                  {mode !== 'move' && (
                    <PillSelect soft label={mode === 'in' ? 'Why it came in' : 'Why it went out'} value={reason} onChange={setReason} options={mode === 'in' ? IN_REASONS : OUT_REASONS} />
                  )}
                  <AddByHand onPick={(it) => void api.item(it.id).then(addLine)} disabled={mode === 'move' && (place === '' || to === '')} />
                  <PillButton variant="dark" icon={Check} dot loading={busy} onClick={() => void record()} className="h-14 text-[15px]">
                    {verb} {qty(units)} {units === 1 ? 'unit' : 'units'}
                  </PillButton>
                </div>
              </>
            )}
          </Card>
        )}
      </div>

      <Modal open={linking !== null} onClose={() => setLinking(null)} title="Add the code to an item" description={linking !== null ? `Scanning ${linking} will then find the item you choose.` : undefined} wide>
        {linking !== null && (
          <ItemSearch
            autoFocus
            scanning={false}
            onPick={(it) => {
              const c = linking;
              setLinking(null);
              api
                .addBarcode(it.id, c)
                .then((r) => {
                  toast.success(`Added the code to ${it.name}`);
                  if (mode === 'lookup') setLooked(r.item);
                  else if (mode !== 'move' || (place !== '' && to !== '')) addLine(r.item);
                })
                .catch(() => undefined);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/** Add a line without a scanner: search and pick. */
function AddByHand({ onPick, disabled }: { onPick: (item: { id: string }) => void; disabled: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PillButton variant="soft" icon={Plus} disabled={disabled} onClick={() => setOpen(true)}>
        Add an item by hand
      </PillButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Add an item" wide>
        <ItemSearch
          autoFocus
          scanning={false}
          onPick={(it) => {
            setOpen(false);
            onPick(it);
          }}
        />
      </Modal>
    </>
  );
}

/** What a look-up scan found, with its actions. */
function LookedUp({ item }: { item: ItemDetail }): React.JSX.Element {
  const change = useStockChange();
  return (
    <div className="iv-pop flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <ItemThumb photo={item.photo_large} icon={item.icon} size={72} tone="row" rounded="rounded-[20px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{item.name}</p>
          <p className="num text-[12px] text-[var(--iv-muted)]">{item.sku}</p>
          <div className="mt-1.5">
            <StatusBadge status={item.status} />
          </div>
        </div>
        <div className="text-right">
          <p className="num text-[26px] font-extrabold leading-8">{qty(item.on_hand)}</p>
          <p className="text-[12px] text-[var(--iv-muted)]">{item.unit} on hand</p>
        </div>
      </div>
      {item.stock.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {item.stock.map((s) => {
            const Icon = kindIcon(s.location.kind);
            return (
              <li key={s.location.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--iv-row)] px-3 py-2 text-[13px]">
                <Icon size={15} className="text-[var(--iv-ink-2)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-semibold">{s.location.path}</span>
                <span className="num font-bold">{qty(s.qty)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <PillButton variant="dark" icon={Plus} dot onClick={(e) => change.open(e.currentTarget, { item, mode: 'in' })}>
          In
        </PillButton>
        <PillButton variant="light" icon={ArrowUpRight} disabled={item.on_hand <= 0} onClick={(e) => change.open(e.currentTarget, { item, mode: 'out' })}>
          Out
        </PillButton>
        <PillButton variant="light" icon={MoveRight} disabled={item.on_hand <= 0} onClick={(e) => change.open(e.currentTarget, { item, mode: 'move' })}>
          Move
        </PillButton>
        <PillButton variant="ghost" onClick={() => navigate('item', { id: item.id })}>
          Open the item
        </PillButton>
      </div>
    </div>
  );
}

