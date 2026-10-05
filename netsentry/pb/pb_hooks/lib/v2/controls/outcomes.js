/**
 * Outcome checks for apps: updates (UPD-APP-SECURITY), backups (BKP-NONE,
 * BKP-STALE) and uptime (UP-APP-DOWN). Pure evaluators.
 */
const versions = require('../versions.js');
const { day, span, plural } = require('../content.js');
const { worst, RANK, variantOf } = require('./util.js');

// ---------------------------------------------------------------- updates

/** The release line a version belongs to: "8.5.10" → "8.5". */
function line(v) {
  return String(versions.normalise(v)).split('-')[0].split('.').slice(0, 2).join('.');
}

/**
 * Is `version` already fixed, by the advisory's own patched versions ("9.2.4, 8.5.15")?
 * A fix on the same release line decides; otherwise any newer fixed release does.
 */
function fixedBy(version, patchedList) {
  const ps = patchedList.filter((p) => versions.normalise(p));
  if (!ps.length) return false;
  const same = ps.filter((p) => line(p) === line(version));
  if (same.length) return same.some((p) => versions.compare(version, p) >= 0);
  return ps.some((p) => versions.compare(version, p) >= 0);
}

/** Only a lower bound (">= 9.2.0"): the range alone can't say where the fix is. */
function openEnded(range) {
  const parts = String(range || '').split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((x) => /^>/.test(x));
}

/**
 * Advisories (GitHub repository-advisory shape) that affect `version`.
 * Maintainers write ranges by hand and often give only where the hole starts, with the fix
 * in `patched_versions` — so a version is affected only when it is in the range AND not
 * already fixed; an open-ended range with no fix listed is never counted (can't tell).
 */
