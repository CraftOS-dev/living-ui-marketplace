/// <reference path="../pb_data/types.d.ts" />
/**
 * The documents LPs receive, from stored numbers (never computed here): a
 * capital call or distribution notice per LP in the ILPA 2025 structure
 * (cover, description, template table, wire block), its ILPA template lines
 * as CSV, and the quarterly LP pack (the letter and the LP's capital account
 * statement with net beside gross).
 *
 * The wording is written here; the PDF is drawn by the funds engine
 * (engine/funds/render.mjs, a hook-spawned Node bundle of pdf-lib and
 * fontkit with subset Noto fonts), so LP names in Japanese, Chinese, Korean,
 * Greek, Cyrillic or accented Latin print as written:
 *
 *   render(app, [noticeDoc(o) | packDoc(o), ...]) -> [PDF bytes, ...]   (one Node run for all)
 */

const TYPE_LABEL = {
  call_investment: 'Capital call: investments',
  call_fees: 'Capital call: management fees',
  call_expenses: 'Capital call: partnership expenses',
  call_other: 'Capital call: other',
  call_recall: 'Capital call: recallable capital',
  call_subline: 'Capital call: subscription facility repayment',
  dist_capital: 'Distribution: return of capital',
  dist_gain: 'Distribution: realized gain',
};
const CALL_TYPES = ['call_investment', 'call_fees', 'call_expenses', 'call_other', 'call_recall', 'call_subline'];
const DIST_TYPES = ['dist_capital', 'dist_gain'];
// Calls that use unfunded commitment (a recall draws recallable capital instead).
const UNFUNDED_TYPES = ['call_investment', 'call_fees', 'call_expenses', 'call_other', 'call_subline'];
// Han characters print in the form of the LP's country (kana or hangul in the same text decide by themselves).
const HAN = { JP: 'jp', KR: 'kr' };

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function money(minor, cur) {
  return L('lib_money').format(minor, cur);
}

/** A multiple in _e8 as "1.71x" ("n/a" when unknown). */
function mult(e8) {
  if (e8 === null || e8 === undefined) return 'n/a';
  const s = String(Math.round(Number(e8) / 1000000));
  const whole = s.length > 2 ? s.slice(0, s.length - 2) : '0';
  let frac = s.length > 2 ? s.slice(-2) : s;
  while (frac.length < 2) frac = '0' + frac;
  return whole + '.' + frac + 'x';
}

/** A rate in ppm as "10.9%" ("n/a" when unknown). */
function pct(ppm) {
  if (ppm === null || ppm === undefined) return 'n/a';
  const t = Math.round(Number(ppm) / 1000);
  const neg = t < 0;
  const a = String(Math.abs(t));
  const whole = a.length > 1 ? a.slice(0, a.length - 1) : '0';
  return (neg ? '-' : '') + whole + '.' + a.slice(-1) + '%';
}

function fundOut(f) {
  return { name: f.name, legal_name: f.legal_name, currency: f.currency, exp: L('lib_money').exponent(f.currency) };
}

/**
 * A notice for one LP, ready for the engine.
 * o: { firm, fund: { name, legal_name, currency }, lp: { name, attention, country }, kind: call|distribution, number, notice_day,
 *      due_day, narrative, purposes, line: { amounts, total_minor, fee_gross_minor, fee_waiver_minor, balances }, totals,
 *      fee: { rate_text, basis, from_day, to_day } | null, wire | null, waterfall | null, holding: { name, moic_e8, irr_ppm } | null }
 */
