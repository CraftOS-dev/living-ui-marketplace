/// <reference path="../pb_data/types.d.ts" />
/**
 * Background work:
 *   every minute — due sources (time-budgeted), heartbeat pings, triage re-ring
 *   hourly       — the daily digest at the configured UTC hour
 *   nightly      — retention prune
 */

cronAdd('netsentry-tick', '* * * * *', () => {
  try {
    // Self-heal: if the boot-time catalogue sync did not complete, finish it here.
    const repo = require(`${__hooks}/lib/infra/repo.js`);
    if (repo.find($app, 'rules', 'id != ""').length < require(`${__hooks}/lib/rules/index.js`).ALL.length) {
      require(`${__hooks}/lib/services/rulesconfig.js`).sync($app);
    }
    const r = require(`${__hooks}/lib/services/pipeline.js`).tick($app, 40000);
    if (r.ran || r.failed) console.log(`[netsentry] tick: ${r.ran} ok, ${r.failed} failed, ${r.queued} queued`);
  } catch (err) {
    console.error('[netsentry] tick failed:', err);
  }
  try {
    // Issues from before plain-language titles existed get one (runs once; afterwards nothing matches).
    const n = require(`${__hooks}/lib/services/findings.js`).backfillPlainTitles($app);
    if (n) console.log(`[netsentry] added plain-language titles to ${n} issue(s)`);
  } catch (err) {
    console.error('[netsentry] plain-title backfill failed:', err);
  }
  try {
    require(`${__hooks}/lib/services/remediations.js`).housekeeping($app);
  } catch (err) {
    console.error('[netsentry] remediation housekeeping failed:', err);
  }
  try {
    require(`${__hooks}/lib/services/sensors.js`).markOffline($app);
  } catch (err) {
    console.error('[netsentry] sensor liveness failed:', err);
  }
  // v2: upstream release/advisory intel (every 12 h per app type), then the time-based
  // checks (apps down, backups overdue, monitor silent) that move without new reports.
  try {
    const v2 = require(`${__hooks}/lib/services/v2.js`);
    const n = v2.refreshIntel($app);
    if (n) console.log(`[netsentry] fetched update intel for ${n} app type(s)`);
    v2.tick($app);
  } catch (err) {
    console.error('[netsentry] v2 tick failed:', err);
  }
  // Independent of scanning: a stuck scan must not silence the heartbeat.
  try {
    require(`${__hooks}/lib/services/alerts.js`).heartbeatTick($app);
  } catch (err) {
    console.error('[netsentry] heartbeat failed:', err);
  }
  try {
    require(`${__hooks}/lib/services/agentbell.js`).reringTriageIfWaiting($app);
  } catch (err) {
    console.error('[netsentry] triage re-ring failed:', err);
  }
});

cronAdd('netsentry-digest', '5 * * * *', () => {
  try {
    const repo = require(`${__hooks}/lib/infra/repo.js`);
    const settings = repo.first($app, 'settings', 'id != ""');
    if (!settings) return;
    const hour = settings.getInt('digest_hour');
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (hour < 0 || now.getUTCHours() !== hour || settings.getString('digest_last_sent') === today) return;
    repo.update($app, settings, { digest_last_sent: today });
    const alerts = require(`${__hooks}/lib/services/alerts.js`);
    const results = alerts.dispatch($app, alerts.buildDigest($app));
    require(`${__hooks}/lib/services/agentbell.js`).ring($app, 'daily_digest', {});
    console.log(`[netsentry] digest: delivered to ${results.filter((r) => r.ok).length}/${results.length} notifier(s)`);
  } catch (err) {
    console.error('[netsentry] digest failed:', err);
  }
});

// The "who has admin?" reminder for apps someone gave NetSentry a read-only key for (plan §12.4).
cronAdd('netsentry-monthly', '23 7 1 * *', () => {
  try {
    require(`${__hooks}/lib/services/accounts.js`).reviewReminder($app);
  } catch (err) {
    console.error('[netsentry] access review reminder failed:', err);
  }
});

cronAdd('netsentry-retention', '17 3 * * *', () => {
  try {
    const { SYSTEM } = require(`${__hooks}/lib/infra/actor.js`);
    require(`${__hooks}/lib/services/workspace.js`).prune($app, SYSTEM);
  } catch (err) {
    console.error('[netsentry] retention prune failed:', err);
  }
});

// v3 §7.1: minute numbers → 15-minute → hourly, and drop hourly ones past 90 days.
cronAdd('netsentry-metrics-rollup', '*/15 * * * *', () => {
  try {
    require(`${__hooks}/lib/services/metrics.js`).rollup($app);
  } catch (err) {
    console.error('[netsentry] metrics rollup failed:', err);
  }
});

// v3 §10: newer versions of the images in use (each at most every 6 h), and the maintenance windows.
cronAdd('netsentry-updates-intel', '41 * * * *', () => {
  try {
    require(`${__hooks}/lib/services/updates.js`).refreshIntel($app);
  } catch (err) {
    console.error('[netsentry] update check failed:', err);
  }
});

cronAdd('netsentry-windows', '*/5 * * * *', () => {
  try {
    require(`${__hooks}/lib/services/updates.js`).windowTick($app);
  } catch (err) {
    console.error('[netsentry] maintenance window failed:', err);
  }
});

// v3 §11: NetSentry's own backups and their monthly restore tests.
cronAdd('netsentry-backups', '7 * * * *', () => {
  try {
    require(`${__hooks}/lib/services/backupjobs.js`).tick($app);
  } catch (err) {
    console.error('[netsentry] backups failed to start:', err);
  }
});

// v4 §6, N-B11: terminal transcripts go after 90 days; files on their way to or from the server after an hour.
cronAdd('netsentry-v4-housekeeping', '29 * * * *', () => {
  try {
    require(`${__hooks}/lib/services/terminal.js`).housekeeping($app);
    const before = new Date(Date.now() - 3600000).toISOString().replace('T', ' ');
    for (const t of $app.findRecordsByFilter('file_transfers', 'created < {:b}', 'created', 500, 0, { b: before })) $app.delete(t);
  } catch (err) {
    console.error('[netsentry] v4 housekeeping failed:', err);
  }
});
