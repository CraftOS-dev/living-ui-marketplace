/// <reference path="../pb_data/types.d.ts" />
/**
 * CRM System schema (one person and their AI agent, auth mode none,
 * loopback only).
 *
 * Money is an integer count of the currency's minor unit (cents). Dates are
 * text YYYY-MM-DD; moments (last interaction, stage entered) are ISO text.
 * Collections can be read by the UI (live updates) and are written only
 * through the operations, which validate every change, decide what the AI
 * agent may write and what it may only propose, and log every change with
 * its undo.
 *
 *   settings      one row: the workspace, your name, home currency, the AI
 *                 agent's policy (autonomy per kind of change, house rules)
 *   companies     organizations, keyed on their root domain
 *   people        contacts, keyed on their email addresses
 *   employments   job history (person, company, title, from, to)
 *   pipelines     sales, fundraising, hiring, partnerships ...; stages
 *                 their columns (probability, won/lost, rotting, target)
 *   deals         opportunities in a pipeline; deal_people who is on a deal
 *                 and in what role; stage_events every stage change
 *   lists         lighter processes over people or companies; list_entries
 *   fields        custom fields per object (values live in record.custom)
 *   notes, interactions, tasks, emails   the work on a record
 *   proposals     changes the AI agent proposed for the person to decide
 *   views         saved filters, sorts and columns
 *   aliases       merged record ids -> the surviving record
 *   dupe_ignores  pairs the person said are not duplicates
 *   fx_rates      exchange rates to the home currency
 *   asks          questions and jobs for the AI agent
 *   activity      every change with who made it and its undo
 *
 * Installs of the earlier CRM System (multi-user, different collections
 * with some of the same names) are converted here: companies, people,
 * lists, pipelines and stages, deals, notes, tasks and logged calls,
 * meetings and emails are carried over, then the old collections go.
 */
