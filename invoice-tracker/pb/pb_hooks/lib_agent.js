/// <reference path="../pb_data/types.d.ts" />
/**
 * Agent operations for the Invoice & Subscription Tracker: the logic.
 *
 * Routes live in agent_ops.pb.js. Require this file INSIDE each handler:
 * PocketBase JSVM handlers run in isolated VMs and cannot see file scope.
 *
 * Every operation does exactly what the app's own screens do, and reads/writes
 * the same collections, fields and formats. The source of each rule is cited
 * under frontend/src/app/; the shared figures (calendar, month and year models,
 * currency rule for totals) are services/reports.ts. Nothing here changes how
 * the app looks or behaves for people.
 */

/* ------------------------------------------------------------------ constants
 * Copied from the frontend, which cannot be imported here. Keep in sync. */

// types.ts:15-34 — [code, symbol]
var CURRENCIES = [
  ['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['PKR', 'Rs'], ['KRW', '₩'], ['JPY', '¥'],
  ['INR', '₹'], ['CAD', 'CA$'], ['AUD', 'A$'], ['AED', 'AED'], ['BRL', 'R$'], ['CHF', 'Fr'],
  ['CNY', '¥'], ['NZD', 'NZ$'], ['SAR', 'SAR'], ['SEK', 'kr'], ['SGD', 'S$'], ['TRY', '₺'],
];

// types.ts:44-56
var CATEGORIES = [
  'Cloud Infrastructure',
  'Software & SaaS',
  'Developer Tools & DevOps',
  'Productivity & AI',
  'Design & Creative',
  'Marketing & Growth',
  'Security & Compliance',
  'Communications & Collaboration',
  'Finance & Operations',
  'Customer Support',
  'Other Services',
];

// components/GroupManageModal.tsx:37-44
var COLOR_PRESETS = ['#FF9900', '#00A67E', '#635BFF', '#3B82F6', '#8B5CF6', '#EF4444'];

// components/AddInvoiceModal.tsx:49-56 — vendor guessed from a picked PDF's name
var VENDOR_HINTS = [
  [/aws|amazon/i, 'Amazon Web Services'],
  [/openai/i, 'OpenAI'],
  [/cursor/i, 'Cursor AI'],
  [/figma/i, 'Figma'],
  [/vercel/i, 'Vercel'],
  [/stripe/i, 'Stripe'],
  [/google/i, 'Google Workspace'],
];

// The screens' calendar follows today's date (services/reports.ts): the month
// window ends at the current month; Multi-Year History covers this year and
// the three before it.
function calendar() {
  var now = new Date();
  var y = now.getFullYear();
  return { year: y, monthIndex: now.getMonth(), years: [y, y - 1, y - 2, y - 3] };
}

var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* -------------------------------------------------------------------- plumbing */

function fail(status, message) {
  var err = new Error(message);
  err.status = status;
  return err;
}

function errText(err) {
  return String((err && err.message) || err);
}

/** Run fn(params, app, e) and answer JSON. Query and body are merged (GET
 *  reads take the query, POST writes the body). Errors are RETURNED with
 *  e.json(status, …) so their status code survives. */
function handle(e, fn) {
  try {
    var params = {};
    var info = e.requestInfo();
    var query = info.query || {};
    Object.keys(query).forEach(function (k) {
      params[k] = query[k];
    });
    var body = info.body || {};
    Object.keys(body).forEach(function (k) {
      params[k] = body[k];
    });
    var out = fn(params, e.app, e);
    return e.json(200, out === undefined ? { success: true } : out);
  } catch (err) {
    var status = err && typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) console.error('[invoice-tracker] agent operation failed: ' + errText(err));
    return e.json(status, { status: status, message: errText(err) });
  }
}

function given(p, k) {
  return p[k] !== undefined && p[k] !== null;
}

function str(p, k) {
  var v = p[k];
  if (Array.isArray(v)) v = v[0];
  if (v === undefined || v === null) return '';
  return String(v);
}

function r2(x) {
  return Math.round(x * 100) / 100;
}

function fixed1(x) {
  return Number(x.toFixed(1));
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/** PocketBase autodate strings ("2026-08-15 12:00:00.000Z") are parsed by the
 *  browser but not reliably by the JSVM; normalise to ISO before parsing. */
function toDate(s) {
  var t = String(s || '');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:/.test(t)) t = t.replace(' ', 'T');
  return new Date(t);
}

function monthKey(year, monthNum) {
  return year + '-' + pad2(monthNum);
}

/** Totals add only amounts in the shown workspace's currency; the app has no
 *  exchange rates, so every other currency is grouped apart and never added in
 *  (services/reports.ts splitByCurrency). */
function splitByCurrency(rows, currency) {
  var code = String(currency || 'USD').toUpperCase();
  var counted = [];
  var total = 0;
  var map = {};
  rows.forEach(function (r) {
    var c = String(r.currency || 'USD').toUpperCase();
    var amt = Number(r.amount) || 0;
    if (c === code) {
      counted.push(r);
      total += amt;
      return;
    }
    if (!map[c]) map[c] = { currency: c, total: 0, count: 0 };
    map[c].total += amt;
    map[c].count += 1;
  });
  var others = Object.keys(map)
    .sort()
    .map(function (c) {
      return { currency: c, total: r2(map[c].total), count: map[c].count };
    });
  return { counted: counted, total: total, others: others };
}

var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 text (optionally a data: URL) -> byte array, or null if it is not base64. */
function base64Bytes(text) {
  var s = String(text || '')
    .replace(/^data:[^,]*,/, '')
    .replace(/[\s=]/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  if (s === '' || !/^[A-Za-z0-9+/]+$/.test(s) || s.length % 4 === 1) return null;
  var out = [];
  var buf = 0;
  var bits = 0;
  for (var i = 0; i < s.length; i++) {
    buf = (buf << 6) | B64.indexOf(s.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
      buf &= (1 << bits) - 1;
    }
  }
  return out;
}

function isoLocalDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function isoLocalDateTime(d) {
  return isoLocalDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function save(app, rec) {
  try {
    app.save(rec);
  } catch (err) {
    throw fail(400, 'Not saved: ' + errText(err));
  }
}

function mustFind(app, collection, id, label) {
  if (!id) throw fail(400, label + ' is required (a record id)');
  try {
    return app.findRecordById(collection, id);
  } catch (err) {
    throw fail(404, 'No ' + label + ' with id "' + id + '"');
  }
}

/** Parameters the app's form never offers: refuse them instead of silently
 *  dropping them, so an agent cannot report something the app did not store. */
function refuse(p, keys, why) {
  for (var i = 0; i < keys.length; i++) {
    if (given(p, keys[i])) throw fail(400, why);
  }
}

/* ------------------------------------------------------------ enumerations */

function currencyCodes() {
  return CURRENCIES.map(function (c) {
    return c[0];
  });
}

/** types.ts:36-42 */
function symbolOf(code) {
  if (!code) return '$';
  var up = String(code).toUpperCase();
  for (var i = 0; i < CURRENCIES.length; i++) {
    if (CURRENCIES[i][0] === up) return CURRENCIES[i][1];
  }
  return code;
}

function pickCurrency(p, dflt) {
  var v = str(p, 'currency').trim();
  if (v === '') return dflt;
  var up = v.toUpperCase();
  if (currencyCodes().indexOf(up) >= 0) return up;
  throw fail(400, 'currency must be one of: ' + currencyCodes().join(', '));
}

function pickCategory(p) {
  var v = str(p, 'category').trim();
  if (v === '') return 'Software & SaaS';
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].toLowerCase() === v.toLowerCase()) return CATEGORIES[i];
  }
  throw fail(400, 'category must be one of: ' + CATEGORIES.join(' | '));
}

