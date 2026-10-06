/**
 * Versions as apps publish them ("v12.1", "release-5.2.4", "10.10.7",
 * "12.0-RC5") and the ranges security advisories use ("< 10.11.10, > 10.9.0",
 * "<= 12.0-RC5"). Pure functions.
 */

/** "v12.1" / "release-5.2.4" / "10.10.7" → "12.1" / "5.2.4" / "10.10.7" ('' when there is no number). */
function normalise(tag) {
  const m = String(tag || '').match(/(\d+(?:\.\d+)*)(?:[-+ ]?([A-Za-z][0-9A-Za-z.]*))?/);
  if (!m) return '';
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

function parse(v) {
  const n = normalise(v);
  if (!n) return null;
  const [core, pre] = n.split('-');
  return { nums: core.split('.').map((x) => parseInt(x, 10) || 0), pre: pre || '' };
}

function comparePre(a, b) {
  if (a === b) return 0;
  if (!a) return 1; // a release is newer than any pre-release of it
  if (!b) return -1;
  const ca = a.match(/\d+|\D+/g) || [];
  const cb = b.match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const x = ca[i];
    const y = cb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny && +x !== +y) return +x < +y ? -1 : 1;
    if (!(nx && ny) && x.toLowerCase() !== y.toLowerCase()) return x.toLowerCase() < y.toLowerCase() ? -1 : 1;
  }
  return 0;
}

/** -1 | 0 | 1; null when either side is not a version. */
function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const x = pa.nums[i] || 0;
    const y = pb.nums[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

/** Does `version` fall in an advisory range like "< 10.11.10, > 10.9.0"? null when unreadable. */
function inRange(version, range) {
  const parts = String(range || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const p of parts) {
    const m = p.match(/^(<=|>=|<|>|==|=)?\s*(.+)$/);
    if (!m) return null;
    const c = compare(version, m[2]);
    if (c === null) return null;
    const op = m[1] || '=';
    const ok = op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '>=' ? c >= 0 : c === 0;
    if (!ok) return false;
  }
  return true;
}

module.exports = { normalise, compare, inRange };
