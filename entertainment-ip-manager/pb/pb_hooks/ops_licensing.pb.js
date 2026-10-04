/// <reference path="../pb_data/types.d.ts" />
/**
 * Licensing verbs: product approvals (監修), seals (証紙), royalty
 * statements and the external portal (licensees, committee members and
 * outside reviewers).
 *
 * Portal routes check two things: the role level, and that the record's
 * portal_users include the caller. They return 404-style "not found" for a
 * record the caller cannot see, so ids do not leak.
 */

/* ------------------------------------------------------------------ */
/* Products and approvals                                              */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/products/submit-approval', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'licensing', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const p = o.need(e.app, 'products', b.product_id, 'Product', '商品');
    let files = [];
    try {
      files = e.findUploadedFiles('images') || [];
    } catch {
      files = [];
    }
    const rec = require(`${__hooks}/lib_licensing.js`).submit(e.app, p, {
      stage: o.str(b.stage) || 'concept',
      reviewers: o.list(b.reviewers).map(String),
      notes: o.str(b.notes),
      files: files,
      actorId: ctx.actor,
    });
    return { id: rec.id, stage: rec.getString('stage'), due_date: ctx.u.d10(rec.getString('due_date')), reviewers: ctx.u.j(rec, 'reviewers', []) };
  }),
);

routerAdd('POST', '/api/ops/products/advance', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'licensing', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const p = o.need(e.app, 'products', b.product_id, 'Product', '商品');
    const stage = o.str(b.stage);
    const stages = ['proposal', 'contract', 'concept', 'design', 'prototype', 'final_sample', 'packaging', 'mass_production', 'on_sale', 'sell_off', 'ended', 'cancelled'];
    if (stages.indexOf(stage) < 0) throw ctx.u.err('Unknown product stage.', '不明な商品段階です。');
    if ((stage === 'mass_production' || stage === 'on_sale') && !o.bool(b.force)) {
      const ok = ctx.u.findOne(e.app, 'approvals', 'product = {:p} && (stage = "final_sample" || stage = "mass_production_check") && status = "approved"', { p: p.id });
      if (ok === null) throw ctx.u.err('The final sample is not approved yet. Pass force with a reason to move on anyway.', '最終サンプルが未承認です。進める場合は理由を添えて force を指定してください。');
    }
    if (stage === 'cancelled' && o.str(b.reason) === '') throw ctx.u.err('Say why the product is cancelled.', '中止の理由を入力してください。');
    const from = p.getString('stage');
    p.set('stage', stage);
    e.app.save(p);
    ctx.u.audit(e.app, ctx.actor, 'update', 'products', p.id, p.getString('name'), { stage: [from, stage] }, o.str(b.reason));
    return { id: p.id, stage: stage };
  }),
);

// Internal staff decide any reviewer slot; an outside reviewer decides only their own.
routerAdd('POST', '/api/ops/approvals/decide', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const a = o.need(e.app, 'approvals', b.approval_id, 'Approval', '監修', ctx.u.isExternal(ctx.auth));
    if (ctx.u.isExternal(ctx.auth) && ctx.u.ids(a, 'portal_users').indexOf(ctx.actor) < 0) throw ctx.u.err('Approval not found.', '監修が見つかりません。');
    if (ctx.role === 'licensee' || ctx.role === 'committee_member') throw ctx.u.err('Your role cannot decide approvals.', 'あなたのロールでは監修の判定はできません。');
    let key = o.str(b.reviewer_key);
    if (!key) {
      for (const r of ctx.u.j(a, 'reviewers', [])) {
        if (r.decision === 'pending' && (r.user === ctx.actor || (!ctx.u.isExternal(ctx.auth) && r.kind === 'internal'))) {
          key = r.key;
          break;
        }
      }
    }
    let files = [];
    try {
      files = e.findUploadedFiles('images') || [];
    } catch {
      files = [];
    }
    const res = require(`${__hooks}/lib_licensing.js`).decide(e.app, a, key, o.str(b.decision), o.str(b.comment), ctx.auth, {
      copyright_check: ['ok', 'wrong', 'unchecked'].indexOf(o.str(b.copyright_check)) >= 0 ? o.str(b.copyright_check) : '',
      annotations: o.list(b.annotations),
      advance: o.bool(b.advance),
      files: files,
    });
    return { id: a.id, status: res.status, reviewers: ctx.u.j(res.approval, 'reviewers', []) };
  }),
);

