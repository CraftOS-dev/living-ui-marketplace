/**
 * Updates (v3 plan §10): which apps have one waiting, how risky it is, and —
 * when a person asks or their window policy allows — doing it safely through
 * the machine's monitor (snapshot → pull → recreate → health gate → undo).
 *
 * Registries are read without an account: Docker Hub's tag API, and the
 * registry API of ghcr.io (lscr.io's images live there). Anything else says
 * "NetSentry can't read that registry" instead of guessing. Each image is
 * checked at most every 6 hours.
 */
const repo = require('../infra/repo.js');
const { createHttp } = require('../infra/http.js');
const audit = require('./audit.js');
const images = require('../v2/images.js');
const actions = require('../v2/actions.js');
const { OpError } = require('../core/util.js');

const EVERY_MS = 6 * 3600000;
const RETRY_MS = 3600000;
const PER_RUN = 12;
const { DOCKER_HUB: HUB_API, GHCR } = require('../../external_hosts.js');

// ------------------------------------------------------------------ registries

function hubTags(http, ref) {
  const [ns, name] = ref.repo.split('/');
  const base = `${HUB_API}${ns}/repositories/${name}/tags`;
  const out = {};
  const pages = [`${base}?page_size=100&ordering=last_updated`];
  const v = images.versionOf(ref.tag);
  if (v && v.nums.length > 1) pages.push(`${base}?page_size=100&name=${encodeURIComponent(`${v.prefix}${v.nums[0]}.`)}`);
  for (const url of pages) {
    const r = http.getJson(url, { timeout: 20 });
    if (r.status !== 200 || !r.json) throw new Error(`Docker Hub answered ${r.status}`);
    for (const t of r.json.results || []) out[t.name] = t.digest || '';
  }
  let digest = out[ref.tag];
  if (digest === undefined) {
    const one = http.getJson(`${base}/${encodeURIComponent(ref.tag)}`, { timeout: 20 });
    digest = one.status === 200 && one.json ? one.json.digest || '' : '';
  }
  return { tags: Object.keys(out), digest };
}

