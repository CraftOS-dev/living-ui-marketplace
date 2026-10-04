/// <reference path="../pb_data/types.d.ts" />
/**
 * Production committees (製作委員会): the distribution waterfall and consent
 * requests.
 *
 * Waterfall (per period, Japan Animation Association 2024 model):
 *   window receipts
 *   - deductions per receipt (original-work fee, studio royalty, expenses)
 *   - window fee (the window holder's percentage of gross or net)
 *   = window net, summed across windows
 *   - committee-level steps from committees.waterfall, in order
 *     (lead fee, promotion lead fee, studio success fee, other deductions)
 *   = pool, paid to members by investment share.
 *
 * Consent: a use no window covers needs every member's agreement
 * (Copyright Act Art. 65(2)) unless the committee agreement says otherwise
 * (committees.consent_default); a member may not refuse without good reason
 * (Art. 65(3)), so a refusal must carry a reason.
 */

function u_() {
  return require(`${__hooks}/lib_util.js`);
}

function members(app, committeeId) {
  const u = u_();
  return u.findMany(app, 'committee_members', 'committee = {:c} && status != "exited"', 'created', 0, { c: committeeId });
}

function memberName(app, m) {
  const u = u_();
  if (m.getString('name')) return m.getString('name');
  const p = m.getString('party') ? u.byId(app, 'parties', m.getString('party')) : null;
  return p ? p.getString('name') : '';
}

/** Shares must add to 100 (within rounding); returns { ok, total, message }. */
function checkShares(app, committeeId) {
  const u = u_();
  let total = 0;
  for (const m of members(app, committeeId)) total += m.getFloat('share_pct');
  total = u.round2(total);
  const ok = Math.abs(total - 100) < 0.01;
  return {
    ok: ok,
    total: total,
    message: ok ? u.bi('Shares add up to 100%.', '出資比率の合計は100%です。') : u.bi('Shares add up to ' + total + '%, not 100%.', '出資比率の合計が' + total + '%で、100%になっていません。'),
  };
}

/**
 * Compute a distribution. input.receipts: [{ window, holder, gross, deductions: [{ label, amount }], fee_pct?, fee_base? }]
 * Returns the full statement (not saved).
 */
function compute(app, committee, input) {
  const u = u_();
  const receipts = u.asArray(input.receipts);
  const out = { receipts: [], gross_total: 0, deductions_total: 0, window_fees: 0, steps: [], lead_fee: 0, promo_fee: 0, success_fee: 0, pool: 0, members: [] };
  let netSum = 0;
  for (const r of receipts) {
    const gross = Number(r.gross) || 0;
    const deds = u.asArray(r.deductions).map(function (d) {
      return { label: d.label || '', amount: Number(d.amount) || 0 };
    });
    const dedTotal = deds.reduce(function (s, d) {
      return s + d.amount;
    }, 0);
    const feePct = Number(r.fee_pct) || 0;
    const feeBase = r.fee_base === 'gross' ? gross : gross - dedTotal;
    const fee = (feeBase * feePct) / 100;
    const net = gross - dedTotal - fee;
    out.receipts.push({
      window: r.window || '',
      holder: r.holder || '',
      gross: u.round2(gross),
      deductions: deds,
      fee_pct: feePct,
      fee_base: r.fee_base === 'gross' ? 'gross' : 'net',
      window_fee: u.round2(fee),
      net: u.round2(net),
    });
    out.gross_total += gross;
    out.deductions_total += dedTotal;
    out.window_fees += fee;
    netSum += net;
  }
  let pool = netSum;
  // Committee-level steps; the lead fee comes from the committee fields when no step names it.
  let steps = u.j(committee, 'waterfall', []);
  if (!Array.isArray(steps)) steps = [];
  const hasLead = steps.some(function (s) {
    return s && s.key === 'lead_fee';
  });
  if (!hasLead && committee.getFloat('lead_fee_pct') > 0) {
    steps = [{ key: 'lead_fee', label: 'Lead company fee', label_ja: '幹事手数料', kind: 'fee', pct: committee.getFloat('lead_fee_pct'), base: committee.getString('lead_fee_base') || 'net' }].concat(steps);
  }
  const hasPromo = steps.some(function (s) {
    return s && s.key === 'promo_fee';
  });
  if (!hasPromo && committee.getFloat('promo_fee_pct') > 0) {
    steps.push({ key: 'promo_fee', label: 'Promotion lead fee', label_ja: '宣伝幹事手数料', kind: 'fee', pct: committee.getFloat('promo_fee_pct'), base: 'net' });
  }
  for (const s of steps) {
    if (!s) continue;
    let amount = 0;
    const base = s.base === 'gross' ? out.gross_total : pool;
    if (Number(s.amount) > 0) amount = Number(s.amount);
    else if (Number(s.pct) > 0) amount = (base * Number(s.pct)) / 100;
    if (Number(s.cap_pct) > 0) amount = Math.min(amount, (base * Number(s.cap_pct)) / 100);
    if (s.kind === 'success_fee' && Number(s.threshold) > 0) {
      // Studio success fee: only once cumulative distributions pass the threshold (usually total investment).
      const paidBefore = cumulativePool(app, committee.id, input.period_start);
      if (paidBefore + pool < Number(s.threshold)) amount = 0;
    }
    amount = Math.max(0, Math.min(amount, pool));
    pool -= amount;
    out.steps.push({ key: s.key || '', label: s.label || '', label_ja: s.label_ja || s.label || '', kind: s.kind || 'deduction', amount: u.round2(amount) });
    if (s.key === 'lead_fee') out.lead_fee += amount;
    else if (s.key === 'promo_fee') out.promo_fee += amount;
    else if (s.kind === 'success_fee') out.success_fee += amount;
  }
  out.pool = u.round2(pool);
  const ms = members(app, committee.id);
  let allocated = 0;
  ms.forEach(function (m, i) {
    const pct = m.getFloat('share_pct');
    let amount = u.round2((pool * pct) / 100);
    if (i === ms.length - 1) amount = u.round2(pool - allocated);
    allocated += amount;
    out.members.push({ member: m.id, party: m.getString('party'), name: memberName(app, m), share_pct: pct, amount: amount });
  });
  out.gross_total = u.round2(out.gross_total);
  out.deductions_total = u.round2(out.deductions_total);
  out.window_fees = u.round2(out.window_fees);
  out.lead_fee = u.round2(out.lead_fee);
  out.promo_fee = u.round2(out.promo_fee);
  out.success_fee = u.round2(out.success_fee);
  out.shares = checkShares(app, committee.id);
  return out;
}

