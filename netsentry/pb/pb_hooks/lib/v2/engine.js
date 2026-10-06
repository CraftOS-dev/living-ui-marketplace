/**
 * The v2 engine for one machine — pure (plan §27). Everything it needs comes
 * in `input`; the database glue lives in services/v2.js. Same input → same
 * verdicts and the same words (trust bar: deterministic).
 *
 * input = {
 *   asset: { id, identifier, label }, mode: 'home' | 'organisation', now,
 *   obs(kind) → [{ subject, data }]            present observations of the machine
 *   signals(kind) → [{ key, window_start, data }]  recent signals (last 7 days)
 *   intents: { [appKey]: { reach, source } }, appMeta: { [appKey]: { label, importance } },
 *   sensor: { online, last_seen, revoked } | null,
 *   backupPlans: [{ id, name, method, schedule_hours, grace_hours, last_success, last_failure, last_note, created, app_keys, whole_machine }],
 *   intel: { [app_type]: { latest_version, latest_published, advisories, advisory_source, fetched_at } },
 * }
 */
const catalogue = require('./catalogue/index.js');
const { recognise, instructionsFor } = require('./recognise.js');
const { appReach, endpointReach } = require('./reach.js');
const controls = require('./controls/index.js');
const content = require('./content.js');
const { machineVariant } = require('./controls/util.js');

/** An app NetSentry doesn't know: named after its Compose project ("Whoami — web"), else its container. */
function genericName(a) {
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  if (a.compose_project) return a.compose_service && a.compose_service !== a.compose_project ? `${cap(a.compose_project)} — ${a.compose_service}` : cap(a.compose_project);
  return cap(String(a.container || 'app'));
}

function buildMachine(input) {
  const os = (input.obs('host.os')[0] || {}).data || {};
  const addresses = input.obs('host.address').map((o) => ({ ip: o.subject, loopback: !!o.data.loopback, primary: !!o.data.primary }));
  const name = input.asset.label || input.asset.identifier;
  const cloud = require('./cloudreach.js').cloudOf(input.obs);
  const stale = require('./freshness.js').staleSources(input.sources || [], input.sensor, input.now);
  const machine = { kind: 'machine', key: input.asset.id, name, os, variant: machineVariant(os), addresses, obs: input.obs, sensor: input.sensor, cloud, stale,
    sources: input.sources || [],
    metrics: input.metrics || {}, consoleVersion: input.consoleVersion || '', manageOn: !!(input.sensor && input.sensor.manage_on) };
  return machine;
}

function routerOf(input) {
  return {
    igd: input.obs('router.igd'),
    mappings: input.obs('router.port_mapping'),
    remote: { tailscale: input.obs('remote.tailscale'), serve: input.obs('remote.tailscale_serve'), cloudflared: input.obs('remote.cloudflared'), vpn: input.obs('remote.vpn') },
  };
}

function buildApps(input, machine, router) {
  // Apps a person chose to ignore get no checks.
  const all = recognise({ asset: input.asset, obs: input.obs });
  input._probeAll = all; // still probed until confirmed (instructions), but not shown or checked
  const found = require('./recognise.js').shown(all).filter((a) => !(input.appMeta[a.key] || {}).ignored);
  const byType = {};
  for (const a of found) byType[a.app_type] = (byType[a.app_type] || 0) + 1;
  for (const a of found) {
    const entry = catalogue.get(a.app_type);
    const meta = input.appMeta[a.key] || {};
    a.kind = 'app';
    a.entry = entry;
    // Two of the same app on one machine: the one named like the app keeps the plain name.
    const own = a.compose_service || a.container;
    a.name = meta.label || (entry.id === 'container' ? genericName(a) : byType[a.app_type] > 1 && own.toLowerCase() !== entry.id ? `${entry.name} (${own})` : entry.name);
    a.importance = meta.importance || 'normal';
    a.intent = input.intents[a.key] || { reach: entry.defaultIntent, source: 'default' };
    a.reach = appReach(a, machine, router);
    const cfg = input.obs('app.config').find((o) => o.subject.indexOf(`${a.app_type}:${a.container}:`) === 0);
    a.config = cfg && cfg.data && cfg.data.readable ? { values: cfg.data.values || {} } : null;
    a.config_readable = cfg ? !!(cfg.data && cfg.data.readable) : null;
    const first = a.endpoints.find((e) => e.probe_host) || null;
    a.primary_probe_host = first ? first.probe_host : '';
    a.primary_probe_is_network = !!(first && first.probe_host !== '127.0.0.1');
    a.primary_url = first ? `http://${first.probe_host === '127.0.0.1' ? '127.0.0.1' : first.probe_host}:${first.port}` : '';
    a.status = input.obs('endpoint.status').filter((o) => a.endpoints.some((e) => o.subject === `${e.probe_host}:${e.port}`));
    // D12: account lists, only when someone gave a read-only key for this app.
    a.access = !!meta.access;
    a.accounts = input.obs('app.account').filter((o) => o.data && o.data.app_key === a.key).map((o) => o.data);
    const acc = input.obs('app.accounts_status').find((o) => o.subject === a.key);
    a.accountsStatus = acc ? acc.data : null;
  }
  return found;
}

