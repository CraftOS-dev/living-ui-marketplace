/// <reference path="../pb_data/types.d.ts" />
/**
 * Your AI agent's proposals (HR OS and Store OS model). When your AI agent
 * calls an operation marked agent 'propose' and the owner did not promote
 * its kind to automatic, the call is checked in a rolled-back transaction
 * and stored here instead of run, with a before and after preview, the
 * evidence quote, a confidence and the reason. A person accepts it (the op
 * then runs as that person, with their rights checked, as its own undoable
 * unit) or dismisses it with a note. Each item is checked again at accept:
 * if what it changes moved since it was proposed it is skipped as stale.
 * The same change proposed twice adds nothing; a different value for the
 * same thing replaces the older one. Pending proposals expire after 14 days.
 *
 * Preview: an op may declare `preview: 'lib_x.fn'` (ctx, params) ->
 * { label, ref, target, fields: [{ name, label, before, after }], notes, risk }, or
 * `diff: { collection, id: '<param>', fields: { <param>: '<field>' } }`;
 * otherwise the preview lists the params.
 *
 * What a person reads: the label is "<record name>: <field labels>" (a deal
 * by its company name; `ref` keeps its display id, D-0012), and each field
 * is one line "Field label: before -> after" with values formatted for
 * people. Build lines with line(label, before, after, type): it formats
 * money with its currency, percents, multiples and days, and answers null
 * when nothing really changes ("3000000.00" and "3000000" are the same), so
 * an unchanged field never shows as a change. Fields a preview sends
 * without a label get one from their name; unchanged ones are dropped.
 *
 * Who sees a proposal: a person who may run at least one of its ops (the
 * catalog permission), and its deal when it names one.
 */

const EXPIRE_DAYS = 14;
const RISK = { low: 0, medium: 1, high: 2 };