function affecting(advisories, version) {
  const out = [];
  for (const a of advisories || []) {
    if (a.withdrawn_at) continue;
    let hit = false;
    let patched = '';
    for (const v of a.vulnerabilities || []) {
      const range = v.vulnerable_version_range;
      if (versions.inRange(version, range) !== true) continue;
      const fixes = String(v.patched_versions || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (fixedBy(version, fixes)) continue;
      if (!fixes.length && openEnded(range)) continue;
      hit = true;
      patched = patched || fixes.find((f) => line(f) === line(version)) || fixes[0] || '';
    }
    if (hit) out.push({ id: a.ghsa_id, cve: a.cve_id || '', severity: a.severity || 'unknown', summary: String(a.summary || '').slice(0, 160), patched, url: a.html_url || '' });
  }
  const order = (s) => (s in RANK ? RANK[s] : -1);
  return out.sort((x, y) => order(y.severity) - order(x.severity));
}

const updAppSecurity = {
  id: 'UPD-APP-SECURITY',
  version: 2,
  outcome: 'updates',
  subject: 'app',
  title: 'A security update is available for the app',
  appliesTo: (app) => !!(app.entry.updates && app.entry.updates.github),
  evaluate(app, ctx) {
    const intel = ctx.intel(app.app_type);
    if (!app.version) return { state: 'unknown', reason: `we can't tell which version of ${app.entry.name} runs here`, facts: {} };
    if (!intel || !intel.fetched_at) return { state: 'unknown', reason: "we haven't checked for updates yet", facts: { version: app.version } };
    const latest = versions.normalise(intel.latest_version);
    const hits = affecting(intel.advisories, app.version);
    const facts = { version: app.version, latest, latest_date: intel.latest_published ? day(intel.latest_published) : '', source: intel.advisory_source, advisories: (intel.advisories || []).length };
    const evidence = { version: app.version, latest, affected: hits, source: intel.advisory_source, fetched_at: intel.fetched_at };
    if (!hits.length) return { state: 'pass', facts, evidence };
    const counts = {};
    for (const h of hits) counts[h.severity] = (counts[h.severity] || 0) + 1;
    const top = hits[0];
    const fixedIn = hits.reduce((m, h) => (h.patched && (!m || versions.compare(h.patched, m) > 0) ? h.patched : m), '');
    Object.assign(facts, { count: hits.length, counts, top_summary: top.summary, fixed_in: fixedIn });
    const sev = worst(hits.map((h) => (h.severity in RANK ? h.severity : 'medium')));
    const internet = app.reach.vantages.indexOf('internet') >= 0;
    return {
      state: 'fail',
      severity: sev,
      factors: [plural(hits.length, 'known security hole'), `worst: ${top.severity}`].concat(internet ? ['reachable from the internet'] : []),
      facts,
      evidence,
    };
  },
  text: {
    title: (f, app) => `${app.name} needs a security update (${plural(f.count, 'known hole')})`,
    saw(f, app) {
      const parts = ['critical', 'high', 'medium', 'low'].filter((s) => f.counts[s]).map((s) => `${f.counts[s]} ${s}`);
      return [
        `You run ${app.name} ${f.version}. The latest is ${f.latest}${f.latest_date ? `, released ${f.latest_date}` : ''}.`,
        `Security fixes you're missing: ${parts.join(', ')}. The details are under Technical details.`,
      ];
    },
    means: (f, app) =>
      `The ${app.entry.name} team has published fixes for these problems, so they are known to attackers too. Updating to ${f.fixed_in || f.latest} or later closes them.`,
    steps(f, app, ctx) {
      const variant = variantOf(app, ctx.machine);
      const how = app.entry.updates.how[variant] || app.entry.updates.how.docker_compose;
      return { variant, list: ['Back up first if you can (settings and user data).'].concat(how(app)) };
    },
    verify: (f, app) => `After the update, NetSentry reads the new version from ${app.name} on its next check and this turns green.`,
    pass: (f, app) =>
      f.advisories ? `${app.name} ${f.version}: no published security holes affect it` : `${app.name} ${f.version}: its makers have published no security advisories`,
    unknown: (f, app) => `${app.name}: can't tell yet if it needs a security update`,
  },
  references: ['https://docs.github.com/en/rest/security-advisories/repository-advisories'],
};

// ---------------------------------------------------------------- backups

const bkpNone = {
  id: 'BKP-NONE',
  version: 3,
  outcome: 'backups',
  subject: 'app',
  title: "The app's data isn't backed up",
  appliesTo: (app) => !!(app.entry.data && app.entry.data.important && app.entry.data.important.length),
  evaluate(app, ctx) {
    const plans = ctx.backupsFor(app);
    const verified = plans.filter((p) => p.method !== 'declared');
    const facts = { important: app.entry.data.important, plans: plans.map((p) => p.name) };
    const evidence = { plans: plans.map((p) => ({ id: p.id, name: p.name, method: p.method, last_success: p.last_success || '', last_failure: p.last_failure || '' })) };
    // Covered means a copy OF THIS APP exists and nothing newer failed. NetSentry's own plans know each app's
    // copies and failed runs; an external (heartbeat) plan only knows itself, so it counts as a whole.
    const judged = verified.map((p) => {
      if (p.method !== 'netsentry' || !p.copyOf) return { p, ok: !!p.last_success, copy: p.last_success || '', fail: null };
      const copy = p.copyOf(app.key);
      const fail = p.failureOf(app.key);
      return { p, ok: !!copy && !(fail && fail.at > copy), copy, fail: fail && (!copy || fail.at > copy) ? fail : null };
    });
    if (judged.some((j) => j.ok)) return { state: 'pass', facts, evidence };
    const failed = judged.find((j) => j.fail);
    if (failed) {
      return { state: 'fail', severity: failed.copy ? 'medium' : 'high', factors: [failed.copy ? 'its last backup failed' : 'its backup has never worked'],
        facts: Object.assign(facts, { failed: true, plan: failed.p.name, why: failed.fail.why, at: failed.fail.at, copy: failed.copy }), evidence };
    }
    const late = judged.find((j) => j.p.method === 'netsentry' && !j.copy && Date.parse(ctx.now) - Date.parse(j.p.created) > ((j.p.schedule_hours || 24) + (j.p.grace_hours || 6)) * 3600000);
    if (late) return { state: 'fail', severity: 'high', factors: ['no backup made yet'], facts: Object.assign(facts, { failed: true, plan: late.p.name, why: '', at: '', copy: '' }), evidence };
    if (verified.length) return { state: 'unknown', reason: 'waiting for its first backup', facts, evidence };
    if (plans.length) return { state: 'unknown', reason: 'you told us it is backed up; NetSentry cannot see the backups run', facts, evidence };
    return { state: 'fail', severity: 'medium', factors: ['no backup NetSentry can see'], facts, evidence };
  },
  text: {
    title: (f, app) => (f.failed ? (f.copy ? `${app.name}'s backup is failing` : `${app.name} hasn't been backed up yet`) : `Nothing backs up ${app.name}`),
    saw: (f, app) =>
      f.failed
        ? [
            f.copy ? `Its last good copy is from ${f.copy.slice(0, 10)}.` : `The backup "${f.plan}" hasn't made a copy of ${app.name} yet.`,
          ].concat(f.why ? [`The last try failed: ${f.why}`] : [])
        : [`NetSentry knows of no backup that includes ${app.name}.`, `What matters: ${f.important.join('; ')}.`],
    means: (f, app) =>
      `If the disk fails, or ransomware or a bad update hits, you lose ${app.entry.data.lose || 'its data'}, and have to set ${app.name} up again from scratch.`,
    steps: (f, app) => ({
      variant: 'app',
      list: f.failed
        ? [
            'Check the backup folder is there and has free space (the disk is plugged in, the NAS share is mounted).',
            `Back ${app.name} up by hand (${app.name} → Backups → Back up now) — the result says what went wrong.`,
          ]
        : [
        'Choose where backups go: a USB drive, another computer, or cloud storage.',
        `In NetSentry, add a backup for ${app.name} (Backups → Add). You get a private link.`,
        'Make your backup job open that link when it finishes — NetSentry then knows every backup that worked, and tells you when one is missed.',
      ],
    }),
    verify: (f, app) => `This turns green as soon as a backup that covers ${app.name} checks in.`,
    pass: (f, app) => `${app.name} is covered by a backup NetSentry can see`,
    unknown: (f, app) => `${app.name}: backed up (you told us) — NetSentry can't see it run`,
  },
  references: [],
};

const bkpStale = {
  id: 'BKP-STALE',
  version: 4,
  outcome: 'backups',
  subject: 'backup_plan',
  title: "A backup hasn't finished on time",
  // NetSentry's own backups are judged per app (BKP-NONE); this is for backups another tool runs.
  appliesTo: (plan) => plan.method === 'heartbeat',
  evaluate(plan, ctx) {
    const dueEvery = (plan.schedule_hours || 24) + (plan.grace_hours || 0);
    const last = plan.last_success || '';
    const since = last || plan.created;
    const overdueMs = Date.parse(ctx.now) - Date.parse(since) - dueEvery * 3600000;
    const facts = { name: plan.name, last, created: plan.created, schedule_hours: plan.schedule_hours || 24, last_failure: plan.last_failure || '', note: plan.last_note || '' };
    const evidence = { last_success: last, last_failure: plan.last_failure || '', expected_every_hours: dueEvery };
    // The last run failed (and nothing worked since): that's a problem now, not when it's overdue.
    const failedLast = !!plan.last_failure && (!last || plan.last_failure > last);
    if (failedLast) return { state: 'fail', severity: last ? 'medium' : 'high', factors: [last ? 'the last backup failed' : 'no backup has worked yet'], facts: Object.assign(facts, { failed: true }), evidence };
    if (overdueMs <= 0) return { state: last ? 'pass' : 'unknown', reason: last ? '' : 'waiting for the first backup', facts, evidence };
    const missed = Math.floor(overdueMs / ((plan.schedule_hours || 24) * 3600000)) + 1;
    return { state: 'fail', severity: missed >= 2 ? 'high' : 'medium', factors: [plural(missed, 'backup') + ' missed'], facts: Object.assign(facts, { missed }), evidence };
  },
  text: {
    title: (f) => (f.failed ? (f.last ? `Backup "${f.name}" failed` : `Backup "${f.name}" hasn't worked yet`) : f.last ? `Backup "${f.name}" hasn't finished since ${day(f.last)}` : `Backup "${f.name}" has never checked in`),
    saw: (f, plan, ctx) =>
      [
        f.last ? `Its last successful run was ${span(f.last, ctx.now)} ago (${day(f.last)}).` : `It was set up ${span(f.created, ctx.now)} ago and no run has checked in yet.`,
        `It should finish every ${plural(f.schedule_hours, 'hour')}.`,
      ].concat(f.last_failure ? [`It reported a failure on ${day(f.last_failure)}${f.note ? `: ${f.note}` : ''}.`] : []),
    means: () => 'Everything changed since the last good backup would be lost if the disk failed today.',
    steps: (f, plan) => ({
      variant: 'backup',
      list:
        plan.method === 'netsentry'
          ? [
              `Check that ${plan.destination || 'the backup folder'} is there on the server and has free space (the disk is plugged in, the NAS share is mounted).`,
              'Make sure changes are switched on at that server and its monitor is running.',
              'Back it up by hand (the app → Backups → Back up now) — the result says what went wrong.',
            ]
          : [
              'Check that the backup destination is connected and has free space (USB drive plugged in, other computer on).',
              'Run the backup job by hand and look at its log for the error.',
              "Make sure the job still opens NetSentry's link at the end — if the link changed, copy it again from Backups.",
            ],
    }),
    verify: () => 'This turns green the moment the next successful backup checks in.',
    pass: (f) => `Backup "${f.name}" finished on time (last: ${day(f.last)})`,
    unknown: (f) => `Backup "${f.name}": waiting for its first run`,
  },
  references: [],
};

// v3 M4: a copy nobody ever restored is a hope, not a backup.
const bkpUntested = {
  id: 'BKP-RESTORE-UNTESTED',
  version: 1,
  outcome: 'backups',
  subject: 'backup_plan',
  title: "A backup's restore hasn't been tested",
  appliesTo: (plan) => plan.method === 'netsentry' && !!plan.last_success,
  evaluate(plan, ctx) {
    const every = (plan.test_every_days || 30) + 7;
    const failed = /^failed/i.test(plan.last_test_result || '');
    const age = plan.last_test ? (Date.parse(ctx.now) - Date.parse(plan.last_test)) / 86400000 : null;
    const facts = { name: plan.name, last_test: plan.last_test || '', result: plan.last_test_result || '', every: plan.test_every_days || 30, failed };
    if (failed) return { state: 'fail', severity: 'high', factors: ['the last restore test failed'], facts, evidence: { last_test: plan.last_test, result: plan.last_test_result } };
    if (age === null) {
      const sinceFirst = (Date.parse(ctx.now) - Date.parse(plan.created)) / 86400000;
      return sinceFirst > every ? { state: 'fail', severity: 'low', factors: ['never tested'], facts, evidence: {} } : { state: 'unknown', reason: 'the first restore test runs within a month of the first copy', facts };
    }
    if (age > every) return { state: 'fail', severity: 'low', factors: [`last tested ${Math.round(age)} days ago`], facts, evidence: { last_test: plan.last_test } };
    return { state: 'pass', facts, evidence: { last_test: plan.last_test } };
  },
  text: {
    title: (f) => (f.failed ? `Backup "${f.name}" would not restore cleanly` : `Backup "${f.name}" hasn't been test-restored lately`),
    saw: (f) => (f.failed ? [`The last restore test (${day(f.last_test)}) found: ${f.result.replace(/^failed:?\s*/i, '')}.`] : [f.last_test ? `The last restore test was on ${day(f.last_test)}.` : 'No restore test has run yet.']),
    means: (f) => (f.failed ? "If you needed this backup today, it might not bring the app back." : "Copies can be incomplete or damaged without anyone noticing until the day they're needed."),
    steps: () => ({ variant: 'backup', list: ['Test it now: the app → Backups → Test a restore.', 'If it fails: make a new backup now (Back up now), then test that one.'] }),
    verify: () => 'This turns green after a restore test passes.',
    pass: (f) => `Backup "${f.name}": restore tested ${day(f.last_test)}`,
    unknown: (f) => `Backup "${f.name}": its first restore test is coming`,
  },
  references: [],
};

// ----------------------------------------------------------------- uptime

const DOWN_MINUTES = { critical: 3, normal: 10, low: 30 };

/** Why a container stopped, from its last state: { code, oom, at }. */
function stopReason(app, ctx) {
  const h = ctx.machine && ctx.machine.obs ? ctx.machine.obs('container.health').find((o) => o.subject === app.container) : null;
  const d = (h && h.data) || {};
  return { code: typeof d.exit_code === 'number' ? d.exit_code : null, oom: !!d.oom_killed || d.exit_code === 137, at: d.finished_at && !/^0001-/.test(d.finished_at) ? d.finished_at : '' };
}

function stopWords(f) {
  if (f.oom) return 'it ran out of memory';
  if (f.code === 0) return 'it was stopped (by a person or a shutdown)';
  if (typeof f.code === 'number') return `it ended with error code ${f.code}`;
  return '';
}

const upAppDown = {
  id: 'UP-APP-DOWN',
  version: 2,
  outcome: 'uptime',
  subject: 'app',
  title: 'The app is down',
  appliesTo: () => true,
  evaluate(app, ctx) {
    const limit = DOWN_MINUTES[app.importance] || 10;
    if (!app.running) {
      // A crash loop is UP-RESTART-LOOP's (one problem, one issue) — when the machine reports container numbers.
      const loop = (ctx.machine.metrics || {})[app.container] || [];
      const restarting = loop.slice(-3).some((s) => s.state === 'restarting');
      if (restarting && ctx.machine.sources.some((s) => s.collector === 'host.container_stats' && s.last_run)) {
        return { state: 'not_applicable', reason: 'it keeps restarting — see "keeps restarting"', facts: {} };
      }
      const why = app.container ? stopReason(app, ctx) : { code: null, oom: false, at: '' };
      return { state: 'fail', severity: app.importance === 'critical' ? 'high' : 'medium', factors: ['stopped'], facts: { stopped: true, since: why.at, code: why.code, oom: why.oom }, evidence: { running: false, exit_code: why.code, oom: why.oom, stopped_at: why.at } };
    }
    const statuses = app.status || [];
    if (!statuses.length) return { state: app.endpoints.length ? 'unknown' : 'not_applicable', reason: "we haven't checked it yet", facts: {} };
    const down = statuses.filter((s) => s.data && s.data.up === false);
    if (!down.length) return { state: 'pass', facts: {}, evidence: { statuses } };
    const since = down[0].data.since;
    const minutes = (Date.parse(ctx.now) - Date.parse(since)) / 60000;
    const facts = { since, where: down[0].subject, stopped: false };
    if (minutes < limit) return { state: 'pass', reason: `not answering for ${Math.round(minutes)} min (alert after ${limit})`, facts, evidence: { statuses } };
    return { state: 'fail', severity: app.importance === 'critical' ? 'high' : 'medium', factors: [`down for ${span(since, ctx.now)}`], facts, evidence: { statuses } };
  },
  text: {
    title: (f, app, ctx) => (f.stopped ? `${app.name} is stopped` : `${app.name} is down — not answering for ${span(f.since, ctx.now)}`),
    saw: (f, app, ctx) =>
      f.stopped
        ? [`${app.name}'s container on ${ctx.machine.name} is not running${f.since ? ` (since ${f.since.slice(11, 16)} UTC, ${day(f.since)})` : ''}.`].concat(stopWords(f) ? [`It stopped because ${stopWords(f)}.`] : [])
        : [`${app.name} stopped answering at ${f.since.slice(11, 16)} UTC (${day(f.since)}).`],
    means: (f, app) => `Nobody can use ${app.name} until it runs again.`,
    steps: (f, app) => ({
      variant: app.container ? 'docker' : 'service',
      list: app.container
        ? [`See why it stopped: ${app.name} → Logs in NetSentry (or: docker logs --tail 50 ${app.container}).`].concat(f.oom ? ['It needs more memory than it gets: raise or remove its memory limit, or stop something else.'] : []).concat([
            app.compose_service ? `Start it again: ${app.name} → Start, or docker compose up -d ${app.compose_service}` : `Start it again: ${app.name} → Start, or docker start ${app.container}`,
          ])
        : [`Restart ${app.name} (its service or app), then check its log for the reason it stopped.`],
    }),
    verify: (f, app) => `NetSentry checks ${app.name} every few minutes; this turns green once it answers again.`,
    pass: (f, app) => `${app.name} is up`,
    unknown: (f, app) => `We haven't checked whether ${app.name} is up yet`,
  },
  references: [],
};

module.exports = { controls: [updAppSecurity, bkpNone, bkpStale, bkpUntested, upAppDown], affecting };
