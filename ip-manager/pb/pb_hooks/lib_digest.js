/// <reference path="../pb_data/types.d.ts" />
/**
 * Notifications: the daily digest (sections only when non-empty), reminder
 * thresholds per deadline, escalation of statutory items that are close and
 * unassigned or overdue, and the per-person calendar feed (ICS).
 *
 * In-app notifications always work. Email and Slack delivery go through
 * CraftBot's own actions (send_gmail, send_slack_message) and degrade to
 * in-app only when CraftBot or the integration is unavailable.
 */

function roleOfUser(u0) {
  try {
    return u0.getString('role');
  } catch {
    return '';
  }
}

function seesAll(role) {
  return role === 'admin' || role === 'manager' || role === 'counsel';
}

function deadlineLine(u, dl) {
  const ref = dl.getString('ref');
  const due = u.d10(dl.getString('due_date'));
  const days = u.diffDays(u.today(), due);
  const when = days < 0 ? Math.abs(days) + ' days overdue' : days === 0 ? 'due today' : 'due in ' + days + ' day' + (days === 1 ? '' : 's');
  return (ref ? ref + ' ' : '') + dl.getString('title') + ' (' + u.human(due) + ', ' + when + ')';
}

/** Daily every day, weekly on Mondays, monthly on the 1st. */
function scheduleDue(u, schedule, day) {
  if (schedule === 'daily') return true;
  if (schedule === 'weekly') return u.weekday(day) === 1;
  if (schedule === 'monthly') return day.slice(8, 10) === '01';
  return false;
}

function reportCell(u, v, type) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date') return u.human(String(v));
  return String(v);
}

