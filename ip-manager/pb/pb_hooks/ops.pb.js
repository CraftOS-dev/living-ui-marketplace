/// <reference path="../pb_data/types.d.ts" />
/**
 * IP Manager custom verbs. Every route has a matching operations.json entry
 * so CraftBot (or any agent) can discover it at GET /api/_ops.
 *
 * GOJA RULE: each handler runs in an isolated VM. require() every library
 * INSIDE the handler; file-scope helpers are invisible at request time.
 * Request bodies: e.requestInfo().body (pre-parsed), never e.request.body.
 */

/* ------------------------------------------------------------------ */
/* Meta, onboarding, summary, search                                   */
/* ------------------------------------------------------------------ */

// Is a stored session still known here? The token comes in X-Session-Token,
// not Authorization (a dead Authorization token is refused with 401 before
// any route runs), so this always answers 200 and the app can drop a stale
// token before anything else uses it. It only confirms a token the caller holds.
// Outside /api/ops/ on purpose: the system hook requires a signed-in caller there.
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
  const denied = u.deny(e, 'auth');
  if (denied) return denied;
  const state = offices.connectionState(e.app);
  const admin = u.roleOf(e.auth) === 'admin';
  const publicState = {};
  for (const k of Object.keys(state)) {
    publicState[k] = admin
      ? state[k]
      : { enabled: state[k].enabled, status: state[k].status, last_sync: state[k].last_sync };
  }
  return e.json(200, {
    event_codes: engine.EVENT_CODES,
    status_group: engine.STATUS_GROUP,
    offices: publicState,
    office_labels: offices.OFFICE_LABEL,
    role: u.roleOf(e.auth),
    today: u.today(),
  });
});

routerAdd('POST', '/api/ops/onboarding', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'admin');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const s = u.settings(e.app);
    if (s === null) throw new Error('Settings record missing.');
    const name = String(b.org_name || '').trim();
    if (!name) throw new Error('Enter the organization name.');
    const pack = ['general', 'entertainment', 'technology', 'consumer'].indexOf(b.vocab_pack) >= 0 ? b.vocab_pack : 'general';
    const cur = String(b.home_currency || 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw new Error('Home currency must be a 3-letter ISO code such as USD, EUR or JPY.');
    s.set('org_name', name);
    s.set('vocab_pack', pack);
    s.set('home_currency', cur);
    const jur = u.asArray(b.jurisdictions).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
    if (jur.length) s.set('jurisdictions', jur);
    s.set('onboarding_done', true);
    e.app.save(s);
    // Rights dimensions that fit the vocabulary pack.
    const enabled = {
      entertainment: ['territory', 'media', 'language', 'category'],
      technology: ['territory', 'field_of_use'],
      consumer: ['territory', 'category', 'channel'],
      general: ['territory', 'media', 'category', 'field_of_use'],
    }[pack];
    for (const d of u.findMany(e.app, 'dimensions', '', '', 0)) {
      d.set('enabled', enabled.indexOf(d.getString('key')) >= 0);
      e.app.save(d);
    }
    u.audit(e.app, u.actorId(e), 'update', 'settings', s.id, 'Organization setup', { org_name: name, vocab_pack: pack, home_currency: cur }, '');
    // Exchange rates right away, so costs show in the home currency from the first record.
    let rates = false;
    if (s.getBool('fx_auto')) {
      try {
        const fx = require(`${__hooks}/lib_fx.js`);
        fx.refreshEcb(e.app);
        rates = true;
      } catch (err) {
        console.error('ECB rates at setup failed (the hourly job retries):', err);
      }
    }
    return e.json(200, { ok: true, rates: rates });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/summary', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    return e.json(200, reports.summary(e.app, u.actorId(e)));
  } catch (err) {
    return u.fail(e, err, 500);
  }
});

routerAdd('POST', '/api/ops/search', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  const b = u.body(e);
  try {
    return e.json(200, { results: reports.search(e.app, String(b.q || ''), Number(b.limit || 25)) });
  } catch (err) {
    return u.fail(e, err, 500);
  }
});

