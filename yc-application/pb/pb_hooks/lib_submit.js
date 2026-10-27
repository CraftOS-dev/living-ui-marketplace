/// <reference path="../pb_data/types.d.ts" />
/**
 * Submitting. Your AI agent types the application into YC's form in its
 * browser (the founders watch it in the chat panel and can take over) and
 * stops before Submit. A founder presses Submit on YC's site, then "I
 * submitted" here: the app keeps exactly what was sent and locks the
 * answers, because YC does not allow edits after submission.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const FILL_STATUS = ['started', 'waiting', 'filled', 'mismatch', 'stopped', 'done'];
const STATUSES = ['submitted', 'interview', 'accepted', 'rejected'];

/** What stands between the application and Submit. */
function ready(ctx) {
  const s = L('lib_checks').summary(ctx.app);
  const row = (c) => ({ id: c.id, title: c.title, detail: c.detail, fix: c.fix, target: c.target, keys: Array.isArray(c.keys) && c.keys.length > 0 ? c.keys : undefined });
  const blockers = s.checks.filter((c) => c.status === 'fail' && c.severity === 'blocker').map(row);
  const warnings = s.checks.filter((c) => c.status === 'fail' && c.severity === 'warning').map(row);
  return { ready: blockers.length === 0, blockers: blockers, warnings: warnings, waiting: s.totals.wait };
}

function monthsText(raw) {
  if (raw === '') return '';
  try {
    const o = JSON.parse(raw);
    return Object.keys(o)
      .sort()
      .map((k) => k + ': $' + L('lib_util').thousands(Number(o[k]) || 0))
      .join('\n');
  } catch {
    return raw;
  }
}

/** Every field to type into YC's form, in the form's order, with each founder's profile. */
function packet(ctx) {
  const A = L('lib_answers');
  const Q = L('lib_questions');
  const S = L('lib_store');
  const app = ctx.app;
  const items = A.all(app);
  const sections = [];
  for (const sec of Q.SECTIONS) {
    const fields = items
      .filter((a) => a.section === sec.key && a.open)
      .map((a) => ({ key: a.key, question: a.label, type: a.type, value: a.type === 'months' ? monthsText(a.value) : a.value, months: a.type === 'months' && a.value !== '' ? JSON.parse(a.value) : undefined, required: a.required, missing: a.required && a.value === '', need: a.need !== '' ? a.need : undefined }));
    sections.push({ section: sec.label, fields: fields });
  }
  const founders = S.founders(app).map((f) => ({
    id: f.id,
    name: f.name,
    role: f.role,
    email: f.email,
    linkedin: f.linkedin,
    github: f.github,
    x: f.x,
    website: f.website,
    location: f.location,
    technical: f.technical,
    full_time: f.full_time,
    equity: f.equity > 0 ? f.equity : null,
    education: f.education,
    work: f.work,
    profile: items.filter((a) => a.founder === f.id).map((a) => ({ key: a.key, question: a.label, value: a.value })),
  }));
  const st = S.settingsView(S.settings(app));
  return { batch: st.batch, apply_url: 'https://apply.ycombinator.com', sections: sections, founders: founders };
}

function fill(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const s = S.settings(app);
  if (s.getString('status') !== 'preparing') throw U.fail(409, 'The application was already submitted.', 'submitted_locked');
  const r = ready(ctx);
  if (!r.ready && p.anyway !== true) throw U.fail(409, r.blockers.length + ' things still block a good application: ' + r.blockers.map((b) => b.title).join('; ') + '.', 'not_ready', { blockers: r.blockers });
  const id = L('lib_agent').fire(app, 'fill_form_requested', {});
  s.set('fill_state', 'requested');
  s.set('fill_request', id);
  s.set('fill_at', U.now());
  s.set('fill_log', []);
  app.save(s);
  S.log(app, 'person', 'Asked your AI agent to fill YC\'s form', '');
  return { request: id };
}

/** Your AI agent reports each step of filling the form. */
function progress(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const s = S.settings(app);
  const st = s.getString('fill_state');
  if (st !== 'requested' && st !== 'filling') throw U.fail(409, 'No fill was asked for. A founder starts it with "Fill the form" on the Submit step.', 'not_requested');
  const log = U.json(s, 'fill_log', []);
  log.push({ at: U.now(), section: U.clip(p.section, 120), status: p.status, note: U.clip(p.note || '', 1200) });
  s.set('fill_log', log.slice(-80));
  s.set('fill_state', p.status === 'done' ? 'filled' : p.status === 'stopped' ? 'stopped' : 'filling');
  s.set('fill_at', U.now());
  app.save(s);
  if (p.status === 'done') S.log(app, 'agent', 'Filled YC\'s form; it is waiting for your Submit', '');
  if (p.status === 'stopped') S.log(app, 'agent', 'Stopped filling YC\'s form: ' + U.clip(p.note || '', 160), '');
  return { fill_state: s.getString('fill_state'), steps: log.length };
}

/** A founder pressed Submit on YC's site: keep what was sent and lock the answers. */
function submitted(ctx) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const s = S.settings(app);
  if (s.getString('status') !== 'preparing') throw U.fail(409, 'Already marked as submitted.', 'submitted_locked');
  s.set('sent', packet(ctx));
  s.set('status', 'submitted');
  s.set('submitted_at', U.now());
  app.save(s);
  S.log(app, 'person', 'Submitted the application to YC', '');
  return { status: 'submitted' };
}

