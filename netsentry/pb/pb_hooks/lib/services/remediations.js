/**
 * Remediation service — the fix loop:
 *   request-plan (person/agent) → plan (agent/person) → approve (human admin)
 *   → claim + report-step + complete (the executor: agent or person)
 *   → verification (NetSentry re-checks the rule that found the problem).
 * NetSentry never executes anything itself and never trusts "done": only a
 * passing re-check on fresh data marks a remediation done.
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const playbooks = require('../playbooks/index.js');
const { canMove, planHash, OPEN } = require('../core/remediation.js');
const { OpError } = require('../core/util.js');

const APPROVAL_TTL_MS = 24 * 3600000;
const EXECUTION_TIMEOUT_MS = 2 * 3600000;
const VERIFY_MAX_MS = 7 * 86400000;

function sha256(s) {
  return $security.sha256(s);
}

function requireRem(app, id) {
  const r = repo.byId(app, 'remediations', id);
  if (!r) throw new OpError(404, 'Remediation not found.', 'not_found');
  return r;
}

function settings(app) {
  return repo.first(app, 'settings', 'id != ""');
}

function paused(app) {
  const s = settings(app);
  return !!(s && s.getBool('remediation_paused'));
}

function move(app, rem, to, fields, actor, summary) {
  const from = rem.getString('status');
  if (!canMove(from, to)) throw new OpError(409, `A remediation that is ${from.replace('_', ' ')} cannot become ${to.replace('_', ' ')}.`, 'invalid_transition');
  repo.update(app, rem, Object.assign({ status: to }, fields || {}));
  audit.append(app, actor, 'remediation.' + to, { collection: 'remediations', id: rem.id }, summary || `"${rem.getString('title')}": ${from} → ${to}`, null);
  if (ENDED_UNFIXED.indexOf(to) >= 0) releaseFinding(app, rem);
  return rem;
}

const FIX_REQUESTED_NOTE = 'A fix was requested.';
const ENDED_UNFIXED = ['cancelled', 'rejected', 'expired', 'failed', 'rolled_back'];

/**
 * Requesting a fix marks its issue "being handled"; when the fix ends without
 * fixing anything, the issue needs attention again. Only undone when the fix
 * request was what marked it — a person's own "I'm on it" is left alone.
 */
function releaseFinding(app, rem) {
  const f = repo.byId(app, 'findings', rem.getString('finding'));
  if (f && f.getString('status') === 'acknowledged' && f.getString('status_note') === FIX_REQUESTED_NOTE) {
    repo.update(app, f, { status: 'open', status_note: '', status_by: '' });
  }
}

// ------------------------------------------------ v2: NetSentry's own typed fixes

const V2_FIX = 'v2-builtin';

/** What a v2 check's fix needs: the machine, the app, its settings file, who should reach it. */
function v2Context(app, f) {
  const catalogue = require('../v2/catalogue/index.js');
  const asset = repo.byId(app, 'assets', f.getString('asset'));
  const ev = repo.jsonOf(f, 'evidence') || {};
  const appRec = ev.app_id ? repo.byId(app, 'apps', ev.app_id) : null;
  const ctx = { machine: asset ? asset.getString('label') || asset.getString('identifier') : '', app: '', intent: '', config: null };
  if (appRec) {
    const entry = catalogue.get(appRec.getString('app_type'));
    ctx.app = appRec.getString('label') || appRec.getString('display_name');
    const intent = repo.first(app, 'intents', 'app = {:a}', { a: appRec.id });
    ctx.intent = intent ? intent.getString('reach') : entry ? entry.defaultIntent : '';
    const obs = repo.first(app, 'observations', 'asset = {:a} && kind = "container" && subject = {:s}', { a: appRec.getString('asset'), s: appRec.getString('container') });
    const image = obs ? catalogue.imageRepo((repo.jsonOf(obs, 'data') || {}).image) : '';
    const spec = entry ? (entry.config || []).find((c) => c.images.some((i) => catalogue.imageRepo(i) === image)) : null;
    if (spec && appRec.getString('container')) ctx.config = { container: appRec.getString('container'), path: spec.path };
  }
  return { ctx, evidence: ev.evidence || {} };
}

