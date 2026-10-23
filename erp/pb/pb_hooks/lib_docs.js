/// <reference path="../pb_data/types.d.ts" />
/**
 * The document engine: quotes, sales orders, deliveries, invoices, credit
 * notes, purchase orders, goods receipts, bills and supplier credits.
 *
 * Life of a document:
 *   quote            draft -> open (sent) -> accepted | declined | cancelled
 *   sales/purchase   draft -> open (confirmed) -> closed (done) | cancelled
 *     order
 *   delivery, goods  draft -> posted -> void
 *     receipt
 *   invoice, credit  draft -> posted -> void   (paid, partly paid and overdue
 *     note, bill,                               follow from payments and the
 *     supplier credit                           due date)
 *
 * Posting writes the journal entry and the stock moves in one transaction
 * (see execute()). Voiding reverses both and undoes exactly what the
 * document did to the lines it came from. Posted documents are never
 * deleted.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function L() {
  return require(`${__hooks}/lib_doclines.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function money() {
  return require(`${__hooks}/lib_money.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

/* =============================================================== status */

/** The status people read, derived from state, payments, progress and dates. */
function statusOf(doc, today) {
  const t = doc.getString('type');
  const state = doc.getString('state');
  if (state === 'draft') return 'draft';
  if (state === 'void') return 'void';
  if (state === 'cancelled') return 'cancelled';
  if (t === 'quote') {
    if (state === 'accepted') return 'accepted';
    if (state === 'declined') return 'declined';
    const v = doc.getString('valid_until');
    if (v !== '' && v < today) return 'expired';
    return 'sent';
  }
  if (t === 'sales_order' || t === 'purchase_order') {
    if (state === 'closed') return 'done';
    const f = doc.getString('fulfil_status');
    const b = doc.getString('bill_status');
    if (f === 'full' && b !== 'full') return t === 'sales_order' ? 'to_invoice' : 'to_bill';
    if (f === 'partial') return t === 'sales_order' ? 'partly_delivered' : 'partly_received';
    if (b === 'partial' && f !== 'none') return t === 'sales_order' ? 'to_invoice' : 'to_bill';
    return t === 'sales_order' ? 'to_deliver' : 'to_receive';
  }
  if (t === 'delivery' || t === 'goods_receipt') return 'posted';
  // money documents
  const total = doc.getInt('total');
  const balance = doc.getInt('balance');
  if (t === 'credit_note' || t === 'supplier_credit') {
    if (balance <= 0) return 'used';
    if (balance < total) return 'partly_used';
    return 'open';
  }
  if (total > 0 && balance <= 0) return 'paid';
  const due = doc.getString('due_date');
  if (due !== '' && due < today) return 'overdue';
  if (balance < total) return 'partly_paid';
  return 'unpaid';
}

/* =============================================================== loading */

function loadDoc(ctx, ref, need, type) {
  const doc = core().resolveDoc(ctx.app, ref, type);
  auth().needDoc(ctx, doc.getString('type'), need);
  return doc;
}

function linesOf(app, docId) {
  return app.findRecordsByFilter('document_lines', 'doc = {:d}', 'sort', 0, 0, { d: docId });
}

/* ============================================================ the header */

function partyFor(ctx, app, ref, side, tx) {
  const util = u();
  const party = core().resolve(app, 'parties', ref);
  if (party.getBool('archived')) throw util.fail(409, party.getString('name') + ' is archived. Restore it first.', 'archived');
  const flag = side === 'sales' ? 'is_customer' : 'is_supplier';
  if (!party.getBool(flag) && tx) {
    const p2 = tx.findRecordById('parties', party.id);
    p2.set(flag, true);
    tx.save(p2);
  }
  return party;
}

function dueFrom(date, terms) {
  const util = u();
  if (terms === null) return date;
  if (terms.getBool('end_of_month')) return util.monthEnd(util.addMonths(date.slice(0, 7), 1));
  return util.addDays(date, terms.getInt('days'));
}

/** The exchange rate (e8) for `cur`: given, else the currencies table. */
function fxFor(app, cur, p) {
  const util = u();
  const base = core().currency(app);
  if (cur === base) return money().E8;
  const given = util.rate(p, 'fx_rate');
  if (given !== null) return given;
  const c = util.findOne(app, 'currencies', 'code = {:c}', { c: cur });
  if (c !== null && c.getInt('rate_e8') > 0) return c.getInt('rate_e8');
  throw util.fail(400, 'There is no exchange rate for ' + cur + '. Give fx_rate (how many ' + base + ' one ' + cur + ' is worth), or add the rate under Settings, Currencies.', 'fx_missing', { currency: cur });
}

/** Apply header params to a document record (create or update). */
function readHeader(ctx, app, tx, doc, p, isNew) {
  const util = u();
  const t = L().type(doc.getString('type'));
  const draft = doc.getString('state') === 'draft';
  const base = core().currency(app);
  const s = core().settings(app);
  const defaults = core().defaults(app);
  if (util.has(p, 'party')) {
    if (!draft && !isNew) throw util.fail(409, 'The customer or supplier of a confirmed document cannot change.', 'not_editable');
    const party = partyFor(ctx, app, util.str(p, 'party', ''), t.side, tx);
    doc.set('party', party.id);
    if (isNew || util.str(p, 'billing_address', '') === '') doc.set('billing_address', party.getString('billing_address'));
    if (isNew || util.str(p, 'shipping_address', '') === '') doc.set('shipping_address', party.getString('shipping_address') || party.getString('billing_address'));
    if (isNew && doc.getString('attention') === '') doc.set('attention', party.getString('contact_name'));
    if (isNew && !util.has(p, 'terms') && party.getString('terms') !== '') doc.set('terms', party.getString('terms'));
    if (isNew && !util.has(p, 'currency') && party.getString('currency') !== '') doc.set('currency', party.getString('currency'));
  }
  if (isNew && doc.getString('party') === '') throw util.fail(400, 'party is required: the ' + (t.side === 'sales' ? 'customer' : 'supplier') + "'s name, code or id", 'missing_param');
  if (util.has(p, 'date')) doc.set('date', util.day(p, 'date', util.today()));
  if (isNew && doc.getString('date') === '') doc.set('date', util.today());
  if (util.has(p, 'currency')) {
    if (!draft && !isNew) throw util.fail(409, 'The currency of a confirmed document cannot change.', 'not_editable');
    const c = util.str(p, 'currency', '').toUpperCase();
    if (c !== '' && !/^[A-Z]{3}$/.test(c)) throw util.fail(400, 'currency must be a 3-letter code like EUR', 'invalid_param');
    doc.set('currency', c === '' ? base : c);
  }
  if (doc.getString('currency') === '') doc.set('currency', base);
  if (util.has(p, 'fx_rate') || isNew || util.has(p, 'currency')) {
    if (!draft && !isNew && util.has(p, 'fx_rate')) throw util.fail(409, 'The exchange rate of a confirmed document cannot change.', 'not_editable');
    doc.set('fx_e8', fxFor(app, doc.getString('currency'), p));
  }
  if (util.has(p, 'prices_include_tax')) {
    if (!draft && !isNew) throw util.fail(409, 'This cannot change once the document is confirmed.', 'not_editable');
    doc.set('prices_include_tax', util.bool(p, 'prices_include_tax', false));
  } else if (isNew) doc.set('prices_include_tax', s.getBool('prices_include_tax'));
  if (util.has(p, 'terms')) {
    const terms = core().resolveOpt(app, 'payment_terms', util.str(p, 'terms', ''));
    doc.set('terms', terms !== null ? terms.id : '');
  } else if (isNew && doc.getString('terms') === '' && typeof defaults.terms === 'string') doc.set('terms', defaults.terms);
  if (t.money || doc.getString('type') === 'sales_order' || doc.getString('type') === 'purchase_order') {
    if (util.has(p, 'due_date')) doc.set('due_date', util.day(p, 'due_date', ''));
    else if (t.money && (isNew || util.has(p, 'date') || util.has(p, 'terms') || util.has(p, 'party'))) {
      const terms = util.byId(app, 'payment_terms', doc.getString('terms'));
      doc.set('due_date', dueFrom(doc.getString('date'), terms));
    }
  }
  if (doc.getString('type') === 'quote') {
    if (util.has(p, 'valid_until')) doc.set('valid_until', util.day(p, 'valid_until', ''));
    else if (isNew) doc.set('valid_until', util.addDays(doc.getString('date'), s.getInt('quote_validity_days') || 30));
  }
  if (util.has(p, 'expected_date')) doc.set('expected_date', util.day(p, 'expected_date', ''));
  if (util.has(p, 'reference')) doc.set('reference', util.text(p, 'reference', 120, ''));
  if (util.has(p, 'attention')) doc.set('attention', util.text(p, 'attention', 120, ''));
  if (util.has(p, 'billing_address')) doc.set('billing_address', util.text(p, 'billing_address', 600, ''));
  if (util.has(p, 'shipping_address')) doc.set('shipping_address', util.text(p, 'shipping_address', 600, ''));
  if (util.has(p, 'warehouse')) {
    const wh = core().resolveOpt(app, 'warehouses', util.str(p, 'warehouse', ''));
    doc.set('warehouse', wh !== null ? wh.id : '');
  }
  if (doc.getString('warehouse') === '' && typeof defaults.warehouse === 'string' && defaults.warehouse !== '') doc.set('warehouse', defaults.warehouse);
  if (util.has(p, 'project')) {
    const pr = core().resolveOpt(app, 'projects', util.str(p, 'project', ''));
    doc.set('project', pr !== null ? pr.id : '');
  }
  if (util.has(p, 'department')) {
    const d = core().resolveOpt(app, 'departments', util.str(p, 'department', ''));
    doc.set('department', d !== null ? d.id : '');
  }
  if (util.has(p, 'moves_stock')) {
    if (!draft) throw util.fail(409, 'This cannot change once the document is posted.', 'not_editable');
    doc.set('moves_stock', util.bool(p, 'moves_stock', true));
  }
  if (util.has(p, 'notes')) doc.set('notes', util.text(p, 'notes', 4000, ''));
  if (util.has(p, 'internal_note')) doc.set('internal_note', util.text(p, 'internal_note', 4000, ''));
  if (util.has(p, 'agent_note')) doc.set('agent_note', util.text(p, 'agent_note', 2000, ''));
}

function editable(doc) {
  const st = doc.getString('state');
  const t = doc.getString('type');
  if (st === 'draft') return true;
  if (st === 'open' && (t === 'quote' || t === 'sales_order' || t === 'purchase_order')) return true;
  return false;
}

function assertEditable(doc) {
  if (!editable(doc)) {
    throw u().fail(409, docLabel(doc) + ' is ' + doc.getString('state') + ' and can no longer be edited.' + (L().TYPES[doc.getString('type')].posts ? ' Void it, or correct it with a new document.' : ''), 'not_editable');
  }
}

function docLabel(doc) {
  const t = L().TYPES[doc.getString('type')];
  return t.label + ' ' + (doc.getString('number') !== '' ? doc.getString('number') : '(draft)');
}

/* ================================================================ lines */