function ghcrTags(http, ref) {
  const tok = http.getJson(`${GHCR}token?scope=repository:${ref.repo}:pull`, { timeout: 20 });
  if (tok.status !== 200 || !tok.json || !tok.json.token) throw new Error(`ghcr.io gave no read token (${tok.status})`);
  const auth = { authorization: `Bearer ${tok.json.token}` };
  const man = http.getJson(`${GHCR}v2/${ref.repo}/manifests/${encodeURIComponent(ref.tag)}`, {
    timeout: 20,
    headers: Object.assign({ accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' }, auth),
  });
  const digest = man.status === 200 ? man.header('docker-content-digest') : '';
  const tags = [];
  if (!images.floating(ref.tag)) {
    let url = `${GHCR}v2/${ref.repo}/tags/list?n=1000`;
    for (let page = 0; page < 6 && url; page++) {
      const r = http.getJson(url, { timeout: 25, headers: auth });
      if (r.status !== 200 || !r.json) throw new Error(`ghcr.io answered ${r.status}`);
      for (const t of r.json.tags || []) tags.push(t);
      const link = /<([^>]+)>;\s*rel="next"/.exec(r.header('link') || '');
      url = link ? GHCR + link[1].replace(/^\//, '') : '';
    }
  }
  return { tags, digest };
}

function lookup(http, ref) {
  if (ref.registry === 'docker.io') return hubTags(http, ref);
  if (ref.registry === 'ghcr.io') return ghcrTags(http, ref);
  throw new Error(`NetSentry can't read ${ref.registry} without an account`);
}

/** Refresh what the registries say about images in use (bounded per run). `force`: a person asked "check now". */
function refreshIntel(app, http, force) {
  const client = http || createHttp();
  const refs = {};
  for (const o of repo.find(app, 'observations', 'kind = "container" && present = true')) {
    const ref = images.parseRef((repo.jsonOf(o, 'data') || {}).image);
    if (ref && !ref.digest) refs[`${ref.registry}|${ref.repo}|${ref.tag}`] = ref;
  }
  let fetched = 0;
  for (const key of Object.keys(refs)) {
    if (fetched >= PER_RUN) break;
    const ref = refs[key];
    let rec = repo.first(app, 'image_intel', 'registry = {:r} && repo = {:p} && tag = {:t}', { r: ref.registry, p: ref.repo, t: ref.tag });
    if (rec && !force) {
      const age = Date.now() - Date.parse(repo.isoOf(rec, 'checked_at') || 0);
      if (age < (rec.getString('error') ? RETRY_MS : EVERY_MS)) continue;
    }
    fetched++;
    let fields;
    try {
      const found = lookup(client, ref);
      const newer = images.newerTags(ref.tag, found.tags, ref.repo);
      fields = { digest: found.digest || '', newer_patch_minor: newer.patchMinor || '', newer_major: newer.major || '', checked_at: repo.nowIso(), error: '' };
    } catch (err) {
      fields = { checked_at: repo.nowIso(), error: String(err && err.message ? err.message : err).slice(0, 300) };
    }
    if (rec) repo.update(app, rec, fields);
    else rec = repo.create(app, 'image_intel', Object.assign({ registry: ref.registry, repo: ref.repo, tag: ref.tag }, fields));
  }
  syncApps(app);
  return fetched;
}

// ------------------------------------------------------------------ per app

/** The update waiting for one app, or null — from its container's image and what the registry says. */
function availableFor(container, intel) {
  if (!container || !container.image) return null;
  const ref = images.parseRef(container.image);
  if (!ref || ref.digest) return null; // pinned by digest: the owner chose that exact build
  if (!intel) return { image: container.image, state: 'unknown', why: "NetSentry hasn't asked the registry yet" };
  if (intel.error) return { image: container.image, state: 'unknown', why: intel.error };
  // An answer older than two check intervals is history, not a fact.
  if (intel.checked_at && Date.now() - Date.parse(intel.checked_at) > 2 * EVERY_MS) return { image: container.image, state: 'unknown', why: 'the registry hasn’t been asked recently' };
  const out = { image: container.image, tag: ref.tag, checked_at: intel.checked_at };
  if (intel.newer_patch_minor) {
    const c = images.classify(ref.repo, ref.tag, intel.newer_patch_minor);
    Object.assign(out, { state: 'available', to: intel.newer_patch_minor, kind: c.kind, risk: c.risk, why: c.why, auto_ok: images.autoAllowed(c) });
  } else if (images.floating(ref.tag) && intel.digest) {
    const running = (container.repo_digests || []).map((d) => String(d).split('@')[1]).filter(Boolean);
    if (running.length && running.indexOf(intel.digest) < 0) {
      const c = images.classify(ref.repo, ref.tag, ref.tag);
      Object.assign(out, { state: 'available', to: ref.tag, kind: 'rebuild', risk: c.risk, why: c.why, auto_ok: images.autoAllowed(c), digest: intel.digest });
    } else if (!running.length) {
      Object.assign(out, { state: 'unknown', why: 'this build was not pulled from a registry, so NetSentry can’t compare it' });
    } else {
      out.state = 'current';
    }
  } else {
    out.state = 'current';
  }
  if (intel.newer_major) {
    const c = images.classify(ref.repo, ref.tag, intel.newer_major);
    out.major = { to: intel.newer_major, risk: c.risk, why: c.why };
  }
  return out;
}

/** Write each app's waiting update (only when it changed, so realtime stays quiet). */
function syncApps(app) {
  const intelBy = {};
  for (const r of repo.find(app, 'image_intel', 'id != ""')) {
    intelBy[`${r.getString('registry')}|${r.getString('repo')}|${r.getString('tag')}`] = {
      digest: r.getString('digest'), newer_patch_minor: r.getString('newer_patch_minor'), newer_major: r.getString('newer_major'),
      checked_at: repo.isoOf(r, 'checked_at'), error: r.getString('error'),
    };
  }
  for (const a of repo.find(app, 'apps', 'status = "active" && container != ""')) {
    const o = repo.first(app, 'observations', 'asset = {:s} && kind = "container" && subject = {:c} && present = true', { s: a.getString('asset'), c: a.getString('container') });
    const c = o ? repo.jsonOf(o, 'data') || {} : null;
    const ref = c ? images.parseRef(c.image) : null;
    const next = availableFor(c, ref ? intelBy[`${ref.registry}|${ref.repo}|${ref.tag}`] : null);
    if (JSON.stringify(repo.jsonOf(a, 'update') || null) !== JSON.stringify(next)) repo.update(app, a, { update: next });
  }
}

// ------------------------------------------------------------------ doing it

function machineName(asset) {
  return asset.getString('label') || asset.getString('identifier');
}

/** The typed plan for updating one app now: snapshot its settings, pull, recreate, check, undo if it breaks. */
function planFor(app, a, to) {
  const asset = repo.byId(app, 'assets', a.getString('asset'));
  const o = repo.first(app, 'observations', 'asset = {:s} && kind = "container" && subject = {:c} && present = true', { s: asset.id, c: a.getString('container') });
  const c = o ? repo.jsonOf(o, 'data') || {} : null;
  if (!c) throw new OpError(409, "NetSentry hasn't seen this app's container yet.");
  const ref = images.parseRef(c.image);
  if (!ref) throw new OpError(409, 'Its image name is not one NetSentry understands.');
  const waiting = repo.jsonOf(a, 'update') || {};
  const target = to || waiting.to;
  if (!target) throw new OpError(409, 'No update is waiting for this app.');
  if (to && to !== waiting.to && !(waiting.major && to === waiting.major.to)) throw new OpError(400, 'NetSentry only updates to a newer version the registry listed for this app.');
  // Settings and data worth keeping: the catalogue's important paths, else every bind mount that isn't media.
  const entry = require('../v2/catalogue/index.js').get(a.getString('app_type'));
  const mounts = (c.mounts || []).filter((m) => m.type === 'bind' || m.type === 'volume');
  const keep = mounts.filter((m) => !/\/(media|movies|tv|music|downloads|data\/media|photos|library|books)(\/|$)/i.test(m.destination)).map((m) => ({ source: m.source, destination: m.destination, type: m.type }));
  const name = a.getString('label') || a.getString('display_name') || a.getString('container');
  const newRef = images.floating(ref.tag) && target === ref.tag ? c.image : c.image.replace(/:[^:/@]+$/, '') + ':' + target;
  const cls = images.classify(ref.repo, ref.tag, target);
  const params = {
    app: name, container: a.getString('container'), image: newRef, from_image: c.image,
    compose_project: c.compose_project || '', compose_service: c.compose_service || '', compose_file: c.compose_file || '',
    keep, probe: ((repo.jsonOf(a, 'endpoints') || [])[0] || null),
  };
  const s = actions.ACTIONS['app.update'];
  if (!s.params(params)) throw new OpError(400, "That update can't be planned safely.");
  return {
    asset, cls, target,
    plan: {
      // People say "12.1"; the exact build ("12.1.20260915-010956") is in the step below.
      title: `Update ${name} to ${require('../v2/todo.js').shortVersion(target)}`,
      steps: [{ action: 'app.update', params, description: s.describe(params), rollback: s.undo(params), target: machineName(asset), command: '' }],
      downtime: s.disrupts,
      preconditions: [entry && entry.important && entry.important.length ? `What NetSentry keeps a copy of first: ${entry.important.join('; ')}.` : 'NetSentry keeps a copy of the app’s settings folders first.'],
    },
  };
}

function request(app, actor, p) {
  const a = repo.byId(app, 'apps', String(p.app_id || ''));
  if (!a) throw new OpError(404, 'No such app.');
  if (a.getString('update_policy') === 'pinned' && !p.anyway) throw new OpError(409, 'This app is pinned: NetSentry never updates it. Unpin it first.', 'pinned');
  const { plan, asset, cls, target } = planFor(app, a, p.to);
  const waiting = repo.first(app, 'remediations', 'app = {:a} && purpose = "update" && (status = "planned" || status = "approved" || status = "executing" || status = "verifying")', { a: a.id });
  if (waiting && waiting.getString('status') !== 'planned') throw new OpError(409, `An update is already ${waiting.getString('status')}.`, 'busy');
  if (waiting) app.delete(waiting);
  const { planHash } = require('../core/remediation.js');
  const body = { steps: plan.steps };
  const rem = repo.create(app, 'remediations', {
    purpose: 'update', app: a.id, asset: asset.id, fingerprint: `upd|${a.id}|${target}|${Date.now()}`, playbook_id: 'v3.update',
    title: plan.title.slice(0, 300), plain_title: plan.title.slice(0, 300), risk_class: cls.risk === 'high' ? 'high' : 'approve',
    status: 'planned', plan: body, plan_hash: planHash((x) => $security.sha256(x), body), preconditions: plan.preconditions, downtime: plan.downtime,
    cost_note: 'none', blast_radius: a.getString('container'), requested_by: actor.label, planned_by: 'NetSentry (built-in actions)', steps_log: [],
  });
  audit.append(app, actor, 'change.requested', { collection: 'remediations', id: rem.id }, `Update asked for: ${plan.title}`, { to: target, risk: cls.risk });
  const ready = require('./remediations.js').executorReady(app, asset.id);
  return {
    ok: true, remediation_id: rem.id, plan_hash: rem.getString('plan_hash'), status: 'planned', manageable: ready,
    preview: { title: plan.title, risk: cls.risk, why: cls.why, what_changes: plan.steps.map((x) => x.description), undo: plan.steps.map((x) => x.rollback), disrupts: plan.downtime, keeps: plan.preconditions },
    message: ready ? 'Confirm to update now. If the app doesn’t come back healthy, NetSentry puts the old version and its settings back by itself.' : `Changes are switched off on ${machineName(asset)}.`,
  };
}

function setPolicy(app, actor, p) {
  const a = repo.byId(app, 'apps', String(p.app_id || ''));
  if (!a) throw new OpError(404, 'No such app.');
  if (['notify', 'auto', 'pinned'].indexOf(p.policy) < 0) throw new OpError(400, 'policy must be notify, auto or pinned.');
  repo.update(app, a, { update_policy: p.policy });
  const words = { notify: 'tell me when an update is out', auto: 'update small ones in my maintenance window', pinned: 'never update' };
  audit.append(app, actor, 'apps.update_policy', { collection: 'apps', id: a.id }, `${a.getString('display_name') || a.getString('key')}: ${words[p.policy]}`, null);
  return { ok: true, policy: p.policy };
}

module.exports = { refreshIntel, availableFor, syncApps, planFor, request, setPolicy, lookup };

// ------------------------------------------------------------------ roll back, the OS, windows

/** Put an app back the way it was before an update NetSentry made (within 14 days). */
function rollbackRequest(app, actor, p) {
  const done = repo.byId(app, 'remediations', String(p.change_id || ''));
  if (!done || done.getString('purpose') !== 'update' || done.getString('status') !== 'done') throw new OpError(404, 'No finished update to roll back.');
  const a = repo.byId(app, 'apps', done.getString('app'));
  if (!a) throw new OpError(404, 'That app is gone.');
  const step0 = ((repo.jsonOf(done, 'plan') || {}).steps || [])[0] || {};
  if (step0.action !== 'app.update') throw new OpError(409, 'Only updates can be rolled back.');
  const params = { app: step0.params.app, container: step0.params.container, change_id: done.id };
  return createChange(app, actor, a, 'app.rollback', params, 'update');
}

/** Install the waiting security updates, or schedule a restart, on one machine. */
function osRequest(app, actor, p) {
  const asset = repo.byId(app, 'assets', String(p.asset_id || ''));
  if (!asset || asset.getString('kind') !== 'host') throw new OpError(404, 'No such server.');
  const machine = machineName(asset);
  if (p.what === 'reboot') {
    const delay = Math.max(1, Math.min(1440, Number(p.delay_minutes) || 5));
    return createChange(app, actor, null, 'os.reboot', { machine, delay_minutes: delay }, 'os', asset);
  }
  if (p.what !== 'security_updates') throw new OpError(400, 'what must be security_updates or reboot.');
  const o = repo.first(app, 'observations', 'asset = {:a} && kind = "host.package_updates" && present = true', { a: asset.id });
  const pkgs = ((o ? repo.jsonOf(o, 'data') || {} : {}).packages || []).map((x) => x.name).filter(Boolean);
  if (!pkgs.length) throw new OpError(409, 'No security updates are waiting on this server (as last reported).');
  return createChange(app, actor, null, 'os.security_updates', { machine, packages: pkgs.slice(0, 500) }, 'os', asset);
}

function createChange(app, actor, appRec, action, params, purpose, assetRec) {
  const a = actions.ACTIONS[action];
  if (!a || !a.params(params)) throw new OpError(400, "That change can't be planned safely.");
  const asset = assetRec || repo.byId(app, 'assets', appRec.getString('asset'));
  const step = { action, params, description: a.describe(params), rollback: a.undo(params), target: machineName(asset), command: '' };
  const body = { steps: [step] };
  const { planHash } = require('../core/remediation.js');
  const rem = repo.create(app, 'remediations', {
    purpose, app: appRec ? appRec.id : '', asset: asset.id, fingerprint: `${purpose}|${asset.id}|${action}|${Date.now()}`, playbook_id: `v3.${purpose}`,
    title: step.description.slice(0, 300), plain_title: step.description.slice(0, 300), risk_class: 'approve', status: 'planned', plan: body,
    plan_hash: planHash((x) => $security.sha256(x), body), preconditions: [], downtime: a.disrupts, cost_note: 'none',
    blast_radius: appRec ? appRec.getString('container') : machineName(asset), requested_by: actor.label, planned_by: 'NetSentry (built-in actions)', steps_log: [],
  });
  audit.append(app, actor, 'change.requested', { collection: 'remediations', id: rem.id }, `Change asked for: ${step.description}`, { action });
  const ready = require('./remediations.js').executorReady(app, asset.id);
  return {
    ok: true, remediation_id: rem.id, plan_hash: rem.getString('plan_hash'), status: 'planned', manageable: ready,
    preview: { title: step.description, what_changes: [step.description], undo: [step.rollback], disrupts: a.disrupts },
    message: ready ? 'Confirm to do it now.' : `Changes are switched off on ${machineName(asset)}.`,
  };
}

/** Is `nowMs` inside this window? Windows are in the console's own time (offset stored with them). */
function inWindow(w, nowMs) {
  const local = new Date(nowMs + (w.utc_offset_minutes || 0) * 60000);
  const day = local.getUTCDay();
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const start = w.start_minute;
  const end = start + w.duration_minutes;
  const days = w.weekdays || [];
  if (days.indexOf(day) >= 0 && minute >= start && minute < Math.min(end, 1440)) return true;
  // A window that runs past midnight continues on the next day.
  const yesterday = (day + 6) % 7;
  return end > 1440 && days.indexOf(yesterday) >= 0 && minute < end - 1440;
}

/**
 * Every few minutes: inside an open window, apply ONE update a person's policy allows
 * (small ones only, never a database major), one at a time; a failure stops the rest of the window.
 */
function windowTick(app, nowIso) {
  const now = Date.parse(nowIso || repo.nowIso());
  const busy = repo.first(app, 'remediations', 'purpose = "update" && (status = "approved" || status = "executing" || status = "verifying")');
  if (busy) return { waiting: busy.id };
  for (const w of repo.find(app, 'maintenance_windows', 'enabled = true')) {
    const win = { weekdays: repo.jsonOf(w, 'weekdays') || [], start_minute: w.getInt('start_minute'), duration_minutes: w.getInt('duration_minutes'), utc_offset_minutes: w.getInt('utc_offset_minutes') };
    if (!inWindow(win, now)) continue;
    const since = repo.pbDate(new Date(now - win.duration_minutes * 60000).toISOString());
    if (repo.first(app, 'remediations', 'purpose = "update" && approved_by ~ "maintenance window" && (status = "failed" || status = "rolled_back") && updated >= {:s}', { s: since })) continue;
    const slice = w.getStringSlice('assets') || [];
    const scope = [];
    for (let i = 0; i < slice.length; i++) scope.push(String(slice[i]));
    for (const a of repo.find(app, 'apps', 'status = "active" && update_policy = "auto"')) {
      if (scope.length && scope.indexOf(a.getString('asset')) < 0) continue;
      const up = repo.jsonOf(a, 'update') || {};
      if (up.state !== 'available' || !up.auto_ok) continue;
      if (!require('./remediations.js').executorReady(app, a.getString('asset'))) continue;
      const label = `maintenance window "${w.getString('name')}" (update policy for ${a.getString('display_name') || a.getString('key')})`;
      const actor = { type: 'system', label, role: 'admin' };
      try {
        const r = request(app, actor, { app_id: a.id });
        const rem = repo.byId(app, 'remediations', r.remediation_id);
        require('./remediations.js').approveInternal(app, rem, actor);
        repo.update(app, w, { last_run: repo.nowIso() });
        return { started: rem.id };
      } catch (err) {
        console.error('[netsentry] window update not started:', err);
      }
    }
  }
  return { idle: true };
}

function saveWindow(app, actor, p) {
  const days = String(p.weekdays || '').split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 0 && x <= 6);
  if (!days.length) throw new OpError(400, 'Pick at least one day (0 = Sunday ... 6 = Saturday).');
  const start = Number(p.start_minute);
  const dur = Number(p.duration_minutes);
  if (!(start >= 0 && start <= 1439) || !(dur >= 15 && dur <= 720)) throw new OpError(400, 'A window starts between 00:00 and 23:59 and lasts 15 minutes to 12 hours.');
  const ids = String(p.asset_ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const id of ids) if (!repo.byId(app, 'assets', id)) throw new OpError(404, `No server ${id}.`);
  const fields = {
    name: String(p.name || 'Weekly updates').slice(0, 80), assets: ids, weekdays: days, start_minute: start, duration_minutes: dur,
    utc_offset_minutes: Math.max(-840, Math.min(840, Number(p.utc_offset_minutes) || 0)), enabled: p.enabled !== false && p.enabled !== 'false', created_by: actor.label,
  };
  const ex = p.window_id ? repo.byId(app, 'maintenance_windows', String(p.window_id)) : null;
  const rec = ex ? repo.update(app, ex, fields) : repo.create(app, 'maintenance_windows', fields);
  audit.append(app, actor, 'windows.saved', { collection: 'maintenance_windows', id: rec.id }, `Maintenance window "${fields.name}" saved`, { days, start, dur });
  return { ok: true, window_id: rec.id };
}

function deleteWindow(app, actor, p) {
  const w = repo.byId(app, 'maintenance_windows', String(p.window_id || ''));
  if (!w) throw new OpError(404, 'No such window.');
  app.delete(w);
  audit.append(app, actor, 'windows.deleted', null, `Maintenance window "${w.getString('name')}" removed`, null);
  return { ok: true };
}

module.exports.rollbackRequest = rollbackRequest;
module.exports.createChange = createChange;
module.exports.osRequest = osRequest;
module.exports.windowTick = windowTick;
module.exports.inWindow = inWindow;
module.exports.saveWindow = saveWindow;
module.exports.deleteWindow = deleteWindow;