/** Plain words for proposal kinds (the chip on a proposal). */
const KIND_LABELS = {
  note_fields: 'Field update',
  merges: 'Merge',
  passes: 'Pass',
  intros: 'Intro',
  stage_moves: 'Stage move',
  deals: 'Deal update',
  asks: 'Founder ask',
  map_entries: 'Market map',
  maps: 'Market map',
  agenda_items: 'Agenda item',
  conditions: 'Condition',
  templates: 'Template',
  dd_questions: 'Diligence questions',
  files: 'File removal',
  capital: 'Capital',
  payments: 'Payment',
  statements: 'Bank statement',
  reserves: 'Reserves',
  scenarios: 'Scenario',
  lp_records: 'LP record',
  radars: 'Radar',
  holdings: 'Holding update',
  securities: 'Round terms',
  updates: 'Founder update',
  board_meetings: 'Board meeting',
  imports: 'Import',
  theses: 'Thesis',
  logos: 'Company logo',
  people_links: 'Team change',
  mixed: 'Several changes',
};
/** Field changes (note_fields) named by the record they change. */
const OP_LABELS = { 'deals.update': 'Deal update', 'companies.update': 'Company update', 'people.update': 'Person update' };
/** What your AI agent was doing when it proposed (markVia), when that names the source better than the kind. */
const VIA_LABELS = { note_review: 'From a meeting note' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function firstSentence(s) {
  const t = String(s || '');
  const i = t.indexOf('. ');
  return (i > 0 ? t.slice(0, i) : t).replace(/\.$/, '');
}

/** The record a diff names: by id, and entities also by name. */
function diffRecord(app, collection, ref) {
  if (ref === undefined || ref === null || ref === '') return null;
  try {
    if (collection === 'entities') return L('lib_entities').ref(app, String(ref));
  } catch {
    return null;
  }
  return u().byId(app, collection, String(ref));
}

function shown(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** JSON with object keys sorted (stored JSON comes back with sorted keys). */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/* ------------------------------------------------------------ lines */

/** "post_money" -> "Post money". */
function humanize(name) {
  const s = String(name || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A value as plain comparable text: trimmed, JSON for objects, decimals without trailing zeros ("3000000.00" -> "3000000"). */
function norm(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return canon(v);
  let s = String(v).trim();
  if (/^-?\d+\.\d+$/.test(s)) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (/^-?\d+$/.test(s)) s = s.replace(/^(-?)0+(\d)/, '$1$2');
  return s === '-0' ? '0' : s;
}

function money() {
  return L('lib_money');
}

/** Digits with thousands commas (no lookahead regex: Goja). */
function grouped(n) {
  const neg = n < 0;
  const t = String(Math.abs(n));
  const parts = t.split('.');
  return (neg ? '-' : '') + money().group(parts[0]) + (parts.length > 1 ? '.' + parts[1] : '');
}

/** Minor units as compact money, "USD 12.5M" (digits after the point at most). */
function compactMoney(minor, cur, digits) {
  const m = money();
  const major = Number(m.fromMinor(minor, cur));
  const a = Math.abs(major);
  const fix = (v) => {
    const t = v.toFixed(digits);
    return t.indexOf('.') >= 0 ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
  };
  let body;
  if (a >= 1e12) body = fix(a / 1e12) + 'T';
  else if (a >= 1e9) body = fix(a / 1e9) + 'B';
  else if (a >= 1e6) body = fix(a / 1e6) + 'M';
  else if (a >= 1e3) body = fix(a / 1e3) + 'K';
  else return m.format(minor, cur).replace(/\.0+$/, '');
  return (major < 0 ? '-' : '') + String(cur).toUpperCase() + ' ' + body;
}

/** Two amounts as compact money that still tells them apart (full figures when compact would not). */
function moneyPair(a, b, cur) {
  for (const digits of [1, 2]) {
    const x = a === null ? '' : compactMoney(a, cur, digits);
    const y = b === null ? '' : compactMoney(b, cur, digits);
    if (x !== y || a === null || b === null) return [x, y];
  }
  return [a === null ? '' : money().format(a, cur), b === null ? '' : money().format(b, cur)];
}

function dayText(v) {
  const s = String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(v || '');
  const y = Number(s.slice(0, 4));
  return Number(s.slice(8, 10)) + ' ' + MONTHS[Number(s.slice(5, 7)) - 1] + (y === new Date().getUTCFullYear() ? '' : ' ' + y);
}

function listText(v) {
  let arr = v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return '';
    if (t.charAt(0) === '[') {
      try {
        arr = JSON.parse(t);
      } catch {
        return t;
      }
    } else return t;
  }
  if (!Array.isArray(arr)) return arr === null || arr === undefined ? '' : String(arr);
  return arr.map((x) => (x !== null && typeof x === 'object' ? x.name || x.label || JSON.stringify(x) : String(x))).join(', ');
}

/** One side of a line as people read it (and its comparable form). */
function side(v, type) {
  const t = String(type || 'text');
  const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  if (t.indexOf('money:') === 0 || t.indexOf('minor:') === 0) {
    const cur = t.slice(6).toUpperCase();
    if (empty) return { minor: null, cmp: '' };
    const minor = t.indexOf('minor:') === 0 ? Math.round(Number(v)) : money().toMinor(String(v), cur, true);
    if (minor === null || !Number.isFinite(minor)) return { text: String(v).trim(), cmp: norm(v) };
    return { minor: minor, cmp: String(minor) };
  }
  if (empty) return { text: '', cmp: '' };
  if (t === 'ppm') return { text: money().ppmText(v) + '%', cmp: norm(v) };
  if (t === 'e8') return { text: money().e8Text(v), cmp: norm(v) };
  if (t === 'int' || t === 'number') return Number.isFinite(Number(v)) ? { text: grouped(Number(v)), cmp: norm(v) } : { text: String(v), cmp: norm(v) };
  if (t === 'day') return { text: dayText(v), cmp: String(v).slice(0, 10) };
  if (t === 'bool') return { text: v === true || v === 'true' ? 'Yes' : 'No', cmp: String(v === true || v === 'true') };
  if (t === 'list') {
    const text = listText(v);
    return { text: text, cmp: text };
  }
  return { text: typeof v === 'object' ? listText(v) : String(v).trim(), cmp: norm(v) };
}

/**
 * line(label, before, after, type, name) -> { name, label, before, after, was } or null
 * when nothing really changes. type: 'text' (default), 'money:<CUR>' (major-unit
 * text or numbers), 'minor:<CUR>' (integer minor units), 'ppm', 'e8', 'int',
 * 'number', 'day', 'bool', 'list'. `name` (default the label) is the key a
 * later stale check matches on; `was` keeps the comparable before value.
 */
function line(label, before, after, type, name) {
  const t = String(type || 'text');
  const b = side(before, t);
  const a = side(after, t);
  if (b.cmp === a.cmp) return null;
  let bt = b.text;
  let at = a.text;
  if (b.text === undefined || a.text === undefined) {
    const cur = t.slice(6).toUpperCase();
    const pair = moneyPair(b.text === undefined ? b.minor : null, a.text === undefined ? a.minor : null, cur);
    if (bt === undefined) bt = pair[0];
    if (at === undefined) at = pair[1];
  }
  return { name: String(name || label), label: String(label), before: bt, after: at, was: b.cmp };
}

/** Fields as people read them: a label on each, unchanged ones dropped, `was` for the stale check. */
function tidy(fields) {
  const out = [];
  for (const f of fields || []) {
    if (f === null || f === undefined) continue;
    const before = shown(f.before);
    const after = shown(f.after);
    const was = f.was !== undefined ? String(f.was) : norm(before);
    if (f.was === undefined && was === norm(after)) continue;
    out.push({ name: String(f.name), label: f.label ? String(f.label) : humanize(f.name), before: before === '' ? '' : String(before), after: String(after), was: was });
  }
  return out;
}

/** The name people know a record by (for "<record name>: <field labels>"). */
function recordName(rec) {
  for (const k of ['name', 'title', 'subject', 'number']) {
    let v = '';
    try {
      v = rec.getString(k);
    } catch {
      v = '';
    }
    if (v !== '') return v;
  }
  return rec.id;
}

/** "<record>: <labels>" (or the labels alone). */
function titleOf(name, fields) {
  const labels = fields.map((f) => f.label).filter((x, i, all) => all.indexOf(x) === i);
  const what = labels.length > 3 ? labels.slice(0, 3).join(', ') + ' and ' + (labels.length - 3) + ' more' : labels.join(', ');
  if (name === '') return what;
  return what === '' ? name : name + ': ' + what;
}

function preview(ctx, spec, params) {
  const app = ctx.app;
  if (spec.preview) {
    const parts = spec.preview.split('.');
    const out = require(`${__hooks}/${parts[0]}.js`)[parts[1]](ctx, params) || {};
    return { label: out.label || firstSentence(spec.desc), ref: out.ref || '', target: out.target || '', fields: tidy(out.fields), notes: out.notes || [], risk: out.risk || 'medium' };
  }
  if (spec.diff) {
    const rec = diffRecord(app, spec.diff.collection, params[spec.diff.id]);
    const fields = [];
    for (const k of Object.keys(spec.diff.fields)) {
      if (params[k] === undefined) continue;
      const f = spec.diff.fields[k];
      let before = '';
      if (rec !== null) {
        const raw = rec.get(f);
        before = raw === undefined || raw === null ? '' : typeof raw === 'object' ? u().jsonOf(rec, f, '') : raw;
      }
      const ln = line(humanize(k), shown(before), shown(params[k]), 'text', k);
      if (ln !== null) fields.push(ln);
    }
    return { label: rec !== null ? titleOf(recordName(rec), fields) : firstSentence(spec.desc), ref: '', target: rec !== null ? spec.diff.collection + ':' + rec.id : '', fields: fields, notes: [], risk: 'medium' };
  }
  const fields = tidy(
    Object.keys(params)
      .filter((k) => params[k] !== '' && params[k] !== undefined)
      .map((k) => ({ name: k, before: '', after: shown(params[k]) })),
  );
  return { label: firstSentence(spec.desc), ref: '', target: '', fields: fields, notes: [], risk: 'medium' };
}

function keyOf(spec, params) {
  if (spec.diff && params[spec.diff.id] !== undefined) return spec.name + ':' + params[spec.diff.id];
  const ks = Object.keys(params).sort();
  return spec.name + ':' + canon(ks.map((k) => [k, params[k]]));
}

/**
 * Name where proposals came from (a note review lists its proposals when it
 * saves the summary): their items without a source get `via`, so the chip
 * says "From a meeting note". Machinery: raw SQL, never an undo step.
 */
function markVia(app, ids, via) {
  const util = u();
  let n = 0;
  for (const id of ids || []) {
    const r = util.byId(app, 'proposals', String(id || ''));
    if (r === null) continue;
    const items = util.jsonOf(r, 'items', []) || [];
    if (!items.some((it) => !it.via)) continue;
    const next = items.map((it) => (it.via ? it : Object.assign({}, it, { via: via })));
    util.exec(app, 'UPDATE proposals SET items = {:i} WHERE id = {:id}', { i: JSON.stringify(next), id: r.id });
    n++;
  }
  if (n > 0) L('lib_bus').touch('proposals');
  return n;
}

function itemOf(ctx, spec, params, via) {
  const pv = preview(ctx, spec, params);
  return { op: spec.name, params: params, key: keyOf(spec, params), label: pv.label, ref: pv.ref, target: pv.target, fields: pv.fields, notes: pv.notes, risk: pv.risk, via: via || '', state: 'pending' };
}

/** The plain kind label of a proposal (its chip): its source (markVia) when that says more, the record for field changes, else the kind. */
function kindLabel(kind, items) {
  const its = items || [];
  const vias = its.map((it) => it.via || '').filter((x, i, all) => all.indexOf(x) === i);
  if (vias.length === 1 && VIA_LABELS[vias[0]] !== undefined) return VIA_LABELS[vias[0]];
  const ops = its.map((it) => it.op).filter((x, i, all) => all.indexOf(x) === i);
  if (kind === 'note_fields' && ops.length === 1 && OP_LABELS[ops[0]] !== undefined) return OP_LABELS[ops[0]];
  return KIND_LABELS[kind] || humanize(kind);
}

/** Does accepting these items need the accepting person's approval PIN (a confirm op, or an op whose pinIf says so)? */
function itemsNeedPin(ctx, items) {
  const cat = L('lib_catalog');
  return items.some((it) => {
    let spec = null;
    try {
      spec = cat.get(it.op);
    } catch {
      return false;
    }
    if (spec.effect === 'confirm') return true;
    if (!spec.pinIf) return false;
    const parts = spec.pinIf.split('.');
    return L(parts[0])[parts[1]](ctx, Object.assign({}, it.params)) === true;
  });
}

/** The items accept would apply (pending ones, or the chosen of them). */
function chosenItems(items, chosen) {
  return items.filter((it, i) => it.state === 'pending' && (chosen.length === 0 || chosen.indexOf(i) >= 0));
}

/** pinIf of proposals.accept: the chosen items need the accepting person's PIN. */
function acceptNeedsPin(ctx, p) {
  const util = u();
  const r = util.byId(ctx.app, 'proposals', String((p && p.proposal) || ''));
  if (r === null || r.getString('status') !== 'pending') return false;
  return itemsNeedPin(ctx, chosenItems(util.jsonOf(r, 'items', []) || [], (util.list(p, 'items') || []).map(Number)));
}

function afterOf(it) {
  return canon(it.op === undefined ? [] : (it.fields || []).map((f) => [f.name, f.after]).concat([['params', it.params]]));
}

function settleRepeats(app, items) {
  const util = u();
  const keep = [];
  const dupOf = [];
  for (const it of items) {
    let dup = '';
    for (const r of util.findMany(app, 'proposals', "status = 'pending'", 'created')) {
      const old = util.jsonOf(r, 'items', []) || [];
      let changed = false;
      for (const o of old) {
        if (o.state !== 'pending' || o.key !== it.key) continue;
        if (afterOf(o) === afterOf(it)) dup = r.id;
        else if (it.key.indexOf('[') < 0) {
          o.state = 'superseded';
          o.error = 'Replaced by a newer proposal.';
          changed = true;
        }
      }
      if (changed) {
        r.set('items', old);
        if (!old.some((o) => o.state === 'pending')) {
          r.set('status', 'withdrawn');
          r.set('decided_at', util.nowIso());
        }
        app.save(r);
      }
    }
    if (dup !== '') dupOf.push(dup);
    else keep.push(it);
  }
  return { keep: keep, duplicate_of: dupOf };
}

/** --evidence: a quote (text) or JSON {quote, file, page, url, anchor}; --confidence 0..1. */
function evidenceOf(raw) {
  const util = u();
  if (raw === undefined || raw === null || raw === '') return null;
  let v = raw;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.charAt(0) === '{') {
      try {
        v = JSON.parse(t);
      } catch {
        throw util.fail(400, 'evidence is a quote, or a JSON object {"quote","file","page","url"}.', 'invalid_param', { param: 'evidence' });
      }
    } else v = { quote: t };
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw util.fail(400, 'evidence is a quote, or a JSON object {"quote","file","page","url"}.', 'invalid_param', { param: 'evidence' });
  util.keysOnly(v, ['quote', 'file', 'page', 'url', 'anchor', 'message'], 'evidence');
  const out = {};
  if (v.quote !== undefined) out.quote = util.clip(String(v.quote), 2000);
  if (v.file !== undefined) out.file = util.clip(String(v.file), 40);
  if (v.page !== undefined) out.page = Number(v.page) || 0;
  if (v.url !== undefined) out.url = util.clip(String(v.url), 500);
  if (v.anchor !== undefined) out.anchor = util.clip(String(v.anchor), 40);
  if (v.message !== undefined) out.message = util.clip(String(v.message), 200);
  return out;
}

function confidenceOf(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw u().fail(400, 'confidence is a number from 0 to 1.', 'invalid_param', { param: 'confidence' });
  return n;
}

/** Pending proposals about one record (its target), newest first: what a person has not decided yet (qa-cli F14). */
function pendingFor(app, collection, id) {
  const util = L('lib_util');
  if (!id) return [];
  return util.findMany(app, 'proposals', "status = 'pending' && target = {:t}", '-created', 10, { t: collection + ':' + id }).map((r) => ({ proposal: r.id, title: r.getString('title'), kind: kindLabel(r.getString('kind')), created: r.getString('created') }));
}

function make(ctx, o) {
  const util = u();
  const r = util.newRecord(ctx.app, 'proposals');
  let risk = 'low';
  for (const it of o.items) if (RISK[it.risk] > RISK[risk]) risk = it.risk;
  r.set('kind', util.clip(o.kind, 40));
  r.set('title', util.clip(o.title, 300));
  r.set('why', util.clip(o.why || '', 4000));
  r.set('evidence', o.evidence);
  r.set('confidence', o.confidence === null || o.confidence === undefined ? null : o.confidence);
  r.set('origin', ctx.isAgent ? 'agent' : 'rule');
  r.set('status', 'pending');
  r.set('risk', risk);
  r.set('items', o.items);
  r.set('target', o.items.length > 0 ? util.clip(o.items[0].target || '', 80) : '');
  r.set('deal', util.clip(o.deal || '', 30));
  r.set('run', ctx.run || '');
  ctx.app.save(r);
  return r;
}

function view(app, r) {
  const util = u();
  const items = util.jsonOf(r, 'items', []) || [];
  const dm = r.getString('decided_by') !== '' ? util.byId(app, 'members', r.getString('decided_by')) : null;
  const first = items.filter((it) => it.state === 'pending')[0] || items[0] || {};
  return {
    id: r.id,
    kind: r.getString('kind'),
    kind_label: kindLabel(r.getString('kind'), items),
    ref: first.ref || '',
    title: r.getString('title'),
    why: r.getString('why'),
    evidence: util.jsonOf(r, 'evidence', null),
    confidence: util.jsonOf(r, 'confidence', null),
    origin: r.getString('origin'),
    status: r.getString('status'),
    risk: r.getString('risk'),
    target: r.getString('target'),
    deal: r.getString('deal'),
    note: r.getString('note'),
    run: r.getString('run'),
    items: items.map((it, i) => ({ index: i, op: it.op, label: it.label, ref: it.ref || '', fields: (it.fields || []).map((f) => ({ name: f.name, label: f.label, before: f.before, after: f.after })), notes: it.notes || [], risk: it.risk, state: it.state || 'pending', error: it.error || '', result: it.result || null })),
    decided_by: r.getString('decided_by'),
    decided_by_name: dm ? dm.getString('name') : '',
    decided_at: r.getString('decided_at'),
    expires_at: new Date(Date.parse(r.getString('created').replace(' ', 'T')) + EXPIRE_DAYS * 86400000).toISOString(),
    created: r.getString('created'),
  };
}

/** The deal a call names (a `deal` param, by id or display id), as its id for scope ('' when none). */
function dealOf(app, params) {
  return params && typeof params.deal === 'string' && params.deal !== '' ? L('lib_auth').dealId(app, params.deal) : '';
}

/** Your AI agent called a 'propose' op: store it (the dispatcher audits it). */
function fromCall(ctx, spec, params) {
  const why = String(params.why || '');
  const evidence = evidenceOf(params.evidence);
  const confidence = confidenceOf(params.confidence);
  const clean = L('lib_ops').stripProposal(params);
  const item = itemOf(ctx, spec, clean, '');
  const s = settleRepeats(ctx.app, [item]);
  if (s.keep.length === 0) return { proposed: true, proposal: s.duplicate_of[0], duplicate_of: s.duplicate_of[0], label: item.label, message: 'The same change is already waiting in proposal ' + s.duplicate_of[0] + '. Nothing new was added.' };
  const r = make(ctx, { kind: spec.kind, title: item.label, why: why, evidence: evidence, confidence: confidence, items: [item], deal: dealOf(ctx.app, clean) });
  return { proposed: true, proposal: r.id, label: item.label, message: 'Waiting for a person to accept it in Next. Nothing changed yet.', preview: { label: item.label, fields: item.fields, notes: item.notes, risk: item.risk } };
}

/* ------------------------------------------------------------------- ops */

/** May ctx see (and act on) this proposal: the agent and the owner always; a person who may run one of its ops. */
function canSee(ctx, r) {
  const auth = L('lib_auth');
  if (r.getString('deal') !== '' && !auth.dealVisible(ctx, r.getString('deal'))) return false;
  if (ctx.isAgent || ctx.owner || ctx.actor === 'system') return true;
  if (ctx.ownOnly) return false;
  const items = u().jsonOf(r, 'items', []) || [];
  const person = Object.assign({}, ctx, { isAgent: false });
  return items.some((it) => auth.mayRun(person, it.op));
}

function create(ctx, p) {
  const util = u();
  const raw = util.list(p, 'items');
  if (raw === undefined || raw.length === 0) throw util.fail(400, 'Give --items \'[{"op":"<op>","params":{...}}]\'.', 'missing_param', { param: 'items' });
  if (raw.length > 100) throw util.fail(400, 'At most 100 changes in one proposal.', 'too_many');
  const cat = L('lib_catalog');
  const items = [];
  const kinds = {};
  let deal = '';
  raw.forEach((it, i) => {
    let spec;
    try {
      spec = cat.get(String((it && it.op) || ''));
    } catch {
      throw util.fail(400, 'Item ' + (i + 1) + ': unknown operation ' + (it && it.op) + '.', 'invalid_param', { param: 'items' });
    }
    if (spec.agent !== 'propose') throw util.fail(400, 'Item ' + (i + 1) + ': ' + spec.name + ' does not need a proposal; run it directly (or a person runs it when it is people only).', 'invalid_param', { param: 'items' });
    const params = L('lib_ops').stripProposal(L('lib_ops').check(it.params && typeof it.params === 'object' ? it.params : {}, spec, false));
    L('lib_ops').dryRun(ctx, spec, params);
    items.push(itemOf(ctx, spec, params, ''));
    kinds[spec.kind] = true;
    if (deal === '') deal = dealOf(ctx.app, params);
  });
  const ks = Object.keys(kinds);
  const s = settleRepeats(ctx.app, items);
  if (s.keep.length === 0) return { proposal: view(ctx.app, ctx.app.findRecordById('proposals', s.duplicate_of[0])), duplicate_of: s.duplicate_of, message: 'Every change here is already waiting. Nothing new was added.' };
  const title = util.text(p, 'title', 300, '') || (s.keep.length === 1 ? s.keep[0].label : s.keep.length + ' changes');
  const r = make(ctx, { kind: ks.length === 1 ? ks[0] : 'mixed', title: title, why: util.text(p, 'why', 4000, ''), evidence: evidenceOf(util.str(p, 'evidence', '')), confidence: confidenceOf(util.num(p, 'confidence', {})), items: s.keep, deal: deal });
  L('lib_audit').note(ctx, { collection: 'proposals', record: r.id, summary: 'Your AI agent proposed: ' + title });
  const out = { proposal: view(ctx.app, r) };
  if (s.duplicate_of.length > 0) out.duplicate_of = s.duplicate_of;
  return out;
}

function list(ctx, p) {
  const util = u();
  const status = util.oneOf(p, 'status', ['pending', 'decided', 'all'], 'pending');
  const filter = status === 'pending' ? "status = 'pending'" : status === 'decided' ? "status != 'pending'" : '1=1';
  const kind = util.str(p, 'kind', '');
  const pg = util.page(p, 50, 300);
  const all = util.findMany(ctx.app, 'proposals', filter + (kind !== '' ? ' && kind = {:k}' : ''), status === 'pending' ? 'created' : '-created', 2000, { k: kind });
  const rows = all.filter((r) => canSee(ctx, r));
  return { proposals: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => view(ctx.app, r)), total: rows.length, hidden: all.length - rows.length };
}

function ref(ctx, id) {
  const r = u().byId(ctx.app, 'proposals', String(id || ''));
  if (r === null || !canSee(ctx, r)) throw u().fail(404, 'No proposal ' + id + ' you can see. Run proposals.list.', 'not_found');
  return r;
}

function get(ctx, p) {
  return { proposal: view(ctx.app, ref(ctx, u().req(p, 'proposal'))) };
}

/** Accept (all items, or the chosen ones; the rest are dismissed). Each runs as the person accepting, as its own undo unit. */
function accept(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = ref(ctx, util.req(p, 'proposal'));
  if (r.getString('status') !== 'pending') throw util.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'conflict');
  const items = util.jsonOf(r, 'items', []) || [];
  const chosen = (util.list(p, 'items') || []).map(Number);
  const pick = (i) => chosen.length === 0 || chosen.indexOf(i) >= 0;
  // The dispatcher checks the PIN (pinIf) before this runs; a caller that bypassed it is refused.
  if (ctx.pinChecked !== true && itemsNeedPin(ctx, chosenItems(items, chosen))) throw util.fail(400, 'Accepting this needs your approval PIN.', 'missing_param', { param: 'pin' });
  const cat = L('lib_catalog');
  let applied = 0;
  let failed = 0;
  const activity = [];
  items.forEach((it, i) => {
    if (it.state !== 'pending') return;
    if (!pick(i)) {
      it.state = 'dismissed';
      return;
    }
    let now;
    try {
      now = preview(ctx, cat.get(it.op), Object.assign({}, it.params));
    } catch (err) {
      it.state = 'failed';
      it.error = String((err && err.message) || err);
      failed++;
      return;
    }
    const stale = (it.fields || []).some((f) => {
      const cur = (now.fields || []).filter((x) => x.name === f.name)[0];
      return cur !== undefined && f.was !== '' && cur.was !== f.was;
    });
    if (stale) {
      it.state = 'stale';
      it.error = 'Changed since it was proposed; not applied.';
      failed++;
      return;
    }
    try {
      const out = L('lib_ops').runAs(ctx, it.op, Object.assign({}, it.params), { prefix: 'Accepted: ' });
      it.state = 'applied';
      if (out && out._activity) activity.push(out._activity);
      const text = out && typeof out === 'object' ? JSON.stringify(out) : '';
      it.result = text !== '' && text.length <= 4000 ? JSON.parse(text) : { ok: true };
      applied++;
    } catch (err) {
      it.state = 'failed';
      it.error = String((err && err.message) || err);
      failed++;
    }
  });
  r.set('items', items);
  r.set('status', applied === 0 ? 'failed' : failed > 0 || items.some((x) => x.state === 'dismissed') ? 'partial' : 'accepted');
  r.set('decided_by', ctx.memberId);
  r.set('decided_at', util.nowIso());
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'proposals', record: r.id, summary: 'Accepted: ' + r.getString('title') + ' (' + applied + ' applied' + (failed > 0 ? ', ' + failed + ' not' : '') + ')' });
  return { proposal: view(app, r), applied: applied, failed: failed, activity: activity };
}

