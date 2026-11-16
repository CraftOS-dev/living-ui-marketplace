/// <reference path="../pb_data/types.d.ts" />
/**
 * Blind votes, decisions and conditions (SPEC 7.9, REPORT Table 25 steps 6
 * to 9).
 *
 * A vote (choice on the fund's scale, a one-line rationale, a veto flag) is
 * cast with the PIN and stored sealed: nobody, your AI agent included,
 * reads a choice before the facilitator reveals the item. votes.status
 * answers counts only. votes.reveal (facilitator, PIN; when everyone
 * eligible voted, or with --close when the facilitator closes voting)
 * opens the ballots, lists them junior first and applies the fund's rule.
 *
 * A decision (facilitator, PIN) records the outcome, the rule, the tally,
 * the memo's hash and a snapshot of what the firm knew (deal, facts,
 * diligence answers, memo header); it is never edited: a correction is a
 * new decision with `corrects`. It emits decision.recorded { decision,
 * deal, outcome }. Conditions are owned follow-ups with due days; a
 * condition is completed with evidence (a proposal for your AI agent).
 *
 * votes.cast, votes.reveal and decisions.record are untracked writes
 * (track: false): a vote or a reveal cannot be undone, and a wrong
 * decision is corrected by a new one.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function C() {
  return L('lib_committee');
}
function RU() {
  return L('lib_committee_rules');
}

/** Run fn(tx-ctx) in one transaction (the untracked ops of this file). */
function inTx(ctx, fn) {
  let out;
  if (ctx.app.isTransactional()) return fn(ctx);
  ctx.app.runInTransaction((tx) => {
    out = fn(Object.assign({}, ctx, { app: tx }));
  });
  return out;
}

/* ---------------------------------------------------------------- votes */

/** votes.cast (PIN): one chip on the item's scale, a one-line rationale and the veto flag, sealed until the reveal. */
function cast(ctx, p) {
  const util = u();
  const r = inTx(ctx, (c) => {
    const app = c.app;
    const it = C().itemRef(c, util.req(p, 'item'));
    const meeting = app.findRecordById('ic_meetings', it.getString('meeting'));
    if (meeting.getString('status') === 'closed') throw util.fail(409, meeting.getString('number') + ' is closed.', 'meeting_closed');
    if (it.getString('revealed_at') !== '' || it.getString('status') === 'decided' || it.getString('status') === 'skipped') throw util.fail(409, 'Voting on this item is over.', 'voting_over');
    if (it.getString('voting') !== 'open') throw util.fail(409, 'The facilitator closed voting on this item.', 'voting_closed');
    if (it.getString('preread_at') === '') throw util.fail(409, 'The memo for this item is not submitted yet; voting opens with the pre-reads.', 'no_prereads');
    if (!C().isEligible(c, it)) throw util.fail(403, 'You do not vote on this item (your role or fund scope).', 'not_eligible');
    const scale = it.getString('scale') || C().scaleKey(app, it.getString('fund'));
    const choice = RU().choiceOf(scale, util.req(p, 'choice', RU().scale(scale).choices[0]));
    const rationale = util.squash(util.text(p, 'rationale', 300, ''));
    const veto = util.bool(p, 'veto', false);
    let v = util.findOne(app, 'votes', 'item = {:i} && member = {:m}', { i: it.id, m: c.memberId });
    const changed = v !== null;
    if (v === null) {
      v = util.newRecord(app, 'votes');
      v.set('item', it.id);
      v.set('meeting', meeting.id);
      v.set('member', c.memberId);
    }
    v.set('ballot_sealed', L('lib_seal').seal(app, JSON.stringify({ choice: choice, rationale: rationale, veto: veto })));
    v.set('choice', '');
    v.set('rationale', '');
    v.set('veto', false);
    v.set('revealed', false);
    v.set('scale', scale);
    v.set('seniority', C().seniorityOf(app, c.roleCode));
    v.set('cast_at', util.nowIso());
    v.set('actor', 'person');
    app.save(v);
    if (it.getString('scale') === '') it.set('scale', scale);
    if (it.getString('status') === 'waiting') it.set('status', 'voting');
    app.save(it);
    L('lib_audit').write(c, { op: 'votes.cast', collection: 'agenda_items', record: it.id, summary: (changed ? 'Changed my vote on ' : 'Voted on ') + C().itemOut(c, it, { votes: false }).title + ' (sealed until the reveal)' });
    return { item: it.id, status: statusOf(c, it), changed: changed };
  });
  ctx.audited = true;
  return { voted: true, changed: r.changed, item: r.item, status: r.status };
}

