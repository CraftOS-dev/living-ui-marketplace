/**
 * The everyday and server jobs (v4 plan §7, §8): each prepares a typed change — shown exactly,
 * confirmed by an admin, applied and re-checked by the server's monitor, undone when it fails.
 * The agent may prepare any of them (it never confirms, N-B15); file contents stay people-only.
 *
 * The monitor re-checks everything here against its own rules (roots, risks, lock-out guards):
 * what's checked in this file is only what lets NetSentry describe the change honestly.
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const actions = require('../v2/actions.js');
const { OpError } = require('../core/util.js');

const FULL_PATH = /^(\/|[A-Za-z]:\\)[^\0\n\r]{0,1000}$/;

function theServer(app) {
  const s = require('./server.js').theServer(app);
  if (!s) throw new OpError(404, 'No server is set up yet.');
  return s;
}

function machineName(asset) {
  return asset.getString('label') || asset.getString('identifier');
}

function json(v, what) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch (_) {
    throw new OpError(400, `${what} must be JSON.`);
  }
}

/** A change of one or more typed steps, waiting for an admin. */
function prepare(app, actor, purpose, steps, opts) {
  const o = opts || {};
  const asset = o.asset || theServer(app);
  const made = steps.map(([action, params]) => {
    const a = actions.ACTIONS[action];
    if (!a || !a.params(params)) throw new OpError(400, "That change can't be planned safely — check what you entered.");
    return { action, params, description: a.describe(params), rollback: a.undo(params), target: machineName(asset), command: '' };
  });
  const body = { steps: made };
  const { planHash } = require('../core/remediation.js');
  const title = (o.title || made[made.length - 1].description).slice(0, 300);
  const last = actions.ACTIONS[made[made.length - 1].action];
  const disrupts = typeof last.disrupts === 'function' ? last.disrupts(made[made.length - 1].params) : last.disrupts;
  const rem = repo.create(app, 'remediations', {
    purpose, app: o.appRec ? o.appRec.id : '', asset: asset.id, fingerprint: `${purpose}|${asset.id}|${made[0].action}|${Date.now()}`, playbook_id: `v4.${purpose}`,
    title, plain_title: title, risk_class: 'approve', status: 'planned', plan: body, plan_hash: planHash((x) => $security.sha256(x), body),
    preconditions: o.keeps || [], downtime: disrupts, cost_note: 'none', blast_radius: (o.target || machineName(asset)).slice(0, 200),
    requested_by: actor.label, planned_by: actor.type === 'agent' ? 'the agent (with NetSentry’s built-in actions)' : 'NetSentry (built-in actions)', steps_log: [],
  });
  audit.append(app, actor, 'change.requested', { collection: 'remediations', id: rem.id }, `Change asked for: ${title}`, { actions: made.map((s) => s.action) });
  const ready = require('./remediations.js').executorReady(app, asset.id);
  return {
    ok: true, remediation_id: rem.id, plan_hash: rem.getString('plan_hash'), status: 'planned', manageable: ready,
    preview: { title, what_changes: made.map((s) => s.description).concat(o.details || []), undo: made.map((s) => s.rollback), disrupts, keeps: o.keeps || [], risks: o.risks || [] },
    message: ready ? 'Only an admin can confirm it.' : `Changes are switched off on ${machineName(asset)} — allow them there first (Settings → Monitor).`,
  };
}

function appOf(app, appId) {
  const a = repo.byId(app, 'apps', String(appId || ''));
  if (!a) throw new OpError(404, 'No such app.');
  if (!a.getString('container')) throw new OpError(409, "This app isn't a container.");
  return a;
}

const appName = (a) => a.getString('label') || a.getString('display_name') || a.getString('container');

function needPath(p, key) {
  const s = String(p[key] || '');
  if (!FULL_PATH.test(s)) throw new OpError(400, `${key} must be a full path.`);
  return s;
}

// ------------------------------------------------------------------ files (§7.1)

const files = {
  save: (app, actor, p) => prepare(app, actor, 'files', [['files.write', { path: needPath(p, 'path'), content: String(p.content === undefined ? '' : p.content), expected_sha256: String(p.expected_sha256 || '') }]]),
  newFolder: (app, actor, p) => prepare(app, actor, 'files', [['files.mkdir', { path: needPath(p, 'path') }]]),
  rename: (app, actor, p) => prepare(app, actor, 'files', [['files.move', { path: needPath(p, 'path'), to: needPath(p, 'to') }]]),
  remove: (app, actor, p) => prepare(app, actor, 'files', [['files.delete', { path: needPath(p, 'path') }]]),
  upload: (app, actor, p) => {
    const t = repo.byId(app, 'file_transfers', String(p.transfer_id || ''));
    if (!t || t.getString('direction') !== 'up' || t.getString('created_by') !== actor.id) throw new OpError(404, 'Upload the file first.');
    return prepare(app, actor, 'files', [['files.upload', { folder: needPath(p, 'folder'), name: t.getString('name'), sha256: t.getString('sha256'), size: t.getInt('size'), transfer_id: t.id }]]);
  },
};