/** Build one person's digest: { sections: [{title, items}], text, counts }. */
function buildDigest(app, user, windowDays) {
  const u = require(`${__hooks}/lib_util.js`);
  const role = roleOfUser(user);
  const today = u.today();
  const horizon = u.addDays(today, windowDays || 45);
  const mine = seesAll(role) ? '' : ' && assignee = {:uid}';
  const params = { uid: user.id, h: u.toPb(horizon), t: u.toPb(today) };
  const sections = [];

  const overdue = u.findMany(app, 'deadlines', 'status = "open" && due_date < {:t}' + mine, 'due_date', 50, params);
  if (overdue.length) sections.push({ title: 'Overdue', items: overdue.map((d) => deadlineLine(u, d)), link: '#/deadlines?window=overdue' });

  const soon = u.findMany(app, 'deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:h}' + mine, 'due_date', 80, params);
  const assignedToMe = soon.filter((d) => d.getString('assignee') === user.id);
  const others = soon.filter((d) => d.getString('assignee') !== user.id);
  if (assignedToMe.length) sections.push({ title: 'Assigned to you, next ' + (windowDays || 45) + ' days', items: assignedToMe.map((d) => deadlineLine(u, d)), link: '#/deadlines' });
  if (seesAll(role) && others.length) {
    sections.push({ title: 'Team deadlines, next ' + (windowDays || 45) + ' days', items: others.slice(0, 30).map((d) => deadlineLine(u, d)), link: '#/deadlines?scope=all' });
  }

  if (seesAll(role) || role === 'contributor') {
    const inbox = u.findMany(app, 'inbox_items', 'status = "new" || status = "awaiting_second"', '-created', 30);
    if (inbox.length) {
      sections.push({
        title: 'Waiting for review in the Inbox',
        items: inbox.map((i) => i.getString('title') + (i.getString('status') === 'awaiting_second' ? ' (needs a second reviewer)' : '')),
        link: '#/inbox',
      });
    }
  }
  if (seesAll(role)) {
    const pending = u.findMany(app, 'renewals', 'decision = "pending" && due_date <= {:h2}', 'due_date', 40, { h2: u.toPb(u.addDays(today, 120)) });
    if (pending.length) {
      sections.push({
        title: 'Renewal decisions due in the next 120 days',
        items: pending.map((r) => {
          const m = u.byId(app, 'matters', r.getString('matter'));
          return (m ? m.getString('ref') + ' ' : '') + r.getString('cycle_label') + ' (' + u.human(r.getString('due_date')) + ')';
        }),
        link: '#/renewals',
      });
    }
    const hits = u.findMany(app, 'watch_hits', 'status = "new"', 'opposition_deadline', 20);
    if (hits.length) {
      sections.push({
        title: 'New trademark watch hits',
        items: hits.map((h) => h.getString('their_mark') + (h.getString('opposition_deadline') ? ' (oppose by ' + u.human(h.getString('opposition_deadline')) + ')' : '')),
        link: '#/enforcement',
      });
    }
    const approvals = u.findMany(app, 'approvals', 'status = "submitted" || status = "in_review"', 'due_date', 20);
    if (approvals.length) {
      sections.push({ title: 'Product approvals waiting', items: approvals.map((a) => a.getString('product_name') + ' (' + a.getString('stage').replace('_', ' ') + ')'), link: '#/approvals' });
    }
  }
  // Saved reports scheduled for today (the person's own, and shared ones).
  if (role !== 'inventor') {
    const reports = require(`${__hooks}/lib_reports.js`);
    const views = u.findMany(app, 'saved_views', 'page = "reports" && (schedule = "daily" || schedule = "weekly" || schedule = "monthly") && (owner = {:uid} || scope = "shared")', 'name', 20, params);
    for (const v of views) {
      if (!scheduleDue(u, v.getString('schedule'), today)) continue;
      const f = u.asObject(u.j(v, 'filters', {}));
      const name = String(f.report || '');
      if (!name || (name === 'audit' && !seesAll(role))) continue;
      let res = null;
      try {
        res = reports.runReport(app, name, u.asObject(f.params));
      } catch (err) {
        console.error('scheduled report ' + v.id + ' failed:', String(err));
        continue;
      }
      const rows = u.asArray(res.rows);
      const cols = u.asArray(res.columns).slice(0, 4);
      const items = rows.slice(0, 10).map((row) => cols.map((c) => reportCell(u, row[c.key], c.type)).filter((x) => x !== '').join(', '));
      if (rows.length > 10) items.push('and ' + (rows.length - 10) + ' more in the app');
      if (!items.length) items.push('No rows today.');
      sections.push({ title: 'Report: ' + v.getString('name') + ' (' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ')', items: items, link: '#/reports' });
    }
  }
  if (role === 'inventor') {
    const mineInv = u.findMany(app, 'disclosures', 'submitted_by = {:uid}', '-updated', 20, params);
    if (mineInv.length) sections.push({ title: 'Your inventions', items: mineInv.map((d) => d.getString('title') + ': ' + d.getString('stage').replace('_', ' ')), link: '#/inventions' });
  }

  const org = String(u.setting(app, 'org_name', '') || 'IP Manager');
  const lines = ['IP Manager digest for ' + u.human(today) + (org ? ' (' + org + ')' : ''), ''];
  for (const s of sections) {
    lines.push(s.title + ' (' + s.items.length + ')');
    for (const it of s.items) lines.push('  - ' + it);
    lines.push('');
  }
  if (!sections.length) lines.push('Nothing needs attention today.');
  return {
    sections: sections,
    text: lines.join('\n'),
    counts: { overdue: overdue.length, soon: soon.length, sections: sections.length },
  };
}

function deliver(app, user, subject, text) {
  const u = require(`${__hooks}/lib_util.js`);
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const channel = String(u.setting(app, 'digest_channel', 'in_app') || 'in_app');
  if (channel === 'email') {
    const email = user.getString('email');
    if (!email) return { delivered: false, error: 'No email address on the account.' };
    const res = bridge.callAction('send_gmail', { to: email, subject: subject, body: text }, { confirmIrreversible: true });
    if (res && res.status >= 200 && res.status < 300) return { delivered: true, channel: 'email' };
    return { delivered: false, channel: 'email', error: (res && res.error) || 'Email delivery unavailable.' };
  }
  if (channel === 'slack') {
    const ch = String(u.setting(app, 'slack_channel', '') || '');
    if (!ch) return { delivered: false, error: 'No Slack channel set in Settings.' };
    const res = bridge.callAction('send_slack_message', { channel: ch, text: subject + '\n\n' + text }, { confirmIrreversible: true });
    if (res && res.status >= 200 && res.status < 300) return { delivered: true, channel: 'slack' };
    return { delivered: false, channel: 'slack', error: (res && res.error) || 'Slack delivery unavailable.' };
  }
  return { delivered: true, channel: 'in_app' };
}

