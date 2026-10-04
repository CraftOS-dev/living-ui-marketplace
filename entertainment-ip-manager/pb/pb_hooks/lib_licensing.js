/// <reference path="../pb_data/types.d.ts" />
/**
 * The licensing desk: product approvals (監修), authenticity seals (証紙)
 * and royalty statements.
 *
 * Approvals: each stage has a reviewer chain built from the stage template
 * (internal licensing team, committee members, the original author's
 * publisher, the talent, outside reviewers). The reply is due a number of
 * working days after submission, counted on the organization's working
 * calendar. A rejection ends the item; "changes" asks the licensee for a new
 * round; when every reviewer approves, the stage is approved and the product
 * can move on. What a missed reply means comes from the licence (nothing,
 * deemed refused or deemed approved).
 *
 * Seals: orders record quantity, serial range and cost; licensees report
 * used, void and returned counts; the variance against the manufactured
 * quantity on royalty statements is the control.
 *
 * Royalties: each statement line is priced by the agreement's royalty basis
 * (retail x manufactured is the Japanese norm), totals roll up to the
 * report, a recoupable minimum guarantee is credited first and late
 * interest applies after the due date.
 */

function u_() {
  return require(`${__hooks}/lib_util.js`);
}

const STAGE_ORDER = [
  'proposal',
  'concept',
  'design',
  'color_proof',
  'prototype',
  'pre_production_sample',
  'final_sample',
  'packaging',
  'advertising',
  'mass_production_check',
];
const PRODUCT_STAGE_FOR = {
  proposal: 'proposal',
  concept: 'concept',
  design: 'design',
  color_proof: 'design',
  prototype: 'prototype',
  pre_production_sample: 'prototype',
  final_sample: 'final_sample',
  packaging: 'packaging',
  advertising: 'packaging',
  mass_production_check: 'mass_production',
};
const STAGE_LABEL = {
  proposal: ['Proposal', '企画'],
  concept: ['Concept', 'コンセプト'],
  design: ['Design', 'デザイン'],
  color_proof: ['Colour proof', '色校正'],
  prototype: ['Prototype', '試作'],
  pre_production_sample: ['Pre-production sample', '量産前サンプル'],
  final_sample: ['Final sample', '最終サンプル'],
  packaging: ['Packaging', 'パッケージ'],
  advertising: ['Advertising', '広告・販促物'],
  mass_production_check: ['Mass production check', '量産品確認'],
};

function stageTemplate(app, agreement) {
  const u = u_();
  let list = agreement ? u.j(agreement, 'approval_stages', []) : [];
  if (!Array.isArray(list) || !list.length) list = u.j(u.settings(app), 'approval_stages', []);
  if (!Array.isArray(list) || !list.length) {
    list = STAGE_ORDER.map(function (k) {
      return { key: k, label: STAGE_LABEL[k][0], label_ja: STAGE_LABEL[k][1], sla_days: 5, reviewers: ['internal'] };
    });
  }
  return list;
}

function templateFor(app, agreement, stage) {
  for (const s of stageTemplate(app, agreement)) if (s && s.key === stage) return s;
  return { key: stage, label: (STAGE_LABEL[stage] || [stage])[0], label_ja: (STAGE_LABEL[stage] || [stage, stage])[1], sla_days: 0, reviewers: ['internal'] };
}

function committeeOf(app, product) {
  const u = u_();
  const w = product.getString('work') ? u.byId(app, 'titles', product.getString('work')) : null;
  if (w && w.getString('committee')) return w.getString('committee');
  const f = product.getString('franchise') ? u.byId(app, 'franchises', product.getString('franchise')) : null;
  if (f && f.getString('committee')) return f.getString('committee');
  for (const cid of u.ids(product, 'characters')) {
    const ch = u.byId(app, 'characters', cid);
    const cf = ch && ch.getString('franchise') ? u.byId(app, 'franchises', ch.getString('franchise')) : null;
    if (cf && cf.getString('committee')) return cf.getString('committee');
  }
  return '';
}

