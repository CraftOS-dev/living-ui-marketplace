/**
 * The tabs of one agreement besides its grants: the terms grouped as
 * facts, the obligations (deadlines the terms generate), the products made
 * under it, the royalty statements with the minimum-guarantee position,
 * and the history of events.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { CalendarClock, History, Package, Pencil, Plus, Receipt, RefreshCw } from 'lucide-react';
import { Button, toast } from '../../kit/index.ts';
import { op, opToast } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { d10, fmtDate, fmtMoney, fmtNumber, fmtPct } from '../lib/format.ts';
import { enumLabel, joinList, t, tf } from '../lib/i18n.ts';
import { href, navigate } from '../lib/router.ts';
import type { AgreementRec, DeadlineRec, EventRec, PartyRec, ProductRec, RoyaltyReportRec } from '../lib/records.ts';
import { DeadlineList, useDeadlineActions } from './deadlines.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { EventDialog, useEventLabel } from './events.tsx';
import { EmptyHint, EnumPill, Fact, FactGrid, ListRow, Loading, Notice, Prose, Ref, Section, StatTile, Tag } from './ui.tsx';
import type { FormGroup } from './rightsAgreementForm.tsx';
import { plainText } from './rightsAgreementForm.tsx';
import { termText } from './rightsShared.tsx';

function yesNo(v: boolean): string {
  return v ? t('Yes') : t('No');
}

function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x !== null && typeof x === 'object') as Record<string, unknown>[]) : [];
}

function s(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isNaN(x) ? 0 : x;
}

/** "8% of Retail price x sold, MG 1,000,000 JPY" */
export function royaltySummary(a: AgreementRec): string {
  const parts: string[] = [];
  if (a.royalty_basis === 'flat_fee' || (a.royalty_rate === 0 && a.flat_fee > 0)) {
    if (a.flat_fee > 0) parts.push(t('Flat fee {amount}', { amount: fmtMoney(a.flat_fee, a.currency) }));
  } else if (a.royalty_rate > 0) {
    parts.push(a.royalty_basis !== '' && a.royalty_basis !== 'none' ? t('{rate} of {basis}', { rate: fmtPct(a.royalty_rate), basis: enumLabel('agreements.royalty_basis', a.royalty_basis) }) : fmtPct(a.royalty_rate));
  }
  if (a.minimum_guarantee > 0) parts.push(t('MG {amount}', { amount: fmtMoney(a.minimum_guarantee, a.currency) }));
  if (a.advance > 0) parts.push(t('Advance {amount}', { amount: fmtMoney(a.advance, a.currency) }));
  return parts.join(', ');
}

function TermSection({ title, group, onEdit, children }: { title: string; group: FormGroup; onEdit: ((g: FormGroup) => void) | null; children: ReactNode }): React.JSX.Element {
  return (
    <Section
      title={title}
      actions={
        onEdit !== null ? (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onEdit(group)} aria-label={t('Edit {section}', { section: title })}>
            <Pencil size={13} aria-hidden /> {t('Edit')}
          </Button>
        ) : undefined
      }
    >
      {children}
    </Section>
  );
}

function MiniTable({ head, body }: { head: string[]; body: string[][] }): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--agent-app-border)]">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1.5 tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CREATOR_TYPES = ['creator_commission', 'assignment', 'original_work_license', 'publishing', 'music_publishing', 'master_assignment'];
const TALENT_TYPES = ['talent', 'voice_actor'];