/** Send today's digest to everyone who should get it. */
function runDigest(app, force) {
  const u = require(`${__hooks}/lib_util.js`);
  const s = u.settings(app);
  if (s === null) return { sent: 0 };
  if (!force && !s.getBool('digest_enabled')) return { sent: 0, skipped: 'disabled' };
  const today = u.today();
  if (!force && u.d10(s.getString('last_digest')) === today) return { sent: 0, skipped: 'already sent today' };
  const users = u.findMany(app, 'users', '', 'created', 0);
  let sent = 0;
  const failures = [];
  const channel = String(s.getString('digest_channel') || 'in_app');
  let slackSent = false;
  for (const user of users) {
    if (user.getBool('digest_opt_out')) continue;
    const role = roleOfUser(user);
    if (role === 'viewer') continue;
    const d = buildDigest(app, user, 45);
    if (!d.sections.length) continue;
    u.notify(app, user.id, 'digest', 'Daily digest: ' + d.counts.overdue + ' overdue, ' + d.counts.soon + ' coming up', d.text, '#/', { sections: d.sections });
    if (channel === 'email') {
      const r = deliver(app, user, 'IP Manager: ' + d.counts.overdue + ' overdue, ' + d.counts.soon + ' coming up', d.text);
      if (!r.delivered) failures.push(user.getString('email') + ': ' + r.error);
    } else if (channel === 'slack' && !slackSent && seesAll(role)) {
      const r = deliver(app, user, 'IP Manager team digest', d.text);
      slackSent = true;
      if (!r.delivered) failures.push('Slack: ' + r.error);
    }
    sent += 1;
  }
  s.set('last_digest', u.toPb(today));
  app.save(s);
  if (failures.length) console.error('digest delivery problems:', failures.join('; '));
  return { sent: sent, failures: failures };
}

/** Reminder thresholds and escalations. Idempotent per deadline and threshold. */
function runReminders(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const today = u.today();
  const st = u.settings(app);
  let days = u.asArray(st ? u.j(st, 'reminder_days', [90, 60, 30, 14, 7, 1]) : [90, 60, 30, 14, 7, 1]).map(Number).filter((n) => n > 0);
  if (!days.length) days = [30, 7, 1];
  const maxDays = Math.max.apply(null, days);
  const rows = u.findMany(app, 'deadlines', 'status = "open" && due_date <= {:h}', 'due_date', 0, { h: u.toPb(u.addDays(today, maxDays)) });
  const managers = u.usersWithRoles(app, ['admin', 'manager']);
  let reminders = 0;
  let escalations = 0;
  for (const dl of rows) {
    const due = u.d10(dl.getString('due_date'));
    const left = u.diffDays(today, due);
    const sent = u.asArray(u.j(dl, 'reminders_sent', []));
    const statutory = ['hard', 'extendable', 'designated'].indexOf(dl.getString('kind')) >= 0;
    const internalOnly = dl.getString('kind') === 'internal' || dl.getString('kind') === 'reminder';
    const thresholds = internalOnly ? days.filter((d) => d <= 7) : days;
    let changed = false;
    for (const t of thresholds) {
      const key = 'd' + t;
      if (left <= t && left >= 0 && sent.indexOf(key) < 0) {
        const who = dl.getString('assignee');
        if (who) {
          u.notify(app, who, 'assignment', 'Reminder: ' + dl.getString('title') + ' due in ' + left + ' day' + (left === 1 ? '' : 's'), deadlineLine(u, dl),
            '#/deadlines/' + dl.id, { deadline: dl.id });
          reminders += 1;
        }
        sent.push(key);
        changed = true;
        break;
      }
    }
    // Escalate statutory items: overdue, or within 7 days with nobody assigned.
    const escKey = left < 0 ? 'esc-overdue' : 'esc-7';
    if (statutory && (left < 0 || (left <= 7 && !dl.getString('assignee'))) && sent.indexOf(escKey) < 0) {
      for (const m of managers) {
        u.notify(
          app,
          m.id,
          'escalation',
          (left < 0 ? 'Overdue statutory deadline: ' : 'Unassigned statutory deadline: ') + dl.getString('title'),
          deadlineLine(u, dl) + (dl.getString('assignee') ? '' : '\nNobody is assigned.'),
          '#/deadlines/' + dl.id,
          { deadline: dl.id },
        );
      }
      sent.push(escKey);
      changed = true;
      escalations += 1;
    }
    if (changed) {
      dl.set('reminders_sent', sent);
      app.save(dl);
    }
  }
  return { reminders: reminders, escalations: escalations };
}