/** The machine's monitor can apply fixes only when fixing was switched on AT the machine. */
function executorReady(app, assetId) {
  const s = repo.first(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: assetId }, '-last_seen');
  const caps = s ? repo.jsonOf(s, 'capabilities') || {} : {};
  return !!(caps.executor && caps.executor.available);
}

function v2Fix(app, f) {
  if (!require('../v2/controls/index.js').get(f.getString('rule_id'))) return null;
  const { ctx, evidence } = v2Context(app, f);
  return require('../v2/actions.js').fixFor(f.getString('rule_id'), evidence, ctx);
}

function suggest(app, p) {
  const f = repo.byId(app, 'findings', p.finding_id);
  if (!f) throw new OpError(404, 'Finding not found.', 'not_found');
  if (require('../v2/controls/index.js').get(f.getString('rule_id'))) {
    const fix = v2Fix(app, f);
    const open = repo.first(app, 'remediations', 'fingerprint = {:f} && (status = "plan_requested" || status = "planned" || status = "approved" || status = "executing" || status = "verifying")', { f: f.getString('fingerprint') });
    return {
      ok: true,
      finding_id: f.id,
      active_remediation: open ? { id: open.id, status: open.getString('status') } : null,
      executor_ready: executorReady(app, f.getString('asset')),
      playbooks: fix
        ? [{ id: V2_FIX, title: fix.title, plain_title: fix.title, risk: 'approve', lockout_risk: false, downtime: fix.downtime, cost: 'none', preconditions: fix.preconditions,
            steps: fix.steps.map((st) => st.description), rollback: fix.steps.map((st) => st.rollback), verified_by: f.getString('rule_id'), builtin: true }]
        : [],
    };
  }
  const options = playbooks.forRule(f.getString('rule_id'), repo.jsonOf(f, 'evidence'));
  const open = repo.first(app, 'remediations', 'fingerprint = {:f} && (status = "plan_requested" || status = "planned" || status = "approved" || status = "executing" || status = "verifying")', { f: f.getString('fingerprint') });
  return {
    ok: true,
    finding_id: f.id,
    active_remediation: open ? { id: open.id, status: open.getString('status') } : null,
    playbooks: options.map((pb) => ({
      id: pb.id, title: pb.title, plain_title: playbooks.plainName(pb), risk: pb.risk, lockout_risk: pb.lockoutRisk, downtime: pb.downtime, cost: pb.cost,
      preconditions: pb.preconditions, steps: pb.steps, rollback: pb.rollback, verified_by: playbooks.verifyRule(pb, f.getString('rule_id')),
    })),
  };
}

/** Whether an AI agent has worked here — every agent action is in the audit log. */
/**
 * Is an agent there to answer? Inside CraftBot, CraftBot hands it every request at once (its bridge is
 * set for this app) — that is the honest "connected", even on day one before the agent has done
 * anything. Elsewhere only an agent's own recent work says so.
 */
function agentPresence(app) {
  const last = repo.first(app, 'audit_log', 'actor_type = "agent"', {}, '-seq');
  const at = last ? last.getString('at') : '';
  const recent = !!at && Date.now() - new Date(at).getTime() < 7 * 86400000;
  const insideCraftBot = !!($os.getenv('CRAFTBOT_BRIDGE_URL') && $os.getenv('CRAFTBOT_BRIDGE_TOKEN'));
  return { ok: true, ever: !!last, last_seen: at, recent, inside_craftbot: insideCraftBot, connected: insideCraftBot || recent };
}

/** The app a problem is about (its evidence names it), so the fix shows on that app's page too. '' for server-wide problems. */
function appOfFinding(app, f) {
  const id = String((repo.jsonOf(f, 'evidence') || {}).app_id || '');
  return id && repo.byId(app, 'apps', id) ? id : '';
}