/** The reviewer chain for one stage of one product. */
function buildReviewers(app, product, agreement, stage, outsideUsers) {
  const u = u_();
  const tpl = templateFor(app, agreement, stage);
  const kinds = Array.isArray(tpl.reviewers) && tpl.reviewers.length ? tpl.reviewers : ['internal'];
  const out = [];
  if (kinds.indexOf('internal') >= 0) {
    out.push({ key: 'internal', label: 'Licensing team', label_ja: '版権担当', kind: 'internal', decision: 'pending' });
  }
  if (kinds.indexOf('committee') >= 0) {
    const cid = committeeOf(app, product);
    if (cid) {
      for (const m of u.findMany(app, 'committee_members', 'committee = {:c} && status = "active"', 'created', 0, { c: cid })) {
        const name = m.getString('name') || (m.getString('party') ? (u.byId(app, 'parties', m.getString('party')) || { getString: function () { return ''; } }).getString('name') : '');
        out.push({ key: 'committee:' + m.id, label: name, label_ja: name, kind: 'committee', party: m.getString('party'), decision: 'pending' });
      }
    }
  }
  if (kinds.indexOf('original') >= 0) {
    const filters = [];
    const params = {};
    if (product.getString('franchise')) {
      filters.push('franchise = {:f}');
      params.f = product.getString('franchise');
    }
    if (product.getString('work')) {
      filters.push('work = {:w}');
      params.w = product.getString('work');
    }
    if (filters.length) {
      for (const a of u.findMany(app, 'agreements', 'agreement_type = "original_work_license" && original_approval_required = true && (' + filters.join(' || ') + ')', '', 0, params)) {
        const cp = a.getString('counterparty') ? u.byId(app, 'parties', a.getString('counterparty')) : null;
        const name = cp ? cp.getString('name') : 'Original author';
        out.push({ key: 'original:' + a.id, label: name, label_ja: name, kind: 'original', party: a.getString('counterparty'), decision: 'pending' });
      }
    }
  }
  if (kinds.indexOf('talent') >= 0) {
    const seen = {};
    for (const tid of u.ids(product, 'talents')) seen[tid] = true;
    for (const cid of u.ids(product, 'characters')) {
      for (const c of u.findMany(app, 'castings', 'character = {:c}', '', 0, { c: cid })) {
        if (u.d10(c.getString('end_date')) !== '' && u.d10(c.getString('end_date')) < u.today()) continue;
        seen[c.getString('talent')] = true;
      }
    }
    for (const tid of Object.keys(seen)) {
      const t = u.byId(app, 'talents', tid);
      if (t === null || t.getString('affiliation') === 'external') continue;
      out.push({ key: 'talent:' + tid, label: t.getString('stage_name'), label_ja: t.getString('stage_name'), kind: 'talent', decision: 'pending' });
    }
  }
  for (const uid of outsideUsers || []) {
    const usr = u.byId(app, 'users', uid);
    if (usr === null) continue;
    const name = usr.getString('name') || usr.getString('email');
    out.push({ key: 'reviewer:' + uid, label: name, label_ja: name, kind: 'reviewer', user: uid, decision: 'pending' });
  }
  if (!out.length) out.push({ key: 'internal', label: 'Licensing team', label_ja: '版権担当', kind: 'internal', decision: 'pending' });
  return out;
}

function slaDays(app, agreement, stage) {
  const u = u_();
  const tpl = templateFor(app, agreement, stage);
  if (agreement && agreement.getInt('approval_sla_days') > 0) return agreement.getInt('approval_sla_days');
  if (Number(tpl.sla_days) > 0) return Number(tpl.sla_days);
  return Number(u.setting(app, 'approval_sla_days', 5)) || 5;
}

function dueFor(app, agreement, stage, from) {
  const u = u_();
  const cal = require(`${__hooks}/lib_calendar.js`);
  const office = String(u.setting(app, 'work_calendar', 'JP') || 'JP');
  return cal.addBusinessDays(app, office, from, slaDays(app, agreement, stage)).date;
}

function notifyReviewers(app, approval, product, reviewers, actorId) {
  const u = u_();
  const stage = STAGE_LABEL[approval.getString('stage')] || [approval.getString('stage'), approval.getString('stage')];
  const name = product.getString('name');
  const title = u.bi('Approval requested: ' + name + ' (' + stage[0] + ')', '監修依頼：' + name + '（' + stage[1] + '）');
  const body = u.bi('Reply due ' + u.human(approval.getString('due_date')) + '.', '回答期限 ' + u.humanJa(approval.getString('due_date')) + '。');
  const link = '#/approvals/' + approval.id;
  const told = {};
  for (const r of reviewers) {
    if (r.kind === 'reviewer' && r.user && !told[r.user]) {
      told[r.user] = true;
      u.notify(app, r.user, 'approval', title, body, link, { approval: approval.id });
    }
  }
  for (const usr of u.usersWithRoles(app, ['licensing', 'manager'])) {
    if (usr.id === actorId || told[usr.id]) continue;
    told[usr.id] = true;
    u.notify(app, usr.id, 'approval', title, body, link, { approval: approval.id });
  }
}