/** Replace a document's lines with `input` (lines that carry their id are kept). */
function writeLines(ctx, app, tx, doc, input) {
  const util = u();
  const party = util.byId(tx, 'parties', doc.getString('party'));
  const existing = linesOf(tx, doc.id);
  const byId = {};
  for (const l of existing) byId[l.id] = l;
  const keep = {};
  const cache = {};
  if (input.length > 1000) throw util.fail(400, 'A document can have at most 1000 lines.', 'invalid_param');
  input.forEach((raw, i) => {
    const shape = L().readLine(tx, doc.getString('type'), raw, party, i, cache);
    const ex = shape.id !== '' ? byId[shape.id] : undefined;
    if (shape.id !== '' && ex === undefined) throw util.fail(400, 'Line ' + (i + 1) + ' has an id that is not on this document.', 'invalid_param');
    if (ex !== undefined) {
      const done = Math.max(ex.getFloat('qty_fulfilled'), ex.getFloat('qty_invoiced'));
      if (done > 0) {
        if (shape.item !== ex.getString('item')) throw util.fail(409, 'Line ' + (i + 1) + ' has been delivered or invoiced in part; its item cannot change.', 'line_in_use');
        if (shape.qty < done) throw util.fail(409, 'Line ' + (i + 1) + ' cannot go below ' + util.fmtQty(done) + ' (already done).', 'line_in_use');
      }
      keep[ex.id] = true;
      L().saveLine(tx, doc, shape, i, ex);
    } else {
      if (shape.source_line !== '') checkSourceLine(tx, doc, shape.source_line);
      L().saveLine(tx, doc, shape, i, null);
    }
  });
  for (const l of existing) {
    if (keep[l.id]) continue;
    if (l.getFloat('qty_fulfilled') > 0 || l.getFloat('qty_invoiced') > 0) {
      throw util.fail(409, 'The line "' + l.getString('description') + '" has been delivered or invoiced in part and cannot be removed.', 'line_in_use');
    }
    const used = util.one(tx, 'SELECT COUNT(id) AS n FROM document_lines WHERE source_line = {:l}', { n: 0 }, { l: l.id }).n;
    if (used > 0) throw util.fail(409, 'The line "' + l.getString('description') + '" is used by another document and cannot be removed.', 'line_in_use');
    tx.delete(tx.findRecordById('document_lines', l.id));
  }
}

/** A source line must belong to a document of a type this one can come from. */
function checkSourceLine(app, doc, lineId) {
  const util = u();
  const src = util.byId(app, 'document_lines', lineId);
  if (src === null) throw util.fail(400, 'source_line ' + lineId + ' does not exist.', 'invalid_param');
  const sd = util.byId(app, 'documents', src.getString('doc'));
  if (sd === null) throw util.fail(400, 'source_line ' + lineId + ' has no document.', 'invalid_param');
  const can = L().CONVERT[sd.getString('type')] || [];
  if (can.indexOf(doc.getString('type')) < 0) throw util.fail(400, 'A ' + doc.getString('type').replace(/_/g, ' ') + ' line cannot come from a ' + sd.getString('type').replace(/_/g, ' ') + '.', 'invalid_param');
  if (sd.getString('party') !== doc.getString('party')) throw util.fail(400, 'source_line belongs to a document of another party.', 'invalid_param');
}

/* ================================================================ create */

function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const typeName = util.oneOf(p, 'type', L().TYPE_NAMES, '');
  if (typeName === '') throw util.fail(400, 'type is required: ' + L().TYPE_NAMES.join(', '), 'missing_param');
  auth().needDoc(ctx, typeName, 'edit');
  const t = L().type(typeName);
  const input = util.list(p, 'lines') || [];
  let id = '';
  app.runInTransaction((tx) => {
    const doc = util.newRecord(tx, 'documents');
    doc.set('type', typeName);
    doc.set('state', 'draft');
    doc.set('paid', 0);
    doc.set('balance', 0);
    doc.set('fulfil_status', 'none');
    doc.set('bill_status', 'none');
    doc.set('moves_stock', true);
    doc.set('prepared_by', ctx.memberId);
    doc.set('prepared_actor', ctx.isAgent ? 'agent' : 'person');
    readHeader(ctx, app, tx, doc, p, true);
    if (t.numberAt === 'create') doc.set('number', core().nextNumber(tx, t.series));
    if (util.has(p, 'source')) {
      const src = core().resolveDoc(tx, util.str(p, 'source', ''));
      doc.set('source', src.id);
    }
    tx.save(doc);
    writeLines(ctx, app, tx, doc, input);
    L().retotal(tx, doc);
    tx.save(doc);
    if (ctx.isAgent) markAgentFields(tx, doc, p);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'create', entity: 'documents', ref: doc.id, label: docLabel(doc), summary: 'Created ' + docLabel(doc) + ' with ' + input.length + (input.length === 1 ? ' line' : ' lines') });
    id = doc.id;
  });
  return get(ctx, { doc: id });
}

/** Mark the header fields your AI agent filled (shown in the app). */
function markAgentFields(tx, doc, p) {
  const util = u();
  for (const f of ['party', 'date', 'due_date', 'reference', 'currency', 'fx_rate', 'terms']) {
    if (!util.has(p, f)) continue;
    const m = util.newRecord(tx, 'field_marks');
    m.set('entity', 'documents');
    m.set('ref', doc.id);
    m.set('field', f);
    m.set('confidence', 'high');
    m.set('reason', '');
    tx.save(m);
  }
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'edit');
  const onlyNotes = Object.keys(p).every((k) => ['doc', 'notes', 'internal_note', 'agent_note', 'reference', 'expected_date'].indexOf(k) >= 0);
  if (!onlyNotes) assertEditable(doc);
  app.runInTransaction((tx) => {
    const d = tx.findRecordById('documents', doc.id);
    if (!onlyNotes) assertEditable(d);
    readHeader(ctx, app, tx, d, p, false);
    if (util.has(p, 'lines')) writeLines(ctx, app, tx, d, util.list(p, 'lines') || []);
    L().retotal(tx, d);
    tx.save(d);
    if (doc.getString('type') === 'sales_order' || doc.getString('type') === 'purchase_order') syncOrder(tx, d.id);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'update', entity: 'documents', ref: d.id, label: docLabel(d), summary: 'Changed ' + docLabel(d) });
  });
  return get(ctx, { doc: doc.id });
}

function setLines(ctx, p) {
  const util = u();
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'edit');
  assertEditable(doc);
  const input = util.list(p, 'lines') || [];
  ctx.app.runInTransaction((tx) => {
    const d = tx.findRecordById('documents', doc.id);
    assertEditable(d);
    writeLines(ctx, ctx.app, tx, d, input);
    L().retotal(tx, d);
    tx.save(d);
    if (d.getString('type') === 'sales_order' || d.getString('type') === 'purchase_order') syncOrder(tx, d.id);
  });
  return get(ctx, { doc: doc.id });
}

function lineInput(rec) {
  return {
    id: rec.id,
    item: rec.getString('item'),
    description: rec.getString('description'),
    qty: rec.getFloat('qty'),
    unit: rec.getString('unit'),
    unit_price_e4: rec.getInt('unit_price'),
    discount_bp: rec.getInt('discount_bp'),
    tax: rec.getString('tax') === '' ? 'none' : rec.getString('tax'),
    account: rec.getString('account'),
    project: rec.getString('project'),
    department: rec.getString('department'),
    source_line: rec.getString('source_line'),
  };
}

function addLine(ctx, p) {
  const util = u();
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'edit');
  assertEditable(doc);
  const existing = linesOf(ctx.app, doc.id).map(lineInput);
  const raw = {};
  for (const k of ['item', 'description', 'qty', 'unit', 'unit_price', 'discount', 'tax', 'account', 'project', 'department']) if (util.has(p, k)) raw[k] = p[k];
  // The same item already on the document, at the same price: add to its quantity.
  if (raw.item !== undefined && raw.unit_price === undefined && raw.description === undefined) {
    const it = core().resolve(ctx.app, 'items', raw.item);
    const same = existing.find((l) => l.item === it.id && l.source_line === '');
    if (same !== undefined) {
      same.qty = util.q3(Number(same.qty) + util.qtyOf(raw.qty, 'qty', { required: true, positive: true }));
      return setLines(ctx, { doc: doc.id, lines: existing });
    }
  }
  existing.push(raw);
  return setLines(ctx, { doc: doc.id, lines: existing });
}

function updateLine(ctx, p) {
  const util = u();
  const lineRec = core().resolve(ctx.app, 'document_lines', util.req(p, 'line'));
  const doc = loadDoc(ctx, lineRec.getString('doc'), 'edit');
  assertEditable(doc);
  const lines = linesOf(ctx.app, doc.id).map(lineInput);
  const target = lines.find((l) => l.id === lineRec.id);
  for (const k of ['item', 'description', 'qty', 'unit', 'tax', 'account', 'project', 'department']) if (util.has(p, k)) target[k] = p[k];
  if (util.has(p, 'unit_price')) {
    delete target.unit_price_e4;
    target.unit_price = p.unit_price;
  }
  if (util.has(p, 'discount')) {
    delete target.discount_bp;
    target.discount = p.discount;
  }
  return setLines(ctx, { doc: doc.id, lines: lines });
}

function removeLine(ctx, p) {
  const util = u();
  const lineRec = core().resolve(ctx.app, 'document_lines', util.req(p, 'line'));
  const doc = loadDoc(ctx, lineRec.getString('doc'), 'edit');
  assertEditable(doc);
  const lines = linesOf(ctx.app, doc.id)
    .map(lineInput)
    .filter((l) => l.id !== lineRec.id);
  return setLines(ctx, { doc: doc.id, lines: lines });
}

/* ========================================================= order status */

/** Re-derive a sales or purchase order's delivery and billing status (and close it when done). */
function syncOrder(tx, orderId) {
  const util = u();
  const o = util.byId(tx, 'documents', orderId);
  if (o === null) return;
  const t = o.getString('type');
  if (t !== 'sales_order' && t !== 'purchase_order') return;
  const lines = linesOf(tx, o.id);
  let fAny = false;
  let fAll = true;
  let fRel = false;
  let bAny = false;
  let bAll = lines.length > 0;
  for (const l of lines) {
    const it = util.byId(tx, 'items', l.getString('item'));
    const goods = it !== null && it.getString('kind') !== 'service';
    const q = l.getFloat('qty');
    if (goods) {
      fRel = true;
      if (l.getFloat('qty_fulfilled') > 0) fAny = true;
      if (l.getFloat('qty_fulfilled') + 1e-9 < q) fAll = false;
    }
    if (l.getFloat('qty_invoiced') > 0) bAny = true;
    if (l.getFloat('qty_invoiced') + 1e-9 < q) bAll = false;
  }
  const f = !fRel ? (bAll ? 'full' : bAny ? 'partial' : 'none') : fAll ? 'full' : fAny ? 'partial' : 'none';
  const b = bAll ? 'full' : bAny ? 'partial' : 'none';
  o.set('fulfil_status', f);
  o.set('bill_status', b);
  const st = o.getString('state');
  if (st === 'open' && f === 'full' && b === 'full') o.set('state', 'closed');
  else if (st === 'closed' && !(f === 'full' && b === 'full') && o.getString('voided_at') === '') o.set('state', 'open');
  tx.save(o);
}

function syncOrderOfLine(tx, lineId, seen) {
  const util = u();
  const l = util.byId(tx, 'document_lines', lineId);
  if (l === null) return;
  const d = l.getString('doc');
  if (seen[d]) return;
  seen[d] = true;
  syncOrder(tx, d);
}

/* =============================================================== posting */

/**
 * Side effects of posting, live or simulated. In dry mode nothing is
 * written: stock is simulated per item so a preview shows the same values
 * and the same refusals as the real post.
 */