function requestPlan(app, actor, p) {
  const f = repo.byId(app, 'findings', p.finding_id);
  if (!f) throw new OpError(404, 'Finding not found.', 'not_found');
  if (f.getString('status') === 'resolved') throw new OpError(409, 'This finding is already resolved.');
  if (require('../v2/controls/index.js').get(f.getString('rule_id'))) return requestV2(app, actor, f);
  const options = playbooks.forRule(f.getString('rule_id'), repo.jsonOf(f, 'evidence'));
  const pb = p.playbook_id ? playbooks.get(String(p.playbook_id)) : options[0];
  if (!pb || options.indexOf(pb) < 0) throw new OpError(400, `No playbook "${p.playbook_id || ''}" for ${f.getString('rule_id')}.`);
  const existing = repo.first(app, 'remediations', 'fingerprint = {:f} && (status = "plan_requested" || status = "planned" || status = "approved" || status = "executing" || status = "verifying")', { f: f.getString('fingerprint') });
  if (existing) throw new OpError(409, `A remediation is already ${existing.getString('status').replace('_', ' ')} for this finding.`, 'duplicate');
  const guided = pb.risk === 'guided';
  // Anything else used to be planned AND run by the agent with its own access — on whatever machine the
  // agent runs, which need not be this server (N-B43). Now it is a person's question to the agent, which
  // prepares changes for the server's own monitor; a person confirms each.
  if (!guided) return require('./help.js').askFix(app, actor, f, pb);
  const rem = repo.create(app, 'remediations', {
    finding: f.id,
    fingerprint: f.getString('fingerprint'),
    incident: f.getString('incident'),
    asset: f.getString('asset'),
    app: appOfFinding(app, f),
    playbook_id: pb.id,
    title: `${pb.title} — ${f.getString('title')}`.slice(0, 300),
    plain_title: `Fix: ${f.getString('plain_title') || f.getString('title')}`.slice(0, 300),
    risk_class: pb.risk,
    // Guided fixes are done by a person: the playbook's steps ARE the plan.
    status: 'planned',
    plan: { steps: pb.steps.map((s) => ({ description: s, command: '', target: '', rollback: '' })) },
    preconditions: pb.preconditions,
    downtime: pb.downtime,
    cost_note: pb.cost,
    requested_by: actor.label,
    planned_by: 'playbook (guided)',
    steps_log: [],
  });
  audit.append(app, actor, 'remediation.requested', { collection: 'remediations', id: rem.id }, `Fix requested: ${rem.getString('title')}`, { playbook: pb.id });
  if (f.getString('status') === 'open') {
    require('./findings.js').transition(app, actor, 'acknowledge', { finding_id: f.id, note: FIX_REQUESTED_NOTE });
  }
  return {
    ok: true,
    remediation_id: rem.id,
    status: rem.getString('status'),
    message: 'This fix has to be done by a person — follow the steps, then mark it done.',
  };
}

