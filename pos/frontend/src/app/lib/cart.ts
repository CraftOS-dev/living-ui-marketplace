/**
 * The cart being rung up on this register. It lives on the counter (kept in
 * this browser per register, so a reload or a locked screen never loses it)
 * and goes to the server only when it is parked as a ticket or paid.
 *
 * Each cart carries a ref made here before payment: finalize is idempotent
 * on it, so a double tap or a retry after a lost answer never records the
 * sale twice. The ref changes only when a new cart starts.
 */
import { useSyncExternalStore } from 'react';
import { compute, discountOn, rateFor, returnShare, roundDiv } from './calc.ts';
import type { CalcLine, CalcOut, FixedAmounts, TaxRef } from './calc.ts';
import type { CartLineInput, CatalogProduct, ModifierGroup, OrderType, RefundableLine, Settings, TaxClass, Ticket } from './types.ts';

export interface LineDiscount {
  kind: 'percent' | 'amount';
  value: number;
  name: string;
}

/** What a return line needs from the line it returns, to share its amounts. */
export interface ReturnOrigin {
  sale_id: string;
  sale_number: string;
  line_id: string;
  name: string;
  variant_name: string;
  qty: number;
  unit: number;
  modifiers: { name: string; price: number }[];
  gross: number;
  line_discount: number;
  order_discount: number;
  net: number;
  tax: number;
  rate_bp: number;
  tax_class: string;
  tax_name: string;
  mark: string;
  left: number;
  returned: { qty: number; gross: number; line_discount: number; order_discount: number; net: number; tax: number };
}

export interface CartLine {
  key: string;
  product: string;
  variant: string;
  qty: number;
  modifiers: string[];
  price: number | null;
  discount: LineDiscount | null;
  note: string;
  name: string;
  tax_class: string;
  origin: ReturnOrigin | null;
  restock: boolean;
  blind: boolean;
  added: number;
}

export interface Cart {
  ref: string;
  ticketRef: string;
  ticketSource: 'counter' | 'agent' | '';
  name: string;
  orderType: OrderType | '';
  customer: { id: string; name: string } | null;
  discount: LineDiscount | null;
  note: string;
  lines: CartLine[];
  approvals: string[];
}

/* ------------------------------------------------------------------ refs */

