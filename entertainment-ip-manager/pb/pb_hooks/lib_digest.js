/// <reference path="../pb_data/types.d.ts" />
/**
 * Notifications: the daily digest (in each person's language; sections only
 * when non-empty), reminder thresholds per deadline, escalation of
 * statutory items that are close and unassigned or overdue, renewal lapse
 * sweeps and the per-person calendar feed (ICS).
 *
 * External accounts get a portal digest: licensees see approvals waiting on
 * them and statements due, committee members see open consent requests,
 * outside reviewers see approvals assigned to them.
 *
 * In-app notifications always work. Email and Slack delivery go through
 * CraftBot's own actions (send_gmail, send_slack_message) and degrade to
 * in-app only when CraftBot or the integration is unavailable.
 */

function roleOfUser(usr) {
  try {
    return usr.getString('role');
  } catch {
    return '';
  }
}

function seesAll(role) {
  return role === 'admin' || role === 'manager';
}

function L(lang, en, ja) {
  return lang === 'ja' ? ja : en;
}

function deadlineLine(u, dl, lang) {
  const ref = dl.getString('ref') || dl.getString('subject_label');
  const due = u.d10(dl.getString('due_date'));
  const days = u.diffDays(u.today(), due);
  const title = lang === 'ja' ? dl.getString('title_ja') || dl.getString('title') : dl.getString('title');
  if (lang === 'ja') {
    const when = days < 0 ? Math.abs(days) + '日超過' : days === 0 ? '本日期限' : 'あと' + days + '日';
    return (ref ? ref + ' ' : '') + title + '（' + u.humanJa(due) + '、' + when + '）';
  }
  const when = days < 0 ? Math.abs(days) + ' days overdue' : days === 0 ? 'due today' : 'due in ' + days + ' day' + (days === 1 ? '' : 's');
  return (ref ? ref + ' ' : '') + title + ' (' + u.human(due) + ', ' + when + ')';
}

function scheduleDue(u, schedule, day) {
  if (schedule === 'daily') return true;
  if (schedule === 'weekly') return u.weekday(day) === 1;
  if (schedule === 'monthly') return day.slice(8, 10) === '01';
  return false;
}

function reportCell(u, v, type, lang) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date') return lang === 'ja' ? u.humanJa(String(v)) : u.human(String(v));
  if (typeof v === 'object') return lang === 'ja' ? v.ja || v.en || '' : v.en || v.ja || '';
  return String(v);
}

/** Categories each internal role watches beyond its own assigned deadlines. */
const ROLE_CATEGORIES = {
  rights: ['agreement', 'committee', 'prosecution', 'renewal', 'opposition', 'use', 'enforcement', 'customs', 'copyright', 'filing', 'term'],
  licensing: ['licensing', 'approval', 'agreement'],
  talent_manager: ['talent', 'playbook', 'permission', 'guideline', 'content_id'],
};

function portalDigest(app, user, lang) {
  const u = require(`${__hooks}/lib_util.js`);
  const role = roleOfUser(user);
  const sections = [];
  const params = { uid: user.id, t: u.toPb(u.today()) };
  if (role === 'licensee') {
    const ap = u.findMany(app, 'approvals', 'portal_users.id ?= {:uid} && status = "changes_requested"', 'due_date', 30, params);
    if (ap.length) {
      sections.push({
        title: L(lang, 'Approvals that need your changes', '修正依頼が届いている監修'),
        items: ap.map(function (a) {
          const p = u.byId(app, 'products', a.getString('product'));
          return (p ? p.getString('name') : '') + ' (' + a.getString('stage').replace(/_/g, ' ') + ')';
        }),
        link: '#/approvals',
      });
    }
    const reps = u.findMany(app, 'royalty_reports', 'portal_users.id ?= {:uid} && status = "expected" && due_date <= {:h}', 'due_date', 30, {
      uid: user.id,
      h: u.toPb(u.addDays(u.today(), 30)),
    });
    if (reps.length) {
      sections.push({
        title: L(lang, 'Royalty statements due', '提出期限が近いロイヤルティ報告'),
        items: reps.map(function (r) {
          return L(lang, 'Period ending ' + u.human(r.getString('period_end')) + ', due ' + u.human(r.getString('due_date')), u.humanJa(r.getString('period_end')) + '締め、期限 ' + u.humanJa(r.getString('due_date')));
        }),
        link: '#/royalties',
      });
    }
  } else if (role === 'committee_member') {
    const cr = u.findMany(app, 'consent_requests', 'portal_users.id ?= {:uid} && status = "open"', 'due_date', 30, params);
    if (cr.length) {
      sections.push({
        title: L(lang, 'Consent requests waiting for your answer', '回答待ちの同意依頼'),
        items: cr.map(function (c) {
          return c.getString('subject') + ' (' + (lang === 'ja' ? u.humanJa(c.getString('due_date')) + 'まで' : 'by ' + u.human(c.getString('due_date'))) + ')';
        }),
        link: '#/committees',
      });
    }
  } else if (role === 'reviewer') {
    const ap = u.findMany(app, 'approvals', 'assigned_reviewers.id ?= {:uid} && (status = "submitted" || status = "in_review")', 'due_date', 30, params);
    const mine = ap.filter(function (a) {
      return u.j(a, 'reviewers', []).some(function (r) {
        return r.user === user.id && (r.decision === 'pending' || !r.decision);
      });
    });
    if (mine.length) {
      sections.push({
        title: L(lang, 'Approvals waiting for your review', 'あなたの確認待ちの監修'),
        items: mine.map(function (a) {
          const p = u.byId(app, 'products', a.getString('product'));
          return (p ? p.getString('name') : '') + ' (' + (lang === 'ja' ? u.humanJa(a.getString('due_date')) + 'まで' : 'by ' + u.human(a.getString('due_date'))) + ')';
        }),
        link: '#/approvals',
      });
    }
  }
  return sections;
}