/** A person asked NetSentry to fix a v2 issue itself: the plan is the typed actions, ready for approval. */
function requestV2(app, actor, f, opts) {
  const fix = v2Fix(app, f);
  if (!fix) throw new OpError(400, 'NetSentry cannot make this change itself. Follow "Show me how".', 'no_builtin_fix');
  const existing = repo.first(app, 'remediations', 'fingerprint = {:f} && (status = "plan_requested" || status = "planned" || status = "approved" || status = "executing" || status = "verifying")', { f: f.getString('fingerprint') });
  if (existing) throw new OpError(409, `A fix is already ${existing.getString('status').replace('_', ' ')} for this.`, 'duplicate');
  const plan = { steps: fix.steps };
  const hash = planHash(sha256, plan);
  const rem = repo.create(app, 'remediations', {
    finding: f.id, fingerprint: f.getString('fingerprint'), incident: f.getString('incident'), asset: f.getString('asset'), app: appOfFinding(app, f),
    playbook_id: V2_FIX, title: fix.title.slice(0, 300), plain_title: `Fix: ${f.getString('plain_title') || f.getString('title')}`.slice(0, 300),
    risk_class: 'approve', status: 'planned', plan, plan_hash: hash, preconditions: fix.preconditions, downtime: fix.downtime, cost_note: 'none',
    blast_radius: fix.steps.map((st) => st.target).filter((t, i, a) => t && a.indexOf(t) === i).join(', '),
    requested_by: actor.label, planned_by: 'NetSentry (built-in actions)', steps_log: [],
  });
  audit.append(app, actor, 'remediation.requested', { collection: 'remediations', id: rem.id }, `Fix requested: ${rem.getString('title')}`, { builtin: true, steps: fix.steps.map((st) => st.action) });
  // Prepared from a preview (v4): the problem stays open until a person confirms the fix.
  if (!(opts && opts.prepareOnly) && f.getString('status') === 'open') require('./findings.js').transition(app, actor, 'acknowledge', { finding_id: f.id, note: FIX_REQUESTED_NOTE });
  return {
    ok: true,
    remediation_id: rem.id,
    status: 'planned',
    message: executorReady(app, f.getString('asset'))
      ? 'Here is exactly what will change. Approve it and the monitor on the server applies it, then NetSentry checks it worked.'
      : 'Here is exactly what would change. To let NetSentry apply it, switch fixing on at the server (see the fix page), or follow "Show me how".',
  };
}

function approveInternal(app, rem, actor) {
  move(app, rem, 'approved', {
    approved_plan_hash: rem.getString('plan_hash'),
    approved_by: actor.label,
    approved_at: repo.nowIso(),
    deadline_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
  }, actor, actor.type === 'system' ? `Started "${rem.getString('title')}" — as set up by ${actor.label}` : `Approved "${rem.getString('title')}"`);
  // Applied by the machine's own monitor — the only thing that runs a change (N-B43).
}

function approve(app, actor, p) {
  const rem = requireRem(app, p.remediation_id);
  if (rem.getString('risk_class') === 'guided') throw new OpError(409, 'Guided fixes are done by a person — mark them done instead.');
  if (!rem.getString('plan_hash')) throw new OpError(409, 'There is no plan to approve yet.');
  // Only NetSentry's typed changes can be applied — by the server's monitor. A plan of commands someone
  // wrote (older versions let the agent run them itself) is not approved any more (N-B43).
  if (!require('../v2/actions.js').isTyped(repo.jsonOf(rem, 'plan'))) {
    throw new OpError(409, 'NetSentry only applies its own changes, through the monitor on the server. Follow the steps yourself, or ask the agent — it prepares changes for you to confirm.', 'not_typed');
  }
  if (paused(app)) throw new OpError(409, 'Remediation is paused (Workspace → Settings). Resume it first.', 'paused');
  approveInternal(app, rem, actor);
  return { ok: true, remediation_id: rem.id, status: 'approved' };
}

function reject(app, actor, p) {
  const rem = requireRem(app, p.remediation_id);
  const note = String(p.note || '').trim();
  if (!note) throw new OpError(400, 'Say why the plan is rejected, so it can be re-planned.');
  move(app, rem, 'rejected', { failure_reason: note }, actor, `Rejected "${rem.getString('title')}": ${note}`);
  return { ok: true, remediation_id: rem.id, status: 'rejected' };
}

/** Plans are applied by the machine's own monitor only — nobody else may claim or report them (C10, N-B43). */
function monitorOnly(rem, actor) {
  if (actor.type !== 'sensor' && actor.type !== 'system') {
    throw new OpError(403, "Only the server's own monitor applies and reports changes.");
  }
}

