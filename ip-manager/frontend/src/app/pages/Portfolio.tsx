/**
 * Portfolio list for one kind of right (patents with utility models,
 * trademarks, designs, copyrights): filters that survive reloads, a table
 * with the office numbers and the next deadline, and a grouped view by
 * family, mark or work.
 */
import { useEffect, useMemo, useState } from 'react';
import { FileStack, Layers, Plus, Search, Table2, Upload } from 'lucide-react';
import { Button, Card, Input, Select, Switch, cn } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { fileUrl } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, relLabel } from '../lib/format.ts';
import { GROUP_LABEL, IP_TYPE_LABEL, IP_TYPE_PLURAL, STATUS_LABEL, STATUS_ORDER, jurisdictionName, statusTone } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { FamilyRec, GoodsServicesRec, MatterRec, StatusGroup, WorkRec } from '../lib/types.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { NewMatterDialog } from '../components/matterDialogs.tsx';
import { MatterChip, STRATEGY_LABEL, STRATEGY_TONE, normNum, routeText } from '../components/matterShared.tsx';
import type { PortfolioType } from '../components/matterShared.tsx';
import { EmptyHint, ErrorBox, IdentityChip, JurChip, Loading, PageHeader, Pill, Ref, Section, TONE_TEXT, Tag } from '../components/ui.tsx';

type GroupFilter = 'active' | StatusGroup;

const GROUP_FILTERS: GroupFilter[] = ['active', 'live', 'pending', 'pre_filing', 'dead'];

const EMPTY_TEXT: Record<PortfolioType, string> = {
  patent: 'Add a patent application by its number and the office record fills in the rest, or start from a template.',
  trademark: 'Add a trademark by its application number, or start from a template such as a US or EU filing.',
  design: 'Add a design registration by its number, or start from a template for the US, EU or Japan.',
  copyright: 'Record copyright registrations and link each to the work it protects.',
};

function familyOf(m: MatterRec): FamilyRec | undefined {
  return m.expand?.['family'] as FamilyRec | undefined;
}

function workOf(m: MatterRec): WorkRec | undefined {
  return m.expand?.['work'] as WorkRec | undefined;
}

