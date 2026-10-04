/**
 * Trademarks and designs: the register (filters that survive reloads, a
 * table with the office numbers, classes and next deadline, or grouped by
 * family), coverage by class and office for a character, talent or
 * franchise, and the tools (leak check, CSV import). New marks are entered
 * by hand or imported from the office record.
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, FileStack, Layers, Plus, Search, Table2 } from 'lucide-react';
import { Button, Card, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, relLabel } from '../lib/format.ts';
import { enumLabel, enumOptions, t, tf, tn } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { FamilyRec, GoodsServiceRec, MatterRec } from '../lib/records.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { EmptyHint, ErrorBox, JurChip, Loading, PageHeader, Pill, Ref, Section, Segmented, TONE_TEXT, Tag } from '../components/ui.tsx';
import { CoveragePicker } from '../components/protectCoverage.tsx';
import type { CoverageSubject } from '../components/protectCoverage.tsx';
import { ImportOfficeDialog, NewMarkDialog } from '../components/protectMatterForms.tsx';
import { DateCell, MarkBox, MatterChip, MatterStatus, NextDeadlineCell, normNum, opts } from '../components/protectShared.tsx';
import { LeakCheckPanel, MatterCsvImport } from '../components/protectTools.tsx';

type Dlg = 'new' | 'import' | null;

export function TrademarksPage(): React.JSX.Element {
  const { can, on } = useApp();
  const [tab, setTab] = useHashParam('tab', 'register');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [newParam, setNewParam] = useHashParam('new', '');

  // Deep link "#/trademarks?new=1" opens the new mark form.
  useEffect(() => {
    if (newParam === '1') {
      if (can.edit) setDlg('new');
      setNewParam('');
    }
  }, [newParam, can.edit, setNewParam]);

  const coverageOn = on('franchises') || on('talents');

  return (
    <div>
      <PageHeader
        title={t('Trademarks and designs')}
        subtitle={t('Marks for franchise names, characters, talent stage names and logos, and designs, in JP, US, CN, KR, TW, the EU and WIPO.')}
        actions={
          can.edit ? (
            <>
              <Button variant="outline" onClick={() => setDlg('import')}>
                <Download size={14} aria-hidden /> {t('Import from the office')}
              </Button>
              <Button onClick={() => setDlg('new')}>
                <Plus size={14} aria-hidden /> {t('New mark')}
              </Button>
            </>
          ) : undefined
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="min-w-0">
          <TabsList className="flex h-auto w-full flex-wrap">
            <TabsTrigger value="register">{t('Register|tab')}</TabsTrigger>
            {coverageOn && <TabsTrigger value="coverage">{t('Coverage')}</TabsTrigger>}
            <TabsTrigger value="tools">{t('Tools')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="register">
          <RegisterTab onNew={() => setDlg('new')} />
        </TabsContent>
        {coverageOn && (
          <TabsContent value="coverage">
            <CoverageTab />
          </TabsContent>
        )}
        <TabsContent value="tools">
          <div className="flex flex-col gap-4">
            <LeakCheckPanel />
            {can.edit && <MatterCsvImport />}
          </div>
        </TabsContent>
      </Tabs>
      {dlg === 'new' && <NewMarkDialog onClose={() => setDlg(null)} />}
      {dlg === 'import' && <ImportOfficeDialog onClose={() => setDlg(null)} onManual={() => setDlg('new')} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Register                                                            */
/* ------------------------------------------------------------------ */

type GroupFilter = 'active' | 'live' | 'pending' | 'pre_filing' | 'dead' | 'all';

function familyOf(m: MatterRec): FamilyRec | undefined {
  return m.expand?.['family'] as FamilyRec | undefined;
}

