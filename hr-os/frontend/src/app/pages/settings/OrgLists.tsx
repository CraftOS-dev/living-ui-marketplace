/**
 * The organisation lists: locations (with their geofence and kiosk code),
 * departments (a tree with head and approver), job titles, grades (with a
 * pay range), cost centres and employment types. One editor for all: a
 * dense list, a dialog to add or change, archive or delete.
 */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../../kit/index.ts';
import type { LucideIcon } from 'lucide-react';
import { Archive, Briefcase, KeyRound, Layers, MapPin, Network, Plus, Tags, Trash2, Wallet } from 'lucide-react';
import { Button, Dialog, Empty, Field, IconButton, Input, Loading, Money, MoneyInput, Notice, Panel, Picker, RowCue, Tabs, Tag, confirmAsk, majorParam } from '../../components/ui.tsx';
import type { PickItem } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { LIST_KEY, departmentOutline, pickItems, useOrgList } from '../people/data.ts';
import type { OrgKind } from '../people/data.ts';
import { usePeopleItems } from '../people/RecordDialogs.tsx';
import type { Department, OrgItem } from '../people/types.ts';

type FieldType = 'text' | 'code' | 'number' | 'money' | 'entity' | 'department' | 'employee' | 'grade' | 'cost_center' | 'calendar';

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean | undefined;
  help?: string | undefined;
  /** Only when adding. */
  addOnly?: boolean | undefined;
  wide?: boolean | undefined;
}

interface KindDef {
  kind: OrgKind;
  /** The param naming the record on update and delete. */
  idParam: string;
  one: string;
  icon: LucideIcon;
  fields: FieldDef[];
  title: (x: OrgItem) => string;
  sub: (x: OrgItem) => string;
  /** Money beside the line (through <Money>, so Hide pay blanks it). */
  money?: ((x: OrgItem) => React.ReactNode) | undefined;
  reads: string;
}

