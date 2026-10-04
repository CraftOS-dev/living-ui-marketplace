/// <reference path="../pb_data/types.d.ts" />
/**
 * The Inbox: the only door for automated data (office sync, CraftBot,
 * email). Proposals change nothing until a person accepts them.
 *
 * Kinds:
 *   office_change      field diffs and office events for a trademark or design
 *   document           one event (with dates and citations) on any record
 *   agent_proposal     an event and/or extra deadlines on any record
 *   email              same as agent_proposal, from an email
 *   agreement_draft    an agreement with its grants, read from a contract
 *   royalty_statement  statement lines for an agreement, read from a licensee's report
 *   permission         a new or changed inbound permission (game, music, platform)
 *   watch_hit          suspected counterfeits, impersonations or conflicting marks
 *
 * With settings.second_reviewer on, accepting an automated proposal that
 * creates a statutory deadline needs a second, different person.
 */

routerAdd('POST', '/api/ops/inbox/propose', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(
    e,
    'contribute',
    (b, ctx) => {
      const u = ctx.u;
      const reports = require(`${__hooks}/lib_reports.js`);
      const engine = require(`${__hooks}/lib_engine.js`);
      const KINDS = ['document', 'agreement_draft', 'royalty_statement', 'permission', 'watch_hit', 'agent_proposal', 'email'];
      const kind = KINDS.indexOf(b.kind) >= 0 ? b.kind : 'agent_proposal';
      const title = String(b.title || '').trim();
      if (!title) throw u.err('A proposal needs a title.', '提案には件名が必要です。');
      const data = {
        kind: kind,
        title: title.slice(0, 400),
        summary: String(b.summary || '').slice(0, 4000),
        status: 'new',
        document: String(b.document_id || ''),
        agreement: String(b.agreement_id || ''),
        proposal: u.asObject(b.proposal),
        diffs: u.asArray(b.diffs),
        confidence: ['high', 'medium', 'low', 'none'].indexOf(b.confidence) >= 0 ? b.confidence : 'medium',
        citations: u.asArray(b.citations),
        source: ctx.superuser ? 'agent' : String(b.source || 'user') === 'agent' ? 'agent' : 'user',
        proposed_by: String(b.proposed_by || (ctx.superuser ? 'CraftBot' : u.userLabel(e.app, ctx.actor))),
        requires_second: false,
      };
      // Subject: explicit type and id, or a trademark found by reference or number.
      let type = String(b.subject_type || '');
      let id = String(b.subject_id || '');
      if (type === 'trademark' || type === 'design') type = 'matter';
      if (!type && (b.matter_id || b.matter_ref)) {
        type = 'matter';
        id = String(b.matter_id || '');
        if (!id && b.matter_ref) {
          const want = reports.normNum(b.matter_ref);
          for (const m of u.findMany(e.app, 'matters', '', '', 0)) {
            if (reports.normNum(m.getString('ref')) === want || reports.normNum(m.getString('application_no')) === want || reports.normNum(m.getString('registration_no')) === want) {
              id = m.id;
              break;
            }
          }
        }
      }
      const FIELDS = { matter: 'matter', agreement: 'agreement', work: 'work', character: 'character', talent: 'talent', product: 'product', permission: 'permission', committee: 'committee', case: 'case_ref' };
      if (type && FIELDS[type] && id) {
        if (engine.subjectOf(e.app, type, id) === null) throw u.err('The ' + type + ' was not found.', '対象の記録が見つかりません。');
        data[FIELDS[type]] = id;
        data.subject_type = type;
      } else if (type && engine.SUBJECTS[type] && id) {
        // Other subjects (claims, recordations) are kept in the proposal.
        data.subject_type = type;
        data.proposal.subject_id = id;
      }
      const rec = u.newRecord(e.app, 'inbox_items', data);
      e.app.save(rec);
      return { id: rec.id, subject_type: data.subject_type || '', subject_id: id };
    },
    201,
  ),
);

