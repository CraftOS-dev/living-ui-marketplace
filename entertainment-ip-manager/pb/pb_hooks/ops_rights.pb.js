/// <reference path="../pb_data/types.d.ts" />
/**
 * Rights verbs: "Can we?", availability, grant conflicts, agreement
 * obligations, copyright terms, the character rights stack, committee
 * waterfall, recoupment, who decides, and committee consent requests.
 */

routerAdd('POST', '/api/ops/rights/can-we', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const assets = o.list(b.assets).map((a) => (typeof a === 'string' ? { type: a.slice(0, a.indexOf(':')), id: a.slice(a.indexOf(':') + 1) } : { type: String(a.type), id: String(a.id) }));
    if (!assets.length) throw ctx.u.err('Choose at least one franchise, title, character, song or recording.', 'フランチャイズ・作品・キャラクター・楽曲・原盤を1つ以上選んでください。');
    const COLL = { franchise: 'franchises', work: 'titles', character: 'characters', song: 'songs', recording: 'recordings', matter: 'matters' };
    for (const a of assets) {
      a.type = { title: 'work', titles: 'work', trademark: 'matter', design: 'matter' }[a.type] || a.type;
      if (!COLL[a.type]) throw ctx.u.err('Unknown asset type "' + a.type + '". Use franchise, work, character, song, recording or matter.', '不明な対象の種類です：' + a.type);
      // Accept an id, a reference or an exact name ("character:Hikari").
      const rec = o.resolve(e.app, COLL[a.type], a.id);
      if (rec === null) throw ctx.u.err('No ' + a.type + ' "' + a.id + '" was found. Give its id, reference or exact name.', '対象が見つかりません：' + a.type + '「' + a.id + '」');
      a.id = rec.id;
    }
    return require(`${__hooks}/lib_rights.js`).canWe(e.app, {
      assets: assets,
      column: o.str(b.column) || 'territory',
      columns: o.list(b.columns).map(String),
      filters: o.obj(b.filters),
      start: o.str(b.start),
      end: o.str(b.end),
      exclusive: o.bool(b.exclusive),
      includes_voice: o.bool(b.includes_voice),
      exclude_agreement: o.str(b.exclude_agreement),
    });
  }),
);

routerAdd('POST', '/api/ops/rights/availability', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const assets = o.list(b.assets).map((a) => (typeof a === 'string' ? { type: a.slice(0, a.indexOf(':')), id: a.slice(a.indexOf(':') + 1) } : { type: String(a.type), id: String(a.id) }));
    if (!assets.length) throw ctx.u.err('Choose at least one asset.', '対象を1つ以上選んでください。');
    const COLL = { franchise: 'franchises', work: 'titles', character: 'characters', song: 'songs', recording: 'recordings', matter: 'matters' };
    for (const a of assets) {
      a.type = { title: 'work', titles: 'work', trademark: 'matter', design: 'matter' }[a.type] || a.type;
      if (!COLL[a.type]) throw ctx.u.err('Unknown asset type "' + a.type + '". Use franchise, work, character, song, recording or matter.', '不明な対象の種類です：' + a.type);
      // Accept an id, a reference or an exact name ("character:Hikari").
      const rec = o.resolve(e.app, COLL[a.type], a.id);
      if (rec === null) throw ctx.u.err('No ' + a.type + ' "' + a.id + '" was found. Give its id, reference or exact name.', '対象が見つかりません：' + a.type + '「' + a.id + '」');
      a.id = rec.id;
    }
    return require(`${__hooks}/lib_rights.js`).availability(e.app, {
      assets: assets,
      column: o.str(b.column) || 'territory',
      columns: o.list(b.columns).map(String),
      filters: o.obj(b.filters),
      start: o.str(b.start),
      end: o.str(b.end),
      exclusive: o.bool(b.exclusive),
      exclude_agreement: o.str(b.exclude_agreement),
    });
  }),
);

routerAdd('POST', '/api/ops/rights/dimensions', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'auth', () => require(`${__hooks}/lib_rights.js`).dimTree(e.app)),
);