routerAdd('POST', '/api/ops/approvals/resubmit', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const a = o.need(e.app, 'approvals', b.approval_id, 'Approval', '監修', ctx.u.isExternal(ctx.auth));
    const external = ctx.u.isExternal(ctx.auth);
    if (external && (ctx.role !== 'licensee' || ctx.u.ids(a, 'portal_users').indexOf(ctx.actor) < 0)) throw ctx.u.err('Approval not found.', '監修が見つかりません。');
    if (!external && !ctx.u.allowed(ctx.auth, 'licensing')) throw ctx.u.err('Your role cannot resubmit approvals.', 'あなたのロールでは再提出できません。');
    let files = [];
    try {
      files = e.findUploadedFiles('images') || [];
    } catch {
      files = [];
    }
    const rec = require(`${__hooks}/lib_licensing.js`).resubmit(e.app, a, o.str(b.notes), files, ctx.actor);
    return { id: rec.id, round: rec.getInt('round'), due_date: ctx.u.d10(rec.getString('due_date')) };
  }),
);

routerAdd('POST', '/api/ops/approvals/withdraw', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const a = o.need(e.app, 'approvals', b.approval_id, 'Approval', '監修', ctx.u.isExternal(ctx.auth));
    const external = ctx.u.isExternal(ctx.auth);
    if (external && (ctx.role !== 'licensee' || ctx.u.ids(a, 'portal_users').indexOf(ctx.actor) < 0)) throw ctx.u.err('Approval not found.', '監修が見つかりません。');
    if (!external && !ctx.u.allowed(ctx.auth, 'licensing')) throw ctx.u.err('Your role cannot withdraw approvals.', 'あなたのロールでは取下げできません。');
    if (['approved', 'rejected', 'withdrawn'].indexOf(a.getString('status')) >= 0) throw ctx.u.err('This approval is already closed.', 'この監修はすでに完了しています。');
    a.set('status', 'withdrawn');
    if (o.str(b.reason)) a.set('notes', (a.getString('notes') ? a.getString('notes') + '\n' : '') + 'Withdrawn: ' + o.str(b.reason));
    e.app.save(a);
    ctx.u.audit(e.app, ctx.actor, 'withdraw', 'approvals', a.id, a.getString('stage'), {}, o.str(b.reason));
    return { id: a.id, status: 'withdrawn' };
  }),
);

/* ------------------------------------------------------------------ */
/* Seals                                                               */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/seals/order', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'licensing', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const p = o.need(e.app, 'products', b.product_id, 'Product', '商品');
    const qty = Math.floor(o.num(b.quantity));
    if (!(qty > 0)) throw ctx.u.err('Enter a quantity above zero.', '1以上の数量を入力してください。');
    const rec = ctx.u.newRecord(e.app, 'seal_orders', {
      product: p.id,
      agreement: p.getString('agreement'),
      licensee: p.getString('licensee'),
      quantity: qty,
      unit_cost: o.num(b.unit_cost),
      currency: o.str(b.currency) || String(ctx.u.setting(e.app, 'home_currency', 'JPY')),
      ordered_date: ctx.u.toPb(ctx.u.today()),
      status: 'requested',
      notes: o.str(b.notes),
    });
    e.app.save(rec);
    ctx.u.audit(e.app, ctx.actor, 'create', 'seal_orders', rec.id, p.getString('name'), { quantity: qty }, '');
    return { id: rec.id, status: 'requested' };
  }),
);

