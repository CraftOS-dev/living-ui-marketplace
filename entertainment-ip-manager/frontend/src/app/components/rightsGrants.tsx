/**
 * Grants: what an agreement grants or acquires (assets, dimensions, term),
 * holdbacks, restrictions and reservations, and committee windows (the
 * holder, the window fee). The editor previews conflicts with every other
 * agreement before saving; the server refuses a conflicting outbound grant
 * unless an override reason is given, and that reason stays on the grant.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Layers, Loader2, MoreHorizontal, Pencil, Plus, Scale, ShieldAlert, Trash2 } from 'lucide-react';
import { Button, Card, Dialog, DropdownMenu, Select, Switch, Textarea, cn, getPbClient, toast } from '../../kit/index.ts';
import { canDelete, useDeleteRecord } from './deleteRecord.tsx';
import { errText, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveReload } from '../lib/live.ts';
import { d10, fmtPct, toPb } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, isJa, t } from '../lib/i18n.ts';
import { href } from '../lib/router.ts';
import type { AgreementRec, CommitteeMemberRec, GrantRec, PartyRec } from '../lib/records.ts';
import type { Bi, DimSpec, DimSpecMap } from '../lib/shapes.ts';
import { DimensionPicker, MultiRecordPicker, dimSpecLabel } from './pickers.tsx';
import { EmptyHint, Field, Notice, Pill, Prose, Section, Segmented, Tag } from './ui.tsx';
import { ASSET_EXPAND, AssetPickers, DateField, EMPTY_ASSETS, NumField, assetCount, cleanDims, expandedAssets, num, termText, useAssetHref, useRightsDims } from './rightsShared.tsx';
import type { AssetSel } from './rightsShared.tsx';
import { STATUS_TONE, statusLabel } from './rightsCanWe.tsx';

export interface ConflictItem {
  grant_index: number;
  asset: string;
  asset_type: string;
  asset_id: string;
  value: string;
  value_ja: string;
  status: string;
  reasons: { code: string; text: Bi; agreement_id?: string; ref?: string; from?: string; to?: string; counterparty?: string }[];
}

interface HolderSplit {
  party: string;
  pct: number;
}

const PARTY_SEARCH = ['name', 'name_kana', 'aliases', 'organization'];
const partyLabel = (p: PartyRec): string => p.name;

/* ------------------------------------------------------------------ */
/* Conflict panel                                                      */
/* ------------------------------------------------------------------ */