function pickColor(p, dflt) {
  var v = str(p, 'color').trim();
  if (v === '') return dflt;
  if (v.charAt(0) !== '#') v = '#' + v;
  var up = v.toUpperCase();
  if (COLOR_PRESETS.indexOf(up) >= 0) return up;
  throw fail(400, 'color must be one of the presets: ' + COLOR_PRESETS.join(', '));
}

/* ------------------------------------------------------- workspace (scope) */

function groupsNewestFirst(app) {
  return Array.from(app.findRecordsByFilter('groups', 'id != ""', '-created', 0, 0));
}

function findGroup(groups, raw) {
  for (var i = 0; i < groups.length; i++) {
    if (groups[i].id === raw) return groups[i];
  }
  var hits = groups.filter(function (g) {
    return g.getString('name') === raw;
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw fail(400, 'More than one workspace is named "' + raw + '" (' + hits.map(function (g) {
      return g.id;
    }).join(', ') + '); pass the id.');
  }
  throw fail(404, 'No workspace with id or name "' + raw + '". Workspaces: ' + groups.map(function (g) {
    return g.getString('name') + ' (' + g.id + ')';
  }).join(', '));
}

/**
 * The workspace a screen shows. Default: the one the app opens on, i.e. the
 * newest group (ApiService.ts:26, AppController.ts:84-87). "all" = All
 * Workspaces (no filter). Amounts are labelled with the shown workspace's
 * currency symbol, or the newest group's under All Workspaces (MainView.tsx:318-320).
 */
function scope(app, p) {
  var groups = groupsNewestFirst(app);
  var raw = str(p, 'group').trim();
  var target = null;
  if (raw === '') {
    target = groups.length ? groups[0] : null;
  } else if (raw.toLowerCase() !== 'all' && raw.toLowerCase() !== 'all workspaces') {
    target = findGroup(groups, raw);
  }
  var shown = target || (groups.length ? groups[0] : null);
  var currency = shown ? shown.getString('currency') || 'USD' : 'USD';
  return {
    id: target ? target.id : null,
    name: target ? target.getString('name') : 'All Workspaces',
    currency: currency,
    currency_symbol: symbolOf(currency),
  };
}

/** Same filter the screens use: group_id = "<id>", or none (ApiService.ts:97,261,412). */
function load(app, collection, sc) {
  var rows = sc.id
    ? app.findRecordsByFilter(collection, 'group_id = {:g}', '-created', 0, 0, { g: sc.id })
    : app.findRecordsByFilter(collection, 'id != ""', '-created', 0, 0);
  return Array.from(rows);
}

/* ------------------------------------------------- normalised record views */

/** ApiService.fetchInvoices. A PDF is attached only when its file is stored
 *  (`pdf_file`); Download PDF serves it at pdf_url (records.pb.js). */
function normInvoice(r) {
  var vendor = r.getString('vendor');
  var created = r.getString('created');
  var pdfFile = r.getString('pdf_file');
  return {
    id: r.id,
    vendor: vendor,
    amount: Number(r.getFloat('amount')) || 0,
    currency: r.getString('currency') || 'USD',
    payment_type: r.getString('payment_type') || 'one_time',
    billing_frequency: r.getString('billing_frequency') || 'none',
    category: r.getString('category') || 'Software & SaaS',
    purpose: r.getString('purpose') || '',
    invoice_date: r.getString('invoice_date') || created,
    invoice_number: r.getString('invoice_number') || 'INV-' + r.id,
    group_id: r.getString('group_id'),
    has_pdf_attachment: pdfFile !== '',
    pdf_url: pdfFile !== '' ? '/api/invoices/' + r.id + '/download-pdf' : '',
    pdf_filename: r.getString('pdf_filename') || vendor + '_Invoice.pdf',
    pdf_text_preview: r.getString('pdf_text_preview') || '',
    notes: r.getString('notes') || '',
    subscription_id: r.getString('subscription_id'),
    confidence_score: Number(r.getFloat('confidence_score')) || 0.99,
    is_verified: r.getBool('is_verified'),
    created: created,
    updated: r.getString('updated'),
  };
}

/** ApiService.ts:103-120 */
function normSub(r) {
  var created = r.getString('created');
  return {
    id: r.id,
    name: r.getString('name') || r.getString('vendor'),
    vendor: r.getString('vendor') || r.getString('name'),
    amount: Number(r.getFloat('amount')) || 0,
    currency: r.getString('currency') || 'USD',
    billing_frequency: r.getString('billing_frequency') || 'monthly',
    category: r.getString('category') || 'Software & SaaS',
    purpose: r.getString('purpose') || '',
    status: r.getString('status') || 'active',
    group_id: r.getString('group_id'),
    last_billed_date: r.getString('last_billed_date') || created,
    next_renewal_date: r.getString('next_renewal_date'),
    auto_renew: r.getBool('auto_renew'),
    icon_name: r.getString('icon_name') || 'CreditCard',
    created: created,
    updated: r.getString('updated'),
  };
}

/** ApiService.ts:419-429 */
function normActivity(r) {
  return {
    id: r.id,
    event_type: r.getString('event_type'),
    title: r.getString('title'),
    description: r.getString('description'),
    amount: Number(r.getFloat('amount')) || 0,
    currency: r.getString('currency') || 'USD',
    vendor: r.getString('vendor'),
    group_id: r.getString('group_id'),
    created: r.getString('created'),
  };
}

function groupView(r) {
  return {
    id: r.id,
    name: r.getString('name'),
    description: r.getString('description'),
    color: r.getString('color'),
    icon: r.getString('icon'),
    currency: r.getString('currency'),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

function ledgerRow(i) {
  return {
    id: i.id,
    vendor: i.vendor,
    purpose: i.purpose,
    invoice_date: i.invoice_date,
    category: i.category,
    amount: i.amount,
    currency: i.currency,
    payment_type: i.payment_type,
    billing_frequency: i.billing_frequency,
    invoice_number: i.invoice_number,
    has_pdf_attachment: i.has_pdf_attachment,
    pdf_filename: i.pdf_filename,
    pdf_url: i.pdf_url,
    subscription_id: i.subscription_id,
    group_id: i.group_id,
    created: i.created,
  };
}

function reportRow(i) {
  return {
    id: i.id,
    date: i.invoice_date,
    vendor: i.vendor,
    purpose: i.purpose,
    category: i.category,
    invoice_number: i.invoice_number,
    amount: i.amount,
    currency: i.currency,
    payment_type: i.payment_type,
    estimated: !!i.estimated,
  };
}

/* ------------------------------------------------------- shared formulas */

function isActive(s) {
  return (s.status || 'active').toLowerCase() === 'active';
}

function freqOf(s) {
  return (s.billing_frequency || 'monthly').toLowerCase();
}

/** Monthly equivalent (ApiService.ts:484-490, DashboardView.tsx:63-69, SubscriptionsView.tsx:35-41). */
function monthlyEq(s) {
  var f = freqOf(s);
  if (f === 'yearly') return s.amount / 12.0;
  if (f === 'weekly') return s.amount * 4.33;
  if (f === 'quarterly') return s.amount / 3.0;
  return s.amount;
}

/** "Spent up to now" with elapsedMonths fixed at 1 (ApiService.ts:503-508, DashboardView.tsx:84-89). */
function spentOnce(s) {
  var f = freqOf(s);
  if (f === 'yearly') return s.amount;
  if (f === 'weekly') return s.amount * 4.33;
  if (f === 'quarterly') return s.amount;
  return s.amount;
}

/** An invoice already covers a subscription (ApiService.ts:497-500). */
function covers(inv, s) {
  return (
    (!!inv.subscription_id && String(inv.subscription_id) === String(s.id)) ||
    ((inv.vendor || '').toLowerCase() === (s.vendor || s.name || '').toLowerCase() && inv.payment_type === 'subscription')
  );
}

function searchHit(q, values) {
  if (!q) return true;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i] === undefined || values[i] === null ? '' : values[i]).toLowerCase().indexOf(q) >= 0) return true;
  }
  return false;
}