/** Counts for one item: eligible, voted, waiting, revealed; never a choice. */
function statusOf(ctx, it) {
  const v = C().votesOf(ctx, it);
  return { item: it.id, eligible: v.eligible, voted: v.voted, waiting: v.waiting, revealed: v.revealed, members: v.members.map((x) => ({ id: x.id, name: x.name, voted: x.voted })), me: v.me };
}

/** votes.status: counts only (everyone, your AI agent included), for an item or every item of a meeting. */
function status(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent) L('lib_auth').need(ctx, 'committee', 'view', 'see vote status');
  if (util.str(p, 'item', '') !== '') return { items: [statusOf(ctx, C().itemRef(ctx, util.str(p, 'item', '')))] };
  const m = C().meetingRef(app, util.str(p, 'meeting', 'next') || 'next');
  const out = [];
  let hidden = 0;
  for (const it of util.findMany(app, 'agenda_items', 'meeting = {:m}', 'sort,created', 0, { m: m.id })) {
    if (!C().canSeeDeal(ctx, it.getString('deal'))) {
      hidden++;
      continue;
    }
    out.push(statusOf(ctx, it));
  }
  return { meeting: m.getString('number'), items: out, hidden: hidden };
}

/** votes.reveal (facilitator, PIN): open the sealed ballots; junior first; the rule applied. */
function reveal(ctx, p) {
  const util = u();
  const out = inTx(ctx, (c) => {
    const app = c.app;
    const it = C().itemRef(c, util.req(p, 'item'));
    const meeting = app.findRecordById('ic_meetings', it.getString('meeting'));
    C().needFacilitator(c, meeting, 'reveal votes');
    if (it.getString('revealed_at') !== '') return { item: C().itemOut(c, it), already: true };
    if (it.getString('status') === 'skipped') throw util.fail(409, 'This item was skipped.', 'item_skipped');
    const cool = C().ms(it.getString('cooling_end_at'));
    if (Number.isFinite(cool) && cool > Date.now()) throw util.fail(409, 'The cooling-off runs until ' + it.getString('cooling_end_at') + '.', 'cooling_off', { ends_at: it.getString('cooling_end_at') });
    const elig = C().eligible(app, it);
    const rows = util.findMany(app, 'votes', 'item = {:i}', 'created', 0, { i: it.id });
    if (rows.length === 0) throw util.fail(409, 'No votes yet.', 'no_votes');
    const voted = rows.map((v) => v.getString('member'));
    const missing = elig.filter((e) => voted.indexOf(e.id) < 0);
    const close = util.bool(p, 'close', false) || it.getString('voting') === 'closed';
    if (missing.length > 0 && !close) throw util.fail(409, missing.length + ' of ' + elig.length + ' have not voted (' + missing.map((x) => x.name).join(', ') + '). Reveal with --close true to close voting now.', 'votes_missing', { missing: missing.length, names: missing.map((x) => x.name) });
    const names = {};
    const joined = {};
    for (const e of elig) {
      names[e.id] = e.name;
      joined[e.id] = e.joined;
    }
    const ballots = rows.map((v) => {
      const b = JSON.parse(L('lib_seal').unseal(app, v.getString('ballot_sealed')) || '{}');
      v.set('choice', String(b.choice || ''));
      v.set('rationale', String(b.rationale || ''));
      v.set('veto', b.veto === true);
      v.set('revealed', true);
      app.save(v);
      const m = names[v.getString('member')] === undefined ? util.byId(app, 'members', v.getString('member')) : null;
      return { member: v.getString('member'), name: names[v.getString('member')] || (m ? m.getString('name') : 'Former member'), choice: String(b.choice || ''), veto: b.veto === true, rationale: String(b.rationale || ''), seniority: v.getInt('seniority'), joined: joined[v.getString('member')] || (m ? m.getString('created') : ''), cast_at: v.getString('cast_at') };
    });
    const scale = it.getString('scale') || C().scaleKey(app, it.getString('fund'));
    const rule = it.getString('rule') || C().ruleOf(app, it.getString('fund'));
    const tally = RU().tally({ scale: scale, rule: rule, champion: it.getString('champion'), eligible: Math.max(elig.length, ballots.length), votes: ballots });
    const eligOut = elig.slice();
    for (const b of ballots) if (eligOut.map((x) => x.id).indexOf(b.member) < 0) eligOut.push({ id: b.member, name: b.name, role: '', seniority: b.seniority, joined: b.joined });
    it.set('eligible', eligOut);
    it.set('tally', tally);
    it.set('scale', scale);
    it.set('rule', rule);
    it.set('voting', 'closed');
    if (missing.length > 0) {
      it.set('voting_closed_at', util.nowIso());
      it.set('voting_closed_by', c.memberId);
    }
    it.set('revealed_at', util.nowIso());
    it.set('revealed_by', c.memberId);
    it.set('status', 'revealed');
    app.save(it);
    L('lib_audit').write(c, { op: 'votes.reveal', collection: 'agenda_items', record: it.id, summary: 'Revealed ' + ballots.length + ' votes on ' + C().itemOut(c, it, { votes: false }).title + (missing.length > 0 ? ' (voting closed, ' + missing.length + ' did not vote)' : '') });
    return { item: C().itemOut(c, it) };
  });
  ctx.audited = true;
  return out;
}

