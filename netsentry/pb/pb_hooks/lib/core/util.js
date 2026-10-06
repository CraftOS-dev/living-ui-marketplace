/**
 * PURE core helpers — no PocketBase globals, so this runs under `node --test`
 * exactly as it runs in the goja hooks runtime.
 */

/** Deterministic JSON: object keys sorted, undefined dropped. Used for diffs and hashes. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function sameJson(a, b) {
  return stableStringify(a) === stableStringify(b);
}

/** A typed failure that the op dispatcher maps to an HTTP status. */
class OpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}

function uniqueSorted(values) {
  const out = [];
  const seen = {};
  for (const v of values) {
    const key = String(v);
    if (!seen[key]) {
      seen[key] = true;
      out.push(v);
    }
  }
  return out.sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
}

function daysBetween(fromIso, toIso) {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86400000;
}

module.exports = { stableStringify, sameJson, OpError, uniqueSorted, daysBetween };