/** Ledger / monthly / yearly search keys (InvoicesLedgerView.tsx:77-91). */
function invoiceHit(i, q) {
  return searchHit(q, [i.vendor, i.purpose, i.invoice_number, i.category, String(i.amount), i.currency]);
}

function queryOf(p) {
  return str(p, 'q').trim().toLowerCase();
}

function categoryFilter(p) {
  var c = str(p, 'category').trim();
  return c === '' ? 'all' : c;
}

/* ================================================================ READS === */

/** dashboard.overview — DashboardView.tsx + ApiService.computeDashboardStatsFromData,
 *  with services/reports.ts dashboardTotals and spendSummaryBars. Totals are in
 *  the workspace's currency; other currencies are listed in other_currencies. */
function dashboardOverview(app, p) {
  var sc = scope(app, p);
  var invs = load(app, 'invoices', sc).map(normInvoice);
  var subs = load(app, 'subscriptions', sc).map(normSub);
  var acts = load(app, 'activities', sc).map(normActivity);
  var active = subs.filter(isActive);

  var burn = splitByCurrency(
    active.map(function (s) {
      return { amount: monthlyEq(s), currency: s.currency };
    }),
    sc.currency,
  );
  var effectiveBurn = r2(burn.total > 0 ? burn.total : 0);

  // Total Money Spent: every invoice, plus each uncovered active subscription once.
  var spentRows = invs.map(function (i) {
    return { amount: Number(i.amount) || 0, currency: i.currency };
  });
  active.forEach(function (s) {
    var hasInv = invs.some(function (i) {
      return covers(i, s);
    });
    if (!hasInv) spentRows.push({ amount: spentOnce(s), currency: s.currency });
  });
  var spent = splitByCurrency(spentRows, sc.currency);

  // Spend Summary: the six months up to the current one, each the Monthly Costs
  // month split by vendor; Spend by Service & Vendor is the current month's bar.
  var bars = spendSummaryBars(monthModel(invs, subs, sc.currency));
  var current = bars[bars.length - 1];
  var shown = current.segments.filter(function (s) {
    return s.amount > 0;
  });
  var tableTotal =
    shown.reduce(function (sum, s) {
      return sum + s.amount;
    }, 0) || current.total;

  return {
    workspace: sc,
    total_spent: r2(spent.total),
    monthly_burn: effectiveBurn,
    annual_run_rate: r2(effectiveBurn * 12),
    active_subscriptions: active.length,
    invoices: invs.length,
    month_to_date: { month: current.label, total: current.total },
    spend_summary: bars.map(function (b) {
      return { month: b.label, short: b.short, total: b.total };
    }),
    spend_by_service: shown.map(function (s) {
      return { service: s.service, amount: s.amount, percent: tableTotal > 0 ? fixed1((s.amount / tableTotal) * 100) : 0 };
    }),
    other_currencies: spent.others,
    feed: { count: acts.length, latest: acts.slice(0, 3) },
  };
}

/** subscriptions.list — SubscriptionsView.tsx (filters, burn, run rate). */
function subscriptionsList(app, p) {
  var sc = scope(app, p);
  var subs = load(app, 'subscriptions', sc).map(normSub);
  var status = (str(p, 'status').trim() || 'all').toLowerCase();
  if (['all', 'active', 'paused', 'cancelled'].indexOf(status) < 0) {
    throw fail(400, 'status must be one of: all, active, paused, cancelled');
  }
  var category = categoryFilter(p);
  var q = queryOf(p);

  var active = subs.filter(function (s) {
    return s.status === 'active';
  });
  var burn = splitByCurrency(
    active.map(function (s) {
      return { amount: monthlyEq(s), currency: s.currency };
    }),
    sc.currency,
  );

  var rows = subs.filter(function (s) {
    if (category !== 'all' && s.category !== category) return false;
    if (status !== 'all' && s.status !== status) return false;
    return searchHit(q, [s.name, s.vendor, s.purpose, s.category, s.billing_frequency, String(s.amount)]);
  });

  return {
    workspace: sc,
    monthly_burn: r2(burn.total),
    annual_run_rate: Math.round(burn.total * 12),
    other_currencies: burn.others,
    active_count: active.length,
    count: rows.length,
    subscriptions: rows.map(function (s) {
      var per = s.billing_frequency === 'monthly' ? 'mo' : s.billing_frequency === 'yearly' ? 'yr' : s.billing_frequency;
      return Object.assign({}, s, { per: per });
    }),
  };
}

/** invoices.list — InvoicesLedgerView.tsx (category, payment type and search filters, total). */
function invoicesList(app, p) {
  var sc = scope(app, p);
  var invs = load(app, 'invoices', sc).map(normInvoice);
  var category = categoryFilter(p);
  var paymentType = (str(p, 'payment_type').trim() || 'all').toLowerCase();
  if (['all', 'one_time', 'subscription'].indexOf(paymentType) < 0) {
    throw fail(400, 'payment_type must be one of: all, one_time, subscription');
  }
  var q = queryOf(p);
  var rows = invs.filter(function (i) {
    if (category !== 'all' && i.category !== category) return false;
    if (paymentType !== 'all' && i.payment_type !== paymentType) return false;
    return invoiceHit(i, q);
  });
  var totals = splitByCurrency(rows, sc.currency);
  return {
    workspace: sc,
    count: rows.length,
    total: Number(totals.total.toFixed(2)),
    other_currencies: totals.others,
    invoices: rows.map(ledgerRow),
  };
}

/** invoices.get — the inspector (InvoiceDetailModal.tsx). */
function invoicesGet(app, p) {
  var sc = scope(app, p);
  var i = normInvoice(mustFind(app, 'invoices', str(p, 'invoice').trim(), 'invoice'));
  var ref = i.invoice_number || 'INV-' + i.id;
  var preview =
    i.pdf_text_preview ||
    '--- PDF Extracted Text ---\nVendor: ' + i.vendor + '\nAmount: ' + symbolOf(i.currency) + i.amount.toFixed(2) +
      '\nDate: ' + i.invoice_date + '\nReference: ' + ref + '\nStatus: Verified';
  return {
    workspace: sc,
    invoice: {
      id: i.id,
      title: 'Invoice #' + ref,
      vendor: i.vendor,
      purpose: i.purpose || 'Classified commercial expense',
      amount: i.amount,
      currency: i.currency,
      invoice_date: i.invoice_date,
      category: i.category,
      reference: ref,
      verified: i.is_verified,
      confidence_pct: Math.round((i.confidence_score || 0.95) * 100),
      pdf_attached: i.has_pdf_attachment,
      pdf_filename: i.pdf_filename,
      pdf_url: i.pdf_url,
      pdf_text_preview: preview,
      payment_type: i.payment_type,
      billing_frequency: i.billing_frequency,
      subscription_id: i.subscription_id,
      group_id: i.group_id,
      created: i.created,
    },
  };
}