function effects(tx, ctx, doc, date, dry) {
  const util = u();
  const stock = require(`${__hooks}/lib_stock.js`);
  const base = core().currency(tx);
  const sim = {};
  const simStock = {};
  const label = docLabel(doc);
  const batch = util.token(15);
  const out = {
    moves: [],
    residual: 0,
    sourceTouched: {},
    simVal(item) {
      if (sim[item.id] === undefined) {
        const v = util.findOne(tx, 'valuation', 'item = {:i}', { i: item.id });
        sim[item.id] = v === null ? { q: 0, v: 0, last: 0 } : { q: v.getFloat('qty'), v: v.getInt('value'), last: v.getInt('last_cost') };
      }
      return sim[item.id];
    },
    simQty(item, wh) {
      const k = item.id + '|' + wh;
      if (simStock[k] === undefined) simStock[k] = stock.onHand(tx, item.id, wh);
      return simStock[k];
    },
    /** Take qty out; returns the value (positive). */
    out(item, wh, qty, kind, lineId) {
      if (dry) {
        const have = this.simQty(item, wh);
        const allowNeg = core().settings(tx).getBool('allow_negative_stock');
        if (have - qty < -1e-9 && !allowNeg) {
          const w = util.byId(tx, 'warehouses', wh);
          throw util.fail(409, 'Only ' + util.fmtQty(have) + ' of ' + item.getString('name') + ' in ' + (w ? w.getString('name') : 'the warehouse') + ' (needs ' + util.fmtQty(qty) + ').', 'insufficient_stock', { item: item.id, warehouse: wh, on_hand: have, needed: qty });
        }
        simStock[item.id + '|' + wh] = util.q3(have - qty);
        const s = this.simVal(item);
        const v = stock.takeValue(s.q, s.v, s.last, qty, base);
        s.q = util.q3(s.q - qty);
        s.v -= v;
        if (s.q === 0 && s.v !== 0) {
          this.residual += s.v;
          s.v = 0;
        }
        return v;
      }
      const r = stock.move(tx, ctx, { item: item, warehouse: wh, qty: -qty, kind: kind, date: date, source: { entity: 'documents', id: doc.id, label: label, line: lineId }, batch: batch });
      this.moves.push(r.move);
      this.residual += r.residual;
      return -r.value;
    },
    /** Put qty in at `value` (minor, base) or at the average cost when value is null; returns the value. */
    in(item, wh, qty, value, kind, lineId) {
      if (dry) {
        simStock[item.id + '|' + wh] = util.q3(this.simQty(item, wh) + qty);
        const s = this.simVal(item);
        const money2 = money();
        const v = value !== null ? value : money2.stockValue(qty, s.q > 0 ? money2.unitCostE4(s.v, s.q, base) : s.last, base);
        s.q = util.q3(s.q + qty);
        s.v += v;
        if (s.q === 0 && s.v !== 0) {
          this.residual += s.v;
          s.v = 0;
        }
        return v;
      }
      const o = { item: item, warehouse: wh, qty: qty, kind: kind, date: date, source: { entity: 'documents', id: doc.id, label: label, line: lineId }, batch: batch };
      if (value !== null) o.value = value;
      const r = stock.move(tx, ctx, o);
      this.moves.push(r.move);
      this.residual += r.residual;
      return r.value;
    },
    /** Add to fields of a line (the source line, or this line). */
    bump(line, deltas) {
      if (dry) return;
      const rec = tx.findRecordById('document_lines', line.id);
      for (const k of Object.keys(deltas)) {
        const cur = k === 'recv_value' || k === 'cleared_value' || k === 'cost_value' ? rec.getInt(k) : rec.getFloat(k);
        rec.set(k, k === 'recv_value' || k === 'cleared_value' || k === 'cost_value' ? cur + deltas[k] : util.q3(cur + deltas[k]));
      }
      tx.save(rec);
      this.sourceTouched[rec.getString('doc')] = true;
    },
    set(line, fields) {
      if (dry) return;
      const rec = tx.findRecordById('document_lines', line.id);
      for (const k of Object.keys(fields)) rec.set(k, fields[k]);
      tx.save(rec);
    },
  };
  return out;
}

/** The line a stock-moving line points back to, with its document. */
function sourceOf(tx, line) {
  const util = u();
  const id = line.getString('source_line');
  if (id === '') return null;
  const src = util.byId(tx, 'document_lines', id);
  if (src === null) return null;
  return { line: src, doc: tx.findRecordById('documents', src.getString('doc')) };
}

/** What `q` of a sold line cost when it left: the invoice's own delivery, else the delivery it was billed from; null for average cost. */
function deliveredCost(tx, src, q) {
  let at = src;
  for (let hop = 0; at !== null && hop < 2; hop++) {
    if (at.line.getInt('cost_value') > 0 && at.line.getFloat('qty') > 0) return money().share(at.line.getInt('cost_value'), q, at.line.getFloat('qty'));
    at = sourceOf(tx, at.line);
  }
  return null;
}

/** Stock and value movement on one posted line, recorded for exact voids. */
function remember(fx, line, fields) {
  fx.set(line, fields);
}

/**
 * Compute (dry) or perform the posting of `doc` on `date`; returns the
 * journal lines. Every refusal happens here, the same way in both modes.
 */
