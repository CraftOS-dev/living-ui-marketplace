/**
 * Global threat-intel collectors (no target asset). Their results are facts
 * about the world, written to the intel / indicators collections rather than
 * as observations about one asset.
 */

const { KEV, EPSS, DROP, FEODO, URLHAUS_HOSTS } = require('../../external_hosts.js');

const kev = {
  id: 'intel.kev',
  title: 'CISA Known Exploited Vulnerabilities',
  appliesTo: null,
  scheduleMinutes: 1440,
  kinds: () => [],
  collect(_input, deps) {
    const res = deps.http.getJson(KEV, { timeout: 60 });
    if (res.status !== 200 || !res.json || !Array.isArray(res.json.vulnerabilities)) {
      throw new Error(`CISA KEV feed returned HTTP ${res.status}`);
    }
    const list = res.json.vulnerabilities.map((v) => ({
      cve: String(v.cveID).toUpperCase(),
      name: String(v.vulnerabilityName || '').slice(0, 300),
      added: String(v.dateAdded || '').slice(0, 10),
    }));
    return { intel: { kev: list }, note: `${list.length} known-exploited CVEs (catalog ${res.json.catalogVersion || '?'}).` };
  },
};

const epss = {
  id: 'intel.epss',
  title: 'FIRST EPSS exploit-probability scores',
  appliesTo: null,
  scheduleMinutes: 1440,
  kinds: () => [],
  collect(_input, deps) {
    const cves = deps.intel.seenCves();
    const scores = [];
    for (let i = 0; i < cves.length; i += 50) {
      const batch = cves.slice(i, i + 50);
      const res = deps.http.getJson(EPSS + '?cve=' + batch.join(','), { timeout: 30 });
      if (res.status !== 200 || !res.json) throw new Error(`EPSS API returned HTTP ${res.status}`);
      for (const d of res.json.data || []) {
        scores.push({ cve: String(d.cve).toUpperCase(), epss: Number(d.epss), percentile: Number(d.percentile) });
      }
    }
    return { intel: { epss: scores }, note: cves.length ? `${scores.length} of ${cves.length} CVEs scored.` : 'No CVEs observed yet.' };
  },
};

/** Parse the three blocklists; each is optional so one outage does not blank the rest. */
function parseDrop(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.cidr) out.push({ type: 'cidr', value: j.cidr });
    } catch (_) {
      /* metadata or malformed line */
    }
  }
  return out;
}

function parseFeodo(json) {
  return (Array.isArray(json) ? json : []).filter((r) => r.ip_address).map((r) => ({ type: 'ip', value: String(r.ip_address) }));
}

function parseHostfile(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const parts = t.split(/\s+/);
    const host = (parts[1] || '').toLowerCase();
    if (host && host !== 'localhost') out.push({ type: 'domain', value: host });
  }
  return out;
}

const blocklists = {
  id: 'intel.blocklists',
  title: 'Blocklists (Spamhaus DROP, Feodo, URLhaus)',
  appliesTo: null,
  scheduleMinutes: 1440,
  kinds: () => [],
  collect(_input, deps) {
    const lists = {};
    const errors = [];
    const drop = deps.http.getJson(DROP, { timeout: 30 });
    if (drop.status === 200) lists['spamhaus-drop'] = parseDrop(drop.text);
    else errors.push(`Spamhaus DROP: HTTP ${drop.status}`);
    const feodo = deps.http.getJson(FEODO, { timeout: 30 });
    if (feodo.status === 200) lists['feodo'] = parseFeodo(feodo.json);
    else errors.push(`Feodo: HTTP ${feodo.status}`);
    const urlhaus = deps.http.getJson(URLHAUS_HOSTS, { timeout: 30 });
    if (urlhaus.status === 200) lists['urlhaus'] = parseHostfile(urlhaus.text);
    else errors.push(`URLhaus: HTTP ${urlhaus.status}`);
    if (Object.keys(lists).length === 0) throw new Error(errors.join('; '));
    const counts = Object.keys(lists).map((k) => `${k} ${lists[k].length}`);
    return { indicators: lists, partialError: errors.length ? errors.join('; ') : '', note: counts.join(', ') };
  },
};

module.exports = { kev, epss, blocklists, _internal: { parseDrop, parseFeodo, parseHostfile } };