export function TermsTab({ agreement: a, onEdit }: { agreement: AgreementRec; onEdit: ((g: FormGroup) => void) | null }): React.JSX.Element {
  const { userName } = useApp();
  const cur = a.currency;
  const tiers = rows(a.rate_tiers);
  const pays = rows(a.payment_schedule);
  const deliveries = rows(a.delivery_schedule);
  const stages = rows(a.approval_stages);
  const shares = rows(a.revenue_share);
  const post = a.post_term !== null && typeof a.post_term === 'object' ? (a.post_term as Record<string, unknown>) : {};
  const showCreator = CREATOR_TYPES.includes(a.agreement_type) || a.author_grant || a.art27_28 || a.moral_rights_waiver || a.payment_due_days > 0;
  const showTalent = TALENT_TYPES.includes(a.agreement_type) || a.stage_name_clause !== '' || a.non_compete || shares.length > 0 || Object.keys(post).length > 0;
  const notes = plainText(a.notes);
  const renewal = a.auto_renew
    ? a.renewal_notice_days > 0
      ? t('Renews automatically; {n} days notice to stop', { n: a.renewal_notice_days })
      : t('Renews automatically')
    : a.renewal_notice_days > 0
      ? t('{n} days notice to renew', { n: a.renewal_notice_days })
      : '';
  return (
    <div className="flex flex-col gap-4">
      <TermSection title={t('Money|terms')} group="money" onEdit={onEdit}>
        <FactGrid cols={4}>
          <Fact label={t('Currency')} value={cur} />
          <Fact label={t('Royalty basis')} value={enumLabel('agreements.royalty_basis', a.royalty_basis)} />
          <Fact label={t('Royalty rate')} value={a.royalty_rate > 0 ? fmtPct(a.royalty_rate) : ''} />
          <Fact label={t('Deduction cap')} value={a.deduction_cap_pct > 0 ? fmtPct(a.deduction_cap_pct) : ''} />
          <Fact label={t('Flat fee')} value={a.flat_fee > 0 ? fmtMoney(a.flat_fee, cur) : ''} />
          <Fact label={t('Advance')} value={a.advance > 0 ? fmtMoney(a.advance, cur) : ''} />
          <Fact label={t('Minimum guarantee (MG)')} value={a.minimum_guarantee > 0 ? fmtMoney(a.minimum_guarantee, cur) : ''} />
          <Fact label={t('Recoupable')} value={a.minimum_guarantee > 0 || a.advance > 0 ? yesNo(a.mg_recoupable) : ''} />
          <Fact label={t('Cross-collateralized')} value={yesNo(a.cross_collateral)} />
          <Fact label={t('Reporting')} value={enumLabel('agreements.reporting_frequency', a.reporting_frequency)} />
          <Fact label={t('Report due')} value={a.report_due_days > 0 ? t('{n} days after each period', { n: a.report_due_days }) : ''} />
          <Fact label={t('Late interest')} value={a.late_interest_pct > 0 ? t('{pct} a year', { pct: fmtPct(a.late_interest_pct) }) : ''} />
          <Fact label={t('Audit threshold')} value={a.audit_threshold_pct > 0 ? fmtPct(a.audit_threshold_pct) : ''} />
        </FactGrid>
        {tiers.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[11px] text-[var(--agent-app-muted)]">{t('Rate tiers')}</div>
            <MiniTable
              head={[t('From quantity'), t('To quantity'), t('Rate %')]}
              body={tiers.map((r) => [fmtNumber(n(r['from'] ?? r['from_qty'])), r['to'] !== undefined && r['to'] !== null ? fmtNumber(n(r['to'])) : '-', fmtPct(n(r['rate']))])}
            />
          </div>
        )}
        {pays.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[11px] text-[var(--agent-app-muted)]">{t('Payment schedule')}</div>
            <MiniTable head={[t('Date'), t('Amount'), t('Label|row')]} body={pays.map((r) => [fmtDate(s(r['date'])), fmtMoney(n(r['amount']), cur), s(r['label'])])} />
          </div>
        )}
      </TermSection>

      <TermSection title={t('Licensing')} group="licensing" onEdit={onEdit}>
        <FactGrid cols={4}>
          <Fact label={t('Approval answer time')} value={a.approval_sla_days > 0 ? t('{n} business days|approval', { n: a.approval_sla_days }) : ''} />
          <Fact label={t('If nobody answers in time')} value={enumLabel('agreements.approval_timeout', a.approval_timeout)} />
          <Fact label={t('Original author side must approve')} value={yesNo(a.original_approval_required)} />
          <Fact label={t('Talent must approve')} value={yesNo(a.talent_approval_required)} />
          <Fact label={t('© notice to print')} value={a.copyright_notice} />
          <Fact label={t('Samples owed')} value={a.samples_owed > 0 ? fmtNumber(a.samples_owed) : ''} />
          <Fact label={t('Sublicensing allowed')} value={yesNo(a.sublicense_allowed)} />
          <Fact label={t('Sell-off')} value={a.sell_off_days > 0 ? (a.sell_off_on_expiry_only ? t('{n} days, on natural expiry only', { n: a.sell_off_days }) : t('{n} days after the term', { n: a.sell_off_days })) : ''} />
          <Fact label={t('Style guide version')} value={a.style_guide_version} />
        </FactGrid>
        <div className="mt-4 text-[13px]">
          <span className="text-[11px] text-[var(--agent-app-muted)]">{t('Approval stages')}: </span>
          {stages.length > 0 ? joinList(stages.map((x) => enumLabel('approvals.stage', s(x['key'])) + (n(x['sla_days']) > 0 ? ` (${t('{n} days', { n: n(x['sla_days']) })})` : ''))) : t('Organization default')}
        </div>
      </TermSection>

      <TermSection title={t('Term|agreement')} group="term" onEdit={onEdit}>
        <FactGrid cols={4}>
          <Fact label={t('Signed')} value={fmtDate(a.signed_date)} />
          <Fact label={t('Effective')} value={fmtDate(a.effective_date)} />
          <Fact label={t('Term|agreement')} value={termText(a)} />
          <Fact label={t('Renewal')} value={renewal} />
          <Fact label={t('Option period ends')} value={d10(a.option_period_end) !== '' ? `${fmtDate(a.option_period_end)}${a.option_extension_fee > 0 ? ` (${fmtMoney(a.option_extension_fee, cur)})` : ''}` : ''} />
          <Fact label={t('Rights revert on')} value={fmtDate(a.reversion_date)} />
          <Fact label={t('Completion or release deadline')} value={fmtDate(a.completion_deadline)} />
          <Fact label={t('Sequel first negotiation ends')} value={fmtDate(a.sequel_negotiation_end)} />
        </FactGrid>
        {deliveries.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[11px] text-[var(--agent-app-muted)]">{t('Delivery schedule')}</div>
            <MiniTable head={[t('Date'), t('What is delivered')]} body={deliveries.map((r) => [fmtDate(s(r['date'])), s(r['label']) || s(r['item'])])} />
          </div>
        )}
      </TermSection>

      {showCreator && (
        <TermSection title={t('Creator|terms')} group="creator" onEdit={onEdit}>
          <FactGrid cols={4}>
            <Fact label={t('Grant by an individual author')} value={yesNo(a.author_grant)} />
            <Fact label={t('Arts. 27 and 28 named')} value={yesNo(a.art27_28)} />
            <Fact label={t('Moral rights not exercised')} value={yesNo(a.moral_rights_waiver)} />
            <Fact label={t('Payment due')} value={a.payment_due_days > 0 ? t('{n} days after delivery', { n: a.payment_due_days }) : ''} />
          </FactGrid>
          {a.payment_due_days > 60 && (
            <div className="mt-3">
              <Notice tone="warn">{t('More than 60 days. The Freelance Act requires payment within 60 days of delivery for individual creators.')}</Notice>
            </div>
          )}
          {!a.art27_28 && (a.agreement_type === 'creator_commission' || a.agreement_type === 'assignment') && (
            <div className="mt-3">
              <Notice tone="warn">{t('Without Articles 27 and 28 named, adaptation rights are presumed to stay with the creator (Art. 61(2)).')}</Notice>
            </div>
          )}
        </TermSection>
      )}

      {showTalent && (
        <TermSection title={t('Talent')} group="talent" onEdit={onEdit}>
          <FactGrid cols={4}>
            <Fact label={t('Stage name')} value={enumLabel('agreements.stage_name_clause', a.stage_name_clause)} />
            <Fact label={t('Non-compete after the term')} value={yesNo(a.non_compete)} />
            <Fact label={t('Archives (streams and videos)')} value={s(post['archives'])} />
            <Fact label={t('Merchandise sell-off (days)')} value={post['merch_sell_off_days'] !== undefined ? fmtNumber(n(post['merch_sell_off_days'])) : ''} />
            <Fact label={t('Music')} value={s(post['music'])} />
            <Fact label={t('Voice|post term')} value={s(post['voice'])} />
          </FactGrid>
          {s(post['notes']) !== '' && <Prose className="mt-3 text-[var(--agent-app-text)]/85">{s(post['notes'])}</Prose>}
          {shares.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-[11px] text-[var(--agent-app-muted)]">{t('Revenue share')}</div>
              <MiniTable head={[t('Revenue type'), t('Talent share %')]} body={shares.map((r) => [s(r['category']), fmtPct(n(r['pct']))])} />
            </div>
          )}
        </TermSection>
      )}

      <TermSection title={t('Other')} group="other" onEdit={onEdit}>
        <FactGrid cols={3}>
          <Fact label={t('Governing law')} value={a.governing_law} />
          <Fact label={t('Territory in words')} value={a.territory_summary} />
          <Fact label={t('Responsible')} value={userName(a.responsible)} />
        </FactGrid>
        {a.summary !== '' && <Prose className="mt-4 text-[var(--agent-app-text)]/85">{a.summary}</Prose>}
        {notes !== '' && <Prose className="mt-3 border-t border-[var(--agent-app-border)] pt-3 text-[var(--agent-app-text)]/85">{notes}</Prose>}
      </TermSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Obligations                                                         */
