/**
 * Add a shop: open a new one (with its setup checklist) or add one you have.
 * Three steps: the path, the platform, the details. After adding, the shop's
 * page opens. Also home of the "how orders come in" chooser the shop page
 * uses.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileUp, Link2, PenLine, Rocket, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { errMessage, op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import { useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { Catalog, Platform, Shop, ShopDetail } from '../lib/types.ts';
import { PlatformMark } from './PlatformMark.tsx';
import { Button, Dialog, Field, Select, SearchField, Skeleton, TextInput } from './ui.tsx';

/* ------------------------------------------------- how orders come in */

export type Connection = Shop['connection'];

const CONNECTIONS: { key: Connection; title: string; line: string; icon: LucideIcon }[] = [
  { key: 'agent', title: 'Your AI agent syncs it', line: 'Orders, messages and listings', icon: Sparkles },
  { key: 'files', title: 'Import files', line: 'Seller-centre exports', icon: FileUp },
  { key: 'manual', title: 'Add orders yourself', line: 'Typed in as they come', icon: PenLine },
];

/** Three radio cards: agent, files, manual. */
export function ConnectionChoice({ value, onChange, disabled = false, className }: { value: Connection; onChange: (c: Connection) => void; disabled?: boolean; className?: string }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="How orders come in" className={cn('grid gap-2 sm:grid-cols-3', className)}>
      {CONNECTIONS.map((c) => {
        const on = c.key === value;
        const Icon = c.icon;
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => !on && onChange(c.key)}
            className={cn(
              'so-press flex min-h-[72px] items-start gap-3 rounded-[14px] p-3 text-left disabled:opacity-60',
              on ? 'bg-[var(--so-card)] shadow-[inset_0_0_0_2px_var(--so-ink)]' : 'bg-[var(--so-tile)] hover:bg-[var(--so-tile-hover)]',
            )}
          >
            <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', on ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'bg-[var(--so-card)] text-[var(--so-ink)]')}>
              <Icon size={15} strokeWidth={2} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-[18px]">{c.title}</span>
              <span className="mt-0.5 block text-[12px] leading-[16px] text-[var(--so-muted)]">{c.line}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

export function countryName(catalog: Catalog | null, code: string): string {
  if (code === '') return '';
  return catalog?.countries.find((c) => c.code === code)?.name ?? code;
}

/** The countries a platform sells in ('*' means every country we know). */
export function platformCountries(catalog: Catalog | null, platform: Platform | undefined): Catalog['countries'] {
  const all = catalog?.countries ?? [];
  if (platform === undefined || platform.regions.includes('*')) return all;
  return all.filter((c) => platform.regions.includes(c.code));
}

/** "Shopee MY", or "Shopee MY 2" when that name is taken. */
function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) if (!taken.has((base + ' ' + i).toLowerCase())) return base + ' ' + i;
  return base;
}

function sells(p: Platform, country: string): boolean {
  return p.regions.includes('*') || (country !== '' && p.regions.includes(country));
}

/* ---------------------------------------------------------------- dialog */

type Path = 'new' | 'have';
type Step = 1 | 2 | 3;

export function AddShopDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const { catalog, settings, shops } = useStore();
  const [step, setStep] = useState<Step>(1);
  const [path, setPath] = useState<Path>('have');
  const [query, setQuery] = useState('');
  const [platformId, setPlatformId] = useState('');
  const [name, setName] = useState('');
  const [nameAuto, setNameAuto] = useState(true);
  const [region, setRegion] = useState('');
  const [currency, setCurrency] = useState('');
  const [currencyAuto, setCurrencyAuto] = useState(true);
  const [url, setUrl] = useState('');
  const [connection, setConnection] = useState<Connection>('agent');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setQuery('');
    setPlatformId('');
    setName('');
    setNameAuto(true);
    setRegion('');
    setCurrency('');
    setCurrencyAuto(true);
    setUrl('');
    setConnection('agent');
    setError('');
    setBusy(false);
  }, [open]);

  const home = settings?.country ?? '';
  const taken = useMemo(() => new Set(shops.map((s) => s.name.toLowerCase())), [shops]);
  const platforms = useMemo(() => (catalog?.platforms ?? []).filter((p) => p.id !== 'direct'), [catalog]);
  const platform = platforms.find((p) => p.id === platformId);
  const countries = platformCountries(catalog, platform);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = platforms.filter((p) => q === '' || p.name.toLowerCase().includes(q) || p.blurb.toLowerCase().includes(q));
    if (home === '') return [{ title: 'Platforms', list: hit }];
    return [
      { title: 'In ' + countryName(catalog, home), list: hit.filter((p) => sells(p, home)) },
      { title: 'Other platforms', list: hit.filter((p) => !sells(p, home)) },
    ];
  }, [platforms, query, home, catalog]);

  const currencyOf = (code: string): string => catalog?.countries.find((c) => c.code === code)?.currency ?? settings?.base_currency ?? '';

  const pick = (p: Platform): void => {
    const list = platformCountries(catalog, p);
    const r = list.some((c) => c.code === home) ? home : (list[0]?.code ?? '');
    setPlatformId(p.id);
    setRegion(r);
    setCurrency(currencyOf(r));
    setCurrencyAuto(true);
    setName(freeName(p.name + (r !== '' ? ' ' + r : ''), taken));
    setNameAuto(true);
    setConnection(p.id === 'other' ? 'manual' : 'agent');
    setError('');
    setStep(3);
  };

  const changeRegion = (r: string): void => {
    setRegion(r);
    if (currencyAuto) setCurrency(currencyOf(r));
    if (nameAuto && platform !== undefined) setName(freeName(platform.name + (r !== '' ? ' ' + r : ''), taken));
  };

  const trimmed = name.trim();
  const nameError = trimmed === '' ? 'A shop needs a name' : taken.has(trimmed.toLowerCase()) ? 'You already have a shop with this name' : '';

  const submit = async (): Promise<void> => {
    if (platform === undefined || nameError !== '') return;
    setBusy(true);
    setError('');
    try {
      const res = await op<{ shop: ShopDetail }>(
        'shops.add',
        { platform: platform.id, opening: path === 'new', name: trimmed, region, currency, url: url.trim() === '' ? undefined : url.trim(), connection },
        { quiet: true },
      );
      changed('shops', 'activity');
      notify.info(path === 'new' ? 'Shop started' : 'Shop added');
      onClose();
      go('shop', res.shop.id);
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  };

  const subtitle = step === 1 ? 'Step 1 of 3' : step === 2 ? 'Step 2 of 3: the platform' : 'Step 3 of 3: the details';

  const footer =
    step === 1 ? undefined : (
      <>
        <Button variant="tile" icon={ArrowLeft} onClick={() => setStep(step === 3 ? 2 : 1)} disabled={busy}>
          Back
        </Button>
        {step === 3 && (
          <Button onClick={() => void submit()} loading={busy} disabled={nameError !== '' || platform === undefined}>
            Add shop
          </Button>
        )}
      </>
    );

  return (
    <Dialog open={open} onClose={onClose} title={path === 'new' && step > 1 ? 'Open a new shop' : 'Add a shop'} subtitle={subtitle} width={720} {...(footer !== undefined ? { footer } : {})}>
      {step === 1 && (
        <div className="grid gap-3 pb-3 sm:grid-cols-2">
          <PathTile
            icon={Rocket}
            title="Open a new shop"
            line="A setup checklist guides account, verification, payouts, shipping, policies and first listings."
            onClick={() => {
              setPath('new');
              setStep(2);
            }}
          />
          <PathTile
            icon={Link2}
            title="Add a shop I have"
            line="Bring in its orders, messages and listings."
            onClick={() => {
              setPath('have');
              setStep(2);
            }}
          />
        </div>
      )}

      {step === 2 && (
        <div className="pb-3">
          <SearchField value={query} onChange={setQuery} placeholder="Search platforms" autoFocus className="mb-4" />
          {catalog === null && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-[124px] rounded-[16px]" />
              ))}
            </div>
          )}
          {catalog !== null && groups.every((g) => g.list.length === 0) && <p className="py-8 text-center text-[13px] text-[var(--so-muted)]">No platform called "{query}". Pick Other for any other site.</p>}
          {groups.map((g) =>
            g.list.length === 0 ? null : (
              <div key={g.title} className="mb-4">
                <p className="mb-2 text-[12px] font-semibold text-[var(--so-muted)]">{g.title}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {g.list.map((p) => (
                    <button key={p.id} type="button" onClick={() => pick(p)} className="so-press flex min-h-[124px] flex-col items-start gap-2 rounded-[16px] bg-[var(--so-tile)] p-3 text-left hover:bg-[var(--so-tile-hover)]">
                      <PlatformMark platform={p.id} size={40} onCard={false} />
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold leading-[20px]">{p.name}</span>
                        <span className="mt-0.5 block text-[12px] leading-[16px] text-[var(--so-muted)]">{p.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {step === 3 && platform !== undefined && (
        <form
          className="grid gap-4 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-center gap-3 rounded-[14px] bg-[var(--so-tile)] p-3">
            <PlatformMark platform={platform.id} size={40} onCard={false} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">{platform.name}</p>
              <p className="truncate text-[12px] text-[var(--so-muted)]">{platform.blurb}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
              Change
            </Button>
          </div>
          <Field label="Shop name" error={trimmed !== '' ? nameError : ''}>
            <TextInput
              value={name}
              autoFocus
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value);
                setNameAuto(false);
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Country">
              <Select value={region} onChange={(e) => changeRegion(e.target.value)}>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency">
              <Select
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  setCurrencyAuto(false);
                }}
              >
                {(catalog?.currencies ?? []).concat(currency !== '' && !(catalog?.currencies ?? []).includes(currency) ? [currency] : []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Shop link" hint="Optional">
            <TextInput type="url" inputMode="url" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-[var(--so-ink-2)]">How orders come in</p>
            <ConnectionChoice value={connection} onChange={setConnection} />
          </div>
          {error !== '' && <p className="rounded-[12px] bg-[var(--so-red-soft)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--so-red-text)]">{error}</p>}
          <button type="submit" hidden tabIndex={-1} />
        </form>
      )}
    </Dialog>
  );
}

function PathTile({ icon: Icon, title, line, onClick }: { icon: LucideIcon; title: string; line: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="so-press flex min-h-[168px] flex-col items-start gap-4 rounded-[18px] bg-[var(--so-tile)] p-5 text-left hover:bg-[var(--so-tile-hover)]">
      <span className="flex size-12 items-center justify-center rounded-full bg-[var(--so-primary)] text-[var(--so-on-primary)]">
        <Icon size={22} strokeWidth={2} aria-hidden />
      </span>
      <span>
        <span className="block text-[15px] font-semibold leading-[22px]">{title}</span>
        <span className="mt-1 block text-[13px] leading-[19px] text-[var(--so-muted)]">{line}</span>
      </span>
    </button>
  );
}