/** The month a subscription started (its creation), or the current month. */
function startOf(sub, cal) {
  if (sub.created) {
    var sd = toDate(sub.created);
    if (!isNaN(sd.getTime())) return { year: sd.getFullYear(), month: sd.getMonth() + 1 };
  }
  return { year: cal.year, month: cal.monthIndex + 1 };
}

/** The Monthly Costs month list (services/reports.ts buildMonths): the six months
 *  up to the current one plus every month that has an invoice, newest first. */
function monthModel(invs, subs, currency) {
  var cal = calendar();
  var currentKey = monthKey(cal.year, cal.monthIndex + 1);
  var map = {};
  var keys = [];
  function ensure(k) {
    if (!Object.prototype.hasOwnProperty.call(map, k)) {
      map[k] = [];
      keys.push(k);
    }
  }
  for (var b = 5; b >= 0; b--) {
    var d = new Date(cal.year, cal.monthIndex - b, 1);
    ensure(monthKey(d.getFullYear(), d.getMonth() + 1));
  }
  invs.forEach(function (inv) {
    var key = currentKey;
    if (inv.invoice_date) {
      var dt = toDate(inv.invoice_date);
      if (!isNaN(dt.getTime())) key = monthKey(dt.getFullYear(), dt.getMonth() + 1);
    }
    ensure(key);
    map[key].push(inv);
  });

  var active = subs.filter(isActive);
  var sorted = keys.slice().sort();
  sorted.reverse();

  // Each month also gets an estimated row per active subscription that has
  // started and is not already covered — checked against the GROWING list.
  sorted.forEach(function (key, kIdx) {
    var monthInvs = map[key];
    var parts = key.split('-');
    var ty = parseInt(parts[0], 10);
    var tm = parseInt(parts[1], 10);
    active.forEach(function (sub) {
      var start = startOf(sub, cal);
      if (!(ty > start.year || (ty === start.year && tm >= start.month))) return;
      var hasExisting = monthInvs.some(function (inv) {
        return covers(inv, sub);
      });
      if (hasExisting) return;
      var freq = sub.billing_frequency || 'monthly';
      monthInvs.push({
        id: 'SUB-' + sub.id + '-' + kIdx,
        vendor: sub.vendor || sub.name,
        amount: r2(monthlyEq(sub)),
        currency: sub.currency || 'USD',
        payment_type: 'subscription',
        billing_frequency: freq,
        category: sub.category || 'Software & SaaS',
        purpose: sub.purpose || sub.name + ' (' + freq + ' subscription)',
        invoice_number: 'SUB-' + sub.id + '-' + key.replace('-', ''),
        invoice_date: key + '-01T00:00:00.000Z',
        subscription_id: sub.id,
        has_pdf_attachment: false,
        estimated: true,
      });
    });
  });

  var sum = function (list) {
    return list.reduce(function (s, inv) {
      return s + (Number(inv.amount) || 0);
    }, 0);
  };
  return sorted.map(function (key) {
    var parts = key.split('-');
    var y = parseInt(parts[0], 10);
    var mNum = parseInt(parts[1], 10);
    var idx = Math.max(0, Math.min(11, mNum - 1));
    var items = map[key];
    var split = splitByCurrency(items, currency);
    return {
      key: key,
      label: MONTH_NAMES[idx] + ' ' + y,
      short: SHORT_MONTHS[idx],
      items: items,
      counted: split.counted,
      total: r2(split.total),
      recurring: r2(sum(split.counted.filter(function (i) {
        return i.payment_type === 'subscription';
      }))),
      one_time: r2(sum(split.counted.filter(function (i) {
        return i.payment_type !== 'subscription';
      }))),
      transactions: items.length,
      others: split.others,
    };
  });
}

/** Spend Summary bars (services/reports.ts spendSummaryBars): the six months up
 *  to the current one, oldest first, each split by vendor. */
function spendSummaryBars(months) {
  var cal = calendar();
  var bars = [];
  for (var b = 5; b >= 0; b--) {
    var d = new Date(cal.year, cal.monthIndex - b, 1);
    var key = monthKey(d.getFullYear(), d.getMonth() + 1);
    var m = null;
    for (var i = 0; i < months.length; i++) if (months[i].key === key) m = months[i];
    if (!m) continue;
    var vendorMap = {};
    var order = [];
    m.counted.forEach(function (inv) {
      var v = inv.vendor || 'Other Services';
      if (!Object.prototype.hasOwnProperty.call(vendorMap, v)) {
        vendorMap[v] = 0;
        order.push(v);
      }
      vendorMap[v] += Number(inv.amount) || 0;
    });
    var segments = order
      .map(function (v) {
        return [v, vendorMap[v]];
      })
      .sort(function (x, y) {
        return y[1] - x[1];
      })
      .map(function (e) {
        return { service: e[0], amount: r2(e[1]) };
      });
    // The screen's bar total is the sum of its (rounded) segments.
    var segSum = segments.reduce(function (s, x) {
      return s + x.amount;
    }, 0);
    bars.push({ key: m.key, label: m.label, short: m.short, total: segments.length ? r2(segSum) : m.total, segments: segments });
  }
  return bars;
}

/** Category and vendor breakdowns of one month (MonthlyCostsView.tsx), over the
 *  rows in the workspace's currency. */
function breakdown(month, keyOf, fallback, name) {
  var acc = {};
  var order = [];
  month.counted.forEach(function (inv) {
    var k = keyOf(inv) || fallback;
    if (!acc[k]) {
      acc[k] = { total: 0, count: 0 };
      order.push(k);
    }
    acc[k].total += Number(inv.amount) || 0;
    acc[k].count += 1;
  });
  return order
    .map(function (k) {
      var row = {};
      row[name] = k;
      row.total = r2(acc[k].total);
      row.count = acc[k].count;
      row.percent = month.total > 0 ? fixed1((acc[k].total / month.total) * 100) : 0;
      return row;
    })
    .sort(function (a, b) {
      return b.total - a.total;
    });
}

function pickMonth(months, p) {
  var key = str(p, 'month').trim();
  if (key === '') return 0;
  if (!/^\d{4}-\d{2}$/.test(key)) throw fail(400, 'month must be YYYY-MM, e.g. ' + months[0].key);
  for (var i = 0; i < months.length; i++) if (months[i].key === key) return i;
  throw fail(400, 'Monthly Costs has no ' + key + '. Months available: ' + months.map(function (m) {
    return m.key;
  }).join(', '));
}