/* ------------------------------------------------------------ decisions */

function snapshotFor(ctx, deal, memo) {
  const app = ctx.app;
  const dv = L('lib_deals').dealOut(app, deal, false);
  const intake = deal.getString('intake_item');
  const verdict = intake !== '' ? L('lib_intake').verdictOf(app, intake) : null;
  // Diligence: only answers a person confirmed (your AI agent's proposed answers are not what the firm knew).
  const all = L('lib_diligence').answersFor(app, deal.id) || { questions: [], answers: [] };
  const confirmed = (all.answers || []).filter((a) => a && a.status === 'confirmed');
  const asked = {};
  for (const a of confirmed) asked[a.question] = true;
  const dd = { questions: (all.questions || []).filter((q) => q && asked[q.id] === true), answers: confirmed };
  return {
    at: u().nowIso(),
    deal: { number: dv.number, title: dv.title, stage: dv.stage_label, status: dv.status, round: dv.round, check_minor: dv.check_minor, ownership_ppm: dv.ownership_ppm, instrument: dv.instrument, currency: dv.currency, fund: dv.fund, point: dv.point, source: dv.source },
    facts: verdict ? verdict.facts || null : null,
    checks: verdict ? verdict.checks || null : null,
    diligence: dd || null,
    memo: memo !== null ? { number: memo.getString('number'), version: memo.getInt('version'), hash: memo.getString('hash'), snapshot: u().jsonOf(memo, 'snapshot', null) } : null,
  };
}

function cleanConditions(ctx, deal, raw) {
  const util = u();
  if (raw === undefined) return [];
  if (raw.length > 20) throw util.fail(400, 'At most 20 conditions.', 'invalid_param', { param: 'conditions' });
  const days = Number(C().settings(ctx.app).condition_days) || 14;
  return raw.map((x0, i) => {
    const x = typeof x0 === 'string' ? { text: x0 } : x0;
    util.keysOnly(x, ['text', 'owner', 'due_day'], 'Condition ' + (i + 1));
    const text = util.squash(String(x.text || ''));
    if (text === '' || text.length > 300) throw util.fail(400, 'Condition ' + (i + 1) + ': text is 1 to 300 characters.', 'invalid_param', { param: 'conditions' });
    const owner = x.owner ? L('lib_auth').memberRef(ctx.app, String(x.owner)).id : deal.getString('point') || ctx.memberId;
    const due = x.due_day ? String(x.due_day) : util.dayAdd(util.today(ctx.app), days);
    if (!util.isDay(due)) throw util.fail(400, 'Condition ' + (i + 1) + ': due_day is YYYY-MM-DD.', 'invalid_param', { param: 'conditions' });
    return { text: text, owner: owner, due_day: due };
  });
}