function setStatus(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const s = S.settings(app);
  const cur = s.getString('status');
  const order = ['preparing', 'submitted', 'interview', 'accepted', 'rejected'];
  if (cur === 'preparing') throw U.fail(409, 'Mark the application submitted first.', 'not_submitted');
  if ((cur === 'accepted' || cur === 'rejected') && p.status !== cur) throw U.fail(409, 'The decision is already recorded (' + cur + ').', 'decided');
  if (order.indexOf(p.status) < order.indexOf(cur) && p.status !== cur) throw U.fail(409, 'The status only moves forward (now ' + cur + ').', 'backwards');
  s.set('status', p.status);
  if (p.status === 'interview' && p.when) s.set('interview_at', p.when);
  if (p.status === 'accepted' || p.status === 'rejected') s.set('decided_at', U.now());
  app.save(s);
  S.log(app, ctx.actor, 'Status: ' + p.status + (p.when ? ' (' + p.when + ')' : ''), '');
  return { status: p.status };
}

/** Start again for another batch: the answers stay as drafts, "applied before" turns on. */
function nextBatch(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const s = S.settings(app);
  if (s.getString('status') === 'preparing') throw U.fail(409, 'This application has not been submitted yet.', 'not_submitted');
  s.set('status', 'preparing');
  const k = p.deadline ? null : L('lib_batches').known(p.batch);
  s.set('batch', U.clip(p.batch, 60));
  s.set('deadline', p.deadline || (k ? k.deadline : ''));
  s.set('deadline_note', k ? k.deadline_note : p.deadline ? '' : L('lib_batches').CHECK_NOTE);
  s.set('submitted_at', '');
  s.set('interview_at', '');
  s.set('decided_at', '');
  s.set('fill_state', 'idle');
  s.set('fill_log', []);
  app.save(s);
  L('lib_answers').set(ctx, { key: 'p_prev', value: 'yes' });
  S.log(app, 'person', 'Started a new application for ' + p.batch, '');
  return { batch: p.batch };
}

/** The whole application as Markdown (to share with a reviewer or keep). */
function exportMarkdown(ctx) {
  const pk = packet(ctx);
  const A = L('lib_answers');
  const needOf = {};
  for (const a of A.all(ctx.app)) if (a.need !== '') needOf[a.key] = a.need;
  // Line breaks inside an answer stay line breaks when the Markdown is rendered.
  const block = (v) => (v !== '' ? String(v).replace(/\r?\n/g, '  \n') : '_(not answered)_');
  const ask = (key) => (needOf[key] !== undefined ? ['', '> Waiting on the founders: ' + needOf[key]] : []);
  const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : 'not given');
  const U = L('lib_util');
  const shown = (f) => {
    if (f.value === '') return '';
    if (f.type === 'yesno') return f.value === 'yes' ? 'Yes' : 'No';
    if (f.type === 'number') return f.key === 'e_runway' ? f.value + ' months' : '$' + U.thousands(Number(f.value) || 0);
    return f.value;
  };
  const company = pk.sections.reduce((name, sec) => name || (sec.fields.find((f) => f.key === 'c_name') || { value: '' }).value, '');
  const st = L('lib_store').settingsView(L('lib_store').settings(ctx.app));
  const lines = ['# ' + (company !== '' ? company + ': ' : '') + 'YC application, ' + pk.batch, ''];
  if (st.deadline) lines.push('Deadline: ' + st.deadline + (st.deadline_note ? ' (' + st.deadline_note + ')' : ''), '');
  for (const sec of pk.sections) {
    lines.push('## ' + sec.section, '');
    for (const f of sec.fields) lines.push('**' + f.question + '**', '', block(shown(f)), ...ask(f.key), '');
  }
  lines.push('## Founder profiles', '');
  for (const f of pk.founders) {
    lines.push('### ' + f.name + (f.role ? ', ' + f.role : ''), '');
    const facts = [
      'Writes code: ' + yn(f.technical),
      'Full-time: ' + yn(f.full_time),
      'Equity: ' + (f.equity !== null ? f.equity + '%' : 'not given'),
      f.location ? 'Lives in: ' + f.location : '',
      f.education ? 'Education: ' + f.education : '',
      f.work ? 'Work: ' + f.work : '',
      f.linkedin ? 'LinkedIn: ' + f.linkedin : '',
      f.github ? 'GitHub: ' + f.github : '',
    ].filter((x) => x !== '');
    lines.push(facts.map((x) => '- ' + String(x).replace(/\r?\n/g, '\n  ')).join('\n'), '');
    for (const a of f.profile) lines.push('**' + a.question + '**', '', block(a.value), ...ask(a.key), '');
  }
  return { filename: 'yc-application.md', markdown: lines.join('\n') };
}

module.exports = { FILL_STATUS: FILL_STATUS, STATUSES: STATUSES, ready: ready, packet: packet, fill: fill, progress: progress, submitted: submitted, setStatus: setStatus, nextBatch: nextBatch, exportMarkdown: exportMarkdown };
