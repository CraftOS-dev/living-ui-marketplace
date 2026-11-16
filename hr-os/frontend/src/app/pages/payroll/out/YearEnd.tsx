/**
 * Year end: the documents each entity owes its people for a tax year (W-2,
 * P60, 源泉徴収票, IR8A, Form 16, EA and the rest), built from locked runs
 * only. People see the figures per person, export CSV data, print, and
 * issue them to employees with the PIN. An employee sees their own here.
 */
import { useMemo, useState } from 'react';
import { Download, FileText, Printer, Send } from 'lucide-react';
import { Button, DataTable, Empty, LoadError, Loading, Money, Notice, PageBody, PageHeader, Panel, RowCue, Segmented, Tag } from '../../../components/ui.tsx';
import type { Column } from '../../../components/ui.tsx';
import { EntityChooser, useEntity } from '../../../components/payroll-out/parts.tsx';
import { op, saveText } from '../../../lib/api.ts';
import { can, useMe } from '../../../lib/auth.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { fmtDay, fmtStampDay } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { changed, useOp } from '../../../lib/live.ts';
import { navigate, setQuery } from '../../../lib/router.ts';
import { toast } from '../../../lib/toast.ts';
import type { DocRow, YearDoc, YearOverviewRow } from './types.ts';

