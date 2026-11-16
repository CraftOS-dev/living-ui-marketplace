/// <reference path="../pb_data/types.d.ts" />
/**
 * Sealed values: the firm's wire details and LP tax identifiers are stored
 * encrypted (AES-256-GCM through $security.encrypt) with a masked copy for
 * screens. The key lives in APP/.seal-key (32 random bytes as hex, made at
 * first boot), never in the database and never logged; a backup of pb_data
 * alone cannot open them, and your AI agent never reads them.
 *
 *   seal(app, plain) -> 'v1:...'        unseal(app, sealed) -> plain
 *   mask(plain, 'last4'|'last3'|'none') -> '•••• 1234'
 *   reveal(ctx, sealed, what) -> { value, visible_until, minutes }
 *       (for a module's confirm op: the dispatcher checked the PIN; this
 *        refuses your AI agent and writes the audit note without the value)
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
    _key = $security.sha256('venture-os-seal:' + hex).slice(0, 32);
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

/** One sealed value for five minutes (a module's confirm op calls it; the PIN was checked). */
function reveal(ctx, sealed, what) {
  const u = require(`${__hooks}/lib_util.js`);
  if (ctx.isAgent) throw u.fail(403, 'Your AI agent never reads sealed values.', 'agent_not_permitted');
  const value = unseal(ctx.app, sealed);
  require(`${__hooks}/lib_audit.js`).note(ctx, { summary: 'Revealed ' + (what || 'a sealed value') });
  return { value: value, visible_until: new Date(Date.now() + REVEAL_MINUTES * 60000).toISOString(), minutes: REVEAL_MINUTES };
}

module.exports = { ensureKey: ensureKey, seal: seal, unseal: unseal, mask: mask, reveal: reveal, REVEAL_MINUTES: REVEAL_MINUTES };