function claim(app, actor, p) {
  const rem = requireRem(app, p.remediation_id);
  monitorOnly(rem, actor);
  if (paused(app)) throw new OpError(409, 'Remediation is paused by an admin. Do not execute anything.', 'paused');
  if (rem.getString('status') !== 'approved') throw new OpError(409, `Only approved fixes can be claimed (this one is ${rem.getString('status')}).`);
  if (rem.getString('approved_plan_hash') !== rem.getString('plan_hash')) throw new OpError(409, 'The plan changed after approval — it needs approval again.');
  const deadline = repo.isoOf(rem, 'deadline_at');
  if (deadline && Date.parse(deadline) < Date.now()) {
    move(app, rem, 'expired', {}, actor, `Not done — the confirmation ran out before it started: "${rem.getString('title')}"`);
    throw new OpError(409, 'The approval expired. Ask for approval again.');
  }
  const busy = repo.first(app, 'remediations', 'asset = {:a} && status = "executing" && id != {:id}', { a: rem.getString('asset'), id: rem.id });
  if (busy) throw new OpError(409, 'Another fix is being applied to this asset. One at a time.', 'busy');
  const backup = String(p.backup_ref || '').trim();
  if ((rem.getString('risk_class') === 'approve' || rem.getString('risk_class') === 'high') && !backup) {
    throw new OpError(400, 'Take a backup/snapshot first and pass backup_ref (where it is), so this can be rolled back.');
  }
  move(app, rem, 'executing', { claimed_at: repo.nowIso(), backup_ref: backup, executor: actor.type === 'agent' ? 'agent' : actor.label, steps_log: [] }, actor,
    `Started "${rem.getString('title')}"`);
  return { ok: true, remediation_id: rem.id, status: 'executing', plan: repo.jsonOf(rem, 'plan'), plan_hash: rem.getString('plan_hash') };
}

function reportStep(app, actor, p) {
  const rem = requireRem(app, p.remediation_id);
  monitorOnly(rem, actor);
  if (rem.getString('status') !== 'executing') throw new OpError(409, 'Steps can only be reported while executing.');
  const planSteps = (repo.jsonOf(rem, 'plan') || { steps: [] }).steps;
  const i = Number(p.step_index);
  if (!(i >= 0 && i < planSteps.length) || Math.floor(i) !== i) throw new OpError(400, `step_index must be 0–${planSteps.length - 1}.`);
  const outcome = String(p.outcome || '');
  if (['ok', 'failed', 'skipped'].indexOf(outcome) < 0) throw new OpError(400, 'outcome must be ok, failed or skipped.');
  const log = repo.jsonOf(rem, 'steps_log') || [];
  log.push({ step: i, outcome, output: String(p.output_excerpt || '').slice(0, 4000), at: repo.nowIso(), by: actor.type === 'agent' ? 'agent' : actor.label });
  repo.update(app, rem, { steps_log: log });
  return { ok: true, remediation_id: rem.id, logged: log.length };
}

/** The executor says it is done: compare the plan, then re-check. */
function complete(app, actor, p) {
  const rem = requireRem(app, p.remediation_id);
  monitorOnly(rem, actor);
  if (rem.getString('status') !== 'executing') throw new OpError(409, 'Only an executing fix can be completed.');
  const executed = String(p.executed_plan_hash || '');
  if (executed !== rem.getString('approved_plan_hash')) {
    move(app, rem, 'failed', { executed_plan_hash: executed, failure_reason: 'The executor reported a different plan than the one approved.' }, actor,
      `PLAN MISMATCH on "${rem.getString('title')}": executed ${executed.slice(0, 12) || '(none)'} ≠ approved ${rem.getString('approved_plan_hash').slice(0, 12)}`);
    alertPeople(app, rem, 'high', 'Fix executed with a plan that was not approved', 'The executor reported a plan hash different from the approved one. Review what was changed on the asset.');
    return { ok: false, remediation_id: rem.id, status: 'failed', error: 'Executed plan does not match the approved plan — flagged for review.' };
  }
  // Every step must be accounted for; a failed step is a failed fix, not a completed one.
  const planSteps = (repo.jsonOf(rem, 'plan') || { steps: [] }).steps;
  const latest = {};
  for (const e of repo.jsonOf(rem, 'steps_log') || []) if (e.step >= 0) latest[e.step] = e.outcome;
  const missing = planSteps.map((_, i) => i).filter((i) => !(i in latest));
  if (missing.length) {
    throw new OpError(409, `Report every step before completing — not reported: step ${missing.map((i) => i + 1).join(', ')}.`, 'steps_missing');
  }
  const failed = planSteps.map((_, i) => i).filter((i) => latest[i] === 'failed');
  if (failed.length) {
    throw new OpError(409, `Step ${failed.map((i) => i + 1).join(', ')} failed — roll back and call remediations.fail instead.`, 'step_failed');
  }
  return startVerification(app, rem, actor, { executed_plan_hash: executed });
}

