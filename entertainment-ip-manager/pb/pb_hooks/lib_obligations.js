/// <reference path="../pb_data/types.d.ts" />
/**
 * Obligations that come from a record's own fields, not from an event:
 * agreement terms (option, notice, sell-off, payments, royalty reports,
 * deliveries, completion and sequel windows), committee calendars,
 * consent request and distribution due dates, product sales windows,
 * approval SLAs, permission expiries, music society notices and
 * registration cut-offs, creator payments (Freelance Act), talent occasions,
 * evidence preservation, settlement monitoring and enrolment documents.
 *
 * Each subject type has a generator that returns the deadlines it wants
 * (keyed). sync() creates missing ones, updates changed ones (unless a
 * person locked them) and cancels ones no longer wanted. Keys start with
 * "obl:<type>:<id>:" so they never clash with rule deadlines.
 */

function u_() {
  return require(`${__hooks}/lib_util.js`);
}

function want(list, key, title, titleJa, due, kind, category, stepEn, stepJa, extra) {
  const u = u_();
  if (u.d10(due) === '') return;
  const x = extra || {};
  list.push({
    key: key,
    title: title,
    title_ja: titleJa,
    due: u.d10(due),
    kind: kind,
    category: category,
    steps: [u.bi(stepEn, stepJa)],
    citation: x.citation || '',
    assignee: x.assignee || '',
    final: x.final || '',
  });
}

function partyName(app, id, fallback) {
  const u = u_();
  const p = id ? u.byId(app, 'parties', id) : null;
  return p ? p.getString('name') : fallback;
}

