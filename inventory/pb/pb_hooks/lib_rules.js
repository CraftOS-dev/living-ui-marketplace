/// <reference path="../pb_data/types.d.ts" />
/**
 * Record rules shared by the hooks in hooks.pb.js (hook callbacks run in
 * isolated VMs, so they require this module instead of sharing functions).
 */

/** A barcode: trimmed, not empty, and not used by anything else. */
function checkCode(app, rec) {
  const core = require(`${__hooks}/lib_core.js`);
  const code = String(rec.getString('code') || '').trim();
  if (code === '') throw new BadRequestError('A barcode cannot be empty');
  rec.set('code', code);
  const owner = core.codeOwner(app, code, rec.getString('item'), '');
  if (owner !== null) throw new BadRequestError('The barcode "' + code + '" is already used by ' + owner.label + '. Every scannable code must be unique.');
}

/** A category: a name and an icon from the curated set. */
function checkCategory(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const icons = require(`${__hooks}/lib_icons.js`);
  const name = u.squash(rec.getString('name'));
  if (name === '') throw new BadRequestError('A category needs a name');
  rec.set('name', name);
  const icon = rec.getString('icon');
  if (icon === '') rec.set('icon', icons.DEFAULT_ICON);
  else if (!icons.isIcon(icon)) throw new BadRequestError('icon must be one of: ' + icons.ICONS.join(', '));
}

/** A supplier: a name; contact fields trimmed. */
function checkSupplier(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const name = u.squash(rec.getString('name'));
  if (name === '') throw new BadRequestError('A supplier needs a name');
  rec.set('name', name);
  for (const f of ['contact', 'email', 'phone', 'website']) rec.set(f, String(rec.getString(f) || '').trim());
}

/** The operations to use instead of writing these collections directly. */
const OPS_ONLY = {
  stock: 'stock.in, stock.out, stock.move, stock.set or stock.batch',
  movements: 'stock.in, stock.out, stock.move, stock.set or stock.batch (and movements.undo or movements.delete to change history)',
  orders: 'the orders.* operations',
  order_lines: 'orders.add-line, orders.update-line, orders.remove-line or orders.receive',
  counts: 'the counts.* operations',
  count_lines: 'counts.set-line, counts.scan, counts.add-item or counts.remove-line',
  documents: 'the documents.* operations',
  imports: 'the import.* operations',
  settings: 'settings.update',
};

/** Refuse a direct API write to a collection that changes only through operations. */
function refuse(rec) {
  const name = rec.collection().name;
  throw new BadRequestError(
    '"' + name + '" records change only through the app\'s operations, which keep stock and history in step. Use ' + (OPS_ONLY[name] || 'the app operations') + ' (see app.guide).',
  );
}

module.exports = { checkCode: checkCode, checkCategory: checkCategory, checkSupplier: checkSupplier, OPS_ONLY: OPS_ONLY, refuse: refuse };