function markManual(app, actor, p) {
  const rem = requireRem(app, p.remediation_id);
  if (rem.getString('purpose') && rem.getString('purpose') !== 'fix') throw new OpError(409, 'A change NetSentry makes is proven by the server, not marked done by hand.');
  const note = String(p.note || '').trim();
  if (!note) throw new OpError(400, 'Say what was done.');
  const s = rem.getString('status');
  if (['planned', 'approved', 'executing', 'failed'].indexOf(s) < 0) throw new OpError(409, `Cannot mark a ${s} fix as done.`);
  // A person did it outside the agent flow; go straight to verification.
  if (s !== 'executing') repo.update(app, rem, { status: 'executing', executor: actor.label, claimed_at: repo.nowIso() });
  const log = repo.jsonOf(rem, 'steps_log') || [];
  log.push({ step: -1, outcome: 'ok', output: note.slice(0, 1000), at: repo.nowIso(), by: actor.label });
  repo.update(app, rem, { steps_log: log });
  return startVerification(app, rem, actor, {});
}

function startVerification(app, rem, actor, extra) {
  // Start / stop / restart: the monitor proved the result on the machine before it said "complete".
  if (rem.getString('purpose') && rem.getString('purpose') !== 'fix') {
    const proof = (repo.jsonOf(rem, 'steps_log') || []).filter((e) => e.step >= 0).map((e) => e.output).filter(Boolean);
    if (['backup', 'restore'].indexOf(rem.getString('purpose')) >= 0) require('./backupjobs.js').settle(app, rem, proof, true);
    // v4 §7.3: "back it up first, then remove" — that copy is recorded like any other backup.
    if (rem.getString('purpose') === 'remove' && (((repo.jsonOf(rem, 'plan') || {}).steps || [])[0] || {}).action === 'backup.run') {
      const first = (repo.jsonOf(rem, 'steps_log') || []).find((e) => e.step === 0 && e.outcome === 'ok');
      if (first) require('./backupjobs.js').settle(app, rem, [first.output], true);
    }
    move(app, rem, 'done', Object.assign({ completed_at: repo.nowIso(), verify_result: { checked: true, by: 'the monitor on the server', note: proof.join(' ').slice(0, 500) } }, extra), actor,
      `Done: "${rem.getString('title')}"`);
    try {
      // Fresh reports, so the app's state on every page catches up now rather than in 5 minutes.
      require('./sensors.js').requestRun(app, rem.getString('asset'));
    } catch (_) {
      /* best effort */
    }
    return { ok: true, remediation_id: rem.id, status: 'done' };
  }
  const pb = playbooks.get(rem.getString('playbook_id'));
  const f = repo.byId(app, 'findings', rem.getString('finding'));
  const rule = f ? f.getString('rule_id') : '';
  const verifyRule = pb ? playbooks.verifyRule(pb, rule) : require('../v2/controls/index.js').get(rule) ? rule : null;
  if (!verifyRule || !f) {
    move(app, rem, 'done', Object.assign({ completed_at: repo.nowIso(), verify_result: { checked: false, note: 'NetSentry cannot check this kind of fix by itself, so the issue was closed on your word.' } }, extra), actor,
      `Done (no automatic check): "${rem.getString('title')}"`);
    if (f && (f.getString('status') === 'open' || f.getString('status') === 'acknowledged')) {
      require('./findings.js').transition(app, actor, 'resolve', { finding_id: f.id, note: `Handled: ${rem.getString('title')}`.slice(0, 500) });
    }
    return { ok: true, remediation_id: rem.id, status: 'done' };
  }
  move(app, rem, 'verifying', Object.assign({ completed_at: repo.nowIso(), verify_result: { checked: false, rule: verifyRule, note: 'Waiting for a fresh scan.' } }, extra), actor,
    `Done on the server — now checking it worked: "${rem.getString('title')}"`);
  // Console-scanned assets can be re-checked now; sensor hosts re-check on their next report.
  const asset = repo.byId(app, 'assets', rem.getString('asset'));
  if (asset && asset.getString('kind') !== 'host') {
    try {
      require('./pipeline.js').scanAsset(app, asset.id, 20000);
    } catch (err) {
      console.error('[netsentry] verification scan failed:', err);
    }
  }
  const after = repo.byId(app, 'remediations', rem.id);
  return {
    ok: true,
    remediation_id: rem.id,
    status: after.getString('status'),
    message: asset && asset.getString('kind') === 'host' ? 'Waiting for the sensor to report again (within its interval) to confirm the fix.' : 'Re-checked now.',
  };
}

