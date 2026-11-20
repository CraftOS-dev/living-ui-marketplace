/**
 * Filings: every statutory obligation per entity and period, the soonest
 * first. A row opens its worksheet from locked runs, with the one next step
 * for its status: prepare, submit with the reference, record the answer.
 */
import { useMemo, useState } from 'react';
import { CalendarClock, Check, Download, FileCheck2, MoreHorizontal, Printer, RefreshCw, RotateCcw, Send, X } from 'lucide-react';
import { Button, DataTable, DayPicker, Dialog, Empty, Fact, Field, Input, LoadError, Loading, Menu, MenuItem, Notice, PageBody, PageHeader, Panel, Section, Segmented, Sheet, SheetHeader, StatTile, Tag, Money } from '../../../components/ui.tsx';
import type { Column } from '../../../components/ui.tsx';
import { DueText, FilingStatus, periodLabel } from '../../../components/payroll-out/parts.tsx';
import { download, op } from '../../../lib/api.ts';
import { can, useMe } from '../../../lib/auth.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { fmtDay } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { changed, useOp } from '../../../lib/live.ts';
import { navigate, setQuery } from '../../../lib/router.ts';
import { toast } from '../../../lib/toast.ts';
import { useUi } from '../../../lib/store.tsx';
import type { Filing, FilingDetail, FilingList } from './types.ts';

const OPEN = ['todo', 'prepared', 'amend', 'rejected'];
type Show = 'due' | 'open' | 'done' | 'all';

