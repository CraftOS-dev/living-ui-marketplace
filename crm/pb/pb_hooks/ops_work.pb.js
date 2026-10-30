/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations on the work: notes, interactions, tasks and emails, and the
 * queues the AI agent drains (research, meeting reviews, emails to send).
 * Notes, interactions and tasks are written directly by anyone (the AI
 * agent's are marked as its own); sending email is the person's unless they
 * made it automatic for the agent.
 */

/* ------------------------------------------------------------------ notes */

routerAdd('GET', '/api/ops/notes/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const t = work.targets(app, p);
    const parts = [];
    const prm = {};
    for (const k of ['person', 'company', 'deal'])
      if (t[k]) {
        parts.push(k + ' = {:' + k + '}');
        prm[k] = t[k];
      }
    const rows = app.findRecordsByFilter('notes', parts.join(' && ') || 'id != ""', '-pinned,-created', u.int(p, 'limit', 100, 1, 500), 0, prm);
    return { notes: rows.map((r) => work.serializeNote(app, r)) };
  }),
);

routerAdd('POST', '/api/ops/notes/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const who = u.actor(e);
    const id = require(`${__hooks}/lib_activity.js`).run(app, who, 'notes.create', (t) => {
      const n = work.createNote(t, who, p);
      return { summary: 'Added a note' + (n.getString('body').length > 0 ? ': ' + n.getString('body').split('\n')[0].slice(0, 60) : ''), type: n.getString('person') ? 'people' : n.getString('company') ? 'companies' : 'deals', id: n.getString('person') || n.getString('company') || n.getString('deal'), result: n.id };
    });
    return { note: work.serializeNote(app, app.findRecordById('notes', id)) };
  }),
);

routerAdd('POST', '/api/ops/notes/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const who = u.actor(e);
    const n0 = u.byId(app, 'notes', u.req(p, 'note'));
    if (!n0) throw u.fail(404, 'No note ' + u.str(p, 'note', ''));
    if (who.actor === 'agent' && n0.getString('by') !== 'agent' && u.has(p, 'body')) throw u.fail(403, "Add your own note instead of rewriting the person's");
    require(`${__hooks}/lib_activity.js`).run(app, who, 'notes.update', (t) => {
      const n = t.findRecordById('notes', n0.id);
      if (u.has(p, 'body')) {
        const b = u.text(p, 'body', '');
        if (b === '') throw u.fail(400, 'body cannot be empty');
        n.set('body', b.slice(0, 20000));
      }
      if (u.has(p, 'pinned')) {
        const pin = u.bool(p, 'pinned', false);
        // One pinned note per record keeps it meaningful.
        if (pin)
          for (const k of ['person', 'company', 'deal'])
            if (n.getString(k))
              for (const o of t.findRecordsByFilter('notes', k + ' = {:id} && pinned = true && id != {:n}', '', 0, 0, { id: n.getString(k), n: n.id })) {
                o.set('pinned', false);
                t.save(o);
              }
        n.set('pinned', pin);
      }
      t.save(n);
      return { summary: u.has(p, 'pinned') && !u.has(p, 'body') ? (n.getBool('pinned') ? 'Pinned a note' : 'Unpinned a note') : 'Edited a note', type: n.getString('person') ? 'people' : n.getString('company') ? 'companies' : 'deals', id: n.getString('person') || n.getString('company') || n.getString('deal'), merge: true };
    });
    return { note: work.serializeNote(app, app.findRecordById('notes', n0.id)) };
  }),
);

routerAdd('POST', '/api/ops/notes/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const n0 = u.byId(app, 'notes', u.req(p, 'note'));
    if (!n0) throw u.fail(404, 'No note ' + u.str(p, 'note', ''));
    if (who.actor === 'agent' && n0.getString('by') !== 'agent') throw u.fail(403, "Only the person deletes their notes");
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'notes.delete', (t) => {
      const n = t.findRecordById('notes', n0.id);
      t.delete(n);
      return { summary: 'Deleted a note', type: n.getString('person') ? 'people' : n.getString('company') ? 'companies' : 'deals', id: n.getString('person') || n.getString('company') || n.getString('deal'), result: { deleted: true } };
    });
  }),
);

