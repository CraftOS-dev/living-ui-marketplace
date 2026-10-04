/**
 * An agreement's rights scope: the grants (what, where, in which media,
 * for how long), a one-line summary per grant, the grant editor with a
 * live conflict check against every other active agreement, and the
 * conflict panel that names the agreements in the way.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Globe2, Layers, Loader2, MoreHorizontal, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import type { RecordModel } from 'pocketbase';
import { Button, Card, Dialog, DropdownMenu, Select, Switch, Textarea, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection, useLiveReload } from '../lib/live.ts';
import { createRecord, deleteRecord, errText, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, toPb } from '../lib/format.ts';
import { DIRECTION_LABEL } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { AgreementRec, ConflictItem, DimSpec, DimensionRec, DimensionValueRec, GrantRec, MatterRec, PropertyRec, WorkRec } from '../lib/types.ts';
import { DimensionPicker, MultiRecordPicker, dimSpecLabel } from './pickers.tsx';
import { EmptyHint, Field, Notice, Pill, Prose, Ref, Section, Segmented, Tag } from './ui.tsx';
import {
  AVAIL_LABEL,
  AVAIL_TONE,
  DateField,
  DirectionPill,
  GRANT_KIND_HELP,
  GRANT_KIND_LABEL,
  availStatus,
  cleanDims,
  enabledDims,
  expandMany,
  specPhrase,
} from './dealsShared.tsx';

const WORK_SEARCH = ['title'];
const PROPERTY_SEARCH = ['name'];
const MATTER_SEARCH = ['ref', 'title', 'application_no', 'registration_no'];
const workLabel = (w: WorkRec): string => w.title;
const propertyLabel = (p: PropertyRec): string => p.name;
const matterLabel = (m: MatterRec): string => `${m.ref} ${m.title}`.trim();

const KIND_OPTIONS = (Object.keys(GRANT_KIND_LABEL) as GrantRec['kind'][]).map((k) => ({ value: k, label: GRANT_KIND_LABEL[k] }));

/* ------------------------------------------------------------------ */
/* Summary sentence                                                    */
/* ------------------------------------------------------------------ */

function grantEnd(g: GrantRec, a: AgreementRec): string {
  const end = d10(g.term_end);
  if (end !== '') return `until ${fmtDate(end)}`;
  if (a.perpetual) return 'with no end date';
  const aEnd = d10(a.term_end);
  return aEnd !== '' ? `until ${fmtDate(aEnd)}` : '';
}

/** "Rights out: exclusive SVOD in United States, Canada for Moonlit Harbor until 30 Jun 2028" */
export function grantSentence(g: GrantRec, a: AgreementRec, dims: DimensionRec[], values: DimensionValueRec[], assetNames: string[]): string {
  const valuesOf = (key: string): DimensionValueRec[] => values.filter((v) => v.dimension === key);
  const what: string[] = [];
  let where = 'worldwide';
  for (const dim of dims) {
    const p = specPhrase(valuesOf(dim.key), g.dims?.[dim.key]);
    if (dim.key === 'territory') {
      where = p.values !== '' ? `in ${p.values}` : 'worldwide';
      if (p.excluded !== '') where += ` excl. ${p.excluded}`;
      continue;
    }
    if (p.values !== '') what.push(p.values + (p.excluded !== '' ? ` excl. ${p.excluded}` : ''));
    else if (p.excluded !== '') what.push(`all ${dim.label.toLowerCase()} excl. ${p.excluded}`);
  }
  const head = g.kind === 'grant' ? (DIRECTION_LABEL[g.direction] ?? g.direction) : GRANT_KIND_LABEL[g.kind];
  const excl = g.kind === 'grant' ? (g.exclusive ? 'exclusive ' : 'non-exclusive ') : '';
  const scope = what.length > 0 ? what.join(', ') : 'rights';
  const assets = assetNames.length > 0 ? ` for ${assetNames.join(', ')}` : '';
  const end = grantEnd(g, a);
  return `${head}: ${excl}${scope} ${where}${assets}${end !== '' ? ` ${end}` : ''}`;
}