routerAdd('POST', '/api/ops/seals/issue', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'licensing', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const s = o.need(e.app, 'seal_orders', b.order_id, 'Seal order', '証紙申請');
    const rec = require(`${__hooks}/lib_licensing.js`).issueSeals(e.app, s, { serial_from: o.str(b.serial_from), serial_to: o.str(b.serial_to), issued_date: o.str(b.issued_date), unit_cost: b.unit_cost }, ctx.actor);
    return { id: rec.id, serial_from: rec.getString('serial_from'), serial_to: rec.getString('serial_to'), status: rec.getString('status') };
  }),
);

routerAdd('POST', '/api/ops/seals/reconcile', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const s = o.need(e.app, 'seal_orders', b.order_id, 'Seal order', '証紙申請', ctx.u.isExternal(ctx.auth));
    const external = ctx.u.isExternal(ctx.auth);
    if (external && (ctx.role !== 'licensee' || ctx.u.ids(s, 'portal_users').indexOf(ctx.actor) < 0)) throw ctx.u.err('Seal order not found.', '証紙申請が見つかりません。');
    if (!external && !ctx.u.allowed(ctx.auth, 'licensing')) throw ctx.u.err('Your role cannot reconcile seals.', 'あなたのロールでは証紙を照合できません。');
    const rec = require(`${__hooks}/lib_licensing.js`).reconcileSeals(e.app, s, o.num(b.used), o.num(b.void), o.num(b.returned), ctx.actor);
    return { id: rec.id, status: rec.getString('status'), used: rec.getInt('used'), void: rec.getInt('void'), returned: rec.getInt('returned') };
  }),
);

routerAdd('POST', '/api/ops/seals/variance', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    if (!o.str(b.product_id) && !o.str(b.agreement_id)) throw ctx.u.err('Choose a product or an agreement.', '商品または契約を選んでください。');
    return { rows: require(`${__hooks}/lib_licensing.js`).sealVariance(e.app, { product: o.str(b.product_id), agreement: o.str(b.agreement_id) }) };
  }),
);

/* ------------------------------------------------------------------ */
/* Royalties                                                           */
/* ------------------------------------------------------------------ */

// Replace a statement's lines; the royalty_lines hook re-prices and re-totals the report.
routerAdd('POST', '/api/ops/royalties/add-lines', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'licensing', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const r = o.need(e.app, 'royalty_reports', b.report_id, 'Royalty statement', 'ロイヤリティ報告');
    if (r.getString('status') === 'paid') throw ctx.u.err('A paid statement cannot change.', '支払済みの報告は変更できません。');
    const lines = o.list(b.lines).map((l) => o.obj(l));
    let n = 0;
    e.app.runInTransaction((tx) => {
      if (o.bool(b.replace)) for (const old of ctx.u.findMany(tx, 'royalty_lines', 'report = {:r}', '', 0, { r: r.id })) tx.delete(old);
      for (const l of lines) {
        tx.save(
          ctx.u.newRecord(tx, 'royalty_lines', {
            report: r.id,
            product: o.str(l.product_id || l.product),
            description: o.str(l.description),
            territory: o.str(l.territory),
            manufactured_qty: o.num(l.manufactured_qty),
            sold_qty: o.num(l.sold_qty),
            retail_price: o.num(l.retail_price),
            wholesale_price: o.num(l.wholesale_price),
            rate: o.num(l.rate),
            currency: o.str(l.currency) || r.getString('currency'),
            notes: o.str(l.notes),
          }),
        );
        n += 1;
      }
    });
    const rr = ctx.u.byId(e.app, 'royalty_reports', r.id);
    if (rr.getString('status') === 'expected') {
      rr.set('status', 'received');
      if (!rr.getString('received_date')) rr.set('received_date', ctx.u.toPb(o.str(b.received_date) || ctx.u.today()));
    }
    const fresh = require(`${__hooks}/lib_licensing.js`).recalcReport(e.app, rr);
    return { added: n, gross_sales: fresh.getFloat('gross_sales'), royalty_due: fresh.getFloat('royalty_due'), mg_credit: fresh.getFloat('mg_credit'), late_interest: fresh.getFloat('late_interest') };
  }),
);