function randomPart(n: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  try {
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    for (const b of bytes) out += alphabet[b % alphabet.length];
  } catch {
    for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** A ref the operations accept (8 to 64 of A-Z a-z 0-9 - _), unique per sale or ticket. */
export function newRef(prefix: string): string {
  return `${prefix.replace(/[^A-Za-z0-9]/g, '') || 'S'}-${Date.now().toString(36)}-${randomPart(8)}`;
}

function emptyCart(orderType: OrderType | ''): Cart {
  return { ref: newRef('S'), ticketRef: '', ticketSource: '', name: '', orderType, customer: null, discount: null, note: '', lines: [], approvals: [] };
}

/* ----------------------------------------------------------------- store */

let registerId = '';
let cart: Cart = emptyCart('');
let lastAdded = '';
const listeners = new Set<() => void>();

function key(): string {
  return `pos.cart.${registerId}`;
}

function persist(): void {
  try {
    if (registerId !== '') window.localStorage.setItem(key(), JSON.stringify(cart));
  } catch {
    /* storage blocked: the cart still works for this page */
  }
}

function set(next: Cart): void {
  cart = next;
  persist();
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lineKey(): string {
  return randomPart(10);
}

function sameItem(a: CartLine, b: Omit<CartLine, 'key' | 'added'>): boolean {
  return (
    a.origin === null &&
    b.origin === null &&
    !a.blind &&
    !b.blind &&
    a.product !== '' &&
    a.product === b.product &&
    a.variant === b.variant &&
    a.price === b.price &&
    a.discount === null &&
    b.discount === null &&
    a.note === '' &&
    b.note === '' &&
    a.modifiers.length === b.modifiers.length &&
    a.modifiers.every((m, i) => m === b.modifiers[i])
  );
}

export const cartStore = {
  /** Switch to this register's cart (read from this browser). */
  useRegister(id: string, defaultOrderType: OrderType | ''): void {
    if (id === registerId) return;
    registerId = id;
    let loaded: Cart | null = null;
    try {
      const raw = window.localStorage.getItem(key());
      if (raw !== null) loaded = JSON.parse(raw) as Cart;
    } catch {
      loaded = null;
    }
    cart = loaded !== null && Array.isArray(loaded.lines) && typeof loaded.ref === 'string' ? loaded : emptyCart(defaultOrderType);
    for (const fn of listeners) fn();
  },
  get(): Cart {
    return cart;
  },
  lastAdded(): string {
    return lastAdded;
  },
  addProduct(p: { product: string; variant: string; modifiers: string[]; qty: number; price: number | null; note: string }): void {
    const base = { product: p.product, variant: p.variant, qty: p.qty, modifiers: p.modifiers, price: p.price, discount: null, note: p.note, name: '', tax_class: '', origin: null, restock: true, blind: false };
    const same = cart.lines.find((l) => sameItem(l, base));
    if (same !== undefined) {
      lastAdded = same.key;
      set({ ...cart, lines: cart.lines.map((l) => (l.key === same.key ? { ...l, qty: Math.min(9999, l.qty + p.qty), added: Date.now() } : l)) });
      return;
    }
    const line: CartLine = { ...base, key: lineKey(), added: Date.now() };
    lastAdded = line.key;
    set({ ...cart, lines: [...cart.lines, line] });
  },
  addCustom(name: string, price: number, taxClass: string): void {
    const line: CartLine = { key: lineKey(), product: '', variant: '', qty: 1, modifiers: [], price, discount: null, note: '', name, tax_class: taxClass, origin: null, restock: false, blind: false, added: Date.now() };
    lastAdded = line.key;
    set({ ...cart, lines: [...cart.lines, line] });
  },
  addReturn(origin: ReturnOrigin, qty: number, restock: boolean): void {
    const existing = cart.lines.find((l) => l.origin?.line_id === origin.line_id);
    if (existing !== undefined) {
      set({ ...cart, lines: cart.lines.map((l) => (l.key === existing.key ? { ...l, qty: Math.min(origin.left, qty), restock } : l)) });
      return;
    }
    const line: CartLine = { key: lineKey(), product: '', variant: '', qty: Math.min(origin.left, qty), modifiers: [], price: null, discount: null, note: '', name: '', tax_class: '', origin, restock, blind: false, added: Date.now() };
    lastAdded = line.key;
    set({ ...cart, lines: [...cart.lines, line] });
  },
  addBlindReturn(product: string, variant: string, qty: number, restock: boolean): void {
    const line: CartLine = { key: lineKey(), product, variant, qty, modifiers: [], price: null, discount: null, note: '', name: '', tax_class: '', origin: null, restock, blind: true, added: Date.now() };
    lastAdded = line.key;
    set({ ...cart, lines: [...cart.lines, line] });
  },
  setQty(lineKeyValue: string, qty: number): void {
    if (qty <= 0) {
      cartStore.remove(lineKeyValue);
      return;
    }
    set({
      ...cart,
      lines: cart.lines.map((l) => {
        if (l.key !== lineKeyValue) return l;
        const max = l.origin !== null ? l.origin.left : 9999;
        return { ...l, qty: Math.min(max, qty) };
      }),
    });
  },
  /** Remove a line; returns what is needed to put it back (Undo). */
  remove(lineKeyValue: string): { line: CartLine; index: number } | null {
    const index = cart.lines.findIndex((l) => l.key === lineKeyValue);
    const line = cart.lines[index];
    if (line === undefined) return null;
    set({ ...cart, lines: cart.lines.filter((l) => l.key !== lineKeyValue) });
    return { line, index };
  },
  restore(line: CartLine, index: number): void {
    const lines = cart.lines.slice();
    lines.splice(Math.min(index, lines.length), 0, line);
    set({ ...cart, lines });
  },
  update(lineKeyValue: string, patch: Partial<Pick<CartLine, 'discount' | 'price' | 'note' | 'restock' | 'modifiers' | 'variant'>>): void {
    set({ ...cart, lines: cart.lines.map((l) => (l.key === lineKeyValue ? { ...l, ...patch } : l)) });
  },
  setOrderType(t: OrderType | ''): void {
    set({ ...cart, orderType: t });
  },
  setCustomer(c: { id: string; name: string } | null): void {
    set({ ...cart, customer: c });
  },
  setName(name: string): void {
    set({ ...cart, name });
  },
  setNote(note: string): void {
    set({ ...cart, note });
  },
  setDiscount(d: LineDiscount | null): void {
    set({ ...cart, discount: d });
  },
  addApprovals(tokens: string[]): void {
    set({ ...cart, approvals: [...cart.approvals, ...tokens] });
  },
  setTicketRef(ref: string, source: 'counter' | 'agent' | ''): void {
    set({ ...cart, ticketRef: ref, ticketSource: source });
  },
  /** Start a new, empty cart (after a sale, a park or a clear). */
  clear(defaultOrderType: OrderType | ''): void {
    lastAdded = '';
    set(emptyCart(defaultOrderType));
  },
  /** Open a saved ticket as the cart. */
  loadTicket(t: Ticket, defaultOrderType: OrderType | ''): void {
    const lines: CartLine[] = t.lines
      .filter((l) => l.return_of === '')
      .map((l) => ({
        key: lineKey(),
        product: l.product,
        variant: l.variant,
        qty: l.qty,
        modifiers: l.modifiers,
        price: l.price,
        discount: l.discount,
        note: l.note,
        name: l.name,
        tax_class: l.tax_class,
        origin: null,
        restock: l.restock,
        blind: l.blind,
        added: 0,
      }));
    lastAdded = '';
    set({
      ref: newRef('S'),
      ticketRef: t.ref,
      ticketSource: t.source,
      name: t.name,
      orderType: t.order_type !== '' ? t.order_type : defaultOrderType,
      customer: t.customer !== '' ? { id: t.customer, name: t.customer_name } : null,
      discount: t.discount,
      note: t.note,
      lines,
      approvals: [],
    });
  },
};

export function useCart(): Cart {
  return useSyncExternalStore(subscribe, cartStore.get, cartStore.get);
}

/* ----------------------------------------------------------------- input */

/** The cart lines as the operations take them. */
export function toInput(c: Cart): CartLineInput[] {
  return c.lines.map((l) => ({
    product: l.origin !== null ? '' : l.product,
    variant: l.origin !== null ? '' : l.variant,
    qty: l.qty,
    modifiers: l.modifiers,
    price: l.price,
    discount: l.discount,
    note: l.note,
    name: l.name,
    tax_class: l.tax_class,
    return_of: l.origin !== null ? l.origin.line_id : '',
    restock: l.restock,
    blind: l.blind,
  }));
}

/** A refundable line (from the operation) as a return origin. */
export function originOf(saleId: string, saleNumber: string, l: RefundableLine): ReturnOrigin {
  return {
    sale_id: saleId,
    sale_number: saleNumber,
    line_id: l.id,
    name: l.name,
    variant_name: l.variant_name,
    qty: l.qty,
    unit: l.unit,
    modifiers: l.modifiers,
    gross: l.gross,
    line_discount: l.line_discount,
    order_discount: l.order_discount,
    net: l.net,
    tax: l.tax,
    rate_bp: l.rate_bp,
    tax_class: l.tax_class,
    tax_name: l.tax_name,
    mark: l.mark,
    left: l.left,
    returned: {
      qty: l.returned_amounts.qty,
      gross: l.returned_amounts.gross,
      line_discount: l.returned_amounts.line_discount,
      order_discount: l.returned_amounts.order_discount,
      net: l.returned_amounts.net,
      tax: l.returned_amounts.tax,
    },
  };
}

/* ---------------------------------------------------------------- totals */

export interface PricedLine {
  line: CartLine;
  label: string;
  variantName: string;
  modifiers: { id: string; name: string; price: number }[];
  unit: number;
  base: number;
  gross: number;
  /** This line's own discount. */
  lineDiscount: number;
  /** Line and order discounts together. */
  discount: number;
  net: number;
  tax: number;
  mark: string;
  kind: 'item' | 'custom' | 'return' | 'blind';
  /** Why this line cannot be paid as it is, or ''. */
  problem: string;
  color: number;
  icon: string;
}

export interface CartTotals {
  calc: CalcOut;
  lines: PricedLine[];
  items: number;
  hasReturns: boolean;
  hasSales: boolean;
  problems: string[];
}

function taxRef(t: TaxClass | undefined): TaxRef | null {
  if (t === undefined) return null;
  return { id: t.id, name: t.name, rate_bp: t.rate_bp, dine_in_rate_bp: t.dine_in_rate_bp, mark: t.mark };
}

export interface PricingContext {
  settings: Settings;
  productById: Map<string, CatalogProduct>;
  groupById: Map<string, ModifierGroup>;
  taxById: Map<string, TaxClass>;
  taxes: TaxClass[];
}

/** Price the cart exactly as finalize will (same rules as the server). */
export function priceCart(c: Cart, ctx: PricingContext): CartTotals {
  const s = ctx.settings;
  const calcLines: CalcLine[] = [];
  const priced: PricedLine[] = [];
  const problems: string[] = [];
  const defaultTax = ctx.taxes.find((t) => t.is_default && !t.archived);
  for (const l of c.lines) {
    if (l.origin !== null) {
      const o = l.origin;
      const share = (total: number, prev: number): number => -returnShare(total, o.qty, l.qty, o.returned.qty, prev);
      const fixed: FixedAmounts = {
        gross: share(o.gross, o.returned.gross),
        line_discount: share(o.line_discount, o.returned.line_discount),
        order_discount: share(o.order_discount, o.returned.order_discount),
        net: share(o.net, o.returned.net),
        tax: share(o.tax, o.returned.tax),
        rate_bp: o.rate_bp,
        tax_id: o.tax_class,
        tax_name: o.tax_name,
        mark: o.mark,
      };
      calcLines.push({ qty: -l.qty, fixed });
      priced.push({ line: l, label: o.name, variantName: o.variant_name, modifiers: o.modifiers.map((m) => ({ id: '', name: m.name, price: m.price })), unit: o.unit, base: o.unit, gross: 0, lineDiscount: 0, discount: 0, net: 0, tax: 0, mark: o.mark, kind: 'return', problem: '', color: 0, icon: 'tag' });
      continue;
    }
    if (l.product === '') {
      const t = l.tax_class !== '' ? ctx.taxById.get(l.tax_class) : defaultTax;
      calcLines.push({ qty: l.qty, unit: l.price ?? 0, tax: taxRef(t), discount: l.discount });
      priced.push({ line: l, label: l.name || 'Custom amount', variantName: '', modifiers: [], unit: l.price ?? 0, base: l.price ?? 0, gross: 0, lineDiscount: 0, discount: 0, net: 0, tax: 0, mark: t?.mark ?? '', kind: 'custom', problem: '', color: 0, icon: 'tag' });
      continue;
    }
    const p = ctx.productById.get(l.product);
    if (p === undefined) {
      const problem = 'This product is no longer for sale';
      problems.push(problem);
      calcLines.push({ qty: l.qty, unit: 0, tax: null, discount: null });
      priced.push({ line: l, label: 'Removed product', variantName: '', modifiers: [], unit: 0, base: 0, gross: 0, lineDiscount: 0, discount: 0, net: 0, tax: 0, mark: '', kind: 'item', problem, color: 0, icon: 'tag' });
      continue;
    }
    const v = p.variants.find((x) => x.id === l.variant);
    let problem = '';
    if (p.variants.length > 0 && v === undefined) problem = 'Pick a size or variant';
    if (!l.blind && !p.available) problem = `${p.name} is sold out`;
    const base = v !== undefined ? v.price : p.price;
    const unitBase = p.open_price ? (l.price ?? 0) : (l.price ?? base);
    const mods: { id: string; name: string; price: number }[] = [];
    if (!l.blind) {
      for (const gid of p.modifier_groups) {
        const g = ctx.groupById.get(gid);
        if (g === undefined) continue;
        const picked = g.options.filter((o) => l.modifiers.includes(o.id));
        for (const o of picked) {
          mods.push({ id: o.id, name: o.name, price: o.price });
          if (!o.available && problem === '') problem = `${o.name} is sold out`;
        }
        if (picked.length < g.min && problem === '') problem = `Pick ${g.name}`;
        if (g.max > 0 && picked.length > g.max && problem === '') problem = `Too many ${g.name} choices`;
      }
    }
    const tax = ctx.taxById.get(p.tax_class);
    if (l.blind) {
      const gross = -(unitBase * l.qty);
      const rate = rateFor(taxRef(tax), c.orderType);
      const t = rate === 0 ? 0 : -(s.price_mode === 'inclusive' ? roundDiv(-gross * rate, 10000 + rate, s.tax_rounding) : roundDiv(-gross * rate, 10000, s.tax_rounding));
      calcLines.push({ qty: -l.qty, fixed: { gross, line_discount: 0, order_discount: 0, net: gross, tax: t, rate_bp: rate, tax_id: tax?.id ?? '', tax_name: tax?.name ?? '', mark: tax?.mark ?? '' } });
      priced.push({ line: l, label: p.name, variantName: v?.name ?? '', modifiers: [], unit: unitBase, base, gross: 0, lineDiscount: 0, discount: 0, net: 0, tax: 0, mark: tax?.mark ?? '', kind: 'blind', problem, color: p.color, icon: p.icon });
      if (problem !== '') problems.push(problem);
      continue;
    }
    const unit = unitBase + mods.reduce((sum, m) => sum + m.price, 0);
    if (p.open_price && l.price === null && problem === '') problem = `Enter the price of ${p.name}`;
    calcLines.push({ qty: l.qty, unit, tax: taxRef(tax), discount: l.discount });
    priced.push({ line: l, label: p.name, variantName: v?.name ?? '', modifiers: mods, unit, base, gross: 0, lineDiscount: 0, discount: 0, net: 0, tax: 0, mark: tax?.mark ?? '', kind: 'item', problem, color: p.color, icon: p.icon });
    if (problem !== '') problems.push(problem);
  }
  const serviceTax = s.service_charge_tax !== '' ? taxRef(ctx.taxById.get(s.service_charge_tax)) : null;
  const out = compute({
    price_mode: s.price_mode,
    tax_rounding: s.tax_rounding,
    order_type: c.orderType,
    service: s.service_charge_bp > 0 ? { bp: s.service_charge_bp, scope: s.service_charge_scope, tax: serviceTax } : null,
    discount: c.discount,
    lines: calcLines,
  });
  out.lines.forEach((r, i) => {
    const pl = priced[i];
    if (pl === undefined) return;
    pl.gross = r.gross;
    pl.lineDiscount = r.line_discount;
    pl.discount = r.line_discount + r.order_discount;
    pl.net = r.net;
    pl.tax = r.tax;
  });
  return {
    calc: out,
    lines: priced,
    items: c.lines.reduce((sum, l) => sum + l.qty, 0),
    hasReturns: c.lines.some((l) => l.origin !== null || l.blind),
    hasSales: c.lines.some((l) => l.origin === null && !l.blind),
    problems,
  };
}

/** Does a discount go over the cashier limit (so it needs a manager)? */
export function overLimit(base: number, d: LineDiscount, limitBp: number): boolean {
  if (d.kind === 'percent') return d.value > limitBp;
  return base > 0 && d.value * 10000 > limitBp * base;
}

export { discountOn };