function fail(app, actor, p) {
  const rem = requireRem(app, p.remediation_id);
  monitorOnly(rem, actor);
  const reason = String(p.reason || '').trim();
  if (!reason) throw new OpError(400, 'Say what went wrong.');
  const rolled = p.rolled_back === true || p.rolled_back === 'true';
  if (rem.getString('status') === 'executing' && rolled) {
    repo.update(app, rem, { status: 'failed', failure_reason: reason.slice(0, 5000) });
    move(app, rem, 'rolled_back', {}, actor, `Didn't work, so it was put back: "${rem.getString('title')}": ${reason.slice(0, 300)}`);
  } else {
    move(app, rem, 'failed', { failure_reason: reason.slice(0, 5000) }, actor, `Failed: "${rem.getString('title')}": ${reason.slice(0, 300)}`);
  }
  if (['backup', 'restore'].indexOf(rem.getString('purpose')) >= 0) require('./backupjobs.js').settle(app, rem, [reason], false);
  alertPeople(app, rem, 'high', `A fix failed${rolled ? ' and was rolled back' : ''}`, reason);
  return { ok: true, remediation_id: rem.id, status: rolled ? 'rolled_back' : 'failed' };
}

function cancel(app, actor, p) {
  const rem = requireRem(app, p.remediation_id);
  move(app, rem, 'cancelled', { failure_reason: String(p.note || '') }, actor, `Cancelled "${rem.getString('title')}"`);
  return { ok: true, remediation_id: rem.id, status: 'cancelled' };
}

function queue(app, p) {
  const status = String(p.status || '');
  const filter = status ? 'status = {:s}' : OPEN.map((s) => `status = "${s}"`).join(' || ');
  const rows = repo.find(app, 'remediations', filter, { s: status }, '-updated', 50);
  return {
    ok: true,
    remediations: rows.map((r) => {
      const a = repo.byId(app, 'assets', r.getString('asset'));
      return {
        id: r.id, title: r.getString('title'), status: r.getString('status'), risk_class: r.getString('risk_class'),
        playbook_id: r.getString('playbook_id'), asset: a ? a.getString('identifier') : '', asset_kind: a ? a.getString('kind') : '',
        plan: repo.jsonOf(r, 'plan'), plan_hash: r.getString('plan_hash'), preconditions: repo.jsonOf(r, 'preconditions'),
      };
    }),
  };
}

function alertPeople(app, rem, severity, title, text) {
  try {
    require('./alerts.js').dispatch(app, { kind: 'remediation', severity, title: `${title}: ${rem.getString('title')}`, text });
  } catch (err) {
    console.error('[netsentry] remediation alert failed:', err);
  }
}