// ------------------------------------------------------------------ app settings, remove, any app (§7.2–§7.4)

const KEY_WORDS = { ports: 'ports', environment: 'settings', restart: 'restart rule', volumes: 'folders' };

function settingsSave(app, actor, p) {
  const a = appOf(app, p.app_id);
  const changes = json(p.changes, 'changes') || {};
  const keys = Object.keys(changes);
  const words = keys.map((k) => KEY_WORDS[k] || k).join(', ').replace(/, ([^,]*)$/, ' and $1');
  // What each thing becomes, in the preview (v4 walk: "changes ports and settings" said too little).
  const HIDDEN = '\u2022\u2022\u2022 hidden \u2022\u2022\u2022';
  const secret = /pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|credential|_key$|^key$|salt|auth/i;
  const details = [];
  for (const pt of changes.ports || []) details.push(`The app's ${pt.target}/${pt.protocol || 'tcp'} on port ${pt.published}${pt.host_ip ? ` (only on ${pt.host_ip})` : ''}`);
  for (const [k, v] of Object.entries(changes.environment || {})) {
    if (v === HIDDEN) continue;
    details.push(v === null ? `Remove the setting ${k}` : secret.test(k) ? `${k}: a new value (hidden)` : `${k} = ${String(v).slice(0, 80)}`);
  }
  if (changes.restart) details.push(`When it stops: ${{ 'unless-stopped': 'start it again unless someone stopped it', always: 'always start it again', 'on-failure': 'start it again only when it crashed', no: 'leave it stopped' }[changes.restart] || changes.restart}`);
  return prepare(app, actor, 'settings', [['app.settings.set', {
    app: appName(a), container: a.getString('container'), file: String(p.file || ''), file_sha256: String(p.file_sha256 || ''),
    changes, accepted_risks: json(p.accepted_risks, 'accepted_risks') || [], words,
  }]], { appRec: a, target: a.getString('container'), risks: json(p.accepted_risks, 'accepted_risks') || [], details });
}

function composeSave(app, actor, p) {
  const a = appOf(app, p.app_id);
  return prepare(app, actor, 'settings', [['app.compose.apply', {
    app: appName(a), container: a.getString('container'), file: String(p.file || ''), file_sha256: String(p.file_sha256 || ''),
    content: String(p.content || ''), accepted_risks: json(p.accepted_risks, 'accepted_risks') || [],
  }]], { appRec: a, target: a.getString('container') });
}

function removeApp(app, actor, p) {
  const a = appOf(app, p.app_id);
  const mode = p.mode === 'everything' ? 'everything' : 'keep';
  const steps = [];
  const wantBackup = p.backup_first === true || p.backup_first === 'true';
  if (wantBackup) {
    const covers = (pl) => {
      const slice = pl.getStringSlice('apps') || [];
      for (let i = 0; i < slice.length; i++) if (String(slice[i]) === a.id) return true; // a Go slice, not a JS array
      return false;
    };
    const plan = repo.find(app, 'backup_plans', 'method = "netsentry"').find(covers);
    if (!plan) throw new OpError(409, `NetSentry doesn't back ${appName(a)} up yet — set that up on its Backups tab first, or remove it without a backup.`);
    const B = require('./backupjobs.js');
    steps.push(['backup.run', {
      plan_id: plan.id, app: appName(a), container: a.getString('container'), dest: plan.getString('destination'), keep: B.keepFor(app, a),
      keep_daily: plan.getInt('keep_daily') || 7, keep_weekly: plan.getInt('keep_weekly'), keep_monthly: plan.getInt('keep_monthly'),
    }]);
  }
  steps.push(['app.remove', { app: appName(a), container: a.getString('container'), mode }]);
  const keeps = [mode === 'everything'
    ? 'Its folder goes to NetSentry’s bin for 7 days; its Docker volumes are deleted for good.'
    : 'Its folder and data stay on the server — Undo starts it again.'];
  if (wantBackup) keeps.unshift('A fresh backup is made first; if that fails, nothing is removed.');
  return prepare(app, actor, 'remove', steps, { appRec: a, target: a.getString('container'), keeps, title: actions.ACTIONS['app.remove'].describe(steps[steps.length - 1][1]) });
}