/* ------------------------------------------------------------------ */
/* Matters: events, regeneration, office lookup/import/sync            */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/matters/preview-event', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const type = b.subject_type === 'agreement' ? 'agreement' : b.subject_type === 'work' ? 'work' : 'matter';
    const subject = engine.subjectOf(e.app, type, String(b.matter_id || b.subject_id || ''));
    if (subject === null) throw new Error('Record not found.');
    const code = String(b.code || '');
    if (!engine.EVENT_CODES[code]) throw new Error('Unknown event code: ' + code);
    const date = u.d10(b.date);
    if (!date) throw new Error('Enter the event date.');
    const proposals = engine.proposalsFor(e.app, subject, { code: code, date: date, data: u.asObject(b.data) });
    return e.json(200, { proposals: proposals });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/matters/record-event', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const type = b.subject_type === 'agreement' ? 'agreement' : b.subject_type === 'work' ? 'work' : 'matter';
    const subject = engine.subjectOf(e.app, type, String(b.matter_id || b.subject_id || ''));
    if (subject === null) throw new Error('Record not found.');
    const code = String(b.code || '');
    if (!engine.EVENT_CODES[code]) throw new Error('Unknown event code: ' + code);
    const date = u.d10(b.date);
    if (!date) throw new Error('Enter the event date.');
    const res = engine.recordEvent(e.app, subject, code, date, {
      label: b.label ? String(b.label) : '',
      data: u.asObject(b.data),
      source: 'manual',
      actorId: u.actorId(e),
      documentId: b.document_id ? String(b.document_id) : '',
      select: b.select ? u.asArray(b.select) : undefined,
      skip: b.skip ? u.asArray(b.skip) : undefined,
      assignees: b.assignees ? u.asArray(b.assignees) : undefined,
      commit: b.commit !== false,
    });
    return e.json(200, {
      event_id: res.event.id,
      created: res.created.map((r) => ({ id: r.id, title: r.getString('title'), due_date: u.d10(r.getString('due_date')) })),
      proposals: res.proposals,
    });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/matters/regenerate', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const b = u.body(e);
  const denied = u.deny(e, b.apply ? 'edit' : 'read');
  if (denied) return denied;
  try {
    const type = b.subject_type === 'agreement' ? 'agreement' : b.subject_type === 'work' ? 'work' : 'matter';
    const subject = engine.subjectOf(e.app, type, String(b.matter_id || b.subject_id || ''));
    if (subject === null) throw new Error('Record not found.');
    return e.json(200, engine.regenerate(e.app, subject, b.apply === true, u.actorId(e)));
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/matters/info', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const offices = require(`${__hooks}/lib_offices.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const m = u.byId(e.app, 'matters', String(b.matter_id || ''));
    if (m === null) throw new Error('Matter not found.');
    const expiry = engine.computeExpiry(e.app, m);
    const src = m.getString('sync_source') && m.getString('sync_source') !== 'none' ? m.getString('sync_source') : offices.sourceFor(m.getString('ip_type'), m.getString('jurisdiction'));
    const state = offices.connectionState(e.app);
    return e.json(200, {
      expiry: expiry,
      sync: {
        source: src,
        label: src ? offices.OFFICE_LABEL[src] : '',
        connected: src ? !!(state[src] && state[src].enabled) : false,
      },
    });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/matters/lookup', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const offices = require(`${__hooks}/lib_offices.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const ipType = String(b.ip_type || 'patent');
    const jur = String(b.jurisdiction || '').toUpperCase();
    const number = String(b.number || '').trim();
    if (!number) throw new Error('Enter an application or registration number.');
    const source = offices.sourceFor(ipType, jur);
    if (!source) {
      return e.json(200, { available: false, reason: 'No office data source for ' + jur + ' ' + ipType.replace('_', ' ') + '. Create the record by hand.' });
    }
    const state = offices.connectionState(e.app);
    if (!state[source] || !state[source].enabled) {
      return e.json(200, { available: false, reason: offices.OFFICE_LABEL[source] + ' is not connected. An admin can connect it in Settings, Office connections, or create the record by hand.' });
    }
    const snap = offices.fetchSnapshot(e.app, source, number, ipType);
    let family = [];
    if (b.include_family && source === 'epo_ops' && snap.found) {
      try {
        family = offices.fetchFamily(e.app, number);
      } catch (err) {
        family = [];
      }
    }
    const existing = [];
    const reports = require(`${__hooks}/lib_reports.js`);
    for (const m of u.findMany(e.app, 'matters', 'jurisdiction = {:j}', '', 0, { j: jur })) {
      if (reports.normNum(m.getString('application_no')) === reports.normNum(number)) existing.push({ id: m.id, ref: m.getString('ref') });
    }
    return e.json(200, { available: true, source: source, snapshot: snap, family: family, existing: existing });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/matters/import-office', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const offices = require(`${__hooks}/lib_offices.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const ipType = String(b.ip_type || 'patent');
    const jur = String(b.jurisdiction || '').toUpperCase();
    const number = String(b.number || '').trim();
    const source = offices.sourceFor(ipType, jur);
    if (!source) throw new Error('No office data source for this jurisdiction.');
    for (const m of u.findMany(e.app, 'matters', 'jurisdiction = {:j}', '', 0, { j: jur })) {
      if (reports.normNum(m.getString('application_no')) === reports.normNum(number)) throw new Error('Already in the register as ' + m.getString('ref') + '.');
    }
    const snap = offices.fetchSnapshot(e.app, source, number, ipType);
    if (!snap.found) throw new Error('The office has no record for ' + number + '.');
    const actor = u.actorId(e);
    let familyId = String(b.family_id || '');
    if (!familyId && (ipType === 'patent' || ipType === 'trademark' || ipType === 'design')) {
      const fam = u.newRecord(e.app, 'families', {
        kind: ipType === 'utility_model' ? 'patent' : ipType,
        title: String(b.family_title || snap.title || number),
        property: String(b.property_id || ''),
        strategy: 'maintain',
        word_element: ipType === 'trademark' ? snap.title : '',
        mark_type: ipType === 'trademark' ? 'word' : '',
      });
      e.app.save(fam);
      familyId = fam.id;
    }
    function createMatter(data) {
      const rec = u.newRecord(e.app, 'matters', data);
      e.app.save(rec);
      return u.byId(e.app, 'matters', rec.id);
    }
    const route = String(b.route || (jur === 'WO' ? (ipType === 'trademark' ? 'madrid' : 'pct') : jur === 'EP' ? 'ep' : 'national'));
    const m = createMatter({
      ip_type: ipType,
      title: snap.title || String(b.title || number),
      jurisdiction: jur,
      family: familyId,
      property: String(b.property_id || ''),
      route: route,
      relation: 'none',
      application_no: number,
      publication_no: snap.publication_no,
      registration_no: snap.registration_no,
      owner_of_record: snap.owner,
      applicants: snap.applicants || '',
      office_status: snap.status_text,
      entity_size: snap.entity_size || '',
      status: 'filed',
      sync_source: source,
      sync_enabled: true,
      sync_state: 'connected',
      last_synced: new Date().toISOString(),
      responsible: String(b.responsible || ''),
    });
    for (const c of snap.classes || []) {
      const g = u.newRecord(e.app, 'goods_services', { matter: m.id, nice_class: c.nice_class, spec: c.spec || '', class_status: snap.registration_date ? 'registered' : 'pending' });
      e.app.save(g);
    }
    // Record mapped office events in date order; the engine skips deadlines already past.
    const evs = (snap.events || []).filter((x) => x.code && x.date).sort((a, b2) => (a.date < b2.date ? -1 : a.date > b2.date ? 1 : 0));
    const seen = {};
    let createdDeadlines = 0;
    for (const ev of evs) {
      const k = ev.code + ev.date;
      if (seen[k]) continue;
      seen[k] = true;
      const subject = engine.subjectFromRecord('matter', u.byId(e.app, 'matters', m.id));
      const res = engine.recordEvent(e.app, subject, ev.code, ev.date, {
        label: ev.label,
        source: 'office',
        actorId: actor,
        data: { raw_code: ev.raw_code, office: source },
        commit: b.generate !== false,
      });
      createdDeadlines += res.created.length;
    }
    const fresh = u.byId(e.app, 'matters', m.id);
    if (snap.status && fresh.getString('status') !== snap.status) {
      fresh.set('status', snap.status);
      e.app.save(fresh);
    }
    // Selected family members become their own matters (by hand-off to their offices).
    const created = [{ id: m.id, ref: u.byId(e.app, 'matters', m.id).getString('ref') }];
    for (const member of u.asArray(b.family_members)) {
      if (!member || !member.jurisdiction || !member.number) continue;
      const mj = String(member.jurisdiction).toUpperCase();
      if (mj === jur && reports.normNum(member.number) === reports.normNum(number)) continue;
      let dup = false;
      for (const x of u.findMany(e.app, 'matters', 'jurisdiction = {:j}', '', 0, { j: mj })) {
        if (reports.normNum(x.getString('application_no')) === reports.normNum(member.number)) dup = true;
      }
      if (dup) continue;
      const child = createMatter({
        ip_type: ipType,
        title: fresh.getString('title'),
        jurisdiction: mj,
        family: familyId,
        property: String(b.property_id || ''),
        route: mj === 'WO' ? 'pct' : mj === 'EP' ? 'ep' : 'national',
        relation: 'related',
        application_no: String(member.number),
        status: 'filed',
        sync_enabled: true,
        responsible: String(b.responsible || ''),
      });
      if (member.filing_date) {
        const subj = engine.subjectFromRecord('matter', child);
        const r2 = engine.recordEvent(e.app, subj, 'FILED', member.filing_date, { source: 'office', actorId: actor, label: 'Application filed (family import)', commit: b.generate !== false });
        createdDeadlines += r2.created.length;
      }
      created.push({ id: child.id, ref: u.byId(e.app, 'matters', child.id).getString('ref') });
    }
    engine.refreshMatterSummary(e.app, m.id);
    u.audit(e.app, actor, 'import', 'matters', m.id, created[0].ref, { source: source, number: number, members: created.length - 1, deadlines: createdDeadlines }, 'Imported from ' + offices.OFFICE_LABEL[source]);
    return e.json(200, { created: created, deadlines: createdDeadlines, family_id: familyId });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/matters/sync', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const offices = require(`${__hooks}/lib_offices.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const m = u.byId(e.app, 'matters', String(b.matter_id || ''));
    if (m === null) throw new Error('Matter not found.');
    const res = offices.syncMatter(e.app, m, 'manual');
    if (res.error) return e.json(502, { error: res.error });
    return e.json(200, res);
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/matters/national-phase', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const parent = u.byId(e.app, 'matters', String(b.matter_id || ''));
    if (parent === null) throw new Error('Parent matter not found.');
    const relation = ['national_phase', 'validation', 'designation', 'continuation', 'divisional', 'continuation_in_part'].indexOf(b.relation) >= 0 ? b.relation : 'national_phase';
    const jurs = u.asArray(b.jurisdictions).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
    if (!jurs.length && relation !== 'continuation' && relation !== 'divisional' && relation !== 'continuation_in_part') throw new Error('Choose at least one country.');
    const actor = u.actorId(e);
    let familyId = parent.getString('family');
    if (!familyId) {
      const kind = parent.getString('ip_type') === 'trademark' ? 'trademark' : parent.getString('ip_type') === 'design' ? 'design' : 'patent';
      const fam = u.newRecord(e.app, 'families', { kind: kind, title: parent.getString('title'), property: parent.getString('property'), strategy: 'maintain' });
      e.app.save(fam);
      familyId = fam.id;
      parent.set('family', familyId);
      e.app.save(parent);
    }
    const targets = jurs.length ? jurs : [parent.getString('jurisdiction')];
    const created = [];
    let deadlines = 0;
    for (const j of targets) {
      const route =
        relation === 'national_phase' ? 'pct' : relation === 'validation' ? 'validation' : relation === 'designation' ? 'designation' : parent.getString('route') || 'national';
      const filing = relation === 'national_phase' ? u.d10(parent.getString('filing_date')) : relation === 'validation' || relation === 'designation' ? u.d10(parent.getString('filing_date')) : u.d10(b.filing_date);
      const child = u.newRecord(e.app, 'matters', {
        ip_type: parent.getString('ip_type'),
        title: String(b.title || parent.getString('title')),
        family: familyId,
        property: parent.getString('property'),
        work: parent.getString('work'),
        jurisdiction: j,
        route: route,
        relation: relation,
        parent: parent.id,
        priority_claims: u.j(parent, 'priority_claims', []),
        filing_date: u.toPb(filing),
        status: relation === 'validation' ? 'granted' : 'filed',
        registration_date: relation === 'validation' || relation === 'designation' ? parent.getString('registration_date') : '',
        entity_size: parent.getString('entity_size'),
        owner_of_record: parent.getString('owner_of_record'),
        responsible: parent.getString('responsible'),
        docketer: parent.getString('docketer'),
        counsel: parent.getString('counsel'),
        sync_enabled: true,
      });
      e.app.save(child);
      const subject = engine.subjectFromRecord('matter', u.byId(e.app, 'matters', child.id));
      if (relation === 'national_phase') {
        const entry = u.d10(b.entry_date) || u.today();
        if (filing) deadlines += engine.recordEvent(e.app, subject, 'FILED', filing, { source: 'system', actorId: actor, label: 'International filing date (national phase)' }).created.length;
        engine.recordEvent(e.app, subject, 'NATIONAL_PHASE_ENTERED', entry, { source: 'manual', actorId: actor, commit: false });
      } else if (relation === 'validation') {
        const g = u.d10(parent.getString('registration_date'));
        if (g) deadlines += engine.recordEvent(e.app, subject, 'VALIDATED', g, { source: 'system', actorId: actor, label: 'Validated from the European patent' }).created.length;
      } else if (relation === 'designation') {
        const g = u.d10(parent.getString('registration_date'));
        if (g) deadlines += engine.recordEvent(e.app, subject, 'REGISTERED', g, { source: 'system', actorId: actor, label: 'International registration date' }).created.length;
      } else if (filing) {
        deadlines += engine.recordEvent(e.app, subject, 'FILED', filing, { source: 'manual', actorId: actor }).created.length;
      }
      created.push({ id: child.id, ref: u.byId(e.app, 'matters', child.id).getString('ref'), jurisdiction: j });
    }
    u.audit(e.app, actor, 'create', 'matters', parent.id, parent.getString('ref'), { children: created }, relation.replace('_', ' '));
    return e.json(200, { created: created, deadlines: deadlines });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/import/matters', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const b = u.body(e);
  const denied = u.deny(e, b.dry_run === false ? 'manage' : 'edit');
  if (denied) return denied;
  try {
    const rows = u.asArray(b.rows);
    if (!rows.length) throw new Error('No rows to import.');
    if (rows.length > 5000) throw new Error('Import at most 5,000 rows at a time.');
    return e.json(200, reports.importMatters(e.app, rows, b.dry_run !== false, b.generate !== false, u.actorId(e)));
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/import/watch', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const rows = u.asArray(u.body(e).rows);
    if (!rows.length) throw new Error('No rows to import.');
    return e.json(200, reports.importWatch(e.app, rows, u.actorId(e)));
  } catch (err) {
    return u.fail(e, err);
  }
});

