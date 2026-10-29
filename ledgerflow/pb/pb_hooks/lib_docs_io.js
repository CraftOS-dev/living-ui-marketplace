/// <reference path="../pb_data/types.d.ts" />
/** Document op helpers: params into a document spec. */

/** The document fields present in params (create: kind required). */
function spec(p, create) {
  const u = require(`${__hooks}/lib_util.js`);
  const s = {};
  if (create) s.kind = u.oneOf(p, 'kind', ['invoice', 'bill', 'credit_note', 'vendor_credit'], 'invoice');
  if (u.has(p, 'contact')) s.contact = u.str(p, 'contact', '');
  if (u.has(p, 'issue_date')) s.issue_date = u.str(p, 'issue_date', '');
  if (u.has(p, 'due_date')) s.due_date = u.str(p, 'due_date', '');
  if (u.has(p, 'terms_days')) s.terms_days = u.int(p, 'terms_days', 0, 0, 365);
  if (u.has(p, 'currency')) s.currency = u.str(p, 'currency', '');
  if (u.has(p, 'rate')) s.rate = u.str(p, 'rate', '');
  if (u.has(p, 'inclusive')) s.inclusive = u.bool(p, 'inclusive', false);
  if (u.has(p, 'lines')) s.lines = u.list(p, 'lines');
  if (u.has(p, 'number')) s.number = u.str(p, 'number', '');
  for (const k of ['reference', 'notes', 'terms']) if (u.has(p, k)) s[k] = u.text(p, k, '');
  if (u.has(p, 'file')) s.file = u.str(p, 'file', '');
  return s;
}

function who(app, doc) {
  try {
    return app.findRecordById('contacts', doc.getString('contact')).getString('name');
  } catch {
    return '(no contact)';
  }
}

module.exports = { spec: spec, who: who };