/** reports.monthly — MonthlyCostsView.tsx */
function reportsMonthly(app, p) {
  var sc = scope(app, p);
  var invs = load(app, 'invoices', sc).map(normInvoice);
  var subs = load(app, 'subscriptions', sc).map(normSub);
  var months = monthModel(invs, subs, sc.currency);
  var idx = pickMonth(months, p);
  var m = months[idx];
  var prev = idx + 1 < months.length ? months[idx + 1] : null;
  var delta = prev ? m.total - prev.total : 0;
  var pct = prev && prev.total > 0 ? (delta / prev.total) * 100 : 0;
  var category = categoryFilter(p);
  var q = queryOf(p);
  var items = m.items.filter(function (inv) {
    if (category !== 'all' && inv.category !== category) return false;
    return invoiceHit(inv, q);
  });
  return {
    workspace: sc,
    months: months.map(function (x) {
      return { key: x.key, label: x.label, total: x.total };
    }),
    month: {
      key: m.key,
      label: m.label,
      total: m.total,
      recurring: m.recurring,
      recurring_share_pct: m.total > 0 ? fixed1((m.recurring / m.total) * 100) : 0,
      one_time: m.one_time,
      one_time_share_pct: m.total > 0 ? fixed1((m.one_time / m.total) * 100) : 0,
      transactions: m.transactions,
      avg_per_transaction: m.counted.length > 0 ? Number((m.total / m.counted.length).toFixed(2)) : 0,
      other_currencies: m.others,
      vs_previous: prev ? { month: prev.key, delta: r2(delta), pct: fixed1(pct) } : null,
      categories: breakdown(m, function (i) {
        return i.category;
      }, 'Other Services', 'category'),
      vendors: breakdown(m, function (i) {
        return i.vendor;
      }, 'Unknown', 'vendor'),
      count: items.length,
      items: items.map(reportRow),
    },
  };
}

/** reports.monthly-csv — "Download Report", MonthlyCostsView.tsx handleDownloadReport.
 *  Same layout; dates are ISO (YYYY-MM-DD, server local time) instead of the
 *  browser's locale format. */