/** Build one person's digest: { sections: [{title, items, link}], text, counts, lang }. */
function buildDigest(app, user, windowDays) {
  const u = require(`${__hooks}/lib_util.js`);
  const role = roleOfUser(user);
  const lang = u.langOf(app, user.id);
  const today = u.today();
  const days = windowDays || 45;
  const horizon = u.addDays(today, days);
  const sections = [];
  let overdueCount = 0;
  let soonCount = 0;
  if (u.EXTERNAL_ROLES.indexOf(role) >= 0) {
    for (const s of portalDigest(app, user, lang)) sections.push(s);
  } else {
    const cats = ROLE_CATEGORIES[role] || [];
    const catFilter = cats.length ? ' || (' + cats.map(function (c) { return 'category = "' + c + '"'; }).join(' || ') + ')' : '';
    const scope = seesAll(role) ? '' : ' && (assignee = {:uid}' + catFilter + ')';
    const params = { uid: user.id, h: u.toPb(horizon), t: u.toPb(today) };
    const overdue = u.findMany(app, 'deadlines', 'status = "open" && due_date < {:t}' + scope, 'due_date', 50, params);
    overdueCount = overdue.length;
    if (overdue.length) {
      sections.push({
        title: L(lang, 'Overdue', '期限超過'),
        items: overdue.map(function (d) {
          return deadlineLine(u, d, lang);
        }),
        link: '#/deadlines?window=overdue',
      });
    }
    const soon = u.findMany(app, 'deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:h}' + scope, 'due_date', 80, params);
    soonCount = soon.length;
    const mine = soon.filter(function (d) {
      return d.getString('assignee') === user.id;
    });
    const others = soon.filter(function (d) {
      return d.getString('assignee') !== user.id;
    });
    if (mine.length) {
      sections.push({
        title: L(lang, 'Assigned to you, next ' + days + ' days', 'あなたの担当（今後' + days + '日）'),
        items: mine.map(function (d) {
          return deadlineLine(u, d, lang);
        }),
        link: '#/deadlines',
      });
    }
    if (others.length && role !== 'viewer' && role !== 'contributor') {
      sections.push({
        title: L(lang, 'Team deadlines in your area, next ' + days + ' days', '担当領域のチーム期限（今後' + days + '日）'),
        items: others.slice(0, 30).map(function (d) {
          return deadlineLine(u, d, lang);
        }),
        link: '#/deadlines?assignee=anyone',
      });
    }
    if (role !== 'viewer') {
      const inbox = u.findMany(app, 'inbox_items', 'status = "new" || status = "awaiting_second"', '-created', 30);
      if (inbox.length) {
        sections.push({
          title: L(lang, 'Waiting for review in the Inbox', 'インボックスで確認待ち'),
          items: inbox.map(function (i) {
            return i.getString('title') + (i.getString('status') === 'awaiting_second' ? L(lang, ' (needs a second reviewer)', '（2人目の承認が必要）') : '');
          }),
          link: '#/inbox',
        });
      }
    }
    if (seesAll(role) || role === 'licensing') {
      const approvals = u.findMany(app, 'approvals', 'status = "submitted" || status = "in_review"', 'due_date', 20);
      if (approvals.length) {
        sections.push({
          title: L(lang, 'Product approvals waiting', '確認待ちの監修'),
          items: approvals.map(function (a) {
            const p = u.byId(app, 'products', a.getString('product'));
            return (p ? p.getString('name') : '') + ' (' + a.getString('stage').replace(/_/g, ' ') + ', ' + (lang === 'ja' ? u.humanJa(a.getString('due_date')) : u.human(a.getString('due_date'))) + ')';
          }),
          link: '#/approvals',
        });
      }
    }
    if (seesAll(role) || role === 'rights') {
      const pending = u.findMany(app, 'renewals', 'decision = "pending" && due_date <= {:h2}', 'due_date', 40, { h2: u.toPb(u.addDays(today, 120)) });
      if (pending.length) {
        sections.push({
          title: L(lang, 'Renewal decisions due in the next 120 days', '120日以内に判断が必要な更新'),
          items: pending.map(function (r) {
            const m = u.byId(app, 'matters', r.getString('matter'));
            return (m ? m.getString('ref') + ' ' : '') + r.getString('cycle_label') + ' (' + (lang === 'ja' ? u.humanJa(r.getString('due_date')) : u.human(r.getString('due_date'))) + ')';
          }),
          link: '#/renewals',
        });
      }
      const hits = u.findMany(app, 'watch_hits', 'status = "new"', 'opposition_deadline', 20);
      if (hits.length) {
        sections.push({
          title: L(lang, 'New watch hits', '新しいウォッチ結果'),
          items: hits.map(function (h) {
            return h.getString('their_mark') + (h.getString('opposition_deadline') ? ' (' + L(lang, 'oppose by ' + u.human(h.getString('opposition_deadline')), u.humanJa(h.getString('opposition_deadline')) + 'まで異議可能') + ')' : '');
          }),
          link: '#/enforcement',
        });
      }
      const consents = u.findMany(app, 'consent_requests', 'status = "open"', 'due_date', 20);
      if (consents.length) {
        sections.push({
          title: L(lang, 'Open committee consent requests', '回答待ちの委員会同意依頼'),
          items: consents.map(function (c) {
            return c.getString('subject');
          }),
          link: '#/committees',
        });
      }
    }
    if (seesAll(role) || role === 'talent_manager') {
      const perms = u.findMany(app, 'permissions', 'status = "active" && end_date != "" && end_date <= {:h3}', 'end_date', 20, { h3: u.toPb(u.addDays(today, 60)) });
      if (perms.length) {
        sections.push({
          title: L(lang, 'Permissions ending in the next 60 days', '60日以内に終了する許諾'),
          items: perms.map(function (p) {
            return p.getString('title') + ' (' + (lang === 'ja' ? u.humanJa(p.getString('end_date')) : u.human(p.getString('end_date'))) + ')';
          }),
          link: '#/permissions',
        });
      }
    }
    // Saved reports scheduled for today (the person's own, and shared ones).
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
      } catch (error) {
        console.error('scheduled report ' + v.id + ' failed:', String(error));
        continue;
      }
      const rows = u.asArray(res.rows);
      const cols = u.asArray(res.columns).slice(0, 4);
      const items = rows.slice(0, 10).map(function (row) {
        return cols
          .map(function (c) {
            return reportCell(u, row[c.key], c.type, lang);
          })
          .filter(function (x) {
            return x !== '';
          })
          .join(', ');
      });
      if (rows.length > 10) items.push(L(lang, 'and ' + (rows.length - 10) + ' more in the app', 'ほか' + (rows.length - 10) + '件はアプリで確認'));
      if (!items.length) items.push(L(lang, 'No rows today.', '本日は該当なし。'));
      sections.push({ title: L(lang, 'Report: ', 'レポート：') + v.getString('name') + ' (' + rows.length + ')', items: items, link: '#/reports' });
    }
  }
  const org = String(u.setting(app, 'org_name', '') || 'Entertainment IP Manager');
  const lines = [L(lang, 'Digest for ' + u.human(today) + ' (' + org + ')', u.humanJa(today) + 'のダイジェスト（' + org + '）'), ''];
  for (const s of sections) {
    lines.push(s.title + ' (' + s.items.length + ')');
    for (const it of s.items) lines.push('  - ' + it);
    lines.push('');
  }
  if (!sections.length) lines.push(L(lang, 'Nothing needs attention today.', '本日対応が必要な項目はありません。'));
  return {
    sections: sections,
    text: lines.join('\n'),
    lang: lang,
    counts: { overdue: overdueCount, soon: soonCount, sections: sections.length },
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
    const title = L(d.lang, 'Daily digest: ' + d.counts.overdue + ' overdue, ' + d.counts.soon + ' coming up', 'デイリーダイジェスト：期限超過' + d.counts.overdue + '件、近日' + d.counts.soon + '件');
    u.notify(app, user.id, 'digest', title, d.text, '#/', { sections: d.sections });
    if (channel === 'email') {
      const r = deliver(app, user, title, d.text);
      if (!r.delivered) failures.push(user.getString('email') + ': ' + r.error);
    } else if (channel === 'slack' && !slackSent && seesAll(role)) {
      const r = deliver(app, user, L(d.lang, 'Team digest', 'チームダイジェスト'), d.text);
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
  let days = u
    .asArray(st ? u.j(st, 'reminder_days', [90, 60, 30, 14, 7, 1]) : [90, 60, 30, 14, 7, 1])
    .map(Number)
    .filter(function (n) {
      return n > 0;
    });
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
    const thresholds = internalOnly
      ? days.filter(function (d) {
          return d <= 7;
        })
      : days;
    let changed = false;
    for (const t of thresholds) {
      const key = 'd' + t;
      if (left <= t && left >= 0 && sent.indexOf(key) < 0) {
        const who = dl.getString('assignee');
        if (who) {
          u.notify(
            app,
            who,
            'assignment',
            u.bi(
              'Reminder: ' + dl.getString('title') + ' due in ' + left + ' day' + (left === 1 ? '' : 's'),
              'リマインダー：' + (dl.getString('title_ja') || dl.getString('title')) + '（あと' + left + '日）',
            ),
            u.bi(deadlineLine(u, dl, 'en'), deadlineLine(u, dl, 'ja')),
            '#/deadlines/' + dl.id,
            { deadline: dl.id },
          );
          reminders += 1;
        }
        sent.push(key);
        changed = true;
        break;
      }
    }
    const escKey = left < 0 ? 'esc-overdue' : 'esc-7';
    if (statutory && (left < 0 || (left <= 7 && !dl.getString('assignee'))) && sent.indexOf(escKey) < 0) {
      for (const m of managers) {
        u.notify(
          app,
          m.id,
          'escalation',
          u.bi(
            (left < 0 ? 'Overdue deadline: ' : 'Unassigned deadline: ') + dl.getString('title'),
            (left < 0 ? '期限超過：' : '担当者未設定の期限：') + (dl.getString('title_ja') || dl.getString('title')),
          ),
          u.bi(deadlineLine(u, dl, 'en') + (dl.getString('assignee') ? '' : '\nNobody is assigned.'), deadlineLine(u, dl, 'ja') + (dl.getString('assignee') ? '' : '\n担当者がいません。')),
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
      engine.recordEvent(app, engine.subjectFromRecord('matter', m), 'LAPSED', u.addDays(end, 1), {
        source: 'system',
        label: 'Lapsed after a decision not to renew',
        label_ja: '更新しない判断により消滅',
        commit: false,
      });
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
  const lang = u.langOf(app, userId);
  const from = u.toPb(u.addDays(u.today(), -30));
  const filter = scope === 'all' ? 'status = "open" && due_date >= {:f}' : 'status = "open" && due_date >= {:f} && assignee = {:u}';
  const rows = u.findMany(app, 'deadlines', filter, 'due_date', 2000, { f: from, u: userId });
  const org = String(u.setting(app, 'org_name', '') || 'Entertainment IP Manager');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Entertainment IP Manager//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEscape(org + L(lang, ' deadlines', ' 期限')),
  ];
  for (const dl of rows) {
    const due = u.d10(dl.getString('due_date'));
    if (!due) continue;
    const ref = dl.getString('ref') || dl.getString('subject_label');
    const title = lang === 'ja' ? dl.getString('title_ja') || dl.getString('title') : dl.getString('title');
    const desc = [
      L(lang, 'Kind: ', '種類：') + dl.getString('kind'),
      dl.getString('final_date') ? L(lang, 'Final date: ' + u.human(dl.getString('final_date')), '最終期限：' + u.humanJa(dl.getString('final_date'))) : '',
      dl.getString('citation') ? L(lang, 'Basis: ', '根拠：') + dl.getString('citation') : '',
    ]
      .filter(Boolean)
      .join('\n');
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + dl.id + '@entertainment-ip-manager');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART;VALUE=DATE:' + due.replace(/-/g, ''));
    lines.push('DTEND;VALUE=DATE:' + u.addDays(due, 1).replace(/-/g, ''));
    lines.push(fold('SUMMARY:' + icsEscape((ref ? ref + ': ' : '') + title)));
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