function noticeDoc(o) {
  const cur = o.fund.currency;
  const call = o.kind === 'call';
  const total = o.totals.total_minor;
  const kinds = [];
  for (const pu of o.purposes) {
    if (pu.type === 'investment') kinds.push('an investment' + (pu.holding_name ? ' in ' + pu.holding_name : ''));
    else if (pu.type === 'fees') kinds.push('management fees');
    else if (pu.type === 'expenses') kinds.push('partnership expenses');
    else if (pu.type === 'other') kinds.push(pu.label || 'other purposes');
    else if (pu.type === 'recall') kinds.push('recallable capital' + (pu.holding_name ? ' for ' + pu.holding_name : ''));
    else if (pu.type === 'subline') kinds.push('the repayment of the subscription facility');
  }
  const legal = o.fund.legal_name || o.fund.name;
  const summary = call ? 'The General Partner of ' + legal + ' is calling ' + money(total, cur) + ' of capital for ' + (kinds.length > 0 ? kinds.join(', ') : 'the purposes below') + '.' : 'The General Partner of ' + legal + ' is distributing ' + money(total, cur) + ' to the limited partners' + (o.holding && o.holding.name ? ' from ' + o.holding.name : '') + '.';
  const description = [];
  for (const pu of o.purposes) {
    let t = '';
    if (pu.type === 'investment') t = 'Investment' + (pu.holding_name ? ' in ' + pu.holding_name : '') + ': ' + money(pu.amount_minor, cur) + ' for the fund.' + (pu.label ? ' ' + pu.label + '.' : '');
    else if (pu.type === 'fees' && o.fee) t = 'Management fees for ' + o.fee.from_day + ' to ' + o.fee.to_day + ' at ' + o.fee.rate_text + ' a year of ' + o.fee.basis + ' capital, per the Limited Partnership Agreement; charged to fee-paying limited partners only, inside commitments.' + (o.line.fee_waiver_minor > 0 ? ' Your fee of ' + money(o.line.fee_gross_minor, cur) + ' is reduced by a waiver of ' + money(o.line.fee_waiver_minor, cur) + '.' : '');
    else if (pu.type === 'expenses') t = 'Partnership expenses: ' + money(pu.amount_minor, cur) + ', allocated pro rata of commitments, inside commitments.' + (pu.label ? ' ' + pu.label + '.' : '');
    else if (pu.type === 'other') t = (pu.label || 'Other') + ': ' + money(pu.amount_minor, cur) + ', allocated pro rata of commitments.';
    else if (pu.type === 'recall') t = 'Recallable capital: ' + money(pu.amount_minor, cur) + (pu.holding_name ? ' for ' + pu.holding_name : '') + ', recalled from distributions designated recallable under the Limited Partnership Agreement, allocated pro rata of each limited partner\'s recallable balance. It does not reduce your unfunded commitment.' + (pu.label ? ' ' + pu.label + '.' : '');
    else if (pu.type === 'subline') t = 'Repayment of the subscription facility: ' + money(pu.amount_minor, cur) + (pu.label ? ' (' + pu.label + ')' : '') + ', drawn to fund investments before this call, allocated pro rata of commitments, inside commitments.';
    else if (pu.type === 'distribution' && o.waterfall) {
      t = 'Gross distributable amount ' + money(o.waterfall.gross_minor, cur) + '; carried interest to the General Partner ' + money(o.waterfall.carry_minor, cur) + ' (estimate under the ' + o.waterfall.method + ' waterfall until the administrator confirms); ' + money(total, cur) + ' to limited partners, allocated pro rata of contributed capital.';
      if (o.totals.recallable_minor > 0) t += ' ' + money(o.totals.recallable_minor, cur) + ' of the distribution is recallable under the Limited Partnership Agreement.';
      if (o.holding && o.holding.name) t += ' Source: ' + o.holding.name + (o.holding.moic_e8 !== null && o.holding.moic_e8 !== undefined ? ' (gross MOIC ' + mult(o.holding.moic_e8) + ', gross IRR ' + pct(o.holding.irr_ppm) + ')' : '') + '.';
    }
    if (t !== '') description.push(t);
  }
  return {
    doc: 'notice',
    han: HAN[String(o.lp.country || '').toUpperCase()] || 'sc',
    firm: o.firm,
    fund: fundOut(o.fund),
    lp: { name: o.lp.name, attention: o.lp.attention || '' },
    kind: o.kind,
    number: o.number,
    notice_day: o.notice_day,
    due_day: o.due_day,
    summary: summary,
    narrative: o.narrative || '',
    description: description,
    types: (call ? CALL_TYPES : DIST_TYPES).map((k) => ({ key: k, label: TYPE_LABEL[k] })),
    line: o.line,
    totals: o.totals,
    wire: call ? o.wire : null,
  };
}