function installCustom(app, actor, p) {
  const content = String(p.content || '');
  if (!content.trim() || content.length > 256000) throw new OpError(400, 'Paste a Compose file (up to 256 KB).');
  const project = String(p.name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 40);
  if (!project) throw new OpError(400, 'Give the app a name.');
  const asset = theServer(app);
  if (repo.first(app, 'apps', 'asset = {:a} && compose_project = {:p} && status = "active"', { a: asset.id, p: project })) throw new OpError(409, `Something called ${project} already runs there — pick another name.`);
  const accepted = json(p.accepted_risks, 'accepted_risks') || [];
  const sha = $security.sha256(content);
  const params = { template: 'custom', app: String(p.label || project).slice(0, 80), project, root: String(p.root || '/srv/apps'), content, content_sha256: sha, accepted_risks: accepted, spec: { services: {} } };
  if (!actions.ACTIONS['app.install'].params(params)) throw new OpError(400, "That install can't be planned safely.");
  return prepare(app, actor, 'install', [['app.install', params]], {
    asset, target: project, risks: accepted,
    keeps: [`Folder: ${params.root}/${project} · its Compose file is yours, exactly as pasted`].concat(accepted.length ? [`You accepted ${accepted.length} risk${accepted.length === 1 ? '' : 's'} NetSentry found in it.`] : []),
  });
}

// ------------------------------------------------------------------ disk, programs (§7.5, §7.6)

function cleanup(app, actor, p) {
  return prepare(app, actor, 'cleanup', [['disk.cleanup', { what: String(p.what || '') }]]);
}

function stopProcess(app, actor, p) {
  return prepare(app, actor, 'process', [['process.stop', { pid: Number(p.pid), start: String(p.start || ''), name: String(p.name || ''), user: String(p.user || '').slice(0, 40) }]]);
}

// ------------------------------------------------------------------ firewall, keys, schedules, remote (§7.7–§7.10)

function firewall(app, actor, p) {
  const what = String(p.action || '');
  if (what === 'enable') {
    const keep = String(p.keep_open || '').split(',').map((x) => x.trim()).filter((x) => /^\d{1,5}$/.test(x));
    return prepare(app, actor, 'firewall', [['firewall.enable', { keep_open: keep }]]);
  }
  if (what === 'toggle') {
    // a JSON list (rule names can hold commas: paths), or one rule_id
    let ids = [];
    try {
      ids = p.rule_ids ? JSON.parse(String(p.rule_ids)) : [String(p.rule_id || '')];
    } catch (e) {
      throw new OpError(400, 'rule_ids must be a JSON list of rule ids.');
    }
    if (!Array.isArray(ids)) throw new OpError(400, 'rule_ids must be a JSON list of rule ids.');
    ids = ids.map((x) => String(x)).filter(Boolean);
    if (p.enable !== 'true' && p.enable !== 'false' && p.enable !== true && p.enable !== false) throw new OpError(400, 'enable must be true or false.');
    return prepare(app, actor, 'firewall', [['firewall.rule.toggle', { rule_ids: ids, ...(ids.length === 1 ? { rule_id: ids[0] } : {}), enable: p.enable === true || p.enable === 'true', name: String(p.label || '').slice(0, 200) }]]);
  }
  if (what === 'profile') {
    if (p.enable !== 'true' && p.enable !== 'false' && p.enable !== true && p.enable !== false) throw new OpError(400, 'enable must be true or false.');
    return prepare(app, actor, 'firewall', [['firewall.profile', { profile: String(p.profile || ''), enable: p.enable === true || p.enable === 'true' }]]);
  }
  if (what === 'block') {
    const port = Number(p.port);
    if ([22, 3389, 5985, 5986].indexOf(port) >= 0) throw new OpError(400, `Port ${port} is remote login — NetSentry never blocks it (you could be locked out).`);
    return prepare(app, actor, 'firewall', [['firewall.block', { port, proto: String(p.proto || 'tcp'), source: String(p.source || 'any') }]]);
  }
  if (what !== 'allow' && what !== 'remove') throw new OpError(400, 'action must be allow, remove, enable, block, toggle or profile.');
  const params = { port: Number(p.port), proto: String(p.proto || 'tcp'), source: String(p.source || (what === 'allow' ? 'local' : 'any')), label: String(p.label || '').slice(0, 40) };
  return prepare(app, actor, 'firewall', [[`firewall.${what}`, params]]);
}