/**
 * Submit a product for one approval stage. opts: { stage, notes, images (files), reviewers (user ids), actorId, source }
 * Returns the approval record.
 */
function submit(app, product, opts) {
  const u = u_();
  const o = opts || {};
  const stage = o.stage || 'concept';
  if (STAGE_ORDER.indexOf(stage) < 0) throw u.err('Unknown approval stage: ' + stage, '不明な監修段階：' + stage);
  const agreement = product.getString('agreement') ? u.byId(app, 'agreements', product.getString('agreement')) : null;
  const open = u.findOne(app, 'approvals', 'product = {:p} && stage = {:s} && (status = "submitted" || status = "in_review" || status = "changes_requested")', { p: product.id, s: stage });
  if (open !== null) {
    throw u.err('This product already has an open ' + stage.replace(/_/g, ' ') + ' approval. Resubmit that one instead.', 'この商品にはすでに未完了の監修があります。そちらを再提出してください。');
  }
  const outside = u.asArray(o.reviewers);
  const reviewers = buildReviewers(app, product, agreement, stage, outside);
  const today = u.today();
  const timeout = agreement ? agreement.getString('approval_timeout') || 'none' : 'none';
  const rec = u.newRecord(app, 'approvals', {
    product: product.id,
    agreement: agreement ? agreement.id : '',
    stage: stage,
    status: 'submitted',
    round: 1,
    submitted_at: u.toPb(today),
    due_date: u.toPb(dueFor(app, agreement, stage, today)),
    reviewers: reviewers,
    assigned_reviewers: outside,
    timeout_outcome: timeout,
    copyright_check: 'unchecked',
    notes: o.notes || '',
  });
  if (o.files && o.files.length) rec.set('images', o.files);
  app.save(rec);
  recordSubmission(app, rec, 1, o.notes || '', o.files, o.actorId || '');
  const ps = PRODUCT_STAGE_FOR[stage] || product.getString('stage');
  if (product.getString('stage') !== ps && ['on_sale', 'sell_off', 'ended', 'cancelled'].indexOf(product.getString('stage')) < 0) {
    product.set('stage', ps);
    app.save(product);
  }
  u.audit(app, o.actorId || '', 'submit', 'approvals', rec.id, product.getString('name') + ': ' + stage, { round: 1 }, o.source || '');
  notifyReviewers(app, rec, product, reviewers, o.actorId || '');
  return rec;
}

/**
 * One approval_rounds row per submission (status "submitted"), so each
 * round keeps what was submitted: the notes and the images, which the
 * approval itself replaces on resubmission. Decisions add their own rows.
 */
function recordSubmission(app, approval, round, notes, files, actorId) {
  const u = u_();
  const row = u.newRecord(app, 'approval_rounds', {
    approval: approval.id,
    round: round || 1,
    stage: approval.getString('stage'),
    status: 'submitted',
    reviewer_key: 'submission',
    comment: String(notes || '').slice(0, 4000),
    annotations: [],
    decided_by: actorId || '',
    decided_by_name: actorId ? u.userLabel(app, actorId) : '',
  });
  if (files && files.length) row.set('images', files);
  app.save(row);
  return row;
}

function statusFrom(reviewers) {
  let pending = 0;
  let changes = 0;
  let rejected = 0;
  for (const r of reviewers) {
    if (r.decision === 'rejected') rejected += 1;
    else if (r.decision === 'changes') changes += 1;
    else if (r.decision !== 'approved') pending += 1;
  }
  if (rejected) return 'rejected';
  if (changes && pending === 0) return 'changes_requested';
  if (pending === 0) return 'approved';
  return 'in_review';
}

/**
 * Record one reviewer's decision. decision: approved | changes | rejected.
 * The acting user must be internal staff with edit rights, or the reviewer named on the entry.
 */