/* ------------------------------------------------------------------ */
/* Deadlines                                                           */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/deadlines/close', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  const b = u.body(e);
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
      const r = engine.closeDeadline(e.app, dl, status, String(b.reason || ''), u.actorId(e), u.d10(b.closed_on) || u.today());
      results.push({ id: id, ok: true, next: r.next ? { id: r.next.id, title: r.next.getString('title'), due_date: u.d10(r.next.getString('due_date')) } : null });
      ok += 1;
    } catch (err) {
      results.push({ id: id, error: String(err.message || err) });
    }
  }
  return e.json(ok === 0 && ids.length ? 400 : 200, { closed: ok, results: results, error: ok === 0 && results.length ? results[0].error : undefined });
});

routerAdd('POST', '/api/ops/deadlines/extend', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const b = u.body(e);
  const denied = u.deny(e, b.preview ? 'read' : 'edit');
  if (denied) return denied;
  try {
    const dl = u.byId(e.app, 'deadlines', String(b.id || ''));
    if (dl === null) throw new Error('Deadline not found.');
    if (dl.getString('status') !== 'open') throw new Error('Only open deadlines can be extended.');
    return e.json(200, engine.extendDeadline(e.app, dl, Number(b.level || 1), u.actorId(e), b.preview === true));
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/deadlines/reassign', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const assignee = String(b.assignee || '');
    if (assignee && u.byId(e.app, 'users', assignee) === null) throw new Error('That person does not have an account.');
    let n = 0;
    for (const id of u.asArray(b.ids)) {
      const dl = u.byId(e.app, 'deadlines', String(id));
      if (dl === null) continue;
      const before = dl.getString('assignee');
      dl.set('assignee', assignee);
      e.app.save(dl);
      u.audit(e.app, u.actorId(e), 'update', 'deadlines', dl.id, dl.getString('title'), { assignee: { from: before, to: assignee } }, 'Reassigned');
      n += 1;
    }
    if (assignee && n > 0 && assignee !== u.actorId(e)) {
      u.notify(e.app, assignee, 'assignment', n === 1 ? 'A deadline was assigned to you' : n + ' deadlines were assigned to you', 'Assigned by ' + u.userLabel(e.app, u.actorId(e)) + '.', '#/deadlines', {});
    }
    return e.json(200, { updated: n });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/deadlines/move', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const b = u.body(e);
  const denied = u.deny(e, b.preview ? 'read' : 'edit');
  if (denied) return denied;
  try {
    const days = Number(b.days || 0);
    const date = u.d10(b.date);
    if (!days && !date) throw new Error('Give a number of days or a new date.');
    if (!b.preview && String(b.reason || '').trim() === '') throw new Error('Give a reason for moving the dates.');
    const buffer = Number(u.setting(e.app, 'target_buffer_days', 14)) || 0;
    const out = [];
    for (const id of u.asArray(b.ids)) {
      const dl = u.byId(e.app, 'deadlines', String(id));
      if (dl === null || dl.getString('status') !== 'open') continue;
      const from = u.d10(dl.getString('due_date'));
      const to = date || u.addDays(from, days);
      out.push({ id: dl.id, title: dl.getString('title'), from: from, to: to, final: u.d10(dl.getString('final_date')), past_final: u.d10(dl.getString('final_date')) !== '' && to > u.d10(dl.getString('final_date')) });
      if (b.preview) continue;
      const calc = u.j(dl, 'calculation', {});
      const steps = Array.isArray(calc.steps) ? calc.steps.slice() : [];
      steps.push('Moved by ' + u.userLabel(e.app, u.actorId(e)) + ' on ' + u.human(u.today()) + ' from ' + u.human(from) + ' to ' + u.human(to) + ': ' + String(b.reason) + '. Locked against recalculation.');
      calc.steps = steps;
      dl.set('calculation', calc);
      dl.set('due_date', u.toPb(to));
      const kind = dl.getString('kind');
      const statutory = kind === 'hard' || kind === 'extendable' || kind === 'designated';
      dl.set('target_date', u.toPb(statutory ? u.addDays(to, -buffer) : to));
      dl.set('locked', true);
      e.app.save(dl);
      u.audit(e.app, u.actorId(e), 'move', 'deadlines', dl.id, dl.getString('title'), { from: from, to: to }, String(b.reason));
    }
    return e.json(200, { moves: out });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/deadlines/upcoming', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const days = Math.min(730, Math.max(1, Number(b.days || 30)));
    const today = u.today();
    let filter = 'status = "open" && due_date <= {:h}';
    if (!b.include_overdue) filter += ' && due_date >= {:t}';
    const params = { h: u.toPb(u.addDays(today, days)), t: u.toPb(today) };
    if (b.assignee_email) {
      const usr = u.findOne(e.app, 'users', 'email = {:m}', { m: String(b.assignee_email) });
      if (usr === null) throw new Error('No account with that email.');
      filter += ' && assignee = {:a}';
      params.a = usr.id;
    }
    if (b.jurisdiction) {
      filter += ' && jurisdiction = {:j}';
      params.j = String(b.jurisdiction).toUpperCase();
    }
    const rows = u.findMany(e.app, 'deadlines', filter, 'due_date', 500, params);
    return e.json(200, {
      deadlines: rows.map((d) => ({
        id: d.id,
        ref: d.getString('ref'),
        title: d.getString('title'),
        kind: d.getString('kind'),
        jurisdiction: d.getString('jurisdiction'),
        due_date: u.d10(d.getString('due_date')),
        final_date: u.d10(d.getString('final_date')),
        days_left: u.diffDays(today, u.d10(d.getString('due_date'))),
        assignee: d.getString('assignee') ? u.userLabel(e.app, d.getString('assignee')) : '',
        citation: d.getString('citation'),
      })),
    });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/deadlines/explain', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const dl = u.byId(e.app, 'deadlines', String(u.body(e).id || ''));
    if (dl === null) throw new Error('Deadline not found.');
    const calc = u.j(dl, 'calculation', {});
    let extensions = [];
    if (dl.getString('rule')) {
      const rr = u.byId(e.app, 'rules', dl.getString('rule'));
      if (rr !== null) extensions = u.j(rr, 'extensions', []);
    }
    return e.json(200, {
      id: dl.id,
      extensions: extensions,
      extension_level: dl.getInt('extension_level'),
      title: dl.getString('title'),
      due_date: u.d10(dl.getString('due_date')),
      target_date: u.d10(dl.getString('target_date')),
      final_date: u.d10(dl.getString('final_date')),
      grace_end: u.d10(dl.getString('grace_end')),
      source: dl.getString('source'),
      rule_code: dl.getString('rule_code'),
      citation: dl.getString('citation'),
      locked: dl.getBool('locked'),
      steps: calc.steps || [],
    });
  } catch (err) {
    return u.fail(e, err);
  }
});