export function PortfolioPage({ ipType }: { ipType: PortfolioType }): React.JSX.Element {
  const { can, vocab, properties, propertyName, userName } = useApp();
  const [qParam, setQParam] = useHashParam('q', '');
  const [grp, setGrp] = useHashParam('status', 'active');
  const [jur, setJur] = useHashParam('jur', '');
  const [prop, setProp] = useHashParam('prop', '');
  const [grpId, setGrpId] = useHashParam('group', '');
  const [view, setView] = useHashParam('view', 'table');
  const [um, setUm] = useHashParam('um', '1');
  const [newParam, setNewParam] = useHashParam('new', '');
  const [text, setText] = useState(qParam);
  const [creating, setCreating] = useState(false);

  const matters = useCollection<MatterRec>('matters', {
    filter: ipType === 'patent' ? 'ip_type = "patent" || ip_type = "utility_model"' : `ip_type = "${ipType}"`,
    sort: 'ref',
    expand: ipType === 'copyright' ? 'work' : 'family',
  });
  const goods = useCollection<GoodsServicesRec>('goods_services', {
    filter: ipType === 'trademark' ? 'matter.ip_type = "trademark"' : 'id = "__none__"',
    sort: 'nice_class',
  });

  // Deep link "#/patents?new=1" opens the new record dialog.
  useEffect(() => {
    if (newParam === '1') {
      if (can.edit) setCreating(true);
      setNewParam('');
    }
  }, [newParam, can.edit, setNewParam]);

  // Search text reaches the URL after a short pause.
  useEffect(() => {
    const t = setTimeout(() => {
      if (text.trim() !== qParam) setQParam(text.trim());
    }, 250);
    return () => clearTimeout(t);
  }, [text, qParam, setQParam]);

  const classesByMatter = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const g of goods.records) {
      if (g.class_status === 'deleted' || g.class_status === 'cancelled') continue;
      const arr = m.get(g.matter) ?? [];
      if (!arr.includes(g.nice_class)) arr.push(g.nice_class);
      m.set(g.matter, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a - b);
    return m;
  }, [goods.records]);

  const includeUm = ipType === 'patent' && um === '1';
  const typeRows = useMemo(
    () => matters.records.filter((m) => ipType !== 'patent' || m.ip_type === 'patent' || (includeUm && m.ip_type === 'utility_model')),
    [matters.records, ipType, includeUm],
  );
  const hasUm = ipType === 'patent' && matters.records.some((m) => m.ip_type === 'utility_model');

  const counts = useMemo(() => {
    const c: Record<StatusGroup, number> = { pre_filing: 0, pending: 0, live: 0, dead: 0 };
    for (const m of typeRows) if (m.status_group !== undefined && m.status_group in c) c[m.status_group] += 1;
    return c;
  }, [typeRows]);

  const jurOptions = useMemo(
    () =>
      [...new Set(typeRows.map((m) => m.jurisdiction.toUpperCase()))]
        .sort()
        .map((c) => ({ value: c, label: `${c} · ${jurisdictionName(c)}` })),
    [typeRows],
  );

  const groupOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of typeRows) {
      if (ipType === 'copyright') {
        const w = workOf(m);
        if (m.work !== '') map.set(m.work, w?.title ?? 'Unknown work');
      } else {
        const f = familyOf(m);
        if (m.family !== '') map.set(m.family, f?.title ?? 'Unknown family');
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [typeRows, ipType]);

  const rows = useMemo(() => {
    const needle = qParam.trim().toLowerCase();
    const needleNum = normNum(qParam);
    return typeRows.filter((m) => {
      if (grp === 'active' ? m.status_group === 'dead' : m.status_group !== grp) return false;
      if (jur !== '' && m.jurisdiction.toUpperCase() !== jur) return false;
      if (prop !== '' && m.property !== prop) return false;
      if (grpId !== '' && (ipType === 'copyright' ? m.work : m.family) !== grpId) return false;
      if (needle === '') return true;
      if (m.title.toLowerCase().includes(needle) || m.ref.toLowerCase().includes(needle)) return true;
      if (needleNum === '') return false;
      return [m.application_no, m.publication_no, m.registration_no].some((n) => n !== '' && normNum(n).includes(needleNum));
    });
  }, [typeRows, grp, jur, prop, grpId, qParam, ipType]);

  const filtersOn = qParam !== '' || grp !== 'active' || jur !== '' || prop !== '' || grpId !== '';
  const clearFilters = (): void => {
    setText('');
    setQParam('');
    setGrp('active');
    setJur('');
    setProp('');
    setGrpId('');
  };

  const groupLabel = ipType === 'copyright' ? vocab.work : ipType === 'trademark' ? 'Mark' : 'Family';
  const typeWord = IP_TYPE_LABEL[ipType].toLowerCase();

  const columns = useMemo((): Col<MatterRec>[] => {
    const cols: Col<MatterRec>[] = [];
    if (ipType === 'trademark') {
      cols.push({
        key: 'mark',
        label: 'Image',
        sortable: false,
        value: () => '',
        render: (m) => {
          const fam = familyOf(m);
          return fam !== undefined && fam.mark_image !== '' ? <MarkThumb family={fam} /> : <span className="text-[var(--agent-app-muted)]">-</span>;
        },
      });
    }
    cols.push(
      {
        key: 'ref',
        label: 'Ref',
        value: (m) => m.ref,
        render: (m) => (
          <a href={href('matter', m.id)} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap hover:underline">
            <Ref dead={m.status_group === 'dead'}>{m.ref}</Ref>
          </a>
        ),
      },
      {
        key: 'title',
        label: ipType === 'trademark' ? 'Mark' : 'Title',
        value: (m) => m.title,
        render: (m) => (
          <div className="flex min-w-0 max-w-[22rem] items-center gap-2">
            <span className={cn('truncate font-medium', m.status_group === 'dead' && 'text-[var(--agent-app-muted)]')} title={m.title}>
              {m.title}
            </span>
            {m.ip_type === 'utility_model' && <Tag>Utility model</Tag>}
          </div>
        ),
      },
      { key: 'jurisdiction', label: 'Office', value: (m) => m.jurisdiction, render: (m) => <JurChip code={m.jurisdiction} /> },
      {
        key: 'status',
        label: 'Status',
        value: (m) => STATUS_ORDER.indexOf(m.status),
        render: (m) => (
          <Pill tone={statusTone(m.status, m.status_group)} title={m.office_status !== '' ? `Office: ${m.office_status}` : undefined}>
            {STATUS_LABEL[m.status]}
          </Pill>
        ),
      },
    );
    if (ipType === 'trademark') {
      cols.push({
        key: 'classes',
        label: 'Classes',
        value: (m) => (classesByMatter.get(m.id) ?? []).join(', '),
        render: (m) => {
          const cl = classesByMatter.get(m.id) ?? [];
          return cl.length > 0 ? <span className="whitespace-nowrap font-mono text-xs tabular-nums">{cl.join(', ')}</span> : <span className="text-[var(--agent-app-muted)]">-</span>;
        },
      });
    }
    if (ipType === 'copyright') {
      cols.push({
        key: 'work',
        label: vocab.work,
        value: (m) => workOf(m)?.title ?? '',
        render: (m) => {
          const w = workOf(m);
          return w !== undefined ? (
            <a href={href('work', w.id)} onClick={(e) => e.stopPropagation()} className="block max-w-[16rem] truncate hover:underline" title={w.title}>
              {w.title}
            </a>
          ) : (
            <span className="text-[var(--agent-app-muted)]">Not linked</span>
          );
        },
      });
    }
    cols.push(
      {
        key: 'application_no',
        label: 'Application no.',
        value: (m) => m.application_no,
        render: (m) => <span className="whitespace-nowrap font-mono text-xs">{m.application_no || '-'}</span>,
      },
      { key: 'filing_date', label: 'Filed', value: (m) => d10(m.filing_date), render: (m) => <DateCell v={m.filing_date} /> },
      {
        key: 'publication_no',
        label: 'Publication no.',
        optional: true,
        value: (m) => m.publication_no,
        render: (m) => <span className="whitespace-nowrap font-mono text-xs">{m.publication_no || '-'}</span>,
      },
      { key: 'publication_date', label: 'Published', optional: true, value: (m) => d10(m.publication_date), render: (m) => <DateCell v={m.publication_date} /> },
      {
        key: 'registration_no',
        label: ipType === 'patent' ? 'Patent no.' : 'Registration no.',
        value: (m) => m.registration_no,
        render: (m) => <span className="whitespace-nowrap font-mono text-xs">{m.registration_no || '-'}</span>,
      },
      {
        key: 'registration_date',
        label: ipType === 'patent' ? 'Granted' : 'Registered',
        value: (m) => d10(m.registration_date),
        render: (m) => <DateCell v={m.registration_date} />,
      },
      { key: 'expiry_date', label: 'Expires', value: (m) => d10(m.expiry_date), render: (m) => <DateCell v={m.expiry_date} /> },
      {
        key: 'next_deadline',
        label: 'Next deadline',
        value: (m) => d10(m.next_deadline),
        render: (m) => <NextDeadline m={m} />,
      },
      {
        key: 'property',
        label: vocab.property,
        value: (m) => propertyName(m.property),
        render: (m) =>
          m.property !== '' ? (
            <span className="block max-w-[12rem] truncate" title={propertyName(m.property)}>
              {propertyName(m.property)}
            </span>
          ) : (
            <span className="text-[var(--agent-app-muted)]">-</span>
          ),
      },
      {
        key: 'responsible',
        label: 'Responsible',
        value: (m) => userName(m.responsible),
        render: (m) => {
          const n = userName(m.responsible);
          return n !== '' ? (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <IdentityChip name={n} size="xs" />
              {n}
            </span>
          ) : (
            <span className="text-[var(--agent-app-muted)]">-</span>
          );
        },
      },
      { key: 'route', label: 'Route', optional: true, value: (m) => routeText(m) },
      { key: 'owner_of_record', label: 'Owner of record', optional: true, value: (m) => m.owner_of_record },
      { key: 'counsel', label: 'Counsel', optional: true, value: (m) => m.counsel },
      { key: 'client_ref', label: 'Client ref', optional: true, value: (m) => m.client_ref },
      { key: 'office_status', label: 'Office status', optional: true, value: (m) => m.office_status },
    );
    return cols;
  }, [ipType, classesByMatter, vocab, propertyName, userName]);

  const newButton = can.edit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={14} aria-hidden /> New {typeWord}
    </Button>
  ) : undefined;

  const subtitle =
    typeRows.length === 0
      ? undefined
      : `${counts.live} in force, ${counts.pending} pending, ${counts.pre_filing} not filed${counts.dead > 0 ? `, ${counts.dead} dead` : ''}. Search by title, reference or any office number.`;

  return (
    <div>
      <PageHeader
        title={IP_TYPE_PLURAL[ipType]}
        meta={matters.loading && matters.records.length === 0 ? undefined : String(rows.length)}
        subtitle={subtitle}
        actions={
          <>
            {can.edit && (
              <Button variant="outline" onClick={() => navigate('settings', undefined, { tab: 'import' })}>
                <Upload size={14} aria-hidden /> Import
              </Button>
            )}
            {newButton}
          </>
        }
      />

      {matters.error !== null && matters.records.length === 0 ? (
        <ErrorBox message={matters.error} onRetry={matters.refresh} />
      ) : matters.loading && matters.records.length === 0 ? (
        <Loading label={`Loading ${IP_TYPE_PLURAL[ipType].toLowerCase()}`} />
      ) : typeRows.length === 0 && !hasUm ? (
        <Card>
          <EmptyHint
            icon={FileStack}
            title={`No ${IP_TYPE_PLURAL[ipType].toLowerCase()} yet`}
            message={can.edit ? EMPTY_TEXT[ipType] : `${IP_TYPE_PLURAL[ipType]} appear here once an editor adds them.`}
            action={newButton}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
                <Input aria-label="Search this list" className="pl-8" placeholder="Title, reference or number" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <div className="max-w-full overflow-x-auto">
                <GroupSegmented value={grp as GroupFilter} counts={counts} onChange={setGrp} />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <ViewToggle value={view === 'grouped' ? 'grouped' : 'table'} onChange={setView} groupLabel={ipType === 'copyright' ? `By ${vocab.work.toLowerCase()}` : ipType === 'trademark' ? 'By mark' : 'By family'} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full sm:w-52">
                <Select aria-label="Filter by office" value={jur} placeholder="All offices" options={jurOptions} onChange={(e) => setJur(e.target.value)} />
              </div>
              <div className="w-full sm:w-52">
                <Select
                  aria-label={`Filter by ${vocab.property.toLowerCase()}`}
                  value={prop}
                  placeholder={`All ${vocab.properties.toLowerCase()}`}
                  options={properties.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(e) => setProp(e.target.value)}
                />
              </div>
              {groupOptions.length > 0 && (
                <div className="w-full sm:w-56">
                  <Select
                    aria-label={`Filter by ${groupLabel.toLowerCase()}`}
                    value={grpId}
                    placeholder={ipType === 'copyright' ? `All ${vocab.works.toLowerCase()}` : ipType === 'trademark' ? 'All marks' : 'All families'}
                    options={groupOptions}
                    onChange={(e) => setGrpId(e.target.value)}
                  />
                </div>
              )}
              {ipType === 'patent' && (
                <div className="px-1">
                  <Switch checked={um === '1'} onCheckedChange={(v) => setUm(v ? '1' : '0')} label="Include utility models" />
                </div>
              )}
              {filtersOn && (
                <Button size="sm" variant="ghost" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          {view === 'grouped' ? (
            <GroupedView rows={rows} ipType={ipType} emptyAction={<Button size="sm" onClick={clearFilters}>Clear filters</Button>} />
          ) : (
            <Card className="overflow-hidden">
              <DataTable<MatterRec>
                tableId={`portfolio-${ipType}`}
                rows={rows}
                columns={columns}
                exportName={IP_TYPE_PLURAL[ipType].toLowerCase()}
                onRowClick={(m) => navigate('matter', m.id)}
                rowClassName={(m) => (m.status_group === 'dead' ? 'opacity-70' : '')}
                empty={
                  <EmptyHint
                    compact
                    icon={Search}
                    title="Nothing matches these filters"
                    message={grp === 'active' ? 'Dead rights are hidden. Pick Dead to see them.' : 'Try another office or clear the search.'}
                    action={
                      <Button size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                }
              />
            </Card>
          )}
        </>
      )}

      {creating && <NewMatterDialog ipType={ipType} onClose={() => setCreating(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function GroupSegmented({ value, counts, onChange }: { value: GroupFilter; counts: Record<StatusGroup, number>; onChange: (v: string) => void }): React.JSX.Element {
  const active = counts.live + counts.pending + counts.pre_filing;
  return (
    <div role="radiogroup" aria-label="Status" className="inline-flex border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
      {GROUP_FILTERS.map((g) => {
        const on = g === value;
        const n = g === 'active' ? active : counts[g];
        return (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(g)}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap border-r border-[var(--agent-app-border)] px-2.5 py-1 text-[12.5px] font-medium transition-colors last:border-r-0',
              on ? 'bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)]' : 'text-[var(--agent-app-text)]/75 hover:bg-[var(--agent-app-border)]/30',
            )}
          >
            {g === 'active' ? 'All live and pending' : GROUP_LABEL[g]}
            <span className={cn('tabular-nums', on ? 'opacity-80' : 'text-[var(--agent-app-muted)]')}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

function ViewToggle({ value, onChange, groupLabel }: { value: 'table' | 'grouped'; onChange: (v: string) => void; groupLabel: string }): React.JSX.Element {
  const opts: { v: 'table' | 'grouped'; label: string; icon: React.JSX.Element }[] = [
    { v: 'table', label: 'Table', icon: <Table2 size={13} aria-hidden /> },
    { v: 'grouped', label: groupLabel, icon: <Layers size={13} aria-hidden /> },
  ];
  return (
    <div role="radiogroup" aria-label="View" className="inline-flex border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap border-r border-[var(--agent-app-border)] px-2.5 py-1 text-[12.5px] font-medium last:border-r-0',
            value === o.v ? 'bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)]' : 'text-[var(--agent-app-text)]/75 hover:bg-[var(--agent-app-border)]/30',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DateCell({ v }: { v: string }): React.JSX.Element {
  const d = d10(v);
  return d !== '' ? <span className="whitespace-nowrap tabular-nums">{fmtDate(d)}</span> : <span className="text-[var(--agent-app-muted)]">-</span>;
}

function NextDeadline({ m }: { m: MatterRec }): React.JSX.Element {
  const d = d10(m.next_deadline);
  if (d === '') return <span className="text-[var(--agent-app-muted)]">-</span>;
  const n = daysUntil(d);
  return (
    <div className="min-w-0 max-w-[16rem]">
      <div className={cn('whitespace-nowrap tabular-nums', n < 0 ? TONE_TEXT.bad : n <= 30 ? TONE_TEXT.warn : '')}>
        {fmtDate(d)} <span className="text-xs text-[var(--agent-app-muted)]">{relLabel(d)}</span>
      </div>
      {m.next_deadline_title !== '' && (
        <div className="truncate text-xs text-[var(--agent-app-muted)]" title={m.next_deadline_title}>
          {m.next_deadline_title}
        </div>
      )}
    </div>
  );
}

function MarkThumb({ family, size = 'sm' }: { family: FamilyRec | undefined; size?: 'sm' | 'md' | undefined }): React.JSX.Element | null {
  if (family === undefined || family.mark_image === '') return null;
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)]', size === 'md' ? 'size-12' : 'size-8')}>
      <img src={fileUrl(family, family.mark_image, '100x100')} alt={family.title} className="max-h-full max-w-full object-contain" loading="lazy" />
    </span>
  );
}

interface Group {
  key: string;
  title: string;
  family?: FamilyRec | undefined;
  work?: WorkRec | undefined;
  members: MatterRec[];
  next: MatterRec | undefined;
}

function GroupedView({ rows, ipType, emptyAction }: { rows: MatterRec[]; ipType: PortfolioType; emptyAction: React.JSX.Element }): React.JSX.Element {
  const { vocab } = useApp();
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const m of rows) {
      const key = ipType === 'copyright' ? m.work : m.family;
      let g = map.get(key);
      if (g === undefined) {
        const fam = ipType === 'copyright' ? undefined : familyOf(m);
        const work = ipType === 'copyright' ? workOf(m) : undefined;
        g = { key, title: key === '' ? '' : (fam?.title ?? work?.title ?? m.title), family: fam, work, members: [], next: undefined };
        map.set(key, g);
      }
      g.members.push(m);
      const nd = d10(m.next_deadline);
      if (nd !== '' && (g.next === undefined || nd < d10(g.next.next_deadline))) g.next = m;
    }
    const list = [...map.values()];
    list.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.title.localeCompare(b.title)));
    for (const g of list) g.members.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.ref.localeCompare(b.ref));
    return list;
  }, [rows, ipType]);

  const heading = ipType === 'copyright' ? `By ${vocab.work.toLowerCase()}` : ipType === 'trademark' ? 'By mark' : 'By family';
  const ungroupedLabel = ipType === 'copyright' ? `Not linked to a ${vocab.work.toLowerCase()}` : ipType === 'trademark' ? 'Not in a mark' : 'Not in a family';

  return (
    <Section title={heading} meta={String(groups.length)} flush>
      {groups.length === 0 ? (
        <EmptyHint compact icon={Search} title="Nothing matches these filters" message="Try another status or office." action={emptyAction} />
      ) : (
        groups.map((g) => {
          const link = g.key === '' ? '' : ipType === 'copyright' ? href('work', g.key) : href('family', g.key);
          const nextD = g.next !== undefined ? d10(g.next.next_deadline) : '';
          return (
            <div
              key={g.key || 'none'}
              className="grid gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,15rem)] md:items-center md:gap-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                {ipType === 'trademark' && g.key !== '' && <MarkThumb family={g.family} size="md" />}
                <div className="min-w-0">
                  {link !== '' ? (
                    <a href={link} className="block truncate text-sm font-semibold hover:underline" title={g.title}>
                      {g.title}
                    </a>
                  ) : (
                    <span className="block truncate text-sm font-semibold text-[var(--agent-app-muted)]">{ungroupedLabel}</span>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--agent-app-muted)]">
                    {g.family !== undefined && g.family.strategy !== '' && (
                      <Pill tone={STRATEGY_TONE[g.family.strategy] ?? 'neutral'} title={g.family.strategy_note || undefined}>
                        {STRATEGY_LABEL[g.family.strategy] ?? g.family.strategy}
                      </Pill>
                    )}
                    <span className="tabular-nums">
                      {g.members.length} filing{g.members.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {g.members.map((m) => (
                  <MatterChip key={m.id} m={m} showRef={g.key === ''} />
                ))}
              </div>
              <div className="min-w-0 text-[13px]">
                {g.next !== undefined && nextD !== '' ? (
                  <a href={href('matter', g.next.id)} className="block min-w-0 hover:underline">
                    <span className={cn('tabular-nums', daysUntil(nextD) < 0 ? TONE_TEXT.bad : daysUntil(nextD) <= 30 ? TONE_TEXT.warn : '')}>
                      {fmtDate(nextD)} <span className="text-xs text-[var(--agent-app-muted)]">{relLabel(nextD)}</span>
                    </span>
                    <span className="block truncate text-xs text-[var(--agent-app-muted)]">
                      {g.next.jurisdiction}: {g.next.next_deadline_title}
                    </span>
                  </a>
                ) : (
                  <span className="text-xs text-[var(--agent-app-muted)]">No open deadlines</span>
                )}
              </div>
            </div>
          );
        })
      )}
    </Section>
  );
}