routerAdd('POST', '/api/ops/royalties/recalc', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'licensing', (b) => {
    const r = require(`${__hooks}/lib_ops.js`).need(e.app, 'royalty_reports', b.report_id, 'Royalty statement', 'ロイヤリティ報告');
    const fresh = require(`${__hooks}/lib_licensing.js`).recalcReport(e.app, r);
    return { gross_sales: fresh.getFloat('gross_sales'), royalty_due: fresh.getFloat('royalty_due'), mg_credit: fresh.getFloat('mg_credit'), late_interest: fresh.getFloat('late_interest') };
  }),
);

routerAdd('POST', '/api/ops/royalties/mg-status', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => {
    const a = require(`${__hooks}/lib_ops.js`).need(e.app, 'agreements', b.agreement_id, 'Agreement', '契約');
    return require(`${__hooks}/lib_licensing.js`).mgStatus(e.app, a);
  }),
);

routerAdd('POST', '/api/ops/royalties/record-payment', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'licensing', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const r = o.need(e.app, 'royalty_reports', b.report_id, 'Royalty statement', 'ロイヤリティ報告');
    const amount = o.num(b.amount, NaN);
    if (isNaN(amount) || amount < 0) throw ctx.u.err('Enter the amount received.', '受領額を入力してください。');
    r.set('paid_amount', amount);
    const owed = ctx.u.round2(r.getFloat('royalty_due') + r.getFloat('late_interest') - r.getFloat('mg_credit'));
    const short = ctx.u.round2(owed - amount);
    r.set('status', short > 0.5 && o.bool(b.dispute) ? 'disputed' : 'paid');
    if (o.str(b.note)) r.set('notes', (r.getString('notes') ? r.getString('notes') + '\n' : '') + o.str(b.note));
    e.app.save(r);
    ctx.u.audit(e.app, ctx.actor, 'payment', 'royalty_reports', r.id, ctx.u.d10(r.getString('period_end')), { amount: amount, owed: owed }, o.str(b.note));
    return { id: r.id, status: r.getString('status'), owed: owed, shortfall: short > 0 ? short : 0 };
  }),
);

/* ------------------------------------------------------------------ */
/* External portal                                                     */
/* ------------------------------------------------------------------ */

