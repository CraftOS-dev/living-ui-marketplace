/// <reference path="../pb_data/types.d.ts" />
/**
 * Working with your AI agent (fix 8): one trigger per task, its params
 * naming the record, fired from the op where a person asks. No job queue.
 *
 * Triggers are declared by the modules (events_*.js `triggers`, read by
 * lib_events.triggers()) and written to triggers.json by
 * tools/gen_triggers.mjs:
 *
 *   deck_triage: {
 *     record: 'intake_items',        // the collection of the record its param names ('' = the firm: kept on the settings row)
 *     param: 'item_id',              // the param that carries the record id
 *     perm: 'intake:edit',           // what a person needs to ask (agent.ask)
 *     label, description, fires,     // Settings and the consent modal, in plain words
 *     cooldown: 10,                  // seconds (the platform's floor is 10)
 *     policy: { key, label, tip },   // optional: the switch (Settings, Your AI agent) that lets the app fire it on its own
 *     deal: 'lib_x.dealOf',          // optional: fn(app, rec) -> the deal it is about ('' none)
 *     nda: true,                     // with deal: your AI agent may read that deal's NDA files while it is asked
 *     check: 'lib_x.askCheck',       // optional: fn(ctx, rec, p) -> extra params (throws when there is nothing to ask)
 *     asked: 'lib_x.onAsked',        // optional: fn(ctx, rec, request, extra) after a person's agent.ask fired
 *     ended: 'lib_x.onCannot',       // optional: fn(ctx, rec, reason) after agent.cannot
 *     params: { sections: {...} },   // more params than the record id
 *     lands: { 'calls.note': 'event' },  // optional: your AI agent's call of that op (run, or stored as a proposal) naming the record in that param lands the ask
 *                                    // ('security:securities.holding': the param names a security whose holding is the record)
 *     instruction: '...',            // what your AI agent does (under 1,000 characters)
 *   }
 *
 * - A person asks (agent.ask, or a module op such as Brief, Draft, Pass with
 *   an email, a question): requestFor() checks the record, fires the trigger
 *   through _triggers_lib.fire with the record id in params, keeps the
 *   request id on the record (its `agent` field: { <trigger>: { request,
 *   at, by, done_at, error } }), writes an audit line with the request id,
 *   and answers 409 in plain words when the record already waits for an
 *   answer, on a cooldown, or in a demo firm.
 * - Automatic triggers fire through ask() only when their policy switch is
 *   on (all off by default). A fire the platform refused (cooldown, hourly
 *   cap) is remembered and fired again by the minute job (reask), so no ask
 *   is lost.
 * - Never twice for one record: while a request asked less than 24 hours
 *   ago has not landed (pending), the same trigger is not fired for that
 *   record again. Your AI agent's result ops mark it landed (landed());
 *   agent.cannot records why it could not. A request nobody picked up in 24
 *   hours may be asked again (Retry); a screen that saw the request done or
 *   rejected asks again with --again <that request id>.
 * - Hooks never read agent_requests (the platform's queue); screens follow a
 *   request with the kit's useAgentRequest.
 * - NDA: while an ask with nda on is pending for a deal (asked less than 24
 *   hours ago, not landed, not refused), your AI agent may read that deal's
 *   NDA files (ndaAllowed).
 * - A demo firm never fires.
 */

const DAY_MS = 24 * 3600 * 1000;
const REASK_KEY = 'vo_agent_reask';
const REASK_MAX = 300;
const RETRYABLE = ['cooldown', 'rate_capped', 'fire_failed'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/* ------------------------------------------------------------ registry */

/** Every declared trigger: { name: def } (lib_events.triggers). */
function defs() {
  return L('lib_events').triggers();
}

function def(name) {
  const d = defs()[String(name || '')];
  if (d === undefined) throw u().fail(400, 'Unknown trigger ' + name + '. Triggers: ' + Object.keys(defs()).sort().join(', ') + '.', 'invalid_param', { param: 'trigger' });
  return d;
}

/** The policy switches: { key: { label, tip, triggers: [names] } }. */
function switches() {
  const out = {};
  const all = defs();
  for (const name of Object.keys(all)) {
    const p = all[name].policy;
    if (!p || !p.key) continue;
    if (out[p.key] === undefined) out[p.key] = { label: p.label || p.key, tip: p.tip || '', triggers: [] };
    out[p.key].triggers.push(name);
  }
  return out;
}

/** The firm's switches: { key: bool } (unknown or unset keys are off). */
function policyOf(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of Object.keys(switches())) out[k] = src[k] === true;
  return out;
}