function execute(tx, ctx, doc, date, dry) {
  const util = u();
  const c = core();
  const D = L();
  const type = doc.getString('type');
  const base = c.currency(tx);
  const cur = doc.getString('currency') || base;
  const lines = linesOf(tx, doc.id);
  const party = doc.getString('party');
  const wh = doc.getString('warehouse');
  const fx = effects(tx, ctx, doc, date, dry);
  const jl = [];
  const items = {};
  const project = doc.getString('project');
  const department = doc.getString('department');
  const itemOf = (l) => D.itemOf(tx, l.getString('item'), items);
  const dims = (l) => ({ project: l.getString('project') || project, department: l.getString('department') || department });
  const needWh = () => {
    if (wh === '') throw util.fail(400, 'Choose the warehouse the stock goes ' + (type === 'goods_receipt' || type === 'bill' || type === 'credit_note' ? 'into' : 'out of') + '.', 'warehouse_required');
    return wh;
  };
  if (lines.length === 0) throw util.fail(400, docLabel(doc) + ' has no lines.', 'empty');
  const label = docLabel(doc);

  if (type === 'invoice' || type === 'credit_note') {
    const sign = type === 'invoice' ? 1 : -1;
    const ar = c.systemAccount(tx, 'ar').id;
    let totalBase = 0;
    for (const l of lines) {
      const item = itemOf(l);
      const acc = D.lineAccount(tx, 'sales', { account: l.getString('account') }, item);
      const netB = l.getInt('net_base');
      const taxB = l.getInt('tax_base');
      totalBase += netB + taxB;
      const d = dims(l);
      jl.push(Object.assign({ account: acc, debit: sign < 0 ? netB : 0, credit: sign > 0 ? netB : 0, memo: l.getString('description').slice(0, 120) }, d));
      if (taxB !== 0) {
        const tax = D.taxOf(tx, l.getString('tax'), items);
        if (tax === null || tax.getString('sales_account') === '') throw util.fail(409, 'The tax on "' + l.getString('description') + '" has no sales tax account. Set it under Settings, Taxes.', 'tax_account_missing');
        jl.push({ account: tax.getString('sales_account'), debit: sign < 0 ? taxB : 0, credit: sign > 0 ? taxB : 0, memo: tax.getString('name') });
      }
      if (item === null || item.getString('kind') !== 'stock') {
        // Goods without stock and services: billing progress on the order line only.
        const src = sourceOf(tx, l);
        if (src !== null && type === 'invoice') {
          const left = util.q3(src.line.getFloat('qty') - src.line.getFloat('qty_invoiced'));
          if (l.getFloat('qty') > left + 1e-9) throw util.fail(409, 'Only ' + util.fmtQty(left) + ' of "' + l.getString('description') + '" is left to invoice on ' + docLabel(src.doc) + '.', 'over_invoiced');
          const deltas = { qty_invoiced: l.getFloat('qty') };
          if (item !== null && item.getString('kind') === 'non_stock' && src.doc.getString('type') === 'sales_order') deltas.qty_fulfilled = Math.max(0, util.q3(l.getFloat('qty') - Math.max(0, src.line.getFloat('qty_fulfilled') - src.line.getFloat('qty_invoiced'))));
          fx.bump(src.line, deltas);
          remember(fx, l, { qty_invoiced: l.getFloat('qty'), qty_fulfilled: deltas.qty_fulfilled || 0 });
        }
        continue;
      }
      // Stock items.
      const q = l.getFloat('qty');
      const src = sourceOf(tx, l);
      if (type === 'invoice') {
        let move = false;
        if (src !== null) {
          const isOrder = src.doc.getString('type') === 'sales_order';
          const deliveredOpen = util.q3(src.line.getFloat('qty_fulfilled') - src.line.getFloat('qty_invoiced'));
          if (src.doc.getString('type') === 'delivery') {
            const left = util.q3(src.line.getFloat('qty') - src.line.getFloat('qty_invoiced'));
            if (q > left + 1e-9) throw util.fail(409, 'Only ' + util.fmtQty(left) + ' of ' + item.getString('name') + ' from ' + docLabel(src.doc) + ' is left to invoice.', 'over_invoiced');
            fx.bump(src.line, { qty_invoiced: q });
            // The delivery's order line is invoiced too.
            const up = sourceOf(tx, src.line);
            if (up !== null) fx.bump(up.line, { qty_invoiced: q });
            remember(fx, l, { qty_invoiced: q, qty_fulfilled: 0 });
          } else if (isOrder && q <= deliveredOpen + 1e-9) {
            fx.bump(src.line, { qty_invoiced: q });
            remember(fx, l, { qty_invoiced: q, qty_fulfilled: 0 });
          } else if (isOrder && deliveredOpen <= 1e-9) {
            const left = util.q3(src.line.getFloat('qty') - src.line.getFloat('qty_fulfilled'));
            if (!doc.getBool('moves_stock')) throw util.fail(409, item.getString('name') + ' has not been delivered yet on ' + docLabel(src.doc) + '. Deliver it first, or let this invoice deliver it (moves stock).', 'not_delivered');
            if (q > left + 1e-9) throw util.fail(409, 'Only ' + util.fmtQty(left) + ' of ' + item.getString('name') + ' is left to deliver on ' + docLabel(src.doc) + '.', 'over_delivered');
            move = true;
            fx.bump(src.line, { qty_invoiced: q, qty_fulfilled: q });
            remember(fx, l, { qty_invoiced: q, qty_fulfilled: q });
          } else {
            throw util.fail(409, util.fmtQty(deliveredOpen) + ' of ' + item.getString('name') + ' on ' + docLabel(src.doc) + ' is delivered and not invoiced: invoice exactly the delivered quantity, and deliver the rest separately.', 'mixed_delivery');
          }
        } else {
          if (!doc.getBool('moves_stock')) throw util.fail(409, item.getString('name') + ' is a stock item: let this invoice deliver it (moves stock), or invoice it from its delivery.', 'stock_item_needs_move');
          move = true;
          remember(fx, l, { qty_fulfilled: q, qty_invoiced: 0 });
        }
        if (move) {
          const v = fx.out(item, needWh(), q, 'delivery', l.id);
          const cogs = D.cogsAccount(tx, item);
          const inv = c.systemAccount(tx, 'inventory').id;
          jl.push(Object.assign({ account: cogs, debit: v, credit: 0, memo: item.getString('name') }, dims(l)));
          jl.push({ account: inv, debit: 0, credit: v, memo: item.getString('name') });
          fx.set(l, { cost_value: v, unit_cost: money().unitCostE4(v, q, base) });
        }
      } else {
        // Credit note: stock comes back when the note moves stock.
        if (doc.getBool('moves_stock')) {
          const v = fx.in(item, needWh(), q, deliveredCost(tx, src, q), 'return_in', l.id);
          const cogs = D.cogsAccount(tx, item);
          const inv = c.systemAccount(tx, 'inventory').id;
          jl.push({ account: inv, debit: v, credit: 0, memo: item.getString('name') });
          jl.push(Object.assign({ account: cogs, debit: 0, credit: v, memo: item.getString('name') }, dims(l)));
          fx.set(l, { cost_value: v, unit_cost: money().unitCostE4(v, q, base), qty_fulfilled: q });
        }
      }
    }
    jl.push({ account: ar, debit: sign > 0 ? totalBase : 0, credit: sign < 0 ? totalBase : 0, party: party, doc: doc.id, currency: cur, amount_cur: sign * doc.getInt('total'), memo: label });
  } else if (type === 'delivery') {
    const inv = c.systemAccount(tx, 'inventory').id;
    for (const l of lines) {
      const item = itemOf(l);
      const q = l.getFloat('qty');
      const src = sourceOf(tx, l);
      if (src !== null) {
        const left = util.q3(src.line.getFloat('qty') - src.line.getFloat('qty_fulfilled'));
        if (q > left + 1e-9) throw util.fail(409, 'Only ' + util.fmtQty(left) + ' of ' + l.getString('description') + ' is left to deliver on ' + docLabel(src.doc) + '.', 'over_delivered');
        fx.bump(src.line, { qty_fulfilled: q });
      }
      remember(fx, l, { qty_fulfilled: q });
      if (item === null || item.getString('kind') !== 'stock') continue;
      const v = fx.out(item, needWh(), q, 'delivery', l.id);
      const cogs = D.cogsAccount(tx, item);
      jl.push(Object.assign({ account: cogs, debit: v, credit: 0, memo: item.getString('name') }, dims(l)));
      jl.push({ account: inv, debit: 0, credit: v, memo: item.getString('name') });
      fx.set(l, { cost_value: v, unit_cost: money().unitCostE4(v, q, base) });
    }
  } else if (type === 'goods_receipt') {
    const inv = c.systemAccount(tx, 'inventory').id;
    const grni = c.systemAccount(tx, 'grni').id;
    for (const l of lines) {
      const item = itemOf(l);
      const q = l.getFloat('qty');
      const src = sourceOf(tx, l);
      let value;
      if (src !== null) {
        const left = util.q3(src.line.getFloat('qty') - src.line.getFloat('qty_fulfilled'));
        if (q > left + 1e-9) throw util.fail(409, 'Only ' + util.fmtQty(left) + ' of ' + l.getString('description') + ' is left to receive on ' + docLabel(src.doc) + '.', 'over_received');
        // Valued at the order's net price (plus tax that cannot be claimed back), in base.
        let docValue = money().share(src.line.getInt('net'), q, src.line.getFloat('qty'));
        const tax = D.taxOf(tx, src.line.getString('tax'), items);
        if (tax !== null && !tax.getBool('recoverable')) docValue += money().share(src.line.getInt('tax_amount'), q, src.line.getFloat('qty'));
        value = money().convert(docValue, src.doc.getString('currency') || base, base, src.doc.getInt('fx_e8') || money().E8);
      } else {
        const a = D.amounts({ qty: q, unit_price: l.getInt('unit_price'), discount_bp: l.getInt('discount_bp'), tax_rate_bp: 0 }, doc, base);
        value = a.net_base;
      }
      if (item === null || item.getString('kind') !== 'stock') {
        if (src !== null) fx.bump(src.line, { qty_fulfilled: q });
        remember(fx, l, { qty_fulfilled: q, recv_value: 0 });
        continue;
      }
      const v = fx.in(item, needWh(), q, value, 'receipt', l.id);
      jl.push({ account: inv, debit: v, credit: 0, memo: item.getString('name') });
      jl.push({ account: grni, debit: 0, credit: v, party: party, memo: item.getString('name') + ' received' });
      // The line bills clear against: the order line, or this receipt line.
      if (src !== null) fx.bump(src.line, { qty_fulfilled: q, recv_value: v });
      remember(fx, l, { qty_fulfilled: q, recv_value: v, cost_value: v, unit_cost: money().unitCostE4(v, q, base) });
    }
  } else if (type === 'bill' || type === 'supplier_credit') {
    const sign = type === 'bill' ? 1 : -1;
    const ap = c.systemAccount(tx, 'ap').id;
    const inv = c.systemAccount(tx, 'inventory').id;
    const grni = c.systemAccount(tx, 'grni').id;
    const ppv = c.systemAccount(tx, 'ppv').id;
    let totalBase = 0;
    for (const l of lines) {
      const item = itemOf(l);
      const q = l.getFloat('qty');
      const netB = l.getInt('net_base');
      const taxB = l.getInt('tax_base');
      totalBase += netB + taxB;
      const tax = D.taxOf(tx, l.getString('tax'), items);
      let extra = 0;
      if (taxB !== 0) {
        if (tax !== null && tax.getBool('recoverable')) {
          if (tax.getString('purchase_account') === '') throw util.fail(409, 'The tax ' + tax.getString('name') + ' has no purchase tax account. Set it under Settings, Taxes.', 'tax_account_missing');
          jl.push({ account: tax.getString('purchase_account'), debit: sign > 0 ? taxB : 0, credit: sign < 0 ? taxB : 0, memo: tax.getString('name') });
        } else extra = taxB;
      }
      const amount = netB + extra;
      const d = dims(l);
      const src = sourceOf(tx, l);
      if (item === null || item.getString('kind') !== 'stock') {
        const acc = D.lineAccount(tx, 'purchase', { account: l.getString('account') }, item);
        jl.push(Object.assign({ account: acc, debit: sign > 0 ? amount : 0, credit: sign < 0 ? amount : 0, memo: l.getString('description').slice(0, 120) }, d));
        if (src !== null && type === 'bill') {
          const left = util.q3(src.line.getFloat('qty') - src.line.getFloat('qty_invoiced'));
          if (q > left + 1e-9) throw util.fail(409, 'Only ' + util.fmtQty(left) + ' of "' + l.getString('description') + '" is left to bill on ' + docLabel(src.doc) + '.', 'over_invoiced');
          const deltas = { qty_invoiced: q };
          if (src.doc.getString('type') === 'purchase_order' && item !== null) deltas.qty_fulfilled = Math.max(0, util.q3(q - Math.max(0, src.line.getFloat('qty_fulfilled') - src.line.getFloat('qty_invoiced'))));
          fx.bump(src.line, deltas);
          remember(fx, l, { qty_invoiced: q, qty_fulfilled: deltas.qty_fulfilled || 0 });
        }
        continue;
      }
      if (type === 'bill') {
        // The line receipts clear against: an order line, or a standalone receipt line.
        let clearing = null;
        let order = null;
        if (src !== null) {
          if (src.doc.getString('type') === 'goods_receipt') {
            const up = sourceOf(tx, src.line);
            clearing = up !== null ? up.line : src.line;
            order = up !== null ? up : src;
          } else {
            clearing = src.line;
            order = src;
          }
        }
        const open = clearing !== null ? util.q3(clearing.getFloat('qty_fulfilled') - clearing.getFloat('qty_invoiced')) : 0;
        if (clearing !== null && q <= open + 1e-9 && open > 0) {
          const pool = clearing.getInt('recv_value') - clearing.getInt('cleared_value');
          const clear = Math.abs(q - open) < 1e-9 ? pool : money().share(pool, q, open);
          jl.push({ account: grni, debit: clear, credit: 0, party: party, memo: item.getString('name') + ' billed' });
          const diff = amount - clear;
          if (diff !== 0) jl.push(Object.assign({ account: ppv, debit: diff > 0 ? diff : 0, credit: diff < 0 ? -diff : 0, memo: 'Price difference on ' + item.getString('name') }, d));
          fx.bump(clearing, { qty_invoiced: q, cleared_value: clear });
          if (src !== null && src.doc.getString('type') === 'goods_receipt' && clearing.id !== src.line.id) fx.bump(src.line, { qty_invoiced: q });
          remember(fx, l, { qty_invoiced: q, cleared_value: clear, qty_fulfilled: 0 });
        } else if (open <= 1e-9) {
          if (!doc.getBool('moves_stock')) throw util.fail(409, item.getString('name') + ' has not been received. Receive it first, or let this bill receive it (moves stock).', 'not_received');
          if (order !== null) {
            const left = util.q3(order.line.getFloat('qty') - order.line.getFloat('qty_fulfilled'));
            if (q > left + 1e-9) throw util.fail(409, 'Only ' + util.fmtQty(left) + ' of ' + item.getString('name') + ' is left to receive on ' + docLabel(order.doc) + '.', 'over_received');
            fx.bump(order.line, { qty_fulfilled: q, qty_invoiced: q });
          }
          const v = fx.in(item, needWh(), q, amount, 'receipt', l.id);
          jl.push({ account: inv, debit: v, credit: 0, memo: item.getString('name') });
          remember(fx, l, { qty_fulfilled: q, qty_invoiced: q, cost_value: v, unit_cost: money().unitCostE4(v, q, base) });
        } else {
          throw util.fail(409, util.fmtQty(open) + ' of ' + item.getString('name') + ' is received and not billed: bill exactly that, and receive the rest separately.', 'mixed_receipt');
        }
      } else {
        // Supplier credit: stock goes back to the supplier at its average cost.
        if (doc.getBool('moves_stock')) {
          const v = fx.out(item, needWh(), q, 'return_out', l.id);
          jl.push({ account: inv, debit: 0, credit: v, memo: item.getString('name') });
          const diff = amount - v;
          if (diff !== 0) jl.push(Object.assign({ account: ppv, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0, memo: 'Price difference on ' + item.getString('name') }, d));
          fx.set(l, { cost_value: v, unit_cost: money().unitCostE4(v, q, base), qty_fulfilled: q });
        } else {
          const acc = D.lineAccount(tx, 'purchase', { account: l.getString('account') }, item);
          jl.push(Object.assign({ account: acc, debit: 0, credit: amount, memo: l.getString('description').slice(0, 120) }, d));
        }
      }
    }
    jl.push({ account: ap, debit: sign < 0 ? totalBase : 0, credit: sign > 0 ? totalBase : 0, party: party, doc: doc.id, currency: cur, amount_cur: -sign * doc.getInt('total'), memo: label });
  } else {
    throw util.fail(400, docLabel(doc) + ' does not post. Confirm it instead.', 'invalid');
  }
  for (const l of require(`${__hooks}/lib_stock.js`).residualLines(tx, fx.residual)) jl.push(l);
  return { lines: jl, fx: fx };
}

const JOURNAL_KIND = { invoice: 'invoice', credit_note: 'credit_note', delivery: 'delivery', goods_receipt: 'goods_receipt', bill: 'bill', supplier_credit: 'supplier_credit' };