// Everything an external account can act on, in one call.
routerAdd('POST', '/api/ops/portal/context', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    const me = ctx.actor;
    const f = 'portal_users.id ?= {:u}';
    const p = { u: me };
    // Characters a licence covers: named in its grants, or belonging to a franchise it grants or names.
    const licensedCharacters = (a) => {
      const ids = {};
      const franchises = {};
      if (a.getString('franchise')) franchises[a.getString('franchise')] = true;
      for (const g of u.findMany(e.app, 'grants', 'agreement = {:a} && kind = "grant"', '', 0, { a: a.id })) {
        for (const cid of u.ids(g, 'characters')) ids[cid] = true;
        for (const fid of u.ids(g, 'franchises')) franchises[fid] = true;
      }
      for (const fid of Object.keys(franchises)) {
        for (const c of u.findMany(e.app, 'characters', 'franchise = {:f}', '', 0, { f: fid })) ids[c.id] = true;
      }
      const out = [];
      for (const cid of Object.keys(ids)) {
        const c = u.byId(e.app, 'characters', cid);
        if (c !== null) out.push({ id: c.id, name: c.getString('name') });
      }
      return out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    };
    const parties = o.partiesOf(e.app, ctx.auth).map((x) => ({ id: x.id, name: x.getString('name') }));
    const agreements = u.findMany(e.app, 'agreements', f, '-term_end', 200, p).map((a) => ({
      id: a.id,
      ref: a.getString('ref'),
      title: a.getString('title'),
      agreement_type: a.getString('agreement_type'),
      status: a.getString('status'),
      term_start: u.d10(a.getString('term_start')),
      term_end: u.d10(a.getString('term_end')),
      royalty_rate: a.getFloat('royalty_rate'),
      royalty_basis: a.getString('royalty_basis'),
      currency: a.getString('currency'),
      copyright_notice: a.getString('copyright_notice'),
      approval_stages: u.j(a, 'approval_stages', []),
      characters: licensedCharacters(a),
    }));
    const products = u.findMany(e.app, 'products', f, '-updated', 300, p).map((x) => ({
      id: x.id,
      ref: x.getString('ref'),
      name: x.getString('name'),
      stage: x.getString('stage'),
      agreement: x.getString('agreement'),
      sales_start: u.d10(x.getString('sales_start')),
      retail_price: x.getFloat('retail_price'),
      currency: x.getString('currency'),
    }));
    const approvals = u.findMany(e.app, 'approvals', f, '-updated', 300, p).map((a) => {
      const prod = u.byId(e.app, 'products', a.getString('product'));
      return {
      id: a.id,
      product: a.getString('product'),
      product_name: prod ? prod.getString('name') : '',
      product_ref: prod ? prod.getString('ref') : '',
      // Outside reviewers cannot read products; give them what they need to review.
      product_info: prod
        ? {
            name: prod.getString('name'),
            ref: prod.getString('ref'),
            category: prod.getString('category'),
            sales_start: u.d10(prod.getString('sales_start')),
            retail_price: prod.getFloat('retail_price'),
            currency: prod.getString('currency'),
            includes_voice: prod.getBool('includes_voice'),
          }
        : null,
      stage: a.getString('stage'),
      status: a.getString('status'),
      round: a.getInt('round'),
      due_date: u.d10(a.getString('due_date')),
      mine: u.j(a, 'reviewers', []).filter((r) => r.user === me && r.decision === 'pending').map((r) => r.key),
      };
    });
    const statements = u.findMany(e.app, 'royalty_reports', f, '-period_end', 100, p).map((r) => ({
      id: r.id,
      agreement: r.getString('agreement'),
      period_start: u.d10(r.getString('period_start')),
      period_end: u.d10(r.getString('period_end')),
      due_date: u.d10(r.getString('due_date')),
      status: r.getString('status'),
      royalty_due: r.getFloat('royalty_due'),
      currency: r.getString('currency'),
      lines: u.findMany(e.app, 'royalty_lines', 'report = {:r}', 'created', 500, { r: r.id }).map((l) => ({
        product: l.getString('product'),
        description: l.getString('description'),
        manufactured_qty: l.getFloat('manufactured_qty'),
        sold_qty: l.getFloat('sold_qty'),
        retail_price: l.getFloat('retail_price'),
        royalty: l.getFloat('royalty'),
      })),
    }));
    const seals = u.findMany(e.app, 'seal_orders', f, '-created', 200, p).map((x) => ({
      id: x.id,
      product: x.getString('product'),
      quantity: x.getInt('quantity'),
      serial_from: x.getString('serial_from'),
      serial_to: x.getString('serial_to'),
      status: x.getString('status'),
      used: x.getInt('used'),
      void: x.getInt('void'),
      returned: x.getInt('returned'),
    }));
    const committees = u.findMany(e.app, 'committees', f, 'name', 50, p).map((c) => ({ id: c.id, name: c.getString('name'), status: c.getString('status') }));
    const consents = u.findMany(e.app, 'consent_requests', f, '-created', 100, p).map((c) => ({
      id: c.id,
      committee: c.getString('committee'),
      subject: c.getString('subject'),
      due_date: u.d10(c.getString('due_date')),
      status: c.getString('status'),
      answers: u.j(c, 'answers', []),
    }));
    const distributions = u.findMany(e.app, 'distributions', f + ' && status != "draft"', '-period_end', 100, p).map((d) => ({
      id: d.id,
      committee: d.getString('committee'),
      period_end: u.d10(d.getString('period_end')),
      pool: d.getFloat('pool'),
      currency: d.getString('currency'),
      status: d.getString('status'),
      members: u.j(d, 'members', []),
    }));
    return { role: ctx.role, lang: ctx.lang, parties, agreements, products, approvals, statements, seals, committees, consents, distributions };
  }),
);

