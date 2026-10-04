/**
 * Can we? The signature question: can this franchise, title, character,
 * song or recording be used this way, here, at this time? Every cell says
 * whether the rights are free, the verdict, and who decides (the window
 * holder, or every committee member when no window covers the use). A cell
 * opens the verdict panel with each check in order and its agreements.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Scale, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button, Card, Switch, cn, toast } from '../../kit/index.ts';
import { errText, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useLiveReload } from '../lib/live.ts';
import { addDays, addMonths, fmtDate, today } from '../lib/format.ts';
import { joinList, t } from '../lib/i18n.ts';
import { OFFICES } from '../lib/labels.ts';
import { useRoute } from '../lib/router.ts';
import type { CanWeResponse } from '../lib/shapes.ts';
import { DimensionPicker } from '../components/pickers.tsx';
import { EmptyHint, ErrorBox, Field, JurChip, Notice, PageHeader, Section, Segmented } from '../components/ui.tsx';
import { CanWeGrid, CanWeLegend, VerdictPanel } from '../components/rightsCanWe.tsx';
import { ASSET_FIELD, AssetPickers, ConsentOpenDialog, DateField, assetCount, assetList, useRightsDims } from '../components/rightsShared.tsx';
import type { AssetSel, AssetType } from '../components/rightsShared.tsx';

const USE_DIMS = ['media', 'category', 'channel', 'platform'];
const MARKETS = ['HK', 'SG', 'GB', 'FR'];
const ASIA = ['JP', 'CN', 'KR', 'TW', 'HK', 'SG', 'TH', 'ID', 'VN', 'PH', 'MY', 'IN'];
const REGIONS = ['ASIA', 'EUROPE', 'NORTH_AMERICA', 'LATAM', 'OCEANIA', 'MENA'];
const MAX_COLUMNS = 40;

interface Query {
  assets: AssetSel;
  territories: string[];
  filters: Record<string, string[]>;
  start: string;
  end: string;
  exclusive: boolean;
  voice: boolean;
}

/** "character:abc,work:def" from the link into asset lists. */
function parseAssets(v: string | null): AssetSel {
  const out: AssetSel = { franchises: [], works: [], characters: [], songs: [], recordings: [], matters: [] };
  for (const part of (v ?? '').split(',')) {
    const [type = '', id = ''] = part.trim().split(':');
    const f = ASSET_FIELD[type as AssetType] as keyof AssetSel | undefined;
    if (f !== undefined && id !== '' && !out[f].includes(id)) out[f].push(id);
  }
  return out;
}

function officeTerritories(jurisdictions: string[]): string[] {
  const codes = jurisdictions.map((c) => c.toUpperCase()).filter((c) => c.length === 2 && c !== 'EM' && c !== 'WO');
  return codes.length > 0 ? codes : OFFICES.filter((c) => c !== 'EM' && c !== 'WO');
}