/** Lapse sweep: renewals decided "lapse" whose grace period has passed. */
function runLapseSweep(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const today = u.today();
  const rows = u.findMany(app, 'renewals', 'decision = "lapse" && instruction_status != "lapsed"', '', 0);
  let lapsed = 0;
  for (const r of rows) {
    const end = u.d10(r.getString('grace_end')) || u.d10(r.getString('due_date'));
    if (end === '' || end >= today) continue;
    const m = u.byId(app, 'matters', r.getString('matter'));
    r.set('instruction_status', 'lapsed');
    app.save(r);
    if (m !== null && engine.statusGroup(m.getString('status')) !== 'dead') {
      const subject = engine.subjectFromRecord('matter', m);
      engine.recordEvent(app, subject, 'LAPSED', u.addDays(end, 1), { source: 'system', label: 'Lapsed after a decision not to renew', commit: false });
      lapsed += 1;
    }
  }
  return { lapsed: lapsed };
}

/* ------------------------------------------------------------------ */
/* Calendar feed                                                        */
/* ------------------------------------------------------------------ */

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function fold(line) {
  // RFC 5545: lines longer than 75 octets are folded.
  if (line.length <= 73) return line;
  const out = [];
  let rest = line;
  out.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length) {
    out.push(' ' + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  return out.join('\r\n');
}

function buildIcs(app, userId, scope) {
  const u = require(`${__hooks}/lib_util.js`);
  const from = u.toPb(u.addDays(u.today(), -30));
  const filter = scope === 'all' ? 'status = "open" && due_date >= {:f}' : 'status = "open" && due_date >= {:f} && assignee = {:u}';
  const rows = u.findMany(app, 'deadlines', filter, 'due_date', 2000, { f: from, u: userId });
  const org = String(u.setting(app, 'org_name', '') || 'IP Manager');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IP Manager//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEscape(org + ' deadlines'),
  ];
  for (const dl of rows) {
    const due = u.d10(dl.getString('due_date'));
    if (!due) continue;
    const start = due.replace(/-/g, '');
    const end = u.addDays(due, 1).replace(/-/g, '');
    const ref = dl.getString('ref');
    const summary = (ref ? ref + ': ' : '') + dl.getString('title');
    const desc = [
      'Kind: ' + dl.getString('kind'),
      dl.getString('final_date') ? 'Final date: ' + u.human(dl.getString('final_date')) : '',
      dl.getString('citation') ? 'Basis: ' + dl.getString('citation') : '',
    ]
      .filter(Boolean)
      .join('\n');
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + dl.id + '@ip-manager');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART;VALUE=DATE:' + start);
    lines.push('DTEND;VALUE=DATE:' + end);
    lines.push(fold('SUMMARY:' + icsEscape(summary)));
    lines.push(fold('DESCRIPTION:' + icsEscape(desc)));
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = {
  buildDigest: buildDigest,
  runDigest: runDigest,
  runReminders: runReminders,
  runLapseSweep: runLapseSweep,
  buildIcs: buildIcs,
  deliver: deliver,
};
