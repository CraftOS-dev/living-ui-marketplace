/**
 * A mark or design family: the facts of the mark (type, word element,
 * reading, translation, Vienna codes, strategy, announcement date, what it
 * protects), every filing in it across offices, the coverage of the linked
 * character, talent or franchise, and its documents.
 */
import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button, Card, CardContent, useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate } from '../lib/format.ts';
import { enumLabel, t, tn } from '../lib/i18n.ts';
import { href, navigate } from '../lib/router.ts';
import type { FamilyRec, GoodsServiceRec, MatterRec } from '../lib/records.ts';
import { DataTable } from '../components/DataTable.tsx';
import { DeleteButton } from '../components/deleteRecord.tsx';
import type { Col } from '../components/DataTable.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EmptyHint, Fact, FactGrid, JurChip, Loading, Pill, Prose, Ref, Section, Tag } from '../components/ui.tsx';
import { CoverageGrid } from '../components/protectCoverage.tsx';
import type { CoverageSubject } from '../components/protectCoverage.tsx';
import { FamilyEditDialog } from '../components/protectFamily.tsx';
import { NewMarkDialog } from '../components/protectMatterForms.tsx';
import { DateCell, MarkBox, MatterStatus, NextDeadlineCell, RecordMissing, SubjectLinks } from '../components/protectShared.tsx';

export function FamilyPage({ id }: { id: string }): React.JSX.Element {
  const { record, loading } = useRecord<FamilyRec>('families', id === '' ? null : id);
  if (id === '') return <RecordMissing title={t('No family chosen')} message={t('Open a family from the register or from a trademark.')} back={href('trademarks', undefined, { view: 'family' })} backLabel={t('Open the register')} />;
  if (loading && record === null) return <Loading />;
  if (record === null) return <RecordMissing title={t('This record is not available')} message={t('It may have been deleted, or you may not have access to it.')} back={href('trademarks')} backLabel={t('Open the register')} />;
  return <FamilyView f={record} />;
}

