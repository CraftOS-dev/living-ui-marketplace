/// <reference path="../pb_data/types.d.ts" />
/**
 * Submitting. Your AI agent types the application into speedrun's form in
 * its browser (the founders watch it in the chat panel and can take over)
 * and stops before "Submit application". A founder presses it on speedrun's
 * site, then "I submitted" here: the app keeps exactly what was sent and
 * locks the answers, because speedrun does not allow edits after submission.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const APPLY_URL = 'https://speedrun.a16z.com/apply/form';
const FILL_STATUS = ['started', 'waiting', 'filled', 'mismatch', 'stopped', 'done'];
const STATUSES = ['submitted', 'interview', 'accepted', 'rejected'];

/** The form's three steps and their blocks, in the form's order, with the answer keys of each block. */
const STEPS = [
  { step: '1. Team', blocks: [{ block: 'Team', keys: ['t_employment', 't_ft_founders', 't_fte', 't_team'] }] },
  { step: '2. Startup Details', blocks: [{ block: 'Startup Details', keys: ['s_name', 's_oneliner', 's_desc', 's_category', 's_category2', 's_country', 's_state', 's_city', 's_founded', 's_website', 's_other'] }] },
  {
    step: '3. Additional Information',
    blocks: [
      { block: 'Team Video (MP4)', keys: ['x_video'] },
      { block: 'Pitch Deck (PDF)', keys: ['x_deck'] },
      { block: 'Traction', keys: ['x_has_traction', 'x_launch', 'x_traction_notes', 'x_share_revenue', 'x_arr', 'x_acv', 'x_ndr', 'x_rev_growth', 'x_share_usage', 'x_dau', 'x_wau', 'x_mau', 'x_user_growth', 'x_d1', 'x_d7', 'x_d30', 'x_m1'] },
      { block: 'Funding History', keys: ['x_raised', 'x_total_raised', 'x_post_money', 'x_last_round', 'x_burn', 'x_runway', 'x_investors'] },
      { block: 'Active Fundraising Round', keys: ['x_raising', 'x_target', 'x_raise_start', 'x_raise_deadline'] },
      { block: 'Referral', keys: ['x_referred', 'x_referrals'] },
      { block: 'Where did you learn about speedrun?', keys: ['x_heard', 'x_heard_detail'] },
    ],
  },
];

/** What stands between the application and Submit. */
function ready(ctx) {
  const s = L('lib_checks').summary(ctx.app);
  const row = (c) => ({ id: c.id, title: c.title, detail: c.detail, fix: c.fix, target: c.target, keys: Array.isArray(c.keys) && c.keys.length > 0 ? c.keys : undefined });
  const blockers = s.checks.filter((c) => c.status === 'fail' && c.severity === 'blocker').map(row);
  const warnings = s.checks.filter((c) => c.status === 'fail' && c.severity === 'warning').map(row);
  return { ready: blockers.length === 0, blockers: blockers, warnings: warnings, waiting: s.totals.wait };
}

/** An answer as it is typed into the form. */
function shown(a) {
  const U = L('lib_util');
  if (a.value === '') return '';
  if (a.type === 'yesno') return a.value === 'yes' ? 'Yes' : 'No';
  if (a.type === 'number') return a.unit === 'usd' ? '$' + U.thousands(Number(a.value) || 0) : a.unit === 'percent' ? a.value + '%' : a.unit === 'months' ? a.value + ' months' : a.value;
  if (a.type === 'rows') {
    return L('lib_answers')
      .rowsOf(a.value)
      .map((r) => a.columns.map((c) => (c.num && r[c.key] !== null && r[c.key] !== undefined ? '$' + U.thousands(Number(r[c.key])) : r[c.key] || '-')).join(', '))
      .join('\n');
  }
  return a.value;
}

/** Every field to type into speedrun's form, in the form's order, and every founder's block (CEO first). */
function packet(ctx) {
  const A = L('lib_answers');
  const S = L('lib_store');
  const app = ctx.app;
  const items = A.all(app);
  const byKey = {};
  for (const a of items) byKey[a.key] = a;
  const sections = [];
  for (const st of STEPS) {
    for (const b of st.blocks) {
      const fields = b.keys
        .map((k) => byKey[k])
        .filter((a) => a !== undefined && a.open)
        .map((a) => ({ key: a.key, question: a.label, type: a.type, value: a.value, typed: shown(a), rows: a.type === 'rows' && a.value !== '' ? A.rowsOf(a.value) : undefined, required: a.required, missing: a.required && a.value === '', need: a.need !== '' ? a.need : undefined }));
      sections.push({ step: st.step, section: b.block, fields: fields });
    }
  }
  const founders = S.founders(app).map((f, i) => ({
    id: f.id,
    form_block: i === 0 ? 'CEO' : 'Co-founder ' + i,
    name: f.name,
    first_name: f.first_name,
    last_name: f.last_name,
    role: f.role,
    email: f.email,
    phone: f.phone,
    relevant_experience: (items.find((a) => a.key === 'fp.' + f.id + '.experience') || { value: '' }).value,
    country: f.country,
    state: f.state,
    city: f.city,
    citizenship: f.citizenship,
    college: f.college,
    highest_education: f.education,
    years_of_experience: f.years,
    technical_end_to_end: f.technical,
    full_time: f.full_time,
    linkedin_url: f.linkedin,
    github_url: f.github,
    x_url: f.x,
    portfolio_url: f.website,
  }));
  const st = S.settingsView(S.settings(app));
  return {
    cohort: st.cohort,
    apply_url: APPLY_URL,
    order: '1. Team: full-time or part-time, number of full-time founders, total FTE, then the CEO block, then "Add co-founder" for each co-founder, then "Tell us more about the team". 2. Startup Details. 3. Additional Information: tick each optional block (Team video, Pitch deck, Traction, Funding History, Active Fundraising Round, Referral) only when the packet has its answers, then "Where did you learn about speedrun?".',
    sections: sections,
    founders: founders,
  };
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
  S.log(app, 'person', 'Asked your AI agent to fill speedrun\'s form', '');
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
  if (p.status === 'done') S.log(app, 'agent', 'Filled speedrun\'s form; it is waiting for your Submit', '');
  if (p.status === 'stopped') S.log(app, 'agent', 'Stopped filling speedrun\'s form: ' + U.clip(p.note || '', 160), '');
  return { fill_state: s.getString('fill_state'), steps: log.length };
}

