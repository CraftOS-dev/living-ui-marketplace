/**
 * Code checks — from the monitor's opt-in code collectors (dependencies, secrets).
 */

const CODE001 = {
  id: 'CODE-001',
  version: 1,
  title: 'A secret (password, key, token) is committed in code',
  category: 'code',
  severity: 'critical',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['code.secret'],
  params: {},
  rationale:
    'Secrets in source code end up everywhere the code goes — laptops, CI logs, backups, forks. Removing the line ' +
    'is not enough: it stays in git history. The only fix is to rotate the secret. (Found by gitleaks on the host; ' +
    'the secret itself is never sent to NetSentry.)',
  remediation:
    '1. Rotate the credential at its provider NOW (revoke the old one).\n' +
    '2. Move it to an environment variable / secret manager.\n' +
    '3. Optionally purge it from git history (git filter-repo); the rotation is what makes you safe.',
  references: ['https://github.com/gitleaks/gitleaks', 'https://docs.github.com/code-security/secret-scanning'],
  evaluate(input) {
    return input.obs('code.secret').map((o) => ({
      subject: o.subject,
      title: `${o.data.description || o.data.rule} in ${o.data.project}/${o.data.file}:${o.data.line}`,
      evidence: o.data,
    }));
  },
};

const ORDER = ['low', 'medium', 'high', 'critical'];

const CODE002 = {
  id: 'CODE-002',
  version: 1,
  title: 'A dependency has a known vulnerability',
  category: 'code',
  severity: 'medium',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['code.vulnerable_dependency'],
  params: { epss_high: 0.1 },
  rationale:
    'Most breaches of web applications go through a known hole in a library, not the application\'s own code. ' +
    'The severity is raised to critical when the CVE is on CISA\'s actively-exploited list, and to high when it is ' +
    'rated high or likely to be exploited (EPSS).',
  remediation:
    '1. Upgrade the package to the fixed version shown (update the lockfile).\n' +
    '2. Run the tests and redeploy.\n3. The next dependency check confirms.',
  references: ['https://osv.dev/', 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog'],
  evaluate(input) {
    const out = [];
    for (const o of input.obs('code.vulnerable_dependency')) {
      const d = o.data;
      let sev = 'medium';
      let kev = false;
      let epss = 0;
      for (const v of d.vulns || []) {
        if (ORDER.indexOf(v.severity) > ORDER.indexOf(sev)) sev = v.severity === 'critical' ? 'high' : v.severity;
        for (const cve of v.aliases || []) {
          const i = input.intel.get(cve);
          if (!i) continue;
          if (i.kev) kev = true;
          if (i.epss && i.epss > epss) epss = i.epss;
        }
      }
      if (epss >= input.params.epss_high && ORDER.indexOf(sev) < 2) sev = 'high';
      if (kev) sev = 'critical';
      const fixed = (d.vulns || []).reduce((acc, v) => acc.concat(v.fixed || []), []).sort();
      out.push({
        subject: o.subject,
        title: `${d.name} ${d.version} (${d.ecosystem}) has ${d.vulns.length} known vulnerabilit${d.vulns.length === 1 ? 'y' : 'ies'}${kev ? ' — one is actively exploited' : ''}`,
        severity: sev,
        evidence: { package: d.name, version: d.version, ecosystem: d.ecosystem, files: d.files, fixed_in: fixed.slice(-1)[0] || null, kev, epss, vulns: (d.vulns || []).slice(0, 10) },
      });
    }
    return out;
  },
};

module.exports = [CODE001, CODE002];