/** Credit limit: refuse posting an invoice that takes the customer over it. */
function checkCredit(app, doc, override) {
  const util = u();
  if (doc.getString('type') !== 'invoice' || override) return;
  const party = util.byId(app, 'parties', doc.getString('party'));
  if (party === null || party.getInt('credit_limit') <= 0) return;
  const owed = require(`${__hooks}/lib_parties.js`).receivable(app, party.id);
  const after = owed + doc.getInt('total_base');
  if (after > party.getInt('credit_limit')) {
    const cur = core().currency(app);
    throw util.fail(409, party.getString('name') + ' would owe ' + money().fmt(after, cur) + ', over their credit limit of ' + money().fmt(party.getInt('credit_limit'), cur) + '. Post with override_credit to go ahead.', 'credit_limit', { owed: owed, limit: party.getInt('credit_limit') });
  }
}

function previewPost(ctx, p) {
  const util = u();
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'view');
  const t = L().TYPES[doc.getString('type')];
  if (!t.posts) throw util.fail(400, docLabel(doc) + ' does not post. Confirm it instead.', 'invalid');
  if (doc.getString('state') !== 'draft') throw util.fail(409, docLabel(doc) + ' is already ' + doc.getString('state') + '.', 'not_draft');
  const date = util.day(p, 'date', doc.getString('date'));
  const r = execute(ctx.app, ctx, doc, date, true);
  const cur = core().currency(ctx.app);
  const party = util.byId(ctx.app, 'parties', doc.getString('party'));
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const lines = ledger.describeLines(ctx.app, ledger.compact(r.lines));
  let warning = '';
  try {
    checkCredit(ctx.app, doc, false);
  } catch (err) {
    warning = String(err.message);
  }
  return {
    kind: doc.getString('type'),
    auto: doc.getString('type'),
    amount: doc.getInt('total_base'),
    title: 'Post ' + t.label.toLowerCase() + (doc.getString('number') !== '' ? ' ' + doc.getString('number') : '') + ' for ' + (party ? party.getString('name') : ''),
    summary: t.label + ' to ' + (party ? party.getString('name') : '') + ' dated ' + date + ' for ' + money().fmt(doc.getInt('total'), doc.getString('currency') || cur) + '.',
    lines: lines,
    currency: cur,
    warning: warning,
    target: { entity: 'documents', id: doc.id, label: docLabel(doc) },
  };
}

function post(ctx, p) {
  const util = u();
  const app = ctx.app;
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'full');
  const t = L().TYPES[doc.getString('type')];
  if (!t.posts) throw util.fail(400, docLabel(doc) + ' does not post. Use docs.confirm.', 'invalid');
  if (doc.getString('state') !== 'draft') throw util.fail(409, docLabel(doc) + ' is already ' + doc.getString('state') + '.', 'not_draft');
  const date = util.day(p, 'date', doc.getString('date'));
  checkCredit(app, doc, util.bool(p, 'override_credit', false));
  app.runInTransaction((tx) => {
    let number = '';
    if (t.numberAt === 'post') number = core().nextNumber(tx, t.series);
    const d = tx.findRecordById('documents', doc.id);
    if (d.getString('state') !== 'draft') throw util.fail(409, docLabel(d) + ' was posted a moment ago.', 'not_draft');
    if (number !== '') d.set('number', number);
    if (date !== d.getString('date')) {
      d.set('date', date);
      if (t.money) {
        const terms = util.byId(tx, 'payment_terms', d.getString('terms'));
        if (!util.has(p, 'due_date')) d.set('due_date', dueFrom(date, terms));
      }
    }
    L().retotal(tx, d);
    tx.save(d);
    const r = execute(tx, ctx, d, date, false);
    const j = require(`${__hooks}/lib_ledger.js`).post(
      tx,
      ctx,
      { kind: JOURNAL_KIND[d.getString('type')], date: date, memo: docLabel(d) + ' ' + partyName(tx, d), source: { entity: 'documents', id: d.id, label: docLabel(d) }, lines: r.lines },
      { allowControl: true },
    );
    if (j !== null) require(`${__hooks}/lib_stock.js`).linkJournal(tx, r.fx.moves, j.id);
    const fresh = tx.findRecordById('documents', d.id);
    fresh.set('state', 'posted');
    fresh.set('posted_by', ctx.memberId);
    fresh.set('posted_at', util.nowIso());
    fresh.set('journal', j !== null ? j.id : '');
    if (t.money) {
      fresh.set('paid', 0);
      fresh.set('balance', fresh.getInt('total'));
    }
    tx.save(fresh);
    const seen = {};
    for (const docId of Object.keys(r.fx.sourceTouched)) {
      if (seen[docId]) continue;
      seen[docId] = true;
      syncOrder(tx, docId);
      const sd = util.byId(tx, 'documents', docId);
      if (sd !== null && (sd.getString('type') === 'delivery' || sd.getString('type') === 'goods_receipt')) {
        // A receipt or delivery points at its order too.
        for (const sl of linesOf(tx, sd.id)) if (sl.getString('source_line') !== '') syncOrderOfLine(tx, sl.getString('source_line'), seen);
      }
    }
    // A credit note or supplier credit made from an invoice or bill settles it.
    if ((fresh.getString('type') === 'credit_note' || fresh.getString('type') === 'supplier_credit') && fresh.getString('source') !== '') {
      require(`${__hooks}/lib_payments.js`).autoApplyCredit(tx, ctx, fresh);
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, {
      kind: 'post',
      entity: 'documents',
      ref: fresh.id,
      label: docLabel(fresh),
      summary: 'Posted ' + docLabel(fresh) + (ctx.approving ? ' (proposed by your AI agent)' : ''),
      data: { journal: j !== null ? j.getString('number') : '', total: fresh.getInt('total'), currency: fresh.getString('currency') },
    });
  });
  return get(ctx, { doc: doc.id });
}

function partyName(app, doc) {
  const p = u().byId(app, 'parties', doc.getString('party'));
  return p === null ? '' : p.getString('name');
}

/* =============================================================== confirm */

function setState(ctx, p, need, allowed, next, verb) {
  const util = u();
  const doc = loadDoc(ctx, util.req(p, 'doc'), need);
  const t = doc.getString('type');
  if (allowed[t] === undefined || allowed[t].indexOf(doc.getString('state')) < 0) {
    throw util.fail(409, docLabel(doc) + ' is ' + statusOf(doc, util.today()).replace(/_/g, ' ') + ' and cannot be ' + verb + '.', 'invalid_state');
  }
  ctx.app.runInTransaction((tx) => {
    const d = tx.findRecordById('documents', doc.id);
    next(tx, d);
    tx.save(d);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: verb.replace(/ /g, '_'), entity: 'documents', ref: d.id, label: docLabel(d), summary: docLabel(d) + ' ' + verb });
  });
  return get(ctx, { doc: doc.id });
}

/** Quotes: mark as sent. Orders: confirm. */
function confirm(ctx, p) {
  return setState(ctx, p, 'edit', { quote: ['draft'], sales_order: ['draft'], purchase_order: ['draft'] }, (tx, d) => {
    if (linesOf(tx, d.id).length === 0) throw u().fail(400, docLabel(d) + ' has no lines.', 'empty');
    d.set('state', 'open');
    if (d.getString('type') === 'quote' && d.getString('sent_at') === '') d.set('sent_at', u().nowIso());
  }, 'confirmed');
}

function markSent(ctx, p) {
  const util = u();
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'edit');
  ctx.app.runInTransaction((tx) => {
    const d = tx.findRecordById('documents', doc.id);
    d.set('sent_at', util.nowIso());
    if (d.getString('state') === 'draft' && (d.getString('type') === 'quote' || d.getString('type') === 'purchase_order' || d.getString('type') === 'sales_order')) {
      if (linesOf(tx, d.id).length === 0) throw util.fail(400, docLabel(d) + ' has no lines.', 'empty');
      d.set('state', 'open');
    }
    tx.save(d);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'sent', entity: 'documents', ref: d.id, label: docLabel(d), summary: docLabel(d) + ' marked as sent' });
  });
  return get(ctx, { doc: doc.id });
}

function accept(ctx, p) {
  return setState(ctx, p, 'edit', { quote: ['draft', 'open'] }, (tx, d) => d.set('state', 'accepted'), 'accepted');
}

function decline(ctx, p) {
  return setState(ctx, p, 'edit', { quote: ['draft', 'open'] }, (tx, d) => d.set('state', 'declined'), 'declined');
}

function cancel(ctx, p) {
  return setState(ctx, p, 'edit', { quote: ['draft', 'open'], sales_order: ['draft', 'open'], purchase_order: ['draft', 'open'] }, (tx, d) => {
    for (const l of linesOf(tx, d.id)) {
      if (l.getFloat('qty_fulfilled') > 0 || l.getFloat('qty_invoiced') > 0) throw u().fail(409, docLabel(d) + ' is partly delivered or invoiced. Close it instead: the rest is then not expected.', 'in_progress');
    }
    d.set('state', 'cancelled');
  }, 'cancelled');
}

/** Orders: nothing more is expected (closed short). */
function close(ctx, p) {
  return setState(ctx, p, 'edit', { sales_order: ['open'], purchase_order: ['open'] }, (tx, d) => d.set('state', 'closed'), 'closed');
}

function reopen(ctx, p) {
  return setState(ctx, p, 'edit', { quote: ['declined', 'cancelled', 'accepted'], sales_order: ['closed', 'cancelled'], purchase_order: ['closed', 'cancelled'] }, (tx, d) => {
    d.set('state', d.getString('type') === 'quote' ? 'open' : 'open');
    if (d.getString('type') !== 'quote') syncOrder(tx, d.id);
  }, 'reopened');
}

/* ================================================================== void */

function previewVoid(ctx, p) {
  const util = u();
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'view');
  checkVoidable(ctx.app, doc);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const lines = doc.getString('journal') !== '' ? ledger.linesOf(ctx.app, doc.getString('journal')).map((l) => Object.assign({}, l, { debit: l.credit, credit: l.debit })) : [];
  return {
    kind: 'void',
    auto: '',
    amount: doc.getInt('total_base'),
    title: 'Void ' + docLabel(doc),
    summary: 'Reverses ' + docLabel(doc) + ' (' + partyName(ctx.app, doc) + ')' + (util.str(p, 'reason', '') !== '' ? ': ' + util.str(p, 'reason', '') : ''),
    lines: ledger.describeLines(ctx.app, lines),
    currency: core().currency(ctx.app),
    target: { entity: 'documents', id: doc.id, label: docLabel(doc) },
  };
}

function checkVoidable(app, doc) {
  const util = u();
  if (doc.getString('state') !== 'posted') throw util.fail(409, docLabel(doc) + ' is ' + doc.getString('state') + '; only posted documents are voided' + (doc.getString('state') === 'draft' ? ' (delete a draft instead).' : '.'), 'invalid_state');
  const n = util.one(app, "SELECT COUNT(id) AS n FROM allocations WHERE state = 'active' AND (document = {:d} OR credit = {:d})", { n: 0 }, { d: doc.id }).n;
  if (n > 0) throw util.fail(409, docLabel(doc) + ' has payments or credits applied. Remove them first (payments.unallocate).', 'has_allocations');
  // Later documents built on this one's lines.
  for (const l of linesOf(app, doc.id)) {
    const used = util.rows(app, "SELECT d.type AS type, d.number AS number FROM document_lines dl JOIN documents d ON d.id = dl.doc WHERE dl.source_line = {:l} AND d.state = 'posted' LIMIT 1", { type: '', number: '' }, { l: l.id });
    if (used.length > 0) throw util.fail(409, docLabel(doc) + ' is used by ' + used[0].type.replace(/_/g, ' ') + ' ' + used[0].number + '. Void that first.', 'in_use');
  }
  const t = doc.getString('type');
  if (t === 'goods_receipt' || t === 'delivery') {
    for (const l of linesOf(app, doc.id)) {
      const src = sourceOf(app, l);
      if (src === null) continue;
      const after = util.q3(src.line.getFloat('qty_fulfilled') - l.getFloat('qty_fulfilled'));
      if (after + 1e-9 < src.line.getFloat('qty_invoiced')) {
        throw util.fail(409, 'Part of what ' + docLabel(doc) + ' ' + (t === 'delivery' ? 'delivered' : 'received') + ' is already ' + (t === 'delivery' ? 'invoiced' : 'billed') + ' on ' + docLabel(src.doc) + '. Void that ' + (t === 'delivery' ? 'invoice' : 'bill') + ' first.', 'in_use');
      }
    }
  }
}