/** decisions.record (facilitator, PIN): outcome, rule, tally, memo hash, snapshot, conditions; never edited. */
function record(ctx, p) {
  const util = u();
  const out = inTx(ctx, (c) => {
    const app = c.app;
    const outcome = util.oneOf(p, 'outcome', RU().OUTCOMES, '');
    if (outcome === '') throw util.fail(400, 'outcome is one of: ' + RU().OUTCOMES.join(', ') + '.', 'missing_param', { param: 'outcome' });
    let it = null;
    let deal;
    let meeting = null;
    const correcting = util.str(p, 'corrects', '') !== '';
    if (util.str(p, 'item', '') !== '') {
      it = C().itemRef(c, util.str(p, 'item', ''));
      meeting = app.findRecordById('ic_meetings', it.getString('meeting'));
      C().needFacilitator(c, meeting, 'record its decisions');
      if (it.getString('deal') === '') throw util.fail(400, 'This item has no deal; decisions are recorded on deals.', 'invalid_param', { param: 'item' });
      if (it.getString('status') === 'decided' && !correcting) throw util.fail(409, 'This item is decided. Record a correction with --corrects <decision>.', 'already_decided', { decision: it.getString('decision') });
      if (it.getString('revealed_at') === '' && util.count(app, 'SELECT COUNT(*) AS n FROM votes WHERE item = {:i}', { i: it.id }) > 0) throw util.fail(409, 'Reveal the votes first.', 'not_revealed');
      deal = app.findRecordById('deals', it.getString('deal'));
    } else {
      L('lib_auth').need(c, 'committee', 'edit', 'record decisions');
      deal = C().needDeal(c, util.req(p, 'deal', 'D-0012'));
    }
    let corrects = '';
    if (util.str(p, 'corrects', '') !== '') {
      const prev = util.byId(app, 'decisions', util.str(p, 'corrects', ''));
      if (prev === null || prev.getString('deal') !== deal.id) throw util.fail(404, 'No decision ' + util.str(p, 'corrects', '') + ' on this deal.', 'not_found');
      const already = util.count(app, 'SELECT COUNT(*) AS n FROM decisions WHERE corrects = {:d}', { d: prev.id });
      if (already > 0) throw util.fail(409, 'That decision was already corrected; correct the newest one.', 'already_corrected');
      corrects = prev.id;
      if (it === null && prev.getString('item') !== '') it = util.byId(app, 'agenda_items', prev.getString('item'));
      if (meeting === null && prev.getString('meeting') !== '') meeting = util.byId(app, 'ic_meetings', prev.getString('meeting'));
    }
    const rule = util.oneOf(p, 'rule', RU().RULES, (it && it.getString('rule')) || C().ruleOf(app, deal.getString('fund')));
    let tally = it !== null ? util.jsonOf(it, 'tally', null) : null;
    if (tally !== null && tally.rule !== rule) {
      const votes = (tally.votes || []).map((v) => Object.assign({}, v));
      tally = RU().tally({ scale: tally.scale, rule: rule, champion: it.getString('champion'), eligible: tally.eligible, votes: votes });
    }
    const reason = util.oneOf(p, 'reason', C().PASS_REASONS, '');
    const memo = it !== null && it.getString('memo') !== '' ? app.findRecordById('memos', it.getString('memo')) : (function () {
      const lm = C().latestMemo(app, deal.id);
      return lm !== null && lm.getString('status') !== 'draft' ? lm : null;
    })();
    const conds = cleanConditions(c, deal, util.list(p, 'conditions'));
    const d = util.newRecord(app, 'decisions');
    d.set('deal', deal.id);
    d.set('company', deal.getString('company'));
    d.set('item', it !== null ? it.id : '');
    d.set('meeting', meeting !== null ? meeting.id : '');
    d.set('fund', deal.getString('fund'));
    d.set('outcome', outcome);
    d.set('rule', rule);
    d.set('rule_result', tally ? tally.result : '');
    d.set('reason', reason);
    d.set('note', util.squash(util.text(p, 'note', 1000, '')));
    d.set('tally', tally);
    d.set('memo', memo !== null ? memo.id : '');
    d.set('memo_version', memo !== null ? memo.getInt('version') : 0);
    d.set('memo_hash', memo !== null ? memo.getString('hash') : '');
    d.set('snapshot', snapshotFor(c, deal, memo));
    d.set('decided_by', c.memberId);
    d.set('decided_at', util.nowIso());
    d.set('corrects', corrects);
    d.set('reviews', []);
    d.set('actor', 'person');
    d.set('member', c.memberId);
    app.save(d);
    for (const x of conds) {
      const cr = util.newRecord(app, 'conditions');
      cr.set('decision', d.id);
      cr.set('deal', deal.id);
      cr.set('text', x.text);
      cr.set('owner', x.owner);
      cr.set('due_day', x.due_day);
      cr.set('status', 'open');
      cr.set('actor', 'person');
      cr.set('member', c.memberId);
      app.save(cr);
    }
    if (corrects !== '') {
      for (const oc of util.findMany(app, 'conditions', "decision = {:d} && status = 'open'", '', 0, { d: corrects })) {
        oc.set('decision', d.id);
        app.save(oc);
      }
    }
    if (it !== null) {
      it.set('status', 'decided');
      it.set('decision', d.id);
      it.set('voting', 'closed');
      if (tally !== null) {
        it.set('tally', tally);
        it.set('rule', rule);
      }
      app.save(it);
    }
    if (memo !== null && memo.getString('status') === 'submitted') {
      memo.set('status', 'final');
      app.save(memo);
    }
    L('lib_audit').write(c, { op: 'decisions.record', collection: 'decisions', record: d.id, summary: (corrects !== '' ? 'Corrected the decision on ' : 'Recorded the decision on ') + (C().dealMini(app, deal.id) || { title: '' }).title + ': ' + C().OUTCOME_LABEL[outcome] + ' (' + C().RULE_LABEL[rule] + ')' });
    L('lib_events').emit(c, 'decision.recorded', { decision: d.id, deal: deal.id, outcome: outcome, corrects: corrects });
    return { decision: C().decisionOut(c, d, true) };
  });
  ctx.audited = true;
  return out;
}

