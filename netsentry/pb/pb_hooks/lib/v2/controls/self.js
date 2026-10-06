/**
 * NetSentry's own health on each machine (plan §16.10, P5). NS-MONITOR-SILENT
 * lives with the machine checks and NS-CLOUD-ACCESS / NS-IDENTITY-TOO-BROAD
 * with the cloud ones; NetSentry's own console is an app in the catalogue, so
 * its exposure is the ordinary reach check (NS-SELF-EXPOSED). These are the rest.
 */
const { day, span, plural } = require('../content.js');
const catalogue = require('../catalogue/index.js');

// When this app's knowledge (catalogue, checks) was last brought up to date — bump with each release.
const CATALOGUE_DATE = '2026-09-30';
const CATALOGUE_MAX_DAYS = 180;

const stepsRestart = (m, extra) => ({
  variant: m.variant,
  list: [
    `On ${m.name}, look at the monitor's recent output for errors next to these parts (sudo journalctl -u netsentry-sensor -n 100).`,
  ].concat(extra || ['Restart the monitor; if a part keeps failing, it usually lost a permission it needs (the output says which).']),
});

const staleData = {
  id: 'NS-STALE-DATA',
  version: 1,
  outcome: 'self',
  subject: 'machine',
  title: 'Part of the monitor stopped reporting',
  appliesTo: (m) => !!(m.sensor && m.sensor.online),
  evaluate(m) {
    // Parts a monitor older than NetSentry doesn't have are NS-MONITOR-OLD's, not late.
    const stale = Object.entries(m.stale || {}).filter(([, s]) => !s.older).map(([collector, s]) => ({ collector, label: s.label, last_run: s.last_run }));
    const facts = { stale };
    if (!stale.length) return { state: 'pass', facts, evidence: {} };
    return { state: 'fail', severity: 'medium', factors: [`${plural(stale.length, 'part')} out of date`], facts, evidence: { stale } };
  },
  text: {
    title: (f, m) => `NetSentry's view of ${m.name} is out of date (${plural(f.stale.length, 'part')})`,
    saw: (f) => f.stale.map((s) => `${s.label}: ${s.last_run ? `last reported ${day(s.last_run)}` : 'never reported'}.`),
    means: (f, m) => `The checks that rest on these can't say "fine" any more — they show "can't tell" until the monitor on ${m.name} reports them again.`,
    steps: (f, m) => stepsRestart(m),
    verify: () => 'This turns green as soon as every part reports again.',
    pass: (f, m) => `Every part of the monitor on ${m.name} is reporting on time`,
    unknown: (f, m) => `We can't tell yet whether the monitor on ${m.name} reports on time`,
  },
  references: [],
};