function voidDoc(ctx, p) {
  const util = u();
  const app = ctx.app;
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'full');
  checkVoidable(app, doc);
  const reason = util.text(p, 'reason', 500, '');
  const wanted = util.day(p, 'date', '');
  app.runInTransaction((tx) => {
    const d = tx.findRecordById('documents', doc.id);
    checkVoidable(tx, d);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const date = wanted !== '' ? wanted : ledger.firstOpenDate(tx, ctx, d.getString('date'));
    // Stock comes back (or goes out) at exactly the values it moved with.
    const back = require(`${__hooks}/lib_stock.js`).reverseSource(tx, ctx, 'documents', d.id, date, 'Void ' + docLabel(d));
    let rev = null;
    if (d.getString('journal') !== '') rev = ledger.reverse(tx, ctx, d.getString('journal'), { date: date, memo: 'Void ' + docLabel(d) + (reason !== '' ? ': ' + reason : '') });
    if (back.residual !== 0) {
      ledger.post(tx, ctx, { kind: 'reversal', date: date, memo: 'Stock value left after voiding ' + docLabel(d), source: { entity: 'documents', id: d.id, label: docLabel(d) }, lines: require(`${__hooks}/lib_stock.js`).residualLines(tx, back.residual) }, { allowControl: true });
    }
    if (rev !== null) require(`${__hooks}/lib_stock.js`).linkJournal(tx, back.moves, rev.id);
    // Undo exactly what each line did to the line it came from.
    const touched = {};
    for (const l of linesOf(tx, d.id)) {
      const src = sourceOf(tx, l);
      const qf = l.getFloat('qty_fulfilled');
      const qi = l.getFloat('qty_invoiced');
      const rv = l.getInt('recv_value');
      const cv = l.getInt('cleared_value');
      if (src === null) continue;
      let target = src.line;
      if (d.getString('type') === 'bill' && src.doc.getString('type') === 'goods_receipt') {
        const up = sourceOf(tx, src.line);
        if (up !== null) {
          target = up.line;
          const sr = tx.findRecordById('document_lines', src.line.id);
          sr.set('qty_invoiced', util.q3(sr.getFloat('qty_invoiced') - qi));
          tx.save(sr);
        }
      }
      if (d.getString('type') === 'invoice' && src.doc.getString('type') === 'delivery') {
        const up = sourceOf(tx, src.line);
        if (up !== null) {
          const ur = tx.findRecordById('document_lines', up.line.id);
          ur.set('qty_invoiced', util.q3(ur.getFloat('qty_invoiced') - qi));
          tx.save(ur);
          touched[up.doc.id] = true;
        }
      }
      const tr = tx.findRecordById('document_lines', target.id);
      tr.set('qty_fulfilled', util.q3(tr.getFloat('qty_fulfilled') - qf));
      tr.set('qty_invoiced', util.q3(tr.getFloat('qty_invoiced') - qi));
      tr.set('recv_value', tr.getInt('recv_value') - (d.getString('type') === 'goods_receipt' ? rv : 0));
      tr.set('cleared_value', tr.getInt('cleared_value') - cv);
      tx.save(tr);
      touched[tr.getString('doc')] = true;
    }
    for (const docId of Object.keys(touched)) syncOrder(tx, docId);
    const fresh = tx.findRecordById('documents', d.id);
    fresh.set('state', 'void');
    fresh.set('voided_by', ctx.memberId);
    fresh.set('voided_at', util.nowIso());
    fresh.set('void_reason', reason);
    fresh.set('void_journal', rev !== null ? rev.id : '');
    fresh.set('balance', 0);
    tx.save(fresh);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'void', entity: 'documents', ref: fresh.id, label: docLabel(fresh), summary: 'Voided ' + docLabel(fresh) + (reason !== '' ? ': ' + reason : '') });
  });
  return get(ctx, { doc: doc.id });
}

/* =============================================================== convert */

/**
 * Make a new draft from a document: quote -> order or invoice; order ->
 * delivery or invoice (or receipt and bill); delivery -> invoice; receipt
 * -> bill; invoice -> credit note; bill -> supplier credit. `lines` picks
 * quantities ([{line, qty}]); by default everything still open.
 */
function convert(ctx, p) {
  const util = u();
  const app = ctx.app;
  const src = loadDoc(ctx, util.req(p, 'doc'), 'view');
  const fromType = src.getString('type');
  const to = util.oneOf(p, 'to', L().TYPE_NAMES, '');
  if (to === '') throw util.fail(400, 'to is required: ' + (L().CONVERT[fromType] || []).join(' or '), 'missing_param');
  if ((L().CONVERT[fromType] || []).indexOf(to) < 0) throw util.fail(400, 'A ' + fromType.replace(/_/g, ' ') + ' cannot become a ' + to.replace(/_/g, ' ') + '. It can become: ' + ((L().CONVERT[fromType] || []).join(', ') || 'nothing'), 'invalid_param');
  auth().needDoc(ctx, to, 'edit');
  const st = src.getString('state');
  const okState = fromType === 'quote' ? ['draft', 'open', 'accepted'] : fromType === 'sales_order' || fromType === 'purchase_order' ? ['open'] : ['posted'];
  if (okState.indexOf(st) < 0) throw util.fail(409, docLabel(src) + ' is ' + statusOf(src, util.today()).replace(/_/g, ' ') + '; ' + (st === 'draft' ? 'confirm or post it first.' : 'it cannot be converted.'), 'invalid_state');
  const picks = util.list(p, 'lines');
  const pick = {};
  if (picks !== undefined) {
    picks.forEach((x, i) => util.keysOnly(x, ['line', 'qty'], 'Line ' + (i + 1)));
    for (const x of picks) {
      if (!x || !x.line) throw util.fail(400, 'lines must be like [{"line":"<line id>","qty":2}]', 'invalid_param');
      pick[String(x.line)] = util.qtyOf(x.qty, 'qty', { required: true });
    }
  }
  const srcLines = linesOf(app, src.id);
  const out = [];
  for (const l of srcLines) {
    const item = L().itemOf(app, l.getString('item'), null);
    const q = l.getFloat('qty');
    let open;
    if (to === 'delivery' || to === 'goods_receipt') {
      if (item === null || item.getString('kind') === 'service') continue;
      open = util.q3(q - l.getFloat('qty_fulfilled'));
    } else if (to === 'invoice' || to === 'bill') {
      if (fromType === 'sales_order' || fromType === 'purchase_order') {
        const stockLike = item !== null && item.getString('kind') === 'stock';
        const deliveredOpen = util.q3(l.getFloat('qty_fulfilled') - l.getFloat('qty_invoiced'));
        open = stockLike && deliveredOpen > 0 ? deliveredOpen : util.q3(q - l.getFloat('qty_invoiced'));
      } else if (fromType === 'quote') open = q;
      else open = util.q3(q - l.getFloat('qty_invoiced'));
    } else open = q;
    if (pick[l.id] !== undefined) open = pick[l.id];
    else if (picks !== undefined) continue;
    if (open <= 0) continue;
    out.push({
      item: l.getString('item'),
      description: l.getString('description'),
      qty: open,
      unit: l.getString('unit'),
      unit_price_e4: l.getInt('unit_price'),
      discount_bp: l.getInt('discount_bp'),
      tax: l.getString('tax') === '' ? 'none' : l.getString('tax'),
      account: l.getString('account'),
      project: l.getString('project'),
      department: l.getString('department'),
      source_line: fromType === 'quote' ? '' : l.id,
    });
  }
  // Deliveries and receipts made from an order carry the order's prices for invoicing.
  if ((fromType === 'delivery' || fromType === 'goods_receipt') && (to === 'invoice' || to === 'bill')) {
    for (const o of out) {
      const sl = util.byId(app, 'document_lines', o.source_line);
      const up = sl !== null ? sourceOf(app, sl) : null;
      if (up !== null) {
        o.unit_price_e4 = up.line.getInt('unit_price');
        o.discount_bp = up.line.getInt('discount_bp');
        o.tax = up.line.getString('tax') === '' ? 'none' : up.line.getString('tax');
        o.account = up.line.getString('account');
      }
    }
  }
  if (out.length === 0) throw util.fail(409, 'Nothing is left to turn into a ' + to.replace(/_/g, ' ') + ' on ' + docLabel(src) + '.', 'nothing_left');
  const header = {
    type: to,
    party: src.getString('party'),
    currency: src.getString('currency'),
    fx_rate: money().e8Text(src.getInt('fx_e8') || money().E8),
    prices_include_tax: src.getBool('prices_include_tax'),
    reference: src.getString('reference'),
    warehouse: src.getString('warehouse'),
    project: src.getString('project'),
    department: src.getString('department'),
    notes: src.getString('notes'),
    source: src.id,
    lines: out,
    date: util.day(p, 'date', util.today()),
  };
  if (src.getString('terms') !== '') header.terms = src.getString('terms');
  // An invoice made after deliveries does not move stock; one made straight from an order does.
  if (to === 'invoice' || to === 'bill') {
    const fromOrder = fromType === 'sales_order' || fromType === 'purchase_order';
    header.moves_stock = fromType === 'quote' || (fromOrder && !srcLines.some((l) => l.getFloat('qty_fulfilled') > l.getFloat('qty_invoiced')));
  }
  // A credit for stock items takes the goods back by default; turned off, it is a price allowance.
  if (to === 'credit_note' || to === 'supplier_credit') {
    header.moves_stock = srcLines.some((l) => {
      const it = l.getString('item') === '' ? null : util.byId(app, 'items', l.getString('item'));
      return it !== null && it.getString('kind') === 'stock';
    });
  }
  let created = null;
  const res = create(ctx, header);
  created = res;
  if (fromType === 'quote' && (to === 'sales_order' || to === 'invoice')) {
    app.runInTransaction((tx) => {
      const q = tx.findRecordById('documents', src.id);
      if (q.getString('state') !== 'accepted') {
        q.set('state', 'accepted');
        tx.save(q);
      }
    });
  }
  return created;
}

/* =========================================================== delete, copy */