function dismiss(ctx, p) {
  const util = u();
  const r = ref(ctx, util.req(p, 'proposal'));
  if (r.getString('status') !== 'pending') throw util.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'conflict');
  const items = util.jsonOf(r, 'items', []) || [];
  for (const it of items) if (it.state === 'pending') it.state = 'dismissed';
  r.set('items', items);
  r.set('status', 'dismissed');
  r.set('note', util.text(p, 'note', 2000, ''));
  r.set('decided_by', ctx.memberId);
  r.set('decided_at', util.nowIso());
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'proposals', record: r.id, summary: 'Dismissed: ' + r.getString('title') + (r.getString('note') !== '' ? ' (' + util.clip(r.getString('note'), 160) + ')' : '') });
  return { proposal: view(ctx.app, r) };
}

function withdraw(ctx, p) {
  const util = u();
  const r = ref(ctx, util.req(p, 'proposal'));
  if (r.getString('status') !== 'pending') throw util.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'conflict');
  r.set('status', 'withdrawn');
  r.set('decided_at', util.nowIso());
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'proposals', record: r.id, summary: 'Withdrew: ' + r.getString('title') });
  return { proposal: view(ctx.app, r) };
}

/** Nightly: pending proposals older than two weeks close themselves rather than apply late. */
function expire(app) {
  const util = u();
  const before = new Date(Date.now() - EXPIRE_DAYS * 86400000).toISOString().replace('T', ' ');
  let n = 0;
  for (const r of util.findMany(app, 'proposals', "status = 'pending' && created < {:t}", '', 0, { t: before })) {
    r.set('status', 'expired');
    r.set('decided_at', util.nowIso());
    app.save(r);
    n++;
  }
  return n;
}