/** The ILPA template lines of one LP's notice as CSV text. */
function noticeCsv(o) {
  const u = L('lib_util');
  const cur = o.fund.currency;
  const fromMinor = L('lib_money').fromMinor;
  const b = o.line.balances || {};
  const rows = [['Fund', 'Limited partner', 'Notice', 'Notice date', 'Due date', 'Transaction type', 'Currency', 'LP amount', 'Fund amount', 'Impact on LP unfunded', 'LP contributed after', 'LP unfunded after', 'LP distributed to date', 'LP recallable']];
  const types = o.kind === 'call' ? CALL_TYPES : DIST_TYPES;
  for (const t of types) {
    const v = (o.line.amounts || {})[t] || 0;
    const ft = o.totals[t] || 0;
    if (v === 0 && ft === 0) continue;
    rows.push([o.fund.legal_name || o.fund.name, o.lp.name, o.number, o.notice_day, o.due_day, TYPE_LABEL[t], cur, fromMinor(v, cur), fromMinor(ft, cur), fromMinor(UNFUNDED_TYPES.indexOf(t) >= 0 ? -v : 0, cur), fromMinor(b.contributed_minor || 0, cur), fromMinor(b.unfunded_minor || 0, cur), fromMinor(b.distributed_minor || 0, cur), fromMinor(b.recallable_minor || 0, cur)]);
  }
  return u.csvText(rows);
}

/**
 * The quarterly LP pack, ready for the engine.
 * o: { firm, fund: { name, legal_name, currency }, quarter: { label, period_end }, lp: { name, country }, paragraphs: [text],
 *      account, nav_share_minor, lp_metrics, fund_metrics, flows: [{ day, label, amount_minor }], hash }
 */
function packDoc(o) {
  return { doc: 'pack', han: HAN[String(o.lp.country || '').toUpperCase()] || 'sc', firm: o.firm, fund: fundOut(o.fund), quarter: o.quarter, lp: { name: o.lp.name }, paragraphs: o.paragraphs, account: o.account, nav_share_minor: o.nav_share_minor, lp_metrics: o.lp_metrics, fund_metrics: o.fund_metrics, flows: o.flows, hash: o.hash };
}

function absDataDir(app) {
  const d = app.dataDir();
  return $filepath.isAbs(d) ? d : $filepath.join($os.getwd(), d);
}

/**
 * Draw documents with the engine (one Node run for all of them) and answer
 * their PDF bytes in order. Runs before any transaction that stores them;
 * the work folder under pb_data is removed when done.
 */
function render(app, docs) {
  const u = L('lib_util');
  if (docs.length === 0) return [];
  const dir = $filepath.join(absDataDir(app), 'funds_render', $security.randomStringWithAlphabet(16, 'abcdefghijklmnopqrstuvwxyz0123456789'));
  $os.mkdirAll(dir, 0o700);
  try {
    const job = $filepath.join(dir, 'job.json');
    $os.writeFile(job, JSON.stringify({ dir: dir, docs: docs.map((d, i) => Object.assign({ out: 'doc' + i + '.pdf' }, d)) }), 0o600);
    let answer = '';
    try {
      answer = toString($os.cmd('node', $filepath.join(__hooks, '..', '..', 'engine', 'funds', 'render.mjs'), job).output());
    } catch (err) {
      console.error('[vo] funds PDF engine failed:', err);
      throw u.fail(424, 'The PDF engine did not run (Node is needed on this computer). Nothing was issued.', 'pdf_engine');
    }
    let res = null;
    try {
      res = JSON.parse(answer);
    } catch {
      res = null;
    }
    if (res === null || res.ok !== true) {
      console.error('[vo] funds PDF engine answered: ' + u.clip(answer, 2000));
      throw u.fail(424, 'The PDF engine could not draw the documents. Nothing was issued.', 'pdf_engine');
    }
    return docs.map((d, i) => $os.readFile($filepath.join(dir, 'doc' + i + '.pdf')));
  } finally {
    try {
      $os.removeAll(dir);
    } catch (err) {
      console.error('[vo] could not remove ' + dir + ':', err);
    }
  }
}

module.exports = { TYPE_LABEL: TYPE_LABEL, CALL_TYPES: CALL_TYPES, DIST_TYPES: DIST_TYPES, UNFUNDED_TYPES: UNFUNDED_TYPES, mult: mult, pct: pct, noticeDoc: noticeDoc, noticeCsv: noticeCsv, packDoc: packDoc, render: render };
