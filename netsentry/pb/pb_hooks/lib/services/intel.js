/**
 * Intel service — CVE facts (KEV, EPSS) and blocklist indicators, and the
 * lookups collectors and rules need from them.
 */
const repo = require('../infra/repo.js');
const { cidrContains } = require('../core/targets.js');

function createIntel(app) {
  const cveMemo = {};
  let cidrs = null;

  return {
    get(cve) {
      const key = String(cve).toUpperCase();
      if (key in cveMemo) return cveMemo[key];
      const r = repo.first(app, 'intel', 'cve = {:c}', { c: key });
      cveMemo[key] = r
        ? { kev: r.getBool('kev'), kev_name: r.getString('kev_name'), epss: r.getFloat('epss') || null }
        : null;
      return cveMemo[key];
    },

    listingsFor(asset) {
      const out = [];
      if (asset.kind === 'ip') {
        for (const r of repo.find(app, 'indicators', 'type = "ip" && value = {:v}', { v: asset.identifier })) {
          out.push({ list: r.getString('source'), match: r.getString('value') });
        }
        if (cidrs === null) {
          cidrs = repo.find(app, 'indicators', 'type = "cidr"').map((r) => ({ list: r.getString('source'), value: r.getString('value') }));
        }
        for (const c of cidrs) if (cidrContains(c.value, asset.identifier)) out.push({ list: c.list, match: c.value });
      } else {
        for (const r of repo.find(app, 'indicators', 'type = "domain" && value = {:v}', { v: asset.identifier })) {
          out.push({ list: r.getString('source'), match: r.getString('value') });
        }
      }
      const seen = {};
      return out.filter((l) => (seen[l.list] ? false : (seen[l.list] = true)));
    },

    /** Blocklist entries matching a remote address (exact IP or containing CIDR). */
    matchIp(ip) {
      return this.listingsFor({ kind: 'ip', identifier: String(ip) });
    },

    /** Blocklist entries matching a name or any parent domain (evil.example.com is under example.com). */
    matchDomain(name) {
      const labels = String(name).toLowerCase().replace(/\.$/, '').split('.');
      const out = [];
      for (let i = 0; i < labels.length - 1; i++) {
        const candidate = labels.slice(i).join('.');
        for (const r of repo.find(app, 'indicators', 'type = "domain" && value = {:v}', { v: candidate })) {
          out.push({ list: r.getString('source'), match: candidate });
        }
      }
      return out;
    },

    blocklistsLoaded() {
      return repo.first(app, 'indicators', 'id != ""') !== null;
    },

    seenCves() {
      const set = {};
      for (const r of repo.find(app, 'observations', 'kind = "host.exposure" && present = true')) {
        const d = repo.jsonOf(r, 'data');
        for (const c of (d && d.vulns) || []) set[String(c).toUpperCase()] = true;
      }
      for (const r of repo.find(app, 'observations', 'kind = "code.vulnerable_dependency" && present = true')) {
        const d = repo.jsonOf(r, 'data');
        for (const v of (d && d.vulns) || []) for (const c of v.aliases || []) set[String(c).toUpperCase()] = true;
      }
      return Object.keys(set).sort().slice(0, 2000);
    },
  };
}

function loadIntelMap(app) {
  const map = {};
  for (const r of repo.find(app, 'intel', 'id != ""')) map[r.getString('cve')] = r;
  return map;
}

function applyKev(app, list, now) {
  const map = loadIntelMap(app);
  const listed = {};
  for (const k of list) {
    listed[k.cve] = true;
    const r = map[k.cve];
    if (r && r.getBool('kev') && r.getString('kev_added') === k.added) continue;
    if (r) repo.update(app, r, { kev: true, kev_name: k.name, kev_added: k.added, refreshed_at: now });
    else repo.create(app, 'intel', { cve: k.cve, kev: true, kev_name: k.name, kev_added: k.added, refreshed_at: now });
  }
  for (const cve of Object.keys(map)) {
    const r = map[cve];
    if (r.getBool('kev') && !listed[cve]) repo.update(app, r, { kev: false, refreshed_at: now });
  }
}

function applyEpss(app, scores, now) {
  const map = loadIntelMap(app);
  for (const s of scores) {
    if (!(s.epss >= 0 && s.epss <= 1)) continue;
    const r = map[s.cve];
    if (r) repo.update(app, r, { epss: s.epss, epss_percentile: s.percentile, refreshed_at: now });
    else repo.create(app, 'intel', { cve: s.cve, epss: s.epss, epss_percentile: s.percentile, refreshed_at: now });
  }
}

/** Replace each named list with its fresh contents; lists not included are left alone. */
function replaceIndicators(app, lists, now) {
  const summary = {};
  for (const source of Object.keys(lists)) {
    const existing = {};
    for (const r of repo.find(app, 'indicators', 'source = {:s}', { s: source })) {
      existing[r.getString('type') + '|' + r.getString('value')] = r;
    }
    const fresh = {};
    let added = 0;
    for (const item of lists[source]) {
      const key = item.type + '|' + item.value;
      if (fresh[key]) continue;
      fresh[key] = true;
      if (!existing[key]) {
        repo.create(app, 'indicators', { type: item.type, value: item.value, source, refreshed_at: now });
        added++;
      }
    }
    let removed = 0;
    for (const key of Object.keys(existing)) {
      if (!fresh[key]) {
        app.delete(existing[key]);
        removed++;
      }
    }
    summary[source] = { total: Object.keys(fresh).length, added, removed };
  }
  return summary;
}

module.exports = { createIntel, applyKev, applyEpss, replaceIndicators };