function AskDialog({ open, title, label, hint, ok, day, onClose, onOk }: { open: boolean; title: string; label: string; hint?: string; ok: string; day?: boolean; onClose: () => void; onOk: (text: string, day: string) => Promise<void> }): React.JSX.Element {
  const [text, setText] = useState('');
  const [d, setD] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={text.trim() === ''}
            onClick={() => {
              setBusy(true);
              void onOk(text.trim(), d).finally(() => {
                setBusy(false);
                setText('');
              });
            }}
          >
            {ok}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={label} hint={hint}>
          <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        {day === true && (
          <Field label={t('po.filing.submitted_on')}>
            <DayPicker value={d} onChange={setD} label={t('po.filing.submitted_on')} clearable />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function FilingSheet({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ filing: FilingDetail }>('filings.get', { filing: id }, ['filings', 'payruns'], { name: 'filings.get' });
  const [ask, setAsk] = useState<'' | 'submit' | 'skip' | 'reject'>('');
  const [due, setDue] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const f = live.data?.filing ?? null;
  const edit = can(me, 'payroll', 'edit');
  const run = async (name: 'filings.prepare' | 'filings.result' | 'filings.reopen' | 'filings.set-due', params: Record<string, unknown>, done: string): Promise<void> => {
    setBusy(name);
    try {
      await op(name, { filing: id, ...params });
      changed('filings');
      toast.success(done);
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };
  if (f === null) return <div className="p-4">{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</div>;
  const ws = f.worksheet;
  const open = OPEN.indexOf(f.status) >= 0;
  return (
    <>
      <SheetHeader
        title={f.name}
        meta={[periodLabel(f), f.entity_name, f.form].filter((x) => x !== '').join(' · ')}
        onClose={onClose}
        actions={
          <Button size="sm" variant="ghost" icon={Printer} onClick={() => navigate(`/print/payroll/filing/${f.id}`)}>
            {t('po.print')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <FilingStatus status={f.status} />
          {f.reference !== '' && <Tag>{f.reference}</Tag>}
        </div>
        {f.status === 'amend' && <Notice tone="warn">{t('po.filing.amend_text')}</Notice>}
        {f.status === 'rejected' && <Notice tone="bad">{f.note !== '' ? f.note : t('po.filing.rejected_text')}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Fact label={t('po.filing.due')}>
            <DueText day={f.due_day} daysLeft={f.days_left} open={open} />
          </Fact>
          <Fact label={t('po.filing.amount')} mono>
            <Money minor={f.amount_minor} currency={f.currency} />
          </Fact>
          <Fact label={t('po.filing.period')} mono>
            {t('po.filing.range', { from: fmtDay(f.period_start), to: fmtDay(f.period_end) })}
          </Fact>
          <Fact label={t('po.filing.payee')}>{f.payee !== '' ? f.payee : t('ui.none')}</Fact>
        </div>
        {f.due_rule !== '' && <p className="hr-wrap text-[12px] text-[var(--hr-muted)]">{f.due_rule}</p>}
        {edit && (f.due_day === '' || f.due_manual) && open && (
          <Section title={t('po.filing.set_due')}>
            <div className="flex items-center gap-2">
              <DayPicker value={due ?? f.due_day} onChange={(v) => setDue(v)} label={t('po.filing.set_due')} />
              <Button size="sm" disabled={(due ?? '') === ''} busy={busy === 'filings.set-due'} onClick={() => void run('filings.set-due', { due_day: due }, t('po.filing.due_set'))}>
                {t('ui.save')}
              </Button>
            </div>
          </Section>
        )}
        {edit && (
          <div className="flex flex-wrap gap-2">
            {(f.status === 'todo' || f.status === 'amend' || f.status === 'rejected') && (
              <Button variant="primary" icon={FileCheck2} busy={busy === 'filings.prepare'} onClick={() => void run('filings.prepare', {}, t('po.filing.prepared'))}>
                {t('po.filing.prepare')}
              </Button>
            )}
            {f.status === 'prepared' && (
              <>
                <Button variant="primary" icon={Send} onClick={() => setAsk('submit')}>
                  {t('po.filing.submit')}
                </Button>
                <Button icon={Download} onClick={() => void download('filings.download', { filing: f.id }, 'save', f.kind + '.csv')}>
                  {t('po.filing.data_file')}
                </Button>
              </>
            )}
            {f.status === 'submitted' && (
              <>
                <Button variant="primary" icon={Check} busy={busy === 'filings.result'} onClick={() => void run('filings.result', { result: 'accepted' }, t('po.filing.accepted'))}>
                  {t('po.filing.accept')}
                </Button>
                <Button icon={X} onClick={() => setAsk('reject')}>
                  {t('po.filing.reject')}
                </Button>
              </>
            )}
            {open && f.status !== 'prepared' && f.has_file && (
              <Button icon={Download} onClick={() => void download('filings.download', { filing: f.id }, 'save', f.kind + '.csv')}>
                {t('po.filing.data_file')}
              </Button>
            )}
            <Menu icon={MoreHorizontal} label={t('ui.more')}>
              {(close) => (
                <>
                  {open && (
                    <MenuItem icon={X} onClick={() => (close(), setAsk('skip'))}>
                      {t('po.filing.not_needed')}
                    </MenuItem>
                  )}
                  {!open && (
                    <MenuItem icon={RotateCcw} onClick={() => (close(), void run('filings.reopen', {}, t('po.filing.reopened')))}>
                      {t('po.filing.reopen')}
                    </MenuItem>
                  )}
                  {f.due_day !== '' && !f.due_manual && open && (
                    <MenuItem icon={CalendarClock} onClick={() => (close(), setDue(f.due_day), void run('filings.set-due', { due_day: f.due_day }, t('po.filing.due_set')))}>
                      {t('po.filing.fix_due')}
                    </MenuItem>
                  )}
                </>
              )}
            </Menu>
          </div>
        )}
        <Panel label={t('po.filing.worksheet')} flush className="!shadow-none">
          {ws.codes.length === 0 ? (
            <p className="px-3.5 pb-3 text-[13px] text-[var(--hr-muted)]">{f.documents ? t('po.filing.documents_text') : t('po.filing.no_lines')}</p>
          ) : (
            <table className="w-full text-[12px]">
              <tbody>
                {ws.codes.map((c) => (
                  <tr key={c.code + c.kind} className="border-t border-[var(--hr-hair)]">
                    <td className="px-3.5 py-1.5">
                      <span className="block">{c.name}</span>
                      <span className="hr-mono text-[12px] text-[var(--hr-muted)]">
                        {c.code} · {t('po.kind_line.' + c.kind)} · {tn('po.n_people', c.people)}
                      </span>
                    </td>
                    <td className="px-3.5 py-1.5 text-right">
                      <Money minor={c.amount} currency={ws.currency} />
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--hr-line)] font-semibold">
                  <td className="px-3.5 py-1.5">{t('po.total')}</td>
                  <td className="px-3.5 py-1.5 text-right">
                    <Money minor={ws.total_minor} currency={ws.currency} />
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </Panel>
        {ws.runs.length > 0 && (
          <Section title={t('po.filing.runs')}>
            <div className="flex flex-wrap gap-1.5">
              {ws.runs.map((r) => (
                <a key={r.id} href={`#/payroll/pay-out/${r.id}`} className="hr-mono inline-flex min-h-10 items-center rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] px-2 py-0.5 md:min-h-0 text-[12px] transition-colors hover:bg-[var(--hr-hover)]">
                  {r.number} · {fmtDay(r.pay_date)}
                </a>
              ))}
            </div>
          </Section>
        )}
        {f.submitted_on !== '' && <p className="text-[12px] text-[var(--hr-muted)]">{t('po.filing.submitted_by', { who: f.submitted_by, when: fmtDay(f.submitted_on) })}</p>}
      </div>
      <AskDialog
        open={ask === 'submit'}
        title={t('po.filing.submit')}
        label={t('po.filing.reference')}
        hint={t('po.filing.reference_hint')}
        ok={t('po.filing.submit_ok')}
        day
        onClose={() => setAsk('')}
        onOk={async (reference, d) => {
          try {
            await op('filings.submit', { filing: id, reference, submitted_on: d === '' ? undefined : d });
            changed('filings');
            toast.success(t('po.filing.submitted'));
            setAsk('');
          } catch {
            /* toast shown */
          }
        }}
      />
      <AskDialog
        open={ask === 'skip'}
        title={t('po.filing.not_needed')}
        label={t('po.filing.why')}
        ok={t('po.filing.not_needed_ok')}
        onClose={() => setAsk('')}
        onOk={async (reason) => {
          try {
            await op('filings.skip', { filing: id, reason });
            changed('filings');
            setAsk('');
          } catch {
            /* toast shown */
          }
        }}
      />
      <AskDialog
        open={ask === 'reject'}
        title={t('po.filing.reject')}
        label={t('po.filing.what_they_said')}
        ok={t('po.filing.reject_ok')}
        onClose={() => setAsk('')}
        onOk={async (note) => {
          try {
            await op('filings.result', { filing: id, result: 'rejected', note });
            changed('filings');
            setAsk('');
          } catch {
            /* toast shown */
          }
        }}
      />
    </>
  );
}

export function FilingsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const show = (query.get('show') as Show | null) ?? 'open';
  const openId = query.get('filing') ?? '';
  const [limit, setLimit] = useState(100);
  const live = useOp<FilingList>('filings.list', { show, entity: entity === '' ? undefined : entity, limit }, ['filings', 'payruns'], { name: 'filings.list' });
  const [busy, setBusy] = useState(false);
  const data = live.data;
  const columns: Column<Filing>[] = useMemo(
    () => [
      { key: 'due', label: t('po.col.due'), width: '130px', sort: (r) => r.due_day || '9999', render: (r) => <DueText day={r.due_day} daysLeft={r.days_left} open={OPEN.indexOf(r.status) >= 0} /> },
      { key: 'name', label: t('po.col.filing'), width: 'minmax(220px,2.4fr)', phone: 'title', sort: (r) => r.name, render: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="hr-wrap">{r.name}</span><span className="text-[12px] text-[var(--hr-muted)]">{periodLabel(r)}{r.form !== '' ? ' · ' + r.form : ''}</span></span> },
      { key: 'entity', label: t('po.col.entity'), width: 'minmax(120px,1fr)', hideBelow: 'xl', sort: (r) => r.entity_name, render: (r) => r.entity_name },
      { key: 'payee', label: t('po.col.payee'), width: 'minmax(110px,1fr)', hideBelow: 'lg', render: (r) => <span className="hr-wrap text-[12px]">{r.payee}</span> },
      { key: 'amount', label: t('po.col.amount'), width: '130px', align: 'right', mono: true, sort: (r) => r.amount_minor, phone: 'end', render: (r) => (r.amount_minor !== 0 ? <Money minor={r.amount_minor} currency={r.currency} /> : '') },
      { key: 'status', label: t('po.col.status'), width: '112px', sort: (r) => r.status, render: (r) => <FilingStatus status={r.status} /> },
    ],
    [],
  );
  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ created: number; amend: number }>('filings.generate', { entity: entity === '' ? undefined : entity });
      changed('filings');
      toast.success(tn('po.filings.refreshed', r.created));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const c = data?.counts;
  return (
    <>
      <PageHeader title={t('po.filings.title')} meta={c !== undefined ? tn('po.filings.meta', c.open) : undefined}>
        <Segmented
          value={show}
          onChange={(v) => setQuery({ show: v === 'open' ? undefined : v })}
          label={t('po.col.status')}
          size="sm"
          className="hidden md:inline-flex"
          options={[
            { value: 'due', label: t('po.f.due_soon') },
            { value: 'open', label: t('po.f.open') },
            { value: 'done', label: t('po.f.done') },
            { value: 'all', label: t('po.f.all') },
          ]}
        />
        {can(me, 'payroll', 'edit') && (
          <Button variant="ghost" icon={RefreshCw} busy={busy} onClick={() => void refresh()} className="hidden md:inline-flex">
            {t('po.filings.refresh')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <div className="mb-3 md:hidden"><Segmented
          value={show}
          onChange={(v) => setQuery({ show: v === 'open' ? undefined : v })}
          label={t('po.col.status')}
          size="sm"
          options={[
            { value: 'due', label: t('po.f.due_soon') },
            { value: 'open', label: t('po.f.open') },
            { value: 'done', label: t('po.f.done') },
            { value: 'all', label: t('po.f.all') },
          ]}
        /></div>
        {c !== undefined && (
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile index="01" label={t('po.kpi.late')} value={c.overdue} tone={c.overdue > 0 ? 'bad' : undefined} onClick={() => setQuery({ show: 'due' })} />
            <StatTile index="02" label={t('po.kpi.due_7')} value={c.due_7} tone={c.due_7 > 0 ? 'warn' : undefined} onClick={() => setQuery({ show: 'due' })} />
            <StatTile index="03" label={t('po.kpi.open')} value={c.open} onClick={() => setQuery({ show: undefined })} />
            <StatTile index="04" label={t('po.kpi.rejected')} value={c.rejected} tone={c.rejected > 0 ? 'bad' : undefined} />
          </div>
        )}
        {c !== undefined && c.no_due > 0 && <Notice tone="warn" className="mb-3">{tn('po.filings.no_due', c.no_due)}</Notice>}
        <div className="hr-panel hr-in min-w-0">
          {data === null ? (
            live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
          ) : (
            <DataTable
              label={t('po.filings.title')}
              columns={columns}
              rows={data.filings}
              rowKey={(r) => r.id}
              onRowClick={(r) => setQuery({ filing: r.id })}
              rowClass={(r) => (r.overdue ? 'bg-[var(--hr-bad-soft)]' : '')}
              hasMore={data.total > data.filings.length}
              onMore={() => setLimit((l) => l + 100)}
              loadingMore={live.loading}
              empty={
                <Empty icon={FileCheck2} title={show === 'done' ? t('po.filings.none_done') : t('po.filings.empty')} action={can(me, 'payroll', 'edit') && show !== 'done' ? <Button variant="primary" icon={RefreshCw} busy={busy} onClick={() => void refresh()}>{t('po.filings.build')}</Button> : undefined}>
                  {show === 'done' ? undefined : t('po.filings.empty_text')}
                </Empty>
              }
            />
          )}
        </div>
      </PageBody>
      <Sheet open={openId !== ''} onClose={() => setQuery({ filing: undefined })} label={t('po.filings.title')} width={520}>
        {openId !== '' && <FilingSheet id={openId} onClose={() => setQuery({ filing: undefined })} />}
      </Sheet>
    </>
  );
}
