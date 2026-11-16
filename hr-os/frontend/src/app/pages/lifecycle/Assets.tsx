/**
 * Assets: what the company lends people (laptops, phones, cards, keys...).
 * A dense list with status, category and a search; a sheet with the asset's
 * history and its one next action (issue or return); CSV import and export.
 */
import { useEffect, useState } from 'react';
import { Download, FileUp, History, Laptop, MoreHorizontal, Pencil, Plus, Trash2, Undo2, UserPlus, X } from 'lucide-react';
import { Button, DataTable, Dialog, Empty, FactStrip, FileDrop, LoadError, Menu, MenuItem, Money, Notice, PageBody, PageHeader, Picker, SearchInput, Segmented, Sheet, SheetHeader, StatTile, StatusDot, Textarea, confirmAsk, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { Acts, PhoneActs } from '../../components/lifecycle/Acts.tsx';
import { ASSET_READS, ASSET_TONE, SkeletonRows } from '../../components/lifecycle/bits.tsx';
import { AssetDialog, CATEGORIES, IssueAssetDialog, ReturnAssetDialog } from '../../components/lifecycle/dialogs.tsx';
import type { Asset } from '../../components/lifecycle/types.ts';
import { op, opForm, saveText } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';

interface AssetList {
  assets: Asset[];
  total: number;
  counts: Record<string, number>;
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<{ rows: number; ok: number; errors: { line: number; message: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCsv('');
      setFile(null);
      setReport(null);
    }
  }, [open]);
  const check = async (f: File | null, text: string): Promise<void> => {
    setBusy(true);
    try {
      const r = f !== null ? await opForm<typeof report & object>('assets.import-check', {}, { file: f }) : await op<typeof report & object>('assets.import-check', { csv: text });
      setReport(r);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const commit = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = file !== null ? await opForm<{ imported: number }>('assets.import', {}, { file }) : await op<{ imported: number }>('assets.import', { csv });
      changed(...ASSET_READS);
      toast.success(tn('lifecycle.imported_assets', r.imported));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.import_assets')}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          {report !== null && report.errors.length === 0 && report.ok > 0 ? (
            <Button variant="primary" busy={busy} onClick={() => void commit()}>
              {tn('lifecycle.import_n', report.ok)}
            </Button>
          ) : (
            <Button variant="primary" busy={busy} disabled={file === null && csv.trim() === ''} onClick={() => void check(file, csv)}>
              {t('lifecycle.check')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FileDrop onFiles={(f) => (setFile(f[0] ?? null), setReport(null), void check(f[0] ?? null, ''))} accept=".csv,text/csv" label={file !== null ? file.name : t('lifecycle.choose_csv')}>
          <span className="hr-mono text-[12px] text-[var(--hr-muted)]">name, category, tag, serial, entity, value, currency, purchased_day, condition, employee, issued_day, note</span>
        </FileDrop>
        {file === null && <Textarea value={csv} onChange={(e) => (setCsv(e.target.value), setReport(null))} minRows={3} placeholder={'name,category,value\nMacBook Air 13,laptop,1899.00'} className="hr-mono !text-[12px]" />}
        {report !== null && (report.errors.length === 0 ? <Notice tone="good">{tn('lifecycle.rows_ready', report.ok)}</Notice> : <Notice tone="bad"><ul>{report.errors.slice(0, 12).map((e, i) => <li key={i}>{t('lifecycle.line_problem', { line: e.line, message: e.message })}</li>)}</ul></Notice>)}
      </div>
    </Dialog>
  );
}

function AssetSheet({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const me = useMe();
  const canEdit = can(me, 'people', 'edit');
  const live = useOp<{ asset: Asset }>('assets.get', { asset: id }, ASSET_READS, { name: 'lifecycle.asset', skip: id === '' });
  const [dialog, setDialog] = useState<'edit' | 'issue' | 'return' | null>(null);
  const a = live.data?.asset ?? null;
  const retire = async (): Promise<void> => {
    if (a === null || !(await confirmAsk(t('lifecycle.retire_text', { name: a.name }), t('lifecycle.retire'), t('lifecycle.retire')))) return;
    try {
      await op('assets.retire', { asset: a.id });
      changed(...ASSET_READS);
    } catch {
      /* toast shown */
    }
  };
  const remove = async (): Promise<void> => {
    if (a === null || !(await confirmAsk(t('lifecycle.delete_asset_text', { name: a.name }), t('lifecycle.delete_asset')))) return;
    try {
      await op('assets.delete', { asset: a.id });
      changed(...ASSET_READS);
      onClose();
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <Sheet open={id !== ''} onClose={onClose} label={t('lifecycle.asset')} width={460}>
        {a === null ? (
          <SkeletonRows bare />
        ) : (
          <>
            <SheetHeader
              title={a.name}
              meta={[a.tag, t(`lifecycle.cat.${a.category}`)].join(' · ')}
              onClose={onClose}
              actions={
                canEdit ? (
                  <Menu icon={MoreHorizontal} label={t('lifecycle.asset_menu')}>
                    {(close) => (
                      <>
                        <MenuItem icon={Pencil} onClick={() => (close(), setDialog('edit'))}>
                          {t('ui.edit')}
                        </MenuItem>
                        {a.status === 'in_stock' && (
                          <MenuItem icon={X} onClick={() => (close(), void retire())}>
                            {t('lifecycle.retire')}
                          </MenuItem>
                        )}
                        {a.status !== 'issued' && !(a.history ?? []).some((h) => h.event === 'issued') && (
                          <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                            {t('ui.remove')}
                          </MenuItem>
                        )}
                      </>
                    )}
                  </Menu>
                ) : undefined
              }
            />
            <div className="flex flex-col gap-4 px-4 pb-6">
              <div className="flex items-center gap-2">
                <StatusDot tone={ASSET_TONE[a.status] ?? 'neutral'} label={a.status === 'issued' ? t('lifecycle.with_person', { who: a.employee_name }) : t(`lifecycle.asset_status.${a.status}`)} />
                <span className="flex-1" />
                {canEdit && a.status === 'in_stock' && (
                  <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setDialog('issue')}>
                    {t('lifecycle.issue')}
                  </Button>
                )}
                {canEdit && a.status === 'issued' && (
                  <Button variant="primary" size="sm" icon={Undo2} onClick={() => setDialog('return')}>
                    {t('lifecycle.mark_returned')}
                  </Button>
                )}
              </div>
              <FactStrip
                items={[
                  { label: t('lifecycle.f.condition'), value: a.condition !== '' ? t(`lifecycle.cond.${a.condition}`) : '-' },
                  { label: t('lifecycle.f.serial'), value: a.serial !== '' ? a.serial : '-', mono: true },
                  { label: t('lifecycle.f.value'), value: a.value_minor !== undefined && a.value_minor !== null && a.value_minor > 0 ? <Money minor={a.value_minor} currency={a.currency} /> : '-' },
                  { label: t('lifecycle.f.entity'), value: a.entity_name || '-' },
                  ...(a.issued_day !== '' && a.status === 'issued' ? [{ label: t('lifecycle.issued_on'), value: fmtDay(a.issued_day), mono: true }] : []),
                ]}
              />
              {(a.note ?? '') !== '' && <div className="hr-wrap text-[13px] text-[var(--hr-ink-2)]">{a.note}</div>}
              <div>
                <div className="hr-label mb-2 flex items-center gap-1.5">
                  <History size={12} aria-hidden />
                  {t('lifecycle.history')}
                </div>
                <ol className="flex flex-col">
                  {[...(a.history ?? [])].reverse().map((h, i) => (
                    <li key={i} className="flex gap-3 border-b border-[var(--hr-hair)] py-2 text-[13px] last:border-b-0">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{t(`lifecycle.asset_event.${h.event}`, { who: h.employee_name ?? '' })}</span>
                        <span className="block text-[12px] text-[var(--hr-muted)]">{[h.condition !== undefined && h.condition !== '' ? t(`lifecycle.cond.${h.condition}`) : '', h.note ?? '', h.by_name ?? ''].filter((x) => x !== '').join(' · ')}</span>
                      </span>
                      <span className="hr-label shrink-0">{h.day !== undefined && h.day !== '' ? fmtDay(h.day) : ago(h.at)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </>
        )}
      </Sheet>
      <AssetDialog open={dialog === 'edit'} onClose={() => setDialog(null)} asset={a} />
      <IssueAssetDialog open={dialog === 'issue'} onClose={() => setDialog(null)} asset={a} />
      <ReturnAssetDialog open={dialog === 'return'} onClose={() => setDialog(null)} asset={a} />
    </>
  );
}

export function AssetsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const canEdit = can(me, 'people', 'edit');
  const status = (['all', 'in_stock', 'issued', 'retired'] as const).find((s) => s === query.get('status')) ?? 'all';
  const category = query.get('category') ?? '';
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [limit, setLimit] = useState(100);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const live = useOp<AssetList>('assets.list', { status, category: category === '' ? undefined : category, q: debounced === '' ? undefined : debounced, limit }, ASSET_READS, { name: 'lifecycle.assets' });
  const d = live.data;
  const open = query.get('a') ?? '';
  const columns: Column<Asset>[] = [
    { key: 'name', label: t('lifecycle.f.asset_name'), width: 'minmax(200px,1.8fr)', phone: 'title', sort: (r) => r.name, render: (r) => <span className="hr-wrap font-medium">{r.name}</span> },
    { key: 'tag', label: t('lifecycle.f.tag'), width: '90px', mono: true, sort: (r) => r.tag, render: (r) => r.tag },
    { key: 'category', label: t('lifecycle.f.category'), width: '130px', hideBelow: 'lg', sort: (r) => r.category, render: (r) => t(`lifecycle.cat.${r.category}`) },
    { key: 'who', label: t('lifecycle.with'), width: 'minmax(140px,1.2fr)', sort: (r) => r.employee_name, render: (r) => (r.status === 'issued' ? r.employee_name : <span className="text-[var(--hr-muted)]">{t(`lifecycle.asset_status.${r.status}`)}</span>) },
    { key: 'condition', label: t('lifecycle.f.condition'), width: '100px', hideBelow: 'xl', render: (r) => (r.condition !== '' ? t(`lifecycle.cond.${r.condition}`) : '') },
    { key: 'value', label: t('lifecycle.f.value'), width: '120px', align: 'right', mono: true, hideBelow: 'lg', sort: (r) => r.value_minor ?? 0, render: (r) => (r.value_minor !== undefined && r.value_minor !== null && r.value_minor > 0 ? <Money minor={r.value_minor} currency={r.currency} /> : '') },
    { key: 'status', label: t('lifecycle.status'), width: '110px', phone: 'end', render: (r) => <StatusDot tone={ASSET_TONE[r.status] ?? 'neutral'} label={t(`lifecycle.asset_status.${r.status}`)} /> },
  ];
  const addBtn = canEdit ? (
    <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
      {t('lifecycle.add_asset')}
    </Button>
  ) : null;
  const exportCsv = async (): Promise<void> => {
    try {
      const r = await op<{ csv: string; filename: string }>('assets.export', { status: status === 'all' ? undefined : status });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <PageHeader title={t('lifecycle.assets')} meta={d !== null ? tn('lifecycle.meta_assets', (d.counts['in_stock'] ?? 0) + (d.counts['issued'] ?? 0)) : ''} back="#/lifecycle">
        {addBtn !== null && <Acts>{addBtn}</Acts>}
      </PageHeader>
      <PageBody>
        {addBtn !== null && <PhoneActs>{addBtn}</PhoneActs>}
        {d !== null && (
          <div className="mb-3 grid grid-cols-3 gap-3">
            <StatTile index="01" label={t('lifecycle.asset_status.issued')} value={d.counts['issued'] ?? 0} onClick={() => setQuery({ status: 'issued' })} />
            <StatTile index="02" label={t('lifecycle.asset_status.in_stock')} value={d.counts['in_stock'] ?? 0} onClick={() => setQuery({ status: 'in_stock' })} />
            <StatTile index="03" label={t('lifecycle.asset_status.retired')} value={d.counts['retired'] ?? 0} onClick={() => setQuery({ status: 'retired' })} />
          </div>
        )}
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <SearchInput value={q} onChange={setQ} placeholder={t('lifecycle.search_assets')} className="w-full sm:w-[240px]" />
            <Segmented
              value={status}
              onChange={(v) => setQuery({ status: v === 'all' ? undefined : v })}
              label={t('lifecycle.status')}
              size="sm"
              options={[
                { value: 'all', label: t('lifecycle.all') },
                { value: 'issued', label: t('lifecycle.asset_status.issued') },
                { value: 'in_stock', label: t('lifecycle.asset_status.in_stock') },
                { value: 'retired', label: t('lifecycle.asset_status.retired') },
              ]}
            />
            <Picker value={category} onChange={(v) => setQuery({ category: v === '' ? undefined : v })} items={CATEGORIES.map((c) => ({ value: c, label: t(`lifecycle.cat.${c}`) }))} label={t('lifecycle.f.category')} placeholder={t('lifecycle.any_category')} clearable className="w-[160px]" />
            <span className="flex-1" />
            <Button size="sm" variant="ghost" icon={Download} onClick={() => void exportCsv()}>
              {t('ui.export')}
            </Button>
            {canEdit && (
              <Button size="sm" variant="ghost" icon={FileUp} onClick={() => setImporting(true)}>
                {t('ui.import')}
              </Button>
            )}
          </div>
          {d === null ? (
            live.error !== null ? (
              <LoadError message={live.error} onRetry={live.reload} />
            ) : (
              <SkeletonRows />
            )
          ) : (
            <DataTable
              label={t('lifecycle.assets')}
              columns={columns}
              rows={d.assets}
              rowKey={(r) => r.id}
              onRowClick={(r) => setQuery({ a: r.id })}
              hasMore={d.total > d.assets.length}
              onMore={() => setLimit((l) => l + 100)}
              loadingMore={live.loading}
              empty={
                <Empty
                  icon={Laptop}
                  title={debounced !== '' || category !== '' || status !== 'all' ? t('lifecycle.no_assets_match') : t('lifecycle.no_assets')}
                  action={
                    canEdit && debounced === '' && category === '' && status === 'all' ? (
                      <>
                        <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                          {t('lifecycle.add_first_asset')}
                        </Button>
                        <Button icon={FileUp} onClick={() => setImporting(true)}>
                          {t('lifecycle.import_sheet')}
                        </Button>
                      </>
                    ) : undefined
                  }
                />
              }
            />
          )}
        </div>
      </PageBody>
      <AssetDialog open={adding} onClose={() => setAdding(false)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <AssetSheet id={open} onClose={() => setQuery({ a: undefined })} />
    </>
  );
}