// A licensee proposes a product under one of its agreements and submits the first approval.
routerAdd('POST', '/api/ops/portal/submit-product', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    if (ctx.role !== 'licensee') throw u.err('Only a licensee account can propose products here.', 'この画面から商品を提案できるのはライセンシーのみです。');
    const a = o.need(e.app, 'agreements', b.agreement_id, 'Agreement', '契約', ctx.u.isExternal(ctx.auth));
    if (u.ids(a, 'portal_users').indexOf(ctx.actor) < 0) throw u.err('Agreement not found.', '契約が見つかりません。');
    if (['active', 'renewed'].indexOf(a.getString('status')) < 0) throw u.err('This agreement is not active.', 'この契約は有効ではありません。');
    const name = o.str(b.name);
    if (!name) throw u.err('Name the product.', '商品名を入力してください。');
    const mine = o.partiesOf(e.app, ctx.auth).map((x) => x.id);
    const licensee = mine.indexOf(a.getString('counterparty')) >= 0 ? a.getString('counterparty') : mine[0] || a.getString('counterparty');
    const p = u.newRecord(e.app, 'products', {
      name: name,
      sku: o.str(b.sku),
      jan: o.str(b.jan),
      agreement: a.id,
      licensee: licensee,
      franchise: a.getString('franchise'),
      work: a.getString('work'),
      characters: o.list(b.characters).map(String),
      category: o.str(b.category),
      channel: o.str(b.channel),
      occasion: o.str(b.occasion) || 'regular',
      sales_start: u.toPb(o.str(b.sales_start)),
      sales_model: o.str(b.sales_model) || 'stock',
      retail_price: o.num(b.retail_price),
      currency: o.str(b.currency) || a.getString('currency') || String(u.setting(e.app, 'home_currency', 'JPY')),
      includes_voice: o.bool(b.includes_voice),
      regions: o.str(b.regions),
      stage: 'proposal',
      notes: o.str(b.notes),
    });
    e.app.save(p);
    let files = [];
    try {
      files = e.findUploadedFiles('images') || [];
    } catch {
      files = [];
    }
    const appr = require(`${__hooks}/lib_licensing.js`).submit(e.app, u.byId(e.app, 'products', p.id), {
      stage: o.str(b.stage) || 'proposal',
      notes: o.str(b.notes),
      files: files,
      actorId: ctx.actor,
      source: 'portal',
    });
    return { product_id: p.id, ref: u.byId(e.app, 'products', p.id).getString('ref'), approval_id: appr.id, due_date: u.d10(appr.getString('due_date')) };
  }),
);

// A licensee submits the next stage for one of its products.
routerAdd('POST', '/api/ops/portal/submit-stage', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    if (ctx.role !== 'licensee') throw u.err('Only a licensee account can submit here.', 'ここから提出できるのはライセンシーのみです。');
    const p = o.need(e.app, 'products', b.product_id, 'Product', '商品', ctx.u.isExternal(ctx.auth));
    if (u.ids(p, 'portal_users').indexOf(ctx.actor) < 0) throw u.err('Product not found.', '商品が見つかりません。');
    let files = [];
    try {
      files = e.findUploadedFiles('images') || [];
    } catch {
      files = [];
    }
    const appr = require(`${__hooks}/lib_licensing.js`).submit(e.app, p, { stage: o.str(b.stage), notes: o.str(b.notes), files: files, actorId: ctx.actor, source: 'portal' });
    return { approval_id: appr.id, due_date: u.d10(appr.getString('due_date')) };
  }),
);