/* ------------------------------------------------------------------ */
/* Inbox                                                               */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/inbox/propose', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const denied = u.deny(e, 'contribute');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const kind = ['document', 'agreement_draft', 'agent_proposal', 'email', 'watch_hit'].indexOf(b.kind) >= 0 ? b.kind : 'agent_proposal';
    const title = String(b.title || '').trim();
    if (!title) throw new Error('A proposal needs a title.');
    let matterId = String(b.matter_id || '');
    if (!matterId && b.matter_ref) {
      const want = reports.normNum(b.matter_ref);
      for (const m of u.findMany(e.app, 'matters', '', '', 0)) {
        if (reports.normNum(m.getString('ref')) === want || reports.normNum(m.getString('application_no')) === want || reports.normNum(m.getString('registration_no')) === want) {
          matterId = m.id;
          break;
        }
      }
    }
    const proposal = u.asObject(b.proposal);
    const rec = u.newRecord(e.app, 'inbox_items', {
      kind: kind,
      title: title.slice(0, 400),
      summary: String(b.summary || '').slice(0, 4000),
      status: 'new',
      matter: matterId,
      agreement: String(b.agreement_id || ''),
      document: String(b.document_id || ''),
      proposal: proposal,
      diffs: u.asArray(b.diffs),
      confidence: ['high', 'medium', 'low', 'none'].indexOf(b.confidence) >= 0 ? b.confidence : 'medium',
      citations: u.asArray(b.citations),
      source: e.hasSuperuserAuth() ? 'agent' : String(b.source || 'user') === 'agent' ? 'agent' : 'user',
      proposed_by: String(b.proposed_by || (e.hasSuperuserAuth() ? 'CraftBot' : u.userLabel(e.app, u.actorId(e)))),
      requires_second: false,
    });
    e.app.save(rec);
    return e.json(201, { id: rec.id, matter_id: matterId });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/inbox/preview', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const item = u.byId(e.app, 'inbox_items', String(b.id || ''));
    if (item === null) throw new Error('Inbox item not found.');
    const matterId = String(b.matter_id || item.getString('matter') || '');
    const subject = matterId ? engine.subjectOf(e.app, 'matter', matterId) : null;
    const proposal = u.j(item, 'proposal', {});
    const out = [];
    if (subject !== null) {
      if (item.getString('kind') === 'office_change') {
        const events = u.asArray(proposal.events);
        events.forEach(function (ev, idx) {
          if (!ev || !ev.code || !ev.date) return;
          const props = engine.proposalsFor(e.app, subject, { code: ev.code, date: ev.date, data: {} });
          out.push({ index: idx, code: ev.code, date: ev.date, label: ev.label, proposals: props });
        });
      } else if (proposal.event && proposal.event.code) {
        const ev = u.asObject(b.event_override).code ? u.asObject(b.event_override) : proposal.event;
        const data = {};
        if (ev.period_months) data.period_months = Number(ev.period_months);
        if (ev.period_days) data.period_days = Number(ev.period_days);
        if (ev.due_date) data.due_date = u.d10(ev.due_date);
        out.push({ index: 0, code: ev.code, date: u.d10(ev.date), label: ev.label || '', proposals: engine.proposalsFor(e.app, subject, { code: ev.code, date: u.d10(ev.date), data: data }) });
      }
    }
    return e.json(200, { matter_id: matterId, events: out });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/inbox/decide', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const item = u.byId(e.app, 'inbox_items', String(b.id || ''));
    if (item === null) throw new Error('Inbox item not found.');
    const status = item.getString('status');
    if (status !== 'new' && status !== 'awaiting_second') throw new Error('This item was already decided.');
    const actor = u.actorId(e);
    const decision = String(b.decision || '');
    if (decision === 'reject') {
      item.set('status', 'rejected');
      item.set('decided_by', actor);
      item.set('decided_at', new Date().toISOString());
      item.set('note', String(b.note || '').slice(0, 2000));
      e.app.save(item);
      u.audit(e.app, actor, 'reject', 'inbox_items', item.id, item.getString('title'), {}, String(b.note || ''));
      return e.json(200, { status: 'rejected' });
    }
    if (decision !== 'accept') throw new Error('Decision must be accept or reject.');
    const kind = item.getString('kind');
    const proposal = u.j(item, 'proposal', {});
    const matterId = String(b.matter_id || item.getString('matter') || '');
    const secondRequired = u.setting(e.app, 'second_reviewer', false) === true;
    const summary = { fields: 0, events: 0, deadlines: 0, created: [] };

    if (kind === 'agreement_draft') {
      const a = u.asObject(b.agreement && Object.keys(u.asObject(b.agreement)).length ? b.agreement : proposal.agreement);
      if (!a.title) throw new Error('The draft has no agreement title.');
      let cpId = '';
      const cpName = String(a.counterparty_name || a.counterparty || '').trim();
      if (cpName) {
        let cp = u.findOne(e.app, 'parties', 'name = {:n}', { n: cpName });
        if (cp === null) {
          cp = u.newRecord(e.app, 'parties', { name: cpName, kind: 'organization', roles: [a.direction === 'in' ? 'licensor' : 'licensee'] });
          e.app.save(cp);
        }
        cpId = cp.id;
      }
      const allowed = ['agreement_type', 'direction', 'status', 'our_entity', 'signed_date', 'effective_date', 'term_start', 'term_end', 'perpetual', 'auto_renew', 'renewal_notice_days', 'exclusivity', 'territory_summary', 'currency', 'royalty_rate', 'royalty_basis', 'flat_fee', 'advance', 'minimum_guarantee', 'payment_schedule', 'reporting_frequency', 'report_due_days', 'option_period_end', 'option_extension_fee', 'reversion_date', 'sell_off_days', 'author_grant', 'governing_law', 'summary'];
      const data = { title: String(a.title), counterparty: cpId, property: String(a.property_id || ''), ai_extracted: item.getString('source') === 'agent', responsible: actor };
      for (const k of allowed) {
        if (a[k] === undefined || a[k] === null || a[k] === '') continue;
        const dateKeys = ['signed_date', 'effective_date', 'term_start', 'term_end', 'option_period_end', 'reversion_date'];
        data[k] = dateKeys.indexOf(k) >= 0 && typeof a[k] === 'string' ? u.toPb(a[k]) : a[k];
      }
      if (!data.agreement_type) data.agreement_type = 'other';
      if (!data.direction) data.direction = 'none';
      if (!data.status) data.status = 'draft';
      const agr = u.newRecord(e.app, 'agreements', data);
      e.app.save(agr);
      for (const g of u.asArray(b.grants || proposal.grants)) {
        if (!g) continue;
        const gr = u.newRecord(e.app, 'grants', {
          agreement: agr.id,
          direction: g.direction === 'in' ? 'in' : 'out',
          kind: ['grant', 'holdback', 'restriction', 'reservation'].indexOf(g.kind) >= 0 ? g.kind : 'grant',
          exclusive: g.exclusive === true,
          properties: u.asArray(g.properties),
          works: u.asArray(g.works),
          matters: u.asArray(g.matters),
          dims: u.asObject(g.dims),
          term_start: u.toPb(g.term_start),
          term_end: u.toPb(g.term_end),
          rights_text: String(g.rights_text || ''),
        });
        e.app.save(gr);
      }
      if (item.getString('document')) {
        const doc = u.byId(e.app, 'documents', item.getString('document'));
        if (doc !== null) {
          doc.set('agreement', agr.id);
          doc.set('doc_type', 'agreement');
          e.app.save(doc);
        }
      }
      item.set('agreement', agr.id);
      item.set('status', 'accepted');
      item.set('decided_by', actor);
      item.set('decided_at', new Date().toISOString());
      e.app.save(item);
      u.audit(e.app, actor, 'accept', 'inbox_items', item.id, item.getString('title'), { agreement: agr.id }, 'Agreement created from draft');
      return e.json(200, { status: 'accepted', agreement_id: agr.id });
    }

    if (!matterId) throw new Error('Choose the matter this belongs to.');
    const subject = engine.subjectOf(e.app, 'matter', matterId);
    if (subject === null) throw new Error('Matter not found.');

    // Which event deadlines were selected, and are any statutory?
    const eventPlans = [];
    if (kind === 'office_change') {
      const chosen = b.events !== undefined ? u.asArray(b.events).map(Number) : null;
      const events = u.asArray(proposal.events);
      events.forEach(function (ev, idx) {
        if (!ev || !ev.date) return;
        if (chosen !== null && chosen.indexOf(idx) < 0) return;
        const mapped = u.asObject(b.map_raw)[String(idx)];
        const code = ev.code || mapped || '';
        if (!code) return;
        eventPlans.push({ code: code, date: ev.date, label: ev.label || '', data: { raw_code: ev.raw_code || '', office: item.getString('office') }, select: u.asObject(b.deadlines)[String(idx)] });
      });
    } else if (proposal.event && proposal.event.code) {
      const ev = u.asObject(b.event_override).code ? u.asObject(b.event_override) : proposal.event;
      const data = {};
      if (ev.period_months) data.period_months = Number(ev.period_months);
      if (ev.period_days) data.period_days = Number(ev.period_days);
      if (ev.due_date) data.due_date = u.d10(ev.due_date);
      eventPlans.push({ code: ev.code, date: u.d10(ev.date), label: ev.label || '', data: data, select: u.asObject(b.deadlines)['0'] });
    }
    let statutory = false;
    for (const plan of eventPlans) {
      const props = engine.proposalsFor(e.app, subject, { code: plan.code, date: plan.date, data: plan.data });
      for (const p of props) {
        const picked = Array.isArray(plan.select) ? plan.select.indexOf(p.key) >= 0 || plan.select.indexOf(p.rule_code) >= 0 : p.selected;
        if (picked && (p.kind === 'hard' || p.kind === 'extendable' || p.kind === 'designated')) statutory = true;
      }
    }
    const fromAgent = item.getString('source') === 'agent' || kind === 'document' || kind === 'agent_proposal' || kind === 'email';
    if (secondRequired && statutory && fromAgent) {
      if (status === 'new') {
        item.set('status', 'awaiting_second');
        item.set('first_approver', actor);
        item.set('first_approved_at', new Date().toISOString());
        item.set('requires_second', true);
        const p2 = u.j(item, 'proposal', {});
        p2.first_decision = { fields: b.fields, events: b.events, map_raw: b.map_raw, deadlines: b.deadlines, event_override: b.event_override, extra_deadlines: b.extra_deadlines };
        item.set('proposal', p2);
        item.set('matter', matterId);
        e.app.save(item);
        for (const m of u.usersWithRoles(e.app, ['admin', 'manager', 'counsel'])) {
          if (m.id === actor) continue;
          u.notify(e.app, m.id, 'inbox', 'Second review needed: ' + item.getString('title'), 'Approved by ' + u.userLabel(e.app, actor) + '. Statutory deadlines from CraftBot need a second reviewer.', '#/inbox/' + item.id, {});
        }
        u.audit(e.app, actor, 'accept', 'inbox_items', item.id, item.getString('title'), {}, 'First approval (second reviewer required)');
        return e.json(200, { status: 'awaiting_second' });
      }
      if (item.getString('first_approver') === actor) throw new Error('A different person must give the second approval.');
    }

    // Field updates (office changes).
    const m = subject.record;
    const diffs = u.asArray(u.j(item, 'diffs', []));
    const acceptFields = b.fields !== undefined ? u.asArray(b.fields) : diffs.map((d) => d.field);
    let rejectedSome = false;
    for (const d of diffs) {
      if (acceptFields.indexOf(d.field) < 0) {
        rejectedSome = true;
        continue;
      }
      if (d.field === 'status' && !engine.STATUS_GROUP[d.incoming]) continue;
      m.set(d.field, d.kind === 'date' ? u.toPb(d.incoming) : d.incoming);
      summary.fields += 1;
    }
    const pf = u.asObject(proposal.fields);
    for (const k of Object.keys(pf)) {
      const v = pf[k];
      if (['title', 'application_no', 'publication_no', 'registration_no', 'owner_of_record', 'office_status', 'counsel', 'client_ref'].indexOf(k) >= 0 && v) {
        m.set(k, String(v));
        summary.fields += 1;
      }
    }
    if (summary.fields) e.app.save(m);
    // Official annuity dates (JPO) replace computed ones, locked.
    for (const au of u.asArray(proposal.annuity_updates)) {
      if (b.annuity === false) break;
      const dl = u.byId(e.app, 'deadlines', au.deadline_id);
      if (dl === null || dl.getString('status') !== 'open') continue;
      const calc = u.j(dl, 'calculation', {});
      const steps = Array.isArray(calc.steps) ? calc.steps.slice() : [];
      steps.push('Official due date from the JPO: ' + u.human(au.incoming) + ' (computed ' + u.human(au.current) + '). Locked to the official date.');
      calc.steps = steps;
      dl.set('calculation', calc);
      dl.set('due_date', u.toPb(au.incoming));
      dl.set('locked', true);
      e.app.save(dl);
    }
    // Events and their deadlines.
    const docId = item.getString('document');
    for (const plan of eventPlans) {
      const res = engine.recordEvent(e.app, engine.subjectOf(e.app, 'matter', matterId), plan.code, plan.date, {
        label: plan.label,
        data: plan.data,
        source: 'inbox',
        actorId: actor,
        documentId: docId,
        select: Array.isArray(plan.select) ? plan.select : undefined,
        deadlineSource: fromAgent ? 'inbox' : 'office',
      });
      summary.events += 1;
      summary.deadlines += res.created.length;
      for (const r of res.created) summary.created.push({ id: r.id, title: r.getString('title'), due_date: u.d10(r.getString('due_date')) });
    }
    // Extra one-off deadlines proposed (e.g. "report to product owner").
    for (const x of u.asArray(b.extra_deadlines !== undefined ? b.extra_deadlines : proposal.extra_deadlines)) {
      if (!x || !x.title || !u.d10(x.due_date)) continue;
      const rec = u.newRecord(e.app, 'deadlines', {
        title: String(x.title),
        matter: matterId,
        kind: ['hard', 'extendable', 'designated', 'internal', 'reminder'].indexOf(x.kind) >= 0 ? x.kind : 'internal',
        category: x.category || 'prosecution',
        status: 'open',
        due_date: u.toPb(x.due_date),
        source: 'inbox',
        calculation: { steps: ['Proposed by ' + item.getString('proposed_by') + ' and accepted by ' + u.userLabel(e.app, actor) + '.'].concat(x.reason ? [String(x.reason)] : []) },
        citation: String(x.citation || ''),
      });
      e.app.save(rec);
      summary.deadlines += 1;
      summary.created.push({ id: rec.id, title: rec.getString('title'), due_date: u.d10(x.due_date) });
    }
    if (docId) {
      const doc = u.byId(e.app, 'documents', docId);
      if (doc !== null) {
        if (!doc.getString('matter')) doc.set('matter', matterId);
        if (proposal.document_type) doc.set('doc_type', String(proposal.document_type));
        if (proposal.summary && !doc.getString('summary')) doc.set('summary', String(proposal.summary).slice(0, 8000));
        e.app.save(doc);
      }
    }
    engine.refreshMatterSummary(e.app, matterId);
    item.set('status', rejectedSome ? 'partially_accepted' : 'accepted');
    item.set('decided_by', actor);
    item.set('decided_at', new Date().toISOString());
    item.set('matter', matterId);
    item.set('note', String(b.note || '').slice(0, 2000));
    e.app.save(item);
    u.audit(e.app, actor, 'accept', 'inbox_items', item.id, item.getString('title'), summary, item.getString('first_approver') ? 'Second approval' : '');
    return e.json(200, { status: item.getString('status'), summary: summary });
  } catch (err) {
    return u.fail(e, err);
  }
});

