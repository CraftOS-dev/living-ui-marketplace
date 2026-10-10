/**
 * Labels: print scannable labels for items (their SKU) and for places
 * (their code), as a barcode or a QR code, on a thermal label printer roll
 * or on sheets of office labels. The preview shows the first page at its
 * real proportions; Print sends exactly that to the printer.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Boxes, Printer, QrCode as QrIcon, ScanBarcode, Tags, Warehouse, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Code128, QrCode, code128Ok } from '../components/Barcode.tsx';
import { Segmented, Stepper } from '../components/controls.tsx';
import { ItemSearch } from '../components/pickers.tsx';
import { Card, CardHeader, Empty, Field, PageHeader, PillButton, PillSelect, TextLink, Toggle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { plural } from '../lib/format.ts';
import { ItemThumb, kindIcon } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { replaceQuery } from '../lib/router.ts';

interface Preset {
  key: string;
  label: string;
  /** Label size in mm. */
  w: number;
  h: number;
  /** A sheet: page size, columns, rows, margins and gaps in mm. Absent: one label per page (a roll). */
  sheet?: { pw: number; ph: number; cols: number; rows: number; top: number; left: number; gx: number; gy: number };
}

const PRESETS: Preset[] = [
  { key: 'roll-50x25', label: 'Label roll, 50 x 25 mm', w: 50, h: 25 },
  { key: 'roll-62x29', label: 'Label roll, 62 x 29 mm', w: 62, h: 29 },
  { key: 'roll-100x50', label: 'Label roll, 100 x 50 mm (4 x 2 in)', w: 100, h: 50 },
  { key: 'a4-3x8', label: 'A4 sheet, 24 labels (70 x 37 mm)', w: 70, h: 37, sheet: { pw: 210, ph: 297, cols: 3, rows: 8, top: 0.5, left: 0, gx: 0, gy: 0 } },
  { key: 'letter-3x10', label: 'Letter sheet, 30 labels (2.63 x 1 in)', w: 66.675, h: 25.4, sheet: { pw: 215.9, ph: 279.4, cols: 3, rows: 10, top: 12.7, left: 4.7625, gx: 3.175, gy: 0 } },
];

interface LabelData {
  key: string;
  title: string;
  code: string;
}

type Kind = 'items' | 'locations';
type Symbology = 'barcode' | 'qr';

function savedPrefs(): { preset: string; symbology: Symbology } {
  try {
    const raw = window.localStorage.getItem('inventory.labels');
    if (raw !== null) {
      const v = JSON.parse(raw) as { preset?: string; symbology?: Symbology };
      return { preset: PRESETS.some((p) => p.key === v.preset) ? (v.preset as string) : 'roll-50x25', symbology: v.symbology === 'qr' ? 'qr' : 'barcode' };
    }
  } catch {
    /* defaults below */
  }
  return { preset: 'roll-50x25', symbology: 'barcode' };
}