/**
 * Called after a scan evaluated rules on an asset: settle remediations waiting
 * for verification whose rule was just evaluated. Passive sources (weekly
 * internet scans) cannot prove a fix failed — only that it has not shown yet.
 */
function verifyAfterScan(app, assetId, evaluatedRuleIds, passive) {
  for (const rem of repo.find(app, 'remediations', 'asset = {:a} && status = "verifying"', { a: assetId })) {
    const f = repo.byId(app, 'findings', rem.getString('finding'));
    if (!f || evaluatedRuleIds.indexOf(f.getString('rule_id')) < 0) continue;
    const system = { type: 'system', label: 'verification' };
    const status = f.getString('status');
    if (status === 'resolved') {
      move(app, rem, 'done', { verify_result: { checked: true, rule: f.getString('rule_id'), result: 'passed', at: repo.nowIso() } }, system,
        `Checked: "${rem.getString('title')}" worked`);
    } else if (!passive) {
      move(app, rem, 'failed', { failure_reason: 'Still detected on a fresh scan after the fix.', verify_result: { checked: true, rule: f.getString('rule_id'), result: 'still detected', at: repo.nowIso() } }, system,
        `Checked: "${rem.getString('title')}" didn't fix the problem`);
      alertPeople(app, rem, 'medium', 'Fix did not work', `The problem is still there after "${rem.getString('title')}".`);
    } else {
      repo.update(app, rem, { verify_result: { checked: false, rule: f.getString('rule_id'), result: 'not yet visible', note: 'This source is refreshed slowly (e.g. weekly internet scans); waiting for fresh data.', at: repo.nowIso() } });
    }
  }
}

/** Minute tick: expire stale approvals, time out stuck executions and slow verifications. */
function housekeeping(app) {
  const system = { type: 'system', label: 'system' };
  const now = Date.now();
  for (const rem of repo.find(app, 'remediations', 'status = "approved"')) {
    const d = repo.isoOf(rem, 'deadline_at');
    if (d && Date.parse(d) < now) move(app, rem, 'expired', {}, system, `Not done — the confirmation ran out: "${rem.getString('title')}"`);
  }
  for (const rem of repo.find(app, 'remediations', 'status = "executing"')) {
    const c = repo.isoOf(rem, 'claimed_at');
    if (c && now - Date.parse(c) > EXECUTION_TIMEOUT_MS) {
      move(app, rem, 'failed', { failure_reason: 'No completion reported within 2 hours.' }, system, `Didn't finish within 2 hours: "${rem.getString('title')}"`);
      alertPeople(app, rem, 'high', 'A fix has been executing for over 2 hours', 'Check the asset: the executor started but never reported completion.');
    }
  }
  // v3: a prepared start/stop/update/backup/install nobody confirmed within a day is withdrawn (a fix waits for a person).
  for (const rem of repo.find(app, 'remediations', 'status = "planned" && purpose != "" && purpose != "fix"')) {
    if (now - Date.parse(repo.isoOf(rem, 'created')) > 24 * 3600000) move(app, rem, 'cancelled', { failure_reason: 'Nobody confirmed it within a day.' }, system, `Withdrawn unconfirmed: "${rem.getString('title')}"`);
  }
  for (const rem of repo.find(app, 'remediations', 'status = "verifying"')) {
    const c = repo.isoOf(rem, 'completed_at');
    if (c && now - Date.parse(c) > VERIFY_MAX_MS) move(app, rem, 'expired', { failure_reason: 'Could not be verified within 7 days.' }, system, `Couldn't check it worked within 7 days: "${rem.getString('title')}"`);
  }
}

module.exports = {
  V2_FIX, executorReady, v2Fix, requestV2, FIX_REQUESTED_NOTE, alertPeople, approveInternal,
  suggest, requestPlan, approve, reject, claim, reportStep, complete, markManual, fail, cancel, queue,
  verifyAfterScan, housekeeping, agentPresence };