function FamilyView({ f }: { f: FamilyRec }): React.JSX.Element {
  const { can, on } = useApp();
  const [dlg, setDlg] = useState<'edit' | 'new' | null>(null);
  const members = useCollection<MatterRec>('matters', { filter: `family = ${q(f.id)}`, sort: 'jurisdiction,ref' });
  const goods = useCollection<GoodsServiceRec>('goods_services', { filter: `matter.family = ${q(f.id)}`, sort: 'nice_class' });
  const tm = f.kind === 'trademark';

  const classesOf = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const g of goods.records) {
      if (g.class_status === 'deleted' || g.class_status === 'cancelled') continue;
      const arr = m.get(g.matter) ?? [];
      if (!arr.includes(g.nice_class)) arr.push(g.nice_class);
      m.set(g.matter, arr.sort((a, b) => a - b));
    }
    return m;
  }, [goods.records]);

  const subject = useMemo((): { type: CoverageSubject; id: string } | null => {
    if (f.character !== '' && on('franchises')) return { type: 'character', id: f.character };
    if (f.talent !== '' && on('talents')) return { type: 'talent', id: f.talent };
    if (f.franchise !== '' && on('franchises')) return { type: 'franchise', id: f.franchise };
    return null;
  }, [f.character, f.talent, f.franchise, on]);

  const live = members.records.filter((m) => m.status_group === 'live').length;
  const pending = members.records.filter((m) => m.status_group === 'pending' || m.status_group === 'pre_filing').length;

  const columns: Col<MatterRec>[] = [
    { key: 'jurisdiction', label: t('Office'), value: (m) => m.jurisdiction, render: (m) => <JurChip code={m.jurisdiction} /> },
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
    { key: 'title', label: tm ? t('Mark') : t('Design title'), value: (m) => m.title, render: (m) => <span className="block max-w-[16rem] truncate" title={m.title}>{m.title}</span> },
    { key: 'route', label: t('Route'), optional: true, value: (m) => enumLabel('matters.route', m.route) },
    { key: 'status', label: t('Status'), value: (m) => enumLabel('matters.status', m.status), render: (m) => <MatterStatus m={m} /> },
    { key: 'numbers', label: t('Numbers'), value: (m) => m.registration_no || m.application_no, render: (m) => <span className="whitespace-nowrap font-mono text-xs">{m.registration_no || m.application_no || '-'}</span> },
    ...(tm ? [{ key: 'classes', label: t('Classes'), value: (m: MatterRec) => (classesOf.get(m.id) ?? []).join(', '), render: (m: MatterRec) => <span className="font-mono text-xs">{(classesOf.get(m.id) ?? []).join(', ') || '-'}</span> }] : []),
    { key: 'next', label: t('Next deadline'), value: (m) => d10(m.next_deadline), render: (m) => <NextDeadlineCell m={m} /> },
    { key: 'expiry', label: t('Expiry'), value: (m) => d10(m.expiry_date), render: (m) => <DateCell v={m.expiry_date} /> },
    { key: 'parent', label: t('Relation'), optional: true, value: (m) => (m.relation !== 'none' ? enumLabel('matters.relation', m.relation) : '') },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 basis-72 gap-4">
              {f.mark_image !== '' && (
                <span className="shrink-0">
                  <MarkBox family={f} fallback={f.title} />
                </span>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Tag>{enumLabel('families.kind', f.kind)}</Tag>
                  {tm && f.mark_type !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{enumLabel('families.mark_type', f.mark_type)}</span>}
                </div>
                <h1 className="mt-1.5 break-words text-xl font-semibold tracking-tight">{f.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--agent-app-muted)]">
                  {f.strategy !== '' && <Pill tone={f.strategy === 'maintain' ? 'good' : f.strategy === 'abandoned' ? 'neutral' : 'warn'}>{enumLabel('families.strategy', f.strategy)}</Pill>}
                  <span className="tabular-nums">{tn(members.records.length, '{n} filing', '{n} filings')}</span>
                  <span className="tabular-nums">{t('{live} live, {pending} pending', { live, pending })}</span>
                </div>
                <SubjectLinks franchise={f.franchise} character={f.character} talent={f.talent} className="mt-2" />
              </div>
            </div>
            {can.edit && (
              <div className="flex min-w-0 flex-wrap gap-2">
                <Button onClick={() => setDlg('new')}>
                  <Plus size={14} aria-hidden /> {t('New filing in this family')}
                </Button>
                <Button variant="outline" onClick={() => setDlg('edit')}>
                  <Pencil size={14} aria-hidden /> {t('Edit')}
                </Button>
                <DeleteButton collection="families" id={f.id} className="h-9" onDeleted={() => navigate('trademarks', undefined, { view: 'family' })} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={t('Facts')} className="lg:col-span-2">
          <div className="flex flex-col gap-4">
            <FactGrid cols={3}>
              <Fact label={t('Kind')} value={enumLabel('families.kind', f.kind)} />
              {tm && <Fact label={t('Mark type')} value={enumLabel('families.mark_type', f.mark_type)} />}
              {tm && <Fact label={t('Word element')} value={f.word_element} />}
              {tm && <Fact label={t('Transliteration')} value={f.transliteration} />}
              {tm && <Fact label={t('Translation')} value={f.translation} />}
              {tm && <Fact label={t('Vienna codes')} value={f.vienna_codes} mono />}
              {tm && f.disclaimer !== '' && <Fact label={t('Disclaimer')} value={f.disclaimer} />}
              <Fact label={t('Strategy')} value={enumLabel('families.strategy', f.strategy)} />
              <Fact label={t('Announcement date')} value={fmtDate(f.announcement_date)} />
              <Fact label={t('Owner entity')} value={f.owner_entity} />
            </FactGrid>
            {f.strategy_note !== '' && (
              <div>
                <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Strategy note')}</div>
                <Prose>{f.strategy_note}</Prose>
              </div>
            )}
            {f.products !== '' && (
              <div>
                <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Products and services it is used on')}</div>
                <Prose>{f.products}</Prose>
              </div>
            )}
            {f.description !== '' && (
              <div>
                <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Description')}</div>
                <Prose>{f.description}</Prose>
              </div>
            )}
          </div>
        </Section>
        <Section title={tm ? t('The mark') : t('The design')}>
          <div className="flex flex-col items-start gap-3">
            <MarkBox family={f} fallback={f.title} />
            {(f.name_variants ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(f.name_variants ?? []).map((v, i) => {
                  const text = typeof v === 'string' ? v : String((v as { value?: unknown }).value ?? '');
                  return text !== '' ? <Tag key={`${text}-${i}`}>{text}</Tag> : null;
                })}
              </div>
            )}
            {f.mark_image === '' && can.edit && (
              <button type="button" className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline" onClick={() => setDlg('edit')}>
                {t('Add the image')}
              </button>
            )}
          </div>
        </Section>
      </div>

      <Section title={t('Filings')} meta={String(members.records.length)} flush>
        {members.loading && members.records.length === 0 ? (
          <Loading />
        ) : (
          <DataTable<MatterRec>
            tableId="protect-family-members"
            rows={members.records}
            columns={columns}
            exportName={`family-${f.title}`}
            onRowClick={(m) => navigate('matter', m.id)}
            rowClassName={(m) => (m.status_group === 'dead' ? 'opacity-70' : '')}
            empty={
              <EmptyHint
                compact
                title={t('No filings in this family yet')}
                message={t('Add the first filing, or add filings in more offices from an existing trademark with Designate.')}
                action={
                  can.edit ? (
                    <Button size="sm" onClick={() => setDlg('new')}>
                      <Plus size={13} aria-hidden /> {t('New filing in this family')}
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </Section>

      {tm && subject !== null && <CoverageGrid type={subject.type} id={subject.id} title={t('Coverage of what this mark protects')} />}

      <DocumentsPanel relation="family" relationId={f.id} />

      {dlg === 'edit' && <FamilyEditDialog family={f} onClose={() => setDlg(null)} />}
      {dlg === 'new' && <NewMarkDialog family={f} onClose={() => setDlg(null)} />}
    </div>
  );
}