/* ------------------------------------------------------------------ */

export function ObligationsTab({ agreement }: { agreement: AgreementRec }): React.JSX.Element {
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `agreement = "${agreement.id}"`, sort: 'due_date' });
  const dl = useDeadlineActions(deadlines.refresh);
  const [busy, setBusy] = useState(false);
  const open = deadlines.records.filter((d) => d.status === 'open').length;
  const rebuild = async (): Promise<void> => {
    setBusy(true);
    const r = await opToast<{ created: number; updated: number; cancelled: number }>('agreements/sync', { agreement_id: agreement.id });
    setBusy(false);
    if (r === null) return;
    toast.success(
      r.created + r.updated + r.cancelled === 0
        ? t('Obligations are already up to date.')
        : t('Obligations rebuilt: {created} added, {updated} updated, {cancelled} cancelled.', { created: r.created, updated: r.updated, cancelled: r.cancelled }),
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <Notice icon={CalendarClock}>
        {t('These dates come from the terms: notices, options, payments, reports, deliveries, sell-off and reversion. They follow the agreement when it changes; a date someone moved by hand stays locked.')}
      </Notice>
      <Section
        title={t('Obligations')}
        meta={deadlines.records.length ? t('{open} open of {total}', { open, total: deadlines.records.length }) : undefined}
        flush
        actions={
          dl.canEdit ? (
            <Button size="sm" variant="outline" onClick={() => void rebuild()} loading={busy}>
              <RefreshCw size={13} aria-hidden /> {t('Rebuild obligations')}
            </Button>
          ) : undefined
        }
      >
        {deadlines.loading ? (
          <Loading />
        ) : (
          <DeadlineList
            deadlines={deadlines.records}
            actions={dl.actions}
            canEdit={dl.canEdit}
            showSubject={false}
            empty={<EmptyHint compact icon={CalendarClock} title={t('No obligations yet')} message={t('Add dates to the terms (term end and notice, options, payments, reporting, deliveries) and the deadlines appear here.')} />}
          />
        )}
      </Section>
      {dl.dialogs}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export function ProductsTab({ agreement }: { agreement: AgreementRec }): React.JSX.Element {
  const products = useCollection<ProductRec>('products', { filter: `agreement = "${agreement.id}"`, sort: '-sales_start,name', expand: 'licensee' });
  return (
    <Section title={t('Products')} meta={products.records.length ? String(products.records.length) : undefined} flush>
      {products.loading ? (
        <Loading />
      ) : products.records.length === 0 ? (
        <EmptyHint compact icon={Package} title={t('No products under this agreement yet')} message={t('Products the licensee makes under this licence appear here with their approval stage.')} />
      ) : (
        products.records.map((p) => {
          const lic = ((p.expand ?? {}) as Record<string, unknown>)['licensee'] as PartyRec | undefined;
          return (
            <ListRow
              key={p.id}
              onClick={() => navigate('product', p.id)}
              primary={
                <span className="flex min-w-0 items-center gap-2">
                  <Ref>{p.ref}</Ref>
                  <span className="truncate">{p.name}</span>
                </span>
              }
              secondary={[lic?.name ?? '', d10(p.sales_start) !== '' ? t('On sale {date}', { date: fmtDate(p.sales_start) }) : '', p.retail_price > 0 ? fmtMoney(p.retail_price, p.currency) : ''].filter((x) => x !== '').join(' · ')}
              trailing={<EnumPill field="products.stage" value={p.stage} />}
            />
          );
        })
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Statements                                                          */
/* ------------------------------------------------------------------ */

interface MgStatus {
  minimum_guarantee: number;
  recoupable: boolean;
  earned: number;
  recouped: number;
  remaining: number;
  overage: number;
  paid: number;
  currency: string;
}

export function StatementsTab({ agreement }: { agreement: AgreementRec }): React.JSX.Element {
  const { on } = useApp();
  const reports = useCollection<RoyaltyReportRec>('royalty_reports', { filter: `agreement = "${agreement.id}"`, sort: '-period_end' });
  const mg = useLiveAsync(() => op<MgStatus>('royalties/mg-status', { agreement_id: agreement.id }), [agreement.id], ['royalty_reports', 'agreements']);
  const m = mg.data;
  const cur = m?.currency || agreement.currency;
  return (
    <div className="flex flex-col gap-4">
      {m !== null && m.minimum_guarantee > 0 && (
        <Section title={t('Minimum guarantee')} meta={m.recoupable ? t('Recoupable') : t('Not recoupable')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('MG and advance')} value={fmtMoney(m.minimum_guarantee, cur)} />
            <StatTile label={t('Royalties earned')} value={fmtMoney(m.earned, cur)} />
            <StatTile label={t('Still to recoup')} value={fmtMoney(m.remaining, cur)} tone={m.remaining > 0 ? 'warn' : 'good'} />
            <StatTile label={t('Earned above the MG')} value={fmtMoney(m.overage, cur)} tone={m.overage > 0 ? 'good' : undefined} sub={t('Paid so far: {amount}', { amount: fmtMoney(m.paid, cur) })} />
          </div>
        </Section>
      )}
      <Section
        title={t('Royalty statements')}
        meta={reports.records.length ? String(reports.records.length) : undefined}
        flush
        actions={
          on('royalties') ? (
            <a href={href('royalties')} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
              {t('Open Royalties')}
            </a>
          ) : undefined
        }
      >
        {reports.loading ? (
          <Loading />
        ) : reports.records.length === 0 ? (
          <EmptyHint compact icon={Receipt} title={t('No statements yet')} message={t('Set a reporting frequency in the terms and the expected statements appear here. Upload a licensee report under Documents and CraftBot can read it.')} />
        ) : (
          reports.records.map((r) => (
            <ListRow
              key={r.id}
              primary={t('{start} to {end}', { start: fmtDate(r.period_start), end: fmtDate(r.period_end) })}
              secondary={[d10(r.due_date) !== '' ? t('Due {date}', { date: fmtDate(r.due_date) }) : '', r.paid_amount > 0 ? t('Paid {amount}', { amount: fmtMoney(r.paid_amount, r.currency || cur) }) : ''].filter((x) => x !== '').join(' · ')}
              trailing={
                <>
                  <span className="hidden text-[13px] tabular-nums sm:inline">{r.royalty_due > 0 ? fmtMoney(r.royalty_due, r.currency || cur) : ''}</span>
                  <EnumPill field="royalty_reports.status" value={r.status} />
                </>
              }
            />
          ))
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function HistoryTab({ agreement }: { agreement: AgreementRec }): React.JSX.Element {
  const { can, userName } = useApp();
  const events = useCollection<EventRec>('events', { filter: `agreement = "${agreement.id}"`, sort: '-date,-created' });
  const eventLabel = useEventLabel();
  const [recording, setRecording] = useState(false);
  return (
    <Section
      title={t('History')}
      meta={events.records.length ? String(events.records.length) : undefined}
      flush
      actions={
        can.contribute ? (
          <Button size="sm" variant="outline" onClick={() => setRecording(true)}>
            <Plus size={13} aria-hidden /> {t('Record event')}
          </Button>
        ) : undefined
      }
    >
      {events.loading ? (
        <Loading />
      ) : events.records.length === 0 ? (
        <EmptyHint
          compact
          icon={History}
          title={t('No events yet')}
          message={t('Record what happened: signing, notices, an author grant (for US termination dates) and so on. Events can create deadlines.')}
        />
      ) : (
        events.records.map((e) => (
          <ListRow
            key={e.id}
            primary={eventLabel(e.code)}
            secondary={[tf(e, 'label'), e.created_by !== '' ? t('by {name}', { name: userName(e.created_by) }) : ''].filter((x) => x !== '').join(' · ')}
            trailing={
              <>
                {e.source !== '' && e.source !== 'manual' && <Tag>{enumLabel('events.source', e.source)}</Tag>}
                <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDate(e.date)}</span>
                <DeleteButton collection="events" id={e.id} iconOnly label={t('Delete this event')} />
              </>
            }
          />
        ))
      )}
      {recording && (
        <EventDialog subjectType="agreement" subjectId={agreement.id} initialCode="AUTHOR_GRANT_EXECUTED" jurisdiction="US" onClose={() => setRecording(false)} onDone={() => setRecording(false)} />
      )}
    </Section>
  );
}