/* ------------------------------------------------------------------ */
/* Renewals                                                            */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/renewals/decide', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'manage');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const decision = String(b.decision || '');
    if (['renew', 'renew_partial', 'lapse', 'defer', 'pending'].indexOf(decision) < 0) throw new Error('Unknown decision.');
    if (decision === 'lapse' && String(b.rationale || '').trim() === '') throw new Error('Give a reason for letting these rights lapse.');
    const actor = u.actorId(e);
    let n = 0;
    const lapsed = [];
    for (const id of u.asArray(b.ids)) {
      const r = u.byId(e.app, 'renewals', String(id));
      if (r === null) continue;
      if (r.getString('instruction_status') === 'confirmed' || r.getString('instruction_status') === 'paid') continue;
      r.set('decision', decision);
      r.set('decided_by', actor);
      r.set('decided_at', new Date().toISOString());
      if (b.rationale !== undefined) r.set('rationale', String(b.rationale).slice(0, 2000));
      if (b.classes_keep !== undefined) r.set('classes_keep', u.asArray(b.classes_keep).map(Number));
      e.app.save(r);
      const dl = u.byId(e.app, 'deadlines', r.getString('deadline'));
      if (decision === 'lapse' && dl !== null && dl.getString('status') === 'open') {
        engine.closeDeadline(e.app, dl, 'not_needed', 'Decided not to renew: ' + String(b.rationale || ''), actor, u.today());
        const m = u.byId(e.app, 'matters', r.getString('matter'));
        if (m !== null) lapsed.push(m.getString('ref'));
      }
      u.audit(e.app, actor, 'decide', 'renewals', r.id, r.getString('cycle_label'), { decision: decision }, String(b.rationale || ''));
      n += 1;
    }
    return e.json(200, { updated: n, lapsing: lapsed });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/renewals/instruct', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'manage');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const provider = String(b.provider || '').trim();
    if (!provider) throw new Error('Name the renewal provider or agent.');
    const actor = u.actorId(e);
    const rows = [];
    const header = ['Reference', 'Jurisdiction', 'IP type', 'Application no.', 'Registration no.', 'Renewal', 'Due date', 'Grace ends', 'Decision', 'Classes to keep', 'Official fee', 'Currency', 'PO number'];
    const esc = (v) => {
      const s = String(v === null || v === undefined ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header.map(esc).join(',')];
    for (const id of u.asArray(b.ids)) {
      const r = u.byId(e.app, 'renewals', String(id));
      if (r === null) continue;
      const dec = r.getString('decision');
      if (dec !== 'renew' && dec !== 'renew_partial') continue;
      const m = u.byId(e.app, 'matters', r.getString('matter'));
      if (m === null) continue;
      r.set('instruction_status', 'instructed');
      r.set('instructed_at', new Date().toISOString());
      r.set('provider', provider);
      if (b.po_number) r.set('po_number', String(b.po_number));
      e.app.save(r);
      const keep = u.j(r, 'classes_keep', []);
      const row = [
        m.getString('ref'),
        m.getString('jurisdiction'),
        m.getString('ip_type'),
        m.getString('application_no'),
        m.getString('registration_no'),
        r.getString('cycle_label'),
        u.d10(r.getString('due_date')),
        u.d10(r.getString('grace_end')),
        dec === 'renew_partial' ? 'Renew (drop classes)' : 'Renew',
        Array.isArray(keep) && keep.length ? keep.join(' ') : '',
        r.getFloat('official_fee') > 0 ? r.getFloat('official_fee') : '',
        r.getString('currency'),
        r.getString('po_number'),
      ];
      rows.push(row);
      lines.push(row.map(esc).join(','));
      u.audit(e.app, actor, 'instruct', 'renewals', r.id, m.getString('ref') + ' ' + r.getString('cycle_label'), { provider: provider }, '');
    }
    if (!rows.length) throw new Error('Select renewals decided as Renew.');
    const org = String(u.setting(e.app, 'org_name', '') || 'our organization');
    const letter = [
      'Dear ' + provider + ',',
      '',
      'Please pay the renewal and maintenance fees for the ' + rows.length + ' right' + (rows.length === 1 ? '' : 's') + ' listed below on behalf of ' + org + '.',
      b.po_number ? 'Purchase order: ' + b.po_number + '.' : '',
      'Please confirm receipt of these instructions and send the official receipts once paid.',
      '',
    ]
      .concat(rows.map((x) => '- ' + x[0] + ' (' + x[1] + ' ' + (x[4] || x[3]) + '): ' + x[5] + ', due ' + x[6] + (x[9] ? ', keep classes ' + x[9] : '')))
      .concat(['', 'Kind regards,', u.userLabel(e.app, actor), org])
      .filter((x) => x !== '')
      .join('\n');
    return e.json(200, { instructed: rows.length, csv: lines.join('\n') + '\n', letter: letter });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/renewals/record-payment', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'manage');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const r = u.byId(e.app, 'renewals', String(b.id || ''));
    if (r === null) throw new Error('Renewal not found.');
    const paid = u.d10(b.paid_date) || u.today();
    const actor = u.actorId(e);
    r.set('paid_date', u.toPb(paid));
    if (b.amount !== undefined && b.amount !== '') r.set('paid_amount', Number(b.amount) || 0);
    r.set('instruction_status', 'confirmed');
    if (r.getString('decision') === 'pending' || r.getString('decision') === 'defer') r.set('decision', 'renew');
    e.app.save(r);
    const dl = u.byId(e.app, 'deadlines', r.getString('deadline'));
    let next = null;
    if (dl !== null && dl.getString('status') === 'open') {
      const res = engine.closeDeadline(e.app, dl, 'done', 'Paid on ' + u.human(paid), actor, paid);
      next = res.next;
    }
    const m = u.byId(e.app, 'matters', r.getString('matter'));
    if (m !== null) {
      const subject = engine.subjectFromRecord('matter', m);
      const isRenewal = dl !== null && dl.getString('category') === 'renewal' && m.getString('ip_type') === 'trademark';
      engine.recordEvent(e.app, subject, isRenewal ? 'RENEWED' : 'ANNUITY_PAID', paid, { source: 'manual', actorId: actor, label: r.getString('cycle_label') + ' paid', commit: false });
      engine.refreshMatterSummary(e.app, m.id);
    }
    return e.json(200, { ok: true, next: next ? { id: next.id, title: next.getString('title'), due_date: u.d10(next.getString('due_date')) } : null });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/renewals/forecast', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    return e.json(200, reports.forecast(e.app, Math.min(10, Math.max(1, Number(u.body(e).years || 5)))));
  } catch (err) {
    return u.fail(e, err, 500);
  }
});