function cumulativePool(app, committeeId, before) {
  const u = u_();
  let total = 0;
  for (const d of u.findMany(app, 'distributions', 'committee = {:c} && status != "draft" && period_end < {:b}', '', 0, { c: committeeId, b: u.toPb(before || '9999-12-31') })) {
    total += d.getFloat('pool');
  }
  return total;
}

/** Recoupment: cumulative pool against total investment, per member and overall. */
function recoupment(app, committee) {
  const u = u_();
  let invested = 0;
  const per = [];
  const ms = members(app, committee.id);
  const totalPool = cumulativePool(app, committee.id, '9999-12-31');
  for (const m of ms) invested += m.getFloat('investment');
  for (const m of ms) {
    const received = (totalPool * m.getFloat('share_pct')) / 100;
    per.push({
      member: m.id,
      name: memberName(app, m),
      invested: m.getFloat('investment'),
      received: u.round2(received),
      recouped_pct: m.getFloat('investment') > 0 ? u.round2((received / m.getFloat('investment')) * 100) : 0,
    });
  }
  return {
    invested: u.round2(invested),
    distributed: u.round2(totalPool),
    recouped_pct: invested > 0 ? u.round2((totalPool / invested) * 100) : 0,
    members: per,
    currency: committee.getString('currency'),
  };
}

/** Save a distribution statement from compute(). */
function saveDistribution(app, committee, input, actorId) {
  const u = u_();
  const calc = compute(app, committee, input);
  const due =
    u.d10(input.due_date) ||
    (u.d10(input.period_end) ? u.addDays(u.d10(input.period_end), committee.getInt('distribution_due_days') || 60) : '');
  const rec = input.id ? u.byId(app, 'distributions', input.id) : u.newRecord(app, 'distributions', { committee: committee.id });
  if (rec === null) throw u.err('Distribution not found.', '分配明細が見つかりません。');
  if (rec.getString('status') === 'paid') throw u.err('A paid distribution cannot change.', '支払済みの分配明細は変更できません。');
  rec.set('committee', committee.id);
  rec.set('period_start', u.toPb(input.period_start));
  rec.set('period_end', u.toPb(input.period_end));
  rec.set('currency', input.currency || committee.getString('currency') || String(u.setting(app, 'home_currency', 'JPY')));
  rec.set('receipts', calc.receipts);
  rec.set('gross_total', calc.gross_total);
  rec.set('deductions_total', calc.deductions_total);
  rec.set('window_fees', calc.window_fees);
  rec.set('lead_fee', calc.lead_fee);
  rec.set('promo_fee', calc.promo_fee);
  rec.set('success_fee', calc.success_fee);
  rec.set('pool', calc.pool);
  rec.set('members', calc.members);
  rec.set('status', input.status === 'issued' ? 'issued' : rec.getString('status') || 'draft');
  if (input.status === 'issued') rec.set('issued_date', u.toPb(u.today()));
  rec.set('due_date', u.toPb(due));
  rec.set('notes', input.notes || rec.getString('notes'));
  rec.set('portal_users', u.ids(committee, 'portal_users'));
  app.save(rec);
  u.audit(app, actorId, input.id ? 'update' : 'create', 'distributions', rec.id, committee.getString('name') + ' ' + u.d10(input.period_end), { pool: calc.pool }, '');
  return { record: rec, calc: calc };
}