function remove(ctx, p) {
  const util = u();
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'edit');
  const st = doc.getString('state');
  const t = doc.getString('type');
  const deletable = st === 'draft' || ((t === 'quote' || t === 'sales_order' || t === 'purchase_order') && (st === 'cancelled' || st === 'declined'));
  if (!deletable) throw util.fail(409, docLabel(doc) + ' is ' + st + '. Only drafts (and cancelled or declined quotes and orders) are deleted; void posted documents instead.', 'not_deletable');
  const used = util.one(ctx.app, 'SELECT COUNT(dl.id) AS n FROM document_lines dl WHERE dl.source_line IN (SELECT id FROM document_lines WHERE doc = {:d})', { n: 0 }, { d: doc.id }).n;
  if (used > 0) throw util.fail(409, docLabel(doc) + ' has documents made from it. Delete those first.', 'in_use');
  if (util.bool(p, 'preview', false)) return { preview: true, label: docLabel(doc), lines: doc.getInt('lines_count') };
  ctx.app.runInTransaction((tx) => {
    for (const r of tx.findRecordsByFilter('field_marks', "entity = 'documents' && ref = {:r}", '', 0, 0, { r: doc.id })) tx.delete(tx.findRecordById('field_marks', r.id));
    tx.delete(tx.findRecordById('documents', doc.id));
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'delete', entity: 'documents', ref: doc.id, label: docLabel(doc), summary: 'Deleted ' + docLabel(doc) });
  });
  return { deleted: true };
}

function duplicate(ctx, p) {
  const util = u();
  const src = loadDoc(ctx, util.req(p, 'doc'), 'view');
  auth().needDoc(ctx, src.getString('type'), 'edit');
  const lines = linesOf(ctx.app, src.id).map((l) => {
    const x = lineInput(l);
    delete x.id;
    x.source_line = '';
    return x;
  });
  return create(ctx, {
    type: src.getString('type'),
    party: src.getString('party'),
    currency: src.getString('currency'),
    fx_rate: money().e8Text(src.getInt('fx_e8') || money().E8),
    prices_include_tax: src.getBool('prices_include_tax'),
    warehouse: src.getString('warehouse'),
    project: src.getString('project'),
    department: src.getString('department'),
    terms: src.getString('terms'),
    notes: src.getString('notes'),
    lines: lines,
  });
}

/* ================================================================ output */

function lineOut(app, l, cur, cache) {
  const D = L();
  const m = money();
  const item = D.itemOf(app, l.getString('item'), cache);
  const tax = D.taxOf(app, l.getString('tax'), cache);
  const acc = l.getString('account') !== '' ? u().byId(app, 'accounts', l.getString('account')) : null;
  const q = l.getFloat('qty');
  return {
    id: l.id,
    sort: l.getInt('sort'),
    item: item !== null ? { id: item.id, sku: item.getString('sku'), name: item.getString('name'), kind: item.getString('kind'), unit: item.getString('unit'), fractional: item.getBool('fractional'), photo: item.getString('photo') !== '' ? '/api/files/items/' + item.id + '/' + item.getString('photo') : '' } : null,
    description: l.getString('description'),
    qty: q,
    unit: l.getString('unit'),
    unit_price: m.e4Text(l.getInt('unit_price'), cur),
    unit_price_e4: l.getInt('unit_price'),
    discount: m.bpText(l.getInt('discount_bp')),
    discount_bp: l.getInt('discount_bp'),
    tax: tax !== null ? { id: tax.id, code: tax.getString('code'), name: tax.getString('name'), rate: m.bpText(tax.getInt('rate_bp')) } : null,
    tax_rate_bp: l.getInt('tax_rate_bp'),
    account: acc !== null ? { id: acc.id, code: acc.getString('code'), name: acc.getString('name') } : null,
    net: l.getInt('net'),
    tax_amount: l.getInt('tax_amount'),
    total: l.getInt('total'),
    net_base: l.getInt('net_base'),
    project: l.getString('project'),
    department: l.getString('department'),
    source_line: l.getString('source_line'),
    qty_fulfilled: l.getFloat('qty_fulfilled'),
    qty_invoiced: l.getFloat('qty_invoiced'),
    unit_cost: l.getInt('unit_cost'),
    cost_value: l.getInt('cost_value'),
  };
}

function flowOf(app, doc) {
  const util = u();
  const seen = {};
  const out = [];
  const add = (d) => {
    if (d === null || seen[d.id]) return;
    seen[d.id] = true;
    out.push({ id: d.id, type: d.getString('type'), number: d.getString('number'), state: d.getString('state'), status: statusOf(d, util.today()), date: d.getString('date'), total: d.getInt('total'), currency: d.getString('currency') });
  };
  // Up the chain.
  let cur = doc;
  const up = [];
  let guard = 0;
  while (cur.getString('source') !== '' && guard < 10) {
    const s = util.byId(app, 'documents', cur.getString('source'));
    if (s === null) break;
    up.unshift(s);
    cur = s;
    guard++;
  }
  for (const d of up) add(d);
  add(doc);
  // Everything made from this document and from what it came from.
  const roots = up.length > 0 ? [up[0].id] : [doc.id];
  const queue = roots.slice();
  guard = 0;
  while (queue.length > 0 && guard < 200) {
    const id = queue.shift();
    guard++;
    for (const r of util.rows(app, 'SELECT DISTINCT d.id AS id FROM documents d WHERE d.source = {:s} OR d.id IN (SELECT dl.doc FROM document_lines dl WHERE dl.source_line IN (SELECT id FROM document_lines WHERE doc = {:s})) ORDER BY d.created', { id: '' }, { s: id })) {
      const d = util.byId(app, 'documents', r.id);
      if (d !== null && !seen[d.id]) {
        add(d);
        queue.push(d.id);
      }
    }
  }
  return out;
}

function nextStep(doc, today) {
  const t = doc.getString('type');
  const st = doc.getString('state');
  if (st === 'draft') {
    if (t === 'quote') return 'send';
    if (t === 'sales_order' || t === 'purchase_order') return 'confirm';
    return 'post';
  }
  const s = statusOf(doc, today);
  if (t === 'quote' && (s === 'sent' || s === 'expired')) return 'convert';
  if (t === 'sales_order') return s === 'to_deliver' || s === 'partly_delivered' ? 'deliver' : s === 'to_invoice' ? 'invoice' : '';
  if (t === 'purchase_order') return s === 'to_receive' || s === 'partly_received' ? 'receive' : s === 'to_bill' ? 'bill' : '';
  if (t === 'invoice' && (s === 'unpaid' || s === 'partly_paid' || s === 'overdue')) return 'pay';
  if (t === 'bill' && (s === 'unpaid' || s === 'partly_paid' || s === 'overdue')) return 'pay';
  if ((t === 'credit_note' || t === 'supplier_credit') && (s === 'open' || s === 'partly_used')) return 'apply';
  if (t === 'delivery') return 'invoice';
  if (t === 'goods_receipt') return 'bill';
  return '';
}

function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const doc = loadDoc(ctx, util.req(p, 'doc'), 'view');
  const t = doc.getString('type');
  const T = L().TYPES[t];
  const m = money();
  const base = core().currency(app);
  const cur = doc.getString('currency') || base;
  const today = util.today();
  const party = util.byId(app, 'parties', doc.getString('party'));
  const terms = util.byId(app, 'payment_terms', doc.getString('terms'));
  const wh = util.byId(app, 'warehouses', doc.getString('warehouse'));
  const project = util.byId(app, 'projects', doc.getString('project'));
  const dept = util.byId(app, 'departments', doc.getString('department'));
  const cache = {};
  const lines = linesOf(app, doc.id).map((l) => lineOut(app, l, cur, cache));
  const taxes = {};
  for (const l of lines) {
    if (l.tax === null || l.tax_amount === 0) continue;
    const k = l.tax.id;
    const s = taxes[k] || { id: k, name: l.tax.name, code: l.tax.code, rate: l.tax.rate, net: 0, amount: 0 };
    s.net += l.net;
    s.amount += l.tax_amount;
    taxes[k] = s;
  }
  const status = statusOf(doc, today);
  const auditName = (id) => (id === '' ? '' : require(`${__hooks}/lib_audit.js`).memberName(app, id, {}));
  const level = auth().best(ctx, ctx.isAgent ? ['sales', 'purchasing', 'inventory'] : t === 'delivery' ? ['sales', 'inventory'] : t === 'goods_receipt' ? ['purchasing', 'inventory'] : [T.side === 'sales' ? 'sales' : 'purchasing']);
  const canEdit = auth().rank(level) >= auth().rank('edit');
  const canFull = auth().rank(level) >= auth().rank('full');
  const st = doc.getString('state');
  const allocations = T.money ? require(`${__hooks}/lib_payments.js`).allocationsOf(app, doc) : [];
  const proposals = app.findRecordsByFilter('proposals', "target_entity = 'documents' && target_id = {:d} && status = 'waiting'", '-created', 10, 0, { d: doc.id }).map((r) => ({ id: r.id, title: r.getString('title'), op: r.getString('op'), created: r.getString('created') }));
  const journal = doc.getString('journal') !== '' ? util.byId(app, 'journals', doc.getString('journal')) : null;
  const days = doc.getString('due_date') !== '' && status === 'overdue' ? util.daysBetween(doc.getString('due_date'), today) : 0;
  const marks = app.findRecordsByFilter('field_marks', "entity = 'documents' && ref = {:d}", '', 50, 0, { d: doc.id }).map((r) => r.getString('field'));
  return {
    id: doc.id,
    type: t,
    type_label: T.label,
    side: T.side,
    number: doc.getString('number'),
    label: docLabel(doc),
    state: st,
    status: status,
    // A draft your AI agent proposed waits for a person's approval; nothing else is next.
    next: st === 'draft' && proposals.length > 0 ? 'approval' : nextStep(doc, today),
    party: party !== null ? { id: party.id, code: party.getString('code'), name: party.getString('name'), email: party.getString('email'), phone: party.getString('phone') } : null,
    attention: doc.getString('attention'),
    date: doc.getString('date'),
    due_date: doc.getString('due_date'),
    days_overdue: days,
    valid_until: doc.getString('valid_until'),
    expected_date: doc.getString('expected_date'),
    currency: cur,
    base_currency: base,
    fx_rate: m.e8Text(doc.getInt('fx_e8') || m.E8),
    prices_include_tax: doc.getBool('prices_include_tax'),
    reference: doc.getString('reference'),
    terms: terms !== null ? { id: terms.id, name: terms.getString('name'), days: terms.getInt('days') } : null,
    warehouse: wh !== null ? { id: wh.id, code: wh.getString('code'), name: wh.getString('name') } : null,
    project: project !== null ? { id: project.id, code: project.getString('code'), name: project.getString('name') } : null,
    department: dept !== null ? { id: dept.id, name: dept.getString('name') } : null,
    moves_stock: doc.getBool('moves_stock'),
    subtotal: doc.getInt('subtotal'),
    discount: doc.getInt('discount'),
    tax: doc.getInt('tax'),
    total: doc.getInt('total'),
    total_base: doc.getInt('total_base'),
    paid: doc.getInt('paid'),
    balance: doc.getInt('balance'),
    total_text: m.minorText(doc.getInt('total'), cur),
    balance_text: m.minorText(doc.getInt('balance'), cur),
    fulfil_status: doc.getString('fulfil_status'),
    bill_status: doc.getString('bill_status'),
    notes: doc.getString('notes'),
    internal_note: doc.getString('internal_note'),
    agent_note: doc.getString('agent_note'),
    billing_address: doc.getString('billing_address'),
    shipping_address: doc.getString('shipping_address'),
    prepared_actor: doc.getString('prepared_actor'),
    prepared_by: doc.getString('prepared_actor') === 'agent' ? 'Your AI agent' : auditName(doc.getString('prepared_by')),
    posted_by: auditName(doc.getString('posted_by')),
    posted_at: doc.getString('posted_at'),
    voided_by: auditName(doc.getString('voided_by')),
    voided_at: doc.getString('voided_at'),
    void_reason: doc.getString('void_reason'),
    sent_at: doc.getString('sent_at'),
    created: doc.getString('created'),
    updated: doc.getString('updated'),
    lines: lines,
    taxes: Object.keys(taxes).map((k) => taxes[k]),
    flow: flowOf(app, doc),
    allocations: allocations,
    journal: journal !== null ? { id: journal.id, number: journal.getString('number') } : null,
    proposals: proposals,
    agent_fields: marks,
    can: {
      edit: canEdit && editable(doc),
      post: canFull && T.posts && st === 'draft',
      propose: ctx.isAgent && T.posts && st === 'draft' && proposals.length === 0,
      confirm: canEdit && st === 'draft' && !T.posts,
      void: canFull && st === 'posted',
      convert: (L().CONVERT[t] || []).filter((x) => auth().rank(auth().best(ctx, x === 'delivery' ? ['sales', 'inventory'] : x === 'goods_receipt' ? ['purchasing', 'inventory'] : [L().TYPES[x].side === 'sales' ? 'sales' : 'purchasing'])) >= 2),
      delete: canEdit && (st === 'draft' || st === 'cancelled' || st === 'declined'),
      pay: T.money && st === 'posted' && doc.getInt('balance') > 0 && (t === 'invoice' || t === 'bill'),
      cancel: canEdit && (t === 'quote' || t === 'sales_order' || t === 'purchase_order') && (st === 'draft' || st === 'open'),
    },
  };
}