function decide(app, approval, key, decision, comment, actor, opts) {
  const u = u_();
  const o = opts || {};
  if (['approved', 'changes', 'rejected'].indexOf(decision) < 0) throw u.err('Decision must be approved, changes or rejected.', '判定は承認・修正依頼・不承認のいずれかです。');
  const st = approval.getString('status');
  if (st !== 'submitted' && st !== 'in_review' && st !== 'changes_requested') {
    throw u.err('This approval is already ' + st.replace(/_/g, ' ') + '.', 'この監修はすでに完了しています。');
  }
  const reviewers = u.j(approval, 'reviewers', []);
  let entry = null;
  for (const r of reviewers) if (r.key === key) entry = r;
  if (entry === null) throw u.err('No reviewer "' + key + '" on this approval.', 'この監修に該当する確認者がいません。');
  const role = u.roleOf(actor);
  const actorUid = u.isSuperuser(actor) ? '' : actor ? actor.id : '';
  const internalOk = u.allowed(actor, 'edit');
  if (!internalOk && !(role === 'reviewer' && entry.user === actorUid)) {
    throw u.err('You can only record decisions for your own review.', '自分の確認分のみ判定を記録できます。');
  }
  if ((decision === 'changes' || decision === 'rejected') && String(comment || '').trim() === '') {
    throw u.err('Say what needs to change.', '修正内容を記入してください。');
  }
  entry.decision = decision;
  entry.comment = String(comment || '').slice(0, 4000);
  entry.decided_at = u.today();
  entry.decided_by = actorUid;
  const status = statusFrom(reviewers);
  approval.set('reviewers', reviewers);
  approval.set('status', status);
  if (o.copyright_check) approval.set('copyright_check', o.copyright_check);
  if (status === 'approved' || status === 'rejected') {
    approval.set('decided_by', actorUid);
    approval.set('decided_at', u.toPb(u.today()));
  }
  app.save(approval);
  const round = u.newRecord(app, 'approval_rounds', {
    approval: approval.id,
    round: approval.getInt('round') || 1,
    stage: approval.getString('stage'),
    status: decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'changes_requested',
    reviewer_key: key,
    comment: String(comment || '').slice(0, 4000),
    annotations: o.annotations || [],
    decided_by: actorUid,
    decided_by_name: actorUid ? u.userLabel(app, actorUid) : entry.label,
  });
  if (o.files && o.files.length) round.set('images', o.files);
  app.save(round);
  const product = u.byId(app, 'products', approval.getString('product'));
  u.audit(app, actorUid, 'decide', 'approvals', approval.id, (product ? product.getString('name') : '') + ': ' + key, { decision: decision, status: status }, comment || '');
  if (status !== 'in_review' && product) {
    const stage = STAGE_LABEL[approval.getString('stage')] || [approval.getString('stage'), approval.getString('stage')];
    const word = { approved: ['approved', '承認'], changes_requested: ['needs changes', '修正依頼'], rejected: ['rejected', '不承認'] }[status];
    const title = u.bi(product.getString('name') + ': ' + stage[0] + ' ' + word[0], product.getString('name') + '：' + stage[1] + ' ' + word[1]);
    for (const uid of u.ids(product, 'portal_users')) u.notify(app, uid, 'approval', title, u.bi(comment || '', comment || ''), '#/approvals/' + approval.id, { approval: approval.id });
    if (status === 'approved' && o.advance === true) advanceProduct(app, product, approval.getString('stage'));
  }
  return { approval: approval, status: status };
}

/** After an approved stage, move the product to the next stage. */
function advanceProduct(app, product, stage) {
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0) return;
  let next = i + 1 < STAGE_ORDER.length ? PRODUCT_STAGE_FOR[STAGE_ORDER[i + 1]] : 'mass_production';
  if (stage === 'mass_production_check') next = 'on_sale';
  const cur = product.getString('stage');
  if (['on_sale', 'sell_off', 'ended', 'cancelled'].indexOf(cur) >= 0) return;
  product.set('stage', next);
  app.save(product);
}