/* ------------------------------------------------------------------ */
/* Consent requests                                                    */
/* ------------------------------------------------------------------ */

function openConsent(app, committee, input, actorId) {
  const u = u_();
  const subject = String(input.subject || '').trim();
  if (subject === '') throw u.err('Describe the use you are asking about.', '依頼する利用内容を記入してください。');
  const due = u.d10(input.due_date) || u.addDays(u.today(), 14);
  const answers = members(app, committee.id).map(function (m) {
    return { member: m.id, party: m.getString('party'), name: memberName(app, m), answer: 'pending', reason: '', date: '' };
  });
  if (!answers.length) throw u.err('This committee has no members yet.', 'この委員会には構成員が登録されていません。');
  const rec = u.newRecord(app, 'consent_requests', {
    committee: committee.id,
    subject: subject.slice(0, 400),
    use: input.use || {},
    agreement: input.agreement || '',
    product: input.product || '',
    requested_by: actorId || '',
    requested_date: u.toPb(u.today()),
    due_date: u.toPb(due),
    answers: answers,
    status: 'open',
    portal_users: u.ids(committee, 'portal_users'),
  });
  app.save(rec);
  u.audit(app, actorId, 'create', 'consent_requests', rec.id, subject, { members: answers.length }, '');
  const title = u.bi('Consent requested: ' + subject, '同意のお願い：' + subject);
  const body = u.bi('Please answer by ' + u.human(due) + '. A refusal needs a reason (Copyright Act Art. 65(3)).', u.humanJa(due) + 'までに回答してください。拒否する場合は理由が必要です（著作権法65条3項）。');
  for (const uid of u.ids(committee, 'portal_users')) u.notify(app, uid, 'consent', title, body, '#/portal?consent=' + rec.id, { consent: rec.id });
  return rec;
}

/** Record one member's answer: approve | refuse | no_answer. */
function answerConsent(app, request, memberId, answer, reason, actor) {
  const u = u_();
  if (request.getString('status') !== 'open') throw u.err('This consent request is closed.', 'この同意依頼は終了しています。');
  if (['approve', 'refuse', 'no_answer', 'pending'].indexOf(answer) < 0) throw u.err('Answer must be approve or refuse.', '回答は同意または拒否です。');
  if (answer === 'refuse' && String(reason || '').trim() === '') {
    throw u.err('A refusal needs a reason (Copyright Act Art. 65(3)).', '拒否には理由が必要です（著作権法65条3項）。');
  }
  const answers = u.j(request, 'answers', []);
  let entry = null;
  for (const a of answers) if (a.member === memberId) entry = a;
  if (entry === null) throw u.err('That member is not on this request.', 'その構成員はこの依頼の対象ではありません。');
  // External accounts may answer only for the member whose party they log in for.
  if (u.roleOf(actor) === 'committee_member') {
    const p = entry.party ? u.byId(app, 'parties', entry.party) : null;
    if (!p || u.ids(p, 'portal_users').indexOf(actor.id) < 0) throw u.err('You can only answer for your own company.', '自社分のみ回答できます。');
  } else if (!u.allowed(actor, 'rights')) {
    throw u.err('Your role cannot record committee answers.', 'あなたのロールでは委員会の回答を記録できません。');
  }
  entry.answer = answer;
  entry.reason = String(reason || '').slice(0, 2000);
  entry.date = u.today();
  entry.recorded_by = u.isSuperuser(actor) ? '' : actor.id;
  request.set('answers', answers);
  const committee = u.byId(app, 'committees', request.getString('committee'));
  const mode = committee ? committee.getString('consent_default') || 'unanimous' : 'unanimous';
  let yes = 0;
  let no = 0;
  let pending = 0;
  for (const a of answers) {
    if (a.answer === 'approve') yes += 1;
    else if (a.answer === 'refuse') no += 1;
    else pending += 1;
  }
  let status = 'open';
  if (mode === 'majority') {
    if (yes * 2 > answers.length) status = 'approved';
    else if (no * 2 >= answers.length) status = 'refused';
  } else {
    if (no > 0) status = 'refused';
    else if (pending === 0) status = 'approved';
  }
  request.set('status', status);
  app.save(request);
  u.audit(app, u.actorId({ auth: actor }), 'answer', 'consent_requests', request.id, request.getString('subject'), { member: entry.name, answer: answer, status: status }, reason || '');
  return request;
}

module.exports = {
  members: members,
  checkShares: checkShares,
  compute: compute,
  saveDistribution: saveDistribution,
  recoupment: recoupment,
  openConsent: openConsent,
  answerConsent: answerConsent,
};