export function ConflictPanel({
  conflicts,
  checking = false,
  error = '',
  emptyText,
}: {
  conflicts: ConflictItem[] | null;
  checking?: boolean | undefined;
  error?: string | undefined;
  emptyText?: string | undefined;
}): React.JSX.Element | null {
  if (checking && conflicts === null) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
        <Loader2 size={14} className="animate-spin" aria-hidden /> {t('Checking other agreements...')}
      </div>
    );
  }
  if (error !== '') return <Notice tone="bad">{error}</Notice>;
  if (conflicts === null) return null;
  if (conflicts.length === 0) {
    return (
      <Notice tone="good" icon={CheckCircle2}>
        {emptyText ?? t('No conflicts: no other counted agreement licenses or blocks this scope in this period.')}
      </Notice>
    );
  }
  return (
    <div className="border border-red-500/30 bg-red-500/5">
      <div className="flex items-center gap-2 border-b border-red-500/20 px-3 py-2 text-[13px] font-semibold text-red-700 dark:text-red-400">
        <AlertTriangle size={14} aria-hidden />
        {t('{n} conflicts with other agreements', { n: conflicts.length })}
        {checking && <Loader2 size={13} className="ml-auto animate-spin text-[var(--agent-app-muted)]" aria-hidden />}
      </div>
      <div className="max-h-64 overflow-y-auto">
        {conflicts.map((c, i) => (
          <div key={`${c.asset_id}-${c.value}-${i}`} className="border-b border-red-500/10 px-3 py-2 last:border-0">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium">{c.asset}</span>
              <span className="text-[var(--agent-app-muted)]">/</span>
              <span className="font-medium">{isJa() ? c.value_ja || c.value : c.value}</span>
              <Pill tone={STATUS_TONE[c.status] ?? 'neutral'}>{statusLabel(c.status)}</Pill>
            </div>
            <ul className="mt-1 flex flex-col gap-1">
              {c.reasons.map((r, j) => (
                <li key={`${r.code}-${j}`} className="break-words text-xs leading-relaxed text-[var(--agent-app-text)]/85">
                  {bi(r.text)}
                  {r.agreement_id !== undefined && r.agreement_id !== '' && (
                    <>
                      {' '}
                      <a className="font-medium text-[var(--agent-app-accent)] hover:underline" href={href('agreement', r.agreement_id)}>
                        {r.ref !== undefined && r.ref !== '' ? r.ref : t('Open|action')}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grant editor                                                        */
/* ------------------------------------------------------------------ */

function kindHelp(kind: string): string {
  switch (kind) {
    case 'grant':
      return t('Rights granted (out) or acquired (in).');
    case 'holdback':
      return t('A period in which we promised not to use or license the scope.');
    case 'restriction':
      return t('A limit on our own use, for example no pachinko.');
    case 'reservation':
      return t('Rights the licensor kept for itself in an inbound licence.');
    case 'window':
      return t('A committee member decides and licenses this use category (madoguchi), for a window fee.');
    default:
      return '';
  }
}

export function GrantEditor({
  agreement,
  grant,
  members,
  windowOnly = false,
  defaultAssets,
  onClose,
  onSaved,
}: {
  agreement: AgreementRec;
  grant: GrantRec | null;
  /** Committee members: window holders are picked from them. */
  members?: CommitteeMemberRec[] | undefined;
  windowOnly?: boolean | undefined;
  defaultAssets?: AssetSel | undefined;
  onClose: () => void;
  onSaved?: (() => void) | undefined;
}): React.JSX.Element {
  const dims = useRightsDims();
  const memberParties = (members ?? []).filter((m) => m.party !== '' && m.status !== 'exited');
  const [direction, setDirection] = useState<'in' | 'out'>(grant?.direction === 'in' ? 'in' : grant?.direction === 'out' ? 'out' : agreement.direction === 'in' ? 'in' : 'out');
  const [kind, setKind] = useState<string>(grant?.kind || (windowOnly ? 'window' : 'grant'));
  const [exclusive, setExclusive] = useState<boolean>(grant?.exclusive ?? (agreement.exclusivity === 'exclusive' || agreement.exclusivity === 'sole'));
  const [assets, setAssets] = useState<AssetSel>(() =>
    grant !== null
      ? { franchises: grant.franchises, works: grant.works, characters: grant.characters, songs: grant.songs, recordings: grant.recordings, matters: grant.matters }
      : (defaultAssets ?? EMPTY_ASSETS),
  );
  const [spec, setSpec] = useState<DimSpecMap>(() => ({ ...(grant?.dims ?? {}) }));
  const [start, setStart] = useState(d10(grant?.term_start));
  const [end, setEnd] = useState(d10(grant?.term_end));
  const [holders, setHolders] = useState<string[]>(grant?.holders ?? []);
  const [split, setSplit] = useState<Record<string, number | null>>(() => {
    const out: Record<string, number | null> = {};
    if (Array.isArray(grant?.holder_split)) for (const s of grant.holder_split as HolderSplit[]) if (s !== null && typeof s === 'object') out[s.party] = Number(s.pct) || null;
    return out;
  });
  const [feePct, setFeePct] = useState<number | null>(grant?.fee_pct ? grant.fee_pct : null);
  const [feeBase, setFeeBase] = useState<string>(grant?.fee_base || 'gross');
  const [rightsText, setRightsText] = useState(grant?.rights_text ?? '');
  const [reason, setReason] = useState(grant?.override_reason ?? '');
  const [conflicts, setConflicts] = useState<ConflictItem[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const [termError, setTermError] = useState('');
  const conflictRef = useRef<HTMLDivElement | null>(null);
  const isWindow = kind === 'window';
  const count = assetCount(assets);
  const needsCheck = direction === 'out' && kind === 'grant' && count > 0;

  const draft = useMemo(
    () => ({ direction, kind, exclusive, ...assets, dims: cleanDims(spec), term_start: start, term_end: end }),
    [direction, kind, exclusive, assets, spec, start, end],
  );
  const draftKey = JSON.stringify(draft);
  const [liveTick, setLiveTick] = useState(0);
  useLiveReload(['grants', 'agreements'], () => setLiveTick((x) => x + 1), needsCheck);

  useEffect(() => {
    if (!needsCheck) {
      setConflicts(null);
      setChecking(false);
      setCheckError('');
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      op<{ conflicts: ConflictItem[]; checked: number }>('agreements/check-conflicts', { agreement_id: agreement.id, grants: [JSON.parse(draftKey) as unknown] })
        .then((r) => {
          if (cancelled) return;
          setConflicts(r.conflicts);
          setCheckError('');
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setConflicts(null);
          setCheckError(t('The conflict check could not run: {error}', { error: errText(e) }));
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draftKey, needsCheck, agreement.id, liveTick]);

  const hasConflicts = needsCheck && conflicts !== null && conflicts.length > 0;
  const needsReason = hasConflicts || refusal !== '';
  const splitTotal = holders.reduce((s, h) => s + num(split[h] ?? null), 0);

  const save = async (): Promise<void> => {
    if (!isWindow && count === 0) {
      toast.error(t('Choose at least one asset this grant covers.'));
      return;
    }
    if (isWindow && holders.length === 0) {
      toast.error(t('Choose who holds the window.'));
      return;
    }
    if (start !== '' && end !== '' && end < start) {
      setTermError(t('The end must be after the start.'));
      return;
    }
    if (needsReason && reason.trim() === '') {
      toast.error(t('Give the reason for saving over the conflict.'));
      return;
    }
    setTermError('');
    const payload: Record<string, unknown> = {
      agreement: agreement.id,
      direction,
      kind,
      exclusive: isWindow ? true : exclusive,
      ...assets,
      dims: cleanDims(spec),
      term_start: toPb(start),
      term_end: toPb(end),
      rights_text: rightsText.trim(),
      holders: isWindow ? holders : [],
      holder_split: isWindow && holders.length > 1 ? holders.map((h) => ({ party: h, pct: num(split[h] ?? null) })) : null,
      fee_pct: isWindow ? num(feePct) : 0,
      fee_base: isWindow ? feeBase : '',
      override_reason: needsReason ? reason.trim() : '',
    };
    setBusy(true);
    try {
      const client = getPbClient();
      if (grant !== null) await client.call((p) => p.collection('grants').update<GrantRec>(grant.id, payload), { silent: true });
      else await client.call((p) => p.collection('grants').create<GrantRec>(payload), { silent: true });
      toast.success(needsReason ? t('Saved over the conflict. The reason is kept on the grant and in the history.') : isWindow ? t('Window saved') : t('Grant saved'));
      onSaved?.();
      onClose();
    } catch (e) {
      const status = typeof e === 'object' && e !== null && 'status' in e ? Number((e as { status: unknown }).status) : 0;
      const message = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e);
      if (status === 400 && !needsReason && direction === 'out' && kind === 'grant') {
        // The server found a conflict the preview did not show yet: show its reason and ask for an override.
        setRefusal(message);
        setTimeout(() => conflictRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const kindOptions = enumOptions('grants.kind')
    .filter(([v]) => (windowOnly ? v === 'window' : true))
    .map(([value, label]) => ({ value, label }));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={grant !== null ? (isWindow ? t('Edit window') : t('Edit grant')) : isWindow ? t('Add a window') : t('Add a grant')}
      description={isWindow ? t('Which use category this member decides and licenses, where, for how long, and the window fee.') : t('One slice of rights: which assets, where, in which media and for how long. Leave a dimension empty to cover all of it.')}
      className="w-[min(96vw,52rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={busy || (needsCheck && checking)} variant={needsReason ? 'danger' : 'primary'}>
            {needsReason ? t('Save despite the conflict') : t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[66vh] flex-col gap-4 overflow-y-auto pr-1">
        {needsCheck && (checking || hasConflicts) && (
          <button
            type="button"
            onClick={() => conflictRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className={cn(
              'flex items-center gap-2 border px-3 py-1.5 text-left text-xs',
              hasConflicts ? 'border-red-500/30 bg-red-500/5 font-medium text-red-700 dark:text-red-400' : 'border-[var(--agent-app-border)] text-[var(--agent-app-muted)]',
            )}
          >
            {hasConflicts ? <AlertTriangle size={13} aria-hidden /> : <Loader2 size={13} className="animate-spin" aria-hidden />}
            {hasConflicts ? t('Conflicts with other agreements. See them below and give a reason to save anyway.') : t('Checking this grant against other agreements...')}
          </button>
        )}

        {!windowOnly && (
          <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
            <Field label={t('Direction')}>
              <Segmented<'in' | 'out'>
                value={direction}
                onChange={setDirection}
                ariaLabel={t('Direction')}
                options={[
                  { value: 'in', label: t('Rights in') },
                  { value: 'out', label: t('Rights out') },
                ]}
              />
            </Field>
            <Field label={t('Kind')} help={kindHelp(kind)}>
              <Select aria-label={t('Kind')} value={kind} options={kindOptions} onChange={(e) => setKind(e.target.value)} />
            </Field>
            {!isWindow && (
              <div className="pb-2">
                <Switch checked={exclusive} onCheckedChange={setExclusive} label={t('Exclusive')} />
              </div>
            )}
          </div>
        )}

        {isWindow && (
          <div className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-3">
            <span className="text-[13px] font-medium">{t('Window holder')}</span>
            {memberParties.length > 0 ? (
              <div className="flex flex-col gap-2">
                {memberParties.map((m) => {
                  const checked = holders.includes(m.party);
                  return (
                    <div key={m.id} className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex min-w-0 items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-[var(--agent-app-accent)]"
                          checked={checked}
                          onChange={(e) => setHolders(e.target.checked ? [...holders, m.party] : holders.filter((h) => h !== m.party))}
                        />
                        <span className="truncate">{m.name || m.expand?.['party']?.name || m.party}</span>
                      </label>
                      {checked && holders.length > 1 && (
                        <div className="w-32">
                          <NumField label={t('Split|window')} value={split[m.party] ?? null} onChange={(v) => setSplit((s) => ({ ...s, [m.party]: v }))} suffix="%" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <MultiRecordPicker<PartyRec> collection="parties" label={t('Holders|window')} value={holders} onChange={setHolders} labelOf={partyLabel} searchFields={PARTY_SEARCH} />
            )}
            {holders.length > 1 && Math.abs(splitTotal - 100) > 0.01 && <p className="text-xs text-amber-700 dark:text-amber-400">{t('A shared window splits 100%. Now: {n}%.', { n: splitTotal })}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <NumField label={t('Window fee')} value={feePct} onChange={setFeePct} suffix="%" help={t('The holder keeps this share of the receipts before they flow to the committee.')} />
              <Field label={t('Fee base')}>
                <Segmented<string>
                  value={feeBase}
                  onChange={setFeeBase}
                  ariaLabel={t('Fee base')}
                  options={enumOptions('grants.fee_base').map(([value, label]) => ({ value, label }))}
                />
              </Field>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{isWindow ? t('Assets (optional for a window)') : t('Assets|grant')}</span>
          <AssetPickers value={assets} onChange={setAssets} />
          <p className="text-xs text-[var(--agent-app-muted)]">{t('A grant on a franchise covers its titles and characters. Pick the narrowest assets the contract names.')}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {dims.enabled.map((k) => (
            <DimensionPicker key={k} dimension={k} label={dims.title(k)} value={spec[k] ?? {}} onChange={(v: DimSpec) => setSpec((s) => ({ ...s, [k]: v }))} />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DateField label={t('Starts|grant')} value={start} onChange={setStart} help={t('Leave empty to follow the agreement term.')} />
          <DateField label={t('Ends|grant')} value={end} error={termError} onChange={setEnd} help={t('Leave empty to follow the agreement term.')} />
        </div>

        <div className="flex scroll-mt-2 flex-col gap-3" ref={conflictRef}>
          {needsCheck && <ConflictPanel conflicts={conflicts} checking={checking} error={checkError} />}
          {refusal !== '' && (
            <Notice tone="bad" icon={ShieldAlert}>
              <div className="font-medium">{t('The server refused this grant:')}</div>
              <div className="mt-1 break-words">{refusal}</div>
            </Notice>
          )}
          {needsReason && (
            <Field label={t('Override reason')} required help={t('Saving over a conflict is recorded in the history with this reason, and the reason stays on the grant.')}>
              <Textarea rows={2} value={reason} placeholder={t('For example: the other licence ends before ours starts; confirmed with the licensee')} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </div>

        <Textarea label={t("Rights in the contract's words")} rows={3} value={rightsText} onChange={(e) => setRightsText(e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Grant card                                                          */
/* ------------------------------------------------------------------ */

export function GrantCard({
  g,
  agreement,
  onEdit,
  onDelete,
}: {
  g: GrantRec;
  agreement: AgreementRec;
  onEdit: (() => void) | null;
  onDelete: (() => void) | null;
}): React.JSX.Element {
  const { dimValues } = useApp();
  const dims = useRightsDims();
  const linkOf = useAssetHref();
  const assets = expandedAssets(g);
  const shown = dims.keys.filter((k) => {
    const s = g.dims?.[k];
    return dims.enabled.includes(k) || (s !== undefined && ((s.include ?? []).length > 0 || (s.exclude ?? []).length > 0));
  });
  const term = termText({ term_start: g.term_start, term_end: g.term_end }) || t('Agreement term');
  const holderRecs = ((g.expand ?? {}) as Record<string, unknown>)['holders'];
  const holderNames = Array.isArray(holderRecs) ? (holderRecs as PartyRec[]).map((p) => p.name) : [];
  const menu = [
    ...(onEdit !== null ? [{ label: t('Edit'), icon: <Pencil size={14} />, onSelect: onEdit }] : []),
    ...(onDelete !== null ? [{ label: t('Delete'), icon: <Trash2 size={14} />, onSelect: onDelete, danger: true }] : []),
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] px-4 py-2.5">
        <span className="text-[13px] font-semibold">{enumLabel('grants.kind', g.kind)}</span>
        <Tag>{enumLabel('grants.direction', g.direction)}</Tag>
        {g.kind !== 'window' && <Tag>{g.exclusive ? t('Exclusive') : t('Non-exclusive')}</Tag>}
        {g.override_reason !== '' && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" title={t('Saved over a conflict')}>
            <ShieldAlert size={12} aria-hidden /> {t('Override|grant')}
          </span>
        )}
        {menu.length > 0 && (
          <div className="ml-auto">
            <DropdownMenu
              align="right"
              trigger={
                <span className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-border)]/30" aria-label={t('More actions')}>
                  <MoreHorizontal size={15} />
                </span>
              }
              items={menu}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        {g.kind === 'window' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <span>
              <span className="text-[var(--agent-app-muted)]">{t('Window holder')}: </span>
              <span className="font-medium">{holderNames.length > 0 ? holderNames.join(isJa() ? '・' : ', ') : '-'}</span>
            </span>
            {g.fee_pct > 0 && (
              <span>
                <span className="text-[var(--agent-app-muted)]">{t('Window fee')}: </span>
                {t('{pct} of {base}', { pct: fmtPct(g.fee_pct), base: enumLabel('grants.fee_base', g.fee_base || 'net') })}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {assets.map((a) => {
            const to = linkOf(a.type, a.id);
            return to !== '' ? (
              <a key={`${a.type}:${a.id}`} href={to} className="inline-flex max-w-full items-center truncate border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-0.5 text-xs hover:border-[var(--agent-app-accent)]/60">
                {a.label}
              </a>
            ) : (
              <span key={`${a.type}:${a.id}`} className="inline-flex max-w-full items-center truncate border border-[var(--agent-app-border)] px-2 py-0.5 text-xs">
                {a.label}
              </span>
            );
          })}
          {assets.length === 0 && g.kind !== 'window' && <span className="text-xs text-[var(--agent-app-muted)]">{t('No assets chosen. This grant is not counted until it names what it covers.')}</span>}
          {assets.length === 0 && g.kind === 'window' && <span className="text-xs text-[var(--agent-app-muted)]">{t('Covers every asset of the committee.')}</span>}
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((k) => (
            <div key={k} className="min-w-0">
              <div className="text-[11px] text-[var(--agent-app-muted)]">{dims.title(k)}</div>
              <div className="break-words text-[13px]">{dimSpecLabel(dimValues.filter((v) => v.dimension === k), g.dims?.[k])}</div>
            </div>
          ))}
          <div className="min-w-0">
            <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Period')}</div>
            <div className="text-[13px] tabular-nums">{term}</div>
          </div>
        </div>
        {g.rights_text !== '' && <Prose className="border-l-2 border-[var(--agent-app-border)] pl-3 text-[var(--agent-app-text)]/85">{g.rights_text}</Prose>}
        {g.override_reason !== '' && (
          <Notice tone="warn" icon={ShieldAlert}>
            {t('Saved over a conflict: {reason}', { reason: g.override_reason })}
          </Notice>
        )}
        {agreement.status === 'draft' && <p className="text-xs text-[var(--agent-app-muted)]">{t('The agreement is a draft, so this grant does not count in Can we? yet.')}</p>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Grants tab                                                          */
/* ------------------------------------------------------------------ */

export function GrantsPanel({ agreement }: { agreement: AgreementRec }): React.JSX.Element {
  const { can } = useApp();
  const grants = useCollection<GrantRec>('grants', { filter: `agreement = "${agreement.id}"`, sort: 'created', expand: `${ASSET_EXPAND},holders` });
  const [editing, setEditing] = useState<GrantRec | 'new' | null>(null);
  const del = useDeleteRecord();
  const [check, setCheck] = useState<{ conflicts: ConflictItem[] | null; checking: boolean; error: string } | null>(null);

  const remove = (g: GrantRec): void =>
    del.ask('grants', g.id, undefined, t('Can we? and conflict checks stop counting this grant.'));

  const checkAll = async (): Promise<void> => {
    setCheck({ conflicts: null, checking: true, error: '' });
    try {
      const r = await op<{ conflicts: ConflictItem[]; checked: number }>('agreements/check-conflicts', { agreement_id: agreement.id });
      setCheck({ conflicts: r.conflicts, checking: false, error: '' });
    } catch (e) {
      setCheck({ conflicts: null, checking: false, error: errText(e) });
    }
  };

  const assetParam = [
    ...new Set(
      grants.records.flatMap((g) => [
        ...g.franchises.map((x) => `franchise:${x}`),
        ...g.works.map((x) => `work:${x}`),
        ...g.characters.map((x) => `character:${x}`),
        ...g.songs.map((x) => `song:${x}`),
        ...g.recordings.map((x) => `recording:${x}`),
      ]),
    ),
  ].join(',');
  const hasOut = grants.records.some((g) => g.direction === 'out' && g.kind === 'grant');

  return (
    <div className="flex flex-col gap-4">
      {del.element}
      <Section
        title={t('Grants|tab')}
        meta={grants.records.length ? String(grants.records.length) : undefined}
        actions={
          <>
            {assetParam !== '' && (
              <a href={href('canwe', undefined, { asset: assetParam })} className="hidden items-center gap-1 text-xs font-medium text-[var(--agent-app-accent)] hover:underline sm:inline-flex">
                <Scale size={12} aria-hidden /> {t('Can we?')}
              </a>
            )}
            {hasOut && (
              <Button size="sm" variant="outline" onClick={() => void checkAll()} loading={check?.checking === true}>
                {t('Check conflicts')}
              </Button>
            )}
            {can.edit && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus size={13} aria-hidden /> {t('Add grant')}
              </Button>
            )}
          </>
        }
      >
        {grants.loading ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Loading')}</p>
        ) : grants.records.length === 0 ? (
          <EmptyHint
            compact
            icon={Layers}
            title={t('No grants yet')}
            message={t('Add what this agreement grants or acquires: which assets, where, in which media and for how long. Can we? and the conflict checks read these.')}
            action={
              can.edit ? (
                <Button size="sm" onClick={() => setEditing('new')}>
                  {t('Add a grant')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Each card is one slice of rights. Dimensions marked All cover everything.')}</p>
        )}
        {check !== null && (
          <div className="mt-3">
            <ConflictPanel conflicts={check.conflicts} checking={check.checking} error={check.error} emptyText={t('No conflicts: nothing in the other counted agreements overlaps the rights out here.')} />
          </div>
        )}
      </Section>

      {grants.records.map((g) => (
        <GrantCard key={g.id} g={g} agreement={agreement} onEdit={can.edit ? () => setEditing(g) : null} onDelete={canDelete(can, 'grants') ? () => remove(g) : null} />
      ))}

      {editing !== null && <GrantEditor agreement={agreement} grant={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={grants.refresh} />}
    </div>
  );
}