routerAdd('POST', '/api/ops/renewals/refresh-costs', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const ids = u.asArray(u.body(e).ids);
    const rows = ids.length ? ids.map((id) => u.byId(e.app, 'renewals', String(id))).filter((x) => x !== null) : u.findMany(e.app, 'renewals', 'instruction_status = "not_instructed"', '', 0);
    for (const r of rows) engine.refreshRenewalCost(e.app, r);
    return e.json(200, { refreshed: rows.length });
  } catch (err) {
    return u.fail(e, err);
  }
});

/* ------------------------------------------------------------------ */
/* Rights and agreements                                               */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/rights/availability', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const rights = require(`${__hooks}/lib_rights.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const assets = u.asArray(b.assets).filter((a) => a && a.id && ['work', 'property', 'matter'].indexOf(a.type) >= 0);
    if (!assets.length) throw new Error('Choose at least one title or property.');
    if (assets.length > 100) throw new Error('Check at most 100 assets at once.');
    const columns = u.asArray(b.columns);
    if (columns.length > 80) throw new Error('Choose at most 80 columns.');
    return e.json(
      200,
      rights.availability(e.app, {
        assets: assets,
        column: String(b.column || 'territory'),
        columns: columns,
        filters: u.asObject(b.filters),
        start: u.d10(b.start),
        end: u.d10(b.end),
        exclusive: b.exclusive === true,
        exclude_agreement: String(b.exclude_agreement || ''),
      }),
    );
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/agreements/check-conflicts', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const rights = require(`${__hooks}/lib_rights.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const drafts = b.grants !== undefined ? u.asArray(b.grants) : null;
    return e.json(200, rights.conflicts(e.app, String(b.agreement_id || ''), drafts));
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/agreements/sync', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const a = u.byId(e.app, 'agreements', String(u.body(e).agreement_id || ''));
    if (a === null) throw new Error('Agreement not found.');
    return e.json(200, engine.syncAgreement(e.app, a, u.actorId(e)));
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/works/copyright-term', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const w = u.byId(e.app, 'works', String(u.body(e).work_id || ''));
    if (w === null) throw new Error('Work not found.');
    return e.json(200, engine.copyrightTerms(w));
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/properties/coverage', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const id = String(u.body(e).property_id || '');
    if (u.byId(e.app, 'properties', id) === null) throw new Error('Property not found.');
    return e.json(200, reports.coverage(e.app, id));
  } catch (err) {
    return u.fail(e, err);
  }
});

