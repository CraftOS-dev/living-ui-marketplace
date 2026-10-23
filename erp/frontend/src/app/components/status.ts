/**
 * Words and tones for states, shared by every screen so a status reads the
 * same everywhere ("Overdue" is always red, "Paid" always green).
 */
import type { Tone } from './ui.tsx';

export const DOC_TYPE_LABEL: Record<string, string> = {
  quote: 'Quote',
  sales_order: 'Sales order',
  delivery: 'Delivery',
  invoice: 'Invoice',
  credit_note: 'Credit note',
  purchase_order: 'Purchase order',
  goods_receipt: 'Goods receipt',
  bill: 'Bill',
  supplier_credit: 'Supplier credit',
};

export const DOC_TYPE_PLURAL: Record<string, string> = {
  quote: 'Quotes',
  sales_order: 'Sales orders',
  delivery: 'Deliveries',
  invoice: 'Invoices',
  credit_note: 'Credit notes',
  purchase_order: 'Purchase orders',
  goods_receipt: 'Goods receipts',
  bill: 'Bills',
  supplier_credit: 'Supplier credits',
};

export function docTypeLabel(type: string): string {
  return DOC_TYPE_LABEL[type] ?? type;
}

/** Which side a document type is on. */
export function docSide(type: string): 'sales' | 'purchase' {
  return ['quote', 'sales_order', 'delivery', 'invoice', 'credit_note'].includes(type) ? 'sales' : 'purchase';
}

/** Documents that carry money owed (they have a balance and get paid). */
export function isMoneyDoc(type: string): boolean {
  return ['invoice', 'credit_note', 'bill', 'supplier_credit'].includes(type);
}

export const DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  void: { label: 'Void', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'good' },
  declined: { label: 'Declined', tone: 'bad' },
  expired: { label: 'Expired', tone: 'warn' },
  to_deliver: { label: 'To deliver', tone: 'info' },
  partly_delivered: { label: 'Partly delivered', tone: 'warn' },
  to_invoice: { label: 'To invoice', tone: 'warn' },
  to_receive: { label: 'To receive', tone: 'info' },
  partly_received: { label: 'Partly received', tone: 'warn' },
  to_bill: { label: 'To bill', tone: 'warn' },
  done: { label: 'Done', tone: 'good' },
  posted: { label: 'Posted', tone: 'good' },
  open: { label: 'Open', tone: 'info' },
  partly_used: { label: 'Partly used', tone: 'warn' },
  used: { label: 'Used', tone: 'good' },
  paid: { label: 'Paid', tone: 'good' },
  overdue: { label: 'Overdue', tone: 'bad' },
  partly_paid: { label: 'Partly paid', tone: 'warn' },
  unpaid: { label: 'Unpaid', tone: 'info' },
};

export function docStatus(status: string): { label: string; tone: Tone } {
  return DOC_STATUS[status] ?? { label: status.replace(/_/g, ' '), tone: 'neutral' };
}

/** The filter chips a list of each type offers (values the server's docs.list accepts). */
export const DOC_FILTERS: Record<string, { value: string; label: string; alert?: boolean | undefined }[]> = {
  quote: [
    { value: 'draft', label: 'Drafts' },
    { value: 'sent', label: 'Sent' },
    { value: 'expired', label: 'Expired', alert: true },
    { value: 'accepted', label: 'Accepted' },
    { value: 'declined', label: 'Declined' },
  ],
  sales_order: [
    { value: 'draft', label: 'Drafts' },
    { value: 'to_fulfil', label: 'To deliver' },
    { value: 'to_bill', label: 'To invoice' },
    { value: 'done', label: 'Done' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  delivery: [
    { value: 'draft', label: 'Drafts' },
    { value: 'posted', label: 'Delivered' },
    { value: 'void', label: 'Void' },
  ],
  invoice: [
    { value: 'draft', label: 'Drafts' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'overdue', label: 'Overdue', alert: true },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' },
  ],
  credit_note: [
    { value: 'draft', label: 'Drafts' },
    { value: 'credit_open', label: 'Open' },
    { value: 'posted', label: 'Posted' },
    { value: 'void', label: 'Void' },
  ],
  purchase_order: [
    { value: 'draft', label: 'Drafts' },
    { value: 'to_fulfil', label: 'To receive' },
    { value: 'to_bill', label: 'To bill' },
    { value: 'done', label: 'Done' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  goods_receipt: [
    { value: 'draft', label: 'Drafts' },
    { value: 'posted', label: 'Received' },
    { value: 'void', label: 'Void' },
  ],
  bill: [
    { value: 'draft', label: 'Drafts' },
    { value: 'unpaid', label: 'To pay' },
    { value: 'overdue', label: 'Overdue', alert: true },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' },
  ],
  supplier_credit: [
    { value: 'draft', label: 'Drafts' },
    { value: 'credit_open', label: 'Open' },
    { value: 'posted', label: 'Posted' },
    { value: 'void', label: 'Void' },
  ],
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  posted: { label: 'Posted', tone: 'good' },
  void: { label: 'Void', tone: 'neutral' },
  unallocated: { label: 'Not applied', tone: 'warn' },
};

export const PROPOSAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting for you', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  failed: { label: 'Could not run', tone: 'bad' },
};

export const LEAVE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const CLAIM_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Waiting', tone: 'warn' },
  approved: { label: 'Approved', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'bad' },
  posted: { label: 'To pay', tone: 'warn' },
  paid: { label: 'Paid', tone: 'good' },
};

/** Generic lookup with a readable fallback. */
export function statusOf(map: Record<string, { label: string; tone: Tone }>, key: string): { label: string; tone: Tone } {
  return map[key] ?? { label: key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), tone: 'neutral' };
}