function kinds(): Record<OrgKind, KindDef> {
  return {
    locations: {
      kind: 'locations',
      idParam: 'location',
      one: t('org.one.location'),
      icon: MapPin,
      reads: 'locations',
      fields: [
        { key: 'entity', label: t('org.f.entity'), type: 'entity', required: true, addOnly: true },
        { key: 'name', label: t('org.f.name'), type: 'text', required: true },
        { key: 'lat', label: t('org.f.lat'), type: 'number', help: t('org.f.geo_help') },
        { key: 'lng', label: t('org.f.lng'), type: 'number' },
        { key: 'radius_m', label: t('org.f.radius'), type: 'number' },
        { key: 'calendar', label: t('org.f.calendar'), type: 'calendar' },
      ],
      title: (x) => String(x['name'] ?? ''),
      sub: (x) => [x['country'], x['timezone'], Number(x['radius_m'] ?? 0) > 0 ? t('org.geofence', { lat: Number(x['lat']).toFixed(4), lng: Number(x['lng']).toFixed(4), m: Number(x['radius_m']) }) : ''].filter((v) => v !== '' && v !== undefined).join(' · '),
    },
    departments: {
      kind: 'departments',
      idParam: 'department',
      one: t('org.one.department'),
      icon: Network,
      reads: 'departments',
      fields: [
        { key: 'name', label: t('org.f.name'), type: 'text', required: true },
        { key: 'code', label: t('org.f.code'), type: 'code' },
        { key: 'parent', label: t('org.f.parent'), type: 'department' },
        { key: 'entity', label: t('org.f.entity_any'), type: 'entity' },
        { key: 'head', label: t('org.f.head'), type: 'employee' },
        { key: 'approver', label: t('org.f.approver'), type: 'employee', help: t('org.f.approver_help') },
        { key: 'cost_center', label: t('org.f.cost_center'), type: 'cost_center' },
      ],
      title: (x) => String(x['name'] ?? ''),
      sub: (x) => [x['code'], x['head_name'] !== '' && x['head_name'] !== undefined ? t('org.head_is', { name: String(x['head_name']) }) : ''].filter((v) => v !== '' && v !== undefined).join(' · '),
    },
    titles: {
      kind: 'titles',
      idParam: 'title',
      one: t('org.one.title'),
      icon: Briefcase,
      reads: 'job_titles',
      fields: [
        { key: 'name', label: t('org.f.name'), type: 'text', required: true },
        { key: 'family', label: t('org.f.family'), type: 'text' },
        { key: 'grade', label: t('org.f.grade'), type: 'grade' },
        { key: 'description', label: t('org.f.description'), type: 'text', wide: true },
      ],
      title: (x) => String(x['name'] ?? ''),
      sub: (x) => String(x['family'] ?? ''),
    },
    grades: {
      kind: 'grades',
      idParam: 'grade',
      one: t('org.one.grade'),
      icon: Layers,
      reads: 'grades',
      fields: [
        { key: 'code', label: t('org.f.code'), type: 'code', required: true },
        { key: 'name', label: t('org.f.name'), type: 'text', required: true },
        { key: 'entity', label: t('org.f.entity_any'), type: 'entity' },
        { key: 'currency', label: t('org.f.currency'), type: 'code' },
        { key: 'pay_min', label: t('org.f.pay_min'), type: 'money' },
        { key: 'pay_max', label: t('org.f.pay_max'), type: 'money' },
      ],
      title: (x) => `${String(x['code'] ?? '')} · ${String(x['name'] ?? '')}`,
      sub: () => '',
      money: (x) =>
        x['currency'] !== '' && Number(x['pay_max_minor'] ?? 0) > 0 ? (
          <span className="block truncate text-[12px] text-[var(--hr-muted)]">
            <Money minor={Number(x['pay_min_minor'] ?? 0)} currency={String(x['currency'])} /> {t('format.range_to')} <Money minor={Number(x['pay_max_minor'] ?? 0)} currency={String(x['currency'])} />
          </span>
        ) : null,
    },
    'cost-centers': {
      kind: 'cost-centers',
      idParam: 'cost_center',
      one: t('org.one.cost_center'),
      icon: Wallet,
      reads: 'cost_centers',
      fields: [
        { key: 'code', label: t('org.f.code'), type: 'code', required: true },
        { key: 'name', label: t('org.f.name'), type: 'text', required: true },
        { key: 'entity', label: t('org.f.entity_any'), type: 'entity' },
      ],
      title: (x) => `${String(x['code'] ?? '')} · ${String(x['name'] ?? '')}`,
      sub: () => '',
    },
    'employment-types': {
      kind: 'employment-types',
      idParam: 'employment_type',
      one: t('org.one.employment_type'),
      icon: Tags,
      reads: 'employment_types',
      fields: [
        { key: 'code', label: t('org.f.code'), type: 'code', required: true },
        { key: 'name', label: t('org.f.name'), type: 'text', required: true },
      ],
      title: (x) => String(x['name'] ?? ''),
      sub: (x) => String(x['code'] ?? ''),
    },
  };
}

