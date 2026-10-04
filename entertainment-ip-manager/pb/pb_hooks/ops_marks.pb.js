/// <reference path="../pb_data/types.d.ts" />
/**
 * Trademark and design verbs: office lookup, import and sync, designations,
 * the leak check, trademark coverage, renewals, office connections,
 * exchange rates and CSV import.
 */

routerAdd('POST', '/api/ops/matters/info', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => {
    const engine = require(`${__hooks}/lib_engine.js`);
    const offices = require(`${__hooks}/lib_offices.js`);
    const m = require(`${__hooks}/lib_ops.js`).need(e.app, 'matters', b.matter_id, 'Trademark or design', '商標・意匠');
    const src = m.getString('sync_source') && m.getString('sync_source') !== 'none' ? m.getString('sync_source') : offices.sourceFor(m.getString('ip_type'), m.getString('jurisdiction'));
    const state = offices.connectionState(e.app);
    return {
      expiry: engine.computeExpiry(e.app, m),
      sync: { source: src, label: src ? offices.OFFICE_LABEL[src] : '', connected: src ? !!(state[src] && state[src].enabled) : false },
    };
  }),
);

routerAdd('POST', '/api/ops/matters/lookup', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const offices = require(`${__hooks}/lib_offices.js`);
    const reports = require(`${__hooks}/lib_reports.js`);
    const ipType = String(b.ip_type || 'trademark') === 'design' ? 'design' : 'trademark';
    const jur = String(b.jurisdiction || '').toUpperCase();
    const number = String(b.number || '').trim();
    if (!number) throw u.err('Enter an application or registration number.', '出願番号または登録番号を入力してください。');
    const source = offices.sourceFor(ipType, jur);
    if (!source) {
      return {
        available: false,
        reason: 'No office data source for ' + jur + ' ' + ipType + '. Create the record by hand.',
        reason_ja: jur + 'の' + (ipType === 'design' ? '意匠' : '商標') + 'には官庁データ連携がありません。手入力で作成してください。',
      };
    }
    const state = offices.connectionState(e.app);
    if (!state[source] || !state[source].enabled) {
      return {
        available: false,
        reason: offices.OFFICE_LABEL[source] + ' is not connected. An admin can connect it in Settings, Office connections, or create the record by hand.',
        reason_ja: offices.OFFICE_LABEL[source] + 'に接続していません。管理者が設定の「官庁連携」で接続するか、手入力で作成してください。',
      };
    }
    const snap = offices.fetchSnapshot(e.app, source, number, ipType);
    const existing = [];
    for (const m of u.findMany(e.app, 'matters', 'jurisdiction = {:j}', '', 0, { j: jur })) {
      if (reports.normNum(m.getString('application_no')) === reports.normNum(number)) existing.push({ id: m.id, ref: m.getString('ref') });
    }
    return { available: true, source: source, snapshot: snap, existing: existing };
  }),
);