function reportsMonthlyCsv(app, p) {
  var sc = scope(app, p);
  var invs = load(app, 'invoices', sc).map(normInvoice);
  var subs = load(app, 'subscriptions', sc).map(normSub);
  var months = monthModel(invs, subs, sc.currency);
  var m = months[pickMonth(months, p)];
  var sym = sc.currency_symbol;

  var esc = function (val) {
    var s = String(val === undefined || val === null ? '' : val);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  var dateCell = function (v) {
    if (!v) return 'N/A';
    var d = toDate(v);
    return isNaN(d.getTime()) ? 'Invalid Date' : isoLocalDate(d);
  };

  var headers = ['Date', 'Vendor / Service', 'Purpose / Item', 'Category', 'Invoice / Receipt Number', 'Amount (' + sym + ')', 'Currency', 'Payment Type'];
  var dataRows = m.items.map(function (inv) {
    return [
      esc(dateCell(inv.invoice_date)),
      esc(inv.vendor || 'Unknown Vendor'),
      esc(inv.purpose || '-'),
      esc(inv.category || 'Other Services'),
      esc(inv.invoice_number || '-'),
      esc(inv.amount.toFixed(2)),
      esc(inv.currency || 'USD'),
      esc(inv.payment_type === 'subscription' ? 'Recurring Subscription' : 'One-Time Bill'),
    ];
  });
  var summary = [
    [],
    ['SUMMARY TOTALS', '', '', '', '', '', '', ''],
    ['Total Monthly Cost', '', '', '', '', esc(m.total.toFixed(2)), esc(sym), ''],
    ['Recurring Subscriptions', '', '', '', '', esc(m.recurring.toFixed(2)), esc(sym), ''],
    ['One-Time Bills', '', '', '', '', esc(m.one_time.toFixed(2)), esc(sym), ''],
    ['Total Recorded Transactions', '', '', '', '', esc(m.transactions), '', ''],
  ];
  var cats = [[], ['CATEGORY BREAKDOWN', 'Category Share (%)', 'Total Spent', '', '', '', '', '']].concat(
    breakdown(m, function (i) {
      return i.category;
    }, 'Other Services', 'category').map(function (c) {
      return [esc(c.category), esc(c.percent.toFixed(1) + '%'), esc(sym + c.total.toFixed(2)), '', '', '', '', ''];
    }),
  );
  var lines = [['Monthly Cost Report - ' + m.label], ['Generated: ' + isoLocalDateTime(new Date())], [], headers]
    .concat(dataRows)
    .concat(summary)
    .concat(cats);
  var csv = lines
    .map(function (row) {
      return row.join(',');
    })
    .join('\r\n');
  return { workspace: sc, month: m.key, filename: 'Monthly_Costs_Report_' + m.key + '.csv', content: '﻿' + csv };
}

/** reports.yearly — Multi-Year History (services/reports.ts buildYearly): the
 *  statements are the invoices plus year-to-date subscription estimates, and the
 *  year cards, quarters and categories are added up from those same rows. */
function reportsYearly(app, p) {
  var sc = scope(app, p);
  var invs = load(app, 'invoices', sc).map(normInvoice);
  var subs = load(app, 'subscriptions', sc).map(normSub);
  var cal = calendar();
  var currentMonth = cal.monthIndex + 1;

  var yearRaw = (str(p, 'year').trim() || 'all').toLowerCase();
  var year = yearRaw === 'all' ? 'all' : Number(yearRaw);
  if (year !== 'all' && cal.years.indexOf(year) < 0) throw fail(400, 'year must be one of: all, ' + cal.years.join(', '));

  var yearOf = function (inv) {
    return inv.invoice_date ? toDate(inv.invoice_date).getFullYear() : cal.year;
  };
  var rmap = function (o) {
    var out = {};
    Object.keys(o).forEach(function (k) {
      out[k] = r2(o[k]);
    });
    return out;
  };

  // Statements: real invoices + one estimated year-to-date row per active
  // subscription and year, checked against the GROWING list.
  var list = invs.slice();
  var active = subs.filter(isActive);
  cal.years.forEach(function (yr) {
    active.forEach(function (sub, sIdx) {
      var start = startOf(sub, cal);
      if (yr < start.year) return;
      var hasExisting = list.some(function (inv) {
        return yearOf(inv) === yr && covers(inv, sub);
      });
      if (hasExisting) return;
      var elapsed = 1;
      if (yr === cal.year) {
        var startC = start.year === cal.year ? start.month : 1;
        elapsed = Math.max(1, currentMonth - startC + 1);
      } else if (yr < cal.year) {
        var startP = start.year === yr ? start.month : 1;
        elapsed = Math.max(1, 12 - startP + 1);
      }
      var f = freqOf(sub);
      var spent = sub.amount * elapsed;
      if (f === 'yearly') spent = sub.amount;
      else if (f === 'weekly') spent = sub.amount * 4.33 * elapsed;
      else if (f === 'quarterly') spent = sub.amount * Math.max(1, Math.ceil(elapsed / 3));
      var freq = sub.billing_frequency || 'monthly';
      list.push({
        id: 200000 + yr * 1000 + sIdx,
        vendor: sub.vendor || sub.name,
        amount: r2(spent),
        currency: sub.currency || 'USD',
        payment_type: 'subscription',
        billing_frequency: freq,
        category: sub.category || 'Software & SaaS',
        purpose: sub.purpose || sub.name + ' (' + freq + ' subscription — YTD spent)',
        invoice_number: 'SUB-' + sub.id + '-' + yr,
        invoice_date: yr + '-' + pad2(start.month) + '-01T00:00:00.000Z',
        subscription_id: sub.id,
        estimated: true,
      });
    });
  });

  var cards = cal.years.map(function (yr) {
    var yearRows = list.filter(function (inv) {
      return inv.invoice_date ? toDate(inv.invoice_date).getFullYear() === yr : yr === cal.year;
    });
    var total = 0;
    var vMap = {};
    var cMap = {};
    var qMap = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    splitByCurrency(yearRows, sc.currency).counted.forEach(function (inv) {
      var amt = Number(inv.amount) || 0;
      total += amt;
      var v = inv.vendor || 'Other';
      var c = inv.category || 'Other';
      vMap[v] = (vMap[v] || 0) + amt;
      cMap[c] = (cMap[c] || 0) + amt;
      if (inv.invoice_date) {
        var m = toDate(inv.invoice_date).getMonth();
        if (m < 3) qMap.Q1 += amt;
        else if (m < 6) qMap.Q2 += amt;
        else if (m < 9) qMap.Q3 += amt;
        else qMap.Q4 += amt;
      }
    });
    var top = Object.keys(vMap)
      .map(function (k) {
        return [k, vMap[k]];
      })
      .sort(function (a, b) {
        return b[1] - a[1];
      })[0];
    return {
      year: yr,
      total: r2(total),
      invoices: yearRows.filter(function (inv) {
        return !inv.estimated;
      }).length,
      avg_monthly: r2(total / 12),
      top_vendor: top ? top[0] : 'None',
      yoy_pct: 0,
      quarters: rmap(qMap),
      categories: rmap(cMap),
      vendors: rmap(vMap),
    };
  });

  var category = categoryFilter(p);
  var q = queryOf(p);
  var statements = list.filter(function (inv) {
    if (year !== 'all' && inv.invoice_date && toDate(inv.invoice_date).getFullYear() !== year) return false;
    if (category !== 'all' && inv.category !== category) return false;
    return invoiceHit(inv, q);
  });
  var tracked = list.filter(function (inv) {
    return cal.years.indexOf(yearOf(inv)) >= 0;
  });

  return {
    workspace: sc,
    grand_total: r2(cards.reduce(function (s, c) {
      return s + c.total;
    }, 0)),
    total_invoices: cards.reduce(function (s, c) {
      return s + c.invoices;
    }, 0),
    other_currencies: splitByCurrency(tracked, sc.currency).others,
    years: cards,
    count: statements.length,
    statements: statements.map(reportRow),
  };
}

/* =============================================================== WRITES === */

/** ApiService.logActivity. Callers pass the record's own currency. A failure is
 *  swallowed, as in the UI. */
function logActivity(app, a) {
  try {
    var rec = new Record(app.findCollectionByNameOrId('activities'));
    rec.set('event_type', a.event_type || 'event');
    rec.set('title', a.title || 'Activity');
    rec.set('description', a.description || '');
    rec.set('amount', Number(a.amount) || 0);
    rec.set('currency', a.currency || 'USD');
    rec.set('vendor', a.vendor || '');
    rec.set('group_id', a.group_id || '');
    app.save(rec);
    return rec.id;
  } catch (err) {
    console.log('[invoice-tracker] feed row not written (the screens ignore this too): ' + errText(err));
    return null;
  }
}

/** invoices.add — AddInvoiceModal.tsx -> AppController.createManualInvoice -> ApiService.createInvoice.
 *  A PDF given as pdf_filename + pdf_base64 is stored on the invoice (pdf_file),
 *  as the form stores the file a person picks. */
function invoicesAdd(app, p) {
  refuse(p, ['invoice_date', 'date'], 'The Add Invoice form always dates a receipt today; the app cannot record another invoice date.');
  refuse(p, ['payment_type', 'billing_frequency'], 'The Add Invoice form always records a one-time bill; recurring costs are added as subscriptions.');
  refuse(p, ['pdf_size_bytes'], 'Pass the PDF itself as pdf_base64 (with pdf_filename); its size is taken from it.');
  var sc = scope(app, p);

  var vendor = str(p, 'vendor');
  if (!given(p, 'amount') || str(p, 'amount').trim() === '') throw fail(400, 'amount is required (a number such as 25.00)');
  var amount = Number(str(p, 'amount').trim());
  if (!isFinite(amount)) throw fail(400, 'amount must be a number such as 25.00');
  // The form opens on the shown workspace's currency (the one its totals use).
  var currency = pickCurrency(p, sc.currency);
  var category = pickCategory(p);
  var purpose = str(p, 'purpose');
  var invoiceNumber = str(p, 'invoice_number');

  var pdf = null;
  var pdfName = str(p, 'pdf_filename');
  var pdfData = str(p, 'pdf_base64');
  if (pdfName !== '' || pdfData !== '') {
    if (pdfName === '' || pdfData === '') {
      throw fail(400, "pdf_filename and pdf_base64 go together: the PDF's file name and its content as base64");
    }
    if (!/\.pdf$/i.test(pdfName)) throw fail(400, 'pdf_filename must name a .pdf file (the form accepts PDF documents only)');
    var bytes = base64Bytes(pdfData);
    if (!bytes) throw fail(400, 'pdf_base64 must be the PDF file encoded as base64');
    // "%PDF" — the form accepts PDF documents only; the file field holds up to 25 MB.
    if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      throw fail(400, 'pdf_base64 is not a PDF document');
    }
    if (bytes.length > 26214400) throw fail(400, 'The PDF is larger than 25 MB');
    pdf = { name: pdfName, size: bytes.length, bytes: bytes };
    // Picking a file fills an empty vendor / invoice number (AddInvoiceModal.tsx handleFileChange).
    if (!vendor) {
      var clean = pdfName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
      for (var h = 0; h < VENDOR_HINTS.length; h++) {
        if (VENDOR_HINTS[h][0].test(clean)) {
          vendor = VENDOR_HINTS[h][1];
          break;
        }
      }
    }
    if (!invoiceNumber) {
      var match = pdfName.match(/(INV|REC|BILL)[-_]?[0-9A-Z]+/i);
      if (match) invoiceNumber = match[0].toUpperCase();
    }
  }
  if (!vendor) throw fail(400, 'vendor is required (Merchant / Vendor Name)');
  if (!invoiceNumber) invoiceNumber = 'INV-' + Date.now().toString().slice(-6);

  var rec = new Record(app.findCollectionByNameOrId('invoices'));
  rec.set('vendor', vendor);
  rec.set('amount', Number(amount) || 0);
  rec.set('currency', currency || 'USD');
  rec.set('payment_type', 'one_time');
  rec.set('billing_frequency', 'none');
  rec.set('category', category || 'Software & SaaS');
  rec.set('purpose', purpose || '');
  rec.set('invoice_date', new Date().toISOString());
  rec.set('invoice_number', invoiceNumber);
  rec.set('group_id', sc.id || '');
  rec.set('has_pdf_attachment', !!pdf);
  rec.set('pdf_filename', pdf ? pdf.name : vendor + '_Receipt.pdf');
  rec.set(
    'pdf_text_preview',
    pdf
      ? 'PDF Invoice Statement extracted from ' + pdf.name + ' (' + (pdf.size / 1024).toFixed(1) + ' KB)'
      : 'RECEIPT\nVendor: ' + vendor + '\nAmount: $' + Number(amount || 0).toFixed(2),
  );
  rec.set('line_items', []);
  rec.set('notes', '');
  rec.set('subscription_id', '');
  rec.set('confidence_score', 0.99);
  rec.set('is_verified', true);
  if (pdf) rec.set('pdf_file', $filesystem.fileFromBytes(pdf.bytes, pdf.name));
  save(app, rec);

  var activityId = logActivity(app, {
    event_type: 'invoice_created',
    title: 'Invoice Added: ' + rec.getString('vendor'),
    description:
      'Recorded ' + rec.getString('currency') + ' ' + Number(rec.getFloat('amount')).toFixed(2) +
      ' invoice #' + rec.getString('invoice_number') + '.',
    amount: Number(rec.getFloat('amount')),
    currency: rec.getString('currency'),
    vendor: rec.getString('vendor'),
    group_id: rec.getString('group_id'),
  });

  return { success: true, workspace: sc, invoice: normInvoice(rec), activity_id: activityId };
}