/* ================================================================== list */

const STATUS_SQL = {
  draft: "d.state = 'draft'",
  open: "d.state IN ('open', 'posted')",
  posted: "d.state = 'posted'",
  void: "d.state = 'void'",
  cancelled: "d.state = 'cancelled'",
  unpaid: "d.state = 'posted' AND d.balance > 0",
  overdue: "d.state = 'posted' AND d.balance > 0 AND d.due_date != '' AND d.due_date < {:today}",
  partly_paid: "d.state = 'posted' AND d.balance > 0 AND d.balance < d.total",
  paid: "d.state = 'posted' AND d.balance <= 0 AND d.total > 0",
  sent: "d.state = 'open' AND (d.valid_until = '' OR d.valid_until >= {:today})",
  expired: "d.state = 'open' AND d.valid_until != '' AND d.valid_until < {:today}",
  accepted: "d.state = 'accepted'",
  declined: "d.state = 'declined'",
  to_fulfil: "d.state = 'open' AND d.fulfil_status != 'full'",
  to_bill: "d.state = 'open' AND d.bill_status != 'full'",
  done: "d.state = 'closed'",
  credit_open: "d.state = 'posted' AND d.balance > 0",
};

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const typeName = util.oneOf(p, 'type', L().TYPE_NAMES, '');
  if (typeName === '') throw util.fail(400, 'type is required: ' + L().TYPE_NAMES.join(', '), 'missing_param');
  auth().needDoc(ctx, typeName, 'view');
  const pg = util.page(p, 50, 500);
  const today = util.today();
  const where = ['d.type = {:type}'];
  const bind = { type: typeName, today: today };
  const status = util.str(p, 'status', '');
  if (status !== '') {
    const sql = STATUS_SQL[status];
    if (sql === undefined) throw util.fail(400, 'status must be one of: ' + Object.keys(STATUS_SQL).join(', '), 'invalid_param');
    where.push(sql);
  }
  const partyRef = util.str(p, 'party', '');
  if (partyRef !== '') {
    where.push('d.party = {:party}');
    bind.party = core().resolve(app, 'parties', partyRef).id;
  }
  const projectRef = util.str(p, 'project', '');
  if (projectRef !== '') {
    where.push('d.project = {:project}');
    bind.project = core().resolve(app, 'projects', projectRef).id;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('d.date >= {:from}');
    bind.from = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('d.date <= {:to}');
    bind.to = to;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(d.number LIKE {:q} ESCAPE '\\' OR d.reference LIKE {:q} ESCAPE '\\' OR pa.name LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const mine = util.bool(p, 'agent', false);
  if (mine) where.push("d.prepared_actor = 'agent'");
  const sorts = { date: 'd.date', number: 'd.number', total: 'd.total_base', due: 'd.due_date', party: 'pa.name', created: 'd.created' };
  const sortKey = util.oneOf(p, 'sort', Object.keys(sorts), 'date');
  const desc = util.bool(p, 'desc', sortKey === 'date' || sortKey === 'created' || sortKey === 'total');
  const from_ = ' FROM documents d LEFT JOIN parties pa ON pa.id = d.party WHERE ' + where.join(' AND ');
  const totals = util.one(app, 'SELECT COUNT(d.id) AS n, IFNULL(SUM(d.total_base), 0) AS total, IFNULL(SUM(CASE WHEN d.state = \'posted\' THEN d.balance * 1.0 * d.fx_e8 / 100000000 ELSE 0 END), 0) AS open' + from_, { n: 0, total: 0, open: -0 }, bind);
  const rows = util.rows(
    app,
    'SELECT d.id AS id, d.type AS type, d.number AS number, d.state AS state, d.date AS date, d.due_date AS due_date, d.valid_until AS valid_until, d.currency AS currency, d.total AS total, d.total_base AS total_base, d.balance AS balance, d.paid AS paid, d.reference AS reference, d.lines_count AS lines_count, d.prepared_actor AS prepared_actor, d.fulfil_status AS fulfil_status, d.bill_status AS bill_status, d.expected_date AS expected_date, IFNULL(pa.id, \'\') AS party_id, IFNULL(pa.name, \'\') AS party_name' +
      from_ +
      ' ORDER BY ' + sorts[sortKey] + (desc ? ' DESC' : ' ASC') + ', d.created DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset,
    { id: '', type: '', number: '', state: '', date: '', due_date: '', valid_until: '', currency: '', total: 0, total_base: 0, balance: 0, paid: 0, reference: '', lines_count: 0, prepared_actor: '', fulfil_status: '', bill_status: '', expected_date: '', party_id: '', party_name: '' },
    bind,
  );
  const docs = rows.map((r) => {
    const fake = { getString: (k) => r[k] === undefined ? '' : String(r[k]), getInt: (k) => Number(r[k] || 0) };
    const status2 = statusOf(fake, today);
    return {
      id: r.id,
      type: r.type,
      number: r.number,
      state: r.state,
      status: status2,
      date: r.date,
      due_date: r.due_date,
      expected_date: r.expected_date,
      valid_until: r.valid_until,
      days_overdue: status2 === 'overdue' ? util.daysBetween(r.due_date, today) : 0,
      currency: r.currency,
      total: r.total,
      total_base: r.total_base,
      balance: r.balance,
      paid: r.paid,
      reference: r.reference,
      lines_count: r.lines_count,
      prepared_actor: r.prepared_actor,
      fulfil_status: r.fulfil_status,
      bill_status: r.bill_status,
      party: { id: r.party_id, name: r.party_name },
    };
  });
  // Counts per status, for the filter chips.
  const counts = {};
  const keys = L().TYPES[typeName].money
    ? typeName === 'credit_note' || typeName === 'supplier_credit'
      ? ['draft', 'credit_open', 'void']
      : ['draft', 'unpaid', 'overdue', 'paid', 'void']
    : typeName === 'quote'
      ? ['draft', 'sent', 'expired', 'accepted', 'declined']
      : typeName === 'sales_order' || typeName === 'purchase_order'
        ? ['draft', 'to_fulfil', 'to_bill', 'done', 'cancelled']
        : ['draft', 'posted', 'void'];
  for (const k of keys) {
    counts[k] = util.one(app, 'SELECT COUNT(d.id) AS n FROM documents d WHERE d.type = {:type} AND ' + STATUS_SQL[k], { n: 0 }, { type: typeName, today: today }).n;
  }
  counts.all = util.one(app, 'SELECT COUNT(id) AS n FROM documents WHERE type = {:type}', { n: 0 }, { type: typeName }).n;
  return { docs: docs, total: totals.n, total_base: totals.total, open_base: Math.round(totals.open), counts: counts, currency: core().currency(app) };
}

/* ================================================================== text */

/** The document as plain text (for an email body or a message). */
function text(ctx, p) {
  const util = u();
  const d = get(ctx, p);
  const s = core().settings(ctx.app);
  const m = money();
  const cur = d.currency;
  const lines = [];
  lines.push(d.type_label + ' ' + (d.number || '(draft)'));
  lines.push(s.getString('company_name'));
  lines.push('');
  lines.push((d.side === 'sales' ? 'To: ' : 'Supplier: ') + (d.party ? d.party.name : ''));
  if (d.reference !== '') lines.push('Reference: ' + d.reference);
  lines.push('Date: ' + d.date + (d.due_date !== '' ? '   Due: ' + d.due_date : '') + (d.valid_until !== '' ? '   Valid until: ' + d.valid_until : ''));
  lines.push('');
  for (const l of d.lines) {
    const amount = d.type === 'delivery' || d.type === 'goods_receipt' ? '' : '  ' + m.fmt(l.net + (d.prices_include_tax ? l.tax_amount : 0), cur);
    lines.push('- ' + l.description + ' x ' + util.fmtQty(l.qty) + (l.unit !== '' ? ' ' + l.unit : '') + (d.type === 'delivery' || d.type === 'goods_receipt' ? '' : ' @ ' + l.unit_price) + (l.discount_bp > 0 ? ' less ' + l.discount + '%' : '') + amount);
  }
  if (d.type !== 'delivery' && d.type !== 'goods_receipt') {
    lines.push('');
    lines.push('Subtotal: ' + m.fmt(d.subtotal, cur));
    for (const t of d.taxes) lines.push(t.name + ': ' + m.fmt(t.amount, cur));
    lines.push('Total: ' + m.fmt(d.total, cur));
    if (d.state === 'posted' && (d.type === 'invoice' || d.type === 'bill') && d.balance !== d.total) lines.push('Amount due: ' + m.fmt(d.balance, cur));
  }
  if (d.notes !== '') {
    lines.push('');
    lines.push(d.notes);
  }
  if (d.side === 'sales' && s.getString('invoice_footer') !== '' && (d.type === 'invoice' || d.type === 'quote')) {
    lines.push('');
    lines.push(s.getString('invoice_footer'));
  }
  const party = d.party !== null ? util.byId(ctx.app, 'parties', d.party.id) : null;
  return {
    number: d.number,
    to: party !== null ? party.getString('email') : '',
    subject: d.type_label + ' ' + (d.number || '') + ' from ' + s.getString('company_name'),
    text: lines.join('\n'),
  };
}

module.exports = {
  statusOf: statusOf,
  docLabel: docLabel,
  linesOf: linesOf,
  syncOrder: syncOrder,
  list: list,
  get: get,
  create: create,
  update: update,
  setLines: setLines,
  addLine: addLine,
  updateLine: updateLine,
  removeLine: removeLine,
  previewPost: previewPost,
  post: post,
  confirm: confirm,
  markSent: markSent,
  accept: accept,
  decline: decline,
  cancel: cancel,
  close: close,
  reopen: reopen,
  previewVoid: previewVoid,
  voidDoc: voidDoc,
  convert: convert,
  remove: remove,
  duplicate: duplicate,
  text: text,
  loadDoc: loadDoc,
};