/* ----------------------------------------------------------- interactions */

routerAdd('GET', '/api/ops/interactions/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ix = require(`${__hooks}/lib_interactions.js`);
    const t = require(`${__hooks}/lib_work.js`).targets(app, p);
    const parts = [];
    const prm = {};
    if (t.person) {
      parts.push('people ~ {:person}');
      prm.person = t.person;
    }
    if (t.company) {
      parts.push('company = {:company}');
      prm.company = t.company;
    }
    if (t.deal) {
      parts.push('deal = {:deal}');
      prm.deal = t.deal;
    }
    const kind = u.oneOf(p, 'kind', ['email', 'call', 'meeting', 'message'], '');
    if (kind) {
      parts.push('kind = {:kind}');
      prm.kind = kind;
    }
    if (u.str(p, 'from', '') !== '') {
      parts.push('at >= {:from}');
      prm.from = u.str(p, 'from', '');
    }
    if (u.str(p, 'to', '') !== '') {
      parts.push('at <= {:to}');
      prm.to = u.str(p, 'to', '') + 'T23:59:59Z';
    }
    const rows = app.findRecordsByFilter('interactions', parts.join(' && ') || 'id != ""', '-at', u.int(p, 'limit', 100, 1, 1000), 0, prm);
    return { interactions: rows.map((r) => ix.serialize(app, r)) };
  }),
);

routerAdd('POST', '/api/ops/interactions/log', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ix = require(`${__hooks}/lib_interactions.js`);
    const who = u.actor(e);
    let res = null;
    require(`${__hooks}/lib_activity.js`).run(app, who, 'interactions.log', (t) => {
      res = ix.log(t, who, p);
      const r = res.interaction;
      const label = { email: 'an email', call: 'a call', meeting: 'a meeting', message: 'a message' }[r.getString('kind')];
      const target = r.getStringSlice('people')[0] || r.getString('company') || r.getString('deal');
      return { summary: res.created ? 'Logged ' + label + (r.getString('subject') ? ': ' + r.getString('subject') : '') : '', type: r.getStringSlice('people')[0] ? 'people' : r.getString('company') ? 'companies' : 'deals', id: target, undoable: res.created };
    });
    let asked = false;
    if (res.review) asked = require(`${__hooks}/lib_agent.js`).nudge(app, 'meetings').fired === true;
    return { interaction: ix.serialize(app, app.findRecordById('interactions', res.interaction.id)), created: res.created, review: res.review, asked: asked };
  }),
);

routerAdd('POST', '/api/ops/interactions/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ix = require(`${__hooks}/lib_interactions.js`);
    const who = u.actor(e);
    const r0 = u.byId(app, 'interactions', u.req(p, 'interaction'));
    if (!r0) throw u.fail(404, 'No interaction ' + u.str(p, 'interaction', ''));
    require(`${__hooks}/lib_activity.js`).run(app, who, 'interactions.update', (t) => {
      const r = t.findRecordById('interactions', r0.id);
      if (u.has(p, 'subject')) r.set('subject', u.squash(u.str(p, 'subject', '')).slice(0, 200));
      if (u.has(p, 'summary')) r.set('summary', u.text(p, 'summary', '').slice(0, 8000));
      if (u.has(p, 'at')) r.set('at', ix.parseAt(u.str(p, 'at', '')));
      if (u.has(p, 'kind')) r.set('kind', u.oneOf(p, 'kind', ['email', 'call', 'meeting', 'message'], r.getString('kind')));
      t.save(r);
      ix.refresh(t, r.getStringSlice('people'), r.getString('company'), r.getString('deal'), r.getString('at'));
      return { summary: 'Edited an interaction', type: r.getStringSlice('people')[0] ? 'people' : r.getString('company') ? 'companies' : 'deals', id: r.getStringSlice('people')[0] || r.getString('company') || r.getString('deal'), merge: true };
    });
    return { interaction: ix.serialize(app, app.findRecordById('interactions', r0.id)) };
  }),
);