function periodEnds(freq, from, to) {
  const u = u_();
  const out = [];
  if (!freq || freq === 'none' || from === '' || to === '') return out;
  const months = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : freq === 'semiannual' ? 6 : 12;
  const p = u.parts(from);
  let m = p.m;
  let y = p.y;
  while (m % months !== 0) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  for (let guard = 0; guard < 120; guard++) {
    const end = y + '-' + u.pad2(m) + '-' + u.pad2(u.daysInMonth(y, m));
    if (end > to) break;
    if (end >= from) out.push(end);
    m += months;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Generators                                                          */
/* ------------------------------------------------------------------ */

function agreementObligations(app, agr) {
  const u = u_();
  const out = [];
  const ref = agr.getString('ref') || agr.getString('title');
  const cpName = partyName(app, agr.getString('counterparty'), 'the counterparty');
  const cur = agr.getString('currency');
  const resp = agr.getString('responsible');
  const opt = { assignee: resp, citation: 'Agreement terms (' + ref + ')' };
  const optEnd = u.d10(agr.getString('option_period_end'));
  if (optEnd) {
    const fee = agr.getFloat('option_extension_fee');
    want(out, 'option_end', 'Option period ends: exercise or extend' + (fee > 0 ? ' (extension fee ' + u.money(fee, cur) + ')' : ''),
      'オプション期間満了：行使または延長' + (fee > 0 ? '（延長料 ' + u.money(fee, cur) + '）' : ''), optEnd, 'hard', 'agreement',
      'Option period end date in ' + ref + ': ' + u.human(optEnd) + '. If the option is not exercised or extended, rights revert.',
      ref + 'のオプション期間満了日：' + u.humanJa(optEnd) + '。行使または延長しないと権利は戻ります。', opt);
  }
  const termEnd = u.d10(agr.getString('term_end'));
  if (termEnd && !agr.getBool('perpetual')) {
    want(out, 'term_end', 'Agreement term ends', '契約期間満了', termEnd, 'reminder', 'agreement',
      'Term end date in ' + ref + ': ' + u.human(termEnd) + '.', ref + 'の契約期間満了日：' + u.humanJa(termEnd) + '。', opt);
    const notice = agr.getInt('renewal_notice_days');
    if (notice > 0) {
      const nd = u.addDays(termEnd, -notice);
      const auto = agr.getBool('auto_renew');
      want(out, 'notice', auto ? 'Last day to give notice of non-renewal' : 'Last day to give notice to renew',
        auto ? '更新拒絶の通知期限' : '更新申入れの通知期限', nd, 'hard', 'agreement',
        'Term ends ' + u.human(termEnd) + '; the agreement requires ' + notice + ' days notice, so notice must be given by ' + u.human(nd) + '.',
        '契約期間は' + u.humanJa(termEnd) + 'に満了し、' + notice + '日前の通知が必要なため、' + u.humanJa(nd) + 'までに通知します。', opt);
    }
    const selloff = agr.getInt('sell_off_days');
    if (selloff > 0) {
      const sd = u.addDays(termEnd, selloff);
      want(out, 'selloff', 'Sell-off period ends', '在庫販売期間の終了', sd, 'reminder', 'licensing',
        'Sell-off of ' + selloff + ' days after the term ends on ' + u.human(termEnd) + (agr.getBool('sell_off_on_expiry_only') ? ' (only on natural expiry).' : '.'),
        '契約満了日' + u.humanJa(termEnd) + 'から' + selloff + '日間の在庫販売期間' + (agr.getBool('sell_off_on_expiry_only') ? '（期間満了の場合のみ）。' : '。'), opt);
    }
  }
  const rev = u.d10(agr.getString('reversion_date'));
  if (rev) want(out, 'reversion', 'Rights revert', '権利の復帰', rev, 'reminder', 'agreement',
    'Reversion date in ' + ref + ': ' + u.human(rev) + '.', ref + 'の権利復帰日：' + u.humanJa(rev) + '。', opt);
  const comp = u.d10(agr.getString('completion_deadline'));
  if (comp) want(out, 'completion', 'Complete or release the production (or the licence may end)', '制作の完成・公開期限（徒過すると契約終了の可能性）', comp, 'hard', 'agreement',
    'The licence in ' + ref + ' requires completion or release by ' + u.human(comp) + '.', ref + 'では' + u.humanJa(comp) + 'までの完成・公開が条件です。', opt);
  const seq = u.d10(agr.getString('sequel_negotiation_end'));
  if (seq) want(out, 'sequel', 'Sequel first-negotiation window ends', '続編の優先交渉期間の終了', seq, 'reminder', 'agreement',
    'First negotiation for sequels and remakes under ' + ref + ' ends ' + u.human(seq) + '.', ref + 'に基づく続編・リメイクの優先交渉期間は' + u.humanJa(seq) + 'に終了します。', opt);
  const sched = u.j(agr, 'payment_schedule', []);
  if (Array.isArray(sched)) {
    sched.forEach(function (p, i) {
      if (!p || !p.date) return;
      const outgoing = agr.getString('direction') === 'out';
      const label = p.label || (outgoing ? 'Payment due from ' + cpName : 'Payment due to ' + cpName);
      const labelJa = p.label || (outgoing ? cpName + 'からの入金予定' : cpName + 'への支払期限');
      const amt = p.amount ? ' (' + u.money(Number(p.amount), p.currency || cur) + ')' : '';
      want(out, 'pay:' + u.d10(p.date) + ':' + i, label + amt, labelJa + amt, p.date, 'hard', 'agreement',
        'Payment schedule entry ' + (i + 1) + ' in ' + ref + '.', ref + 'の支払予定 ' + (i + 1) + '件目。', opt);
    });
  }
  const del = u.j(agr, 'delivery_schedule', []);
  if (Array.isArray(del)) {
    del.forEach(function (d, i) {
      if (!d || !d.date) return;
      want(out, 'delivery:' + u.d10(d.date) + ':' + i, 'Delivery due: ' + (d.item || 'materials'), '納品期限：' + (d.item || '素材'), d.date, 'hard', 'agreement',
        'Delivery schedule entry ' + (i + 1) + ' in ' + ref + '.', ref + 'の納品予定 ' + (i + 1) + '件目。', opt);
    });
  }
  const freq = agr.getString('reporting_frequency');
  if (freq && freq !== 'none') {
    const start = u.d10(agr.getString('term_start')) || u.d10(agr.getString('effective_date')) || u.d10(agr.getString('signed_date'));
    const end = termEnd && !agr.getBool('perpetual') ? termEnd : u.addYMD(u.today(), 2, 0, 0);
    const from = start && start > u.addYMD(u.today(), -1, 0, 0) ? start : u.addYMD(u.today(), -1, 0, 0);
    const to = end < u.addYMD(u.today(), 2, 0, 0) ? end : u.addYMD(u.today(), 2, 0, 0);
    const dueDays = agr.getInt('report_due_days') || 30;
    const weReport = agr.getString('direction') === 'in';
    for (const pe of periodEnds(freq, from, to)) {
      const due = u.addDays(pe, dueDays);
      want(out, 'report:' + pe,
        (weReport ? 'Send royalty report to ' + cpName : 'Royalty report due from ' + cpName) + ' (period ending ' + u.human(pe) + ')',
        (weReport ? cpName + 'へロイヤルティ報告' : cpName + 'からのロイヤルティ報告期限') + '（' + u.humanJa(pe) + '締め）',
        due, weReport ? 'hard' : 'internal', 'licensing',
        'Reports are due ' + dueDays + ' days after each ' + freq + ' period; this period ends ' + u.human(pe) + '.',
        '各期間の締めから' + dueDays + '日以内に報告。今回の期間は' + u.humanJa(pe) + 'に締まります。', opt);
    }
  }
  return out;
}

/** Expected royalty statements mirror the report deadlines. */
function ensureRoyaltyReports(app, agr, desired) {
  const u = u_();
  const freq = agr.getString('reporting_frequency');
  if (!freq || freq === 'none') return;
  const months = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : freq === 'semiannual' ? 6 : 12;
  for (const d of desired) {
    if (d.key.indexOf('report:') !== 0) continue;
    const pe = d.key.slice('report:'.length);
    const exists = u.findOne(app, 'royalty_reports', 'agreement = {:a} && period_end = {:p}', { a: agr.id, p: u.toPb(pe) });
    if (exists !== null) continue;
    const pp = u.parts(pe);
    let sm = pp.m - months + 1;
    let sy = pp.y;
    while (sm < 1) {
      sm += 12;
      sy -= 1;
    }
    const rr = u.newRecord(app, 'royalty_reports', {
      agreement: agr.id,
      period_start: u.toPb(sy + '-' + u.pad2(sm) + '-01'),
      period_end: u.toPb(pe),
      due_date: u.toPb(d.due),
      currency: agr.getString('currency'),
      status: 'expected',
      portal_users: u.ids(agr, 'portal_users'),
    });
    app.save(rr);
  }
}

function nextFiscalYearEnds(mmdd, count) {
  const u = u_();
  const out = [];
  if (!/^\d{2}-\d{2}$/.test(mmdd || '')) return out;
  const t = u.today();
  let y = Number(t.slice(0, 4)) - 1;
  for (let guard = 0; guard < 6 && out.length < count; guard++) {
    const m = Number(mmdd.slice(0, 2));
    const d = Math.min(Number(mmdd.slice(3, 5)), u.daysInMonth(y, m));
    const day = y + '-' + u.pad2(m) + '-' + u.pad2(d);
    if (u.addDays(day, 120) >= t) out.push(day);
    y += 1;
  }
  return out;
}

function committeeObligations(app, c) {
  const u = u_();
  const out = [];
  const name = c.getString('name');
  const opt = { citation: 'Committee agreement (' + name + ')' };
  const term = u.d10(c.getString('term_end'));
  if (term) want(out, 'term_end', 'Committee term ends: windows revert to unanimous consent unless renewed', '製作委員会の存続期間満了：更新しないと窓口権は全員同意に戻ります', term, 'reminder', 'committee',
    'Term end in the committee agreement: ' + u.human(term) + '. Unassigned uses then need every member (Copyright Act Art. 65(2)).',
    '委員会契約の存続期間満了日：' + u.humanJa(term) + '。以後、窓口のない利用には全員の同意が必要です（著作権法65条2項）。', opt);
  const review = u.d10(c.getString('review_date'));
  if (review) want(out, 'review', 'Committee window review', '窓口権の見直し時期', review, 'internal', 'committee',
    'Review date in the committee agreement: ' + u.human(review) + '.', '委員会契約で定めた見直し日：' + u.humanJa(review) + '。', opt);
  const buy = u.d10(c.getString('buyback_window_end'));
  if (buy) want(out, 'buyback', 'Buyback option window ends', '持分買取オプション期間の終了', buy, 'hard', 'committee',
    'The buyback option in the committee agreement ends ' + u.human(buy) + '.', '委員会契約の持分買取オプションは' + u.humanJa(buy) + 'に終了します。', opt);
  const fy = c.getString('fiscal_year_end');
  const days = c.getInt('distribution_due_days') || 60;
  if (c.getString('status') !== 'dissolved' && c.getString('status') !== 'consolidated') {
    for (const fye of nextFiscalYearEnds(fy, 2)) {
      const due = u.addDays(fye, days);
      want(out, 'distribution:' + fye, 'Committee distribution due (fiscal year ending ' + u.human(fye) + ')', '委員会の分配期限（' + u.humanJa(fye) + '期）', due, 'hard', 'committee',
        'Distributions are due ' + days + ' days after the fiscal year ends on ' + u.human(fye) + '.',
        '分配は事業年度末' + u.humanJa(fye) + 'から' + days + '日以内。', opt);
    }
  }
  for (const cr of u.findMany(app, 'consent_requests', 'committee = {:c} && status = "open"', 'due_date', 0, { c: c.id })) {
    want(out, 'consent:' + cr.id, 'Consent request due: ' + cr.getString('subject'), '同意依頼の回答期限：' + cr.getString('subject'), cr.getString('due_date'), 'internal', 'committee',
      'Members were asked to answer by ' + u.human(cr.getString('due_date')) + '. A refusal needs a good reason (Copyright Act Art. 65(3)).',
      u.humanJa(cr.getString('due_date')) + 'までに回答を依頼。拒否には正当な理由が必要です（著作権法65条3項）。', opt);
  }
  for (const d of u.findMany(app, 'distributions', 'committee = {:c} && status != "paid"', 'due_date', 0, { c: c.id })) {
    if (u.d10(d.getString('due_date')) === '') continue;
    want(out, 'pay:' + d.id, 'Pay committee distribution for ' + u.human(d.getString('period_end')), u.humanJa(d.getString('period_end')) + '期の委員会分配金の支払', d.getString('due_date'), 'hard', 'committee',
      'Distribution statement for the period ending ' + u.human(d.getString('period_end')) + '.', u.humanJa(d.getString('period_end')) + '締めの分配明細。', opt);
  }
  return out;
}

function productObligations(app, p) {
  const u = u_();
  const out = [];
  const name = p.getString('name');
  const stage = p.getString('stage');
  if (stage === 'cancelled' || stage === 'ended') return out;
  const opt = { citation: 'Product ' + (p.getString('ref') || name) };
  const salesEnd = u.d10(p.getString('sales_end'));
  if (salesEnd && stage !== 'sell_off') want(out, 'sales_end', 'Sales window closes: ' + name, '販売期間の終了：' + name, salesEnd, 'internal', 'licensing',
    'Sales window ends ' + u.human(salesEnd) + (p.getString('timezone') ? ' (' + p.getString('timezone') + ')' : '') + '.',
    '販売期間は' + u.humanJa(salesEnd) + 'に終了します。', opt);
  const ship = u.d10(p.getString('ship_by'));
  if (ship) want(out, 'ship_by', 'Ship by: ' + name, '発送期限：' + name, ship, 'internal', 'licensing',
    'Promised shipping date ' + u.human(ship) + '.', '案内した発送時期：' + u.humanJa(ship) + '。', opt);
  const dig = u.d10(p.getString('digital_end'));
  if (dig) want(out, 'digital_end', 'Digital sales end: ' + name, 'デジタル販売の終了：' + name, dig, 'internal', 'licensing',
    'Digital components stop selling on ' + u.human(dig) + '.', 'デジタル商品の販売は' + u.humanJa(dig) + 'に終了します。', opt);
  const so = u.d10(p.getString('sell_off_end'));
  if (so) want(out, 'sell_off_end', 'Sell-off ends: ' + name, '在庫販売期間の終了：' + name, so, 'hard', 'licensing',
    'Sell-off of existing stock ends ' + u.human(so) + '. Unused seals must be returned or voided afterwards.',
    '在庫販売は' + u.humanJa(so) + 'に終了します。未使用の証紙はその後返却または無効化します。', opt);
  const seals = u.findMany(app, 'seal_orders', 'product = {:p} && status = "issued"', '', 0, { p: p.id });
  if (seals.length && so) {
    want(out, 'seal_return', 'Return or void unused seals: ' + name, '未使用証紙の返却・無効化：' + name, u.addDays(so, 30), 'internal', 'licensing',
      seals.length + ' issued seal order(s) need used, void and returned counts after sell-off.',
      '発行済み証紙' + seals.length + '件について、販売終了後に使用・無効・返却数を報告します。', opt);
  }
  const agrId = p.getString('agreement');
  const agr = agrId ? u.byId(app, 'agreements', agrId) : null;
  const samples = agr ? agr.getInt('samples_owed') : 0;
  const start = u.d10(p.getString('sales_start'));
  if (samples > 0 && start && (stage === 'mass_production' || stage === 'on_sale')) {
    want(out, 'samples', 'Collect ' + samples + ' free samples: ' + name, '無償サンプル' + samples + '個の受領：' + name, start, 'internal', 'licensing',
      'The licence requires ' + samples + ' samples per product.', '契約上、商品ごとに' + samples + '個のサンプル提出が必要です。', opt);
  }
  return out;
}

function approvalObligations(app, a) {
  const u = u_();
  const out = [];
  const st = a.getString('status');
  if (st !== 'submitted' && st !== 'in_review') return out;
  const p = u.byId(app, 'products', a.getString('product'));
  const name = p ? p.getString('name') : '';
  const stage = a.getString('stage');
  const due = u.d10(a.getString('due_date'));
  const timeout = a.getString('timeout_outcome');
  const tEn = timeout === 'deemed_approved' ? ' After this date it counts as approved.' : timeout === 'deemed_refused' ? ' After this date it counts as refused.' : '';
  const tJa = timeout === 'deemed_approved' ? 'この日を過ぎると承認扱いになります。' : timeout === 'deemed_refused' ? 'この日を過ぎると不承認扱いになります。' : '';
  want(out, 'sla', 'Approval due: ' + name + ' (' + stage.replace(/_/g, ' ') + ', round ' + (a.getInt('round') || 1) + ')',
    '監修期限：' + name + '（第' + (a.getInt('round') || 1) + '回）', due, timeout === 'none' || timeout === '' ? 'internal' : 'hard', 'approval',
    'Reply due ' + u.human(due) + ' under the licence approval terms.' + tEn, '契約の監修条件による回答期限：' + u.humanJa(due) + '。' + tJa,
    { citation: p && p.getString('ref') ? 'Product ' + p.getString('ref') : '' });
  return out;
}

function permissionObligations(app, perm) {
  const u = u_();
  const out = [];
  const st = perm.getString('status');
  if (st === 'revoked' || st === 'expired') return out;
  const title = perm.getString('title');
  const end = u.d10(perm.getString('end_date'));
  if (end) want(out, 'end', 'Permission ends: ' + title, '許諾の終了：' + title, end, 'reminder', 'permission',
    'The permission runs until ' + u.human(end) + '. Renew it or stop using the title on streams after this date.',
    '許諾は' + u.humanJa(end) + 'まで。更新するか、以後の配信での使用を停止します。');
  const days = perm.getInt('recheck_days');
  if (days > 0) {
    const last = u.d10(perm.getString('last_checked')) || u.d10(perm.getString('created'));
    if (last) want(out, 'recheck:' + last, 'Re-check the guideline: ' + title, 'ガイドラインの再確認：' + title, u.addDays(last, days), 'internal', 'guideline',
      'Public guidelines change without notice. Last checked ' + u.human(last) + '; re-check every ' + days + ' days.',
      '公開ガイドラインは予告なく変わります。最終確認 ' + u.humanJa(last) + '、' + days + '日ごとに確認します。');
  }
  return out;
}

/** Last day of the quarter containing `day`. */
function quarterEnd(day) {
  const u = u_();
  const p = u.parts(day);
  const qm = Math.ceil(p.m / 3) * 3;
  return p.y + '-' + u.pad2(qm) + '-' + u.pad2(u.daysInMonth(p.y, qm));
}

function societyContractObligations(app, sc) {
  const u = u_();
  const out = [];
  const soc = sc.getString('society');
  const socName = soc === 'jasrac' ? 'JASRAC' : soc === 'nextone' ? 'NexTone' : soc;
  const end = u.d10(sc.getString('term_end'));
  if (end) {
    want(out, 'term_end', socName + ' contract term ends', socName + '契約の期間満了', end, 'reminder', 'music',
      'Contract term ends ' + u.human(end) + (sc.getBool('auto_renew') ? '; it renews automatically unless notice is given.' : '.'),
      '契約期間は' + u.humanJa(end) + 'に満了' + (sc.getBool('auto_renew') ? '（通知がなければ自動更新）。' : '。'));
    if (sc.getBool('auto_renew')) {
      const nd = u.addYMD(end, 0, -3, 0);
      want(out, 'notice', 'Last day to give ' + socName + ' notice of non-renewal or scope change', socName + 'への更新拒絶・範囲変更の通知期限', nd, 'hard', 'music',
        'Written notice is due 3 months before the term ends on ' + u.human(end) + '.', '期間満了日' + u.humanJa(end) + 'の3か月前までに書面で通知します。',
        { citation: soc === 'jasrac' ? 'JASRAC trust contract terms Art. 10, 11' : 'NexTone consignment terms Art. 6' });
    }
  }
  if (soc === 'jasrac') {
    const y = Number(u.today().slice(0, 4));
    const dec = y + '-12-31';
    want(out, 'scope:' + y, 'Last day to notify JASRAC of a trust scope change for 1 April ' + (y + 1), (y + 1) + '年4月1日からのJASRAC管理範囲変更の通知期限', dec, 'reminder', 'music',
      'Scope changes take effect on 1 April and need written notice by the preceding 31 December.', '管理範囲の変更は4月1日に効力を生じ、前年12月31日までの書面通知が必要です。',
      { citation: 'JASRAC trust contract terms Art. 7' });
  }
  return out;
}

function registrationObligations(app, reg) {
  const u = u_();
  const out = [];
  if (reg.getString('status') !== 'draft') return out;
  const song = u.byId(app, 'songs', reg.getString('song'));
  if (song === null) return out;
  const soc = reg.getString('society');
  const socName = soc === 'jasrac' ? 'JASRAC' : soc === 'nextone' ? 'NexTone' : soc;
  const first = u.d10(song.getString('first_publication'));
  const anchor = first !== '' && first > u.today() ? first : u.today();
  const qe = quarterEnd(anchor);
  const cutoff = u.addDays(qe, -10);
  want(out, 'cutoff:' + qe, 'Submit ' + socName + ' work registration: ' + song.getString('title'), socName + 'への作品届提出：' + song.getString('title'),
    cutoff < u.today() ? u.addDays(quarterEnd(u.addYMD(qe, 0, 1, 0)), -10) : cutoff, 'hard', 'music',
    'Documents filed 10 days before the quarter\'s record date decide who is paid for that period; uses before registration may be withheld.',
    '各四半期の確定基準日の10日前までに届け出た内容で分配先が決まります。未登録の利用分は保留される場合があります。',
    { citation: soc === 'jasrac' ? 'JASRAC distribution rules Art. 5, 6' : 'NexTone work registration deadlines' });
  return out;
}

function characterObligations(app, ch) {
  const u = u_();
  const out = [];
  for (const a of u.findMany(app, 'character_assets', 'character = {:c}', '', 0, { c: ch.id })) {
    const label = a.getString('label');
    const payDue = u.d10(a.getString('payment_due'));
    if (payDue && u.d10(a.getString('paid_date')) === '') {
      want(out, 'pay:' + a.id, 'Pay the creator: ' + label, '制作者への支払：' + label, payDue, 'hard', 'agreement',
        'Payment due ' + u.human(payDue) + '. The Freelance Act requires payment within 60 days of receiving the work.',
        '支払期日 ' + u.humanJa(payDue) + '。フリーランス法では受領から60日以内の支払が必要です。',
        { citation: 'Act on Ensuring Proper Transactions Involving Specified Entrusted Business Operators (Freelance Act) Art. 4' });
    }
    const lic = u.d10(a.getString('license_end'));
    if (lic) want(out, 'license:' + a.id, 'Licence ends for ' + label, label + 'の利用許諾の終了', lic, 'reminder', 'agreement',
      'The licence for this layer ends ' + u.human(lic) + '. Products using it need a new licence or must stop.',
      'この要素の利用許諾は' + u.humanJa(lic) + 'に終了します。使用する商品は再許諾か販売停止が必要です。');
  }
  return out;
}

/** Next occurrence of a "MM-DD" day on or after today. */
function nextAnnual(mmdd) {
  const u = u_();
  if (!/^\d{2}-\d{2}$/.test(mmdd || '')) return '';
  const t = u.today();
  let y = Number(t.slice(0, 4));
  for (let i = 0; i < 2; i++) {
    const m = Number(mmdd.slice(0, 2));
    const d = Math.min(Number(mmdd.slice(3, 5)), u.daysInMonth(y, m));
    const day = y + '-' + u.pad2(m) + '-' + u.pad2(d);
    if (day >= t) return day;
    y += 1;
  }
  return '';
}

function talentObligations(app, t) {
  const u = u_();
  const out = [];
  const life = t.getString('lifecycle');
  if (life !== 'active' && life !== 'hiatus' && life !== 'pre_debut') return out;
  const name = t.getString('stage_name');
  const bday = nextAnnual(t.getString('birthday'));
  if (bday) want(out, 'birthday:' + bday.slice(0, 4), 'Plan birthday merch for ' + name + ' (' + u.human(bday) + ')', name + 'の誕生日グッズ企画（' + u.humanJa(bday) + '）',
    u.addDays(bday, -60), 'internal', 'talent', 'Birthday on ' + u.human(bday) + '; order windows usually open weeks before.', '誕生日は' + u.humanJa(bday) + '。受注は数週間前に始まるのが一般的です。');
  const debut = u.d10(t.getString('debut_date'));
  if (debut && debut < u.today()) {
    const ann = nextAnnual(debut.slice(5, 10));
    if (ann) {
      const years = Number(ann.slice(0, 4)) - Number(debut.slice(0, 4));
      want(out, 'anniversary:' + ann.slice(0, 4), 'Plan ' + years + '-year anniversary for ' + name + ' (' + u.human(ann) + ')', name + 'の' + years + '周年企画（' + u.humanJa(ann) + '）',
        u.addDays(ann, -60), 'internal', 'talent', 'Debut anniversary on ' + u.human(ann) + '.', 'デビュー記念日は' + u.humanJa(ann) + '。');
    }
  }
  return out;
}

function caseObligations(app, c) {
  const u = u_();
  const out = [];
  for (const ev of u.findMany(app, 'evidence', 'case_ref = {:c}', '', 0, { c: c.id })) {
    const p = u.d10(ev.getString('preserve_until'));
    if (p) want(out, 'preserve:' + ev.id, 'Evidence log preservation ends (' + (ev.getString('url') || ev.getString('kind')) + ')', '証拠のログ保存期限（' + (ev.getString('url') || ev.getString('kind')) + '）',
      p, 'internal', 'enforcement', 'Providers often keep access logs only 3 to 6 months. Request disclosure or preservation before ' + u.human(p) + '.',
      'プロバイダのアクセスログ保存期間は3から6か月程度のことが多いため、' + u.humanJa(p) + 'までに開示・保存を請求します。');
  }
  const s = u.j(c, 'settlement', {});
  const until = u.d10(s && s.monitor_until);
  if (until) want(out, 'settlement', 'Settlement monitoring ends', '和解条項の監視期間の終了', until, 'reminder', 'enforcement',
    'Watch for repeat infringement until ' + u.human(until) + (s.penalty_amount ? '; a penalty of ' + u.money(Number(s.penalty_amount), s.currency || '') + ' applies to a breach.' : '.'),
    u.humanJa(until) + 'まで再侵害を監視' + (s.penalty_amount ? '（違反時の違約金 ' + u.money(Number(s.penalty_amount), s.currency || '') + '）。' : '。'));
  return out;
}

function enrollmentObligations(app, en) {
  const u = u_();
  const out = [];
  const until = u.d10(en.getString('documents_valid_until'));
  if (until && en.getString('status') !== 'expired') want(out, 'documents', 'Refresh enrolment documents (' + en.getString('platform').replace(/_/g, ' ') + ')', '権利者登録書類の更新（' + en.getString('platform') + '）',
    until, 'internal', 'enforcement', 'Enrolment documents expire ' + u.human(until) + '. Mercari, for example, needs a company registry extract issued within 3 months.',
    '登録書類の有効期限は' + u.humanJa(until) + '。例えばメルカリは発行後3か月以内の登記事項証明書が必要です。');
  return out;
}

function fanRegistrationObligations(app, f) {
  const u = u_();
  const out = [];
  const st = f.getString('status');
  if (st === 'rejected' || st === 'revoked' || st === 'expired') return out;
  const who = f.getString('applicant_name');
  const end = u.d10(f.getString('end_date'));
  if (end) want(out, 'end', 'Fan permit ends: ' + who, '個人許諾の終了：' + who, end, 'reminder', 'guideline',
    'Permit ' + (f.getString('permission_no') || '') + ' ends ' + u.human(end) + '.', '許諾番号' + (f.getString('permission_no') || '') + 'は' + u.humanJa(end) + 'に終了します。');
  const ev = u.d10(f.getString('event_date'));
  if (ev && f.getString('kind') === 'event_permit') want(out, 'event', 'Collect seals and the sales report: ' + (f.getString('event_name') || who), '証紙と販売報告の回収：' + (f.getString('event_name') || who),
    ev, 'internal', 'licensing', 'One-day licences return unused seals and the sales report on the event day.', '当日版権は未使用の証紙と販売報告を当日に回収します。');
  return out;
}

/** Clearance items on a title: due dates and expiries become deadlines. */
function workObligations(app, w) {
  const u = u_();
  const out = [];
  for (const c of u.findMany(app, 'clearances', 'work = {:w}', '', 0, { w: w.id })) {
    const st = c.getString('status');
    const title = c.getString('title');
    const opt = { assignee: c.getString('responsible'), citation: 'Clearance checklist (' + w.getString('title') + ')' };
    const due = u.d10(c.getString('due_date'));
    if (due && ['not_started', 'requested', 'in_progress'].indexOf(st) >= 0) {
      want(out, 'clearance:' + c.id, 'Clear: ' + title, '権利処理：' + title, due, 'internal', 'copyright',
        'Clearance item due ' + u.human(due) + '.', '権利処理の期限 ' + u.humanJa(due) + '。', opt);
    }
    const exp = u.d10(c.getString('expires'));
    if (exp && (st === 'cleared' || st === 'cleared_with_risk')) {
      want(out, 'expires:' + c.id, 'Clearance expires: ' + title, '権利処理の期限切れ：' + title, exp, 'reminder', 'copyright',
        'This clearance is valid until ' + u.human(exp) + '. Renew it or stop the uses it covers.', 'この権利処理は' + u.humanJa(exp) + 'まで有効です。更新するか、対象の利用を停止します。', opt);
    }
  }
  return out;
}

const GENERATORS = {
  work: workObligations,
  agreement: agreementObligations,
  committee: committeeObligations,
  product: productObligations,
  approval: approvalObligations,
  permission: permissionObligations,
  society_contract: societyContractObligations,
  registration: registrationObligations,
  character: characterObligations,
  talent: talentObligations,
  case: caseObligations,
  enrollment: enrollmentObligations,
  fan_registration: fanRegistrationObligations,
};

const SOURCE = { agreement: 'agreement' };

function inactive(type, rec) {
  if (type === 'agreement') {
    const s = rec.getString('status');
    return s === 'terminated' || s === 'superseded' || s === 'expired';
  }
  return false;
}

/**
 * Bring a subject's generated deadlines in line with its fields.
 * Returns { created, updated, cancelled }.
 */
function sync(app, type, rec, actorId) {
  const u = u_();
  const engine = require(`${__hooks}/lib_engine.js`);
  const gen = GENERATORS[type];
  if (!gen || rec === null) return { created: 0, updated: 0, cancelled: 0 };
  const field = engine.SUBJECTS[type].field;
  const prefix = 'obl:' + type + ':' + rec.id + ':';
  const off = inactive(type, rec);
  const desired = off ? [] : gen(app, rec);
  const byKey = {};
  for (const d of desired) byKey[prefix + d.key] = d;
  const subject = engine.subjectFromRecord(type, rec);
  const existing = u.findMany(app, 'deadlines', field + ' = {:id} && key ~ {:p}', '', 0, { id: rec.id, p: prefix });
  const seen = {};
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  const buffer = Number(u.setting(app, 'target_buffer_days', 14)) || 0;
  function targetFor(d) {
    if (d.kind !== 'hard') return d.due;
    const t = u.addDays(d.due, -buffer);
    return t < u.today() ? d.due : t;
  }
  for (const dl of existing) {
    const k = dl.getString('key');
    seen[k] = true;
    const w = byKey[k];
    if (dl.getString('status') !== 'open') continue;
    if (!w) {
      if (!off || u.d10(dl.getString('due_date')) >= u.today()) {
        dl.set('status', 'cancelled');
        dl.set('close_reason', off ? 'The record is no longer active.' : 'No longer in the record\'s terms.');
        dl.set('closed_at', u.toPb(u.today()));
        app.save(dl);
        cancelled += 1;
      }
      continue;
    }
    if (dl.getBool('locked')) continue;
    if (u.d10(dl.getString('due_date')) !== w.due || dl.getString('title') !== w.title || dl.getString('title_ja') !== w.title_ja) {
      dl.set('due_date', u.toPb(w.due));
      dl.set('target_date', u.toPb(targetFor(w)));
      dl.set('title', w.title);
      dl.set('title_ja', w.title_ja);
      dl.set('kind', w.kind);
      dl.set('calculation', { steps: w.steps, computed_at: u.nowIso() });
      app.save(dl);
      updated += 1;
    }
  }
  const dn = {
    ref: '',
    label: subject.label,
  };
  try {
    dn.ref = rec.getString('ref') || '';
  } catch {
    dn.ref = '';
  }
  for (const d of desired) {
    const key = prefix + d.key;
    if (seen[key]) continue;
    const data = {
      title: d.title,
      title_ja: d.title_ja,
      kind: d.kind,
      category: d.category,
      status: 'open',
      due_date: u.toPb(d.due),
      target_date: u.toPb(targetFor(d)),
      nominal_date: u.toPb(d.due),
      final_date: u.toPb(d.final),
      source: SOURCE[type] || 'system',
      key: key,
      calculation: { steps: d.steps, computed_at: u.nowIso() },
      citation: d.citation,
      assignee: d.assignee || '',
      subject_type: subject.subject_type,
      subject_label: dn.label,
      ref: dn.ref,
      reminders_sent: [],
    };
    data[field] = rec.id;
    app.save(u.newRecord(app, 'deadlines', data));
    created += 1;
  }
  if (type === 'agreement' && !off) ensureRoyaltyReports(app, rec, desired);
  if (created || updated || cancelled) {
    u.audit(app, actorId, 'sync', engine.SUBJECTS[type].coll, rec.id, subject.label, { created: created, updated: updated, cancelled: cancelled }, 'Obligations from the record');
  }
  return { created: created, updated: updated, cancelled: cancelled };
}

function syncById(app, type, id, actorId) {
  const engine = require(`${__hooks}/lib_engine.js`);
  const u = u_();
  const def = engine.SUBJECTS[type];
  if (!def || !id) return null;
  const rec = u.byId(app, def.coll, id);
  if (rec === null) return null;
  return sync(app, type, rec, actorId);
}

/** Daily sweep: refresh time-dependent obligations (occasions, fiscal years, rolling report periods). */
function sweepAll(app) {
  const u = u_();
  let n = 0;
  const plan = [
    ['agreement', 'agreements', 'status = "active" || status = "renewed" || status = "negotiating"'],
    ['committee', 'committees', 'status != "dissolved" && status != "consolidated"'],
    ['talent', 'talents', 'lifecycle = "active" || lifecycle = "hiatus" || lifecycle = "pre_debut"'],
    ['society_contract', 'society_contracts', ''],
    ['registration', 'society_registrations', 'status = "draft"'],
    ['permission', 'permissions', 'status = "active" || status = "pending_application"'],
  ];
  for (const p of plan) {
    for (const rec of u.findMany(app, p[1], p[2], '', 0)) {
      try {
        sync(app, p[0], rec, '');
        n += 1;
      } catch (error) {
        console.error('obligation sweep failed for ' + p[0] + ' ' + rec.id + ':', error);
      }
    }
  }
  return n;
}

module.exports = {
  GENERATORS: GENERATORS,
  sync: sync,
  syncById: syncById,
  sweepAll: sweepAll,
  periodEnds: periodEnds,
  quarterEnd: quarterEnd,
  nextAnnual: nextAnnual,
  agreementObligations: agreementObligations,
};
