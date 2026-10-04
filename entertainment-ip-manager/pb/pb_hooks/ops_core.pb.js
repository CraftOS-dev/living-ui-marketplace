/// <reference path="../pb_data/types.d.ts" />
/**
 * Core verbs: session check, meta, onboarding, summary, search, events and
 * deadlines on any record, rules test, calendar feed, digest and reports.
 * Every route has an operations.json entry (GET /api/_ops lists them).
 *
 * GOJA RULE: each handler runs in an isolated VM. require() every library
 * INSIDE the handler; file-scope helpers are invisible at request time.
 */

// Is a stored session still known here? Token in X-Session-Token (a dead
// Authorization token is refused with 401 before any route runs), so this
// always answers 200 and the app can drop a stale token first.
routerAdd('GET', '/api/session/check', (e) => {
  let id = '';
  const token = String(e.request.header.get('X-Session-Token') || '');
  if (token !== '') {
    try {
      const rec = e.app.findAuthRecordByToken(token, 'auth');
      if (rec && rec.collection().name === 'users') id = rec.id;
    } catch {
      id = '';
    }
  }
  return e.json(200, { valid: id !== '', id: id });
});

routerAdd('GET', '/api/ops/meta', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const offices = require(`${__hooks}/lib_offices.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const lic = require(`${__hooks}/lib_licensing.js`);
  if (u.deny(e, 'auth')) return;
  const state = offices.connectionState(e.app);
  const admin = u.roleOf(e.auth) === 'admin';
  const publicState = {};
  for (const k of Object.keys(state)) {
    publicState[k] = admin ? state[k] : { enabled: state[k].enabled, status: state[k].status, last_sync: state[k].last_sync };
  }
  const s = u.settings(e.app);
  return e.json(200, {
    event_codes: engine.EVENT_CODES,
    subjects: Object.keys(engine.SUBJECTS),
    status_group: engine.STATUS_GROUP,
    offices: u.isExternal(e.auth) ? {} : publicState,
    office_labels: offices.OFFICE_LABEL,
    approval_stages: lic.STAGE_ORDER,
    reports: reports.REPORTS,
    profiles: s ? u.j(s, 'profiles', []) : [],
    modules: s ? u.j(s, 'modules', {}) : {},
    role: u.roleOf(e.auth),
    language: u.langOfAuth(e.app, e.auth),
    today: u.today(),
  });
});

routerAdd('POST', '/api/ops/onboarding', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'admin', (b, ctx) => {
    const u = ctx.u;
    const s = u.settings(e.app);
    if (s === null) throw u.err('Settings record missing.', '設定が見つかりません。');
    const name = String(b.org_name || '').trim();
    if (!name) throw u.err('Enter the organization name.', '組織名を入力してください。');
    const profiles = u.asArray(b.profiles).filter((p) => ['anime', 'talent', 'character'].indexOf(p) >= 0);
    if (!profiles.length) throw u.err('Choose at least one kind of business.', '事業の種類を1つ以上選んでください。');
    const cur = String(b.home_currency || 'JPY').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw u.err('Home currency must be a 3-letter code such as JPY, USD or EUR.', '基準通貨はJPY・USD・EURのような3文字のコードで入力してください。');
    const lang = b.default_language === 'en' ? 'en' : 'ja';
    const MAP = {
      anime: ['titles', 'committees', 'franchises', 'music', 'products', 'royalties', 'approvals'],
      talent: ['talents', 'permissions', 'guidelines', 'music', 'products', 'royalties', 'approvals'],
      character: ['franchises', 'guidelines', 'products', 'royalties', 'approvals', 'music'],
    };
    const modules = {};
    for (const k of ['titles', 'committees', 'franchises', 'talents', 'permissions', 'guidelines', 'music', 'products', 'royalties', 'approvals']) modules[k] = false;
    for (const p of profiles) for (const k of MAP[p]) modules[k] = true;
    s.set('org_name', name);
    s.set('profiles', profiles);
    s.set('modules', modules);
    s.set('home_currency', cur);
    s.set('default_language', lang);
    const jur = u.asArray(b.jurisdictions).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
    if (jur.length) s.set('jurisdictions', jur);
    s.set('onboarding_done', true);
    e.app.save(s);
    // The admin reads the app in the language chosen for the organization unless they set their own.
    if (ctx.actor) {
      const me = u.byId(e.app, 'users', ctx.actor);
      if (me && !me.getString('ui_language')) {
        me.set('ui_language', lang);
        e.app.save(me);
      }
    }
    u.audit(e.app, ctx.actor, 'update', 'settings', s.id, 'Organization setup', { org_name: name, profiles: profiles, home_currency: cur }, '');
    let rates = false;
    if (s.getBool('fx_auto')) {
      try {
        require(`${__hooks}/lib_fx.js`).refreshEcb(e.app);
        rates = true;
      } catch (err) {
        console.error('ECB rates at setup failed (the hourly job retries):', err);
      }
    }
    return { ok: true, modules: modules, rates: rates };
  }),
);

routerAdd('POST', '/api/ops/settings/modules', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'admin', (b, ctx) => {
    const u = ctx.u;
    const s = u.settings(e.app);
    const cur = u.j(s, 'modules', {});
    const next = u.asObject(b.modules);
    for (const k of Object.keys(next)) cur[k] = next[k] === true || next[k] === 'true';
    s.set('modules', cur);
    if (b.profiles !== undefined) s.set('profiles', u.asArray(b.profiles));
    e.app.save(s);
    u.audit(e.app, ctx.actor, 'update', 'settings', s.id, 'Modules', { modules: cur }, '');
    return { modules: cur };
  }),
);

routerAdd('POST', '/api/ops/summary', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => require(`${__hooks}/lib_reports.js`).summary(e.app, ctx.actor)),
);

routerAdd('POST', '/api/ops/search', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => ({ results: require(`${__hooks}/lib_reports.js`).search(e.app, String(b.q || ''), Number(b.limit || 25)) })),
);

/* ------------------------------------------------------------------ */
/* Events on any record                                                */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/events/preview', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const ops = require(`${__hooks}/lib_ops.js`);
    const engine = require(`${__hooks}/lib_engine.js`);
    const u = ctx.u;
    const subject = ops.subjectFrom(e.app, b);
    const code = String(b.code || '');
    if (!engine.EVENT_CODES[code]) throw u.err('Unknown event code: ' + code, '不明なイベントコード：' + code);
    const date = u.d10(b.date);
    if (!date) throw u.err('Enter the event date.', 'イベントの日付を入力してください。');
    return { proposals: engine.proposalsFor(e.app, subject, { code: code, date: date, data: u.asObject(b.data) }) };
  }),
);

routerAdd('POST', '/api/ops/events/record', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const ops = require(`${__hooks}/lib_ops.js`);
    const engine = require(`${__hooks}/lib_engine.js`);
    const u = ctx.u;
    const subject = ops.subjectFrom(e.app, b);
    const code = String(b.code || '');
    const def = engine.EVENT_CODES[code];
    if (!def) throw u.err('Unknown event code: ' + code, '不明なイベントコード：' + code);
    if (def.subjects.indexOf(subject.type) < 0) throw u.err(code + ' cannot be recorded on a ' + subject.type + '.', 'このイベントはこの種類の記録には登録できません。');
    const date = u.d10(b.date);
    if (!date) throw u.err('Enter the event date.', 'イベントの日付を入力してください。');
    const res = engine.recordEvent(e.app, subject, code, date, {
      label: b.label ? String(b.label) : '',
      data: u.asObject(b.data),
      source: 'manual',
      actorId: ctx.actor,
      documentId: b.document_id ? String(b.document_id) : '',
      select: b.select ? u.asArray(b.select) : undefined,
      skip: b.skip ? u.asArray(b.skip) : undefined,
      assignees: b.assignees ? u.asArray(b.assignees) : undefined,
      commit: b.commit !== false && b.commit !== 'false',
    });
    return {
      event_id: res.event.id,
      created: res.created.map((r) => ({ id: r.id, title: r.getString('title'), title_ja: r.getString('title_ja'), due_date: u.d10(r.getString('due_date')) })),
      proposals: res.proposals,
    };
  }),
);

routerAdd('POST', '/api/ops/events/regenerate', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const b = u.body(e);
  const apply = b.apply === true || b.apply === 'true';
  return require(`${__hooks}/lib_ops.js`).handle(e, apply ? 'edit' : 'read', (body, ctx) => {
    const ops = require(`${__hooks}/lib_ops.js`);
    const engine = require(`${__hooks}/lib_engine.js`);
    return engine.regenerate(e.app, ops.subjectFrom(e.app, body), apply, ctx.actor);
  });
});

/* ------------------------------------------------------------------ */
/* Deadlines                                                           */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/deadlines/create', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const ops = require(`${__hooks}/lib_ops.js`);
    const engine = require(`${__hooks}/lib_engine.js`);
    const u = ctx.u;
    const title = String(b.title || '').trim();
    if (!title) throw u.err('Give the deadline a title.', '期限の件名を入力してください。');
    const due = u.d10(b.due_date);
    if (!due) throw u.err('Enter the due date.', '期限日を入力してください。');
    const data = {
      title: title,
      title_ja: String(b.title_ja || title),
      kind: ['hard', 'extendable', 'designated', 'internal', 'reminder'].indexOf(b.kind) >= 0 ? b.kind : 'internal',
      category: String(b.category || 'other'),
      status: 'open',
      due_date: u.toPb(due),
      final_date: u.toPb(b.final_date),
      source: 'manual',
      assignee: String(b.assignee || ''),
      notes: String(b.notes || ''),
      citation: String(b.citation || ''),
      calculation: { steps: [u.bi('Entered by ' + u.userLabel(e.app, ctx.actor) + ' on ' + u.human(u.today()) + '.', u.humanJa(u.today()) + 'に' + u.userLabel(e.app, ctx.actor) + 'が入力。')] },
    };
    if (b.subject_type || b.subject_id || Object.keys(b).some((k) => /_id$/.test(k) && b[k])) {
      try {
        const s = ops.subjectFrom(e.app, b);
        data[engine.SUBJECTS[s.type].field] = s.id;
      } catch {
        /* a free-standing deadline is allowed */
      }
    }
    const rec = u.newRecord(e.app, 'deadlines', data);
    e.app.save(rec);
    return { id: rec.id };
  }),
);

routerAdd('POST', '/api/ops/deadlines/close', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const engine = require(`${__hooks}/lib_engine.js`);
    const u = ctx.u;
    const ids = u.asArray(b.ids || b.id);
    const status = String(b.status || 'done');
    const results = [];
    let ok = 0;
    for (const id of ids) {
      const dl = u.byId(e.app, 'deadlines', String(id));
      if (dl === null) {
        results.push({ id: id, error: 'Not found' });
        continue;
      }
      try {
        const r = engine.closeDeadline(e.app, dl, status, String(b.reason || ''), ctx.actor, u.d10(b.closed_on) || u.today());
        results.push({ id: id, ok: true, next: r.next ? { id: r.next.id, title: r.next.getString('title'), title_ja: r.next.getString('title_ja'), due_date: u.d10(r.next.getString('due_date')) } : null });
        ok += 1;
      } catch (err) {
        results.push({ id: id, error: String(err.message || err), error_ja: err.ja || '' });
      }
    }
    if (ok === 0 && results.length) throw u.err(results[0].error, results[0].error_ja || results[0].error);
    return { closed: ok, results: results };
  }),
);

routerAdd('POST', '/api/ops/deadlines/extend', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const preview = u.body(e).preview === true || u.body(e).preview === 'true';
  return require(`${__hooks}/lib_ops.js`).handle(e, preview ? 'read' : 'edit', (b, ctx) => {
    const engine = require(`${__hooks}/lib_engine.js`);
    const dl = require(`${__hooks}/lib_ops.js`).need(e.app, 'deadlines', b.id, 'Deadline', '期限');
    if (dl.getString('status') !== 'open') throw ctx.u.err('Only open deadlines can be extended.', '未完了の期限のみ延長できます。');
    return engine.extendDeadline(e.app, dl, Number(b.level || 1), ctx.actor, preview);
  });
});

routerAdd('POST', '/api/ops/deadlines/reassign', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const assignee = String(b.assignee || '');
    if (assignee && u.byId(e.app, 'users', assignee) === null) throw u.err('That person does not have an account.', 'その人のアカウントがありません。');
    let n = 0;
    for (const id of u.asArray(b.ids)) {
      const dl = u.byId(e.app, 'deadlines', String(id));
      if (dl === null) continue;
      const before = dl.getString('assignee');
      dl.set('assignee', assignee);
      e.app.save(dl);
      u.audit(e.app, ctx.actor, 'update', 'deadlines', dl.id, dl.getString('title'), { assignee: { from: before, to: assignee } }, 'Reassigned');
      n += 1;
    }
    if (assignee && n > 0 && assignee !== ctx.actor) {
      u.notify(
        e.app,
        assignee,
        'assignment',
        u.bi(n === 1 ? 'A deadline was assigned to you' : n + ' deadlines were assigned to you', n === 1 ? '期限が割り当てられました' : '期限が' + n + '件割り当てられました'),
        u.bi('Assigned by ' + u.userLabel(e.app, ctx.actor) + '.', u.userLabel(e.app, ctx.actor) + 'が割り当て。'),
        '#/deadlines',
        {},
      );
    }
    return { updated: n };
  }),
);

routerAdd('POST', '/api/ops/deadlines/move', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const preview = u.body(e).preview === true || u.body(e).preview === 'true';
  return require(`${__hooks}/lib_ops.js`).handle(e, preview ? 'read' : 'edit', (b, ctx) => {
    const days = Number(b.days || 0);
    const date = u.d10(b.date);
    if (!days && !date) throw u.err('Give a number of days or a new date.', '日数または新しい日付を指定してください。');
    if (!preview && String(b.reason || '').trim() === '') throw u.err('Give a reason for moving the dates.', '日付を変更する理由を入力してください。');
    const buffer = Number(u.setting(e.app, 'target_buffer_days', 14)) || 0;
    const out = [];
    for (const id of u.asArray(b.ids)) {
      const dl = u.byId(e.app, 'deadlines', String(id));
      if (dl === null || dl.getString('status') !== 'open') continue;
      const from = u.d10(dl.getString('due_date'));
      const to = date || u.addDays(from, days);
      const fin = u.d10(dl.getString('final_date'));
      out.push({ id: dl.id, title: dl.getString('title'), title_ja: dl.getString('title_ja'), from: from, to: to, final: fin, past_final: fin !== '' && to > fin });
      if (preview) continue;
      const calc = u.j(dl, 'calculation', {});
      const steps = Array.isArray(calc.steps) ? calc.steps.slice() : [];
      const who = u.userLabel(e.app, ctx.actor);
      steps.push(u.bi(
        'Moved by ' + who + ' on ' + u.human(u.today()) + ' from ' + u.human(from) + ' to ' + u.human(to) + ': ' + String(b.reason) + '. Locked against recalculation.',
        u.humanJa(u.today()) + 'に' + who + 'が' + u.humanJa(from) + 'から' + u.humanJa(to) + 'へ変更：' + String(b.reason) + '。再計算の対象外にしました。',
      ));
      calc.steps = steps;
      dl.set('calculation', calc);
      dl.set('due_date', u.toPb(to));
      const kind = dl.getString('kind');
      dl.set('target_date', u.toPb(kind === 'hard' || kind === 'extendable' || kind === 'designated' ? u.addDays(to, -buffer) : to));
      dl.set('locked', true);
      e.app.save(dl);
      u.audit(e.app, ctx.actor, 'move', 'deadlines', dl.id, dl.getString('title'), { from: from, to: to }, String(b.reason));
    }
    return { moves: out };
  });
});

routerAdd('POST', '/api/ops/deadlines/upcoming', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const u = ctx.u;
    const days = Math.min(730, Math.max(1, Number(b.days || 30)));
    const today = u.today();
    let filter = 'status = "open" && due_date <= {:h}';
    if (!(b.include_overdue === true || b.include_overdue === 'true')) filter += ' && due_date >= {:t}';
    const params = { h: u.toPb(u.addDays(today, days)), t: u.toPb(today) };
    if (b.assignee_email) {
      const usr = u.findOne(e.app, 'users', 'email = {:m}', { m: String(b.assignee_email) });
      if (usr === null) throw u.err('No account with that email.', 'そのメールアドレスのアカウントはありません。');
      filter += ' && assignee = {:a}';
      params.a = usr.id;
    }
    if (b.category) {
      filter += ' && category = {:c}';
      params.c = String(b.category);
    }
    if (b.jurisdiction) {
      filter += ' && jurisdiction = {:j}';
      params.j = String(b.jurisdiction).toUpperCase();
    }
    return {
      deadlines: u.findMany(e.app, 'deadlines', filter, 'due_date', 500, params).map((d) => ({
        id: d.id,
        ref: d.getString('ref'),
        subject: d.getString('subject_label'),
        title: d.getString('title'),
        title_ja: d.getString('title_ja'),
        kind: d.getString('kind'),
        category: d.getString('category'),
        jurisdiction: d.getString('jurisdiction'),
        due_date: u.d10(d.getString('due_date')),
        final_date: u.d10(d.getString('final_date')),
        days_left: u.diffDays(today, u.d10(d.getString('due_date'))),
        assignee: d.getString('assignee') ? u.userLabel(e.app, d.getString('assignee')) : '',
        citation: d.getString('citation'),
      })),
    };
  }),
);

routerAdd('POST', '/api/ops/deadlines/explain', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const u = ctx.u;
    const dl = require(`${__hooks}/lib_ops.js`).need(e.app, 'deadlines', b.id, 'Deadline', '期限');
    const calc = u.j(dl, 'calculation', {});
    let extensions = [];
    if (dl.getString('rule')) {
      const rr = u.byId(e.app, 'rules', dl.getString('rule'));
      if (rr !== null) extensions = u.j(rr, 'extensions', []);
    }
    return {
      id: dl.id,
      extensions: extensions,
      extension_level: dl.getInt('extension_level'),
      title: dl.getString('title'),
      title_ja: dl.getString('title_ja'),
      due_date: u.d10(dl.getString('due_date')),
      target_date: u.d10(dl.getString('target_date')),
      final_date: u.d10(dl.getString('final_date')),
      grace_end: u.d10(dl.getString('grace_end')),
      source: dl.getString('source'),
      rule_code: dl.getString('rule_code'),
      citation: dl.getString('citation'),
      locked: dl.getBool('locked'),
      steps: calc.steps || [],
    };
  }),
);

/* ------------------------------------------------------------------ */
/* Rules, calendars, calendar feed                                     */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/rules/test', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const engine = require(`${__hooks}/lib_engine.js`);
    const u = ctx.u;
    const rr = require(`${__hooks}/lib_ops.js`).need(e.app, 'rules', b.rule_id, 'Rule', 'ルール');
    const rule = engine.ruleObj(rr);
    const base = u.d10(b.base_date);
    if (!base) throw u.err('Enter a sample date.', 'サンプルの日付を入力してください。');
    const fields = {
      filing_date: u.toPb(u.d10(b.filing_date) || base),
      registration_date: u.toPb(u.d10(b.registration_date) || base),
      publication_date: u.toPb(u.d10(b.publication_date) || base),
      priority_claims: '[]',
      signed_date: u.toPb(base),
      term_end: u.toPb(base),
      graduation_date: u.toPb(base),
      debut_date: u.toPb(base),
      valid_until: u.toPb(base),
      end_date: u.toPb(base),
      documents_valid_until: u.toPb(base),
      expiry_date: '',
      tm_register: '',
      options: '{}',
      relation: 'none',
      parent: '',
      route: String(b.route || ''),
      ip_type: rule.subject_type,
    };
    const shim = {
      id: 'test',
      getString: (f) => (fields[f] !== undefined ? fields[f] : ''),
      getInt: () => 0,
      getBool: () => false,
      getStringSlice: () => [],
      get: (f) => (fields[f] !== undefined ? fields[f] : null),
    };
    const jur = String(b.jurisdiction || (rule.jurisdiction === '*' ? 'JP' : rule.jurisdiction)).toUpperCase();
    const types = { trademark: 'matter', design: 'matter' };
    const type = types[rule.subject_type] || rule.subject_type;
    const subject = { type: type, id: 'test', record: shim, subject_type: rule.subject_type, jurisdiction: jur, route: String(b.route || ''), label: 'Test' };
    const buffer = Number(u.setting(e.app, 'target_buffer_days', 14)) || 0;
    const cycle = rule.every > 0 ? Number(b.cycle || rule.first) : 0;
    const c = engine.computeRule(e.app, rule, subject, base, cycle, u.asObject(b.overrides), buffer, { jurisdiction: jur });
    if (c === null) throw u.err('This rule needs a base date that the sample does not provide.', 'このルールにはサンプルにない起算日が必要です。');
    return c;
  }),
);

routerAdd('POST', '/api/ops/calendars/refresh', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'manage', (b, ctx) => {
    const u = ctx.u;
    const cal = require(`${__hooks}/lib_calendar.js`);
    const out = {};
    const year = Number(b.year || new Date().getFullYear());
    const offices = b.office ? [String(b.office).toUpperCase()] : ['US', 'EM', 'JP', 'WO'];
    for (const o of offices) {
      if (['CN', 'KR', 'TW'].indexOf(o) >= 0) {
        out[o] = 'Official list only: add or edit days in Settings, Office closure days.';
        continue;
      }
      for (const r of u.findMany(e.app, 'office_calendars', 'office = {:o} && source = "computed" && date >= {:a} && date <= {:b}', '', 0, { o: o, a: year + '-01-01 00:00:00.000Z', b: year + '-12-31 23:59:59.999Z' })) {
        e.app.delete(r);
      }
      const marker = u.findOne(e.app, 'calendar_years', 'office = {:o} && year = {:y}', { o: o, y: year });
      if (marker !== null) e.app.delete(marker);
      cal.ensureCalendar(e.app, o, year);
      out[o] = 'regenerated';
    }
    if (offices.indexOf('JP') >= 0) {
      try {
        out.JP_official = cal.refreshJapanOfficial(e.app);
      } catch (err) {
        out.JP_official = { error: String(err.message || err) };
      }
    }
    return out;
  }),
);

routerAdd('POST', '/api/ops/calendars/business-days', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const cal = require(`${__hooks}/lib_calendar.js`);
    const u = ctx.u;
    const from = u.d10(b.from) || u.today();
    return cal.addBusinessDays(e.app, String(b.office || u.setting(e.app, 'work_calendar', 'JP')), from, Number(b.days || 0));
  }),
);

routerAdd('POST', '/api/ops/calendar/feed', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const u = ctx.u;
    if (!ctx.actor) throw u.err('Calendar feeds belong to a person account.', 'カレンダー配信は個人アカウントに紐づきます。');
    let t = u.findOne(e.app, 'ics_tokens', 'user = {:u}', { u: ctx.actor });
    const current = t !== null ? t.getString('scope') || 'mine' : 'mine';
    const wanted = b.scope === 'all' || b.scope === 'mine' ? b.scope : current;
    const scope = wanted === 'all' && u.canEdit(e.auth) ? 'all' : 'mine';
    if (t === null || b.rotate === true || b.rotate === 'true') {
      if (t !== null) e.app.delete(t);
      t = u.newRecord(e.app, 'ics_tokens', { user: ctx.actor, token: u.randomToken(40), scope: scope });
    }
    t.set('scope', scope);
    e.app.save(t);
    return { path: '/api/ics/' + t.getString('token'), scope: scope };
  }),
);

routerAdd('GET', '/api/ics/{token}', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const digest = require(`${__hooks}/lib_digest.js`);
  const token = String(e.request.pathValue('token') || '').replace(/\.ics$/, '');
  const t = token.length >= 20 ? u.findOne(e.app, 'ics_tokens', 'token = {:t}', { t: token }) : null;
  if (t === null) return e.json(404, { error: 'Unknown calendar feed.' });
  const body = digest.buildIcs(e.app, t.getString('user'), t.getString('scope'));
  e.response.header().set('Content-Type', 'text/calendar; charset=utf-8');
  e.response.header().set('Cache-Control', 'no-store');
  return e.string(200, body);
});

/* ------------------------------------------------------------------ */
/* Digest and reports                                                  */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/digest/preview', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    if (!ctx.actor) throw ctx.u.err('Digests belong to a person account.', 'ダイジェストは個人アカウントに紐づきます。');
    return require(`${__hooks}/lib_digest.js`).buildDigest(e.app, e.auth, Number(b.days || 45));
  }),
);

routerAdd('POST', '/api/ops/digest/send', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'manage', () => require(`${__hooks}/lib_digest.js`).runDigest(e.app, true)),
);

routerAdd('POST', '/api/ops/reports/run', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const name = String(u.body(e).report || '');
  return require(`${__hooks}/lib_ops.js`).handle(e, name === 'audit' ? 'edit' : 'read', (b, ctx) =>
    require(`${__hooks}/lib_reports.js`).runReport(e.app, name, u.asObject(b.params), b.lang === 'en' || b.lang === 'ja' ? b.lang : ctx.lang),
  );
});