routerAdd('POST', '/api/ops/agreements/check-conflicts', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const drafts = b.grants === undefined ? undefined : o.list(b.grants).map((g) => o.obj(g));
    return require(`${__hooks}/lib_rights.js`).conflicts(e.app, o.str(b.agreement_id), drafts);
  }),
);

// Rebuild an agreement's generated obligations (reports, payments, options, reversion, sell-off).
routerAdd('POST', '/api/ops/agreements/sync', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const a = require(`${__hooks}/lib_ops.js`).need(e.app, 'agreements', b.agreement_id, 'Agreement', '契約');
    const res = require(`${__hooks}/lib_obligations.js`).sync(e.app, 'agreement', a, ctx.actor);
    return Object.assign({ agreement: a.getString('ref') }, res);
  }),
);

routerAdd('POST', '/api/ops/titles/copyright-term', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const u = ctx.u;
    const engine = require(`${__hooks}/lib_engine.js`);
    const w = require(`${__hooks}/lib_ops.js`).need(e.app, 'titles', b.work_id || b.title_id, 'Title', '作品');
    const out = { id: w.id, title: w.getString('title'), terms: engine.copyrightTerms(w), children: [] };
    if (require(`${__hooks}/lib_ops.js`).bool(b.children)) {
      for (const c of u.findMany(e.app, 'titles', 'parent = {:p}', 'episode_number,title', 500, { p: w.id })) {
        out.children.push({ id: c.id, title: c.getString('title'), episode_number: c.getInt('episode_number'), terms: engine.copyrightTerms(c) });
      }
    }
    return out;
  }),
);

/**
 * A character's rights stack, layer by layer, with what is wrong:
 * unknown acquisition, an assignment that does not name Arts. 27 and 28,
 * no moral-rights non-exercise, a licence ending soon, payment overdue,
 * and the Freelance Act (written terms at commissioning, payment within
 * 60 days of delivery) for individual creators.
 */
routerAdd('POST', '/api/ops/characters/chain', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const u = ctx.u;
    const c = require(`${__hooks}/lib_ops.js`).need(e.app, 'characters', b.character_id, 'Character', 'キャラクター');
    const today = u.today();
    const layers = [];
    let blocks = 0;
    let warns = 0;
    const assets = u.findMany(e.app, 'character_assets', 'character = {:c}', 'component,created', 0, { c: c.id });
    for (const a of assets) {
      const issues = [];
      const add = (level, en, ja) => {
        issues.push({ level: level, text: u.bi(en, ja) });
        if (level === 'block') blocks += 1;
        if (level === 'warn') warns += 1;
      };
      const label = a.getString('label') || a.getString('component');
      const acq = a.getString('acquisition');
      const creator = a.getString('creator') ? u.byId(e.app, 'parties', a.getString('creator')) : null;
      const individual = creator !== null && creator.getString('kind') === 'person';
      if (acq === '' || acq === 'unknown') add('warn', 'How this layer was acquired is not recorded.', '権利取得方法が未登録です。');
      if (acq === 'assignment' && !a.getBool('art27_28')) {
        add('block', 'The assignment does not name Articles 27 and 28, so adaptation rights are presumed to stay with the creator (Art. 61(2)).', '譲渡契約に27条・28条の記載がなく、翻案権等は創作者に留保されたと推定されます（61条2項）。');
      }
      if (acq !== 'owned_original' && acq !== 'work_for_hire' && acq !== '' && acq !== 'unknown' && !a.getBool('moral_rights_waiver')) {
        add('warn', 'No non-exercise of moral rights. Changes may need the creator\'s consent (Art. 20).', '著作者人格権不行使の定めがありません。改変には同意が必要な場合があります（20条）。');
      }
      if (!a.getString('agreement') && acq !== 'owned_original' && acq !== 'work_for_hire') add('warn', 'No agreement is linked.', '契約が紐づいていません。');
      const lic = u.d10(a.getString('license_end'));
      if (lic !== '' && (acq === 'exclusive_license' || acq === 'nonexclusive_license')) {
        if (lic < today) add('block', 'The licence ended ' + u.human(lic) + '.', '利用許諾は' + u.humanJa(lic) + 'に終了しました。');
        else if (u.diffDays(today, lic) <= 180) add('warn', 'The licence ends ' + u.human(lic) + '.', '利用許諾は' + u.humanJa(lic) + 'に終了します。');
      }
      const due = u.d10(a.getString('payment_due'));
      const paid = u.d10(a.getString('paid_date'));
      if (due !== '' && paid === '' && due < today) add('warn', 'Payment was due ' + u.human(due) + ' and is not recorded as paid.', u.humanJa(due) + 'の支払期日を過ぎていますが、支払が記録されていません。');
      if (individual) {
        if (!u.d10(a.getString('order_terms_date'))) add('warn', 'No date for the written order terms. The Freelance Act requires them at commissioning.', '取引条件の明示日が未登録です。フリーランス法では発注時の明示が必要です。');
        const delivered = u.d10(a.getString('delivered_date'));
        if (delivered !== '' && due !== '' && u.diffDays(delivered, due) > 60) {
          add('warn', 'Payment is due more than 60 days after delivery (Freelance Act).', '支払期日が受領日から60日を超えています（フリーランス法）。');
        }
      }
      layers.push({
        id: a.id,
        component: a.getString('component'),
        label: label,
        version: a.getString('version'),
        acquisition: acq,
        creator: creator ? creator.getString('name') : '',
        agreement: a.getString('agreement'),
        status: a.getString('status'),
        derived_from: a.getString('derived_from'),
        issues: issues,
      });
    }
    const missing = [];
    const have = {};
    for (const l of layers) have[l.component] = true;
    const kind = c.getString('kind');
    const expected = kind === 'vtuber_persona' ? ['name', 'design_sheet', 'live2d_model', 'voice'] : kind === 'virtual_singer' ? ['name', 'design_sheet', 'voice'] : ['name', 'design_sheet'];
    for (const x of expected) if (!have[x]) missing.push(x);
    return {
      character: { id: c.id, name: c.getString('name'), ownership_model: c.getString('ownership_model') },
      layers: layers,
      missing_components: missing,
      verdict: blocks ? 'blocked' : warns || missing.length ? 'attention' : 'clear',
    };
  }),
);