function addKey(app, actor, p) {
  const key = String(p.key || '').trim();
  // Say why (the agent and people both read this): never a private key, one public line.
  if (/PRIVATE KEY/.test(key)) throw new OpError(400, "That is a private key — never share it. Paste the public key instead (the .pub file: one line starting with ssh-ed25519, ssh-rsa or ecdsa-).");
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]{40,}={0,3}( [\x20-\x7e]{1,100})?$/.test(key)) {
    throw new OpError(400, 'Paste one public key line: ssh-ed25519 AAAA… name (from the .pub file).');
  }
  const comment = key.split(' ').slice(2).join(' ').slice(0, 60);
  return prepare(app, actor, 'keys', [['ssh.key.add', { user: String(p.user || ''), key, comment }]]);
}

function removeKey(app, actor, p) {
  return prepare(app, actor, 'keys', [['ssh.key.remove', { user: String(p.user || ''), fingerprint: String(p.fingerprint || ''), comment: String(p.comment || '').slice(0, 60) }]]);
}

function schedule(app, actor, p) {
  const params = { kind: String(p.kind || ''), pause: p.pause === true || p.pause === 'true', words: String(p.words || '').slice(0, 120) };
  if (params.kind === 'cron') Object.assign(params, { file: String(p.file || ''), id: String(p.id || '') });
  if (params.kind === 'timer') params.unit = String(p.unit || '');
  if (params.kind === 'task') Object.assign(params, { name: String(p.name || ''), path: String(p.path || '\\') });
  return prepare(app, actor, 'schedule', [['schedule.set', params]]);
}

/** The server's monitor, when it may run commands someone typed (the terminal is on there). */
function commandMonitor(app, asset) {
  const s = repo.first(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: asset.id }, '-last_seen');
  const caps = s ? repo.jsonOf(s, 'capabilities') || {} : {};
  return caps.terminal && caps.terminal.available ? s : null;
}

function scheduleCreate(app, actor, p) {
  const asset = theServer(app);
  const monitor = commandMonitor(app, asset);
  if (!monitor) throw new OpError(409, 'Making a scheduled job runs a command on a schedule, so it comes with the terminal — switched on at the server itself (Settings → Monitor).', 'terminal_off');
  const when = json(p.when, 'when') || {};
  const params = {
    name: String(p.name || '').trim(),
    command: String(p.command || '').trim(),
    when: { every: String(when.every || '') },
    runs_as: /windows/i.test(`${monitor.getString('os')} ${monitor.getString('platform')}`) ? 'SYSTEM' : 'root',
  };
  if (when.n !== undefined) params.when.n = Number(when.n);
  if (when.minute !== undefined) params.when.minute = Number(when.minute);
  if (when.at !== undefined) params.when.at = String(when.at);
  if (when.day !== undefined) params.when.day = Number(when.day);
  return prepare(app, actor, 'schedule', [['schedule.create', params]], {
    asset,
    keeps: [`Runs as ${params.runs_as}, with full rights — like a command run now.`, 'Listed under Scheduled jobs as made in NetSentry: Pause or Delete it there.'],
  });
}

function scheduleDelete(app, actor, p) {
  const params = { kind: String(p.kind || ''), words: String(p.words || '').slice(0, 120) };
  if (params.kind === 'cron') params.file = String(p.file || '');
  if (params.kind === 'task') Object.assign(params, { name: String(p.name || ''), path: String(p.path || '') });
  return prepare(app, actor, 'schedule', [['schedule.delete', params]]);
}

function tailscale(app, actor) {
  return prepare(app, actor, 'remote', [['remote.tailscale.install', {}]]);
}

// ------------------------------------------------------------------ a command (§8, N-B21)

function command(app, actor, p) {
  const argv = json(p.argv, 'argv');
  if (!Array.isArray(argv)) throw new OpError(400, 'argv must be a JSON list: ["apt-get", "clean"]. For a pipeline: ["sh", "-c", "…"].');
  const params = { argv: argv.map(String), why: String(p.why || '').slice(0, 500), timeout: Math.max(1, Math.min(600, Number(p.timeout) || 120)) };
  if (p.cwd) params.cwd = String(p.cwd);
  const asset = theServer(app);
  const s = repo.first(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: asset.id }, '-last_seen');
  const caps = s ? repo.jsonOf(s, 'capabilities') || {} : {};
  if (!(caps.terminal && caps.terminal.available)) throw new OpError(409, 'Commands are off on this server: they come with the terminal, which is switched on at the server itself (Settings → Monitor).', 'terminal_off');
  return prepare(app, actor, 'command', [['command.run', params]], { asset, keeps: [`Why: ${params.why}`, `Stops after ${params.timeout} seconds. Its output is recorded, with secrets hidden.`] });
}

module.exports = { prepare, files, settingsSave, composeSave, removeApp, installCustom, cleanup, stopProcess, firewall, addKey, removeKey, schedule, scheduleCreate, scheduleDelete, tailscale, command };