/** One label at its real size (mm); scale only shrinks it for the preview. */
function Label({ d, preset, symbology, showTitle }: { d: LabelData; preset: Preset; symbology: Symbology; showTitle: boolean }): React.JSX.Element {
  const qr = symbology === 'qr' || !code128Ok(d.code);
  const pad = Math.max(1.5, preset.h * 0.08);
  const titleSize = Math.max(2.6, Math.min(4.2, preset.h * 0.13));
  const codeTextSize = Math.max(2.2, Math.min(3.4, preset.h * 0.1));
  return (
    <div
      className="flex overflow-hidden bg-[var(--iv-paper)] text-[var(--iv-paper-ink)]"
      style={{ width: `${preset.w}mm`, height: `${preset.h}mm`, padding: `${pad}mm`, gap: `${pad}mm`, flexDirection: qr ? 'row' : 'column', alignItems: qr ? 'center' : 'stretch' }}
    >
      {qr ? (
        <>
          <QrCode value={d.code} className="aspect-square h-full w-auto shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col justify-center" style={{ gap: '1mm' }}>
            {showTitle && (
              <span className="font-bold leading-tight" style={{ fontSize: `${titleSize}mm`, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {d.title}
              </span>
            )}
            <span className="font-semibold tracking-wide" style={{ fontSize: `${codeTextSize}mm`, wordBreak: 'break-all' }}>
              {d.code}
            </span>
          </div>
        </>
      ) : (
        <>
          {showTitle && (
            <span className="truncate font-bold leading-tight" style={{ fontSize: `${titleSize}mm` }}>
              {d.title}
            </span>
          )}
          <Code128 value={d.code} className="min-h-0 w-full flex-1" />
          <span className="text-center font-semibold tracking-wider" style={{ fontSize: `${codeTextSize}mm`, lineHeight: 1 }}>
            {d.code}
          </span>
        </>
      )}
    </div>
  );
}

/** Labels laid out as printed pages. */
function Pages({ labels, preset, symbology, showTitle }: { labels: LabelData[]; preset: Preset; symbology: Symbology; showTitle: boolean }): React.JSX.Element {
  const s = preset.sheet;
  if (s === undefined) {
    return (
      <>
        {labels.map((d, i) => (
          <div key={`${d.key}-${i}`} style={{ width: `${preset.w}mm`, height: `${preset.h}mm`, breakAfter: 'page', pageBreakAfter: 'always', overflow: 'hidden' }}>
            <Label d={d} preset={preset} symbology={symbology} showTitle={showTitle} />
          </div>
        ))}
      </>
    );
  }
  const per = s.cols * s.rows;
  const pages: LabelData[][] = [];
  for (let i = 0; i < labels.length; i += per) pages.push(labels.slice(i, i + per));
  return (
    <>
      {pages.map((pg, pi) => (
        <div
          key={pi}
          style={{
            width: `${s.pw}mm`,
            height: `${s.ph}mm`,
            paddingTop: `${s.top}mm`,
            paddingLeft: `${s.left}mm`,
            display: 'grid',
            gridTemplateColumns: `repeat(${s.cols}, ${preset.w}mm)`,
            gridAutoRows: `${preset.h}mm`,
            columnGap: `${s.gx}mm`,
            rowGap: `${s.gy}mm`,
            breakAfter: 'page',
            pageBreakAfter: 'always',
            overflow: 'hidden',
            background: 'var(--iv-paper)',
          }}
        >
          {pg.map((d, i) => (
            <Label key={`${d.key}-${i}`} d={d} preset={preset} symbology={symbology} showTitle={showTitle} />
          ))}
        </div>
      ))}
    </>
  );
}

export function LabelsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { locations, categories } = useApp();
  const fromQuery = (k: string): string[] => (query.get(k) ?? '').split(',').filter((x) => x !== '');
  const [kind, setKind] = useState<Kind>(fromQuery('locations').length > 0 && fromQuery('items').length === 0 ? 'locations' : 'items');
  const [itemIds, setItemIds] = useState<string[]>(fromQuery('items'));
  const [locIds, setLocIds] = useState<string[]>(fromQuery('locations'));
  const [copies, setCopies] = useState<Record<string, number>>({});
  const prefs = savedPrefs();
  const [presetKey, setPresetKey] = useState(prefs.preset);
  const [symbology, setSymbology] = useState<Symbology>(prefs.symbology);
  const [showTitle, setShowTitle] = useState(true);
  const all = useLive(() => api.items({ archived: 'all', limit: 1000 }), ['items', 'categories'], []);
  const byId = useMemo(() => new Map((all.data?.items ?? []).map((i) => [i.id, i])), [all.data]);
  const preset = PRESETS.find((p) => p.key === presetKey) ?? (PRESETS[0] as Preset);

  useEffect(() => {
    try {
      window.localStorage.setItem('inventory.labels', JSON.stringify({ preset: presetKey, symbology }));
    } catch {
      /* per-browser convenience only */
    }
  }, [presetKey, symbology]);
  useEffect(() => {
    replaceQuery('labels', kind === 'items' ? { items: itemIds.join(',') } : { locations: locIds.join(',') });
  }, [kind, itemIds, locIds]);

  const labels: LabelData[] = useMemo(() => {
    const out: LabelData[] = [];
    if (kind === 'items') {
      for (const id of itemIds) {
        const it = byId.get(id);
        if (it === undefined) continue;
        for (let n = 0; n < (copies[id] ?? 1); n++) out.push({ key: id, title: it.name, code: it.sku });
      }
    } else {
      for (const id of locIds) {
        const l = locations.find((x) => x.id === id);
        if (l === undefined) continue;
        for (let n = 0; n < (copies[id] ?? 1); n++) out.push({ key: id, title: l.name, code: l.code });
      }
    }
    return out;
  }, [kind, itemIds, locIds, copies, byId, locations]);

  const firstPage = preset.sheet !== undefined ? labels.slice(0, preset.sheet.cols * preset.sheet.rows) : labels.slice(0, 6);
  const pagesCount = preset.sheet !== undefined ? Math.ceil(labels.length / (preset.sheet.cols * preset.sheet.rows)) : labels.length;
  const ids = kind === 'items' ? itemIds : locIds;

  const toggleItem = (id: string): void => setItemIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleLoc = (id: string): void => setLocIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const print = (): void => {
    if (labels.length === 0) {
      toast.error('Choose what to print first');
      return;
    }
    window.print();
  };

  const pageCss =
    preset.sheet !== undefined ? `@page { size: ${preset.sheet.pw}mm ${preset.sheet.ph}mm; margin: 0; }` : `@page { size: ${preset.w}mm ${preset.h}mm; margin: 0; }`;
  // Preview: fit the page (or the labels) into the card.
  const previewScale = preset.sheet !== undefined ? 0.62 : Math.min(1.6, 300 / (preset.w * 3.78));

  return (
    <div>
      <PageHeader
        title="Labels"
        subtitle="Scannable labels for items and places"
        actions={
          <PillButton variant="dark" icon={Printer} dot onClick={print} disabled={labels.length === 0}>
            Print {labels.length > 0 ? plural(labels.length, 'label') : ''}
          </PillButton>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-5 lg:col-span-5">
          <Card delay={1}>
            <CardHeader title="What to print" />
            <Segmented
              ariaLabel="What to print"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'items', label: 'Items', icon: Boxes },
                { value: 'locations', label: 'Places', icon: Warehouse },
              ]}
              className="mb-4 w-full"
            />
            {kind === 'items' ? (
              <div className="flex flex-col gap-3">
                <ItemSearch onPick={(it) => toggleItem(it.id)} selected={itemIds} scanning limit={6} />
                <div className="flex flex-wrap items-center gap-4">
                  <TextLink onClick={() => setItemIds((all.data?.items ?? []).filter((i) => !i.archived).map((i) => i.id))}>All items</TextLink>
                  <PillSelect
                    ariaLabel="Add a category"
                    value=""
                    onChange={(v) => v !== '' && setItemIds((s) => [...new Set([...s, ...(all.data?.items ?? []).filter((i) => i.category?.id === v && !i.archived).map((i) => i.id)])])}
                    options={[{ value: '', label: 'Add a category' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                    soft
                    className="w-48"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                  {locations.map((l) => {
                    const Icon = kindIcon(l.kind);
                    const on = locIds.includes(l.id);
                    return (
                      <li key={l.id}>
                        <label className={cn('flex w-full items-center gap-3 rounded-full py-2 pr-3 text-[14px] font-semibold hover:bg-[var(--iv-row)]', on && 'bg-[var(--iv-row)]')} style={{ paddingLeft: 12 + l.depth * 16 }}>
                          <input type="checkbox" checked={on} onChange={() => toggleLoc(l.id)} className="size-4 accent-[var(--iv-ink)]" />
                          <Icon size={15} className="text-[var(--iv-ink-2)]" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{l.name}</span>
                          <span className="num text-[12px] font-medium text-[var(--iv-muted)]">{l.code}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <TextLink onClick={() => setLocIds(locations.map((l) => l.id))} className="self-start">
                  All places
                </TextLink>
              </div>
            )}
          </Card>

          {ids.length > 0 && (
            <Card delay={2}>
              <CardHeader title={`${plural(ids.length, kind === 'items' ? 'item' : 'place')} chosen`} action={<TextLink tone="muted" onClick={() => (kind === 'items' ? setItemIds([]) : setLocIds([]))}>Clear</TextLink>} />
              <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
                {ids.map((id) => {
                  const it = kind === 'items' ? byId.get(id) : undefined;
                  const l = kind === 'locations' ? locations.find((x) => x.id === id) : undefined;
                  const name = it?.name ?? l?.name ?? '';
                  const LIcon = kindIcon(l?.kind);
                  return (
                    <li key={id} className="flex items-center gap-3 rounded-[16px] bg-[var(--iv-row)] px-3 py-2">
                      {it !== undefined ? (
                        <ItemThumb photo={it.photo} icon={it.icon} size={32} tone="card" rounded="rounded-[10px]" />
                      ) : (
                        <span className="flex size-8 items-center justify-center rounded-[10px] bg-[var(--iv-card)]">
                          <LIcon size={15} aria-hidden />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
                      <Stepper size="sm" value={String(copies[id] ?? 1)} min={1} onChange={(v) => setCopies((c) => ({ ...c, [id]: Math.max(1, Math.min(500, Math.round(Number(v) || 1))) }))} ariaLabel={`copies of ${name}`} />
                      <button type="button" onClick={() => (kind === 'items' ? toggleItem(id) : toggleLoc(id))} aria-label={`Remove ${name}`} className="flex size-8 items-center justify-center rounded-full hover:bg-[var(--iv-row-hover)]">
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5 lg:col-span-7">
          <Card delay={2}>
            <CardHeader title="Label" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PillSelect soft label="Size" value={presetKey} onChange={setPresetKey} options={PRESETS.map((p) => ({ value: p.key, label: p.label }))} />
              <Field label="Code">
                <Segmented
                  ariaLabel="Code type"
                  value={symbology}
                  onChange={setSymbology}
                  options={[
                    { value: 'barcode', label: 'Barcode', icon: ScanBarcode },
                    { value: 'qr', label: 'QR code', icon: QrIcon },
                  ]}
                  className="w-full"
                />
              </Field>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-[20px] bg-[var(--iv-row)] px-4 py-3">
              <span className="text-[13px] font-semibold">Show the name</span>
              <Toggle checked={showTitle} onChange={setShowTitle} label="Show the name on each label" />
            </div>
            <p className="mt-3 px-1 text-[12px] text-[var(--iv-muted)]">
              {symbology === 'barcode' ? 'Barcodes are read by any handheld scanner.' : 'QR codes need a 2D scanner or a phone camera, and fit small labels better.'} When printing, choose the
              printer and set the scale to 100% (no fitting to the page).
            </p>
          </Card>

          <Card tone="sand" delay={3}>
            <CardHeader
              title="Preview"
              subtitle={labels.length > 0 ? `${plural(labels.length, 'label')}${preset.sheet !== undefined ? ` on ${plural(pagesCount, 'sheet')}` : ''}` : 'Choose items or places to see their labels'}
            />
            {labels.length === 0 ? (
              <Empty icon={Tags} title="Nothing chosen yet">
                Pick items or places on the left. Each gets its code: the item's SKU, the place's location code.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                {preset.sheet !== undefined ? (
                  <div className="origin-top-left shadow-[0_20px_50px_-30px_rgba(0,0,0,0.5)]" style={{ transform: `scale(${previewScale})`, width: `${preset.sheet.pw}mm`, height: `${preset.sheet.ph}mm`, marginBottom: `calc(${preset.sheet.ph}mm * ${previewScale - 1})`, marginRight: `calc(${preset.sheet.pw}mm * ${previewScale - 1})` }}>
                    <Pages labels={firstPage} preset={preset} symbology={symbology} showTitle={showTitle} />
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {firstPage.map((d, i) => (
                      <div key={`${d.key}-${i}`} className="shadow-[0_12px_30px_-20px_rgba(0,0,0,0.5)]" style={{ zoom: previewScale }}>
                        <Label d={d} preset={preset} symbology={symbology} showTitle={showTitle} />
                      </div>
                    ))}
                    {labels.length > firstPage.length && <p className="self-center text-[13px] text-[var(--iv-ink-2)]">and {plural(labels.length - firstPage.length, 'more label')}</p>}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
      {labels.length > 0 &&
        createPortal(
          <div className="iv-print-only" aria-hidden>
            <style>{pageCss}</style>
            <Pages labels={labels} preset={preset} symbology={symbology} showTitle={showTitle} />
          </div>,
          document.body,
        )}
    </div>
  );
}
