/**
 * PURE — target validation and IPv4 helpers.
 */

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^[a-z][a-z0-9-]{1,62}$/;

/** IPv4 dotted quad → unsigned int, or null when not a valid address. */
function ipv4ToInt(ip) {
  if (typeof ip !== 'string') return null;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p[0] === '0') return null; // no octal-looking octets
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function isIPv4(ip) {
  return ipv4ToInt(ip) !== null;
}

function cidrContains(cidr, ip) {
  const slash = String(cidr).indexOf('/');
  if (slash < 0) return String(cidr) === ip;
  const base = ipv4ToInt(cidr.slice(0, slash));
  const bits = Number(cidr.slice(slash + 1));
  const addr = ipv4ToInt(ip);
  if (base === null || addr === null || !(bits >= 0 && bits <= 32)) return false;
  if (bits === 0) return true;
  const size = Math.pow(2, 32 - bits);
  return Math.floor(base / size) === Math.floor(addr / size);
}

const NON_PUBLIC = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15',
  '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
];

function isPublicIPv4(ip) {
  if (!isIPv4(ip)) return false;
  for (const range of NON_PUBLIC) if (cidrContains(range, ip)) return false;
  return true;
}

/** Normalise user input to a bare lowercase hostname, or return an error string. */
function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.replace(/:\d+$/, '').replace(/\.$/, '');
  if (s === '') return { error: 'Enter a domain such as example.com.' };
  if (/[^\x00-\x7f]/.test(s)) return { error: 'Use the ASCII (punycode) form of internationalised domains, e.g. xn--….' };
  if (s.length > 253) return { error: 'Domain names are at most 253 characters.' };
  const labels = s.split('.');
  if (labels.length < 2) return { error: 'Include the top-level domain, e.g. example.com.' };
  for (const l of labels) {
    if (!DOMAIN_LABEL.test(l)) return { error: `"${l}" is not a valid domain label.` };
  }
  if (!TLD.test(labels[labels.length - 1])) return { error: 'The top-level domain is not valid.' };
  return { value: s };
}

/**
 * Classify what a user typed into an addable target.
 * Returns { kind: 'domain' | 'ip', identifier } or { error }.
 */
function classifyTarget(input) {
  const raw = String(input || '').trim();
  if (raw === '') return { error: 'Enter a domain or a public IPv4 address.' };
  if (/^[\d.]+$/.test(raw)) {
    if (!isIPv4(raw)) return { error: `"${raw}" is not a valid IPv4 address.` };
    if (!isPublicIPv4(raw)) {
      return {
        error:
          `${raw} is a private or reserved address. NetSentry watches public exposure; ` +
          'internal hosts will be covered by the Sensor in a later release.',
      };
    }
    return { kind: 'ip', identifier: raw };
  }
  if (!/^[a-z]+:\/\//i.test(raw) && (raw.split(':').length > 2 || /^[0-9a-f]{1,4}:[0-9a-f]{0,4}$/i.test(raw))) {
    return { error: 'IPv6 addresses are not supported yet.' };
  }
  const d = normalizeDomain(raw);
  if (d.error) return { error: d.error };
  return { kind: 'domain', identifier: d.value };
}

/** Is `host` the apex itself or a name under it? */
function isUnder(host, apex) {
  return host === apex || host.endsWith('.' + apex);
}

module.exports = { ipv4ToInt, isIPv4, isPublicIPv4, cidrContains, normalizeDomain, classifyTarget, isUnder };