function RegisterTab({ onNew }: { onNew: () => void }): React.JSX.Element {
  const { can, on, userName, nameOf, franchises, characters, talents } = useApp();
  const [qParam, setQParam] = useHashParam('q', '');
  const [type, setType] = useHashParam('type', '');
  const [office, setOffice] = useHashParam('office', '');
  const [grp, setGrp] = useHashParam('status', 'active');
  const [fr, setFr] = useHashParam('franchise', '');
  const [ch, setCh] = useHashParam('character', '');
  const [ta, setTa] = useHashParam('talent', '');
  const [owner, setOwner] = useHashParam('owner', '');
  const [view, setView] = useHashParam('view', 'table');
  const [text, setText] = useState(qParam);

  const matters = useCollection<MatterRec>('matters', { sort: 'ref', expand: 'family' });
  const goods = useCollection<GoodsServiceRec>('goods_services', { sort: 'nice_class' });

  useEffect(() => {
    const timer = setTimeout(() => {
      if (text.trim() !== qParam) setQParam(text.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [text, qParam, setQParam]);

  const classesByMatter = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const g of goods.records) {
      if (g.class_status === 'deleted' || g.class_status === 'cancelled') continue;
      const arr = m.get(g.matter) ?? [];
      if (!arr.includes(g.nice_class)) arr.push(g.nice_class);
      m.set(g.matter, arr);
    }
    return m;
  }, [goods.records]);

  const counts = useMemo(() => {
    const c = { live: 0, pending: 0, pre_filing: 0, dead: 0 };
    for (const m of matters.records) if (m.status_group !== '') c[m.status_group] += 1;
    return c;
  }, [matters.records]);

  const officeOptions = useMemo(
    () => [...new Set(matters.records.map((m) => m.jurisdiction.toUpperCase()))].sort().map((c) => ({ value: c, label: `${c} · ${jurisdictionName(c)}` })),
    [matters.records],
  );
  const ownerOptions = useMemo(
    () =>
      [...new Set(matters.records.map((m) => m.owner_of_record.trim()).filter((x) => x !== ''))]
        .sort((a, b) => a.localeCompare(b))
        .map((o) => ({ value: o, label: o })),
    [matters.records],
  );

  const rows = useMemo(() => {
    const needle = qParam.trim().toLowerCase();
    const needleNum = normNum(qParam);
    return matters.records.filter((m) => {
      if (grp === 'active' ? m.status_group === 'dead' : grp !== 'all' && m.status_group !== grp) return false;
      if (type !== '' && m.ip_type !== type) return false;
      if (office !== '' && m.jurisdiction.toUpperCase() !== office) return false;
      if (fr !== '' && m.franchise !== fr) return false;
      if (ch !== '' && m.character !== ch) return false;
      if (ta !== '' && m.talent !== ta) return false;
      if (owner !== '' && m.owner_of_record.trim() !== owner) return false;
      if (needle === '') return true;
      const fam = familyOf(m);
      if (m.title.toLowerCase().includes(needle) || m.ref.toLowerCase().includes(needle)) return true;
      if (fam !== undefined && (fam.title.toLowerCase().includes(needle) || fam.transliteration.toLowerCase().includes(needle))) return true;
      if (m.owner_of_record.toLowerCase().includes(needle)) return true;
      if (needleNum === '') return false;
      return [m.application_no, m.publication_no, m.registration_no, m.client_ref].some((n) => n !== '' && normNum(n).includes(needleNum));
    });
  }, [matters.records, grp, type, office, fr, ch, ta, owner, qParam]);

  const filtersOn = qParam !== '' || grp !== 'active' || type !== '' || office !== '' || fr !== '' || ch !== '' || ta !== '' || owner !== '';
  const clear = (): void => {
    setText('');
    setQParam('');
    setGrp('active');
    setType('');
    setOffice('');
    setFr('');
    setCh('');
    setTa('');
    setOwner('');
  };

  const columns = useMemo((): Col<MatterRec>[] => {
    return [
      {
        key: 'ref',
        label: t('Reference'),
        value: (m) => m.ref,
        render: (m) => (
          <a href={href('matter', m.id)} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap hover:underline">
            <Ref dead={m.status_group === 'dead'}>{m.ref}</Ref>
          </a>
        ),
      },
      {
        key: 'title',
        label: t('Mark'),
        value: (m) => m.title,
        render: (m) => (
          <div className="flex min-w-0 max-w-[20rem] items-center gap-2">
            <span className={cn('truncate font-medium', m.status_group === 'dead' && 'text-[var(--agent-app-muted)]')} title={m.title}>
              {m.title}
            </span>
            {m.ip_type === 'design' && <Tag>{enumLabel('matters.ip_type', 'design')}</Tag>}
          </div>
        ),
      },
      { key: 'jurisdiction', label: t('Office'), value: (m) => m.jurisdiction, render: (m) => <JurChip code={m.jurisdiction} /> },
      {
        key: 'numbers',
        label: t('Numbers'),
        value: (m) => m.registration_no || m.application_no,
        render: (m) => (
          <div className="whitespace-nowrap font-mono text-xs leading-5">
            {m.application_no !== '' && (
              <div>
                <span className="text-[var(--agent-app-muted)]">{t('App.')} </span>
                {m.application_no}
              </div>
            )}
            {m.registration_no !== '' && (
              <div>
                <span className="text-[var(--agent-app-muted)]">{t('Reg.')} </span>
                {m.registration_no}
              </div>
            )}
            {m.application_no === '' && m.registration_no === '' && <span className="text-[var(--agent-app-muted)]">-</span>}
          </div>
        ),
      },
      {
        key: 'classes',
        label: t('Classes'),
        value: (m) => (classesByMatter.get(m.id) ?? []).sort((a, b) => a - b).join(', '),
        render: (m) => {
          const cl = (classesByMatter.get(m.id) ?? []).slice().sort((a, b) => a - b);
          return cl.length > 0 ? <span className="block max-w-[10rem] truncate font-mono text-xs tabular-nums" title={cl.join(', ')}>{cl.join(', ')}</span> : <span className="text-[var(--agent-app-muted)]">-</span>;
        },
      },
      { key: 'status', label: t('Status'), value: (m) => enumLabel('matters.status', m.status), render: (m) => <MatterStatus m={m} /> },
      { key: 'next_deadline', label: t('Next deadline'), value: (m) => d10(m.next_deadline), render: (m) => <NextDeadlineCell m={m} /> },
      { key: 'expiry_date', label: t('Expiry'), value: (m) => d10(m.expiry_date), render: (m) => <DateCell v={m.expiry_date} /> },
      { key: 'filing_date', label: t('Filing date'), optional: true, value: (m) => d10(m.filing_date), render: (m) => <DateCell v={m.filing_date} /> },
      { key: 'registration_date', label: t('Registration date'), optional: true, value: (m) => d10(m.registration_date), render: (m) => <DateCell v={m.registration_date} /> },
      { key: 'family', label: t('Family'), optional: true, value: (m) => familyOf(m)?.title ?? '' },
      { key: 'subject', label: t('Character or talent'), optional: true, value: (m) => nameOf('character', m.character) || nameOf('talent', m.talent) || nameOf('franchise', m.franchise) },
      { key: 'owner_of_record', label: t('Owner of record'), optional: true, value: (m) => m.owner_of_record },
      { key: 'responsible', label: t('Responsible'), optional: true, value: (m) => userName(m.responsible) },
    ];
  }, [classesByMatter, nameOf, userName]);

  if (matters.error !== null && matters.records.length === 0) return <ErrorBox message={matters.error} onRetry={matters.refresh} />;
  if (matters.loading && matters.records.length === 0) return <Loading />;
  if (matters.records.length === 0) {
    return (
      <Card>
        <EmptyHint
          icon={FileStack}
          title={t('No trademarks or designs yet')}
          message={can.edit ? t('Add a mark for a franchise, character or talent, or import it from the office by its number.') : t('Trademarks and designs appear here once an editor adds them.')}
          action={
            can.edit ? (
              <Button onClick={onNew}>
                <Plus size={14} aria-hidden /> {t('New mark')}
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const groupOptions: { value: GroupFilter; label: string }[] = [
    { value: 'active', label: `${t('Live and pending')} ${counts.live + counts.pending + counts.pre_filing}` },
    { value: 'live', label: `${enumLabel('matters.status_group', 'live')} ${counts.live}` },
    { value: 'pending', label: `${enumLabel('matters.status_group', 'pending')} ${counts.pending}` },
    { value: 'pre_filing', label: `${enumLabel('matters.status_group', 'pre_filing')} ${counts.pre_filing}` },
    { value: 'dead', label: `${enumLabel('matters.status_group', 'dead')} ${counts.dead}` },
    { value: 'all', label: t('All') },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
          <Input aria-label={t('Search')} className="pl-8" placeholder={t('Mark, reference, owner or any number')} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="max-w-full overflow-x-auto">
          <Segmented<GroupFilter> size="sm" value={(groupOptions.some((g) => g.value === grp) ? grp : 'active') as GroupFilter} onChange={setGrp} options={groupOptions} ariaLabel={t('Status')} />
        </div>
        <div className="ml-auto">
          <Segmented<'table' | 'family'>
            size="sm"
            value={view === 'family' ? 'family' : 'table'}
            onChange={setView}
            ariaLabel={t('View')}
            options={[
              {
                value: 'table',
                label: (
                  <span className="inline-flex items-center gap-1">
                    <Table2 size={12} aria-hidden /> {t('Table')}
                  </span>
                ),
              },
              {
                value: 'family',
                label: (
                  <span className="inline-flex items-center gap-1">
                    <Layers size={12} aria-hidden /> {t('By family')}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select aria-label={t('Type')} value={type} placeholder={t('Trademarks and designs')} options={opts(enumOptions('matters.ip_type'))} onChange={(e) => setType(e.target.value)} />
        <Select aria-label={t('Office')} value={office} placeholder={t('All offices')} options={officeOptions} onChange={(e) => setOffice(e.target.value)} />
        {on('franchises') && (
          <Select aria-label={t('Franchise')} value={fr} placeholder={t('All franchises')} options={franchises.map((x) => ({ value: x.id, label: x.name }))} onChange={(e) => setFr(e.target.value)} />
        )}
        {on('franchises') && (
          <Select aria-label={t('Character')} value={ch} placeholder={t('All characters')} options={characters.map((x) => ({ value: x.id, label: x.name }))} onChange={(e) => setCh(e.target.value)} />
        )}
        {on('talents') && (
          <Select aria-label={t('Talent')} value={ta} placeholder={t('All talents')} options={talents.map((x) => ({ value: x.id, label: x.stage_name }))} onChange={(e) => setTa(e.target.value)} />
        )}
        {ownerOptions.length > 0 && <Select aria-label={t('Owner of record')} value={owner} placeholder={t('All owners')} options={ownerOptions} onChange={(e) => setOwner(e.target.value)} />}
        {filtersOn && (
          <div className="flex items-center">
            <Button size="sm" variant="ghost" onClick={clear}>
              {t('Clear filters')}
            </Button>
          </div>
        )}
      </div>

      {view === 'family' ? (
        <FamilyView rows={rows} onClear={clear} />
      ) : (
        <Card className="overflow-hidden">
          <DataTable<MatterRec>
            tableId="protect-register"
            rows={rows}
            columns={columns}
            exportName="trademarks"
            onRowClick={(m) => navigate('matter', m.id)}
            rowClassName={(m) => (m.status_group === 'dead' ? 'opacity-70' : '')}
            empty={
              <EmptyHint
                compact
                icon={Search}
                title={t('Nothing matches these filters')}
                message={grp === 'active' ? t('Dead rights are hidden. Choose Dead or All to see them.') : t('Try another office or clear the search.')}
                action={
                  <Button size="sm" onClick={clear}>
                    {t('Clear filters')}
                  </Button>
                }
              />
            }
          />
        </Card>
      )}
    </div>
  );
}

interface Group {
  key: string;
  family: FamilyRec | undefined;
  members: MatterRec[];
  next: MatterRec | undefined;
}

function FamilyView({ rows, onClear }: { rows: MatterRec[]; onClear: () => void }): React.JSX.Element {
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const m of rows) {
      let g = map.get(m.family);
      if (g === undefined) {
        g = { key: m.family, family: familyOf(m), members: [], next: undefined };
        map.set(m.family, g);
      }
      g.members.push(m);
      const nd = d10(m.next_deadline);
      if (nd !== '' && (g.next === undefined || nd < d10(g.next.next_deadline))) g.next = m;
    }
    const list = [...map.values()];
    list.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : (a.family?.title ?? '').localeCompare(b.family?.title ?? '')));
    for (const g of list) g.members.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.ref.localeCompare(b.ref));
    return list;
  }, [rows]);

  return (
    <Section title={t('By family')} meta={String(groups.length)} flush>
      {groups.length === 0 ? (
        <EmptyHint
          compact
          icon={Search}
          title={t('Nothing matches these filters')}
          action={
            <Button size="sm" onClick={onClear}>
              {t('Clear filters')}
            </Button>
          }
        />
      ) : (
        groups.map((g) => {
          const nextD = g.next !== undefined ? d10(g.next.next_deadline) : '';
          const n = nextD !== '' ? daysUntil(nextD) : 0;
          return (
            <div
              key={g.key || 'none'}
              className="grid gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,14rem)] md:items-center md:gap-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                {g.family !== undefined && g.family.mark_image !== '' && <MarkBox family={g.family} fallback={g.family.title} size="sm" />}
                <div className="min-w-0">
                  {g.key !== '' ? (
                    <a href={href('family', g.key)} className="block truncate text-sm font-semibold hover:underline" title={g.family?.title}>
                      {g.family?.title ?? t('Family')}
                    </a>
                  ) : (
                    <span className="block truncate text-sm font-semibold text-[var(--agent-app-muted)]">{t('Not in a family')}</span>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--agent-app-muted)]">
                    {g.family !== undefined && g.family.strategy !== '' && <Pill tone={g.family.strategy === 'maintain' ? 'good' : g.family.strategy === 'abandoned' ? 'neutral' : 'warn'}>{enumLabel('families.strategy', g.family.strategy)}</Pill>}
                    <span className="tabular-nums">{tn(g.members.length, '{n} filing', '{n} filings')}</span>
                  </div>
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap gap-1">
                {g.members.map((m) => (
                  <MatterChip key={m.id} m={m} />
                ))}
              </div>
              <div className="min-w-0 text-[13px]">
                {g.next !== undefined && nextD !== '' ? (
                  <a href={href('matter', g.next.id)} className="block min-w-0 hover:underline">
                    <span className={cn('tabular-nums', n < 0 ? TONE_TEXT.bad : n <= 30 ? TONE_TEXT.warn : '')}>
                      {fmtDate(nextD)} <span className="text-xs text-[var(--agent-app-muted)]">{relLabel(nextD)}</span>
                    </span>
                    <span className="block truncate text-xs text-[var(--agent-app-muted)]">
                      {g.next.jurisdiction}: {tf(g.next, 'next_deadline_title')}
                    </span>
                  </a>
                ) : (
                  <span className="text-xs text-[var(--agent-app-muted)]">{t('No open deadlines')}</span>
                )}
              </div>
            </div>
          );
        })
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

function CoverageTab(): React.JSX.Element {
  const { on } = useApp();
  const [typeRaw, setType] = useHashParam('cov', on('franchises') ? 'character' : 'talent');
  const [id, setId] = useHashParam('of', '');
  const type: CoverageSubject = typeRaw === 'talent' || typeRaw === 'franchise' ? typeRaw : 'character';
  return (
    <CoveragePicker
      type={type}
      id={id}
      onChange={(ty, x) => {
        setType(ty);
        setId(x);
      }}
    />
  );
}