function MyDocuments(): React.JSX.Element {
  const live = useOp<{ documents: { id: string; doc: string; year: string; name: string; form: string; label: string; employer: string; entity: string; issued_at: string }[] }>('yearend.mine', {}, ['yearend_docs'], { name: 'yearend.mine' });
  const docs = live.data?.documents ?? null;
  return (
    <>
      <PageHeader title={t('po.yearend.mine')} />
      <PageBody>
        <div className="hr-panel hr-in min-w-0">
          {docs === null ? (
            live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
          ) : docs.length === 0 ? (
            <Empty icon={FileText} title={t('po.yearend.mine_empty')}>
              {t('po.yearend.mine_empty_text')}
            </Empty>
          ) : (
            <ul className="divide-y divide-[var(--hr-hair)]">
              {docs.map((d) => (
                <li key={d.id}>
                  <a href={`#/print/payroll/year-end/doc/${d.id}`} className="group hit flex min-w-0 items-center gap-3 px-3.5 py-3 transition-colors hover:bg-[var(--hr-hover)]">
                    <FileText size={16} className="text-[var(--hr-muted)]" aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="font-medium">
                        {d.form} {d.label}
                      </span>
                      <span className="truncate text-[12px] text-[var(--hr-muted)]">
                        {d.employer} · {t('po.yearend.issued_on', { when: fmtStampDay(d.issued_at, { entity: d.entity }) })}
                      </span>
                    </span>
                    <Printer size={15} className="text-[var(--hr-muted)]" aria-hidden />
                    <RowCue />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageBody>
    </>
  );
}

function DocTable({ entity, doc, year }: { entity: string; doc: string; year: number }): React.JSX.Element {
  const live = useOp<YearDoc>('yearend.document', { entity, doc, year }, ['payslips', 'payruns', 'yearend_docs'], { name: 'yearend.document' });
  const d = live.data;
  const boxes = d?.doc.boxes ?? [];
  const shown = boxes.slice(0, 5);
  const columns: Column<DocRow>[] = useMemo(
    () => [
      { key: 'person', label: t('po.col.person'), width: 'minmax(180px,1.6fr)', phone: 'title', sort: (r) => r.person.number, render: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate">{r.person.name}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.person.number}{r.person.id ? ' · ' + r.person.id.masked : ''}</span></span> },
      ...shown.map(
        (b, i): Column<DocRow> => ({ key: 'b' + b.key, label: <span title={b.label}>{b.label.length > 22 ? b.key : b.label}</span>, width: 'minmax(110px,1fr)', align: 'right', mono: true, hideBelow: i >= 2 ? 'lg' : undefined, phone: i === 0 ? 'end' : 'hide', sort: (r) => r.boxes[b.key] ?? 0, render: (r) => <Money minor={r.boxes[b.key] ?? 0} currency={d?.currency ?? ''} /> }),
      ),
      { key: 'print', label: '', width: '48px', phone: 'hide', render: (r) => <a className="inline-flex size-10 items-center justify-center md:size-8 rounded-[var(--hr-radius-sm)] text-[var(--hr-muted)] transition-colors hover:bg-[var(--hr-hover)]" title={t('po.print')} href={`#/print/payroll/year-end/${doc}?entity=${entity}&year=${year}&employment=${r.employment}`}><Printer size={14} aria-hidden /></a> },
    ],
    [d, doc, entity, year],
  );
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  return (
    <>
      {d.warnings.map((w) => (
        <Notice key={w.code} tone="warn" className="mx-3.5 mb-2">
          {w.message}
        </Notice>
      ))}
      {d.doc.per === 'entity' ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 px-3.5 pb-3 sm:grid-cols-2">
          {boxes.map((b) => (
            <div key={b.key} className="flex items-baseline justify-between gap-3 border-b border-[var(--hr-hair)] py-1.5 text-[13px]">
              <dt className="min-w-0 text-[var(--hr-muted)]">{b.label}</dt>
              <dd>
                <Money minor={d.totals[b.key] ?? 0} currency={d.currency} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <DataTable
          label={d.doc.name}
          columns={columns}
          rows={d.rows}
          rowKey={(r) => r.employment}
          empty={<Empty icon={FileText} title={t('po.yearend.nobody')}>{t('po.yearend.nobody_text')}</Empty>}
          foot={d.rows.length > 0 ? <span className="flex justify-between px-3 text-[12px]"><span>{tn('po.n_people', d.count)}</span><span className="flex gap-6">{shown.slice(0, 2).map((b) => <Money key={b.key} minor={d.totals[b.key] ?? 0} currency={d.currency} />)}</span></span> : undefined}
        />
      )}
    </>
  );
}

export function YearEndPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const picked = query.get('entity') ?? '';
  const ent = useEntity(picked);
  const thisYear = Number(me.today.slice(0, 4));
  const year = Number(query.get('year') ?? '') || 0;
  const live = useOp<{ documents: YearOverviewRow[] }>('yearend.overview', { entity: ent?.id, year: year === 0 ? undefined : year }, ['payruns', 'payslips', 'yearend_docs'], { name: 'yearend.overview', skip: ent === null || !can(me, 'payroll', 'view') });
  const [openDoc, setOpenDoc] = useState('');
  const [busy, setBusy] = useState('');
  if (!can(me, 'payroll', 'view')) return <MyDocuments />;
  const docs = live.data?.documents ?? null;
  const shownYear = year !== 0 ? year : docs?.[0]?.year ?? thisYear;
  // one primary on the page: the first document ready to issue
  const next = docs?.find((r) => r.per === 'employee' && r.people > 0 && r.open_runs === 0 && r.issued === 0)?.doc ?? '';
  const exportCsv = async (doc: string): Promise<void> => {
    setBusy('csv' + doc);
    try {
      const r = await op<{ csv: string; filename: string }>('yearend.csv', { entity: ent?.id, doc, year: shownYear });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };
  const issue = async (row: YearOverviewRow): Promise<void> => {
    setBusy('issue' + row.doc);
    try {
      const r = await op<{ issued: number }>('yearend.issue', { entity: row.entity, doc: row.doc, year: row.year }, { pin: { title: t('po.yearend.issue_pin', { form: row.form }), text: tn('po.yearend.issue_text', row.people) } });
      changed('yearend_docs');
      toast.success(tn('po.yearend.issued', r.issued));
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };
  const controls = (
    <>
      <EntityChooser value={ent?.id ?? ''} onChange={(v) => setQuery({ entity: v })} />
      <Segmented value={String(shownYear)} onChange={(v) => setQuery({ year: v })} label={t('po.yearend.year')} size="sm" options={[thisYear - 1, thisYear].map((y) => ({ value: String(y), label: String(y) }))} />
    </>
  );
  return (
    <>
      <PageHeader title={t('po.yearend.title')} meta={[ent?.name ?? '', docs?.[0]?.label ?? String(shownYear)].join(' · ')}>
        <span className="hidden items-center gap-2 md:inline-flex">{controls}</span>
      </PageHeader>
      <PageBody>
        <div className="mb-3 flex flex-wrap gap-2 md:hidden">{controls}</div>
        {docs === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : docs.length === 0 ? (
          <div className="hr-panel hr-in">
            <Empty icon={FileText} title={t('po.yearend.none')} action={<Button onClick={() => navigate('/payroll/packs')}>{t('po.yearend.see_packs')}</Button>}>
              {t('po.yearend.none_text')}
            </Empty>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {docs.map((row, i) => (
              <Panel
                key={row.doc}
                index={String(i + 1).padStart(2, '0')}
                label={row.name}
                flush
                aside={
                  <span className="flex items-center gap-1.5">
                    {row.issued > 0 && <Tag tone="good">{tn('po.yearend.issued_n', row.issued)}</Tag>}
                    {row.open_runs > 0 && <Tag tone="warn">{tn('po.yearend.open_runs', row.open_runs)}</Tag>}
                  </span>
                }
              >
                <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3">
                  <span className="hr-mono text-[12px] text-[var(--hr-muted)]">
                    {row.label} · {fmtDay(row.start)} · {fmtDay(row.end)} · {tn('po.n_people', row.people)} · {tn('po.yearend.locked_runs', row.locked_runs)}
                  </span>
                  <span className="flex-1" />
                  <Button size="sm" variant={openDoc === row.doc ? 'default' : 'ghost'} icon={FileText} onClick={() => setOpenDoc(openDoc === row.doc ? '' : row.doc)}>
                    {openDoc === row.doc ? t('po.yearend.hide') : t('po.yearend.view')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={Printer} disabled={row.people === 0} onClick={() => navigate(`/print/payroll/year-end/${row.doc}`, { entity: row.entity, year: row.year })}>
                    {t('po.yearend.print_all')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={Download} busy={busy === 'csv' + row.doc} disabled={row.people === 0} onClick={() => void exportCsv(row.doc)}>
                    {t('po.yearend.csv')}
                  </Button>
                  {can(me, 'payroll', 'full') && row.per === 'employee' && (
                    <Button size="sm" variant={row.doc === next ? 'primary' : 'default'} icon={Send} busy={busy === 'issue' + row.doc} disabled={row.people === 0 || row.open_runs > 0} onClick={() => void issue(row)}>
                      {row.issued > 0 ? t('po.yearend.issue_again') : t('po.yearend.issue')}
                    </Button>
                  )}
                </div>
                {openDoc === row.doc && <DocTable entity={row.entity} doc={row.doc} year={row.year} />}
              </Panel>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
