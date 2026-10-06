/**
 * DNS collector — Cloudflare DNS-over-HTTPS (JSON API, keyless).
 * Produces dns.record / dns.status (and dns.email_policy for apex domains),
 * and discovers the public IPv4 addresses a name points at.
 */
const { isPublicIPv4 } = require('../core/targets.js');
const { uniqueSorted } = require('../core/util.js');

const { DOH } = require('../../external_hosts.js');
const TYPES = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };
const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA'];

function stripDot(s) {
  return String(s).replace(/\.$/, '').toLowerCase();
}

/** TXT answers arrive as one or more quoted segments: "v=spf1 " "-all". */
function joinTxt(data) {
  const parts = String(data).match(/"((?:[^"\\]|\\.)*)"/g);
  if (!parts) return String(data);
  return parts.map((p) => p.slice(1, -1).replace(/\\"/g, '"')).join('');
}

function normalizeValue(type, data) {
  if (type === 'CNAME' || type === 'NS') return stripDot(data);
  if (type === 'MX') {
    const m = String(data).trim().split(/\s+/);
    return m.length === 2 ? m[0] + ' ' + stripDot(m[1]) : String(data);
  }
  if (type === 'TXT') return joinTxt(data);
  return String(data).trim();
}

function query(http, name, type) {
  const res = http.getJson(DOH + '?name=' + encodeURIComponent(name) + '&type=' + type, {
    headers: { accept: 'application/dns-json' },
    timeout: 10,
  });
  if (res.status !== 200 || !res.json) throw new Error(`DNS-over-HTTPS returned HTTP ${res.status} for ${name} ${type}`);
  const status = res.json.Status;
  if (status === 3) return { status: 'nxdomain', answers: [] };
  if (status !== 0) throw new Error(`DNS lookup for ${name} ${type} failed (rcode ${status})`);
  return { status: 'noerror', answers: res.json.Answer || [] };
}

function valuesOf(result, type, name) {
  const code = TYPES[type];
  const out = [];
  for (const a of result.answers) {
    if (a.type !== code) continue;
    // A/AAAA follow the CNAME chain; everything else must be for the queried name.
    if (type !== 'A' && type !== 'AAAA' && stripDot(a.name) !== name) continue;
    out.push(normalizeValue(type, a.data));
  }
  return uniqueSorted(out);
}

function dmarcPolicy(record) {
  const m = /(?:^|;)\s*p\s*=\s*([a-z]+)/i.exec(record || '');
  return m ? m[1].toLowerCase() : null;
}

function collect({ asset }, deps) {
  const name = asset.identifier;
  const apex = asset.kind === 'domain';
  const observations = [];
  const discovered = [];

  const first = query(deps.http, name, 'A');
  if (first.status === 'nxdomain') {
    observations.push({ kind: 'dns.status', subject: 'name', data: { status: 'nxdomain' } });
    return { observations, discovered, note: `${name} does not exist in DNS (NXDOMAIN).` };
  }
  observations.push({ kind: 'dns.status', subject: 'name', data: { status: 'resolves' } });

  let txtValues = [];
  for (const type of RECORD_TYPES) {
    const result = type === 'A' ? first : query(deps.http, name, type);
    const values = valuesOf(result, type, name);
    if (type === 'TXT') txtValues = values;
    if (values.length === 0) continue;
    const data = { values };
    if (type === 'CNAME') {
      const target = query(deps.http, values[0], 'A');
      data.target_status = target.status === 'nxdomain' ? 'nxdomain' : target.answers.length ? 'resolves' : 'nodata';
    }
    observations.push({ kind: 'dns.record', subject: type, data });
    if (type === 'A') {
      for (const ip of values) {
        if (isPublicIPv4(ip) && discovered.length < 20) discovered.push({ kind: 'ip', identifier: ip });
      }
    }
  }

  if (apex) {
    const spf = txtValues.filter((v) => /^v=spf1(\s|$)/i.test(v));
    observations.push({
      kind: 'dns.email_policy',
      subject: 'spf',
      data: { record: spf.length ? spf[0] : null, count: spf.length },
    });
    const dmarcRes = query(deps.http, '_dmarc.' + name, 'TXT');
    const dmarc = valuesOf(dmarcRes, 'TXT', '_dmarc.' + name).filter((v) => /^v=DMARC1/i.test(v));
    observations.push({
      kind: 'dns.email_policy',
      subject: 'dmarc',
      data: { record: dmarc.length ? dmarc[0] : null, policy: dmarc.length ? dmarcPolicy(dmarc[0]) : null },
    });
  }

  return { observations, discovered };
}

module.exports = {
  id: 'dns',
  title: 'DNS records',
  appliesTo: ['domain', 'subdomain'],
  scheduleMinutes: 360,
  kinds: (asset) => (asset.kind === 'domain' ? ['dns.record', 'dns.status', 'dns.email_policy'] : ['dns.record', 'dns.status']),
  collect,
  lookup: query,
  // exported for tests
  _internal: { joinTxt, normalizeValue, dmarcPolicy, valuesOf },
};
