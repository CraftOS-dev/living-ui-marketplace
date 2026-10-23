/**
 * A document as the party receives it: black on white paper, the same on
 * screen and on the printer (the card carries `erp-print`). Lines become a
 * stacked list on phones so nothing scrolls sideways.
 */
import { cn } from '../../../kit/index.ts';
import { dayLabel } from '../../lib/dates.ts';
import { amount, money, qty } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { DocDetail } from '../../lib/types/sales.ts';
import { pricedOf, taxedOf } from './parts.tsx';

export interface Company {
  company_name: string;
  legal_name: string;
  address: string;
  email: string;
  phone: string;
  tax_id: string;
  invoice_footer: string;
  quote_terms: string;
}

const TITLE: Record<string, string> = {
  quote: 'Quote',
  sales_order: 'Sales order',
  delivery: 'Delivery note',
  invoice: 'Tax invoice',
  credit_note: 'Credit note',
  purchase_order: 'Purchase order',
  goods_receipt: 'Goods received',
  bill: 'Bill',
  supplier_credit: 'Supplier credit',
};

function Block({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--erp-paper-muted)]">{label}</p>
      <div className="text-[13px] leading-5">{children}</div>
    </div>
  );
}

function Lines({ text }: { text: string }): React.JSX.Element | null {
  if (text.trim() === '') return null;
  return (
    <>
      {text.split('\n').map((l, i) => (
        <span key={i} className="block">
          {l}
        </span>
      ))}
    </>
  );
}

