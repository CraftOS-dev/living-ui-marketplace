/**
 * PURE — alert formatting per destination, and webhook URL safety checks.
 */
const { rank } = require('./severity.js');
const { isIPv4, isPublicIPv4 } = require('./targets.js');

const EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '⚪' };
const NTFY_PRIORITY = { critical: '5', high: '4', medium: '3', low: '2', info: '1' };

function meetsSeverity(severity, minSeverity) {
  return rank(severity) >= rank(minSeverity || 'high');
}

/**
 * @param alert { severity, title, text, lines?: string[] }
 * @param format 'slack' | 'discord' | 'ntfy' | 'json'
 * @returns { body: string, headers: {} }
 */
function formatAlert(alert, format) {
  const head = `${EMOJI[alert.severity] || ''} [NetSentry · ${String(alert.severity).toUpperCase()}] ${alert.title}`.trim();
  const lines = (alert.lines || []).slice(0, 15);
  const plain = [head, alert.text || ''].concat(lines.map((l) => '• ' + l)).filter(Boolean).join('\n');
  if (format === 'slack') return { body: JSON.stringify({ text: plain }), headers: { 'content-type': 'application/json' } };
  if (format === 'discord') return { body: JSON.stringify({ content: plain.slice(0, 1900) }), headers: { 'content-type': 'application/json' } };
  if (format === 'ntfy') {
    return {
      body: [alert.text || ''].concat(lines.map((l) => '• ' + l)).join('\n') || alert.title,
      headers: {
        'content-type': 'text/plain',
        Title: `NetSentry: ${alert.title}`.slice(0, 200),
        Priority: NTFY_PRIORITY[alert.severity] || '3',
        Tags: 'shield',
      },
    };
  }
  return {
    body: JSON.stringify({ source: 'netsentry', severity: alert.severity, title: alert.title, text: alert.text || '', lines, kind: alert.kind || 'alert' }),
    headers: { 'content-type': 'application/json' },
  };
}

/** The host part of an https URL, lower-cased, without port or trailing dot. */
function hostOf(url) {
  const m = /^https:\/\/([^/?#@\s]+)/i.exec(String(url || '').trim());
  return m ? m[1].replace(/:\d+$/, '').replace(/\.+$/, '').toLowerCase() : '';
}

/** Anything numeric-looking must be a canonical dotted quad (blocks 127.1, 10.1, 0x7f.1, 2130706433). */
function looksNumeric(host) {
  return /^[0-9.]+$/.test(host) || /^0x/i.test(host) || /(^|\.)0x[0-9a-f]+/i.test(host);
}

/**
 * Admin-entered destination URLs, syntactic check: https only, no credentials,
 * no private/loopback literals, no local names. Names are ALSO resolved before
 * saving and before every send (services/alerts.js), because a public-looking
 * name can point at 127.0.0.1.
 */
function validateDestination(url) {
  const m = /^https:\/\/([^/?#@\s]+)(\/[^\s]*)?$/i.exec(String(url || '').trim());
  if (!m) return 'Use a full https:// URL (plain http and embedded credentials are not allowed).';
  const host = hostOf(url);
  if (host.startsWith('[')) return 'IPv6 literal destinations are not supported.';
  if (looksNumeric(host)) {
    if (!isIPv4(host)) return 'Write IP addresses in standard dotted form (a.b.c.d), or use a hostname.';
    if (!isPublicIPv4(host)) return 'Private, loopback and link-local addresses are not allowed as alert destinations.';
    return null;
  }
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) {
    return 'Local and internal hostnames are not allowed as alert destinations.';
  }
  if (!/\./.test(host)) return 'Use a fully qualified hostname.';
  return null;
}

/** Resolved addresses (A / AAAA answers) that a destination may use. */
function isPublicAddress(addr) {
  const a = String(addr || '').toLowerCase();
  if (isIPv4(a)) return isPublicIPv4(a);
  if (a.indexOf(':') < 0) return false;
  if (a === '::' || a === '::1') return false;
  if (/^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a)) return false; // ULA, link-local, multicast
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return isPublicIPv4(mapped[1]);
  if (/^::ffff:/.test(a) || /^64:ff9b:/.test(a)) return false; // hex-form mapped / NAT64 can embed private IPv4
  return true;
}

/** Show enough of a secret URL to recognise it, never enough to use it. */
function urlHint(url) {
  const m = /^https:\/\/([^/?#]+)(.*)$/i.exec(String(url));
  if (!m) return '';
  const tail = m[2].replace(/[?#].*$/, '');
  return m[1] + (tail.length > 4 ? '/…' + tail.slice(-4) : tail);
}

module.exports = { formatAlert, validateDestination, urlHint, meetsSeverity, hostOf, isPublicAddress, looksNumeric };
