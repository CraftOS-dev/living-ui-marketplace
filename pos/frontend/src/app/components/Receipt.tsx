/**
 * A receipt: the business (as it was at the time of the sale), the receipt
 * and order numbers, the lines with their options, discounts and tax marks,
 * the totals with tax per rate, the payments and change, and the receipt
 * number as a barcode (scan it to start a return). Black on white paper
 * whatever the theme, sized for 58 or 80 mm receipt printers; the same
 * component is the on-screen preview.
 */
import { ORDER_TYPE_LABEL, amount, dateTime, percent } from '../lib/format.ts';
import type { Sale } from '../lib/types.ts';
import { Code128 } from './Barcode.tsx';

function Row({ left, right, strong = false, indent = false }: { left: string; right?: string | undefined; strong?: boolean; indent?: boolean }): React.JSX.Element {
  return (
    <div className={`flex items-start justify-between gap-2 ${strong ? 'font-bold' : ''} ${indent ? 'pl-3' : ''}`}>
      <span className="min-w-0 break-words">{left}</span>
      {right !== undefined && <span className="num shrink-0 whitespace-nowrap">{right}</span>}
    </div>
  );
}

export function Receipt({ sale, width = 80, barcode = true, copy = false }: { sale: Sale; width?: 58 | 80; barcode?: boolean; copy?: boolean }): React.JSX.Element {
  const h = sale.header;
  const e = sale.currency_decimals;
  const m = (n: number): string => amount(n, e);
  const orderDiscount = sale.lines.reduce((s, l) => s + l.order_discount, 0);
  const marks = sale.taxes.filter((t) => t.mark !== '');
  const small = width === 58;
  return (
    <div
      style={{ background: 'var(--ps-paper)', color: 'var(--ps-paper-ink)', fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace" }}
      className={`mx-auto flex flex-col gap-2 ${small ? 'w-[58mm] px-1 py-2 text-[12px] leading-[15px]' : 'w-[80mm] px-3 py-3 text-[12px] leading-[16px]'}`}
    >
      <div className="flex flex-col items-center gap-0.5 text-center">
        {h.logo_url !== '' && <img src={h.logo_url} alt="" className="mb-1 max-h-14 max-w-[60%] object-contain grayscale" />}
        {h.business_name !== '' && <p className="text-[14px] font-bold leading-5">{h.business_name}</p>}
        {h.address
          .split('\n')
          .filter((x) => x.trim() !== '')
          .map((x, i) => (
            <p key={i}>{x}</p>
          ))}
        {h.phone !== '' && <p>{h.phone}</p>}
        {h.company_reg_no !== '' && <p>{h.company_reg_no}</p>}
        {h.tax_reg_no !== '' && (
          <p>
            {h.tax_reg_label !== '' ? `${h.tax_reg_label} ` : ''}
            {h.tax_reg_no}
          </p>
        )}
        {h.receipt_header !== '' && <p className="mt-1 whitespace-pre-line">{h.receipt_header}</p>}
      </div>

      {sale.training && <p className="border border-current py-0.5 text-center font-bold">TRAINING: NOT A RECEIPT</p>}
      {copy && <p className="border border-current py-0.5 text-center font-bold">COPY</p>}
      <div className="text-center">
        <p className="font-bold">{sale.kind === 'refund' ? 'REFUND' : sale.kind === 'exchange' ? 'EXCHANGE' : 'RECEIPT'}</p>
        {sale.order_no > 0 && <p className="text-[26px] font-bold leading-8">Order {sale.order_no}</p>}
      </div>
      <div>
        <Row left={sale.number} right={dateTime(sale.created)} />
        <Row left={h.register} right={h.staff !== '' ? `Served by ${h.staff}` : ''} />
        {sale.order_type !== '' && <Row left={ORDER_TYPE_LABEL[sale.order_type] ?? sale.order_type} />}
        {sale.name !== '' && <Row left={`Ticket: ${sale.name}`} />}
        {h.customer !== '' && <Row left={`Customer: ${h.customer}`} />}
        {sale.returns_from.length > 0 && <Row left={`Returns from ${sale.returns_from.map((x) => x.number).join(', ')}`} />}
      </div>

      <div className="border-y border-dashed border-current py-1.5">
        {sale.lines.map((l) => (
          <div key={l.id} className="py-0.5">
            <Row left={`${l.mark !== '' ? `${l.mark} ` : ''}${l.name}${l.variant_name !== '' ? ` ${l.variant_name}` : ''}${l.qty < 0 ? ' (returned)' : ''}`} right={m(l.gross)} />
            {Math.abs(l.qty) !== 1 && <Row left={`${l.qty} x ${m(l.unit)}`} indent />}
            {l.modifiers.map((md, i) => (
              <Row key={i} left={`+ ${md.name}`} right={md.price !== 0 ? m(md.price) : undefined} indent />
            ))}
            {l.line_discount !== 0 && <Row left={`Discount${l.discount_name !== '' ? ` ${l.discount_name}` : ''}`} right={m(-l.line_discount)} indent />}
            {l.note !== '' && <Row left={l.note} indent />}
          </div>
        ))}
      </div>

      <div>
        <Row left="Subtotal" right={m(sale.subtotal)} />
        {orderDiscount !== 0 && <Row left="Order discount" right={m(-orderDiscount)} />}
        {sale.service_charge !== 0 && <Row left="Service charge" right={m(sale.service_charge)} />}
        {sale.price_mode === 'exclusive' && sale.taxes.filter((t) => t.tax !== 0).map((t) => <Row key={`${t.tax_id}${t.rate_bp}`} left={t.name} right={m(t.tax)} />)}
        {sale.rounding !== 0 && <Row left="Rounding" right={m(sale.rounding)} />}
        <div className="mt-1 border-t border-current pt-1 text-[15px] leading-5">
          <Row left={`TOTAL ${sale.currency}`} right={m(sale.total + sale.rounding)} strong />
        </div>
      </div>

      <div>
        {sale.payments.map((p) => (
          <Row key={p.id} left={`${p.name}${p.reference !== '' ? ` ${p.reference}` : ''}`} right={m(p.kind === 'cash' && p.amount > 0 ? p.tendered : p.amount)} />
        ))}
        {sale.change > 0 && <Row left="Change" right={m(sale.change)} strong />}
      </div>

      {sale.taxes.length > 0 && (
        <div className="border-t border-dashed border-current pt-1.5">
          {sale.taxes.map((t) => (
            <Row
              key={`${t.tax_id}${t.rate_bp}`}
              left={`${t.mark !== '' ? `${t.mark} ` : ''}${percent(t.rate_bp)} on ${m(sale.price_mode === 'inclusive' ? t.gross : t.base)}`}
              right={m(t.tax)}
            />
          ))}
          {sale.price_mode === 'inclusive' && <Row left="Tax included" right={m(sale.tax_total)} />}
          {marks.map((t) => (
            <p key={`mark${t.tax_id}${t.rate_bp}`}>
              {t.mark} {t.name}
            </p>
          ))}
        </div>
      )}

      {h.receipt_footer !== '' && <p className="whitespace-pre-line text-center">{h.receipt_footer}</p>}
      {barcode && !sale.training && (
        <div className="flex flex-col items-center gap-0.5 pt-1">
          <Code128 value={sale.number} height={40} barWidth={small ? 1.4 : 1.8} className={small ? 'h-9 w-[46mm]' : 'h-10 w-[60mm]'} />
          <p className="tracking-[0.2em]">{sale.number}</p>
        </div>
      )}
    </div>
  );
}