/** invoices.delete — ApiService.ts:394-407 */
function invoicesDelete(app, p) {
  var rec = mustFind(app, 'invoices', str(p, 'invoice').trim(), 'invoice');
  var before = {
    vendor: rec.getString('vendor'),
    amount: Number(rec.getFloat('amount')),
    currency: rec.getString('currency'),
    invoice_number: rec.getString('invoice_number'),
    group_id: rec.getString('group_id'),
  };
  try {
    app.delete(rec);
  } catch (err) {
    throw fail(400, 'Not deleted: ' + errText(err));
  }
  var activityId = logActivity(app, {
    event_type: 'invoice_deleted',
    title: 'Invoice Removed: ' + before.vendor,
    description: 'Deleted ' + before.currency + ' ' + before.amount.toFixed(2) + ' invoice #' + (before.invoice_number || 'N/A') + '.',
    amount: before.amount,
    currency: before.currency,
    vendor: before.vendor,
    group_id: before.group_id,
  });
  return { success: true, deleted: rec.id, activity_id: activityId };
}

/** subscriptions.add — AddSubscriptionModal.tsx -> AppController.createManualSubscription ->
 *  ApiService.createSubscription: the form's billing frequency (default monthly),
 *  next renewal date (default 30 days from now) and auto-renew (default on). */
function subscriptionsAdd(app, p) {
  refuse(p, ['status'], 'New subscriptions are always active; pause one afterwards with subscriptions.set-status.');
  var sc = scope(app, p);

  var name = str(p, 'name').trim();
  if (!name) throw fail(400, 'Please enter a subscription name.');
  var amount = Number(str(p, 'amount').trim());
  if (!given(p, 'amount') || str(p, 'amount').trim() === '' || isNaN(amount) || amount < 0) {
    throw fail(400, 'Please enter a valid positive amount.');
  }
  var vendor = str(p, 'vendor').trim() || name;
  // The form opens on the shown workspace's currency (the one its totals use).
  var currency = pickCurrency(p, sc.currency);
  var category = pickCategory(p);
  var purpose = str(p, 'purpose').trim();

  var frequency = (str(p, 'billing_frequency').trim() || 'monthly').toLowerCase();
  if (['monthly', 'yearly', 'weekly', 'quarterly'].indexOf(frequency) < 0) {
    throw fail(400, 'billing_frequency must be one of: monthly, yearly, weekly, quarterly');
  }
  // The form's date field gives a day; it is stored at local midnight as ISO text.
  var renewal = new Date(Date.now() + 30 * 86400000).toISOString();
  var rawRenewal = str(p, 'next_renewal_date').trim();
  if (rawRenewal !== '') {
    var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawRenewal);
    var rd = dm ? new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) : toDate(rawRenewal);
    if (isNaN(rd.getTime())) throw fail(400, 'next_renewal_date must be a date such as 2026-12-01');
    renewal = rd.toISOString();
  }
  var autoRenew = true;
  if (given(p, 'auto_renew')) {
    var ar = str(p, 'auto_renew').trim().toLowerCase();
    if (ar !== 'true' && ar !== 'false') throw fail(400, 'auto_renew must be true or false');
    autoRenew = ar === 'true';
  }

  var rec = new Record(app.findCollectionByNameOrId('subscriptions'));
  rec.set('name', name || vendor);
  rec.set('vendor', vendor || name);
  rec.set('amount', Number(amount) || 0);
  rec.set('currency', currency || 'USD');
  rec.set('billing_frequency', frequency);
  rec.set('category', category || 'Software & SaaS');
  rec.set('purpose', purpose || '');
  rec.set('status', 'active');
  rec.set('group_id', sc.id || '');
  rec.set('last_billed_date', new Date().toISOString());
  rec.set('next_renewal_date', renewal);
  rec.set('auto_renew', autoRenew);
  rec.set('icon_name', 'CreditCard');
  save(app, rec);

  var label = rec.getString('name') || rec.getString('vendor');
  var activityId = logActivity(app, {
    event_type: 'subscription_created',
    title: 'New Subscription: ' + label,
    description:
      'Created recurring subscription of ' + rec.getString('currency') + ' ' + Number(rec.getFloat('amount')).toFixed(2) +
      '/' + rec.getString('billing_frequency') + '.',
    amount: Number(rec.getFloat('amount')),
    currency: rec.getString('currency'),
    vendor: rec.getString('vendor') || rec.getString('name'),
    group_id: rec.getString('group_id'),
  });

  return { success: true, workspace: sc, subscription: normSub(rec), activity_id: activityId };
}

/** subscriptions.set-status — Pause / Activate, SubscriptionsView.tsx:242-277 ->
 *  AppController.ts:249-251 -> ApiService.ts:174-207: status only, no feed row. */
function subscriptionsSetStatus(app, p) {
  var status = str(p, 'status').trim().toLowerCase();
  if (status !== 'active' && status !== 'paused') throw fail(400, 'status must be active or paused');
  var rec = mustFind(app, 'subscriptions', str(p, 'subscription').trim(), 'subscription');
  var previous = rec.getString('status');
  rec.set('status', status);
  save(app, rec);
  return { success: true, previous_status: previous, subscription: normSub(rec) };
}

/** subscriptions.delete — ApiService.ts:243-256 */
function subscriptionsDelete(app, p) {
  var rec = mustFind(app, 'subscriptions', str(p, 'subscription').trim(), 'subscription');
  var label = rec.getString('name') || rec.getString('vendor');
  var before = {
    amount: Number(rec.getFloat('amount')),
    currency: rec.getString('currency'),
    vendor: rec.getString('vendor') || rec.getString('name'),
    group_id: rec.getString('group_id'),
  };
  try {
    app.delete(rec);
  } catch (err) {
    throw fail(400, 'Not deleted: ' + errText(err));
  }
  var activityId = logActivity(app, {
    event_type: 'subscription_cancelled',
    title: 'Subscription Removed: ' + label,
    description: 'Cancelled subscription for ' + label + '.',
    amount: before.amount,
    currency: before.currency,
    vendor: before.vendor,
    group_id: before.group_id,
  });
  return { success: true, deleted: rec.id, activity_id: activityId };
}

/** groups.add — GroupManageModal.tsx:113-137 -> ApiService.ts:56-74 */
function groupsAdd(app, p) {
  var name = str(p, 'name').trim();
  if (!name) throw fail(400, 'Please enter a group / workspace name.');
  var description = str(p, 'description').trim();
  var color = pickColor(p, '#FF9900');
  var currency = pickCurrency(p, 'USD');
  var rec = new Record(app.findCollectionByNameOrId('groups'));
  rec.set('name', name);
  rec.set('description', description);
  rec.set('color', color || '#3B82F6');
  rec.set('icon', 'Folder');
  rec.set('currency', currency || 'USD');
  save(app, rec);
  return { success: true, group: groupView(rec) };
}