routerAdd('POST', '/api/ops/inbox/preview', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const u = ctx.u;
    const engine = require(`${__hooks}/lib_engine.js`);
    const item = require(`${__hooks}/lib_ops.js`).need(e.app, 'inbox_items', b.id, 'Inbox item', 'インボックスの項目');
    const kind = item.getString('kind');
    const proposal = u.j(item, 'proposal', {});
    const subj = require(`${__hooks}/lib_inbox.js`).inboxSubject(e.app, item, b);
    if (kind === 'agreement_draft') {
      const rights = require(`${__hooks}/lib_rights.js`);
      const grants = u.asArray(b.grants !== undefined ? b.grants : proposal.grants).filter((g) => g && g.direction === 'out');
      return { kind: kind, conflicts: grants.length ? rights.conflicts(e.app, '', grants).conflicts : [] };
    }
    if (kind === 'royalty_statement') {
      const lic = require(`${__hooks}/lib_licensing.js`);
      // The reviewer may pick a different licence than the proposal named; price against that one.
      const agr = u.byId(e.app, 'agreements', String(b.agreement_id || proposal.agreement_id || item.getString('agreement')));
      const lines = u.asArray(b.lines !== undefined ? b.lines : proposal.lines).map((l) => {
        const priced = agr ? lic.priceLine(agr, l) : { rate: Number(l.rate) || 0, royalty: Number(l.royalty) || 0, explain: '' };
        return Object.assign({}, l, { computed_royalty: priced.royalty, computed_rate: priced.rate, explain: priced.explain, differs: Math.abs((Number(l.royalty) || 0) - priced.royalty) > 1 });
      });
      return { kind: kind, agreement: agr ? { id: agr.id, ref: agr.getString('ref'), basis: agr.getString('royalty_basis') } : null, lines: lines };
    }
    if (kind === 'permission') {
      const existing = proposal.permission_id ? u.byId(e.app, 'permissions', String(proposal.permission_id)) : null;
      const fields = u.asObject(proposal.fields);
      const diffs = [];
      if (existing) {
        for (const k of Object.keys(fields)) {
          const cur = existing.get(k);
          const curS = cur === null || cur === undefined ? '' : typeof cur === 'object' ? JSON.stringify(u.j(existing, k, null)) : String(cur);
          const inc = typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : String(fields[k]);
          if (curS.slice(0, 10) !== inc.slice(0, 10) || curS !== inc) diffs.push({ field: k, current: curS, incoming: inc });
        }
      }
      return { kind: kind, existing: existing ? { id: existing.id, title: existing.getString('title') } : null, diffs: diffs };
    }
    if (kind === 'watch_hit') return { kind: kind, hits: u.asArray(proposal.hits) };
    const out = [];
    if (subj !== null) {
      if (kind === 'office_change') {
        u.asArray(proposal.events).forEach((ev, idx) => {
          if (!ev || !ev.code || !ev.date) return;
          out.push({ index: idx, code: ev.code, date: ev.date, label: ev.label, proposals: engine.proposalsFor(e.app, subj, { code: ev.code, date: ev.date, data: {} }) });
        });
      } else if (proposal.event && proposal.event.code) {
        const ev = u.asObject(b.event_override).code ? u.asObject(b.event_override) : proposal.event;
        out.push({ index: 0, code: ev.code, date: u.d10(ev.date), label: ev.label || '', proposals: engine.proposalsFor(e.app, subj, { code: ev.code, date: u.d10(ev.date), data: require(`${__hooks}/lib_inbox.js`).eventData(u, ev) }) });
      }
    }
    return { kind: kind, subject_type: subj ? subj.type : '', subject_id: subj ? subj.id : '', events: out };
  }),
);