routerAdd('POST', '/api/ops/matters/import-office', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const engine = require(`${__hooks}/lib_engine.js`);
    const offices = require(`${__hooks}/lib_offices.js`);
    const reports = require(`${__hooks}/lib_reports.js`);
    const ipType = String(b.ip_type || 'trademark') === 'design' ? 'design' : 'trademark';
    const jur = String(b.jurisdiction || '').toUpperCase();
    const number = String(b.number || '').trim();
    const source = offices.sourceFor(ipType, jur);
    if (!source) throw u.err('No office data source for this office.', 'この官庁にはデータ連携がありません。');
    for (const m of u.findMany(e.app, 'matters', 'jurisdiction = {:j}', '', 0, { j: jur })) {
      if (reports.normNum(m.getString('application_no')) === reports.normNum(number)) throw u.err('Already in the register as ' + m.getString('ref') + '.', 'すでに' + m.getString('ref') + 'として登録されています。');
    }
    const snap = offices.fetchSnapshot(e.app, source, number, ipType);
    if (!snap.found) throw u.err('The office has no record for ' + number + '.', '官庁に' + number + 'の記録がありません。');
    let familyId = String(b.family_id || '');
    if (!familyId) {
      const fam = u.newRecord(e.app, 'families', {
        kind: ipType,
        title: String(b.family_title || snap.title || number),
        franchise: String(b.franchise_id || ''),
        character: String(b.character_id || ''),
        talent: String(b.talent_id || ''),
        strategy: 'maintain',
        word_element: ipType === 'trademark' ? snap.title : '',
        mark_type: ipType === 'trademark' ? 'word' : '',
      });
      e.app.save(fam);
      familyId = fam.id;
    }
    const m = u.newRecord(e.app, 'matters', {
      ip_type: ipType,
      title: snap.title || String(b.title || number),
      jurisdiction: jur,
      family: familyId,
      franchise: String(b.franchise_id || ''),
      character: String(b.character_id || ''),
      talent: String(b.talent_id || ''),
      route: String(b.route || (jur === 'WO' ? 'madrid' : 'national')),
      relation: 'none',
      application_no: number,
      publication_no: snap.publication_no,
      registration_no: snap.registration_no,
      owner_of_record: snap.owner,
      applicants: snap.applicants || '',
      office_status: snap.status_text,
      status: 'filed',
      sync_source: source,
      sync_enabled: true,
      sync_state: 'connected',
      last_synced: new Date().toISOString(),
      responsible: String(b.responsible || ''),
    });
    e.app.save(m);
    for (const c of snap.classes || []) {
      e.app.save(u.newRecord(e.app, 'goods_services', { matter: m.id, nice_class: c.nice_class, spec: c.spec || '', class_status: snap.registration_date ? 'registered' : 'pending' }));
    }
    const evs = (snap.events || []).filter((x) => x.code && x.date).sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : 0));
    const seen = {};
    let created = 0;
    for (const ev of evs) {
      const k = ev.code + ev.date;
      if (seen[k]) continue;
      seen[k] = true;
      const res = engine.recordEvent(e.app, engine.subjectFromRecord('matter', u.byId(e.app, 'matters', m.id)), ev.code, ev.date, {
        label: ev.label,
        source: 'office',
        actorId: ctx.actor,
        data: { raw_code: ev.raw_code, office: source },
        commit: b.generate !== false && b.generate !== 'false',
      });
      created += res.created.length;
    }
    const fresh = u.byId(e.app, 'matters', m.id);
    if (snap.status && fresh.getString('status') !== snap.status) {
      fresh.set('status', snap.status);
      e.app.save(fresh);
    }
    engine.refreshMatterSummary(e.app, m.id);
    u.audit(e.app, ctx.actor, 'import', 'matters', m.id, u.byId(e.app, 'matters', m.id).getString('ref'), { source: source, number: number, deadlines: created }, 'Imported from ' + offices.OFFICE_LABEL[source]);
    return { id: m.id, ref: u.byId(e.app, 'matters', m.id).getString('ref'), deadlines: created, family_id: familyId };
  }),
);

routerAdd('POST', '/api/ops/matters/sync', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const offices = require(`${__hooks}/lib_offices.js`);
    const m = require(`${__hooks}/lib_ops.js`).need(e.app, 'matters', b.matter_id, 'Trademark or design', '商標・意匠');
    const res = offices.syncMatter(e.app, m, 'manual');
    if (res.error) throw ctx.u.err('Office sync failed: ' + res.error, '官庁データの同期に失敗しました：' + res.error);
    return res;
  }),
);

// Child filings from a mark: Madrid designations or national filings claiming its priority.
routerAdd('POST', '/api/ops/matters/designate', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const engine = require(`${__hooks}/lib_engine.js`);
    const parent = require(`${__hooks}/lib_ops.js`).need(e.app, 'matters', b.matter_id, 'Trademark or design', '商標・意匠');
    const relation = ['designation', 'priority', 'divisional', 'related'].indexOf(b.relation) >= 0 ? b.relation : 'designation';
    const jurs = u.asArray(b.jurisdictions).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
    if (!jurs.length) throw u.err('Choose at least one office.', '官庁を1つ以上選んでください。');
    let familyId = parent.getString('family');
    if (!familyId) {
      const fam = u.newRecord(e.app, 'families', {
        kind: parent.getString('ip_type'),
        title: parent.getString('title'),
        franchise: parent.getString('franchise'),
        character: parent.getString('character'),
        talent: parent.getString('talent'),
        strategy: 'maintain',
      });
      e.app.save(fam);
      familyId = fam.id;
      parent.set('family', familyId);
      e.app.save(parent);
    }
    const out = [];
    let deadlines = 0;
    for (const j of jurs) {
      const filing = relation === 'designation' ? u.d10(parent.getString('registration_date')) || u.d10(parent.getString('filing_date')) : u.d10(b.filing_date) || u.today();
      const child = u.newRecord(e.app, 'matters', {
        ip_type: parent.getString('ip_type'),
        title: parent.getString('title'),
        family: familyId,
        franchise: parent.getString('franchise'),
        character: parent.getString('character'),
        talent: parent.getString('talent'),
        work: parent.getString('work'),
        jurisdiction: j,
        route: relation === 'designation' ? 'designation' : 'national',
        relation: relation,
        parent: parent.id,
        priority_claims: relation === 'priority' ? [{ jurisdiction: parent.getString('jurisdiction'), number: parent.getString('application_no'), date: u.d10(parent.getString('filing_date')) }] : [],
        filing_date: u.toPb(filing),
        status: 'filed',
        owner_of_record: parent.getString('owner_of_record'),
        responsible: parent.getString('responsible'),
        counsel: parent.getString('counsel'),
        sync_enabled: true,
      });
      e.app.save(child);
      for (const g of u.findMany(e.app, 'goods_services', 'matter = {:m}', '', 0, { m: parent.id })) {
        if (u.asArray(b.classes).length && u.asArray(b.classes).map(Number).indexOf(g.getInt('nice_class')) < 0) continue;
        e.app.save(u.newRecord(e.app, 'goods_services', { matter: child.id, nice_class: g.getInt('nice_class'), spec: g.getString('spec'), class_status: 'pending' }));
      }
      if (filing) {
        deadlines += engine.recordEvent(e.app, engine.subjectFromRecord('matter', u.byId(e.app, 'matters', child.id)), 'FILED', filing, { source: 'system', actorId: ctx.actor, label: relation === 'designation' ? 'Designated under the Madrid Protocol' : 'Filed' }).created.length;
      }
      out.push({ id: child.id, ref: u.byId(e.app, 'matters', child.id).getString('ref'), jurisdiction: j });
    }
    u.audit(e.app, ctx.actor, 'create', 'matters', parent.id, parent.getString('ref'), { children: out }, relation);
    return { created: out, deadlines: deadlines };
  }),
);