function needDecisionsView(ctx) {
  const auth = L('lib_auth');
  if (auth.can(ctx, 'committee', 'view') || auth.can(ctx, 'pipeline', 'view')) return;
  auth.need(ctx, 'committee', 'view', 'see decisions');
}

/** decisions.list: the decision log, newest first (rows on deals you cannot see are counted in hidden). */
function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  needDecisionsView(ctx);
  const pg = util.page(p, 50, 300);
  const where = ['1 = 1'];
  const bind = {};
  const outcome = util.oneOf(p, 'outcome', RU().OUTCOMES, '');
  if (outcome !== '') {
    where.push('x.outcome = {:o}');
    bind.o = outcome;
  }
  if (util.str(p, 'deal', '') !== '') {
    where.push('x.deal = {:d}');
    bind.d = C().needDeal(ctx, util.str(p, 'deal', '')).id;
  }
  const vis = L('lib_deals').visibleSql(ctx, 'd');
  const w = where.join(' AND ');
  const all = util.count(app, 'SELECT COUNT(*) AS n FROM decisions x WHERE ' + w, bind);
  const b2 = Object.assign({}, bind, vis.bind);
  const shown = util.count(app, 'SELECT COUNT(*) AS n FROM decisions x JOIN deals d ON d.id = x.deal WHERE ' + w + ' AND ' + vis.sql, b2);
  const rows = util.rows(app, 'SELECT x.id AS id FROM decisions x JOIN deals d ON d.id = x.deal WHERE ' + w + ' AND ' + vis.sql + ' ORDER BY x.decided_at DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, b2);
  const counts = {};
  for (const r of util.rows(app, 'SELECT x.outcome AS outcome, COUNT(*) AS n FROM decisions x JOIN deals d ON d.id = x.deal WHERE ' + vis.sql + ' GROUP BY x.outcome', { outcome: '', n: 0 }, vis.bind)) counts[r.outcome] = r.n;
  return { decisions: rows.map((r) => C().decisionOut(ctx, app.findRecordById('decisions', r.id), false)), total: shown, hidden: all - shown, counts: counts };
}