/** "0.3.1" → [0, 3, 1]; compares numerically. */
function newer(a, b) {
  const x = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

const monitorOld = {
  id: 'NS-MONITOR-OLD',
  version: 1,
  outcome: 'self',
  subject: 'machine',
  title: 'The monitor is older than NetSentry',
  appliesTo: (m) => !!(m.sensor && m.sensor.online && m.consoleVersion),
  evaluate(m) {
    const missing = Object.entries(m.stale || {}).filter(([, s]) => s.older).map(([collector, s]) => ({ collector, label: s.label }));
    const behind = newer(m.consoleVersion, m.sensor.version);
    const facts = { have: m.sensor.version || 'unknown', want: m.consoleVersion, missing, manage: !!m.manageOn };
    if (!behind && !missing.length) return { state: 'pass', facts, evidence: {} };
    return { state: 'fail', severity: missing.length ? 'medium' : 'low', factors: [`monitor ${facts.have}, NetSentry ${facts.want}`], facts, evidence: { missing } };
  },
  text: {
    title: (f, m) => `The monitor on ${m.name} is older than NetSentry`,
    saw: (f) =>
      [`The monitor is version ${f.have}; NetSentry is ${f.want}.`].concat(
        f.missing.length ? [`It can't report ${plural(f.missing.length, 'part')} yet: ${f.missing.slice(0, 4).map((x) => x.label.toLowerCase()).join('; ')}.`] : [],
      ),
    means: () => "Checks that need what it can’t report show “can’t tell”, and fixes added since its version aren’t available on this server.",
    // Never pushed from the console: new monitor code is only ever installed at the machine (a console
    // that could replace the monitor's code could do anything there — see docs/SYSTEM-V3-PLAN.md §15).
    steps: (f, m) => ({
      variant: m.variant,
      list: [
        `Update the monitor on ${m.name}: run the install command from Settings → Monitor again on it (it keeps the server's identity and settings).`,
        "If you run it from a copy of NetSentry's code, restart it from the updated code.",
      ],
    }),
    verify: () => 'This turns green once the monitor reports the new version.',
    pass: (f, m) => `The monitor on ${m.name} is up to date`,
    unknown: (f, m) => `We can't tell which monitor version runs on ${m.name}`,
  },
  references: [],
};

const sourceFailing = {
  id: 'NS-SOURCE-FAILING',
  version: 1,
  outcome: 'self',
  subject: 'machine',
  title: 'Part of the monitor keeps failing',
  appliesTo: (m) => !!(m.sensor && m.sensor.online),
  evaluate(m) {
    const failing = (m.sources || []).filter((s) => s.enabled && s.health === 'failing').map((s) => ({ label: s.label, error: s.error || '' }));
    const facts = { failing };
    if (!failing.length) return { state: 'pass', facts, evidence: {} };
    return { state: 'fail', severity: 'medium', factors: [`${plural(failing.length, 'part')} failing`], facts, evidence: { failing } };
  },
  text: {
    title: (f, m) => `Part of the monitor on ${m.name} keeps failing (${plural(f.failing.length, 'part')})`,
    saw: (f) => f.failing.map((s) => `${s.label}${s.error ? `: ${s.error.slice(0, 160)}` : ' keeps failing.'}`),
    means: () => "The checks that rest on it can't be trusted until it works again.",
    steps: (f, m) => stepsRestart(m),
    verify: () => 'This turns green as soon as each part reports without errors.',
    pass: (f, m) => `No part of the monitor on ${m.name} is failing`,
    unknown: (f, m) => `We can't tell yet whether the monitor on ${m.name} works fully`,
  },
  references: [],
};

const permissionMissing = {
  id: 'NS-PERMISSION-MISSING',
  version: 1,
  outcome: 'self',
  subject: 'machine',
  title: 'The monitor runs without the rights some checks need',
  appliesTo: (m) => !!(m.sensor && m.sensor.online && m.sensor.capabilities),
  evaluate(m) {
    const caps = m.sensor.capabilities || {};
    const needAdmin = Object.entries(caps)
      .filter(([id, c]) => id !== 'executor' && c && c.available === false && /root|administrator|admin rights|permission/i.test(String(c.reason || '')))
      .map(([id, c]) => ({ id, reason: String(c.reason || '').slice(0, 160) }));
    const facts = { missing: needAdmin, is_admin: !!m.sensor.is_admin };
    if (!needAdmin.length) return { state: 'pass', facts, evidence: {} };
    return { state: 'fail', severity: 'low', factors: [`${plural(needAdmin.length, 'check')} can't run`], facts, evidence: { missing: needAdmin } };
  },
  text: {
    title: (f, m) => `On ${m.name}, ${plural(f.missing.length, 'check')} can't run without more rights`,
    saw: (f) => f.missing.map((x) => x.reason),
    means: (f, m) => `NetSentry can't see these parts of ${m.name}, so they are not checked at all.`,
    steps: (f, m) => ({
      variant: m.variant,
      list:
        m.variant === 'windows_gui'
          ? ['Run the NetSentry monitor as Administrator (Task Scheduler: "Run with highest privileges").']
          : ['Run the monitor as root: the systemd service installed by NetSentry already does; if you started it by hand, use sudo.'],
    }),
    verify: () => 'This turns green once the monitor reports with the rights it needs.',
    pass: (f, m) => `The monitor on ${m.name} has the rights its checks need`,
    unknown: (f, m) => `We can't tell yet what the monitor on ${m.name} can see`,
  },
  references: [],
};

const catalogueOld = {
  id: 'NS-CATALOGUE-OLD',
  version: 1,
  outcome: 'self',
  subject: 'machine',
  title: "NetSentry's knowledge of apps is getting old",
  appliesTo: () => true, // v4: NetSentry runs on the server it looks after
  evaluate(m, ctx) {
    const days = Math.floor((Date.parse(ctx.now) - Date.parse(CATALOGUE_DATE)) / 86400000);
    const facts = { date: CATALOGUE_DATE, days, apps: catalogue.ALL.length };
    if (days <= CATALOGUE_MAX_DAYS) return { state: 'pass', facts, evidence: facts };
    return { state: 'fail', severity: 'low', factors: [`${days} days old`], facts, evidence: facts };
  },
  text: {
    title: (f) => `NetSentry's app knowledge is ${f.days} days old — update it`,
    saw: (f) => [`What NetSentry knows about ${f.apps} apps (how to recognise them, their known problems) dates from ${day(f.date)}.`],
    means: () => 'New versions of your apps may change what is safe, and new apps are not recognised until NetSentry is updated.',
    steps: () => ({ variant: 'any', list: ['Update NetSentry from the CraftBot marketplace (Agent Apps → NetSentry → Update). Your data stays.'] }),
    verify: () => 'This turns green after the update.',
    pass: (f) => `NetSentry's app knowledge is up to date (${day(f.date)})`,
    unknown: () => "We can't tell how old NetSentry's app knowledge is",
  },
  references: [],
};

module.exports = [staleData, monitorOld, sourceFailing, permissionMissing, catalogueOld];
module.exports.CATALOGUE_DATE = CATALOGUE_DATE;