/** A new round after "changes": reviewers who asked for changes go back to pending. */
function resubmit(app, approval, notes, files, actorId) {
  const u = u_();
  if (approval.getString('status') !== 'changes_requested') {
    throw u.err('Only an approval waiting for changes can be resubmitted.', '修正依頼中の監修のみ再提出できます。');
  }
  const reviewers = u.j(approval, 'reviewers', []);
  for (const r of reviewers) {
    if (r.decision === 'changes') {
      r.decision = 'pending';
      r.previous_comment = r.comment;
      r.comment = '';
    }
  }
  const agreement = approval.getString('agreement') ? u.byId(app, 'agreements', approval.getString('agreement')) : null;
  approval.set('reviewers', reviewers);
  approval.set('round', (approval.getInt('round') || 1) + 1);
  approval.set('status', 'submitted');
  approval.set('submitted_at', u.toPb(u.today()));
  approval.set('due_date', u.toPb(dueFor(app, agreement, approval.getString('stage'), u.today())));
  approval.set('copyright_check', 'unchecked');
  approval.set('draft_comments', '');
  if (notes) approval.set('notes', notes);
  if (files && files.length) approval.set('images', files);
  app.save(approval);
  recordSubmission(app, approval, approval.getInt('round'), notes || '', files, actorId || '');
  const product = u.byId(app, 'products', approval.getString('product'));
  u.audit(app, actorId, 'resubmit', 'approvals', approval.id, product ? product.getString('name') : '', { round: approval.getInt('round') }, notes || '');
  if (product) notifyReviewers(app, approval, product, reviewers, actorId);
  return approval;
}

