/**
 * The payslip: earnings, deductions, employer costs, reimbursements and net,
 * year to date, and every line opening into its explanation (the rule, the
 * values it read, the table rows, the pack version). Used by the run page's
 * drawer, the payslip page (employees) and the print page.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Printer } from 'lucide-react';
import { Button, Empty, Hint, IconButton, LoadError, Loading, Money, Notice, PageBody, PageHeader, Panel, Sheet, SheetHeader, StatusDot, Tag } from '../../../components/ui.tsx';
import { op } from '../../../lib/api.ts';
import type { PageProps } from '../../../lib/contract.ts';
import { fmtDay, number } from '../../../lib/format.ts';
import { t } from '../../../lib/i18n.ts';
import { useOp } from '../../../lib/live.ts';
import { navigate } from '../../../lib/router.ts';
import { issueFix, issueText, issueWhen, kindLabel, periodLabel, periodWords, SLIP_TONE } from '../../../components/payroll/bits.tsx';
import { IssueFix } from '../../../components/payroll/IssueFix.tsx';
import type { Line, Payslip } from './types.ts';

const READS = ['payslips', 'payslip_lines', 'payruns'];
const OPEN_RUN = ['draft', 'calculated', 'approved'];

interface LineDetail {
  line: Line;
  pack?: { code: string; name: string; version: string; sources: { title: string; url: string }[]; notes: string };
  step?: { code: string; name: string; amount: string; when: string; explain: string; round: { mode: string; step: number } | null } | null;
  vars?: Record<string, { expr: string; value: unknown }>;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return t('payroll.no_value');
  if (typeof v === 'number') return Number.isInteger(v) ? number(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** The explanation of one line: ours for input lines, the pack's rule and values for pack lines. */