function buildFilesystems(input, machine) {
  const samples = {};
  for (const s of input.signals('storage.usage')) {
    (samples[s.key] = samples[s.key] || []).push({ at: s.window_start, used: s.data.used, total: s.data.total, free: s.data.free });
  }
  return input.obs('host.filesystem').map((o) => ({
    kind: 'filesystem',
    key: `${input.asset.id}|${o.subject}`,
    mount: o.subject,
    machine: machine.name,
    samples: (samples[o.subject] || []).sort((x, y) => (x.at < y.at ? -1 : 1)),
  }));
}

function run(control, subject, ctx) {
  let result;
  try {
    result = control.evaluate(subject, ctx);
  } catch (err) {
    result = { state: 'unknown', reason: `check failed: ${err && err.message ? err.message : err}`, facts: {} };
  }
  const text = content.render(control, subject, ctx, result);
  return {
    control: control.id,
    control_version: control.version,
    outcome: control.outcome,
    subject_type: subject.kind,
    subject_key: subject.key,
    app_key: subject.kind === 'app' ? subject.key : '',
    state: result.state,
    reason: result.reason || '',
    severity: result.state === 'fail' ? result.severity || 'medium' : '',
    factors: result.factors || [],
    evidence: result.evidence || {},
    text,
  };
}

function evaluate(input) {
  const machine = buildMachine(input);
  const router = routerOf(input);
  const apps = buildApps(input, machine, router);
  machine.hostsConsole = apps.some((a) => a.app_type === 'netsentry' && a.confidence === 'confirmed');
  // On a cloud machine "the local network" is its VPC.
  // v4: one server, no home/office modes — "your local network".
  const place = machine.cloud ? 'VPC' : 'local';
  const ctx = {
    now: input.now,
    place,
    machine,
    intel: (type) => input.intel[type] || null,
    backupsFor: (app) => input.backupPlans.filter((p) => p.whole_machine || (p.app_keys || []).indexOf(app.key) >= 0),
  };

  // Remote login's reach, for the SSH check (same engine as apps).
  const ssh = input.obs('host.listener').find((l) => l.data && l.data.port === 22 && l.data.proto === 'tcp');
  if (ssh) {
    const bind = ssh.data.exposure === 'all' ? '0.0.0.0' : ssh.data.address;
    machine.sshReach = endpointReach({ bind, port: 22, proto: 'tcp' }, machine, router);
  }

  const results = [];
  const fresh = require('./freshness.js');
  const push = (r) => results.push(fresh.applyTo(r, machine.stale));
  for (const c of controls.forSubject('machine')) if (c.appliesTo(machine, ctx)) push(run(c, machine, ctx));
  for (const a of apps) for (const c of controls.forSubject('app')) if (c.appliesTo(a, ctx)) push(run(c, a, ctx));
  for (const f of buildFilesystems(input, machine)) for (const c of controls.forSubject('filesystem')) if (c.appliesTo(f, ctx)) push(run(c, f, ctx));
  for (const p of input.backupPlans) {
    const plan = Object.assign({ kind: 'backup_plan', key: `backup|${p.id}` }, p);
    for (const c of controls.forSubject('backup_plan')) if (c.appliesTo(plan, ctx)) results.push(run(c, plan, ctx));
  }
  return { machine, apps, results, instructions: instructionsFor(input._probeAll || apps) };
}

module.exports = { evaluate };