/** Apply "deemed" outcomes for replies that are overdue. Run daily. */
function applyTimeouts(app) {
  const u = u_();
  let n = 0;
  for (const a of u.findMany(app, 'approvals', '(status = "submitted" || status = "in_review") && due_date != "" && due_date < {:t}', '', 0, { t: u.toPb(u.today()) })) {
    const outcome = a.getString('timeout_outcome');
    if (outcome !== 'deemed_approved' && outcome !== 'deemed_refused') continue;
    const reviewers = u.j(a, 'reviewers', []);
    for (const r of reviewers) {
      if (r.decision === 'pending' || !r.decision) {
        r.decision = outcome === 'deemed_approved' ? 'approved' : 'rejected';
        r.comment = outcome === 'deemed_approved' ? 'Deemed approved: no reply by the due date (licence terms).' : 'Deemed refused: no reply by the due date (licence terms).';
        r.decided_at = u.today();
      }
    }
    a.set('reviewers', reviewers);
    a.set('status', outcome === 'deemed_approved' ? 'approved' : 'rejected');
    a.set('decided_at', u.toPb(u.today()));
    app.save(a);
    u.audit(app, '', 'timeout', 'approvals', a.id, a.getString('stage'), { outcome: outcome }, 'Reply due ' + u.d10(a.getString('due_date')));
    n += 1;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Seals                                                               */
/* ------------------------------------------------------------------ */

function nextSerial(app) {
  const u = u_();
  let max = 0;
  for (const s of u.findMany(app, 'seal_orders', 'serial_to != ""', '', 0)) {
    const n = parseInt(String(s.getString('serial_to')).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

function pad(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/** Issue a requested seal order: assigns a serial range when none is given. */
function issueSeals(app, order, opts, actorId) {
  const u = u_();
  const o = opts || {};
  if (order.getString('status') !== 'requested') throw u.err('Only a requested order can be issued.', '申請中の注文のみ発行できます。');
  const qty = order.getInt('quantity');
  if (!(qty > 0)) throw u.err('Set the quantity first.', '先に数量を入力してください。');
  let from = String(o.serial_from || '').trim();
  let to = String(o.serial_to || '').trim();
  if (from === '' || to === '') {
    const start = nextSerial(app);
    from = pad(start, 8);
    to = pad(start + qty - 1, 8);
  }
  order.set('serial_from', from);
  order.set('serial_to', to);
  order.set('issued_date', u.toPb(u.d10(o.issued_date) || u.today()));
  if (o.unit_cost !== undefined && o.unit_cost !== '') order.set('unit_cost', Number(o.unit_cost));
  order.set('status', 'issued');
  app.save(order);
  u.audit(app, actorId, 'issue', 'seal_orders', order.id, from + ' to ' + to, { quantity: qty }, '');
  return order;
}

/** Licensee reports used, void and returned counts. */
function reconcileSeals(app, order, used, voided, returned, actorId) {
  const u = u_();
  if (order.getString('status') !== 'issued' && order.getString('status') !== 'reconciled') throw u.err('Only issued seals can be reconciled.', '発行済みの証紙のみ照合できます。');
  const q = order.getInt('quantity');
  const total = Number(used || 0) + Number(voided || 0) + Number(returned || 0);
  if (total > q) throw u.err('Used, void and returned add up to ' + total + ', more than the ' + q + ' issued.', '使用・無効・返却の合計' + total + 'が発行数' + q + 'を超えています。');
  order.set('used', Number(used || 0));
  order.set('void', Number(voided || 0));
  order.set('returned', Number(returned || 0));
  if (total === q) order.set('status', 'reconciled');
  app.save(order);
  u.audit(app, actorId, 'reconcile', 'seal_orders', order.id, order.getString('serial_from') + ' to ' + order.getString('serial_to'), { used: used, void: voided, returned: returned }, '');
  return order;
}

/** Seals vs reported manufactured quantity for a product (or every product on an agreement). */
function sealVariance(app, filter) {
  const u = u_();
  const products = filter.product
    ? [u.byId(app, 'products', filter.product)].filter(Boolean)
    : u.findMany(app, 'products', 'agreement = {:a}', 'name', 0, { a: filter.agreement || '__none__' });
  const out = [];
  for (const p of products) {
    let issued = 0;
    let used = 0;
    let voided = 0;
    let returned = 0;
    for (const s of u.findMany(app, 'seal_orders', 'product = {:p} && status != "cancelled" && status != "requested"', '', 0, { p: p.id })) {
      issued += s.getInt('quantity');
      used += s.getInt('used');
      voided += s.getInt('void');
      returned += s.getInt('returned');
    }
    let manufactured = 0;
    for (const l of u.findMany(app, 'royalty_lines', 'product = {:p}', '', 0, { p: p.id })) manufactured += l.getInt('manufactured_qty');
    const variance = used - manufactured;
    out.push({
      product: p.id,
      name: p.getString('name'),
      issued: issued,
      used: used,
      void: voided,
      returned: returned,
      unaccounted: issued - used - voided - returned,
      manufactured_reported: manufactured,
      variance: variance,
      flag: issued > 0 && manufactured >= 0 && variance > 0,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Royalties                                                           */
/* ------------------------------------------------------------------ */

function rateFor(agreement, qty) {
  const u = u_();
  let rate = agreement.getFloat('royalty_rate');
  const tiers = u.j(agreement, 'rate_tiers', []);
  if (Array.isArray(tiers) && tiers.length) {
    const sorted = tiers
      .filter(function (t) {
        return t && Number(t.rate) > 0;
      })
      .sort(function (a, b) {
        return (Number(a.from_qty) || 0) - (Number(b.from_qty) || 0);
      });
    for (const t of sorted) if (qty >= (Number(t.from_qty) || 0)) rate = Number(t.rate);
  }
  return rate;
}

/** Price one statement line by the agreement's royalty basis. Mutates and returns the line values. */
function priceLine(agreement, line) {
  const u = u_();
  const basis = agreement.getString('royalty_basis') || 'retail_x_manufactured';
  const made = Number(line.manufactured_qty) || 0;
  const sold = Number(line.sold_qty) || 0;
  const retail = Number(line.retail_price) || 0;
  const wholesale = Number(line.wholesale_price) || 0;
  const qty = basis === 'retail_x_manufactured' || basis === 'per_seal' ? made : sold;
  const rate = line.rate !== undefined && line.rate !== '' && Number(line.rate) > 0 ? Number(line.rate) : rateFor(agreement, qty);
  let royalty = Number(line.royalty) || 0;
  let explain = '';
  if (basis === 'retail_x_manufactured') {
    royalty = retail * made * (rate / 100);
    explain = 'retail ' + retail + ' x manufactured ' + made + ' x ' + rate + '%';
  } else if (basis === 'retail_x_sold') {
    royalty = retail * sold * (rate / 100);
    explain = 'retail ' + retail + ' x sold ' + sold + ' x ' + rate + '%';
  } else if (basis === 'wholesale_net') {
    const cap = agreement.getFloat('deduction_cap_pct');
    let base = wholesale * sold;
    if (cap > 0 && line.deductions) base = base - Math.min(Number(line.deductions) || 0, (base * cap) / 100);
    royalty = base * (rate / 100);
    explain = 'net wholesale x ' + rate + '%';
  } else if (basis === 'net_receipts') {
    royalty = wholesale * (rate / 100);
    explain = 'net receipts ' + wholesale + ' x ' + rate + '%';
  } else if (basis === 'per_unit' || basis === 'per_seal') {
    royalty = rate * qty;
    explain = rate + ' per unit x ' + qty;
  }
  return { rate: rate, royalty: u.round2(royalty), explain: explain };
}

/** Recompute a statement's totals, minimum-guarantee credit and late interest. */
function recalcReport(app, report) {
  const u = u_();
  const agreement = u.byId(app, 'agreements', report.getString('agreement'));
  if (agreement === null) return report;
  let gross = 0;
  let due = 0;
  for (const l of u.findMany(app, 'royalty_lines', 'report = {:r}', '', 0, { r: report.id })) {
    const priced = priceLine(agreement, {
      manufactured_qty: l.getFloat('manufactured_qty'),
      sold_qty: l.getFloat('sold_qty'),
      retail_price: l.getFloat('retail_price'),
      wholesale_price: l.getFloat('wholesale_price'),
      rate: l.getFloat('rate'),
      royalty: l.getFloat('royalty'),
    });
    if (u.round2(l.getFloat('royalty')) !== priced.royalty || l.getFloat('rate') !== priced.rate) {
      l.set('royalty', priced.royalty);
      l.set('rate', priced.rate);
      app.save(l);
    }
    gross += (l.getFloat('retail_price') || l.getFloat('wholesale_price')) * (l.getFloat('sold_qty') || l.getFloat('manufactured_qty'));
    due += priced.royalty;
  }
  report.set('gross_sales', u.round2(gross));
  report.set('royalty_due', u.round2(due));
  // Minimum guarantee: a recoupable MG absorbs royalties until it is used up.
  let credit = 0;
  const mg = agreement.getFloat('minimum_guarantee') + agreement.getFloat('advance');
  if (mg > 0 && agreement.getBool('mg_recoupable')) {
    let before = 0;
    for (const r of u.findMany(app, 'royalty_reports', 'agreement = {:a} && period_end < {:p} && id != {:id}', '', 0, {
      a: agreement.id,
      p: report.getString('period_end'),
      id: report.id,
    })) {
      before += r.getFloat('royalty_due');
    }
    credit = Math.max(0, Math.min(due, mg - before));
  }
  report.set('mg_credit', u.round2(credit));
  // Late interest (percent per month or part of a month) on the payable part.
  const pct = agreement.getFloat('late_interest_pct');
  const dueDate = u.d10(report.getString('due_date'));
  const paidOn = u.d10(report.getString('received_date')) || (report.getString('status') === 'expected' ? u.today() : '');
  let interest = 0;
  if (pct > 0 && dueDate && paidOn && paidOn > dueDate) {
    const days = u.diffDays(dueDate, paidOn);
    const months = Math.ceil(days / 30);
    interest = (due - credit) * (pct / 100) * months;
  }
  report.set('late_interest', u.round2(Math.max(0, interest)));
  app.save(report);
  return report;
}

/** Minimum guarantee position for an agreement. */
function mgStatus(app, agreement) {
  const u = u_();
  const mg = agreement.getFloat('minimum_guarantee') + agreement.getFloat('advance');
  let earned = 0;
  let paid = 0;
  for (const r of u.findMany(app, 'royalty_reports', 'agreement = {:a}', 'period_end', 0, { a: agreement.id })) {
    earned += r.getFloat('royalty_due');
    paid += r.getFloat('paid_amount');
  }
  const recouped = Math.min(earned, mg);
  return {
    minimum_guarantee: mg,
    recoupable: agreement.getBool('mg_recoupable'),
    earned: u.round2(earned),
    recouped: u.round2(recouped),
    remaining: u.round2(Math.max(0, mg - earned)),
    overage: u.round2(Math.max(0, earned - mg)),
    paid: u.round2(paid),
    currency: agreement.getString('currency'),
  };
}

module.exports = {
  STAGE_ORDER: STAGE_ORDER,
  STAGE_LABEL: STAGE_LABEL,
  stageTemplate: stageTemplate,
  buildReviewers: buildReviewers,
  submit: submit,
  decide: decide,
  resubmit: resubmit,
  advanceProduct: advanceProduct,
  applyTimeouts: applyTimeouts,
  issueSeals: issueSeals,
  reconcileSeals: reconcileSeals,
  sealVariance: sealVariance,
  priceLine: priceLine,
  recalcReport: recalcReport,
  mgStatus: mgStatus,
  committeeOf: committeeOf,
};