/** decisions.get: one decision with votes (junior first, rationales), snapshot (NDA quotes only for those who may read them), conditions, reviews. */
function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  needDecisionsView(ctx);
  let d = null;
  if (util.str(p, 'decision', '') !== '') {
    d = util.byId(app, 'decisions', util.str(p, 'decision', ''));
    if (d === null) throw util.fail(404, 'No decision ' + util.str(p, 'decision', '') + '. Run decisions.list.', 'not_found');
    if (!C().canSeeDeal(ctx, d.getString('deal'))) throw util.fail(403, 'This decision is on a deal you cannot see.', 'restricted');
  } else {
    const deal = C().needDeal(ctx, util.req(p, 'deal', 'D-0012'));
    d = app.findRecordsByFilter('decisions', 'deal = {:d}', '-decided_at,-created', 1, 0, { d: deal.id })[0] || null;
    if (d === null) return { decision: null, history: [] };
  }
  const history = app.findRecordsByFilter('decisions', 'deal = {:d}', '-decided_at,-created', 50, 0, { d: d.getString('deal') }).map((x) => C().decisionOut(ctx, x, false));
  return { decision: C().decisionOut(ctx, d, true), history: history };
}

const REVIEW_EVENTS = ['raised', 'acquired', 'ipo', 'shut_down', 'pivoted', 'still_private', 'other'];

/** decisions.review-note: a later public outcome beside a decision (the anti-portfolio), with its source; your AI agent's note lands its anti_portfolio ask. */
function reviewNote(ctx, p) {
  if (ctx.isAgent) L('lib_agent').landed(ctx.app, 'anti_portfolio', L('lib_settings').row(ctx.app));
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent) L('lib_auth').need(ctx, 'committee', 'edit', 'add review notes');
  const d = util.byId(app, 'decisions', util.req(p, 'decision'));
  if (d === null) throw util.fail(404, 'No decision ' + util.str(p, 'decision', '') + '. Run decisions.anti-portfolio.', 'not_found');
  if (!C().canSeeDeal(ctx, d.getString('deal'))) throw util.fail(403, 'This decision is on a deal you cannot see.', 'restricted');
  const event = util.oneOf(p, 'event', REVIEW_EVENTS, '');
  if (event === '') throw util.fail(400, 'event is one of: ' + REVIEW_EVENTS.join(', ') + '.', 'missing_param', { param: 'event' });
  const text = util.squash(util.text(p, 'text', 400, ''));
  if (text === '') throw util.fail(400, 'text is the outcome in one line (what happened, with figures as published).', 'missing_param', { param: 'text' });
  const url = util.str(p, 'source_url', '');
  if (ctx.isAgent && url === '') throw util.fail(400, 'source_url is required: a later outcome is recorded only with its public source.', 'missing_param', { param: 'source_url' });
  if (url !== '' && !/^https?:\/\/[^\s/]+\.[^\s]+$/.test(url)) throw util.fail(400, 'source_url must be a full http(s) link.', 'invalid_param', { param: 'source_url' });
  const day = util.day(p, 'day', util.today(app));
  const reviews = util.jsonOf(d, 'reviews', []) || [];
  if (reviews.length >= 50) throw util.fail(409, 'This decision has 50 review notes already.', 'too_many');
  const note = { id: util.token(8), day: day, event: event, text: text, source_url: url, source_name: util.clip(util.squash(util.str(p, 'source_name', '')), 120), by: ctx.isAgent ? 'agent' : 'person', member: ctx.memberId || '', at: util.nowIso() };
  reviews.push(note);
  d.set('reviews', reviews);
  app.save(d);
  L('lib_audit').note(ctx, { collection: 'decisions', record: d.id, summary: 'Review note on the decision on ' + (C().dealMini(app, d.getString('deal')) || { title: '' }).title + ': ' + event });
  return { decision: d.id, review: note };
}