/* ------------------------------------------------------------------ */
/* Inventions                                                          */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/disclosures/submit', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'auth');
  if (denied) return denied;
  try {
    const d = u.byId(e.app, 'disclosures', String(u.body(e).id || ''));
    if (d === null) throw new Error('Invention not found.');
    const actor = u.actorId(e);
    if (d.getString('submitted_by') !== actor && !u.canEdit(e.auth)) throw new Error('Only the submitter or the IP team can submit this.');
    if (d.getString('stage') !== 'draft') throw new Error('Already submitted.');
    if (String(d.getString('summary')).trim() === '' && String(d.getString('solution')).trim() === '') throw new Error('Describe the invention before submitting.');
    d.set('stage', 'submitted');
    d.set('submitted_at', new Date().toISOString());
    e.app.save(d);
    for (const m of u.usersWithRoles(e.app, ['admin', 'manager', 'counsel'])) {
      u.notify(e.app, m.id, 'info', 'New invention submitted: ' + d.getString('title'), 'Submitted by ' + u.userLabel(e.app, actor) + '.', '#/invention/' + d.id, {});
    }
    u.audit(e.app, actor, 'update', 'disclosures', d.id, d.getString('title'), { stage: { from: 'draft', to: 'submitted' } }, '');
    return e.json(200, { ok: true });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/disclosures/move', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const d = u.byId(e.app, 'disclosures', String(b.id || ''));
    if (d === null) throw new Error('Invention not found.');
    const stages = ['draft', 'submitted', 'search', 'review', 'approved', 'drafting', 'filed', 'rejected', 'on_hold', 'merged', 'archived'];
    const to = String(b.stage || '');
    if (stages.indexOf(to) < 0) throw new Error('Unknown stage.');
    if ((to === 'rejected' || to === 'on_hold') && String(b.decision || '').trim() === '') throw new Error('Explain the decision so the inventor knows why.');
    const from = d.getString('stage');
    d.set('stage', to);
    if (b.decision !== undefined) {
      d.set('decision', String(b.decision).slice(0, 4000));
      d.set('decision_at', new Date().toISOString());
    }
    e.app.save(d);
    const sub = d.getString('submitted_by');
    if (sub && sub !== u.actorId(e)) {
      u.notify(e.app, sub, 'info', 'Your invention moved to ' + to.replace('_', ' ') + ': ' + d.getString('title'), String(b.decision || ''), '#/invention/' + d.id, {});
    }
    u.audit(e.app, u.actorId(e), 'update', 'disclosures', d.id, d.getString('title'), { stage: { from: from, to: to } }, String(b.decision || ''));
    return e.json(200, { ok: true });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/disclosures/review', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const d = u.byId(e.app, 'disclosures', String(b.id || ''));
    if (d === null) throw new Error('Invention not found.');
    const actor = u.actorId(e);
    const scores = u.asObject(b.scores);
    const criteria = u.findMany(e.app, 'scoring_criteria', 'enabled = true', 'order', 0);
    let sum = 0;
    let weights = 0;
    for (const c of criteria) {
      const v = Number(scores[c.getString('key')]);
      if (isNaN(v)) continue;
      const w = c.getFloat('weight') || 1;
      sum += v * w;
      weights += w;
    }
    const total = weights > 0 ? Math.round((sum / weights) * 10) / 10 : 0;
    let rv = u.findOne(e.app, 'disclosure_reviews', 'disclosure = {:d} && reviewer = {:r}', { d: d.id, r: actor });
    if (rv === null) rv = u.newRecord(e.app, 'disclosure_reviews', { disclosure: d.id, reviewer: actor });
    rv.set('scores', scores);
    rv.set('total', total);
    rv.set('comment', String(b.comment || '').slice(0, 4000));
    if (['file', 'hold', 'reject', 'more_info'].indexOf(b.recommendation) >= 0) rv.set('recommendation', b.recommendation);
    e.app.save(rv);
    const all = u.findMany(e.app, 'disclosure_reviews', 'disclosure = {:d}', '', 0, { d: d.id });
    let acc = 0;
    for (const x of all) acc += x.getFloat('total');
    d.set('score', all.length ? Math.round((acc / all.length) * 10) / 10 : 0);
    d.set('review_count', all.length);
    if (d.getString('stage') === 'submitted' || d.getString('stage') === 'search') d.set('stage', 'review');
    e.app.save(d);
    return e.json(200, { total: total, score: d.getFloat('score'), reviews: all.length });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/disclosures/convert', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const d = u.byId(e.app, 'disclosures', String(b.id || ''));
    if (d === null) throw new Error('Invention not found.');
    if (d.getString('matter')) throw new Error('This invention already has a filing.');
    const ipType = ['patent', 'utility_model', 'design'].indexOf(b.ip_type) >= 0 ? b.ip_type : 'patent';
    const jur = String(b.jurisdiction || 'US').toUpperCase();
    if (!/^[A-Z]{2}$/.test(jur)) throw new Error('Choose the first filing office.');
    const actor = u.actorId(e);
    const fam = u.newRecord(e.app, 'families', {
      kind: ipType === 'design' ? 'design' : 'patent',
      title: String(b.title || d.getString('title')),
      property: d.getString('property'),
      description: d.getString('summary'),
      technology_tags: u.j(d, 'tech_tags', []),
      products: d.getString('products'),
      strategy: 'maintain',
    });
    e.app.save(fam);
    const m = u.newRecord(e.app, 'matters', {
      ip_type: ipType,
      title: String(b.title || d.getString('title')),
      family: fam.id,
      property: d.getString('property'),
      jurisdiction: jur,
      route: b.route === 'provisional' ? 'provisional' : b.route === 'pct' ? 'pct' : 'national',
      relation: 'none',
      status: 'to_file',
      responsible: String(b.responsible || actor),
      abstract: d.getString('summary'),
    });
    e.app.save(m);
    for (const inv of u.findMany(e.app, 'involvements', 'disclosure = {:d}', '', 0, { d: d.id })) {
      const c1 = u.newRecord(e.app, 'involvements', { party: inv.getString('party'), role: 'inventor', matter: m.id, share: inv.getFloat('share') });
      e.app.save(c1);
      const c2 = u.newRecord(e.app, 'involvements', { party: inv.getString('party'), role: 'inventor', family: fam.id, share: inv.getFloat('share') });
      e.app.save(c2);
    }
    d.set('family', fam.id);
    d.set('matter', m.id);
    d.set('stage', 'drafting');
    e.app.save(d);
    // A public disclosure starts the clock: US and JP give 12 months, most other offices none.
    const bar = u.minDay([d.getString('public_disclosure_date'), d.getString('on_sale_date')]);
    if (bar !== '') {
      const due = u.addYMD(bar, 1, 0, 0);
      const dl = u.newRecord(e.app, 'deadlines', {
        title: 'File before the 12-month grace period ends (public disclosure or sale on ' + u.human(bar) + ')',
        matter: m.id,
        kind: 'hard',
        category: 'filing',
        status: 'open',
        due_date: u.toPb(due),
        source: 'system',
        calculation: {
          steps: [
            'Earliest public disclosure or offer for sale: ' + u.human(bar) + '.',
            'The US (35 U.S.C. 102(b)(1)) and Japan (Patent Act Art. 30) allow 12 months from the inventor\'s own disclosure: ' + u.human(due) + '.',
            'Europe, China and most other offices have no general grace period: protection there may already be lost.',
          ],
        },
        citation: '35 U.S.C. 102(b)(1); JP Patent Act Art. 30',
        assignee: String(b.responsible || actor),
      });
      e.app.save(dl);
    }
    u.audit(e.app, actor, 'create', 'matters', m.id, m.getString('title'), { from_invention: d.id }, 'Converted invention to a filing');
    engine.refreshMatterSummary(e.app, m.id);
    return e.json(200, { matter_id: m.id, family_id: fam.id, ref: u.byId(e.app, 'matters', m.id).getString('ref') });
  } catch (err) {
    return u.fail(e, err);
  }
});