// A licensee files the lines of an expected royalty statement.
routerAdd('POST', '/api/ops/portal/submit-statement', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    if (ctx.role !== 'licensee') throw u.err('Only a licensee account can file statements.', '報告を提出できるのはライセンシーのみです。');
    const r = o.need(e.app, 'royalty_reports', b.report_id, 'Royalty statement', 'ロイヤリティ報告', ctx.u.isExternal(ctx.auth));
    if (u.ids(r, 'portal_users').indexOf(ctx.actor) < 0) throw u.err('Royalty statement not found.', 'ロイヤリティ報告が見つかりません。');
    if (['expected', 'received'].indexOf(r.getString('status')) < 0) throw u.err('This statement is closed. Contact the licensor to change it.', 'この報告は確定済みです。変更はライセンサーにご連絡ください。');
    const lines = o.list(b.lines).map((l) => o.obj(l));
    if (!lines.length) throw u.err('Add at least one line.', '1行以上入力してください。');
    const ownProducts = {};
    for (const p of u.findMany(e.app, 'products', 'agreement = {:a}', '', 0, { a: r.getString('agreement') })) ownProducts[p.id] = true;
    e.app.runInTransaction((tx) => {
      for (const old of u.findMany(tx, 'royalty_lines', 'report = {:r}', '', 0, { r: r.id })) tx.delete(old);
      for (const l of lines) {
        const pid = o.str(l.product_id || l.product);
        if (pid && !ownProducts[pid]) throw u.err('A line names a product outside this agreement.', '契約外の商品が含まれています。');
        tx.save(
          u.newRecord(tx, 'royalty_lines', {
            report: r.id,
            product: pid,
            description: o.str(l.description),
            territory: o.str(l.territory),
            manufactured_qty: o.num(l.manufactured_qty),
            sold_qty: o.num(l.sold_qty),
            retail_price: o.num(l.retail_price),
            wholesale_price: o.num(l.wholesale_price),
            currency: o.str(l.currency) || r.getString('currency'),
            notes: o.str(l.notes),
          }),
        );
      }
    });
    const rr = u.byId(e.app, 'royalty_reports', r.id);
    rr.set('status', 'received');
    rr.set('received_date', u.toPb(u.today()));
    const fresh = require(`${__hooks}/lib_licensing.js`).recalcReport(e.app, rr);
    u.audit(e.app, ctx.actor, 'submit', 'royalty_reports', r.id, u.d10(r.getString('period_end')), { lines: lines.length }, 'portal');
    const a = u.byId(e.app, 'agreements', r.getString('agreement'));
    const resp = a ? a.getString('responsible') : '';
    if (resp) {
      u.notify(e.app, resp, 'royalty', u.bi('Royalty statement filed: ' + (a ? a.getString('ref') : ''), 'ロイヤリティ報告の提出：' + (a ? a.getString('ref') : '')), u.bi('Period ending ' + u.human(u.d10(r.getString('period_end'))), u.humanJa(u.d10(r.getString('period_end'))) + '締め'), '#/royalties/' + r.id, { report: r.id });
    }
    return { id: r.id, royalty_due: fresh.getFloat('royalty_due'), status: 'received' };
  }),
);

// A licensee asks for seals for one of its products.
routerAdd('POST', '/api/ops/portal/order-seals', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'portal', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    if (ctx.role !== 'licensee') throw u.err('Only a licensee account can order seals.', '証紙を申請できるのはライセンシーのみです。');
    const p = o.need(e.app, 'products', b.product_id, 'Product', '商品', ctx.u.isExternal(ctx.auth));
    if (u.ids(p, 'portal_users').indexOf(ctx.actor) < 0) throw u.err('Product not found.', '商品が見つかりません。');
    const qty = Math.floor(o.num(b.quantity));
    if (!(qty > 0)) throw u.err('Enter a quantity above zero.', '1以上の数量を入力してください。');
    const rec = u.newRecord(e.app, 'seal_orders', {
      product: p.id,
      agreement: p.getString('agreement'),
      licensee: p.getString('licensee'),
      quantity: qty,
      currency: p.getString('currency') || String(u.setting(e.app, 'home_currency', 'JPY')),
      ordered_date: u.toPb(u.today()),
      status: 'requested',
      notes: o.str(b.notes),
    });
    e.app.save(rec);
    u.audit(e.app, ctx.actor, 'create', 'seal_orders', rec.id, p.getString('name'), { quantity: qty }, 'portal');
    return { id: rec.id, status: 'requested' };
  }),
);