function LineExplain({ line, currency }: { line: Line; currency: string }): React.JSX.Element {
  const [detail, setDetail] = useState<LineDetail | null>(null);
  useEffect(() => {
    if (line.source !== 'pack') return;
    let alive = true;
    op<LineDetail>('payslips.line', { line: line.id }, { quiet: true })
      .then((d) => alive && setDetail(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [line.id, line.source]);
  const ex = line.explain;
  return (
    <div className="hr-wrap mb-2 ml-6 rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-sunk)] px-3 py-2 text-[12px] text-[var(--hr-ink-2)]">
      {line.source === 'pack' ? (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Tag tone="neutral">{(detail?.pack?.name ?? line.pack) + ' ' + line.pack_version}</Tag>
            {detail?.step?.explain && <span>{detail.step.explain}</span>}
          </div>
          {ex.expr !== undefined && (
            <div className="hr-mono mb-1 break-all text-[12px]">
              {line.code} = {ex.expr}
              {ex.when !== undefined && <span className="text-[var(--hr-faint)]">{'  when ' + ex.when}</span>}
            </div>
          )}
          {(ex.reads ?? []).length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5">
              {(ex.reads ?? []).map((r) => (
                <div key={r.name} className="contents">
                  <span className="hr-mono min-w-0 truncate text-[12px]">{r.name}</span>
                  <span className="hr-mono text-right text-[12px]">{show(r.value)}</span>
                </div>
              ))}
            </div>
          )}
          {(ex.tables ?? []).map((tb, i) => (
            <div key={i} className="hr-mono mt-1 text-[12px] text-[var(--hr-faint)]">
              {tb.fn}({tb.table}, {show(tb.x ?? tb.key)}) = {show(tb.value)}
            </div>
          ))}
          {ex.value !== undefined && ex.rounded && (
            <div className="hr-mono mt-1 text-[12px] text-[var(--hr-faint)]">{t('payroll.explain.rounded', { value: show(ex.value), mode: ex.rounded.mode, step: show(ex.rounded.step) })}</div>
          )}
          {detail?.vars && Object.keys(detail.vars).length > 0 && (
            <div className="mt-2 border-t border-[var(--hr-hair)] pt-1">
              {Object.keys(detail.vars).map((k) => {
                const vv = detail.vars?.[k];
                return (
                  <div key={k} className="hr-mono break-all text-[10.5px] text-[var(--hr-faint)]">
                    {k} = {vv?.expr} → {show(vv?.value)}
                  </div>
                );
              })}
            </div>
          )}
          {detail?.pack?.sources && detail.pack.sources.length > 0 && <div className="mt-1 text-[12px] text-[var(--hr-faint)]">{t('payroll.explain.source', { source: detail.pack.sources[0]?.title ?? '' })}</div>}
        </>
      ) : (
        <>
          <div>{ex.note ?? t('payroll.explain.input')}</div>
          {ex.method !== undefined && <div className="hr-mono mt-1 text-[12px]">{t('payroll.explain.method', { method: t('payroll.proration.' + String(ex.method)) })}</div>}
          {(ex.segments ?? []).map((s, i) => (
            <div key={i} className="hr-mono text-[12px]">
              {periodLabel(s.from, s.to)}: <Money minor={s.period_amount_minor} currency={currency} /> × {show(s.fraction)}
            </div>
          ))}
          {line.qty !== 0 && line.rate !== 0 && (
            <div className="hr-mono mt-1 text-[12px]">
              {show(line.qty)} × {show(line.rate)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LineRow({ line, currency, open, onToggle, info }: { line: Line; currency: string; open: boolean; onToggle: () => void; info?: boolean | undefined }): React.JSX.Element {
  const hint = typeof line.explain.note === 'string' && line.explain.note !== '' ? line.explain.note : info === true ? t('payroll.slip.info_hint', { pack: line.pack !== '' ? line.pack.toUpperCase() : '' }) : '';
  return (
    <>
      <div className="flex min-w-0 items-center gap-1">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[var(--hr-radius-sm)] px-1 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--hr-hover)] sm:min-h-0">
        {open ? <ChevronDown size={14} className="shrink-0 text-[var(--hr-faint)]" /> : <ChevronRight size={14} className="shrink-0 text-[var(--hr-faint)]" />}
        <span className="hr-wrap min-w-0 flex-1 text-[13px]">
          {line.name}
          {line.qty !== 0 && line.qty !== 1 && line.source === 'input' && line.rate !== 0 && <span className="hr-mono ml-2 text-[10.5px] text-[var(--hr-faint)]">{show(line.qty)}</span>}
        </span>
        <Money minor={line.amount_minor} currency={currency} className="hr-mono hr-num text-[13px]" />
      </button>
      {hint !== '' && <Hint text={hint} />}
      </div>
      {open && <LineExplain line={line} currency={currency} />}
    </>
  );
}

/** `fix`: issues get their Fix in place (the run page's drawer, while the run is open). */
export function PayslipView({ slip, fix }: { slip: Payslip; fix?: boolean | undefined }): React.JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string): void => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const cur = slip.currency;
  return (
    // The figures follow the width the payslip has (container queries), not the window's: in the run's drawer a wide
    // window still leaves it narrow, and side by side the amounts ran into each other.
    <div className="@container flex min-w-0 flex-col gap-3">
      <div className="grid min-w-0 grid-cols-1 gap-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="hr-panel min-w-0 px-3 py-2.5">
          <div className="hr-label">{t('payroll.net_pay')}</div>
          <Money minor={slip.net_minor} currency={cur} className="hr-mono hr-num block text-[26px] font-light leading-tight" />
        </div>
        <div className="hr-panel @container min-w-0 px-3">
          <div className="grid min-w-0 grid-cols-1 divide-y divide-[var(--hr-hair)] @md:grid-cols-3 @md:gap-3 @md:divide-y-0 @md:py-2.5">
            {[
              ['payroll.gross', slip.gross_minor],
              ['payroll.deductions', slip.deductions_minor],
              ['payroll.employer_cost', slip.employer_minor],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex min-w-0 items-baseline justify-between gap-3 py-2 @md:block @md:py-0">
                <div className="hr-label">{t(String(k))}</div>
                <Money minor={Number(v)} currency={cur} className="hr-mono hr-num block text-[15px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
      {slip.held && <Notice tone="warn">{t('payroll.slip.held')}</Notice>}
      {(slip.issues ?? []).length > 0 && (
        <Notice tone={(slip.issues ?? []).some((i) => i.severity === 'blocker') ? 'bad' : 'warn'}>
          <div className="flex flex-col gap-1">
            {(slip.issues ?? []).map((i, k) =>
              fix === true && OPEN_RUN.indexOf(slip.payrun_status) >= 0 ? (
                <div key={k} className="flex min-w-0 flex-wrap items-start gap-2">
                  <span className="hr-wrap min-w-0 flex-1 pt-1">
                    {issueText(i)}
                    {issueWhen(i) !== '' && ' (' + issueWhen(i) + ')'}
                  </span>
                  <IssueFix issue={{ ...i, employment: i.employment ?? slip.employment, name: i.name ?? slip.employee_name }} runId={slip.payrun} currency={slip.currency} periodStart={slip.period_start} />
                </div>
              ) : (
                <div key={k} className="hr-wrap">
                  {issueText(i)}
                  {issueWhen(i) !== '' && ' (' + issueWhen(i) + ')'}
                  {i.fix && (
                    <a href={i.fix.link} className="ml-2 cursor-pointer underline">
                      {issueFix(i)}
                    </a>
                  )}
                </div>
              ),
            )}
          </div>
        </Notice>
      )}
      {slip.groups.map((g, gi) => (
        <Panel key={g.key} index={String(gi + 1).padStart(2, '0')} label={t('payroll.group.' + g.key)} aside={g.key === 'info' ? undefined : <Money minor={g.total_minor} currency={cur} className="hr-mono hr-num text-[12px]" />}>
          <div className="flex flex-col">
            {g.lines.map((l) => (
              <LineRow key={l.id} line={l} currency={cur} open={open[l.id] === true} onToggle={() => toggle(l.id)} info={g.key === 'info'} />
            ))}
          </div>
        </Panel>
      ))}
      {slip.ytd && (
        <Panel label={t('payroll.ytd_from', { day: fmtDay(slip.ytd.from) })}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ['payroll.gross', slip.ytd.gross_minor],
              ['payroll.deductions', slip.ytd.deductions_minor],
              ['payroll.net_pay', slip.ytd.net_minor],
              ['payroll.employer_cost', slip.ytd.employer_minor],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <div className="hr-label">{t(String(k))}</div>
                <Money minor={Number(v)} currency={cur} className="hr-mono hr-num text-[13px]" />
              </div>
            ))}
          </div>
        </Panel>
      )}
      <div className="hr-wrap text-[12px] text-[var(--hr-faint)]">
        {slip.packs.length > 0 && t('payroll.slip.rules', { packs: slip.packs.map((p) => (p.name !== undefined && p.name !== '' ? p.name : p.code) + ' (' + p.version + ')').join(', ') })}
        {slip.bank_split.length > 0 && (slip.packs.length > 0 ? ' · ' : '') + t('payroll.slip.paid_to', { accounts: slip.bank_split.map((b) => (b.bank_name !== '' ? b.bank_name + ' ' : '') + b.number_masked).join(', ') })}
      </div>
    </div>
  );
}

/** The payslip in a right drawer (run page). */
export function PayslipDrawer({ id, onClose, extra, fix }: { id: string; onClose: () => void; extra?: ((s: Payslip) => React.ReactNode) | undefined; fix?: boolean | undefined }): React.JSX.Element {
  const live = useOp<{ payslip: Payslip }>('payslips.get', { payslip: id }, READS, { skip: id === '' });
  const s = live.data?.payslip ?? null;
  return (
    <Sheet open={id !== ''} onClose={onClose} width={560} label={t('payroll.payslip')}>
      <SheetHeader
        title={s ? s.employee_name : t('payroll.payslip')}
        meta={s ? [s.employee_number, s.title, periodLabel(s.period_start, s.period_end)].filter((x) => x !== '').join(' · ') : ''}
        onClose={onClose}
        actions={
          s ? (
            <>
              {extra !== undefined && extra(s)}
              <Button size="sm" variant="ghost" icon={Printer} onClick={() => navigate('/print/payroll/payslip/' + s.id)}>
                {t('payroll.print')}
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="hr-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">{s === null ? live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading /> : <PayslipView slip={s} fix={fix} />}</div>
    </Sheet>
  );
}

/** #/payroll/payslip/:id: one payslip (what an employee opens from a notice). */
export function PayslipPage({ params }: PageProps): React.JSX.Element {
  const live = useOp<{ payslip: Payslip }>('payslips.get', { payslip: params.id ?? '' }, READS);
  const s = live.data?.payslip ?? null;
  useEffect(() => {
    if (s !== null && s.access === 'self') void op('payslips.viewed', { payslip: s.id }, { quiet: true }).catch(() => undefined);
  }, [s]);
  if (s === null)
    return (
      <>
        <PageHeader title={t('payroll.payslip')} back="#/payroll" />
        <PageBody>{live.error !== null ? live.code === 'not_permitted' || live.code === 'not_found' ? <Empty icon={FileText} title={t('payroll.slip.not_found')} /> : <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  return (
    <>
      <PageHeader title={t('payroll.payslip_for', { period: periodWords(s.period_start, s.period_end) })} meta={[s.entity_name, s.employee_name, t('payroll.pay_day_on', { day: fmtDay(s.pay_date, { year: 'always' }) }), t('payroll.slip_status.' + s.status)].join(' · ')} back={s.access === 'payroll' ? '#/payroll/runs/' + s.payrun : '#/payroll'}>
        <span className="hidden sm:inline-flex">
          <StatusDot tone={SLIP_TONE[s.status] ?? 'neutral'} label={t('payroll.slip_status.' + s.status)} />
        </span>
        {s.kind !== 'regular' && <Tag className="hidden sm:inline-flex">{kindLabel(s.kind)}</Tag>}
        <Button className="hidden sm:inline-flex" icon={Printer} onClick={() => navigate('/print/payroll/payslip/' + s.id)}>
          {t('payroll.print')}
        </Button>
        <IconButton className="sm:hidden" icon={Printer} label={t('payroll.print')} onClick={() => navigate('/print/payroll/payslip/' + s.id)} />
      </PageHeader>
      <PageBody>
        <div className="hr-in mx-auto max-w-[880px]">
          <PayslipView slip={s} fix={s.access === 'payroll'} />
        </div>
      </PageBody>
    </>
  );
}