routerAdd('POST', '/api/ops/interactions/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const r0 = u.byId(app, 'interactions', u.req(p, 'interaction'));
    if (!r0) throw u.fail(404, 'No interaction ' + u.str(p, 'interaction', ''));
    if (who.actor === 'agent' && r0.getString('by') !== 'agent') throw u.fail(403, 'Only the person deletes what they logged');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'interactions.delete', (t) => {
      const r = t.findRecordById('interactions', r0.id);
      const target = r.getStringSlice('people')[0] || r.getString('company') || r.getString('deal');
      require(`${__hooks}/lib_interactions.js`).remove(t, r);
      return { summary: 'Deleted an interaction', type: r.getStringSlice('people')[0] ? 'people' : r.getString('company') ? 'companies' : 'deals', id: target, result: { deleted: true } };
    });
  }),
);

/* ------------------------------------------------------------------ tasks */

routerAdd('GET', '/api/ops/tasks/today', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_work.js`).today(app)));

routerAdd('GET', '/api/ops/tasks/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const t = work.targets(app, p);
    const parts = [];
    const prm = {};
    for (const k of ['person', 'company', 'deal'])
      if (t[k]) {
        parts.push(k + ' = {:' + k + '}');
        prm[k] = t[k];
      }
    const state = u.oneOf(p, 'state', ['open', 'done', 'all'], 'open');
    if (state === 'open') parts.push("done_at = ''");
    if (state === 'done') parts.push("done_at != ''");
    const rows = app.findRecordsByFilter('tasks', parts.join(' && ') || 'id != ""', state === 'done' ? '-done_at' : 'due,created', u.int(p, 'limit', 200, 1, 1000), 0, prm);
    return { tasks: rows.map((r) => work.serializeTask(app, r)) };
  }),
);

routerAdd('POST', '/api/ops/tasks/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const who = u.actor(e);
    const id = require(`${__hooks}/lib_activity.js`).run(app, who, 'tasks.create', (t) => {
      const r = work.createTask(t, who, p);
      return { summary: 'Added the task "' + r.getString('title') + '"', type: r.getString('person') ? 'people' : r.getString('company') ? 'companies' : 'deals', id: r.getString('person') || r.getString('company') || r.getString('deal') || r.id, result: r.id };
    });
    return { task: work.serializeTask(app, app.findRecordById('tasks', id)) };
  }),
);

routerAdd('POST', '/api/ops/tasks/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const dates = require(`${__hooks}/lib_dates.js`);
    const who = u.actor(e);
    const r0 = u.byId(app, 'tasks', u.req(p, 'task'));
    if (!r0) throw u.fail(404, 'No task ' + u.str(p, 'task', ''));
    require(`${__hooks}/lib_activity.js`).run(app, who, 'tasks.update', (t) => {
      const r = t.findRecordById('tasks', r0.id);
      if (u.has(p, 'title')) {
        const ti = u.squash(u.str(p, 'title', '')).slice(0, 300);
        if (ti === '') throw u.fail(400, 'title cannot be empty');
        r.set('title', ti);
      }
      if (u.has(p, 'notes')) r.set('notes', u.text(p, 'notes', '').slice(0, 4000));
      if (u.has(p, 'due')) r.set('due', u.str(p, 'due', '') === '' ? '' : dates.parse(u.str(p, 'due', ''), 'due'));
      if (u.has(p, 'kind')) r.set('kind', u.oneOf(p, 'kind', ['todo', 'call', 'email', 'meeting', 'follow_up'], 'todo'));
      if (u.has(p, 'person') || u.has(p, 'company') || u.has(p, 'deal')) {
        const tg = work.targets(t, p);
        for (const k of ['person', 'company', 'deal']) if (u.has(p, k)) r.set(k, tg[k]);
      }
      t.save(r);
      return { summary: 'Changed the task "' + r.getString('title') + '"', type: r.getString('person') ? 'people' : r.getString('company') ? 'companies' : 'deals', id: r.getString('person') || r.getString('company') || r.getString('deal') || r.id, merge: true };
    });
    return { task: work.serializeTask(app, app.findRecordById('tasks', r0.id)) };
  }),
);

routerAdd('POST', '/api/ops/tasks/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const who = u.actor(e);
    const ids = u.has(p, 'tasks') ? u.list(p, 'tasks', true) : [u.req(p, 'task')];
    const done = u.bool(p, 'done', true);
    require(`${__hooks}/lib_activity.js`).run(app, who, 'tasks.complete', (t) => {
      const names = [];
      for (const id of ids) {
        const r = t.findRecordById('tasks', String(id).trim());
        r.set('done_at', done ? new Date().toISOString() : '');
        if (done) r.set('snoozed_until', '');
        t.save(r);
        if (done && r.getString('deal')) require(`${__hooks}/lib_interactions.js`).touchDeal(t, r.getString('deal'));
        names.push(r.getString('title'));
      }
      return { summary: (done ? 'Done: ' : 'Reopened: ') + names.join(', ').slice(0, 200), type: 'tasks', id: '' };
    });
    return { tasks: ids.map((id) => work.serializeTask(app, app.findRecordById('tasks', String(id).trim()))) };
  }),
);

routerAdd('POST', '/api/ops/tasks/snooze', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const dates = require(`${__hooks}/lib_dates.js`);
    const who = u.actor(e);
    const r0 = u.byId(app, 'tasks', u.req(p, 'task'));
    if (!r0) throw u.fail(404, 'No task ' + u.str(p, 'task', ''));
    const until = u.str(p, 'until', '') === '' ? '' : dates.parse(u.str(p, 'until', ''), 'until');
    require(`${__hooks}/lib_activity.js`).run(app, who, 'tasks.snooze', (t) => {
      const r = t.findRecordById('tasks', r0.id);
      r.set('snoozed_until', until);
      t.save(r);
      return { summary: until ? 'Snoozed "' + r.getString('title') + '" until ' + until : 'Unsnoozed "' + r.getString('title') + '"', type: 'tasks', id: '' };
    });
    return { task: work.serializeTask(app, app.findRecordById('tasks', r0.id)) };
  }),
);

routerAdd('POST', '/api/ops/tasks/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const r0 = u.byId(app, 'tasks', u.req(p, 'task'));
    if (!r0) throw u.fail(404, 'No task ' + u.str(p, 'task', ''));
    if (who.actor === 'agent' && r0.getString('by') !== 'agent') throw u.fail(403, "Only the person deletes their tasks; complete it or leave a note");
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'tasks.delete', (t) => {
      const r = t.findRecordById('tasks', r0.id);
      t.delete(r);
      return { summary: 'Deleted the task "' + r.getString('title') + '"', type: r.getString('person') ? 'people' : r.getString('company') ? 'companies' : 'deals', id: r.getString('person') || r.getString('company') || r.getString('deal') || r.id, result: { deleted: true } };
    });
  }),
);

/* ----------------------------------------------------------------- emails */

routerAdd('GET', '/api/ops/emails/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const t = work.targets(app, p);
    const parts = [];
    const prm = {};
    for (const k of ['person', 'deal'])
      if (t[k]) {
        parts.push(k + ' = {:' + k + '}');
        prm[k] = t[k];
      }
    const st = u.oneOf(p, 'status', ['draft', 'queued', 'sending', 'sent', 'failed'], '');
    if (st) {
      parts.push('status = {:st}');
      prm.st = st;
    }
    const rows = app.findRecordsByFilter('emails', parts.join(' && ') || 'id != ""', '-created', u.int(p, 'limit', 100, 1, 500), 0, prm);
    return { emails: rows.map((r) => work.serializeEmail(app, r)) };
  }),
);

routerAdd('POST', '/api/ops/emails/draft', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const review = require(`${__hooks}/lib_review.js`);
    const setup = require(`${__hooks}/lib_setup.js`);
    const who = u.actor(e);
    const send = u.bool(p, 'send', false);
    let prop = null;
    const id = require(`${__hooks}/lib_activity.js`).run(app, who, 'emails.draft', (t) => {
      const m = work.draft(t, who, p);
      if (send) {
        if (setup.mustPropose(t, who, 'email')) prop = review.create(t, who, { kind: 'email', object: 'emails', target: m.id, title: 'Send "' + (m.getString('subject') || '(no subject)') + '" to ' + m.getString('to'), changes: [], payload: { op: 'emails.send', email: m.id }, meta: review.metaOf(p) });
        else work.queueEmail(t, m);
      }
      return { summary: 'Drafted "' + (m.getString('subject') || '(no subject)') + '"' + (m.getString('to') ? ' to ' + m.getString('to') : ''), type: m.getString('person') ? 'people' : m.getString('deal') ? 'deals' : 'emails', id: m.getString('person') || m.getString('deal') || m.id, result: m.id };
    });
    if (send && !prop) require(`${__hooks}/lib_agent.js`).nudge(app, 'emails');
    return { email: work.serializeEmail(app, app.findRecordById('emails', id)), proposed: !!prop, proposal: prop ? review.serialize(app, prop) : null };
  }),
);

routerAdd('POST', '/api/ops/emails/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const who = u.actor(e);
    const m0 = u.byId(app, 'emails', u.req(p, 'email'));
    if (!m0) throw u.fail(404, 'No email ' + u.str(p, 'email', ''));
    if (m0.getString('status') !== 'draft' && m0.getString('status') !== 'failed') throw u.fail(409, 'Only drafts change');
    require(`${__hooks}/lib_activity.js`).run(app, who, 'emails.update', (t) => {
      const m = t.findRecordById('emails', m0.id);
      if (u.has(p, 'to')) m.set('to', work.addresses(u.str(p, 'to', ''), 'to', false));
      if (u.has(p, 'cc')) m.set('cc', work.addresses(u.str(p, 'cc', ''), 'cc', false));
      if (u.has(p, 'subject')) m.set('subject', u.squash(u.str(p, 'subject', '')).slice(0, 300));
      if (u.has(p, 'body')) m.set('body', u.text(p, 'body', '').slice(0, 20000));
      if (m.getString('status') === 'failed') m.set('status', 'draft');
      t.save(m);
      return { summary: 'Edited the draft "' + (m.getString('subject') || '(no subject)') + '"', type: m.getString('person') ? 'people' : m.getString('deal') ? 'deals' : 'emails', id: m.getString('person') || m.getString('deal') || m.id, merge: true };
    });
    return { email: work.serializeEmail(app, app.findRecordById('emails', m0.id)) };
  }),
);

routerAdd('POST', '/api/ops/emails/send', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const review = require(`${__hooks}/lib_review.js`);
    const setup = require(`${__hooks}/lib_setup.js`);
    const who = u.actor(e);
    const m0 = u.byId(app, 'emails', u.req(p, 'email'));
    if (!m0) throw u.fail(404, 'No email ' + u.str(p, 'email', ''));
    let prop = null;
    require(`${__hooks}/lib_activity.js`).run(app, who, 'emails.send', (t) => {
      const m = t.findRecordById('emails', m0.id);
      if (setup.mustPropose(t, who, 'email')) {
        prop = review.create(t, who, { kind: 'email', object: 'emails', target: m.id, title: 'Send "' + (m.getString('subject') || '(no subject)') + '" to ' + m.getString('to'), changes: [], payload: { op: 'emails.send', email: m.id }, meta: review.metaOf(p) });
        return { summary: '' };
      }
      work.queueEmail(t, m);
      return { summary: 'Sent "' + (m.getString('subject') || '(no subject)') + '" to ' + m.getString('to') + ' (through your AI agent)', type: m.getString('person') ? 'people' : m.getString('deal') ? 'deals' : 'emails', id: m.getString('person') || m.getString('deal') || m.id };
    });
    let asked = false;
    if (!prop) {
      const f = require(`${__hooks}/lib_agent.js`).nudge(app, 'emails');
      asked = f.fired === true || f.reason === 'already asked';
    }
    return { email: work.serializeEmail(app, app.findRecordById('emails', m0.id)), proposed: !!prop, proposal: prop ? review.serialize(app, prop) : null, asked: asked };
  }),
);

routerAdd('POST', '/api/ops/emails/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const m = u.byId(app, 'emails', u.req(p, 'email'));
    if (!m) throw u.fail(404, 'No email ' + u.str(p, 'email', ''));
    require(`${__hooks}/lib_agent.js`).start(app, 'emails', m);
    return { email: require(`${__hooks}/lib_work.js`).serializeEmail(app, m) };
  }),
);

routerAdd('POST', '/api/ops/emails/sent', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const work = require(`${__hooks}/lib_work.js`);
    const who = u.actor(e);
    const m0 = u.byId(app, 'emails', u.req(p, 'email'));
    if (!m0) throw u.fail(404, 'No email ' + u.str(p, 'email', ''));
    const st = m0.getString('status');
    if (st !== 'queued' && st !== 'sending') throw u.fail(409, 'This email is ' + st + '; only queued emails are sent');
    require(`${__hooks}/lib_activity.js`).run(app, who, 'emails.sent', (t) => {
      const m = t.findRecordById('emails', m0.id);
      work.markSent(t, who, m);
      return { summary: 'Sent "' + (m.getString('subject') || '(no subject)') + '" to ' + m.getString('to'), type: m.getString('person') ? 'people' : m.getString('deal') ? 'deals' : 'emails', id: m.getString('person') || m.getString('deal') || m.id, undoable: false };
    });
    return { email: work.serializeEmail(app, app.findRecordById('emails', m0.id)) };
  }),
);

routerAdd('POST', '/api/ops/emails/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const m = u.byId(app, 'emails', u.req(p, 'email'));
    if (!m) throw u.fail(404, 'No email ' + u.str(p, 'email', ''));
    m.set('status', 'failed');
    m.set('error', u.text(p, 'reason', 'Could not send').slice(0, 1000));
    app.save(m);
    return { email: require(`${__hooks}/lib_work.js`).serializeEmail(app, m) };
  }),
);

routerAdd('POST', '/api/ops/emails/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const m0 = u.byId(app, 'emails', u.req(p, 'email'));
    if (!m0) throw u.fail(404, 'No email ' + u.str(p, 'email', ''));
    if (m0.getString('status') === 'sent') throw u.fail(409, 'A sent email stays on the record');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'emails.delete', (t) => {
      const m = t.findRecordById('emails', m0.id);
      for (const pr of t.findRecordsByFilter('proposals', "target = {:id} && status = 'pending'", '', 0, 0, { id: m.id })) {
        pr.set('status', 'rejected');
        pr.set('decided_at', new Date().toISOString());
        t.save(pr);
      }
      t.delete(m);
      return { summary: 'Deleted the draft "' + (m.getString('subject') || '(no subject)') + '"', type: m.getString('person') ? 'people' : m.getString('deal') ? 'deals' : 'emails', id: m.getString('person') || m.getString('deal') || m.id, result: { deleted: true } };
    });
  }),
);

/* -------------------------------------------------- the AI agent's queues */

routerAdd('POST', '/api/ops/research/queue', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const q = require(`${__hooks}/lib_query.js`);
    const lim = u.int(p, 'limit', 20, 1, 100);
    const out = { people: [], companies: [] };
    for (const c of ['people', 'companies']) {
      for (const r of app.findRecordsByFilter(c, "agent_state = 'waiting' && deleted = ''", 'updated', lim, 0)) {
        agent.start(app, 'research', r);
        out[c].push(Object.assign(q.one(app, c, r), { research_note: r.getString('agent_note') }));
      }
    }
    out.remaining_after = app.countRecords('people', $dbx.hashExp({ agent_state: 'waiting', deleted: '' })) + app.countRecords('companies', $dbx.hashExp({ agent_state: 'waiting', deleted: '' }));
    out.fields = { people: require(`${__hooks}/lib_records.js`).fieldMap(app, 'people'), companies: require(`${__hooks}/lib_records.js`).fieldMap(app, 'companies') };
    return out;
  }),
);

routerAdd('POST', '/api/ops/research/done', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const id = u.req(p, 'id');
    const r = u.byId(app, 'people', id) || u.byId(app, 'companies', id);
    if (!r) throw u.fail(404, 'No person or company ' + id);
    r.set('agent_state', u.bool(p, 'failed', false) ? 'failed' : 'done');
    r.set('agent_note', u.text(p, 'note', u.text(p, 'reason', '')).slice(0, 500));
    app.save(r);
    return { id: r.id, state: r.getString('agent_state') };
  }),
);

routerAdd('POST', '/api/ops/research/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const id = u.req(p, 'id');
    const r = u.byId(app, 'people', id) || u.byId(app, 'companies', id);
    if (!r) throw u.fail(404, 'No person or company ' + id);
    r.set('agent_state', 'failed');
    r.set('agent_note', u.text(p, 'reason', 'Could not research').slice(0, 500));
    app.save(r);
    return { id: r.id, state: 'failed' };
  }),
);

routerAdd('POST', '/api/ops/meetings/queue', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const ix = require(`${__hooks}/lib_interactions.js`);
    const q = require(`${__hooks}/lib_query.js`);
    const out = [];
    for (const r of app.findRecordsByFilter('interactions', "agent_state = 'waiting'", 'at', u.int(p, 'limit', 10, 1, 50), 0)) {
      agent.start(app, 'meetings', r);
      const item = ix.serialize(app, r);
      if (r.getString('deal')) {
        const d = u.byId(app, 'deals', r.getString('deal'));
        if (d) item.deal_detail = q.one(app, 'deals', d);
      }
      const open = {};
      for (const pid of r.getStringSlice('people'))
        for (const dp of app.findRecordsByFilter('deal_people', 'person = {:p}', '', 0, 0, { p: pid })) {
          const d = u.byId(app, 'deals', dp.getString('deal'));
          if (d && d.getString('status') === 'open' && d.getString('deleted') === '') open[d.id] = q.one(app, 'deals', d);
        }
      item.open_deals = Object.keys(open).map((k) => open[k]);
      out.push(item);
    }
    return { interactions: out, pipelines: require(`${__hooks}/lib_deals.js`).pipelines(app, false) };
  }),
);

routerAdd('POST', '/api/ops/meetings/done', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const r = u.byId(app, 'interactions', u.req(p, 'interaction'));
    if (!r) throw u.fail(404, 'No interaction ' + u.str(p, 'interaction', ''));
    r.set('agent_state', u.bool(p, 'failed', false) ? 'failed' : 'done');
    r.set('agent_note', u.text(p, 'note', '').slice(0, 500));
    app.save(r);
    return { interaction: require(`${__hooks}/lib_interactions.js`).serialize(app, r) };
  }),
);