export function Paper({ doc, company, className }: { doc: DocDetail; company: Company | null; className?: string | undefined }): React.JSX.Element {
  const priced = pricedOf(doc.type);
  const taxed = taxedOf(doc.type);
  const cur = doc.currency;
  const sales = doc.side === 'sales';
  const money2 = (n: number): string => money(n, cur);
  const anyDiscount = doc.lines.some((l) => l.discount_bp > 0);
  const lineAmount = (net: number, tax: number): number => (doc.prices_include_tax ? net + tax : net);
  const dates: [string, string][] = [[doc.type === 'invoice' || doc.type === 'bill' ? 'Date' : 'Date', doc.date !== '' ? dayLabel(doc.date) : '']];
  if (doc.due_date !== '' && (doc.type === 'invoice' || doc.type === 'bill' || doc.type === 'credit_note' || doc.type === 'supplier_credit')) dates.push(['Due', dayLabel(doc.due_date)]);
  if (doc.valid_until !== '') dates.push(['Valid until', dayLabel(doc.valid_until)]);
  if (doc.expected_date !== '') dates.push([doc.type === 'sales_order' ? 'Delivery' : 'Expected', dayLabel(doc.expected_date)]);
  if (doc.terms !== null && (doc.type === 'invoice' || doc.type === 'bill' || doc.type === 'sales_order' || doc.type === 'purchase_order')) dates.push(['Terms', doc.terms.name]);
  if (doc.reference !== '') dates.push(['Reference', doc.reference]);
  if (doc.currency !== doc.base_currency) dates.push(['Currency', doc.currency]);

  return (
    <article
      className={cn('erp-print erp-rise overflow-hidden rounded-[24px] bg-[var(--erp-paper)] p-5 text-[var(--erp-paper-ink)] shadow-[var(--erp-shadow)] @min-[480px]:p-8', className)}
      aria-label={`${doc.type_label} ${doc.number}`}
    >
      {doc.state === 'void' && (
        <p className="mb-5 rounded-[14px] border border-[var(--erp-red)] px-4 py-2 text-[13px] font-bold text-[var(--erp-red)]">
          Void{doc.void_reason !== '' ? `: ${doc.void_reason}` : ''}
        </p>
      )}
      <header className="flex flex-col gap-5 @min-[480px]:flex-row @min-[480px]:items-start @min-[480px]:justify-between @min-[480px]:gap-6">
        <div className="min-w-0 @min-[480px]:max-w-[60%]">
          <p className="text-[15px] font-bold">{company?.legal_name !== undefined && company.legal_name !== '' ? company.legal_name : (company?.company_name ?? '')}</p>
          {company !== null && (
            <div className="mt-1 text-[12px] leading-5 text-[var(--erp-paper-muted)]">
              <Lines text={company.address} />
              {[company.email, company.phone].filter((x) => x !== '').join(' · ')}
              {company.tax_id !== '' && <span className="block">Tax number {company.tax_id}</span>}
            </div>
          )}
        </div>
        <div className="order-first @min-[480px]:order-none @min-[480px]:text-right">
          <p className="text-[26px] font-bold leading-8 tracking-[-0.01em]">{TITLE[doc.type] ?? doc.type_label}</p>
          <p className="num mt-1 text-[14px] font-semibold">{doc.number !== '' ? doc.number : 'Draft'}</p>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-6 @min-[480px]:grid-cols-3">
        <Block label={doc.type === 'delivery' ? 'Deliver to' : sales ? 'Bill to' : 'From'}>
          {doc.party !== null && (
            <button type="button" onClick={() => navigate('party', { id: doc.party?.id ?? '', role: sales ? 'customer' : 'supplier' })} className="text-left font-bold underline-offset-4 hover:underline">
              {doc.party.name}
            </button>
          )}
          {doc.attention !== '' && <span className="block">Attn: {doc.attention}</span>}
          <span className="block text-[var(--erp-paper-muted)]">
            <Lines text={doc.type === 'delivery' && doc.shipping_address !== '' ? doc.shipping_address : doc.billing_address} />
          </span>
        </Block>
        {doc.shipping_address !== '' && doc.shipping_address !== doc.billing_address && doc.type !== 'delivery' && (sales || doc.type === 'purchase_order') ? (
          <Block label={sales ? 'Ship to' : 'Deliver to'}>
            <span className="block text-[var(--erp-paper-muted)]">
              <Lines text={doc.shipping_address} />
            </span>
          </Block>
        ) : (
          <span className="hidden @min-[480px]:block" />
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px] @min-[480px]:justify-self-end">
          {dates.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--erp-paper-muted)]">{k}</dt>
              <dd className="num text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Lines: a table on wider screens and on paper, a list on phones. */}
      <table className="mt-8 hidden w-full text-[13px] @min-[480px]:table">
        <thead>
          <tr className="border-b border-[var(--erp-paper-ink)] text-left text-[12px] font-semibold text-[var(--erp-paper-muted)]">
            <th className="pb-2 pr-3 font-semibold">Description</th>
            <th className="pb-2 pr-3 text-right font-semibold">Qty</th>
            {priced && <th className="pb-2 pr-3 text-right font-semibold">Unit price</th>}
            {priced && anyDiscount && <th className="pb-2 pr-3 text-right font-semibold">Disc</th>}
            {taxed && <th className="pb-2 pr-3 text-right font-semibold">Tax</th>}
            {priced && <th className="pb-2 text-right font-semibold">Amount</th>}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id} className="border-b border-[var(--erp-paper-line)] align-top">
              <td className="py-2.5 pr-3">
                <span className="block font-semibold">{l.description}</span>
                {l.item !== null && l.item.name !== l.description && <span className="block text-[12px] text-[var(--erp-paper-muted)]">{l.item.name}</span>}
                {l.item !== null && <span className="block text-[12px] text-[var(--erp-paper-muted)]">{l.item.sku}</span>}
              </td>
              <td className="num py-2.5 pr-3 text-right">
                {qty(l.qty)}
                {l.unit !== '' && <span className="text-[var(--erp-paper-muted)]"> {l.unit}</span>}
              </td>
              {priced && <td className="num py-2.5 pr-3 text-right">{l.unit_price}</td>}
              {priced && anyDiscount && <td className="num py-2.5 pr-3 text-right">{l.discount_bp > 0 ? `${l.discount}%` : ''}</td>}
              {taxed && <td className="py-2.5 pr-3 text-right text-[12px]">{l.tax !== null ? l.tax.code : ''}</td>}
              {priced && <td className="num py-2.5 text-right font-semibold">{amount(lineAmount(l.net, l.tax_amount), cur)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-6 flex flex-col @min-[480px]:hidden">
        {doc.lines.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-3 border-b border-[var(--erp-paper-line)] py-3">
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold">{l.description}</span>
              <span className="num block text-[12px] text-[var(--erp-paper-muted)]">
                {qty(l.qty)}
                {l.unit !== '' ? ` ${l.unit}` : ''}
                {priced ? ` x ${l.unit_price}` : ''}
                {l.discount_bp > 0 ? ` less ${l.discount}%` : ''}
                {taxed && l.tax !== null ? ` · ${l.tax.code}` : ''}
              </span>
            </span>
            {priced && <span className="num shrink-0 text-[14px] font-semibold">{amount(lineAmount(l.net, l.tax_amount), cur)}</span>}
          </li>
        ))}
      </ul>

      {priced && (
        <div className="mt-5 flex justify-end">
          <dl className="grid w-full max-w-[320px] grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[13px]">
            <dt className="text-[var(--erp-paper-muted)]">{doc.prices_include_tax ? 'Subtotal before tax' : 'Subtotal'}</dt>
            <dd className="num text-right">{money2(doc.subtotal)}</dd>
            {doc.discount > 0 && (
              <>
                <dt className="text-[var(--erp-paper-muted)]">Discounts given</dt>
                <dd className="num text-right">{money2(-doc.discount)}</dd>
              </>
            )}
            {doc.taxes.map((t) => (
              <div key={t.id} className="contents">
                <dt className="text-[var(--erp-paper-muted)]">
                  {t.name} on {money2(t.net)}
                </dt>
                <dd className="num text-right">{money2(t.amount)}</dd>
              </div>
            ))}
            <div className="col-span-2 mt-2 flex items-baseline justify-between gap-6 border-t border-[var(--erp-paper-ink)] pt-2">
              <dt className="text-[14px] font-bold">Total</dt>
              <dd className="num text-right text-[15px] font-bold">{money2(doc.total)}</dd>
            </div>
            {(doc.type === 'invoice' || doc.type === 'bill') && doc.state === 'posted' && doc.paid !== 0 && (
              <>
                <dt className="text-[var(--erp-paper-muted)]">Paid</dt>
                <dd className="num text-right">{money2(-doc.paid)}</dd>
                <dt className="font-bold">Balance due</dt>
                <dd className="num text-right font-bold">{money2(doc.balance)}</dd>
              </>
            )}
            {doc.currency !== doc.base_currency && (
              <>
                <dt className="text-[12px] text-[var(--erp-paper-muted)]">In {doc.base_currency} at {doc.fx_rate}</dt>
                <dd className="num text-right text-[12px] text-[var(--erp-paper-muted)]">{money(doc.total_base, doc.base_currency)}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {(doc.notes !== '' || (company !== null && sales && (doc.type === 'invoice' ? company.invoice_footer !== '' : doc.type === 'quote' ? company.quote_terms !== '' : false))) && (
        <div className="mt-8 flex flex-col gap-4 border-t border-[var(--erp-paper-line)] pt-5 text-[13px] leading-5">
          {doc.notes !== '' && (
            <Block label="Notes">
              <Lines text={doc.notes} />
            </Block>
          )}
          {company !== null && sales && doc.type === 'invoice' && company.invoice_footer !== '' && (
            <p className="text-[12px] text-[var(--erp-paper-muted)]">
              <Lines text={company.invoice_footer} />
            </p>
          )}
          {company !== null && sales && doc.type === 'quote' && company.quote_terms !== '' && (
            <Block label="Terms">
              <span className="text-[var(--erp-paper-muted)]">
                <Lines text={company.quote_terms} />
              </span>
            </Block>
          )}
        </div>
      )}
    </article>
  );
}