function policy(app) {
  const s = L('lib_settings').row(app);
  return policyOf(s ? u().jsonOf(s, 'agent_policy', {}) : {});
}

/** Is this switch on for the firm? */
function policyOn(app, key) {
  return !!key && policy(app)[key] === true;
}

/** The triggers in plain words (Settings, ai.inventory): name, label, what fires it, cooldown, params, its switch. */
function triggersOut(app) {
  const all = defs();
  const on = app ? policy(app) : {};
  return Object.keys(all).map((name) => {
    const d = all[name];
    const params = (d.param ? [d.param] : []).concat(Object.keys(d.params || {}));
    return { name: name, module: d.module, label: d.label || name, description: d.description || '', fires: d.fires || '', cooldown_seconds: Math.max(10, Number(d.cooldown || 10)), params: params, record: d.record || '', policy: d.policy && d.policy.key ? d.policy.key : '', on: d.policy && d.policy.key ? on[d.policy.key] === true : null };
  });
}

/* --------------------------------------------------------------- state */

function stateMap(rec) {
  if (rec === null || rec === undefined) return {};
  const m = u().jsonOf(rec, 'agent', {});
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

/** The record's ask of a trigger: { request, at, by, done_at, error } or null. */
function state(rec, trigger) {
  const e = stateMap(rec)[trigger];
  return e && typeof e === 'object' && e.request ? e : null;
}

function ageMs(e) {
  const t = Date.parse(String((e && e.at) || ''));
  return Number.isFinite(t) ? Date.now() - t : Infinity;
}

/** Asked less than 24 hours ago and neither landed nor refused. */
function isPending(e) {
  return !!e && !e.done_at && !e.error && ageMs(e) < DAY_MS;
}

/** Asked 24 hours ago or more and never answered: a person may ask again (Retry). */
function isStale(e) {
  return !!e && !e.done_at && !e.error && ageMs(e) >= DAY_MS;
}

function pending(rec, trigger) {
  return isPending(state(rec, trigger));
}

function entryOut(e) {
  return { request: e.request, at: e.at || '', by: e.by || '', done_at: e.done_at || '', error: e.error || '', pending: isPending(e), stale: isStale(e) };
}

/** What a screen needs to follow the record's asks: { <trigger>: { request, at, by, done_at, error, pending, stale } }. */
function view(rec, names) {
  const m = stateMap(rec);
  const out = {};
  for (const k of Object.keys(m)) {
    if (k.charAt(0) === '_' || (names && names.indexOf(k) < 0)) continue;
    const e = m[k];
    if (e && typeof e === 'object' && e.request) out[k] = entryOut(e);
  }
  return out;
}

/**
 * A StepTrack for the record's ask of a trigger (null when never asked):
 * at 0 while asked (a screen moves it on when useAgentRequest says your AI
 * agent is on it), the last step once it landed; failed when your AI agent
 * could not, or nobody picked it up in 24 hours (stale).
 */
function track(rec, trigger, labels) {
  const e = state(rec, trigger);
  if (e === null) return null;
  const last = labels.length - 1;
  const stale = isStale(e);
  const status = e.done_at ? 'done' : e.error ? 'failed' : stale ? 'unanswered' : 'asked';
  return { trigger: trigger, request: e.request, status: status, at: e.done_at ? last : 0, labels: labels, open: isPending(e), failed: !!e.error || stale, stale: stale, error: e.error || (stale ? "Your AI agent hasn't picked this up." : ''), asked_at: e.at || '', done_at: e.done_at || '' };
}

function collOf(d) {
  return d.record ? d.record : 'settings';
}

/** Write the record's state (raw SQL: machinery, never an undo step) and keep the record in hand in step. */
function writeState(app, coll, rec, m) {
  u().exec(app, 'UPDATE ' + coll + ' SET agent = {:a} WHERE id = {:id}', { a: JSON.stringify(m), id: rec.id });
  rec.set('agent', m);
  L('lib_bus').touch(coll);
}

function setEntry(app, d, rec, trigger, entry) {
  const m = stateMap(rec);
  m[trigger] = entry;
  writeState(app, collOf(d), rec, m);
}

/** The record a trigger's param names (the settings row for a firm trigger), or null. */
function recordOf(app, d, id) {
  if (!d.record) return L('lib_settings').row(app) || null;
  return u().byId(app, d.record, String(id || ''));
}

function dealOf(app, d, rec) {
  if (!d.deal) return '';
  try {
    return String(L('lib_events').resolve(d.deal)(app, rec) || '');
  } catch (err) {
    console.error('[vo] ' + d.deal + ' failed:', err);
    return '';
  }
}

/* ---------------------------------------------------------------- NDA */

/** The NDA grants of a deal still inside their 24 hours: [{ until, trigger, record }]. */
function ndaGrants(deal) {
  const g = stateMap(deal)._nda;
  return (Array.isArray(g) ? g : []).filter((x) => x && Date.parse(String(x.until || '')) > Date.now());
}

function grantNda(app, dealRef, trigger, recId) {
  const deal = L('lib_auth').dealRef(app, dealRef);
  if (deal === null) return;
  const m = stateMap(deal);
  m._nda = ndaGrants(deal)
    .filter((x) => !(x.trigger === trigger && x.record === recId))
    .concat([{ until: new Date(Date.now() + DAY_MS).toISOString(), trigger: trigger, record: recId }]);
  writeState(app, 'deals', deal, m);
}

/** May your AI agent read this deal's NDA files now (an ask with nda on is pending for it)? The deal: id or display id. */
function ndaAllowed(app, dealRef) {
  if (!dealRef) return false;
  const deal = L('lib_auth').dealRef(app, String(dealRef));
  if (deal === null) return false;
  const all = defs();
  // Open while one of the asks that granted it still waits (landed or refused asks close it).
  return ndaGrants(deal).some((g) => {
    const d = all[g.trigger];
    const rec = d ? recordOf(app, d, g.record) : null;
    return rec !== null && pending(rec, g.trigger);
  });
}

/* -------------------------------------------------------------- firing */

function agoText(e) {
  const h = Math.floor(ageMs(e) / 3600000);
  if (h >= 1) return h + (h === 1 ? ' hour' : ' hours') + ' ago';
  const m = Math.max(1, Math.floor(ageMs(e) / 60000));
  return m + (m === 1 ? ' minute' : ' minutes') + ' ago';
}

/** Why the trigger may not fire for this record now ({ code, message, request? }), or null. */
function refusal(app, d, name, rec, again) {
  if (L('lib_mail').demo(app)) return { code: 'demo', message: 'This is the demo firm: your AI agent is not asked.' };
  const e = state(rec, name);
  if (isPending(e) && (!again || again !== e.request)) return { code: 'pending', message: 'Your AI agent was asked for this ' + agoText(e) + ' and has not answered yet. You can ask again 24 hours after asking.', request: e.request };
  const deal = dealOf(app, d, rec);
  if (deal !== '' && !L('lib_auth').dealVisible(L('lib_auth').agentCtx(app), deal)) return { code: 'agent_off', message: 'Your AI agent is off for this restricted deal (the deal team can allow it).' };
  return null;
}

/** Fire now and keep the request on the record: { ok, id } or { ok: false, code, message }. */
function fireNow(app, d, name, rec, extra, by) {
  const params = {};
  if (d.param) params[d.param] = rec.id;
  for (const k of Object.keys(extra || {})) if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') params[k] = extra[k];
  const r = require(`${__hooks}/_triggers_lib.js`).fire(app, name, params, 'hook');
  if (!r || r.ok !== true) return { ok: false, code: r && r.code ? r.code : 'not_sent', message: r && r.message ? r.message : '' };
  setEntry(app, d, rec, name, { request: r.id, at: u().nowIso(), by: by || '', done_at: '', error: '' });
  L('lib_activity').endRun(app);
  if (d.nda) {
    const deal = dealOf(app, d, rec);
    if (deal !== '') grantNda(app, deal, name, rec.id);
  }
  return { ok: true, id: r.id };
}

function reaskList(app) {
  try {
    const raw = app.store().get(REASK_KEY);
    const v = typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Is an ask of this trigger for this record refused for now and fired again by the minute job (a cooldown)? */
function deferred(app, name, recId) {
  return reaskList(app).some((x) => x.t === name && x.id === recId);
}

function remember(app, name, recId, extra, by) {
  const list = reaskList(app).filter((x) => !(x.t === name && x.id === recId));
  list.push({ t: name, id: recId, extra: extra || {}, by: by || '', at: Date.now() });
  app.store().set(REASK_KEY, JSON.stringify(list.slice(-REASK_MAX)));
}

/**
 * The app asks (an automatic source, or the follow-up of a person's action):
 * fires unless the record already waits for an answer (its request id is
 * answered), the firm is a demo, or opts.policy names a switch that is off.
 * A refused fire is remembered for the minute job. Returns the request id or ''.
 *   ask(app, 'meeting_brief', calEvent, {}, { policy: true })   // only while its switch is on
 *   ask(app, 'pass_draft', pass, {}, { by: memberId })          // a person's action that asks
 */
function ask(app, name, rec, extra, opts) {
  const o = opts || {};
  const d = def(name);
  if (o.policy === true && !(d.policy && policyOn(app, d.policy.key))) return '';
  if (rec === null || rec === undefined) return '';
  const no = refusal(app, d, name, rec, '');
  if (no !== null) return no.code === 'pending' ? no.request : '';
  const by = o.by || (o.policy === true ? 'policy:' + d.policy.key : '');
  const r = fireNow(app, d, name, rec, extra, by);
  if (r.ok) return r.id;
  if (RETRYABLE.indexOf(r.code) >= 0) remember(app, name, rec.id, extra, by);
  else console.error('[vo] could not ask your AI agent (' + name + '): ' + r.code + ' ' + r.message);
  return '';
}

/** The minute job: fire again what the platform refused (cooldown, hourly cap); an ask older than a day is dropped. */
function reask(app) {
  const list = reaskList(app);
  if (list.length === 0) return 0;
  const keep = [];
  let fired = 0;
  const tried = {};
  for (const x of list) {
    if (Date.now() - Number(x.at || 0) > DAY_MS) continue;
    const d = defs()[x.t];
    if (d === undefined) continue;
    // One try per trigger a minute: the rest of its asks wait for its cooldown.
    if (tried[x.t]) {
      keep.push(x);
      continue;
    }
    const rec = recordOf(app, d, x.id);
    if (rec === null || refusal(app, d, x.t, rec, '') !== null) continue;
    tried[x.t] = true;
    const r = fireNow(app, d, x.t, rec, x.extra || {}, x.by || '');
    if (r.ok) fired++;
    else if (RETRYABLE.indexOf(r.code) >= 0) keep.push(x);
  }
  app.store().set(REASK_KEY, JSON.stringify(keep));
  return fired;
}

/**
 * A person asks (agent.ask and the module ops where a person asks): fires
 * the trigger for the record and writes the audit line with the request id.
 * Refused (the record already waits, a cooldown, a demo firm, a restricted
 * deal): 409 in plain words, or with opts.soft an answer saying why (a
 * cooldown is then fired again by the minute job). Your AI agent asking
 * does the work itself: nothing fires.
 *   -> { request, trigger, record } | { request: '', refused, message }
 */
function requestFor(ctx, name, rec, extra, opts) {
  const o = opts || {};
  const util = u();
  const app = ctx.app;
  const d = def(name);
  if (ctx.isAgent) return { request: '', trigger: name, record: rec.id, refused: 'self', message: 'You were not asked: do it yourself.' };
  const no = refusal(app, d, name, rec, String(o.again || ''));
  if (no !== null) {
    if (o.soft) return { request: no.request || '', trigger: name, record: rec.id, refused: no.code, message: no.message };
    throw util.fail(409, no.message, no.code, { request: no.request || '', trigger: name });
  }
  const r = fireNow(app, d, name, rec, extra, ctx.memberId || '');
  if (!r.ok) {
    const busy = r.code === 'cooldown' || r.code === 'rate_capped';
    const message = busy ? 'Your AI agent was asked for this kind of work a moment ago. Try again shortly.' : 'Your AI agent could not be asked right now' + (r.message ? ': ' + r.message : '.');
    if (o.soft) {
      if (RETRYABLE.indexOf(r.code) >= 0) remember(app, name, rec.id, extra, ctx.memberId || '');
      return { request: '', trigger: name, record: rec.id, refused: r.code, message: busy ? 'Your AI agent is asked in a minute (it was asked a moment ago).' : message };
    }
    throw util.fail(409, message, r.code, { trigger: name });
  }
  const was = ctx.audited;
  L('lib_audit').write(ctx, { op: ctx.op || 'agent.ask', collection: collOf(d), record: rec.id, summary: 'Asked your AI agent: ' + (d.label || name), data: { trigger: name, request: r.id } });
  ctx.audited = was;
  return { request: r.id, trigger: name, record: rec.id };
}

/** Your AI agent's result landed on the record: its ask is answered (a person may ask again). */
function landed(app, name, rec) {
  if (rec === null || rec === undefined) return;
  const d = defs()[name];
  if (d === undefined) return;
  // Done before the minute job asked again: nothing is asked any more.
  if (deferred(app, name, rec.id)) app.store().set(REASK_KEY, JSON.stringify(reaskList(app).filter((x) => !(x.t === name && x.id === rec.id))));
  const e = state(rec, name);
  if (e === null || e.done_at) return;
  setEntry(app, d, rec, name, Object.assign({}, e, { done_at: u().nowIso(), error: '' }));
}

let _lands = null;
/** { op: [{ trigger, param }] } from the defs' `lands`. */
function landsByOp() {
  if (_lands === null) {
    _lands = {};
    const all = defs();
    for (const name of Object.keys(all)) {
      const l = all[name].lands || {};
      for (const op of Object.keys(l)) (_lands[op] = _lands[op] || []).push({ trigger: name, param: l[op] });
    }
  }
  return _lands;
}

/** After your AI agent's write op (lib_ops): the asks it names in a `lands` param are answered. Never throws. */
function landedByOp(app, op, params) {
  const list = landsByOp()[op];
  if (!list) return;
  for (const x of list) {
    try {
      const parts = String(x.param).split(':');
      let id = params ? String(params[parts[0]] || '') : '';
      if (id !== '' && parts[1]) {
        const via = parts[1].split('.');
        const r = u().byId(app, via[0], id);
        id = r !== null ? r.getString(via[1]) : '';
      }
      if (id === '') continue;
      const rec = recordOf(app, defs()[x.trigger], id);
      if (rec !== null) landed(app, x.trigger, rec);
    } catch (err) {
      console.error('[vo] landing ' + x.trigger + ' from ' + op + ' failed:', err);
    }
  }
}

/* ------------------------------------------------------------------ ops */

function recordParam(ctx, d, p) {
  const util = u();
  if (!d.record) return L('lib_settings').row(ctx.app);
  const id = util.str(p, 'record', '');
  if (id === '') throw util.fail(400, 'record is required: the id of the ' + d.record.replace(/_/g, ' ').replace(/s$/, '') + ' (' + d.param + ').', 'missing_param', { param: 'record' });
  const rec = util.byId(ctx.app, d.record, id);
  if (rec === null || !L('lib_auth').recordVisible(ctx, d.record, rec.id)) throw util.fail(404, 'No ' + d.record.replace(/_/g, ' ') + ' record ' + id + ' you can see.', 'not_found', { param: 'record' });
  return rec;
}

/** agent.ask (people): ask your AI agent for one task on one record now. */
function opAsk(ctx, p) {
  const util = u();
  const name = util.req(p, 'trigger', 'deck_triage');
  const d = def(name);
  if (d.ask === false) throw util.fail(400, name + ' is asked from its own screen, not with agent.ask.', 'invalid_param', { param: 'trigger' });
  if (d.perm && d.perm !== 'signed') {
    // perm: 'module:level', or alternatives 'a:edit|b:edit' (any one suffices).
    const alts = String(d.perm).split('|').map((x) => x.split(':'));
    if (!alts.some((a) => L('lib_auth').can(ctx, a[0], a[1] || 'view'))) L('lib_auth').need(ctx, alts[0][0], alts[0][1] || 'view', 'ask your AI agent for this');
  }
  const rec = recordParam(ctx, d, p);
  const extra = d.check ? L('lib_events').resolve(d.check)(ctx, rec, p) || {} : {};
  const out = requestFor(ctx, name, rec, extra, { again: util.str(p, 'again', '') });
  if (d.asked) L('lib_events').resolve(d.asked)(ctx, rec, out.request, extra);
  const fresh = recordOf(ctx.app, d, rec.id) || rec;
  return Object.assign(out, { agent: view(fresh, [name]) });
}

/** agent.cannot (your AI agent): say why you could not do what a trigger asked; the person sees it and may ask again. */
function opCannot(ctx, p) {
  const util = u();
  if (!ctx.isAgent) throw util.fail(403, 'agent.cannot is for your AI agent.', 'agent_only');
  const name = util.req(p, 'trigger', 'deck_triage');
  const d = def(name);
  const reason = util.squash(util.text(p, 'reason', 2000, ''));
  if (reason === '') throw util.fail(400, 'reason is required: what you saw and what a person can do.', 'missing_param', { param: 'reason' });
  const rec = d.record ? util.byId(ctx.app, d.record, util.req(p, 'record')) : L('lib_settings').row(ctx.app);
  if (rec === null) throw util.fail(404, 'No ' + d.record + ' record ' + util.str(p, 'record', '') + '.', 'not_found', { param: 'record' });
  const e = state(rec, name) || { request: '-', at: util.nowIso(), by: '' };
  setEntry(ctx.app, d, rec, name, Object.assign({}, e, { error: util.clip(reason, 2000), done_at: util.nowIso() }));
  if (d.ended) L('lib_events').resolve(d.ended)(ctx, rec, reason);
  L('lib_audit').note(ctx, { collection: collOf(d), record: rec.id, summary: 'Your AI agent could not: ' + (d.label || name) + ' (' + util.clip(reason, 160) + ')' });
  return { trigger: name, record: rec.id, error: reason, message: 'Noted: the person sees why and may ask again.' };
}

/* ------------------------------------------------------- questions (chat) */

function askOut(app, a) {
  const util = u();
  const who = a.getString('asked_by');
  const m = who !== '' ? util.byId(app, 'members', who) : null;
  return {
    id: a.id,
    question: a.getString('question'),
    context: a.getString('context'),
    status: a.getString('status'),
    answer: a.getString('answer'),
    failure: a.getString('failure'),
    request: a.getString('request'),
    asked_by: who,
    asked_by_name: m !== null ? m.getString('name') : '',
    answered_at: a.getString('answered_at'),
    created: a.getString('created'),
    updated: a.getString('updated'),
  };
}

/** chat.ask (people): a question or instruction for your AI agent; it fires question_asked with the question's id. */
function chatAsk(ctx, p) {
  const util = u();
  const app = ctx.app;
  const text = util.text(p, 'text', 8000, '');
  if (util.squash(text) === '') throw util.fail(400, 'Write what you want your AI agent to answer or do.', 'missing_param', { param: 'text' });
  const a = util.newRecord(app, 'agent_asks');
  a.set('question', text);
  a.set('context', util.text(p, 'context', 300, ''));
  a.set('status', 'waiting');
  a.set('asked_by', ctx.memberId || '');
  app.save(a);
  const r = requestFor(ctx, 'question_asked', a, {}, { soft: true });
  const fresh = app.findRecordById('agent_asks', a.id);
  if (r.request !== '') fresh.set('request', r.request);
  else {
    fresh.set('status', 'failed');
    fresh.set('failure', r.message || 'Your AI agent could not be asked.');
  }
  app.save(fresh);
  L('lib_audit').note(ctx, { collection: 'agent_asks', record: a.id, summary: 'Asked your AI agent: ' + util.clip(util.squash(text), 160) });
  return { ask: askOut(app, fresh) };
}

function askRef(ctx, id) {
  const util = u();
  const a = util.byId(ctx.app, 'agent_asks', String(id || ''));
  if (a === null) throw util.fail(404, 'No question ' + id + '. Run chat.list.', 'not_found', { param: 'ask' });
  if (!ctx.isAgent && !ctx.owner && a.getString('asked_by') !== ctx.memberId && !L('lib_auth').can(ctx, 'settings', 'view')) throw util.fail(404, 'No question ' + id + ' you can see.', 'not_found', { param: 'ask' });
  return a;
}

/** chat.get: one question with its answer (your AI agent reads what was asked here). */
function chatGet(ctx, p) {
  const a = askRef(ctx, u().req(p, 'ask'));
  const out = askOut(ctx.app, a);
  if (ctx.isAgent && a.getString('asked_by') !== '') {
    // "What needs me": the top of the asker's Next as they see it.
    try {
      const m = L('lib_auth').memberRef(ctx.app, a.getString('asked_by'));
      out.asker_next = L('lib_next').brief(L('lib_next').collect(L('lib_auth').contextFor(ctx.app, m), []).items, 10, true);
    } catch (err) {
      out.asker_next = [];
    }
    out.local = u().localNow(ctx.app);
  }
  return { ask: out };
}

/** chat.list: the caller's questions (settings viewers: everyone's), newest first. */
function chatList(ctx, p) {
  const util = u();
  const all = ctx.isAgent || ctx.owner || L('lib_auth').can(ctx, 'settings', 'view');
  const mine = util.bool(p, 'mine', !all);
  const status = util.oneOf(p, 'status', ['waiting', 'answered', 'failed', 'all'], 'all');
  const where = [];
  const bind = {};
  if (mine || !all) {
    where.push('asked_by = {:m}');
    bind.m = ctx.memberId || '-';
  }
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const recs = util.findMany(ctx.app, 'agent_asks', where.length > 0 ? where.join(' && ') : '1=1', '-created', util.int(p, 'limit', 30, 1, 200), bind);
  return { asks: recs.map((a) => askOut(ctx.app, a)) };
}

/** chat.answer (your AI agent): the answer to a question, shown under the ask. */
function chatAnswer(ctx, p) {
  const util = u();
  if (!ctx.isAgent) throw util.fail(403, 'chat.answer is for your AI agent.', 'agent_only');
  const a = askRef(ctx, util.req(p, 'ask'));
  const text = util.text(p, 'answer', 20000, '');
  if (util.squash(text) === '') throw util.fail(400, 'answer is required: a short plain answer with the numbers, dates and record names you used.', 'missing_param', { param: 'answer' });
  a.set('answer', text);
  a.set('status', 'answered');
  a.set('failure', '');
  a.set('answered_at', util.nowIso());
  ctx.app.save(a);
  landed(ctx.app, 'question_asked', a);
  if (a.getString('asked_by') !== '') L('lib_notify').notify(ctx.app, [a.getString('asked_by')], { kind: 'agent', title: 'Your AI agent answered: ' + util.clip(util.squash(a.getString('question')), 120), body: util.clip(text, 600), link: '#/agent', ref: 'agent_asks:' + a.id });
  L('lib_audit').note(ctx, { collection: 'agent_asks', record: a.id, summary: 'Answered: ' + util.clip(util.squash(a.getString('question')), 160) });
  return { ask: askOut(ctx.app, a) };
}

/** agent.cannot on a question: it shows as not answered, with the reason. */
function onAskCannot(ctx, a, reason) {
  const fresh = ctx.app.findRecordById('agent_asks', a.id);
  fresh.set('status', 'failed');
  fresh.set('failure', u().clip(reason, 2000));
  ctx.app.save(fresh);
}

/** Is a question this member asked waiting for your AI agent now (it may read their Next)? */
function asking(app, memberId) {
  if (!memberId) return false;
  const since = new Date(Date.now() - DAY_MS).toISOString().replace('T', ' ');
  return u().count(app, "SELECT COUNT(*) AS n FROM agent_asks WHERE asked_by = {:m} AND status = 'waiting' AND created >= {:s}", { m: memberId, s: since }) > 0;
}

module.exports = {
  DAY_MS: DAY_MS,
  defs: defs,
  def: def,
  switches: switches,
  policyOf: policyOf,
  policy: policy,
  policyOn: policyOn,
  triggersOut: triggersOut,
  state: state,
  pending: pending,
  view: view,
  track: track,
  ndaAllowed: ndaAllowed,
  ask: ask,
  reask: reask,
  deferred: deferred,
  requestFor: requestFor,
  landed: landed,
  landedByOp: landedByOp,
  opAsk: opAsk,
  opCannot: opCannot,
  chatAsk: chatAsk,
  chatGet: chatGet,
  chatList: chatList,
  chatAnswer: chatAnswer,
  onAskCannot: onAskCannot,
  asking: asking,
};
