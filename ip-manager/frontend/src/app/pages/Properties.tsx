/**
 * Properties (franchises, brands, product lines): the tree of everything
 * the organization's IP hangs off, with rights basis and what each one
 * holds (live rights, works, active agreements).
 */
import { useMemo, useState } from 'react';
import { Layers, Plus, Search } from 'lucide-react';
import { Button, Card, Input, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { AgreementRec, FamilyRec, GrantRec, MatterRec, PropertyRec, WorkRec } from '../lib/types.ts';
import { PropertyForm } from '../components/catalogPropertyForm.tsx';
import {
  CountCell,
  PROPERTY_KIND_LABEL,
  PROPERTY_STATUS_LABEL,
  PropertyStatusPill,
  RightsBasisPill,
  RowLink,
  Thumb,
  TreeTable,
  ancestorsOf,
  options,
  withAncestors,
} from '../components/catalogShared.tsx';
import type { TreeCol } from '../components/catalogShared.tsx';
import { EmptyHint, ErrorBox, Loading, PageHeader, Toolbar } from '../components/ui.tsx';

interface Counts {
  trademark: number;
  patent: number;
  design: number;
  copyright: number;
  works: number;
  agreements: number;
}

const ZERO: Counts = { trademark: 0, patent: 0, design: 0, copyright: 0, works: 0, agreements: 0 };
const ACTIVE_AGREEMENT = new Set(['active', 'renewed']);

export function PropertiesPage(): React.JSX.Element {
  const { vocab, can } = useApp();
  const props = useCollection<PropertyRec>('properties', { sort: 'name' });
  const matters = useCollection<MatterRec>('matters');
  const families = useCollection<FamilyRec>('families');
  const works = useCollection<WorkRec>('works');
  const agreements = useCollection<AgreementRec>('agreements');
  const grants = useCollection<GrantRec>('grants');
  const [term, setTerm] = useHashParam('q', '');
  const [kind, setKind] = useHashParam('kind', '');
  const [status, setStatus] = useHashParam('status', '');
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const out = new Map<string, Counts>();
    const get = (id: string): Counts => {
      let c = out.get(id);
      if (c === undefined) {
        c = { ...ZERO };
        out.set(id, c);
      }
      return c;
    };
    const famProp = new Map(families.records.map((f) => [f.id, f.property]));
    for (const m of matters.records) {
      if (m.status_group !== 'live' && m.status_group !== 'pending') continue;
      const pid = m.property || famProp.get(m.family) || '';
      if (pid === '') continue;
      const c = get(pid);
      if (m.ip_type === 'trademark') c.trademark += 1;
      else if (m.ip_type === 'patent' || m.ip_type === 'utility_model') c.patent += 1;
      else if (m.ip_type === 'design') c.design += 1;
      else if (m.ip_type === 'copyright') c.copyright += 1;
    }
    for (const w of works.records) if (w.property !== '') get(w.property).works += 1;
    const active = new Set(agreements.records.filter((a) => ACTIVE_AGREEMENT.has(a.status)).map((a) => a.id));
    const deals = new Map<string, Set<string>>();
    const addDeal = (pid: string, aid: string): void => {
      const s = deals.get(pid) ?? new Set<string>();
      s.add(aid);
      deals.set(pid, s);
    };
    for (const a of agreements.records) if (a.property !== '' && active.has(a.id)) addDeal(a.property, a.id);
    for (const g of grants.records) {
      if (!active.has(g.agreement)) continue;
      for (const pid of g.properties ?? []) addDeal(pid, g.agreement);
    }
    for (const [pid, s] of deals) get(pid).agreements = s.size;
    return out;
  }, [matters.records, families.records, works.records, agreements.records, grants.records]);

  const countOf = (id: string): Counts => counts.get(id) ?? ZERO;

  const filtering = term.trim() !== '' || kind !== '' || status !== '';
  const matches = (p: PropertyRec): boolean => {
    if (kind !== '' && p.kind !== kind) return false;
    if (status !== '' && p.status !== status) return false;
    const t = term.trim().toLowerCase();
    if (t === '') return true;
    return (
      p.name.toLowerCase().includes(t) ||
      p.business_unit.toLowerCase().includes(t) ||
      p.description.toLowerCase().includes(t) ||
      (p.tags ?? []).some((x) => x.toLowerCase().includes(t))
    );
  };
  const visible = filtering ? withAncestors(props.records, matches) : null;
  const matchCount = filtering ? props.records.filter(matches).length : props.records.length;

  const inheritedBasis = (p: PropertyRec): { basis: PropertyRec['rights_basis']; from?: string } => {
    if (p.rights_basis !== '') return { basis: p.rights_basis };
    const a = ancestorsOf(props.records, p.id).find((x) => x.rights_basis !== '');
    return a !== undefined ? { basis: a.rights_basis, from: a.name } : { basis: '' };
  };

  const columns: TreeCol<PropertyRec>[] = [
    { key: 'kind', label: 'Kind', className: 'hidden lg:table-cell', render: (p) => <span className="text-[var(--agent-app-muted)]">{p.kind !== '' ? PROPERTY_KIND_LABEL[p.kind] : ''}</span> },
    {
      key: 'basis',
      label: 'Rights basis',
      render: (p) => {
        const b = inheritedBasis(p);
        return <RightsBasisPill basis={b.basis} inherited={b.from} />;
      },
    },
    { key: 'status', label: 'Status', className: 'hidden sm:table-cell', render: (p) => <PropertyStatusPill status={p.status} /> },
    { key: 'tm', label: 'Trademarks', align: 'right', title: 'Pending or in force', render: (p) => <CountCell n={countOf(p.id).trademark} /> },
    { key: 'pat', label: 'Patents', align: 'right', title: 'Pending or in force', className: 'hidden lg:table-cell', render: (p) => <CountCell n={countOf(p.id).patent} /> },
    { key: 'des', label: 'Designs', align: 'right', title: 'Pending or in force', className: 'hidden xl:table-cell', render: (p) => <CountCell n={countOf(p.id).design} /> },
    { key: 'cr', label: 'Copyrights', align: 'right', title: 'Pending or in force', className: 'hidden xl:table-cell', render: (p) => <CountCell n={countOf(p.id).copyright} /> },
    { key: 'works', label: vocab.works, align: 'right', className: 'hidden sm:table-cell', render: (p) => <CountCell n={countOf(p.id).works} /> },
    { key: 'deals', label: 'Agreements', align: 'right', title: 'Active agreements', className: 'hidden md:table-cell', render: (p) => <CountCell n={countOf(p.id).agreements} /> },
  ];

  const newButton = can.edit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={15} aria-hidden /> New {vocab.property.toLowerCase()}
    </Button>
  ) : undefined;

  const clear = (): void => {
    setTerm('');
    setKind('');
    setStatus('');
  };

  return (
    <div>
      <PageHeader
        title={vocab.properties}
        meta={props.records.length > 0 ? String(props.records.length) : undefined}
        subtitle={vocab.propertyHint}
        actions={newButton}
      />

      {props.loading && props.records.length === 0 ? (
        <Loading />
      ) : props.error !== null && props.records.length === 0 ? (
        <ErrorBox message={props.error} onRetry={props.refresh} />
      ) : props.records.length === 0 ? (
        <Card>
          <EmptyHint
            icon={Layers}
            title={`No ${vocab.properties.toLowerCase()} yet`}
            message={`Create a ${vocab.property.toLowerCase()} to group its trademarks, patents, ${vocab.works.toLowerCase()} and agreements in one place.`}
            action={
              can.edit ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus size={15} aria-hidden /> New {vocab.property.toLowerCase()}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Toolbar>
            <div className="relative w-full sm:w-72">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
              <Input
                aria-label={`Search ${vocab.properties.toLowerCase()}`}
                placeholder={`Search ${vocab.properties.toLowerCase()}`}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-44">
              <Select aria-label="Kind" value={kind} placeholder="All kinds" options={options(PROPERTY_KIND_LABEL)} onChange={(e) => setKind(e.target.value)} />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-44">
              <Select aria-label="Status" value={status} placeholder="All statuses" options={options(PROPERTY_STATUS_LABEL)} onChange={(e) => setStatus(e.target.value)} />
            </div>
            {filtering && (
              <>
                <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">
                  {matchCount} of {props.records.length}
                </span>
                <Button size="sm" variant="ghost" onClick={clear}>
                  Clear filters
                </Button>
              </>
            )}
          </Toolbar>
          <Card className="overflow-hidden">
            {filtering && matchCount === 0 ? (
              <EmptyHint
                compact
                icon={Search}
                title="Nothing matches these filters"
                message={`Try another search term, or clear the filters to see every ${vocab.property.toLowerCase()}.`}
                action={
                  <Button size="sm" variant="outline" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <TreeTable<PropertyRec>
                items={props.records}
                primaryLabel={vocab.property}
                visible={visible}
                expandAll={filtering}
                isMatch={matches}
                rowHref={(p) => href('property', p.id)}
                primary={(p) => (
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Thumb record={p} image={p.image} name={p.name} />
                    <span className="flex min-w-0 flex-col">
                      <RowLink to={href('property', p.id)}>{p.name}</RowLink>
                      {p.business_unit !== '' && <span className="truncate text-xs text-[var(--agent-app-muted)]">{p.business_unit}</span>}
                    </span>
                  </span>
                )}
                columns={columns}
              />
            )}
          </Card>
        </>
      )}

      {creating && <PropertyForm property={null} onClose={() => setCreating(false)} onSaved={(p) => navigate('property', p.id)} />}
    </div>
  );
}