/** A founder pressed Submit on speedrun's site: keep what was sent and lock the answers. */
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
  S.log(app, 'person', 'Submitted the application to speedrun', '');
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

/** Start again for another cohort: the answers stay as drafts to improve. */
function nextCohort(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const s = S.settings(app);
  if (s.getString('status') === 'preparing') throw U.fail(409, 'This application has not been submitted yet.', 'not_submitted');
  s.set('status', 'preparing');
  const k = p.deadline ? null : L('lib_cohorts').known(p.cohort);
  s.set('cohort', U.clip(p.cohort, 60));
  s.set('deadline', p.deadline || (k ? k.deadline : ''));
  s.set('deadline_note', k ? k.deadline_note : p.deadline ? '' : L('lib_cohorts').checkNote(U.clip(p.cohort, 60)));
  s.set('submitted_at', '');
  s.set('interview_at', '');
  s.set('decided_at', '');
  s.set('fill_state', 'idle');
  s.set('fill_log', []);
  app.save(s);
  S.log(app, 'person', 'Started a new application for ' + p.cohort, '');
  return { cohort: p.cohort };
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
  const name = pk.sections.reduce((n, sec) => n || (sec.fields.find((f) => f.key === 's_name') || { value: '' }).value, '');
  const st = L('lib_store').settingsView(L('lib_store').settings(ctx.app));
  const lines = ['# ' + (name !== '' ? name + ': ' : '') + 'a16z speedrun application, ' + pk.cohort, ''];
  if (st.deadline) lines.push('Deadline: ' + st.deadline + (st.deadline_note ? ' (' + st.deadline_note + ')' : ''), '');
  let step = '';
  for (const sec of pk.sections) {
    if (sec.step !== step) {
      step = sec.step;
      lines.push('## ' + step, '');
    }
    if (sec.fields.length === 0) continue;
    lines.push('### ' + sec.section, '');
    for (const f of sec.fields) lines.push('**' + f.question + '**', '', block(f.typed), ...ask(f.key), '');
    if (sec.step === '1. Team' && pk.founders.length > 0) {
      lines.push('### Founders', '');
      for (const f of pk.founders) {
        lines.push('#### ' + f.form_block + ': ' + f.name + (f.role ? ', ' + f.role : ''), '');
        const facts = [
          f.email ? 'Email: ' + f.email : '',
          f.phone ? 'Phone: ' + f.phone : '',
          'Technical enough to build it end-to-end: ' + yn(f.technical_end_to_end),
          'Full-time: ' + yn(f.full_time),
          f.years_of_experience !== null ? 'Years of experience: ' + f.years_of_experience : '',
          [f.city, f.state, f.country].filter((x) => x).length > 0 ? 'Lives in: ' + [f.city, f.state, f.country].filter((x) => x).join(', ') : '',
          f.citizenship ? 'Citizenship: ' + f.citizenship : '',
          f.college ? 'College: ' + f.college + (f.highest_education ? ' (' + f.highest_education + ')' : '') : '',
          f.linkedin_url ? 'LinkedIn: ' + f.linkedin_url : '',
          f.github_url ? 'GitHub: ' + f.github_url : '',
          f.x_url ? 'X: ' + f.x_url : '',
          f.portfolio_url ? 'Portfolio: ' + f.portfolio_url : '',
        ].filter((x) => x !== '');
        lines.push(facts.map((x) => '- ' + x).join('\n'), '');
        lines.push('**Relevant experience**', '', block(f.relevant_experience), ...ask('fp.' + f.id + '.experience'), '');
      }
    }
  }
  return { filename: 'speedrun-application.md', markdown: lines.join('\n') };
}

module.exports = { APPLY_URL: APPLY_URL, STEPS: STEPS, FILL_STATUS: FILL_STATUS, STATUSES: STATUSES, ready: ready, packet: packet, fill: fill, progress: progress, submitted: submitted, setStatus: setStatus, nextCohort: nextCohort, exportMarkdown: exportMarkdown };