/** groups.update — the edit form (GroupManageModal.tsx:90-111) and the header
 *  currency switch (MainView.tsx:180-204) -> ApiService.ts:76-88 */
function groupsUpdate(app, p) {
  var raw = str(p, 'group').trim();
  if (!raw) throw fail(400, 'group is required (workspace id or name)');
  var rec = findGroup(groupsNewestFirst(app), raw);
  var changed = 0;
  if (given(p, 'name')) {
    var name = str(p, 'name').trim();
    if (!name) throw fail(400, 'Workspace name cannot be empty.');
    rec.set('name', name);
    changed++;
  }
  if (given(p, 'description')) {
    rec.set('description', str(p, 'description').trim());
    changed++;
  }
  if (given(p, 'color')) {
    rec.set('color', pickColor(p, rec.getString('color')));
    changed++;
  }
  if (given(p, 'currency')) {
    rec.set('currency', pickCurrency(p, rec.getString('currency')));
    changed++;
  }
  if (!changed) throw fail(400, 'Nothing to change: pass name, description, color and/or currency');
  save(app, rec);
  return { success: true, group: groupView(rec) };
}

/** groups.delete — GroupManageModal.tsx handleDelete -> ApiService.deleteGroup.
 *  Refuses to delete the last workspace. Its invoices, subscriptions and feed
 *  rows are deleted with it (records.pb.js), as the screen's confirmation says. */
function groupsDelete(app, p) {
  var raw = str(p, 'group').trim();
  if (!raw) throw fail(400, 'group is required (workspace id or name)');
  var groups = groupsNewestFirst(app);
  var rec = findGroup(groups, raw);
  if (groups.length <= 1) throw fail(400, 'You must have at least one workspace group.');
  var count = function (collection) {
    return app.findRecordsByFilter(collection, 'group_id = {:g}', '', 0, 0, { g: rec.id }).length;
  };
  var removed = { invoices: count('invoices'), subscriptions: count('subscriptions'), activities: count('activities') };
  try {
    app.delete(rec);
  } catch (err) {
    throw fail(400, 'Not deleted: ' + errText(err));
  }
  return { success: true, deleted: rec.id, name: rec.getString('name'), deleted_records: removed };
}

/** invoices.simulate-bill — the feed's Refresh Feed button (preset aws): a sample
 *  emailed bill, linked to (or creating) its subscription, with a feed row. All
 *  three are filed in the workspace like a manual entry. The sample PDF is only
 *  named: no file is stored, so the invoice shows no attached PDF. */
var SIM_PRESETS = {
  aws: {
    vendor: 'Amazon Web Services',
    amount: 248.5,
    currency: 'USD',
    payment_type: 'subscription',
    billing_frequency: 'monthly',
    category: 'Cloud Infrastructure',
    purpose: 'Monthly AWS compute cluster & storage bill',
    pdf_filename: 'AWS_Tax_Invoice_Aug2026.pdf',
  },
  openai: {
    vendor: 'OpenAI',
    amount: 42.0,
    currency: 'USD',
    payment_type: 'subscription',
    billing_frequency: 'monthly',
    category: 'AI & Developer Tools',
    purpose: 'ChatGPT Plus & GPT-4o API developer credit tier',
    pdf_filename: 'OpenAI_Invoice_Aug2026.pdf',
  },
  figma: {
    vendor: 'Figma',
    amount: 15.0,
    currency: 'USD',
    payment_type: 'subscription',
    billing_frequency: 'monthly',
    category: 'Design & Creative',
    purpose: 'Figma Pro design seat renewal',
    pdf_filename: 'Figma_Receipt_Aug2026.pdf',
  },
};

function simulateBill(app, p) {
  var sc = scope(app, p);
  var preset = SIM_PRESETS[str(p, 'preset')] || SIM_PRESETS.aws;
  var groupId = sc.id || '';
  var nowStr = new Date().toISOString();

  var inv = new Record(app.findCollectionByNameOrId('invoices'), {
    vendor: preset.vendor,
    amount: preset.amount,
    currency: preset.currency,
    payment_type: preset.payment_type,
    billing_frequency: preset.billing_frequency,
    category: preset.category,
    purpose: preset.purpose,
    invoice_date: nowStr,
    invoice_number: 'INV-' + preset.vendor.slice(0, 3).toUpperCase() + '-' + Date.now().toString().slice(-6),
    group_id: groupId,
    has_pdf_attachment: false,
    pdf_filename: preset.pdf_filename,
    pdf_text_preview: 'RECEIPT / INVOICE\nVendor: ' + preset.vendor + '\nAmount: $' + preset.amount.toFixed(2) + ' USD\nDate: ' + nowStr + '\nStatus: Paid',
    confidence_score: 0.99,
    is_verified: true,
    line_items: [{ description: preset.purpose, quantity: 1, unitPrice: preset.amount, amount: preset.amount }],
    notes: 'Simulated automated scan ingestion.',
  });
  save(app, inv);

  // Link the first subscription of this vendor in the workspace (any workspace
  // under All Workspaces), or start one.
  var subId = '';
  var existing = sc.id
    ? app.findRecordsByFilter('subscriptions', 'vendor ~ {:v} && group_id = {:g}', '', 1, 0, { v: preset.vendor, g: sc.id })
    : app.findRecordsByFilter('subscriptions', 'vendor ~ {:v}', '', 1, 0, { v: preset.vendor });
  if (existing.length > 0) {
    subId = existing[0].id;
  } else {
    var sub = new Record(app.findCollectionByNameOrId('subscriptions'), {
      name: preset.vendor,
      vendor: preset.vendor,
      amount: preset.amount,
      currency: preset.currency,
      billing_frequency: preset.billing_frequency,
      category: preset.category,
      purpose: preset.purpose,
      status: 'active',
      group_id: groupId,
      last_billed_date: nowStr,
      auto_renew: true,
      icon_name: 'CreditCard',
    });
    save(app, sub);
    subId = sub.id;
  }
  inv.set('subscription_id', subId);
  save(app, inv);

  var act = new Record(app.findCollectionByNameOrId('activities'), {
    event_type: 'bill_simulated',
    title: 'Simulated Bill: ' + preset.vendor,
    description: 'Simulated email bill received from ' + preset.vendor + ' for $' + preset.amount.toFixed(2),
    amount: preset.amount,
    currency: preset.currency,
    vendor: preset.vendor,
    group_id: groupId,
  });
  save(app, act);

  return { success: true, workspace: sc, invoice: inv, subscription_id: subId };
}

module.exports = {
  handle: handle,
  dashboardOverview: dashboardOverview,
  subscriptionsList: subscriptionsList,
  invoicesList: invoicesList,
  invoicesGet: invoicesGet,
  reportsMonthly: reportsMonthly,
  reportsMonthlyCsv: reportsMonthlyCsv,
  reportsYearly: reportsYearly,
  invoicesAdd: invoicesAdd,
  invoicesDelete: invoicesDelete,
  subscriptionsAdd: subscriptionsAdd,
  subscriptionsSetStatus: subscriptionsSetStatus,
  subscriptionsDelete: subscriptionsDelete,
  groupsAdd: groupsAdd,
  groupsUpdate: groupsUpdate,
  groupsDelete: groupsDelete,
  simulateBill: simulateBill,
};