function assetNamesOf(g: RecordModel): { works: WorkRec[]; properties: PropertyRec[]; matters: MatterRec[] } {
  return {
    works: expandMany<WorkRec>(g, 'works'),
    properties: expandMany<PropertyRec>(g, 'properties'),
    matters: expandMany<MatterRec>(g, 'matters'),
  };
}

/* ------------------------------------------------------------------ */
/* Conflict panel                                                      */
/* ------------------------------------------------------------------ */

export function ConflictPanel({
  conflicts,
  checking = false,
  error = '',
  emptyText = 'No conflicts: no other active agreement licenses or blocks this scope in this window.',
}: {
  conflicts: ConflictItem[] | null;
  checking?: boolean | undefined;
  error?: string | undefined;
  emptyText?: string | undefined;
}): React.JSX.Element | null {
  if (checking && conflicts === null) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
        <Loader2 size={14} className="animate-spin" aria-hidden /> Checking other agreements...
      </div>
    );
  }
  if (error !== '') return <Notice tone="bad">{error}</Notice>;
  if (conflicts === null) return null;
  if (conflicts.length === 0) {
    return (
      <Notice tone="good" icon={CheckCircle2}>
        {emptyText}
        {checking && <span className="ml-1 text-[var(--agent-app-muted)]">(rechecking)</span>}
      </Notice>
    );
  }
  return (
    <div className="border border-red-500/30 bg-red-500/5">
      <div className="flex items-center gap-2 border-b border-red-500/20 px-3 py-2 text-[13px] font-semibold text-red-700 dark:text-red-400">
        <AlertTriangle size={14} aria-hidden />
        {conflicts.length === 1 ? '1 conflict with other agreements' : `${conflicts.length} conflicts with other agreements`}
        {checking && <Loader2 size={13} className="ml-auto animate-spin text-[var(--agent-app-muted)]" aria-hidden />}
      </div>
      <div className="max-h-64 overflow-y-auto">
        {conflicts.map((c, i) => {
          const st = availStatus(c.status);
          return (
            <div key={`${c.asset_id}-${c.value}-${i}`} className="border-b border-red-500/10 px-3 py-2 last:border-0">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium">{c.asset}</span>
                <span className="text-[var(--agent-app-muted)]">in</span>
                <span className="font-medium">{c.value}</span>
                <Pill tone={AVAIL_TONE[st]}>{AVAIL_LABEL[st]}</Pill>
              </div>
              <ul className="mt-1 flex flex-col gap-1">
                {c.reasons.map((r, j) => (
                  <li key={`${r.code}-${j}`} className="text-xs leading-relaxed text-[var(--agent-app-text)]/85">
                    {r.text}
                    {r.agreement_id !== undefined && r.agreement_id !== '' && (
                      <>
                        {' '}
                        <a className="font-medium text-[var(--agent-app-accent)] hover:underline" href={href('agreement', r.agreement_id)}>
                          Open {r.ref !== undefined && r.ref !== '' ? r.ref : 'agreement'}
                        </a>
                      </>
                    )}
                    {r.from !== undefined && r.to !== undefined && r.from !== '' && (
                      <span className="text-[var(--agent-app-muted)]">
                        {' '}
                        (overlap {fmtDate(r.from)} to {fmtDate(r.to)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grant editor                                                        */
/* ------------------------------------------------------------------ */

export function GrantEditor({
  agreement,
  grant,
  onClose,
  onSaved,
}: {
  agreement: AgreementRec;
  grant: GrantRec | null;
  onClose: () => void;
  onSaved?: (() => void) | undefined;
}): React.JSX.Element {
  const { dimensions, vocab } = useApp();
  const dims = useMemo(() => enabledDims(dimensions), [dimensions]);
  const [direction, setDirection] = useState<GrantRec['direction']>(grant?.direction ?? (agreement.direction === 'in' ? 'in' : 'out'));
  const [kind, setKind] = useState<GrantRec['kind']>(grant?.kind ?? 'grant');
  const [exclusive, setExclusive] = useState<boolean>(grant?.exclusive ?? (agreement.exclusivity === 'exclusive' || agreement.exclusivity === 'sole'));
  const [works, setWorks] = useState<string[]>(grant?.works ?? []);
  const [props, setProps] = useState<string[]>(grant?.properties ?? []);
  const [matters, setMatters] = useState<string[]>(grant?.matters ?? []);
  const [spec, setSpec] = useState<Record<string, DimSpec>>(() => ({ ...(grant?.dims ?? {}) }));
  const [start, setStart] = useState(d10(grant?.term_start));
  const [end, setEnd] = useState(d10(grant?.term_end));
  const [rightsText, setRightsText] = useState(grant?.rights_text ?? '');
  const [reason, setReason] = useState(grant?.override_reason ?? '');
  const [conflicts, setConflicts] = useState<ConflictItem[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [busy, setBusy] = useState(false);
  const [termError, setTermError] = useState('');
  const conflictRef = useRef<HTMLDivElement | null>(null);

  const assetCount = works.length + props.length + matters.length;
  const needsCheck = direction === 'out' && kind === 'grant' && assetCount > 0;
  const draft = useMemo(
    () => ({ direction, kind, exclusive, properties: props, works, matters, dims: cleanDims(spec), term_start: start, term_end: end }),
    [direction, kind, exclusive, props, works, matters, spec, start, end],
  );
  const draftKey = JSON.stringify(draft);
  // Another deal signed meanwhile (by a colleague or an agent) can create a
  // conflict; re-check live.
  const [liveTick, setLiveTick] = useState(0);
  useLiveReload(['grants', 'agreements', 'works', 'properties', 'matters'], () => setLiveTick((t) => t + 1), needsCheck);

  useEffect(() => {
    if (!needsCheck) {
      setConflicts(null);
      setChecking(false);
      setCheckError('');
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(() => {
      op<{ conflicts: ConflictItem[]; checked: number }>('agreements/check-conflicts', { agreement_id: agreement.id, grants: [JSON.parse(draftKey) as unknown] })
        .then((r) => {
          if (cancelled) return;
          setConflicts(r.conflicts);
          setCheckError('');
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setConflicts(null);
          setCheckError(`The conflict check could not run: ${errText(e)}`);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draftKey, needsCheck, agreement.id, liveTick]);

  const hasConflicts = needsCheck && conflicts !== null && conflicts.length > 0;
  const blocked = busy || (needsCheck && checking) || (hasConflicts && reason.trim() === '');

  const save = async (): Promise<void> => {
    if (assetCount === 0) {
      toast.error(`Choose at least one ${vocab.work.toLowerCase()}, ${vocab.property.toLowerCase()} or registration.`);
      return;
    }
    if (start !== '' && end !== '' && end <= start) {
      setTermError('The end must be after the start.');
      return;
    }
    setTermError('');
    const overrideReason = hasConflicts ? reason.trim() : '';
    const payload: Record<string, unknown> = {
      agreement: agreement.id,
      direction,
      kind,
      exclusive,
      works,
      properties: props,
      matters,
      dims: cleanDims(spec),
      term_start: toPb(start),
      term_end: toPb(end),
      rights_text: rightsText.trim(),
    };
    setBusy(true);
    try {
      if (grant !== null) {
        await updateRecord<GrantRec>('grants', grant.id, { ...payload, override_reason: overrideReason });
      } else {
        const created = await createRecord<GrantRec>('grants', { ...payload, override_reason: '' });
        // Recorded as its own change so the audit log carries the reason.
        if (overrideReason !== '') await updateRecord<GrantRec>('grants', created.id, { override_reason: overrideReason });
      }
      toast.success(hasConflicts ? 'Saved over the conflict. The override and your reason are in the history.' : 'Grant saved');
      onSaved?.();
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={grant !== null ? 'Edit grant' : 'Add a grant'}
      description="One slice of rights: which assets, where, in which media and for how long. Leave a dimension empty to cover all of it."
      className="w-[min(96vw,50rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={blocked} variant={hasConflicts ? 'danger' : 'primary'}>
            {hasConflicts ? 'Save despite the conflict' : 'Save grant'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
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
            {hasConflicts
              ? `${conflicts.length === 1 ? '1 conflict' : `${conflicts.length} conflicts`} with other agreements. See the details and give a reason below.`
              : 'Checking this grant against other agreements...'}
          </button>
        )}
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <Field label="Direction">
            <Segmented<GrantRec['direction']>
              value={direction}
              onChange={setDirection}
              ariaLabel="Direction"
              options={[
                { value: 'in', label: 'Rights in' },
                { value: 'out', label: 'Rights out' },
              ]}
            />
          </Field>
          <Field label="Kind" help={GRANT_KIND_HELP[kind]}>
            <Select aria-label="Kind" value={kind} options={KIND_OPTIONS} onChange={(e) => setKind(e.target.value as GrantRec['kind'])} />
          </Field>
          <div className="pb-2">
            <Switch checked={exclusive} onCheckedChange={setExclusive} label="Exclusive" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <MultiRecordPicker<WorkRec>
            collection="works"
            label={vocab.works}
            value={works}
            onChange={setWorks}
            labelOf={workLabel}
            searchFields={WORK_SEARCH}
            placeholder={`Search ${vocab.works.toLowerCase()}`}
          />
          <MultiRecordPicker<PropertyRec>
            collection="properties"
            label={vocab.properties}
            value={props}
            onChange={setProps}
            labelOf={propertyLabel}
            searchFields={PROPERTY_SEARCH}
            placeholder={`Search ${vocab.properties.toLowerCase()}`}
          />
          <MultiRecordPicker<MatterRec>
            collection="matters"
            label="Registrations"
            value={matters}
            onChange={setMatters}
            labelOf={matterLabel}
            searchFields={MATTER_SEARCH}
            placeholder="Search by ref, title or number"
          />
        </div>
        <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">
          A grant on a {vocab.property.toLowerCase()} covers everything under it. Pick the narrowest assets the contract names.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {dims.map((dim) => (
            <DimensionPicker
              key={dim.key}
              dimension={dim.key}
              label={dim.label}
              value={spec[dim.key] ?? {}}
              onChange={(v) => setSpec((s) => ({ ...s, [dim.key]: v }))}
            />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DateField label="Starts" value={start} help="Leave empty to follow the agreement term." onChange={setStart} />
          <DateField label="Ends" value={end} error={termError} help="Leave empty to follow the agreement term." onChange={setEnd} />
        </div>

        {needsCheck && (
          <div className="flex scroll-mt-2 flex-col gap-3" ref={conflictRef}>
            <ConflictPanel conflicts={conflicts} checking={checking} error={checkError} />
            {hasConflicts && (
              <Field
                label="Override reason"
                required
                help="Saving over a conflict is recorded in the audit log with this reason, and the reason stays on the grant."
              >
                <Textarea rows={2} value={reason} placeholder="For example: the other licence ends before our window starts; confirmed with business affairs" onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
          </div>
        )}
        {!needsCheck && direction === 'out' && kind === 'grant' && (
          <p className="text-xs text-[var(--agent-app-muted)]">Choose assets to check this grant against every other active agreement.</p>
        )}

        <Textarea label="Rights in the contract's words" rows={3} value={rightsText} placeholder="For example: exclusive subscription video on demand rights, English and Spanish" onChange={(e) => setRightsText(e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Scope tab                                                           */
/* ------------------------------------------------------------------ */

function AssetChip({ to, children }: { to: string; children: ReactNode }): React.JSX.Element {
  return (
    <a
      href={to}
      className="inline-flex max-w-full items-center truncate border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-0.5 text-xs hover:border-[var(--agent-app-accent)]/60"
    >
      {children}
    </a>
  );
}

function GrantCard({
  g,
  agreement,
  dims,
  values,
  onEdit,
  onDelete,
}: {
  g: GrantRec;
  agreement: AgreementRec;
  dims: DimensionRec[];
  values: DimensionValueRec[];
  onEdit: (() => void) | null;
  onDelete: (() => void) | null;
}): React.JSX.Element {
  const assets = assetNamesOf(g);
  const shownDims = dims.filter((d) => {
    const s = g.dims?.[d.key];
    return d.enabled || (s !== undefined && ((s.include ?? []).length > 0 || (s.exclude ?? []).length > 0));
  });
  const s = d10(g.term_start);
  const e = d10(g.term_end);
  const term =
    s === '' && e === ''
      ? 'Agreement term'
      : `${s !== '' ? fmtDate(s) : 'Agreement start'} to ${e !== '' ? fmtDate(e) : agreement.perpetual ? 'no end date' : 'agreement end'}`;
  const menu = [
    ...(onEdit !== null ? [{ label: 'Edit', icon: <Pencil size={14} />, onSelect: onEdit }] : []),
    ...(onDelete !== null ? [{ label: 'Delete', icon: <Trash2 size={14} />, onSelect: onDelete, danger: true }] : []),
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] px-4 py-2.5">
        <DirectionPill direction={g.direction} />
        <span className="text-[13px] font-semibold">{GRANT_KIND_LABEL[g.kind]}</span>
        <Tag>{g.exclusive ? 'Exclusive' : 'Non-exclusive'}</Tag>
        {g.override_reason !== '' && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" title="Saved over a conflict">
            <ShieldAlert size={12} aria-hidden /> Override
          </span>
        )}
        {menu.length > 0 && (
          <div className="ml-auto">
            <DropdownMenu
              align="right"
              trigger={
                <span className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-border)]/30" aria-label="Grant actions">
                  <MoreHorizontal size={15} />
                </span>
              }
              items={menu}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {assets.works.map((w) => (
            <AssetChip key={w.id} to={href('work', w.id)}>
              {w.title}
            </AssetChip>
          ))}
          {assets.properties.map((p) => (
            <AssetChip key={p.id} to={href('property', p.id)}>
              {p.name}
            </AssetChip>
          ))}
          {assets.matters.map((m) => (
            <AssetChip key={m.id} to={href('matter', m.id)}>
              <Ref className="mr-1.5">{m.ref}</Ref>
              {m.title}
            </AssetChip>
          ))}
          {assets.works.length + assets.properties.length + assets.matters.length === 0 && (
            <span className="text-xs text-[var(--agent-app-muted)]">No assets chosen. This grant is not counted in availability until it names what it covers.</span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {shownDims.map((d) => (
            <div key={d.key} className="min-w-0">
              <div className="text-[11px] text-[var(--agent-app-muted)]">{d.label}</div>
              <div className="text-[13px]">{dimSpecLabel(values.filter((v) => v.dimension === d.key), g.dims?.[d.key])}</div>
            </div>
          ))}
          <div className="min-w-0">
            <div className="text-[11px] text-[var(--agent-app-muted)]">Term</div>
            <div className="text-[13px] tabular-nums">{term}</div>
          </div>
        </div>
        {g.rights_text !== '' && <Prose className="border-l-2 border-[var(--agent-app-border)] pl-3 text-[var(--agent-app-text)]/85">{g.rights_text}</Prose>}
        {g.override_reason !== '' && (
          <Notice tone="warn" icon={ShieldAlert}>
            Saved over a conflict: {g.override_reason}
          </Notice>
        )}
      </div>
    </Card>
  );
}

export function ScopePanel({ agreement }: { agreement: AgreementRec }): React.JSX.Element {
  const { can, dimensions, dimValues, vocab } = useApp();
  // Every dimension in order: disabled ones still show when a grant uses them.
  const dims = useMemo(() => dimensions.slice().sort((a, b) => a.order - b.order), [dimensions]);
  const grants = useCollection<GrantRec>('grants', { filter: `agreement = "${agreement.id}"`, sort: 'created', expand: 'works,properties,matters' });
  const [editing, setEditing] = useState<GrantRec | null | 'new'>(null);
  const [confirmEl, confirm] = useConfirm();
  const [check, setCheck] = useState<{ conflicts: ConflictItem[] | null; checking: boolean; error: string } | null>(null);

  const remove = async (g: GrantRec): Promise<void> => {
    if (!(await confirm('Delete this grant? Availability and conflict checks stop counting it. The change is kept in the history.', 'Delete grant'))) return;
    try {
      await deleteRecord('grants', g.id);
      toast.success('Grant deleted');
      grants.refresh();
    } catch {
      /* toast shown by the client */
    }
  };

  const checkAll = async (): Promise<void> => {
    setCheck({ conflicts: null, checking: true, error: '' });
    try {
      const r = await op<{ conflicts: ConflictItem[]; checked: number }>('agreements/check-conflicts', { agreement_id: agreement.id });
      setCheck({ conflicts: r.conflicts, checking: false, error: '' });
    } catch (e) {
      setCheck({ conflicts: null, checking: false, error: errText(e) });
    }
  };

  const sentences = grants.records.map((g) => {
    const a = assetNamesOf(g);
    const names = [...a.works.map((w) => w.title), ...a.properties.map((p) => p.name), ...a.matters.map((m) => m.ref || m.title)];
    return { id: g.id, text: grantSentence(g, agreement, dims, dimValues, names) };
  });

  const workIds = [...new Set(grants.records.flatMap((g) => g.works))];
  const propIds = [...new Set(grants.records.flatMap((g) => g.properties))];
  const explorerParams: Record<string, string> = {};
  if (workIds.length) explorerParams['work'] = workIds.join(',');
  if (propIds.length) explorerParams['property'] = propIds.join(',');
  const hasOut = grants.records.some((g) => g.direction === 'out' && g.kind === 'grant');

  return (
    <div className="flex flex-col gap-4">
      {confirmEl}
      <Section
        title="Scope"
        meta={grants.records.length ? String(grants.records.length) : undefined}
        actions={
          <>
            {grants.records.length > 0 && (
              <a
                href={href('rights', undefined, explorerParams)}
                className="hidden items-center gap-1 text-xs font-medium text-[var(--agent-app-accent)] hover:underline sm:inline-flex"
              >
                <Globe2 size={12} aria-hidden /> Rights explorer
              </a>
            )}
            {hasOut && (
              <Button size="sm" variant="outline" onClick={() => void checkAll()} loading={check?.checking === true}>
                Check conflicts
              </Button>
            )}
            {can.edit && grants.records.length > 0 && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus size={13} aria-hidden /> Add grant
              </Button>
            )}
          </>
        }
      >
        {grants.loading ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">Loading the rights scope...</p>
        ) : sentences.length === 0 ? (
          <EmptyHint
            compact
            icon={Layers}
            title="No rights scope yet"
            message={`Add what this agreement grants or acquires: which ${vocab.works.toLowerCase()}, where, in which media and for how long. The Rights explorer and conflict checks read this.`}
            action={
              can.edit ? (
                <Button size="sm" onClick={() => setEditing('new')}>
                  Add a grant
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sentences.map((s) => (
              <li key={s.id} className="text-[13.5px] leading-relaxed">
                {s.text}
              </li>
            ))}
          </ul>
        )}
        {check !== null && (
          <div className="mt-3">
            <ConflictPanel
              conflicts={check.conflicts}
              checking={check.checking}
              error={check.error}
              emptyText="No conflicts: nothing in the other active agreements overlaps these rights out."
            />
          </div>
        )}
      </Section>

      {grants.records.map((g) => (
        <GrantCard
          key={g.id}
          g={g}
          agreement={agreement}
          dims={dims}
          values={dimValues}
          onEdit={can.edit ? () => setEditing(g) : null}
          onDelete={can.manage ? () => void remove(g) : null}
        />
      ))}

      {editing !== null && (
        <GrantEditor agreement={agreement} grant={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={grants.refresh} />
      )}
    </div>
  );
}
