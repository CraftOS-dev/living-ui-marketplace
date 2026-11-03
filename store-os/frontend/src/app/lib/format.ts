/** Money, numbers, dates and clocks, in the seller's own locale. */

const DOLLARS: Record<string, string> = { SGD: 'S$', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', HKD: 'HK$', TWD: 'NT$', MXN: 'MX$', BRL: 'R$' };
const cache = new Map<string, Intl.NumberFormat>();

function nf(cur: string, digits: number | undefined): Intl.NumberFormat {
  const key = cur + ':' + String(digits);
  let f = cache.get(key);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat('en', { style: 'currency', currency: cur || 'USD', currencyDisplay: 'narrowSymbol', ...(digits !== undefined ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : {}) });
    } catch {
      f = new Intl.NumberFormat('en', { minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 });
    }
    cache.set(key, f);
  }
  return f;
}

/** "RM1,299.00", "S$39.00", "¥5,000". */
export function money(v: number | null | undefined, cur: string, opts: { whole?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  const f = nf(cur, opts.whole ? 0 : undefined);
  const parts = f.formatToParts(v);
  const sym = DOLLARS[cur];
  return parts.map((p) => (p.type === 'currency' && sym !== undefined ? sym : p.value)).join('');
}

/** Just the currency sign, for input prefixes. */
export function currencySign(cur: string): string {
  if (DOLLARS[cur]) return DOLLARS[cur] ?? cur;
  const parts = nf(cur, 0).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value ?? cur;
}

/** "12.4k", "1.2M" for chart axes and tight spots. */
export function compact(v: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export function moneyCompact(v: number, cur: string): string {
  if (Math.abs(v) < 10000) return money(v, cur, { whole: true });
  return currencySign(cur) + compact(v);
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return new Intl.NumberFormat('en').format(v);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '';
  return (Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits)).toFixed(digits).replace(/\.0$/, '') + '%';
}

/** PocketBase datetimes come as "2026-10-30 13:25:07.525Z"; ISO elsewhere. */
export function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "30 Oct 2026" */
export function day(s: string): string {
  const d = toDate(s);
  return d === null ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "30 Oct" */
export function dayShort(s: string): string {
  const d = toDate(s);
  return d === null ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "30 Oct, 14:05" */
export function dayTime(s: string): string {
  const d = toDate(s);
  if (d === null) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** "14:05" */
export function time(s: string): string {
  const d = toDate(s);
  return d === null ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" */
export function ago(s: string): string {
  const d = toDate(s);
  if (d === null) return '';
  const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return min + ' min ago';
  const h = Math.round(min / 60);
  if (h < 24) return h + ' h ago';
  const days = Math.round(h / 24);
  if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
  return day(s);
}

/** A deadline as words: "3h 20m left", "2 days left", "5h late". */
export function clock(hours: number | null | undefined): { text: string; tone: 'bad' | 'warn' | 'neutral' } {
  if (hours === null || hours === undefined) return { text: '', tone: 'neutral' };
  const late = hours < 0;
  const h = Math.abs(hours);
  let text: string;
  if (h < 1) text = Math.max(1, Math.round(h * 60)) + 'm';
  else if (h < 48) text = Math.floor(h) + 'h' + (h < 10 ? ' ' + Math.round((h % 1) * 60) + 'm' : '');
  else text = Math.round(h / 24) + ' days';
  return { text: late ? text + ' late' : text + ' left', tone: late ? 'bad' : h < 24 ? 'warn' : 'neutral' };
}

export function plural(n: number, one: string, many?: string): string {
  return num(n) + ' ' + (n === 1 ? one : (many ?? one + 's'));
}

/** Morning, afternoon or evening, by the seller's clock. */
export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A chart bucket key ("2026-10-30" or "2026-10") as a label. */
export function bucketLabel(key: string, monthly: boolean): string {
  if (monthly) {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' });
  }
  const d = new Date(key + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function bucketLong(key: string, monthly: boolean): string {
  if (monthly) {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return new Date(key + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const STATUS_LABEL: Record<string, string> = {
  unpaid: 'Unpaid',
  to_ship: 'To ship',
  shipped: 'Shipped',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export const TRACK_LABEL: Record<string, string> = {
  pending: 'Waiting for pickup',
  info_received: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  available_for_pickup: 'Ready for pickup',
  delivered: 'Delivered',
  failed_attempt: 'Delivery attempt failed',
  exception: 'Problem',
  returned: 'Returned to you',
};

export const INTENT_LABEL: Record<string, string> = {
  where_is_order: 'Where is my order',
  return: 'Return',
  refund: 'Refund',
  cancel: 'Cancel',
  change_address: 'Change address',
  product_question: 'Product question',
  complaint: 'Complaint',
  other: 'Other',
};

export const TASK_LABEL: Record<string, string> = {
  sync: 'Sync',
  publish: 'Publish listings',
  push_stock: 'Set stock',
  setup_help: 'Setup help',
  prepare_listing: 'Write listings',
  draft_reply: 'Draft a reply',
  send_reply: 'Send a reply',
  tracking: 'Check tracking',
  exception: 'Delivery problem',
  chat: 'Your message',
};

export const TASK_STATE_LABEL: Record<string, string> = {
  queued: 'Waiting',
  asked: 'Asked',
  working: 'Working',
  done: 'Done',
  failed: 'Could not finish',
  cancelled: 'Cancelled',
};