/* ------------------------------------------------------------------ */
/* Product approvals                                                   */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/approvals/decide', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'edit');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const a = u.byId(e.app, 'approvals', String(b.id || ''));
    if (a === null) throw new Error('Approval not found.');
    const status = String(b.status || '');
    if (['approved', 'approved_with_changes', 'resubmit', 'rejected', 'in_review'].indexOf(status) < 0) throw new Error('Unknown decision.');
    if ((status === 'resubmit' || status === 'rejected' || status === 'approved_with_changes') && String(b.comment || '').trim() === '') {
      throw new Error('Tell the licensee what to change.');
    }
    const actor = u.actorId(e);
    const round = u.newRecord(e.app, 'approval_rounds', {
      approval: a.id,
      revision: a.getInt('revision') || 1,
      stage: a.getString('stage'),
      status: status,
      comment: String(b.comment || '').slice(0, 4000),
      decided_by: actor,
    });
    e.app.save(round);
    a.set('status', status);
    a.set('decided_by', actor);
    a.set('decided_at', new Date().toISOString());
    if ((status === 'approved' || status === 'approved_with_changes') && b.advance === true) {
      const stages = ['concept', 'pre_production', 'production_sample', 'packaging', 'final'];
      const i = stages.indexOf(a.getString('stage'));
      if (i >= 0 && i < stages.length - 1) {
        a.set('stage', stages[i + 1]);
        a.set('status', 'submitted');
        a.set('revision', 1);
      }
    }
    e.app.save(a);
    u.audit(e.app, actor, 'decide', 'approvals', a.id, a.getString('product_name'), { status: status, stage: a.getString('stage') }, String(b.comment || ''));
    return e.json(200, { ok: true, stage: a.getString('stage'), status: a.getString('status') });
  } catch (err) {
    return u.fail(e, err);
  }
});

/* ------------------------------------------------------------------ */
/* Office connections, FX, calendars, calendar feed                    */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/offices/save', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'admin');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const c = u.findOne(e.app, 'office_connections', 'office = {:o}', { o: String(b.office || '') });
    if (c === null) throw new Error('Unknown office.');
    if (b.enabled !== undefined) c.set('enabled', b.enabled === true);
    if (b.sandbox !== undefined) c.set('sandbox', b.sandbox === true);
    for (const k of ['api_key', 'client_secret', 'password']) {
      if (typeof b[k] === 'string' && b[k].trim() !== '') c.set(k, b[k].trim());
      if (b['clear_' + k] === true) c.set(k, '');
    }
    for (const k of ['client_id', 'username', 'notes']) if (typeof b[k] === 'string') c.set(k, b[k].trim());
    c.set('token', '');
    c.set('token_expires', '');
    const has = c.getString('api_key') !== '' || c.getString('client_secret') !== '' || c.getString('password') !== '';
    c.set('has_secret', has);
    if (!has && !c.getString('client_id')) c.set('status', 'not_configured');
    else if (!c.getBool('enabled')) c.set('status', 'paused');
    else if (c.getString('status') === 'not_configured' || c.getString('status') === 'paused') c.set('status', 'connected');
    e.app.save(c);
    u.audit(e.app, u.actorId(e), 'update', 'office_connections', c.id, c.getString('office'), { enabled: c.getBool('enabled'), has_secret: has }, 'Office connection updated');
    return e.json(200, { office: c.getString('office'), enabled: c.getBool('enabled'), has_secret: has, status: c.getString('status') });
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/offices/test', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const offices = require(`${__hooks}/lib_offices.js`);
  const denied = u.deny(e, 'admin');
  if (denied) return denied;
  try {
    return e.json(200, offices.testConnection(e.app, String(u.body(e).office || '')));
  } catch (err) {
    try {
      const c = u.findOne(e.app, 'office_connections', 'office = {:o}', { o: String(u.body(e).office || '') });
      if (c !== null) {
        c.set('status', 'error');
        c.set('last_error', String(err.message || err).slice(0, 2000));
        c.set('last_check', new Date().toISOString());
        e.app.save(c);
      }
    } catch {
      /* ignore */
    }
    return u.fail(e, err, 502);
  }
});

routerAdd('POST', '/api/ops/offices/sync-all', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const offices = require(`${__hooks}/lib_offices.js`);
  const denied = u.deny(e, 'manage');
  if (denied) return denied;
  try {
    return e.json(200, offices.syncAll(e.app, 'manual'));
  } catch (err) {
    return u.fail(e, err, 500);
  }
});

routerAdd('POST', '/api/ops/fx/refresh', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const fx = require(`${__hooks}/lib_fx.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'manage');
  if (denied) return denied;
  try {
    const res = fx.refreshEcb(e.app);
    engine.refreshAllRenewalCosts(e.app);
    return e.json(200, res);
  } catch (err) {
    return u.fail(e, err, 502);
  }
});

routerAdd('POST', '/api/ops/calendars/refresh', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const cal = require(`${__hooks}/lib_calendar.js`);
  const denied = u.deny(e, 'manage');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const out = {};
    const year = Number(b.year || new Date().getFullYear());
    const offices = b.office ? [String(b.office).toUpperCase()] : ['US', 'EP', 'EM', 'JP', 'WO'];
    for (const o of offices) {
      if (!cal.supported(o)) continue;
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
    return e.json(200, out);
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/calendar/feed', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const denied = u.deny(e, 'auth');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const actor = u.actorId(e);
    if (!actor) throw new Error('Calendar feeds belong to a person account.');
    // No scope given: read the current feed (created as "mine" the first time).
    let t = u.findOne(e.app, 'ics_tokens', 'user = {:u}', { u: actor });
    const current = t !== null ? t.getString('scope') || 'mine' : 'mine';
    const wanted = b.scope === 'all' || b.scope === 'mine' ? b.scope : current;
    const scope = wanted === 'all' && u.canEdit(e.auth) ? 'all' : 'mine';
    if (t === null || b.rotate === true) {
      if (t !== null) e.app.delete(t);
      t = u.newRecord(e.app, 'ics_tokens', { user: actor, token: u.randomToken(40), scope: scope });
    }
    t.set('scope', scope);
    e.app.save(t);
    return e.json(200, { path: '/api/ics/' + t.getString('token'), scope: scope });
  } catch (err) {
    return u.fail(e, err);
  }
});

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
/* Rules, digest, reports                                              */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/rules/test', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const denied = u.deny(e, 'read');
  if (denied) return denied;
  try {
    const b = u.body(e);
    const rr = u.byId(e.app, 'rules', String(b.rule_id || ''));
    if (rr === null) throw new Error('Rule not found.');
    const rule = engine.ruleObj(rr);
    const base = u.d10(b.base_date);
    if (!base) throw new Error('Enter a sample date.');
    const fields = {
      filing_date: u.toPb(u.d10(b.filing_date) || base),
      registration_date: u.toPb(u.d10(b.registration_date) || base),
      publication_date: u.toPb(u.d10(b.publication_date) || base),
      priority_claims: '[]',
      signed_date: u.toPb(base),
      term_end: u.toPb(base),
      expiry_date: '',
      tm_register: '',
      options: '{}',
      relation: 'none',
      parent: '',
      route: String(b.route || ''),
    };
    const shim = {
      id: 'test',
      getString: (f) => (fields[f] !== undefined ? fields[f] : ''),
      getInt: () => 0,
      getBool: () => false,
      get: (f) => (fields[f] !== undefined ? fields[f] : null),
    };
    const jur = String(b.jurisdiction || (rule.jurisdiction === '*' ? 'US' : rule.jurisdiction)).toUpperCase();
    const subject = { type: rule.ip_type === 'agreement' ? 'agreement' : rule.ip_type === 'work' ? 'work' : 'matter', id: 'test', record: shim, ip_type: rule.ip_type, jurisdiction: jur, route: String(b.route || ''), label: 'Test' };
    const buffer = Number(u.setting(e.app, 'target_buffer_days', 14)) || 0;
    const cycle = rule.every > 0 ? Number(b.cycle || rule.first) : 0;
    const c = engine.computeRule(e.app, rule, subject, base, cycle, u.asObject(b.overrides), buffer);
    if (c === null) throw new Error('This rule needs a base date that the sample does not provide.');
    return e.json(200, c);
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/digest/preview', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const digest = require(`${__hooks}/lib_digest.js`);
  const denied = u.deny(e, 'auth');
  if (denied) return denied;
  try {
    if (!u.actorId(e)) throw new Error('Digests belong to a person account.');
    return e.json(200, digest.buildDigest(e.app, e.auth, Number(u.body(e).days || 45)));
  } catch (err) {
    return u.fail(e, err);
  }
});

routerAdd('POST', '/api/ops/digest/send', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const digest = require(`${__hooks}/lib_digest.js`);
  const denied = u.deny(e, 'manage');
  if (denied) return denied;
  try {
    return e.json(200, digest.runDigest(e.app, true));
  } catch (err) {
    return u.fail(e, err, 500);
  }
});

routerAdd('POST', '/api/ops/reports/run', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const b = u.body(e);
  const denied = u.deny(e, b.report === 'audit' ? 'edit' : 'read');
  if (denied) return denied;
  try {
    return e.json(200, reports.runReport(e.app, String(b.report || ''), u.asObject(b.params)));
  } catch (err) {
    return u.fail(e, err);
  }
});