// When will a filing become public, and is that before the announcement?
routerAdd('POST', '/api/ops/matters/leak-check', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const u = ctx.u;
    const lag = Number(u.setting(e.app, 'leak_lag_days', 14)) || 14;
    const filing = u.d10(b.filing_date) || u.today();
    const announce = u.d10(b.announcement_date);
    const jur = String(b.jurisdiction || 'JP').toUpperCase();
    const visible = u.addDays(filing, lag);
    const leaks = announce !== '' && visible < announce;
    return {
      filing_date: filing,
      visible_from: visible,
      announcement_date: announce,
      leaks: leaks,
      safe_filing_until: announce ? u.addDays(announce, -lag) : '',
      text: leaks
        ? u.bi(
            'A ' + jur + ' filing on ' + u.human(filing) + ' is likely public from about ' + u.human(visible) + ', before the announcement on ' + u.human(announce) + '. File after ' + u.human(u.addDays(announce, -lag)) + ' or accept the leak risk.',
            u.humanJa(filing) + 'の出願は' + u.humanJa(visible) + '頃から公開される見込みで、' + u.humanJa(announce) + 'の発表より前です。' + u.humanJa(u.addDays(announce, -lag)) + '以降に出願するか、公開リスクを受け入れてください。',
          )
        : u.bi('The filing should stay unseen until the announcement.', '発表まで出願は公開されない見込みです。'),
      note: u.bi(
        'Japanese filings usually appear on J-PlatPat about 2 to 3 weeks after filing. The lag is set in Settings.',
        '日本の出願は通常、出願から2から3週間ほどでJ-PlatPatに掲載されます。日数は設定で変更できます。',
      ),
    };
  }),
);

routerAdd('POST', '/api/ops/coverage/matrix', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const type = ['character', 'talent', 'franchise'].indexOf(b.subject_type) >= 0 ? b.subject_type : 'character';
    const id = String(b.subject_id || b[type + '_id'] || '');
    if (!id) throw ctx.u.err('Choose a character, talent or franchise.', 'キャラクター・タレント・フランチャイズを選んでください。');
    return require(`${__hooks}/lib_rights.js`).coverageMatrix(e.app, { type: type, id: id });
  }),
);