export function CanWePage(): React.JSX.Element {
  const { jurisdictions, dimValues, dimLabel, can } = useApp();
  const route = useRoute();
  const dims = useRightsDims();
  const [assets, setAssets] = useState<AssetSel>(() => parseAssets(route.params.get('asset')));
  const [terrState, setTerritories] = useState<string[] | null>(null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(addDays(addMonths(today(), 12), -1));
  const [exclusive, setExclusive] = useState(false);
  const [voice, setVoice] = useState(false);
  const [result, setResult] = useState<CanWeResponse | null>(null);
  const [ran, setRan] = useState<Query | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [ask, setAsk] = useState<{ committeeId: string; subject: string; use: Record<string, unknown>; lines: string[] } | null>(null);

  const offices = useMemo(() => officeTerritories(jurisdictions), [jurisdictions]);
  const territories = terrState ?? [...offices, ...MARKETS.filter((m) => !offices.includes(m))];
  const useDims = USE_DIMS.filter((d) => dims.enabled.includes(d));
  const langOn = dims.enabled.includes('language');

  const query: Query = useMemo(
    () => ({
      assets,
      territories,
      filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length > 0)),
      start,
      end,
      exclusive,
      voice,
    }),
    [assets, territories, filters, start, end, exclusive, voice],
  );
  const stale = result !== null && ran !== null && JSON.stringify(ran) !== JSON.stringify(query);

  const call = (q: Query): Promise<CanWeResponse> =>
    op<CanWeResponse>('rights/can-we', {
      assets: assetList(q.assets),
      column: 'territory',
      columns: q.territories,
      filters: q.filters,
      start: q.start,
      end: q.end,
      exclusive: q.exclusive,
      includes_voice: q.voice,
    });

  const run = async (q: Query): Promise<void> => {
    if (assetCount(q.assets) === 0) {
      toast.error(t('Choose at least one franchise, title, character, song or recording.'));
      return;
    }
    if (q.territories.length === 0) {
      toast.error(t('Choose at least one territory.'));
      return;
    }
    if (q.territories.length > MAX_COLUMNS) {
      toast.error(t('Ask about at most {n} territories at once.', { n: MAX_COLUMNS }));
      return;
    }
    if (q.start === '' || q.end === '' || q.end < q.start) {
      toast.error(t('Choose dates where the end comes after the start.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await call(q);
      setResult(r);
      setRan(q);
      setSel(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // Answers follow new deals, windows, members and marks (by anyone, including CraftBot).
  useLiveReload(
    ['grants', 'agreements', 'committees', 'committee_members', 'matters', 'goods_services', 'character_assets', 'castings', 'talents', 'franchises', 'titles', 'characters'],
    () => {
      if (ran === null) return;
      call(ran)
        .then(setResult)
        .catch(() => undefined);
    },
    ran !== null,
  );

  // A link with ?asset=type:id asks straight away.
  const param = route.params.get('asset') ?? '';
  const autoRan = useRef('');
  useEffect(() => {
    if (param === '' || autoRan.current === param) return;
    autoRan.current = param;
    const a = parseAssets(param);
    setAssets(a);
    void run({ ...query, assets: a });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  const terrName = (c: string): string => dimLabel('territory', c);
  const presets = [
    { key: 'offices', label: t('Our offices'), codes: [...offices, ...MARKETS.filter((m) => !offices.includes(m))] },
    { key: 'asia', label: t('Asia'), codes: ASIA },
    { key: 'regions', label: t('Regions|preset'), codes: REGIONS },
  ];
  const known = new Set(dimValues.filter((v) => v.dimension === 'territory').map((v) => v.code));

  const selRow = sel !== null && result !== null ? result.rows[sel.r] : undefined;
  const selCell = selRow !== undefined && sel !== null ? selRow.cells[sel.c] : undefined;

  const openAsk = (committeeId: string): void => {
    if (selRow === undefined || selCell === undefined || ran === null || result === null) return;
    const useParts = Object.entries(ran.filters).map(([k, v]) => `${dims.title(k)}: ${joinList(v.map((c) => dimLabel(k, c)))}`);
    const place = terrName(selCell.code);
    const lines = [
      `${t('What|can we')}: ${selRow.label}`,
      ...useParts,
      `${t('Territory')}: ${place}`,
      `${t('When')}: ${t('{start} to {end}', { start: fmtDate(result.start), end: fmtDate(result.end) })}`,
      ...(ran.exclusive ? [t('Exclusive deal')] : []),
    ];
    const subject = `${selRow.label}: ${useParts.length > 0 ? `${useParts.join(', ')}, ` : ''}${place}, ${t('{start} to {end}', { start: fmtDate(result.start), end: fmtDate(result.end) })}`;
    const use: Record<string, unknown> = {
      ...ran.filters,
      territory: [selCell.code],
      assets: [`${selRow.type}:${selRow.id}`],
      start: result.start,
      end: result.end,
      exclusive: ran.exclusive,
      includes_voice: ran.voice,
    };
    setAsk({ committeeId, subject, use, lines });
  };

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('Can we?')}
        subtitle={t('Pick what you want to use, how, where and when. Each answer says whether the rights are free and who can say yes.')}
      />

      <Card className="mb-5">
        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold">{t('What|can we')}</h2>
            <AssetPickers value={assets} onChange={setAssets} fields={['franchises', 'works', 'characters', 'songs', 'recordings']} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
                <SlidersHorizontal size={13} aria-hidden /> {t('Use|question')}
              </span>
              {[...useDims, ...(langOn ? ['language'] : [])].map((d) => {
                const chosen = filters[d] ?? [];
                const isOpen = openPicker === d;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenPicker((o) => (o === d ? null : d))}
                    className={cn(
                      'max-w-full truncate border px-2 py-1 text-xs',
                      chosen.length > 0
                        ? 'border-[var(--agent-app-accent)]/60 bg-[var(--agent-app-accent)]/10 text-[var(--agent-app-text)]'
                        : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
                      isOpen && 'border-[var(--agent-app-accent)]',
                    )}
                  >
                    {dims.title(d)}: {chosen.length === 0 ? t('Any|use') : joinList(chosen.map((c) => dimLabel(d, c)))}
                  </button>
                );
              })}
            </div>
            {openPicker !== null && openPicker !== 'territory' && (
              <div className="max-w-xl">
                <DimensionPicker
                  key={openPicker}
                  dimension={openPicker}
                  label={dims.title(openPicker)}
                  value={{ include: filters[openPicker] ?? [] }}
                  onChange={(v) => setFilters((f) => ({ ...f, [openPicker]: v.include ?? [] }))}
                  allowExclude={false}
                />
              </div>
            )}
            <p className="text-xs text-[var(--agent-app-muted)]">
              {t('Leave a dimension at Any to ask about all of it. The language is optional, for versions such as subtitles or dubs.')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">{t('Where|can we')}</span>
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setTerritories(p.codes.filter((c) => known.size === 0 || known.has(c)))}
                  className="border border-[var(--agent-app-border)] px-2 py-1 text-xs text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30"
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                aria-expanded={openPicker === 'territory'}
                onClick={() => setOpenPicker((o) => (o === 'territory' ? null : 'territory'))}
                className={cn(
                  'border px-2 py-1 text-xs',
                  openPicker === 'territory' ? 'border-[var(--agent-app-accent)] text-[var(--agent-app-accent)]' : 'border-dashed border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
                )}
              >
                {t('Choose territories')}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {territories.length === 0 ? (
                <span className="text-xs text-[var(--agent-app-muted)]">{t('No territory chosen.')}</span>
              ) : (
                territories.map((c) => (
                  <span key={c} className="inline-flex max-w-full items-center gap-1.5 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-1.5 py-0.5 text-xs">
                    {c.length === 2 && <JurChip code={c} />}
                    <span className="truncate">{terrName(c)}</span>
                    <button type="button" aria-label={t('Remove {name}|territory chip', { name: terrName(c) })} className="text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => setTerritories(territories.filter((x) => x !== c))}>
                      <X size={12} />
                    </button>
                  </span>
                ))
              )}
            </div>
            {openPicker === 'territory' && (
              <div className="max-w-xl">
                <DimensionPicker key="territory" dimension="territory" value={{ include: territories }} onChange={(v) => setTerritories(v.include ?? [])} allowExclude={false} />
              </div>
            )}
            <p className="text-xs text-[var(--agent-app-muted)]">{t('Each territory or region becomes a column. A region counts as free only if all of it is free.')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DateField label={t('From')} value={start} onChange={setStart} />
            <DateField label={t('To')} value={end} onChange={setEnd} />
            <Field label={t('Deal|exclusivity')} help={t('Any licence already in place blocks an exclusive deal.')}>
              <Segmented<'non' | 'excl'>
                value={exclusive ? 'excl' : 'non'}
                onChange={(v) => setExclusive(v === 'excl')}
                ariaLabel={t('Deal|exclusivity')}
                options={[
                  { value: 'non', label: t('Non-exclusive') },
                  { value: 'excl', label: t('Exclusive') },
                ]}
              />
            </Field>
            <Field label={t('Includes voice')} help={t('For sound products, checks the performer consent (Art. 91(2)).')}>
              <div className="flex h-9 items-center">
                <Switch checked={voice} onCheckedChange={setVoice} label={voice ? t('Yes') : t('No')} />
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--agent-app-border)] pt-4">
            <Button onClick={() => void run(query)} loading={busy} disabled={assetCount(assets) === 0}>
              <Search size={14} aria-hidden /> {t('Ask|can we')}
            </Button>
            {assetCount(assets) === 0 && <span className="text-xs text-[var(--agent-app-muted)]">{t('Add at least one franchise, title, character, song or recording.')}</span>}
            {stale && !busy && <span className="text-xs text-amber-700 dark:text-amber-400">{t('The question changed since the last answer. Ask again to update it.')}</span>}
          </div>
        </div>
      </Card>

      {error !== '' && (
        <div className="mb-4">
          <ErrorBox message={error} onRetry={() => void run(query)} />
        </div>
      )}

      {result === null ? (
        <Section title={t('Answer')}>
          <EmptyHint
            icon={Scale}
            title={t('Ask before you promise')}
            message={t('Pick a character, title or song, the use and the territories. Each answer shows whether the rights are free, who decides, the trademark cover and the © line to print.')}
            action={
              <Button onClick={() => void run(query)} loading={busy} disabled={assetCount(assets) === 0}>
                {t('Ask|can we')}
              </Button>
            }
          />
        </Section>
      ) : (
        <Section
          title={t('Answer')}
          meta={`${t('{start} to {end}', { start: fmtDate(result.start), end: fmtDate(result.end) })}${ran?.exclusive === true ? `, ${t('Exclusive deal')}` : ''}`}
          flush
          actions={busy ? <Loader2 size={14} className="animate-spin text-[var(--agent-app-muted)]" aria-hidden /> : undefined}
        >
          {ran !== null && Object.keys(ran.filters).length > 0 && (
            <div className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs text-[var(--agent-app-muted)]">
              {Object.entries(ran.filters)
                .map(([k, v]) => `${dims.title(k)}: ${joinList(v.map((c) => dimLabel(k, c)))}`)
                .join(' / ')}
            </div>
          )}
          {result.rows.length === 0 ? (
            <EmptyHint compact title={t('Nothing to show')} message={t('None of the chosen records could be checked.')} />
          ) : (
            <div className={cn(busy && 'opacity-60')}>
              <CanWeGrid result={result} selected={sel} onSelect={(r, c) => setSel({ r, c })} />
            </div>
          )}
          <CanWeLegend />
        </Section>
      )}

      <div className="mt-4">
        <Notice tone="neutral">{t('Answers come from recorded agreements, windows and registrations only. They are not legal advice.')}</Notice>
      </div>

      {selRow !== undefined && selCell !== undefined && result !== null && (
        <VerdictPanel
          result={result}
          row={selRow}
          cell={selCell}
          exclusive={ran?.exclusive === true}
          canAsk={can.rights}
          onAsk={openAsk}
          onClose={() => setSel(null)}
        />
      )}
      {ask !== null && (
        <ConsentOpenDialog committeeId={ask.committeeId} subject={ask.subject} use={ask.use} useLines={ask.lines} onClose={() => setAsk(null)} />
      )}
    </div>
  );
}