/** decisions.anti-portfolio: companies the firm passed on, with the reason and what it knew, beside later outcomes. */
function antiPortfolio(ctx, p) {
  const util = u();
  const app = ctx.app;
  needDecisionsView(ctx);
  const pg = util.page(p, 50, 300);
  const vis = L('lib_deals').visibleSql(ctx, 'd');
  const base = "FROM decisions x JOIN deals d ON d.id = x.deal WHERE x.outcome = 'pass' AND NOT EXISTS (SELECT 1 FROM decisions y WHERE y.corrects = x.id)";
  const all = util.count(app, 'SELECT COUNT(*) AS n ' + base);
  const shown = util.count(app, 'SELECT COUNT(*) AS n ' + base + ' AND ' + vis.sql, vis.bind);
  const rows = util.rows(app, 'SELECT x.id AS id ' + base + ' AND ' + vis.sql + ' ORDER BY x.decided_at DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, vis.bind);
  return {
    rows: rows.map((r) => {
      const d = app.findRecordById('decisions', r.id);
      const snap = util.jsonOf(d, 'snapshot', {}) || {};
      const sd = snap.deal || {};
      const reviews = util.jsonOf(d, 'reviews', []) || [];
      return {
        decision: d.id,
        decided_at: d.getString('decided_at'),
        company: C().mini(app, 'companies', d.getString('company')),
        deal: C().dealMini(app, d.getString('deal')),
        reason: d.getString('reason'),
        reason_label: C().REASON_LABEL[d.getString('reason')] || '',
        note: d.getString('note'),
        then: { round_type: sd.round ? sd.round.type || '' : '', raise_minor: sd.round ? sd.round.raise_minor : null, post_money_minor: sd.round ? sd.round.post_money_minor : null, currency: sd.currency || '', stage: sd.stage || '' },
        tally: C().decisionOut(ctx, d, false).tally,
        latest: reviews.length > 0 ? reviews[reviews.length - 1] : null,
        reviews: reviews,
      };
    }),
    total: shown,
    hidden: all - shown,
    ask: (function () {
      return L('lib_agent').track(L('lib_settings').row(app), 'anti_portfolio', ['Asked', 'Done']);
    })(),
  };
}

/* ----------------------------------------------------------- conditions */

/** conditions.list: open conditions by default (all deals you can see), or of a deal or decision. */
function condList(ctx, p) {
  const util = u();
  const app = ctx.app;
  needDecisionsView(ctx);
  const status = util.oneOf(p, 'status', ['open', 'done', 'waived', 'all'], 'open');
  const where = [];
  const bind = {};
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  if (util.str(p, 'deal', '') !== '') {
    where.push('deal = {:d}');
    bind.d = C().needDeal(ctx, util.str(p, 'deal', '')).id;
  }
  if (util.str(p, 'decision', '') !== '') {
    where.push('decision = {:x}');
    bind.x = util.str(p, 'decision', '');
  }
  if (util.bool(p, 'mine', false) && ctx.memberId) {
    where.push('owner = {:me}');
    bind.me = ctx.memberId;
  }
  const rows = util.findMany(app, 'conditions', where.length > 0 ? where.join(' && ') : '1=1', 'due_day,created', 500, bind);
  const out = [];
  let hidden = 0;
  for (const c of rows) {
    if (!C().canSeeDeal(ctx, c.getString('deal'))) {
      hidden++;
      continue;
    }
    out.push(C().conditionOut(app, c));
  }
  return { conditions: out, total: out.length, hidden: hidden };
}

/** conditions.save: add a condition to a decision (or deal), or change its text, owner, due day, or waive it. */
function condSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  L('lib_auth').need(ctx, 'committee', 'edit', 'change conditions');
  let c;
  const id = util.str(p, 'condition', '');
  if (id !== '') {
    c = util.byId(app, 'conditions', id);
    if (c === null) throw util.fail(404, 'No condition ' + id + '.', 'not_found');
    if (!C().canSeeDeal(ctx, c.getString('deal'))) throw util.fail(403, 'This condition is on a deal you cannot see.', 'restricted');
  } else {
    c = util.newRecord(app, 'conditions');
    let deal;
    if (util.str(p, 'decision', '') !== '') {
      const d = util.byId(app, 'decisions', util.str(p, 'decision', ''));
      if (d === null) throw util.fail(404, 'No decision ' + util.str(p, 'decision', '') + '.', 'not_found');
      deal = C().needDeal(ctx, d.getString('deal'));
      c.set('decision', d.id);
    } else deal = C().needDeal(ctx, util.req(p, 'deal', 'D-0012'));
    c.set('deal', deal.id);
    c.set('status', 'open');
    c.set('owner', deal.getString('point') || ctx.memberId);
    c.set('due_day', util.dayAdd(util.today(app), Number(C().settings(app).condition_days) || 14));
    L('lib_records').stampWritten(ctx, c);
  }
  if (util.has(p, 'text') || id === '') {
    const text = util.squash(util.text(p, 'text', 300, ''));
    if (text === '') throw util.fail(400, 'text is required.', 'missing_param', { param: 'text' });
    c.set('text', text);
  }
  if (util.has(p, 'owner')) c.set('owner', util.str(p, 'owner', '') === '' ? '' : L('lib_auth').memberRef(app, util.str(p, 'owner', '')).id);
  if (util.has(p, 'due_day')) c.set('due_day', util.day(p, 'due_day', ''));
  if (util.has(p, 'status')) {
    const st = util.oneOf(p, 'status', ['open', 'waived'], c.getString('status'));
    c.set('status', st);
  }
  app.save(c);
  L('lib_audit').note(ctx, { collection: 'conditions', record: c.id, summary: (id === '' ? 'Added' : 'Changed') + ' the condition "' + util.clip(c.getString('text'), 80) + '"' });
  return { condition: C().conditionOut(app, c) };
}