/* ------------------------------------------------------------------ */
/* Renewals                                                            */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/renewals/decide', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'rights', (b, ctx) => {
    const u = ctx.u;
    const engine = require(`${__hooks}/lib_engine.js`);
    const decision = String(b.decision || '');
    if (['renew', 'renew_partial', 'lapse', 'defer', 'pending'].indexOf(decision) < 0) throw u.err('Unknown decision.', '不明な判断です。');
    if (decision === 'lapse' && String(b.rationale || '').trim() === '') throw u.err('Give a reason for letting these rights lapse.', '権利を放棄する理由を入力してください。');
    let n = 0;
    const lapsed = [];
    for (const id of u.asArray(b.ids)) {
      const r = u.byId(e.app, 'renewals', String(id));
      if (r === null) continue;
      if (r.getString('instruction_status') === 'confirmed' || r.getString('instruction_status') === 'paid') continue;
      r.set('decision', decision);
      r.set('decided_by', ctx.actor);
      r.set('decided_at', new Date().toISOString());
      if (b.rationale !== undefined) r.set('rationale', String(b.rationale).slice(0, 2000));
      if (b.classes_keep !== undefined) r.set('classes_keep', u.asArray(b.classes_keep).map(Number));
      e.app.save(r);
      const dl = u.byId(e.app, 'deadlines', r.getString('deadline'));
      if (decision === 'lapse' && dl !== null && dl.getString('status') === 'open') {
        engine.closeDeadline(e.app, dl, 'not_needed', 'Decided not to renew: ' + String(b.rationale || ''), ctx.actor, u.today());
        const m = u.byId(e.app, 'matters', r.getString('matter'));
        if (m !== null) lapsed.push(m.getString('ref'));
      }
      u.audit(e.app, ctx.actor, 'decide', 'renewals', r.id, r.getString('cycle_label'), { decision: decision }, String(b.rationale || ''));
      n += 1;
    }
    return { updated: n, lapsing: lapsed };
  }),
);

routerAdd('POST', '/api/ops/renewals/instruct', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'rights', (b, ctx) => {
    const u = ctx.u;
    const provider = String(b.provider || '').trim();
    if (!provider) throw u.err('Name the renewal provider or agent.', '更新を依頼する代理人を入力してください。');
    const esc = (v) => {
      const s = String(v === null || v === undefined ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = ['Reference', 'Office', 'Type', 'Application no.', 'Registration no.', 'Renewal', 'Due date', 'Grace ends', 'Decision', 'Classes to keep', 'Official fee', 'Currency', 'PO number'];
    const lines = [header.map(esc).join(',')];
    const rows = [];
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
      u.audit(e.app, ctx.actor, 'instruct', 'renewals', r.id, m.getString('ref') + ' ' + r.getString('cycle_label'), { provider: provider }, '');
    }
    if (!rows.length) throw u.err('Select renewals decided as Renew.', '「更新」と判断した更新を選んでください。');
    const org = String(u.setting(e.app, 'org_name', '') || 'our organization');
    const ja = b.lang === 'ja' || (b.lang !== 'en' && ctx.lang === 'ja');
    const letter = ja
      ? [provider + ' 御中', '', org + 'を代理して、下記' + rows.length + '件の更新手続と官庁手数料の納付をお願いいたします。', b.po_number ? '発注番号：' + b.po_number : '', '受領のご連絡と、納付後の官庁領収書の送付をお願いいたします。', '']
          .concat(rows.map((x) => '・' + x[0] + '（' + x[1] + ' ' + (x[4] || x[3]) + '）：' + x[5] + '、期限 ' + x[6] + (x[9] ? '、維持する区分 ' + x[9] : '')))
          .concat(['', 'よろしくお願いいたします。', u.userLabel(e.app, ctx.actor), org])
      : ['Dear ' + provider + ',', '', 'Please pay the renewal fees for the ' + rows.length + ' right' + (rows.length === 1 ? '' : 's') + ' listed below on behalf of ' + org + '.', b.po_number ? 'Purchase order: ' + b.po_number + '.' : '', 'Please confirm receipt of these instructions and send the official receipts once paid.', '']
          .concat(rows.map((x) => '- ' + x[0] + ' (' + x[1] + ' ' + (x[4] || x[3]) + '): ' + x[5] + ', due ' + x[6] + (x[9] ? ', keep classes ' + x[9] : '')))
          .concat(['', 'Kind regards,', u.userLabel(e.app, ctx.actor), org]);
    return { instructed: rows.length, csv: lines.join('\n') + '\n', letter: letter.filter((x) => x !== '').join('\n') };
  }),
);