function EditDialog({ def, item, open, onClose }: { def: KindDef; item: OrgItem | null; open: boolean; onClose: () => void }): React.JSX.Element | null {
  const me = useMe();
  const [v, setV] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const departments = useOrgList<Department & OrgItem>('departments').items;
  const grades = useOrgList('grades').items;
  const costs = useOrgList('cost-centers').items;
  const cals = useOp<{ calendars: { id: string; code: string; name: string }[] }>('calendars.list', {}, ['holiday_calendars'], { name: 'org.calendars', skip: !def.fields.some((f) => f.type === 'calendar') });
  const people = usePeopleItems('');
  useEffect(() => {
    if (!open) return;
    const start: Record<string, unknown> = {};
    for (const f of def.fields) start[f.key] = item?.[f.type === 'money' ? `${f.key}_minor` : f.key] ?? (f.type === 'money' ? null : '');
    if (item === null && def.kind === 'locations') start['entity'] = me.entities[0]?.id ?? '';
    setV(start);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);
  if (!open) return null;
  const entities: PickItem[] = me.entities.map((e) => ({ value: e.id, label: e.name, sub: e.country }));
  const items = (f: FieldDef): PickItem[] =>
    f.type === 'entity'
      ? entities
      : f.type === 'department'
        ? departmentOutline((departments ?? []).filter((d) => d.id !== item?.id)).map(({ dept, depth }) => ({ value: dept.id, label: '  '.repeat(depth) + dept.name }))
        : f.type === 'grade'
          ? pickItems(grades, (g) => String(g['name'] ?? ''))
          : f.type === 'cost_center'
            ? pickItems(costs, (c) => String(c['name'] ?? ''))
            : f.type === 'calendar'
              ? (cals.data?.calendars ?? []).map((c) => ({ value: c.id, label: c.name, sub: c.code }))
              : f.type === 'employee'
                ? people
                : [];
  const ok = def.fields.every((f) => f.required !== true || (item !== null && f.addOnly === true) || String(v[f.key] ?? '').trim() !== '');
  const cur = String(v['currency'] ?? '') !== '' ? String(v['currency']).toUpperCase() : (me.entities[0]?.currency ?? 'USD');
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const params: Record<string, unknown> = {};
    for (const f of def.fields) {
      if (item !== null && f.addOnly === true) continue;
      const x = v[f.key];
      if (f.type === 'money') {
        if (x !== null && x !== undefined) params[f.key] = majorParam(Number(x), cur);
        continue;
      }
      if (f.type === 'number') {
        if (x !== '' && x !== undefined && x !== null) params[f.key] = Number(x);
        continue;
      }
      if (item === null && (x === '' || x === undefined)) continue;
      params[f.key] = typeof x === 'string' ? x.trim() : x;
    }
    if (def.kind === 'grades' && params['pay_min'] !== undefined && params['currency'] === undefined) params['currency'] = cur;
    try {
      if (item === null) await op(`${def.kind}.add`, params, { quiet: true });
      else await op(`${def.kind}.update`, { [def.idParam]: item.id, ...params }, { quiet: true });
      changed(def.reads);
      toast.success(item === null ? t('org.added', { what: def.one }) : t('ui.saved'));
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={item === null ? t('org.add', { what: def.one }) : def.title(item)}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {item === null ? t('ui.add') : t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {def.fields
          .filter((f) => !(item !== null && f.addOnly === true))
          .map((f) => (
            <Field key={f.key} label={f.label} help={f.help} optional={f.required !== true} className={f.wide === true ? 'sm:col-span-2' : ''}>
              {f.type === 'text' || f.type === 'code' || f.type === 'number' ? (
                <Input value={String(v[f.key] ?? '')} onChange={(e) => setV((x) => ({ ...x, [f.key]: e.target.value }))} inputMode={f.type === 'number' ? 'decimal' : undefined} className={f.type !== 'text' ? 'hr-mono' : ''} aria-label={f.label} />
              ) : f.type === 'money' ? (
                <MoneyInput value={(v[f.key] as number | null) ?? null} onChange={(x) => setV((y) => ({ ...y, [f.key]: x }))} currency={cur} label={f.label} />
              ) : (
                <Picker value={String(v[f.key] ?? '')} onChange={(x) => setV((y) => ({ ...y, [f.key]: x }))} items={items(f)} label={f.label} clearable={f.required !== true} />
              )}
            </Field>
          ))}
      </div>
      {error !== null && (
        <Notice tone="bad" className="mt-3">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}

export function KindList({ kind }: { kind: OrgKind }): React.JSX.Element {
  const me = useMe();
  const def = kinds()[kind];
  const [archived, setArchived] = useState(false);
  const live = useOp<Record<string, OrgItem[]>>(`${kind}.list`, { archived }, [def.reads], { name: `org.${kind}.all`, keep: true });
  const [edit, setEdit] = useState<OrgItem | null>(null);
  const [adding, setAdding] = useState(false);
  const editable = can(me, 'people', 'full');
  const list = live.data?.[LIST_KEY[kind]] ?? null;
  const rows = useMemo(() => {
    if (list === null) return [];
    if (kind === 'departments') return departmentOutline(list as unknown as Department[]).map(({ dept, depth }) => ({ item: dept as unknown as OrgItem, depth }));
    return list.map((item) => ({ item, depth: 0 }));
  }, [list, kind]);
  const Icon = def.icon;
  const archive = async (x: OrgItem): Promise<void> => {
    try {
      await op(`${kind}.update`, { [def.idParam]: x.id, archived: x['archived'] !== true });
      changed(def.reads);
    } catch {
      /* toast shown */
    }
  };
  const remove = async (x: OrgItem): Promise<void> => {
    const ok = await confirmAsk(t('org.delete_text', { name: def.title(x) }), t('org.delete', { what: def.one }), t('ui.remove'));
    if (!ok) return;
    try {
      await op(`${kind}.delete`, { [def.idParam]: x.id });
      changed(def.reads);
    } catch {
      /* toast shown (in use: archive instead) */
    }
  };
  return (
    <Panel
      label={t(`org.kind.${kind}`)}
      aside={
        <span className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={Archive} onClick={() => setArchived((a) => !a)} aria-pressed={archived}>
            {archived ? t('org.hide_archived') : t('org.show_archived')}
          </Button>
          {editable && (
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              {t('org.add', { what: def.one })}
            </Button>
          )}
        </span>
      }
      flush
    >
      {list === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon={Icon} title={t('org.none', { what: t(`org.kind.${kind}`).toLowerCase() })} action={editable ? <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('org.add', { what: def.one })}</Button> : undefined} />
      ) : (
        // Rows on the panel's 14px content edge (6 + 8); the readouts end on it and the row actions sit before them.
        <ul className="flex flex-col px-1.5 pb-1.5">
          {rows.map(({ item, depth }) => (
            <li key={item.id} onClick={(e) => editable && (e.target as HTMLElement).closest('button') === null && setEdit(item)} className={cn('group flex min-h-10 items-center gap-2 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] pr-2 last:border-b-0', editable && 'cursor-pointer hover:bg-[var(--hr-hover)]')}>
              <button type="button" disabled={!editable} onClick={() => setEdit(item)} className="hr-focus hr-tap flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--hr-radius-sm)] px-2 py-1.5 text-left disabled:cursor-default" style={{ paddingLeft: 8 + depth * 18 }}>
                <span className="min-w-0 flex-1">
                  <span className="hr-wrap block text-[13px]">{def.title(item)}</span>
                  {def.sub(item) !== '' && <span className="block truncate text-[12px] text-[var(--hr-muted)]">{def.sub(item)}</span>}
                  {def.money?.(item)}
                </span>
              </button>
              {editable && kind === 'locations' && (
                <IconButton
                  icon={KeyRound}
                  label={item['kiosk_code'] !== '' && item['kiosk_code'] !== undefined ? t('org.kiosk_code_is', { code: String(item['kiosk_code']) }) : t('org.kiosk_code')}
                  size={28}
                  onRow
                  onClick={() => void op<{ location: OrgItem }>('locations.kiosk-code', { location: item.id }).then((r) => (changed('locations'), toast.success(t('org.kiosk_code_is', { code: String(r.location['kiosk_code'] ?? '') })))).catch(() => undefined)}
                />
              )}
              {editable && <IconButton icon={Archive} label={item['archived'] === true ? t('org.restore') : t('org.archive')} size={28} onClick={() => void archive(item)} onRow className="hover-only opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />}
              {editable && <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" size={28} onClick={() => void remove(item)} onRow className="hover-only opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />}
              {kind === 'departments' && Number(item['people'] ?? 0) > 0 && <span className="hr-num shrink-0 whitespace-nowrap text-right text-[12px] text-[var(--hr-muted)]">{tn('people.n_people', Number(item['people']))}</span>}
              {item['archived'] === true && <Tag tone="faint">{t('org.archived')}</Tag>}
              {editable && <RowCue edit />}
            </li>
          ))}
        </ul>
      )}
      <EditDialog def={def} item={null} open={adding} onClose={() => setAdding(false)} />
      <EditDialog def={def} item={edit} open={edit !== null} onClose={() => setEdit(null)} />
    </Panel>
  );
}

export function LocationsSection(): React.JSX.Element {
  return <KindList kind="locations" />;
}

const ORG_TABS: OrgKind[] = ['departments', 'titles', 'grades', 'cost-centers', 'employment-types'];

export function OrgSection({ query }: PageProps): React.JSX.Element {
  const tab = (ORG_TABS as string[]).includes(query.get('list') ?? '') ? (query.get('list') as OrgKind) : 'departments';
  return (
    <div className="flex flex-col gap-3">
      <Tabs value={tab} onChange={(v) => setQuery({ list: v === 'departments' ? undefined : v })} tabs={ORG_TABS.map((k) => ({ value: k, label: t(`org.kind.${k}`) }))} label={t('settings.org')} />
      <KindList key={tab} kind={tab} />
    </div>
  );
}