migrate(
  (app) => {
    const old = (name) => {
      try {
        return app.findCollectionByNameOrId(name);
      } catch {
        return null;
      }
    };

    /* ------------------------------------------------ read the earlier app */
    const legacy = { companies: [], people: [], lists: [], entries: [], stages: [], deals: [], notes: [], tasks: [], acts: [], emails: [], attrs: [], values: [] };
    const oldPeople = old('people');
    const isLegacy = oldPeople !== null && oldPeople.fields.getByName('primary_email') === null;
    if (isLegacy) {
      const all = (name) => {
        const c = old(name);
        return c === null ? [] : app.findRecordsByFilter(c, 'id != ""', '', 0, 0);
      };
      const s = (r, f) => {
        try {
          return r.getString(f);
        } catch {
          return '';
        }
      };
      const tagNames = {};
      for (const t of all('tags')) tagNames[t.id] = s(t, 'name');
      const tagsOf = (r) => {
        let ids = [];
        try {
          ids = r.getStringSlice('tags');
        } catch {
          ids = [];
        }
        return ids.map((id) => tagNames[id]).filter((x) => !!x);
      };
      // A relation that may hold one id or several.
      const ids = (r, f) => {
        try {
          return r.getStringSlice(f).filter((x) => !!x);
        } catch {
          const one = s(r, f);
          return one ? [one] : [];
        }
      };
      for (const r of all('companies')) legacy.companies.push({ id: r.id, name: s(r, 'name'), domain: s(r, 'domain'), industry: s(r, 'industry'), tags: tagsOf(r), created: s(r, 'created') });
      for (const r of all('people')) legacy.people.push({ id: r.id, name: s(r, 'name'), email: s(r, 'email'), phone: s(r, 'phone'), title: s(r, 'title'), company: s(r, 'company'), tags: tagsOf(r), created: s(r, 'created') });
      for (const r of all('lists')) legacy.lists.push({ id: r.id, name: s(r, 'name'), entity: s(r, 'entity') });
      for (const r of all('list_entries')) legacy.entries.push({ list: s(r, 'list'), record: s(r, 'record_id'), stage: s(r, 'stage') });
      for (const r of all('stages')) legacy.stages.push({ id: r.id, name: s(r, 'name'), order: r.getFloat('order'), list: s(r, 'list') });
      for (const r of all('deals')) legacy.deals.push({ id: r.id, name: s(r, 'name'), value: r.getFloat('value'), stage: s(r, 'stage'), company: s(r, 'company'), people: ids(r, 'person'), close: s(r, 'close_date'), tags: tagsOf(r), created: s(r, 'created') });
      for (const r of all('notes')) legacy.notes.push({ body: s(r, 'body'), person: s(r, 'person'), company: s(r, 'company'), deal: s(r, 'deal'), created: s(r, 'created') });
      for (const r of all('tasks')) legacy.tasks.push({ title: s(r, 'title'), due: s(r, 'due'), done: r.getBool('done'), person: s(r, 'person'), deal: s(r, 'deal'), updated: s(r, 'updated') });
      for (const r of all('activities')) legacy.acts.push({ kind: s(r, 'kind'), body: s(r, 'body'), person: s(r, 'person'), company: s(r, 'company'), deal: s(r, 'deal'), created: s(r, 'created') });
      for (const r of all('emails')) legacy.emails.push({ to: s(r, 'to'), subject: s(r, 'subject'), body: s(r, 'body'), status: s(r, 'status'), person: s(r, 'person'), created: s(r, 'created') });
      for (const r of all('attributes')) legacy.attrs.push({ id: r.id, entity: s(r, 'entity'), name: s(r, 'name'), type: s(r, 'type'), options: s(r, 'options') });
      for (const r of all('attribute_values')) legacy.values.push({ attribute: s(r, 'attribute'), record: s(r, 'record_id'), value: s(r, 'value') });
      // Drop the earlier collections. They reference each other (tags from
      // companies, people and deals; attributes from their values), so delete
      // whatever nothing points at any more, pass after pass.
      let left = ['attribute_values', 'attributes', 'saved_views', 'email_templates', 'emails', 'attachments', 'activities', 'tasks', 'notes', 'list_entries', 'deals', 'people', 'stages', 'lists', 'tags', 'companies'].filter((n) => old(n) !== null);
      for (let pass = 0; left.length > 0 && pass < 20; pass++) {
        const next = [];
        for (const name of left) {
          try {
            app.delete(old(name));
          } catch {
            next.push(name);
          }
        }
        if (next.length === left.length) throw new Error('Could not remove the earlier collections: ' + next.join(', '));
        left = next;
      }
    }

    /* ----------------------------------------------------------- the schema */
    const read = { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null };
    const stamp = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const save = (def) => {
      const c = new Collection(Object.assign({ type: 'base' }, read, def, { fields: def.fields.concat(stamp) }));
      app.save(c);
      return c;
    };
    const day = (name) => ({ name: name, type: 'text', max: 10, pattern: '^$|^\\d{4}-\\d{2}-\\d{2}$' });
    const text = (name, max) => ({ name: name, type: 'text', max: max });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 200000 });
    const rel = (name, c, cascade, max) => ({ name: name, type: 'relation', collectionId: c.id, maxSelect: max || 1, cascadeDelete: !!cascade });
    const sel = (name, values) => ({ name: name, type: 'select', maxSelect: 1, values: values });
    const agentState = sel('agent_state', ['waiting', 'working', 'done', 'failed']);

    save({
      name: 'settings',
      fields: [text('workspace', 120), text('owner_name', 80), text('home_currency', 3), { name: 'keep_in_touch_default', type: 'number' }, json('policy', 40000), json('ui', 20000), day('brief_last'), { name: 'setup_done', type: 'bool' }],
    });

    const companies = save({
      name: 'companies',
      fields: [
        { name: 'name', type: 'text', required: true, max: 200 },
        json('domains', 20000),
        text('primary_domain', 253),
        text('industry', 80),
        text('size', 20),
        text('location', 160),
        text('description', 2000),
        text('linkedin', 300),
        text('source', 80),
        json('tags', 20000),
        text('last_interaction', 30),
        { name: 'strength', type: 'number' },
        json('custom', 100000),
        json('prov', 40000),
        agentState,
        text('agent_note', 500),
        text('deleted', 30),
        text('merged_into', 15),
      ],
      indexes: ['CREATE INDEX idx_companies_domain ON companies (primary_domain)', 'CREATE INDEX idx_companies_deleted ON companies (deleted)'],
    });

    const people = save({
      name: 'people',
      fields: [
        text('first_name', 80),
        text('last_name', 80),
        json('emails', 20000),
        text('primary_email', 254),
        json('phones', 20000),
        text('title', 160),
        rel('company', companies, false),
        text('linkedin', 300),
        text('location', 160),
        text('birthday', 10),
        text('how_met', 500),
        text('source', 80),
        json('tags', 20000),
        { name: 'keep_in_touch', type: 'number' },
        text('last_interaction', 30),
        day('next_touch'),
        { name: 'strength', type: 'number' },
        { name: 'touches', type: 'number' },
        json('custom', 100000),
        json('prov', 40000),
        agentState,
        text('agent_note', 500),
        text('deleted', 30),
        text('merged_into', 15),
      ],
      indexes: ['CREATE INDEX idx_people_email ON people (primary_email)', 'CREATE INDEX idx_people_company ON people (company)', 'CREATE INDEX idx_people_deleted ON people (deleted)'],
    });

    save({
      name: 'employments',
      fields: [rel('person', people, true), rel('company', companies, true), text('title', 160), day('start'), day('end'), { name: 'current', type: 'bool' }],
      indexes: ['CREATE INDEX idx_employments_person ON employments (person)', 'CREATE INDEX idx_employments_company ON employments (company)'],
    });

    const pipelines = save({
      name: 'pipelines',
      fields: [{ name: 'name', type: 'text', required: true, max: 80 }, sel('kind', ['sales', 'fundraising', 'hiring', 'partnerships', 'other']), text('currency', 3), { name: 'target', type: 'number' }, { name: 'position', type: 'number' }, { name: 'archived', type: 'bool' }],
    });

    const stages = save({
      name: 'stages',
      fields: [
        rel('pipeline', pipelines, true),
        { name: 'name', type: 'text', required: true, max: 60 },
        { name: 'position', type: 'number' },
        sel('kind', ['open', 'won', 'lost']),
        { name: 'probability', type: 'number' },
        { name: 'rot_days', type: 'number' },
        { name: 'target_days', type: 'number' },
        text('color', 20),
      ],
      indexes: ['CREATE INDEX idx_stages_pipeline ON stages (pipeline)'],
    });

    const deals = save({
      name: 'deals',
      fields: [
        { name: 'name', type: 'text', required: true, max: 200 },
        rel('pipeline', pipelines, false),
        rel('stage', stages, false),
        sel('status', ['open', 'won', 'lost']),
        { name: 'value', type: 'number' },
        text('currency', 3),
        { name: 'home_value', type: 'number' },
        { name: 'prob_override', type: 'number' },
        day('expected_close'),
        day('closed_at'),
        text('lost_reason', 300),
        rel('company', companies, false),
        text('source', 80),
        text('next_step', 300),
        day('next_step_date'),
        text('stage_entered', 30),
        text('last_activity', 30),
        { name: 'position', type: 'number' },
        json('tags', 20000),
        json('custom', 100000),
        json('prov', 40000),
        text('deleted', 30),
        text('merged_into', 15),
      ],
      indexes: ['CREATE INDEX idx_deals_pipeline ON deals (pipeline, stage)', 'CREATE INDEX idx_deals_company ON deals (company)', 'CREATE INDEX idx_deals_deleted ON deals (deleted)'],
    });

    save({
      name: 'deal_people',
      fields: [rel('deal', deals, true), rel('person', people, true), text('role', 60)],
      indexes: ['CREATE UNIQUE INDEX idx_deal_people ON deal_people (deal, person)', 'CREATE INDEX idx_deal_people_person ON deal_people (person)'],
    });

    save({
      name: 'stage_events',
      fields: [rel('deal', deals, true), text('pipeline', 15), text('from_stage', 15), text('to_stage', 15), text('at', 30), text('actor', 12), text('run', 24)],
      indexes: ['CREATE INDEX idx_stage_events_deal ON stage_events (deal)', 'CREATE INDEX idx_stage_events_at ON stage_events (at)'],
    });

    const lists = save({
      name: 'lists',
      fields: [{ name: 'name', type: 'text', required: true, max: 80 }, sel('object', ['people', 'companies']), text('color', 20), { name: 'position', type: 'number' }, text('description', 300)],
    });

    save({
      name: 'list_entries',
      fields: [rel('list', lists, true), rel('person', people, true), rel('company', companies, true), text('note', 300)],
      indexes: ['CREATE INDEX idx_list_entries_list ON list_entries (list)', 'CREATE INDEX idx_list_entries_person ON list_entries (person)', 'CREATE INDEX idx_list_entries_company ON list_entries (company)'],
    });

    save({
      name: 'fields',
      fields: [
        sel('object', ['people', 'companies', 'deals']),
        { name: 'key', type: 'text', required: true, max: 40 },
        { name: 'label', type: 'text', required: true, max: 60 },
        sel('type', ['text', 'number', 'currency', 'date', 'select', 'multi_select', 'checkbox', 'url', 'rating']),
        json('options', 20000),
        text('ai_prompt', 1000),
        { name: 'position', type: 'number' },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_fields_key ON fields (object, key)'],
    });

    const notes = save({
      name: 'notes',
      fields: [{ name: 'body', type: 'text', required: true, max: 20000 }, rel('person', people, true), rel('company', companies, true), rel('deal', deals, true), { name: 'pinned', type: 'bool' }, text('by', 12), text('run', 24)],
      indexes: ['CREATE INDEX idx_notes_person ON notes (person)', 'CREATE INDEX idx_notes_company ON notes (company)', 'CREATE INDEX idx_notes_deal ON notes (deal)'],
    });

    const interactions = save({
      name: 'interactions',
      fields: [
        sel('kind', ['email', 'call', 'meeting', 'message']),
        sel('direction', ['in', 'out']),
        text('at', 30),
        text('subject', 200),
        text('summary', 8000),
        rel('people', people, true, 50),
        rel('company', companies, true),
        rel('deal', deals, true),
        text('source', 40),
        text('ext_id', 200),
        text('by', 12),
        text('run', 24),
        agentState,
        text('agent_note', 500),
      ],
      indexes: ['CREATE INDEX idx_interactions_at ON interactions (at)', 'CREATE INDEX idx_interactions_ext ON interactions (ext_id)', 'CREATE INDEX idx_interactions_company ON interactions (company)', 'CREATE INDEX idx_interactions_deal ON interactions (deal)'],
    });

    const tasks = save({
      name: 'tasks',
      fields: [
        { name: 'title', type: 'text', required: true, max: 300 },
        text('notes', 4000),
        day('due'),
        text('done_at', 30),
        day('snoozed_until'),
        sel('kind', ['todo', 'call', 'email', 'meeting', 'follow_up']),
        rel('person', people, true),
        rel('company', companies, true),
        rel('deal', deals, true),
        text('by', 12),
        text('run', 24),
      ],
      indexes: ['CREATE INDEX idx_tasks_due ON tasks (done_at, due)', 'CREATE INDEX idx_tasks_deal ON tasks (deal)', 'CREATE INDEX idx_tasks_person ON tasks (person)'],
    });

    save({
      name: 'emails',
      fields: [
        text('to', 500),
        text('cc', 500),
        text('subject', 300),
        text('body', 20000),
        sel('status', ['draft', 'queued', 'sending', 'sent', 'failed']),
        rel('person', people, true),
        rel('deal', deals, true),
        text('by', 12),
        text('run', 24),
        text('queued_at', 30),
        text('sent_at', 30),
        text('error', 1000),
      ],
      indexes: ['CREATE INDEX idx_emails_status ON emails (status)', 'CREATE INDEX idx_emails_person ON emails (person)'],
    });

    save({
      name: 'proposals',
      fields: [
        text('kind', 20),
        text('object', 20),
        text('target', 15),
        text('title', 300),
        json('changes', 100000),
        json('payload', 200000),
        text('evidence', 2000),
        text('source', 500),
        text('reason', 1000),
        sel('confidence', ['high', 'medium', 'low']),
        sel('status', ['pending', 'accepted', 'edited', 'rejected']),
        text('decided_at', 30),
        json('applied', 100000),
        text('run', 24),
      ],
      indexes: ['CREATE INDEX idx_proposals_status ON proposals (status)', 'CREATE INDEX idx_proposals_target ON proposals (target)'],
    });

    save({
      name: 'views',
      fields: [
        sel('object', ['people', 'companies', 'deals']),
        { name: 'name', type: 'text', required: true, max: 80 },
        json('filters', 40000),
        sel('match', ['all', 'any']),
        text('sort', 40),
        sel('dir', ['asc', 'desc']),
        json('columns', 20000),
        sel('mode', ['table', 'board']),
        text('pipeline', 15),
        { name: 'position', type: 'number' },
      ],
    });

    save({
      name: 'aliases',
      fields: [text('object', 20), text('old_id', 15), text('new_id', 15)],
      indexes: ['CREATE INDEX idx_aliases_old ON aliases (old_id)'],
    });

    save({ name: 'dupe_ignores', fields: [text('object', 20), text('a', 15), text('b', 15)] });

    save({
      name: 'fx_rates',
      fields: [text('currency', 3), day('date'), text('rate', 24), text('source', 20)],
      indexes: ['CREATE UNIQUE INDEX idx_fx_rates ON fx_rates (currency, date)'],
    });

    save({
      name: 'asks',
      fields: [
        sel('kind', ['question', 'job', 'explain', 'brief']),
        sel('status', ['waiting', 'working', 'done', 'failed']),
        text('question', 4000),
        json('context', 100000),
        text('answer', 20000),
        json('links', 20000),
        text('error', 1000),
        text('requested_at', 30),
        text('run', 24),
      ],
    });

    save({
      name: 'activity',
      fields: [
        text('actor', 12),
        text('run', 24),
        text('op', 40),
        text('summary', 500),
        text('target_type', 20),
        text('target_id', 15),
        json('undo', 8000000),
        json('redo', 8000000),
        json('changes', 200000),
        { name: 'undone', type: 'bool' },
      ],
      indexes: ['CREATE INDEX idx_activity_run ON activity (run)', 'CREATE INDEX idx_activity_target ON activity (target_id)', 'CREATE INDEX idx_activity_created ON activity (created)'],
    });

    /* -------------------------------------------------------- default rows */
    const s = new Record(app.findCollectionByNameOrId('settings'));
    s.set('home_currency', 'USD');
    s.set('keep_in_touch_default', 0);
    s.set('policy', {
      autonomy: { update: 'propose', stage: 'propose', close: 'propose', deal_value: 'propose', merge: 'propose', delete: 'propose', email: 'propose' },
      auto_research: false,
      meeting_review: true,
      daily_brief: false,
      brief_hour: 8,
      house_rules: '',
    });
    s.set('setup_done', isLegacy);
    if (isLegacy) s.set('workspace', 'CRM');
    app.save(s);

    if (!isLegacy) return;

    /* ------------------------------------------- carry the earlier app over */
    const now = new Date().toISOString();
    const iso = (t) => (t ? String(t).replace(' ', 'T') : now);
    const ymd = (t) => (t ? String(t).slice(0, 10) : '');
    const rootDomain = (d) =>
      String(d || '')
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '')
        .replace(/^www\./, '')
        .split(/[\/?#:]/)[0];
    const C = {};
    for (const c of legacy.companies) {
      const r = new Record(companies);
      const d = rootDomain(c.domain);
      r.set('name', c.name || d || 'Company');
      r.set('domains', d ? [d] : []);
      r.set('primary_domain', d);
      r.set('industry', c.industry);
      r.set('tags', c.tags || []);
      r.set('prov', {});
      r.set('custom', {});
      app.save(r);
      C[c.id] = r.id;
    }
    const P = {};
    for (const p of legacy.people) {
      const r = new Record(people);
      const parts = String(p.name || '').trim().split(/\s+/);
      const email = String(p.email || '').trim().toLowerCase();
      r.set('first_name', parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '');
      r.set('last_name', parts.length > 1 ? parts[parts.length - 1] : '');
      r.set('emails', email ? [email] : []);
      r.set('primary_email', email);
      r.set('phones', p.phone ? [p.phone] : []);
      r.set('title', p.title);
      if (C[p.company]) r.set('company', C[p.company]);
      r.set('tags', p.tags);
      r.set('prov', {});
      r.set('custom', {});
      app.save(r);
      P[p.id] = r.id;
      if (C[p.company]) {
        const em = new Record(app.findCollectionByNameOrId('employments'));
        em.set('person', r.id);
        em.set('company', C[p.company]);
        em.set('title', p.title);
        em.set('current', true);
        app.save(em);
      }
    }
    // Lists over people or companies.
    const L = {};
    let lp = 0;
    for (const l of legacy.lists) {
      if (l.entity !== 'people' && l.entity !== 'companies') continue;
      const r = new Record(lists);
      r.set('name', l.name || 'List');
      r.set('object', l.entity);
      r.set('position', lp++);
      app.save(r);
      L[l.id] = { id: r.id, object: l.entity };
    }
    for (const e of legacy.entries) {
      const l = L[e.list];
      if (!l) continue;
      const target = l.object === 'people' ? P[e.record] : C[e.record];
      if (!target) continue;
      const r = new Record(app.findCollectionByNameOrId('list_entries'));
      r.set('list', l.id);
      r.set(l.object === 'people' ? 'person' : 'company', target);
      app.save(r);
    }
    // Pipelines from the deal lists (stages without a list go to Sales).
    const byList = {};
    for (const st of legacy.stages) {
      const k = st.list && legacy.lists.some((l) => l.id === st.list && l.entity === 'deals') ? st.list : '';
      (byList[k] = byList[k] || []).push(st);
    }
    const S = {};
    const stageKind = {};
    let pp = 0;
    const pipeOf = {};
    for (const k of Object.keys(byList)) {
      const list = legacy.lists.find((l) => l.id === k);
      const pr = new Record(pipelines);
      pr.set('name', list ? list.name : 'Sales');
      pr.set('kind', list && /fund|invest/i.test(list.name) ? 'fundraising' : 'sales');
      pr.set('currency', 'USD');
      pr.set('position', pp++);
      app.save(pr);
      const sorted = byList[k].sort((a, b) => a.order - b.order);
      const open = sorted.filter((x) => !/won|lost|closed/i.test(x.name));
      sorted.forEach((st, i) => {
        const r = new Record(stages);
        const kind = /won/i.test(st.name) ? 'won' : /lost/i.test(st.name) ? 'lost' : 'open';
        const oi = open.indexOf(st);
        r.set('pipeline', pr.id);
        r.set('name', st.name || 'Stage');
        r.set('position', i);
        r.set('kind', kind);
        r.set('probability', kind === 'won' ? 100 : kind === 'lost' ? 0 : Math.round(((oi + 1) / (open.length + 1)) * 100));
        r.set('rot_days', kind === 'open' ? 21 : 0);
        r.set('color', 'c' + ((i % 8) + 1));
        app.save(r);
        S[st.id] = r.id;
        stageKind[r.id] = kind;
        pipeOf[r.id] = pr.id;
      });
    }
    if (legacy.deals.length > 0 && Object.keys(S).length === 0) {
      const pr = new Record(pipelines);
      pr.set('name', 'Sales');
      pr.set('kind', 'sales');
      pr.set('currency', 'USD');
      pr.set('position', pp++);
      app.save(pr);
      [['Lead', 'open', 10], ['Qualified', 'open', 30], ['Proposal', 'open', 60], ['Won', 'won', 100], ['Lost', 'lost', 0]].forEach((x, i) => {
        const r = new Record(stages);
        r.set('pipeline', pr.id);
        r.set('name', x[0]);
        r.set('position', i);
        r.set('kind', x[1]);
        r.set('probability', x[2]);
        r.set('rot_days', x[1] === 'open' ? 21 : 0);
        r.set('color', 'c' + (i + 1));
        app.save(r);
        S['default:' + x[0]] = r.id;
        stageKind[r.id] = x[1];
        pipeOf[r.id] = pr.id;
      });
    }
    const firstOpen = Object.keys(S)
      .map((k) => S[k])
      .find((id) => stageKind[id] === 'open');
    const D = {};
    let dp = 0;
    for (const d of legacy.deals) {
      const stage = S[d.stage] || firstOpen;
      if (!stage) continue;
      const kind = stageKind[stage];
      const r = new Record(deals);
      r.set('name', d.name || 'Deal');
      r.set('pipeline', pipeOf[stage]);
      r.set('stage', stage);
      r.set('status', kind);
      r.set('value', Math.round((d.value || 0) * 100));
      r.set('currency', 'USD');
      r.set('home_value', kind === 'open' ? 0 : Math.round((d.value || 0) * 100));
      r.set('prob_override', -1);
      r.set('expected_close', ymd(d.close));
      r.set('closed_at', kind === 'open' ? '' : ymd(d.close) || ymd(d.created));
      if (C[d.company]) r.set('company', C[d.company]);
      r.set('stage_entered', iso(d.created));
      r.set('last_activity', iso(d.created));
      r.set('position', dp++);
      r.set('tags', d.tags);
      r.set('prov', {});
      r.set('custom', {});
      app.save(r);
      D[d.id] = r.id;
      const ev = new Record(app.findCollectionByNameOrId('stage_events'));
      ev.set('deal', r.id);
      ev.set('pipeline', pipeOf[stage]);
      ev.set('to_stage', stage);
      ev.set('at', iso(d.created));
      ev.set('actor', 'import');
      app.save(ev);
      const linked = {};
      for (const pid of d.people) {
        if (!P[pid] || linked[P[pid]]) continue;
        linked[P[pid]] = true;
        const dpr = new Record(app.findCollectionByNameOrId('deal_people'));
        dpr.set('deal', r.id);
        dpr.set('person', P[pid]);
        dpr.set('role', 'Contact');
        app.save(dpr);
      }
    }
    // Custom attributes become custom fields; their values move onto the records.
    const BUILT_IN = { name: 1, first_name: 1, last_name: 1, email: 1, emails: 1, phone: 1, phones: 1, title: 1, company: 1, linkedin: 1, location: 1, birthday: 1, how_met: 1, source: 1, keep_in_touch: 1, tags: 1, domain: 1, domains: 1, industry: 1, size: 1, website: 1, description: 1, value: 1, currency: 1, stage: 1, pipeline: 1, expected_close: 1, probability: 1, next_step: 1, next_step_date: 1, status: 1, lost_reason: 1, strength: 1 };
    const FK = {};
    const usedKeys = {};
    const fpos = {};
    for (const a of legacy.attrs) {
      const object = a.entity === 'companies' || a.entity === 'deals' ? a.entity : 'people';
      let key = String(a.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 34);
      if (key === '') key = 'field';
      if (BUILT_IN[key]) key = key + '_custom';
      let k2 = key;
      for (let n = 2; usedKeys[object + ':' + k2]; n++) k2 = key + '_' + n;
      usedKeys[object + ':' + k2] = true;
      const options = String(a.options || '')
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter((x) => x !== '');
      const type = a.type === 'number' ? 'number' : a.type === 'select' && options.length > 0 ? 'select' : 'text';
      const r = new Record(app.findCollectionByNameOrId('fields'));
      r.set('object', object);
      r.set('key', k2);
      r.set('label', String(a.name || 'Field').slice(0, 60));
      r.set('type', type);
      r.set('options', type === 'select' ? options : []);
      fpos[object] = (fpos[object] || 0) + 1;
      r.set('position', fpos[object]);
      app.save(r);
      FK[a.id] = { object: object, key: k2, type: type, options: options };
    }
    const byRecord = {};
    for (const v of legacy.values) {
      const f = FK[v.attribute];
      if (!f || v.value === '') continue;
      const target = f.object === 'people' ? P[v.record] : f.object === 'companies' ? C[v.record] : D[v.record];
      if (!target) continue;
      let val = v.value;
      if (f.type === 'number') {
        const n = Number(String(val).replace(/[, ]/g, ''));
        if (!isFinite(n)) continue;
        val = n;
      } else if (f.type === 'select') {
        const hit = f.options.find((o) => o.toLowerCase() === String(val).trim().toLowerCase());
        if (!hit) continue;
        val = hit;
      } else val = String(val).slice(0, 500);
      const k = f.object + ':' + target;
      (byRecord[k] = byRecord[k] || { object: f.object, id: target, custom: {} }).custom[f.key] = val;
    }
    for (const k of Object.keys(byRecord)) {
      const x = byRecord[k];
      const r = app.findRecordById(x.object, x.id);
      r.set('custom', x.custom);
      app.save(r);
    }
    for (const n of legacy.notes) {
      if (!n.body) continue;
      const r = new Record(notes);
      r.set('body', n.body);
      if (P[n.person]) r.set('person', P[n.person]);
      if (C[n.company]) r.set('company', C[n.company]);
      if (D[n.deal]) r.set('deal', D[n.deal]);
      r.set('by', 'user');
      app.save(r);
    }
    for (const t of legacy.tasks) {
      if (!t.title) continue;
      const r = new Record(tasks);
      r.set('title', t.title);
      r.set('due', ymd(t.due));
      r.set('done_at', t.done ? iso(t.updated) : '');
      r.set('kind', 'todo');
      if (P[t.person]) r.set('person', P[t.person]);
      if (D[t.deal]) r.set('deal', D[t.deal]);
      r.set('by', 'user');
      app.save(r);
    }
    const logInteraction = (kind, dir, at, subject, summary, person, company, deal) => {
      const r = new Record(interactions);
      r.set('kind', kind);
      r.set('direction', dir);
      r.set('at', iso(at));
      r.set('subject', String(subject || '').slice(0, 200));
      r.set('summary', String(summary || '').slice(0, 8000));
      if (P[person]) r.set('people', [P[person]]);
      if (C[company]) r.set('company', C[company]);
      if (D[deal]) r.set('deal', D[deal]);
      r.set('source', 'earlier version');
      r.set('by', 'user');
      app.save(r);
    };
    for (const a of legacy.acts) {
      const k = String(a.kind || '').toLowerCase();
      if (k !== 'call' && k !== 'meeting' && k !== 'email') continue;
      logInteraction(k, k === 'email' ? 'out' : '', a.created, '', a.body, a.person, a.company, a.deal);
    }
    for (const m of legacy.emails) {
      if (m.status !== 'sent') continue;
      logInteraction('email', 'out', m.created, m.subject, m.body, m.person, '', '');
    }
  },
  (app) => {
    for (const name of ['activity', 'asks', 'fx_rates', 'dupe_ignores', 'aliases', 'views', 'proposals', 'emails', 'tasks', 'interactions', 'notes', 'fields', 'list_entries', 'lists', 'stage_events', 'deal_people', 'deals', 'stages', 'pipelines', 'employments', 'people', 'companies', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