/** Next items: pending proposals ctx may act on (kind proposal, rank 30). */
function nextItems(ctx) {
  const util = u();
  if (ctx.isAgent) return [];
  const out = [];
  for (const r of util.findMany(ctx.app, 'proposals', "status = 'pending'", 'created', 300)) {
    if (!canSee(ctx, r)) continue;
    const items = util.jsonOf(r, 'items', []) || [];
    const first = items.filter((it) => it.state === 'pending')[0] || items[0] || { fields: [] };
    const figures = (first.fields || []).slice(0, 3).map((f) => ({ label: util.clip(String(f.label || humanize(f.name)), 30), value: util.clip(String(f.after), 60) }));
    out.push({
      key: 'kernel:proposal:' + r.id,
      kind: 'proposal',
      card: 'proposal',
      title: r.getString('title'),
      figures: figures,
      chips: [{ label: kindLabel(r.getString('kind'), items), tone: 'neutral' }],
      agent: true,
      rank: 30,
      at: r.getString('created'),
      href: '#/next/proposal/' + r.id,
      data: { proposal: r.id, ref: first.ref || '', why: r.getString('why'), evidence: util.jsonOf(r, 'evidence', null), items: items.length },
      actions: [
        { label: 'Accept', op: 'proposals.accept', params: { proposal: r.id }, primary: true, pin: itemsNeedPin(ctx, chosenItems(items, [])) },
        { label: 'Dismiss', op: 'proposals.dismiss', params: { proposal: r.id } },
      ],
    });
  }
  return out;
}

module.exports = { markVia: markVia, pendingFor: pendingFor, EXPIRE_DAYS: EXPIRE_DAYS, KIND_LABELS: KIND_LABELS, line: line, kindLabel: kindLabel, recordName: recordName, titleOf: titleOf, preview: preview, fromCall: fromCall, create: create, list: list, get: get, accept: accept, acceptNeedsPin: acceptNeedsPin, dismiss: dismiss, withdraw: withdraw, expire: expire, view: view, canSee: canSee, nextItems: nextItems };