/** Preview of a condition completion proposal (your AI agent). */
function completePreview(ctx, p) {
  const c = u().byId(ctx.app, 'conditions', u().str(p, 'condition', ''));
  return { label: c ? 'Mark the condition "' + u().clip(c.getString('text'), 80) + '" done' : 'Mark a condition done', target: c ? 'conditions:' + c.id : '', fields: [{ name: 'proof', before: '', after: u().str(p, 'proof', '') }], notes: [], risk: 'medium' };
}

/** conditions.complete: a condition met, with its evidence (a link or a line). */
function condComplete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = util.byId(app, 'conditions', util.req(p, 'condition'));
  if (c === null) throw util.fail(404, 'No condition ' + util.str(p, 'condition', '') + '. Run conditions.list.', 'not_found');
  if (!C().canSeeDeal(ctx, c.getString('deal'))) throw util.fail(403, 'This condition is on a deal you cannot see.', 'restricted');
  if (!ctx.isAgent && c.getString('owner') !== ctx.memberId) L('lib_auth').need(ctx, 'committee', 'edit', "complete someone else's condition");
  if (c.getString('status') !== 'open') throw util.fail(409, 'This condition is ' + c.getString('status') + '.', 'not_open');
  const evidence = util.squash(util.text(p, 'proof', 1000, ''));
  if (ctx.isAgent && evidence === '') throw util.fail(400, 'proof is required: the link or quote that shows the condition is met.', 'missing_param', { param: 'proof' });
  c.set('status', 'done');
  c.set('evidence', evidence);
  c.set('completed_at', util.nowIso());
  c.set('completed_by', ctx.memberId || '');
  app.save(c);
  L('lib_audit').note(ctx, { collection: 'conditions', record: c.id, summary: 'Condition met: ' + util.clip(c.getString('text'), 100) });
  return { condition: C().conditionOut(app, c) };
}

module.exports = { cast: cast, status: status, statusOf: statusOf, reveal: reveal, record: record, list: list, get: get, reviewNote: reviewNote, antiPortfolio: antiPortfolio, condList: condList, condSave: condSave, condComplete: condComplete, completePreview: completePreview, REVIEW_EVENTS: REVIEW_EVENTS };