routerAdd('POST', '/api/ops/renewals/record-payment', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'rights', (b, ctx) => {
    const u = ctx.u;
    const engine = require(`${__hooks}/lib_engine.js`);
    const r = require(`${__hooks}/lib_ops.js`).need(e.app, 'renewals', b.id, 'Renewal', '更新');
    const paid = u.d10(b.paid_date) || u.today();
    r.set('paid_date', u.toPb(paid));
    if (b.amount !== undefined && b.amount !== '') r.set('paid_amount', Number(b.amount) || 0);
    r.set('instruction_status', 'confirmed');
    if (r.getString('decision') === 'pending' || r.getString('decision') === 'defer') r.set('decision', 'renew');
    e.app.save(r);
    const dl = u.byId(e.app, 'deadlines', r.getString('deadline'));
    let next = null;
    if (dl !== null && dl.getString('status') === 'open') next = engine.closeDeadline(e.app, dl, 'done', 'Paid on ' + u.human(paid), ctx.actor, paid).next;
    const m = u.byId(e.app, 'matters', r.getString('matter'));
    if (m !== null) {
      const isRenewal = dl !== null && dl.getString('category') === 'renewal' && m.getString('ip_type') === 'trademark' && r.getString('cycle_label').indexOf('half') < 0;
      engine.recordEvent(e.app, engine.subjectFromRecord('matter', m), isRenewal ? 'RENEWED' : 'ANNUITY_PAID', paid, {
        source: 'manual',
        actorId: ctx.actor,
        label: r.getString('cycle_label') + ' paid',
        label_ja: r.getString('cycle_label') + ' 納付',
        commit: false,
      });
      engine.refreshMatterSummary(e.app, m.id);
    }
    return { ok: true, next: next ? { id: next.id, title: next.getString('title'), due_date: u.d10(next.getString('due_date')) } : null };
  }),
);

routerAdd('POST', '/api/ops/renewals/forecast', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => require(`${__hooks}/lib_reports.js`).forecast(e.app, Math.min(10, Math.max(1, Number(b.years || 5))))),
);

routerAdd('POST', '/api/ops/renewals/refresh-costs', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const engine = require(`${__hooks}/lib_engine.js`);
    const ids = u.asArray(b.ids);
    const rows = ids.length ? ids.map((id) => u.byId(e.app, 'renewals', String(id))).filter((x) => x !== null) : u.findMany(e.app, 'renewals', 'instruction_status = "not_instructed"', '', 0);
    for (const r of rows) engine.refreshRenewalCost(e.app, r);
    return { refreshed: rows.length };
  }),
);

/* ------------------------------------------------------------------ */
/* Office connections, FX, import                                      */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/offices/save', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'admin', (b, ctx) => {
    const u = ctx.u;
    const c = u.findOne(e.app, 'office_connections', 'office = {:o}', { o: String(b.office || '') });
    if (c === null) throw u.err('Unknown office.', '不明な官庁です。');
    if (b.enabled !== undefined) c.set('enabled', b.enabled === true || b.enabled === 'true');
    if (b.sandbox !== undefined) c.set('sandbox', b.sandbox === true || b.sandbox === 'true');
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
    u.audit(e.app, ctx.actor, 'update', 'office_connections', c.id, c.getString('office'), { enabled: c.getBool('enabled'), has_secret: has }, 'Office connection updated');
    return { office: c.getString('office'), enabled: c.getBool('enabled'), has_secret: has, status: c.getString('status') };
  }),
);

routerAdd('POST', '/api/ops/offices/test', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (u.deny(e, 'admin')) return;
  const office = String(u.body(e).office || '');
  try {
    return e.json(200, require(`${__hooks}/lib_offices.js`).testConnection(e.app, office));
  } catch (err) {
    try {
      const c = u.findOne(e.app, 'office_connections', 'office = {:o}', { o: office });
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

routerAdd('POST', '/api/ops/offices/sync-all', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'manage', () => require(`${__hooks}/lib_offices.js`).syncAll(e.app, 'manual')),
);

routerAdd('POST', '/api/ops/fx/refresh', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'manage', () => {
    const res = require(`${__hooks}/lib_fx.js`).refreshEcb(e.app);
    require(`${__hooks}/lib_engine.js`).refreshAllRenewalCosts(e.app);
    return res;
  }),
);

routerAdd('POST', '/api/ops/import/matters', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const b = u.body(e);
  const dry = !(b.dry_run === false || b.dry_run === 'false');
  return require(`${__hooks}/lib_ops.js`).handle(e, dry ? 'edit' : 'manage', (body, ctx) => {
    const rows = u.asArray(body.rows);
    if (!rows.length) throw u.err('No rows to import.', '取り込む行がありません。');
    if (rows.length > 5000) throw u.err('Import at most 5,000 rows at a time.', '一度に取り込めるのは5,000行までです。');
    return require(`${__hooks}/lib_reports.js`).importMatters(e.app, rows, dry, !(body.generate === false || body.generate === 'false'), ctx.actor);
  });
});

routerAdd('POST', '/api/ops/import/watch', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const rows = ctx.u.asArray(b.rows);
    if (!rows.length) throw ctx.u.err('No rows to import.', '取り込む行がありません。');
    return require(`${__hooks}/lib_reports.js`).importWatch(e.app, rows, ctx.actor);
  }),
);
