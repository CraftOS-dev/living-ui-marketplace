/// <reference path="../pb_data/types.d.ts" />
/**
 * Sealed fields: bank account numbers, IBANs and identity numbers (national
 * IDs, My Number, passports) are stored encrypted (AES-256-GCM through
 * $security.encrypt) with a masked copy for screens. The key lives in
 * APP/.seal-key (32 random bytes as hex, made at first boot), never in the
 * database and never logged; a backup of pb_data alone cannot open them.
 * Reading a sealed value is the confirm op seal.reveal (approval PIN,
 * audited without the value, shown for five minutes).
 */

const PREFIX = 'v1:';
const REVEAL_MINUTES = 5;

let _key = null;

function keyPath() {
  return $filepath.join(__hooks, '..', '..', '.seal-key');
}

/** Make the key file when it is missing (boot). */
function ensureKey() {
  try {
    const t = toString($os.readFile(keyPath())).trim();
    if (/^[0-9a-f]{64}$/.test(t)) return false;
    if (t !== '') throw new Error('.seal-key is not 64 hex characters; refusing to replace it');
  } catch (err) {
    if (String(err).indexOf('refusing') >= 0) throw err;
  }
  $os.writeFile(keyPath(), $security.randomStringWithAlphabet(64, '0123456789abcdef') + '\n', 0o600);
  _key = null;
  return true;
}

/** The 32-character AES key derived from the key file. */
function key() {
  if (_key === null) {
    const hex = toString($os.readFile(keyPath())).trim();
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('.seal-key is missing or damaged');
    _key = $security.sha256('hr-os-seal:' + hex).slice(0, 32);
  }
  return _key;
}

function seal(app, plain) {
  const s = String(plain === undefined || plain === null ? '' : plain);
  if (s === '') return '';
  return PREFIX + $security.encrypt(s, key());
}

function unseal(app, sealed) {
  const s = String(sealed || '');
  if (s === '') return '';
  if (s.indexOf(PREFIX) !== 0) throw new Error('unknown seal format');
  const out = $security.decrypt(s.slice(PREFIX.length), key());
  return typeof out === 'string' ? out : toString(out);
}

/** A masked form for screens: kind last4 (default) | last3 | none. */
function mask(plain, kind) {
  const s = String(plain === undefined || plain === null ? '' : plain).replace(/\s+/g, '');
  if (s === '') return '';
  const k = kind || 'last4';
  if (k === 'none') return '••••';
  const n = k === 'last3' ? 3 : 4;
  if (s.length <= n) return '••••';
  return '•••• ' + s.slice(-n);
}

/* ------------------------------------------------------------------- op */

const REVEALABLE = {
  bank_accounts: { number: 'number_sealed', iban: 'iban_sealed' },
  identity_docs: { number: 'number_sealed' },
};

/** seal.reveal: one sealed value, for five minutes (PIN checked by the dispatcher). */
function reveal(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const auth = require(`${__hooks}/lib_auth.js`);
  const people = require(`${__hooks}/lib_people.js`);
  const collection = u.oneOf(p, 'collection', Object.keys(REVEALABLE), '');
  if (collection === '') throw u.fail(400, 'collection is required', 'missing_param', { param: 'collection' });
  const field = u.str(p, 'field', 'number') || 'number';
  const column = REVEALABLE[collection][field];
  if (column === undefined) throw u.fail(400, 'field must be one of: ' + Object.keys(REVEALABLE[collection]).join(', '), 'invalid_param', { param: 'field' });
  const rec = u.byId(ctx.app, collection, u.req(p, 'id'));
  if (rec === null) throw u.fail(404, 'No such record.', 'not_found');
  const employeeId = rec.getString('employee');
  const own = auth.selfEmployee(ctx) === employeeId;
  const emp = ctx.app.findRecordById('employees', employeeId);
  const allowed = own || (people.canSeeEmployee(ctx, emp) && (collection === 'bank_accounts' ? auth.can(ctx, 'payroll', 'edit') || auth.can(ctx, 'people', 'full') : auth.can(ctx, 'people', 'full')));
  if (!allowed) throw u.fail(403, 'You cannot see this number.', 'not_permitted');
  const value = unseal(ctx.app, rec.getString(column));
  require(`${__hooks}/lib_audit.js`).note(ctx, { collection: collection, record: rec.id, summary: 'Revealed the ' + field + ' of ' + (collection === 'bank_accounts' ? 'a bank account' : 'an identity document') + ' of ' + people.displayName(emp) });
  return { value: value, visible_until: new Date(Date.now() + REVEAL_MINUTES * 60000).toISOString(), minutes: REVEAL_MINUTES };
}

module.exports = { ensureKey: ensureKey, seal: seal, unseal: unseal, mask: mask, reveal: reveal, REVEAL_MINUTES: REVEAL_MINUTES };