routerAdd('POST', '/api/ops/inbox/decide', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const engine = require(`${__hooks}/lib_engine.js`);
    const item = require(`${__hooks}/lib_ops.js`).need(e.app, 'inbox_items', b.id, 'Inbox item', 'インボックスの項目');
    const status = item.getString('status');
    if (status !== 'new' && status !== 'awaiting_second') throw u.err('This item was already decided.', 'この項目はすでに判断済みです。');
    const actor = ctx.actor;
    const decision = String(b.decision || '');
    function close(st, extra) {
      item.set('status', st);
      item.set('decided_by', actor);
      item.set('decided_at', new Date().toISOString());
      item.set('note', String(b.note || '').slice(0, 2000));
      e.app.save(item);
      u.audit(e.app, actor, st === 'rejected' ? 'reject' : 'accept', 'inbox_items', item.id, item.getString('title'), extra || {}, String(b.note || ''));
    }
    if (decision === 'reject') {
      close('rejected');
      return { status: 'rejected' };
    }
    if (decision !== 'accept') throw u.err('Decision must be accept or reject.', '判断は承認または却下です。');
    const kind = item.getString('kind');
    const proposal = u.j(item, 'proposal', {});

    if (kind === 'agreement_draft') {
      const a = u.asObject(b.agreement && Object.keys(u.asObject(b.agreement)).length ? b.agreement : proposal.agreement);
      if (!a.title) throw u.err('The draft has no agreement title.', '下書きに契約名がありません。');
      let cpId = String(a.counterparty_id || '');
      const cpName = String(a.counterparty_name || a.counterparty || '').trim();
      if (!cpId && cpName) {
        let cp = u.findOne(e.app, 'parties', 'name = {:n}', { n: cpName });
        if (cp === null) {
          cp = u.newRecord(e.app, 'parties', { name: cpName, kind: 'organization', roles: [a.direction === 'in' ? 'licensor' : 'licensee'] });
          e.app.save(cp);
        }
        cpId = cp.id;
      }
      const allowed = [
        'agreement_type', 'direction', 'status', 'our_entity', 'signed_date', 'effective_date', 'term_start', 'term_end', 'perpetual', 'auto_renew',
        'renewal_notice_days', 'exclusivity', 'territory_summary', 'currency', 'royalty_rate', 'royalty_basis', 'rate_tiers', 'deduction_cap_pct', 'flat_fee',
        'advance', 'minimum_guarantee', 'mg_recoupable', 'cross_collateral', 'payment_schedule', 'reporting_frequency', 'report_due_days', 'late_interest_pct',
        'audit_threshold_pct', 'option_period_end', 'option_extension_fee', 'reversion_date', 'sell_off_days', 'sell_off_on_expiry_only', 'samples_owed',
        'approval_sla_days', 'approval_timeout', 'original_approval_required', 'talent_approval_required', 'copyright_notice', 'sublicense_allowed',
        'delivery_schedule', 'completion_deadline', 'sequel_negotiation_end', 'author_grant', 'art27_28', 'moral_rights_waiver', 'payment_due_days',
        'non_compete', 'stage_name_clause', 'post_term', 'revenue_share', 'governing_law', 'summary',
      ];
      const dateKeys = ['signed_date', 'effective_date', 'term_start', 'term_end', 'option_period_end', 'reversion_date', 'completion_deadline', 'sequel_negotiation_end'];
      const data = {
        title: String(a.title),
        counterparty: cpId,
        franchise: String(a.franchise_id || ''),
        work: String(a.work_id || ''),
        committee: String(a.committee_id || ''),
        ai_extracted: item.getString('source') === 'agent',
        responsible: actor,
      };
      for (const k of allowed) {
        if (a[k] === undefined || a[k] === null || a[k] === '') continue;
        data[k] = dateKeys.indexOf(k) >= 0 && typeof a[k] === 'string' ? u.toPb(a[k]) : a[k];
      }
      if (!data.agreement_type) data.agreement_type = 'other';
      if (!data.direction) data.direction = 'none';
      if (!data.status) data.status = 'draft';
      const agr = u.newRecord(e.app, 'agreements', data);
      e.app.save(agr);
      let grants = 0;
      for (const g of u.asArray(b.grants !== undefined ? b.grants : proposal.grants)) {
        if (!g) continue;
        e.app.save(
          u.newRecord(e.app, 'grants', {
            agreement: agr.id,
            direction: g.direction === 'in' ? 'in' : 'out',
            kind: ['grant', 'holdback', 'restriction', 'reservation', 'window'].indexOf(g.kind) >= 0 ? g.kind : 'grant',
            exclusive: g.exclusive === true,
            holders: u.asArray(g.holders),
            fee_pct: Number(g.fee_pct) || 0,
            fee_base: g.fee_base === 'gross' ? 'gross' : 'net',
            franchises: u.asArray(g.franchises),
            works: u.asArray(g.works),
            characters: u.asArray(g.characters),
            songs: u.asArray(g.songs),
            recordings: u.asArray(g.recordings),
            matters: u.asArray(g.matters),
            dims: u.asObject(g.dims),
            term_start: u.toPb(g.term_start),
            term_end: u.toPb(g.term_end),
            rights_text: String(g.rights_text || ''),
            override_reason: String(g.override_reason || (item.getString('source') === 'agent' ? 'Accepted from a contract read by CraftBot; conflicts shown in the Inbox preview.' : '')),
          }),
        );
        grants += 1;
      }
      if (item.getString('document')) {
        const doc = u.byId(e.app, 'documents', item.getString('document'));
        if (doc !== null) {
          doc.set('agreement', agr.id);
          doc.set('doc_type', 'contract');
          e.app.save(doc);
        }
      }
      item.set('agreement', agr.id);
      close('accepted', { agreement: agr.id, grants: grants });
      return { status: 'accepted', agreement_id: agr.id, grants: grants };
    }

    if (kind === 'royalty_statement') {
      const lic = require(`${__hooks}/lib_licensing.js`);
      const agr = u.byId(e.app, 'agreements', String(b.agreement_id || proposal.agreement_id || item.getString('agreement')));
      if (agr === null) throw u.err('Choose the agreement this statement belongs to.', 'この報告の契約を選んでください。');
      const pe = u.d10(b.period_end || proposal.period_end);
      if (!pe) throw u.err('The statement needs its period end date.', '報告の対象期間末日が必要です。');
      let rep = proposal.report_id ? u.byId(e.app, 'royalty_reports', String(proposal.report_id)) : u.findOne(e.app, 'royalty_reports', 'agreement = {:a} && period_end = {:p}', { a: agr.id, p: u.toPb(pe) });
      if (rep === null) {
        rep = u.newRecord(e.app, 'royalty_reports', {
          agreement: agr.id,
          period_start: u.toPb(proposal.period_start),
          period_end: u.toPb(pe),
          currency: String(proposal.currency || agr.getString('currency')),
          status: 'received',
        });
      }
      rep.set('status', 'received');
      rep.set('received_date', u.toPb(u.d10(proposal.received_date) || u.today()));
      if (item.getString('document')) rep.set('document', item.getString('document'));
      e.app.save(rep);
      let n = 0;
      for (const l of u.asArray(b.lines !== undefined ? b.lines : proposal.lines)) {
        if (!l) continue;
        const priced = lic.priceLine(agr, l);
        e.app.save(
          u.newRecord(e.app, 'royalty_lines', {
            report: rep.id,
            product: String(l.product_id || ''),
            description: String(l.description || ''),
            territory: String(l.territory || ''),
            manufactured_qty: Number(l.manufactured_qty) || 0,
            sold_qty: Number(l.sold_qty) || 0,
            retail_price: Number(l.retail_price) || 0,
            wholesale_price: Number(l.wholesale_price) || 0,
            rate: priced.rate,
            royalty: priced.royalty,
            currency: String(l.currency || rep.getString('currency')),
            notes: [
              l.royalty !== undefined && l.royalty !== '' && Math.abs((Number(l.royalty) || 0) - priced.royalty) > 1 ? 'Licensee reported ' + l.royalty + '; recomputed ' + priced.royalty + ' (' + priced.explain + ').' : '',
              String(l.notes || ''),
            ].filter((x) => x !== '').join(' '),
          }),
        );
        n += 1;
      }
      lic.recalcReport(e.app, u.byId(e.app, 'royalty_reports', rep.id));
      close('accepted', { report: rep.id, lines: n });
      return { status: 'accepted', report_id: rep.id, lines: n };
    }

    if (kind === 'permission') {
      const fields = u.asObject(b.fields !== undefined ? b.fields : proposal.fields);
      const allowed = ['title', 'permission_type', 'subject_name', 'source', 'guideline_url', 'guideline_revision', 'approval_id', 'all_talents', 'talents', 'characters', 'platforms', 'monetization', 'archive', 'content_limits', 'credit_line', 'regions', 'start_date', 'end_date', 'status', 'recheck_days', 'notes', 'counterparty'];
      let perm = proposal.permission_id ? u.byId(e.app, 'permissions', String(proposal.permission_id)) : null;
      const created = perm === null;
      if (perm === null) perm = u.newRecord(e.app, 'permissions', { status: 'active', source: 'public_guideline', permission_type: 'game_title' });
      for (const k of allowed) {
        if (fields[k] === undefined) continue;
        perm.set(k, ['guideline_revision', 'start_date', 'end_date'].indexOf(k) >= 0 ? u.toPb(fields[k]) : fields[k]);
      }
      if (!perm.getString('title')) throw u.err('The permission needs a title.', '許諾には名称が必要です。');
      perm.set('last_checked', u.toPb(u.today()));
      if (item.getString('document')) perm.set('snapshot', item.getString('document'));
      e.app.save(perm);
      close('accepted', { permission: perm.id, created: created });
      return { status: 'accepted', permission_id: perm.id, created: created };
    }

    if (kind === 'watch_hit') {
      const chosen = b.hits !== undefined ? u.asArray(b.hits).map(Number) : null;
      let n = 0;
      u.asArray(proposal.hits).forEach((h, idx) => {
        if (!h || (chosen !== null && chosen.indexOf(idx) < 0)) return;
        e.app.save(
          u.newRecord(e.app, 'watch_hits', {
            kind: ['trademark', 'marketplace', 'impersonation', 'web'].indexOf(h.kind) >= 0 ? h.kind : 'marketplace',
            their_mark: String(h.their_mark || h.title || 'Listing').slice(0, 300),
            their_owner: String(h.their_owner || h.seller || ''),
            url: String(h.url || ''),
            jurisdiction: String(h.jurisdiction || '').toUpperCase().slice(0, 3),
            character: String(h.character_id || ''),
            talent: String(h.talent_id || ''),
            matter: String(h.matter_id || ''),
            goods: String(h.goods || h.description || ''),
            score: Number(h.score) || 0,
            status: 'new',
            source: item.getString('proposed_by') || 'Inbox',
            notes: String(h.notes || ''),
          }),
        );
        n += 1;
      });
      close(chosen !== null && chosen.length < u.asArray(proposal.hits).length ? 'partially_accepted' : 'accepted', { hits: n });
      return { status: item.getString('status'), hits: n };
    }

    // Event-based proposals on any record.
    const subj = require(`${__hooks}/lib_inbox.js`).inboxSubject(e.app, item, b);
    if (subj === null) throw u.err('Choose the record this belongs to.', 'この項目の対象の記録を選んでください。');
    const secondRequired = u.setting(e.app, 'second_reviewer', false) === true;
    const summary = { fields: 0, events: 0, deadlines: 0, created: [] };
    const eventPlans = [];
    if (kind === 'office_change') {
      const chosen = b.events !== undefined ? u.asArray(b.events).map(Number) : null;
      u.asArray(proposal.events).forEach((ev, idx) => {
        if (!ev || !ev.date) return;
        if (chosen !== null && chosen.indexOf(idx) < 0) return;
        const mapped = u.asObject(b.map_raw)[String(idx)];
        const code = ev.code || mapped || '';
        if (!code) return;
        eventPlans.push({ code: code, date: ev.date, label: ev.label || '', data: { raw_code: ev.raw_code || '', office: item.getString('office') }, select: u.asObject(b.deadlines)[String(idx)] });
      });
    } else if (proposal.event && proposal.event.code) {
      const ev = u.asObject(b.event_override).code ? u.asObject(b.event_override) : proposal.event;
      eventPlans.push({ code: ev.code, date: u.d10(ev.date), label: ev.label || '', data: require(`${__hooks}/lib_inbox.js`).eventData(u, ev), select: u.asObject(b.deadlines)['0'] });
    }
    let statutory = false;
    for (const plan of eventPlans) {
      if (!engine.EVENT_CODES[plan.code]) throw u.err('Unknown event code: ' + plan.code, '不明なイベントコード：' + plan.code);
      for (const p of engine.proposalsFor(e.app, subj, { code: plan.code, date: plan.date, data: plan.data })) {
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
        p2.first_decision = { fields: b.fields, events: b.events, map_raw: b.map_raw, deadlines: b.deadlines, event_override: b.event_override, extra_deadlines: b.extra_deadlines, subject_type: subj.type, subject_id: subj.id };
        item.set('proposal', p2);
        e.app.save(item);
        for (const m of u.usersWithRoles(e.app, ['admin', 'manager', 'rights'])) {
          if (m.id === actor) continue;
          u.notify(
            e.app,
            m.id,
            'inbox',
            u.bi('Second review needed: ' + item.getString('title'), '2人目の確認が必要：' + item.getString('title')),
            u.bi('Approved by ' + u.userLabel(e.app, actor) + '. Statutory deadlines from CraftBot need a second reviewer.', u.userLabel(e.app, actor) + 'が承認。CraftBotの法定期限は2人目の確認が必要です。'),
            '#/inbox/' + item.id,
            {},
          );
        }
        u.audit(e.app, actor, 'accept', 'inbox_items', item.id, item.getString('title'), {}, 'First approval (second reviewer required)');
        return { status: 'awaiting_second' };
      }
      if (item.getString('first_approver') === actor) throw u.err('A different person must give the second approval.', '2人目の承認は別の人が行う必要があります。');
    }
    let rejectedSome = false;
    if (subj.type === 'matter') {
      const m = subj.record;
      const diffs = u.asArray(u.j(item, 'diffs', []));
      const acceptFields = b.fields !== undefined ? u.asArray(b.fields) : diffs.map((d) => d.field);
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
        if (['title', 'application_no', 'publication_no', 'registration_no', 'owner_of_record', 'office_status', 'counsel', 'client_ref'].indexOf(k) >= 0 && pf[k]) {
          m.set(k, String(pf[k]));
          summary.fields += 1;
        }
      }
      if (summary.fields) e.app.save(m);
      for (const au of u.asArray(proposal.annuity_updates)) {
        if (b.annuity === false) break;
        const dl = u.byId(e.app, 'deadlines', au.deadline_id);
        if (dl === null || dl.getString('status') !== 'open') continue;
        const calc = u.j(dl, 'calculation', {});
        const steps = Array.isArray(calc.steps) ? calc.steps.slice() : [];
        steps.push(u.bi('Official due date from the office: ' + u.human(au.incoming) + ' (computed ' + u.human(au.current) + '). Locked to the official date.', '官庁の公式期限：' + u.humanJa(au.incoming) + '（計算値 ' + u.humanJa(au.current) + '）。公式期限に固定しました。'));
        calc.steps = steps;
        dl.set('calculation', calc);
        dl.set('due_date', u.toPb(au.incoming));
        dl.set('locked', true);
        e.app.save(dl);
      }
    }
    const docId = item.getString('document');
    for (const plan of eventPlans) {
      const res = engine.recordEvent(e.app, engine.subjectOf(e.app, subj.type, subj.id), plan.code, plan.date, {
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
    const field = engine.SUBJECTS[subj.type].field;
    for (const x of u.asArray(b.extra_deadlines !== undefined ? b.extra_deadlines : proposal.extra_deadlines)) {
      if (!x || !x.title || !u.d10(x.due_date)) continue;
      const data = {
        title: String(x.title),
        title_ja: String(x.title_ja || x.title),
        kind: ['hard', 'extendable', 'designated', 'internal', 'reminder'].indexOf(x.kind) >= 0 ? x.kind : 'internal',
        category: x.category || 'other',
        status: 'open',
        due_date: u.toPb(x.due_date),
        source: 'inbox',
        calculation: {
          steps: [u.bi('Proposed by ' + item.getString('proposed_by') + ' and accepted by ' + u.userLabel(e.app, actor) + '.', item.getString('proposed_by') + 'が提案し、' + u.userLabel(e.app, actor) + 'が承認。')].concat(
            x.reason ? [u.bi(String(x.reason), String(x.reason))] : [],
          ),
        },
        citation: String(x.citation || ''),
      };
      data[field] = subj.id;
      const rec = u.newRecord(e.app, 'deadlines', data);
      e.app.save(rec);
      summary.deadlines += 1;
      summary.created.push({ id: rec.id, title: rec.getString('title'), due_date: u.d10(x.due_date) });
    }
    if (docId) {
      const doc = u.byId(e.app, 'documents', docId);
      const docFields = { matter: 'matter', agreement: 'agreement', work: 'work', character: 'character', talent: 'talent', product: 'product', permission: 'permission', committee: 'committee', case: 'case_ref' };
      if (doc !== null) {
        if (docFields[subj.type] && !doc.getString(docFields[subj.type])) doc.set(docFields[subj.type], subj.id);
        if (proposal.document_type) doc.set('doc_type', String(proposal.document_type));
        if (proposal.summary && !doc.getString('summary')) doc.set('summary', String(proposal.summary).slice(0, 8000));
        e.app.save(doc);
      }
    }
    if (subj.type === 'matter') engine.refreshMatterSummary(e.app, subj.id);
    const relField = { matter: 'matter', agreement: 'agreement', work: 'work', character: 'character', talent: 'talent', product: 'product', permission: 'permission', committee: 'committee', case: 'case_ref' }[subj.type];
    if (relField) item.set(relField, subj.id);
    item.set('subject_type', subj.type);
    close(rejectedSome ? 'partially_accepted' : 'accepted', summary);
    return { status: item.getString('status'), summary: summary };
  }),
);