/* ------------------------------------------------------------------ */
/* Committees                                                          */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/committees/compute', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_committee.js`);
    const c = o.need(e.app, 'committees', b.committee_id, 'Committee', '製作委員会');
    const res = lib.compute(e.app, c, { receipts: o.list(b.receipts).map((r) => o.obj(r)) });
    res.shares = lib.checkShares(e.app, c.id);
    return res;
  }),
);

routerAdd('POST', '/api/ops/committees/save-distribution', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'rights', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_committee.js`);
    const c = o.need(e.app, 'committees', b.committee_id, 'Committee', '製作委員会');
    if (!ctx.u.d10(b.period_end)) throw ctx.u.err('Give the period end date.', '対象期間の終了日を入力してください。');
    const shares = lib.checkShares(e.app, c.id);
    if (!shares.ok && o.str(b.status) === 'issued') throw ctx.u.err(shares.message.en, shares.message.ja);
    const res = lib.saveDistribution(
      e.app,
      c,
      {
        id: o.str(b.id),
        receipts: o.list(b.receipts).map((r) => o.obj(r)),
        period_start: o.str(b.period_start),
        period_end: o.str(b.period_end),
        due_date: o.str(b.due_date),
        currency: o.str(b.currency),
        status: o.str(b.status),
        notes: o.str(b.notes),
      },
      ctx.actor,
    );
    return { id: res.record.id, status: res.record.getString('status'), calc: res.calc, shares: shares };
  }),
);

routerAdd('POST', '/api/ops/committees/mark-paid', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'rights', (b, ctx) => {
    const d = require(`${__hooks}/lib_ops.js`).need(e.app, 'distributions', b.distribution_id, 'Distribution', '分配明細');
    if (d.getString('status') === 'draft') throw ctx.u.err('Issue the statement before marking it paid.', '支払済みにする前に明細を発行してください。');
    d.set('status', 'paid');
    e.app.save(d);
    ctx.u.audit(e.app, ctx.actor, 'update', 'distributions', d.id, ctx.u.d10(d.getString('period_end')), { status: 'paid' }, '');
    return { id: d.id, status: 'paid' };
  }),
);

routerAdd('POST', '/api/ops/committees/recoupment', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => {
    const c = require(`${__hooks}/lib_ops.js`).need(e.app, 'committees', b.committee_id, 'Committee', '製作委員会');
    return require(`${__hooks}/lib_committee.js`).recoupment(e.app, c);
  }),
);

// Who decides a use: the window holder, or every member (Art. 65(2)) when no window covers it.
routerAdd('POST', '/api/ops/committees/who-decides', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const rights = require(`${__hooks}/lib_rights.js`);
    const c = o.need(e.app, 'committees', b.committee_id, 'Committee', '製作委員会');
    const cell = {};
    const f = o.obj(b.use);
    for (const k of Object.keys(f)) cell[k] = ctx.u.asArray(f[k]).map(String);
    if (!cell.territory) cell.territory = ['WORLD'];
    const start = ctx.u.d10(b.start) || ctx.u.today();
    const end = ctx.u.d10(b.end) || ctx.u.addYMD(start, 1, 0, -1);
    const res = rights.decider(e.app, rights.dimTree(e.app), c.id, cell, start, end, rights.loadGrants(e.app, ''));
    return res === null ? { committee: c.id, decider: null } : Object.assign({ committee: c.id }, res);
  }),
);

/* ------------------------------------------------------------------ */
/* Consent requests (Copyright Act Art. 65)                            */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/consent/open', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'rights', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const c = o.need(e.app, 'committees', b.committee_id, 'Committee', '製作委員会');
    const rec = require(`${__hooks}/lib_committee.js`).openConsent(
      e.app,
      c,
      { subject: o.str(b.subject), use: o.obj(b.use), agreement: o.str(b.agreement_id), product: o.str(b.product_id), due_date: o.str(b.due_date) },
      ctx.actor,
    );
    return { id: rec.id, status: rec.getString('status'), due_date: ctx.u.d10(rec.getString('due_date')), answers: ctx.u.j(rec, 'answers', []) };
  }),
);

// Internal staff record a member's answer; a committee_member account answers for its own company.
routerAdd('POST', '/api/ops/consent/answer', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const req = o.need(e.app, 'consent_requests', b.request_id, 'Consent request', '同意依頼', ctx.u.isExternal(ctx.auth));
    if (ctx.u.isExternal(ctx.auth) && ctx.u.ids(req, 'portal_users').indexOf(ctx.actor) < 0) throw ctx.u.err('Consent request not found.', '同意依頼が見つかりません。');
    let memberId = o.str(b.member_id);
    if (!memberId && ctx.role === 'committee_member') {
      const mine = o.partiesOf(e.app, ctx.auth).map((p) => p.id);
      for (const a of ctx.u.j(req, 'answers', [])) if (mine.indexOf(a.party) >= 0) memberId = a.member;
    }
    const rec = require(`${__hooks}/lib_committee.js`).answerConsent(e.app, req, memberId, o.str(b.answer), o.str(b.reason), ctx.auth);
    return { id: rec.id, status: rec.getString('status'), answers: ctx.u.j(rec, 'answers', []) };
  }),
);

routerAdd('POST', '/api/ops/consent/close', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'rights', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const req = o.need(e.app, 'consent_requests', b.request_id, 'Consent request', '同意依頼');
    const status = o.str(b.status);
    if (['withdrawn', 'expired', 'approved', 'refused'].indexOf(status) < 0) throw ctx.u.err('Close as withdrawn, expired, approved or refused.', '取下げ・期限切れ・承認・拒否のいずれかで終了してください。');
    if (req.getString('status') !== 'open') throw ctx.u.err('This consent request is already closed.', 'この同意依頼はすでに終了しています。');
    if (o.str(b.note) === '') throw ctx.u.err('Say why you are closing it.', '終了する理由を入力してください。');
    req.set('status', status);
    req.set('outcome_note', o.str(b.note).slice(0, 2000));
    e.app.save(req);
    ctx.u.audit(e.app, ctx.actor, 'close', 'consent_requests', req.id, req.getString('subject'), { status: status }, o.str(b.note));
    return { id: req.id, status: status };
  }),
);
