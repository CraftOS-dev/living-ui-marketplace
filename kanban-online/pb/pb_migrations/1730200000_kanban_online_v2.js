/// <reference path="../pb_data/types.d.ts" />
/**
 * Kanban Online V2: boards a team of people shares with its AI agents.
 *
 *   users     people (PocketBase auth): role (admin, member), status
 *             (active, pending approval, suspended), tone, personal prefs
 *   settings  one row for the workspace: name, how new accounts join,
 *             pause every agent, the default cards an agent works at once
 *   agents    each agent that connects through the agent-app CLI, under the
 *             name it sends (CraftBot is one): paused, cards at once
 *   boards    name, key (card ids like OPS-12), how-we-work instructions,
 *             frozen (agents may not write), swimlanes
 *   columns   a stage with a category and its contract: WIP limit, policy,
 *             who works it (people, any agent, one agent), gates, next
 *             stage, review return, lease, attempts
 *   cards     the work: assignee (a person, an agent, any agent, nobody),
 *             requester (the person accountable), acceptance criteria,
 *             checklist, plan, agent session (state, lease, the agent on
 *             it, attempts, run), review packet and state, blocked flag
 *   labels    per board
 *   events    append-only activity: who (a person, an agent, a rule, the
 *             system), what, before and after, the run; revertible
 *   runs      one per agent claim: the agent, outcome, timing, cost
 *   rules     When / If / Then automations per board
 *
 * Every collection is readable by approved members (realtime included) and
 * written only through the operations. Installs from V1 (boards, lists,
 * cards, labels and their users) are converted: lists become columns, cards
 * keep their text, priority, due date, labels, checklist and order, and the
 * people already signed up stay members (the first of them the admin).
 */
migrate(
  (app) => {
    // Approved members read everything (and get realtime); writes go through the operations.
    const MEMBER = '@request.auth.id != "" && @request.auth.status = "active"';
    const READ = { listRule: MEMBER, viewRule: MEMBER, createRule: null, updateRule: null, deleteRule: null };
    const TONES = ['orange', 'blue', 'green', 'purple', 'teal', 'pink', 'yellow', 'red', 'gray'];
    const has = (name) => {
      try {
        app.findCollectionByNameOrId(name);
        return true;
      } catch {
        return false;
      }
    };
    const id = () => $security.randomStringWithAlphabet(15, 'abcdefghijklmnopqrstuvwxyz0123456789');

    /* ------------------------------------------------ V1 data, read first */
    const old = { boards: [], lists: [], labels: [], cards: [] };
    if (has('lists')) {
      const take = (name, fn) => {
        try {
          for (const r of app.findAllRecords(name)) old[name].push(fn(r));
        } catch {
          /* empty or missing */
        }
      };
      take('boards', (r) => ({ id: r.id, name: r.getString('name') }));
      take('lists', (r) => ({ id: r.id, board: r.getString('board'), title: r.getString('title'), position: r.getFloat('position') }));
      take('labels', (r) => ({ id: r.id, board: r.getString('board'), name: r.getString('name'), color: r.getString('color') }));
      take('cards', (r) => {
        let checklist = [];
        try {
          const raw = r.getString('checklist');
          checklist = raw === '' || raw === 'null' ? [] : JSON.parse(raw);
        } catch {
          checklist = [];
        }
        return {
          list: r.getString('list'),
          title: r.getString('title'),
          description: r.getString('description'),
          priority: r.getString('priority'),
          due: r.getString('due_date'),
          position: r.getFloat('position'),
          archived: r.getBool('archived'),
          labels: r.getStringSlice('labels'),
          checklist: Array.isArray(checklist) ? checklist : [],
        };
      });
      // Retire V1 collections (children first; relations block deletes otherwise).
      for (const name of ['cards', 'lists', 'labels', 'boards']) {
        if (has(name)) app.delete(app.findCollectionByNameOrId(name));
      }
    }

    /* ------------------------------------------------------------ people */
    const users = app.findCollectionByNameOrId('users');
    const addField = (field) => {
      if (users.fields.getByName(field.name) === null || users.fields.getByName(field.name) === undefined) users.fields.add(field);
    };
    addField(new SelectField({ name: 'role', maxSelect: 1, values: ['admin', 'member'] }));
    addField(new SelectField({ name: 'status', maxSelect: 1, values: ['active', 'pending', 'suspended'] }));
    addField(new TextField({ name: 'tone', max: 20 }));
    addField(new JSONField({ name: 'prefs', maxSize: 4000 }));
    addField(new DateField({ name: 'seen_at' }));
    // Teammates see each other; anyone may sign up (the hooks decide the role and status).
    users.listRule = 'id = @request.auth.id || (@request.auth.id != "" && @request.auth.status = "active")';
    users.viewRule = 'id = @request.auth.id || (@request.auth.id != "" && @request.auth.status = "active")';
    users.createRule = '';
    users.updateRule = 'id = @request.auth.id';
    users.deleteRule = null;
    app.save(users);
    // People already signed up (a V1 install) stay members; the first of them runs the workspace.
    app.findRecordsByFilter('users', "id != ''", 'created', 0, 0).forEach((u, i) => {
      if (u.getString('status') === '') u.set('status', 'active');
      if (u.getString('role') === '') u.set('role', i === 0 ? 'admin' : 'member');
      if (u.getString('tone') === '') u.set('tone', TONES[i % TONES.length]);
      app.saveNoValidate(u);
    });

    /* ------------------------------------------------------- collections */
    const settings = new Collection({
      type: 'base',
      name: 'settings',
      ...READ,
      fields: [
        { name: 'name', type: 'text', max: 80 },
        { name: 'joining', type: 'select', maxSelect: 1, values: ['open', 'approval'] },
        { name: 'paused', type: 'bool' },
        { name: 'defaults', type: 'json', maxSize: 4000 },
        { name: 'max_working', type: 'number', min: 1, max: 10, onlyInt: true },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(settings);

    const agents = new Collection({
      type: 'base',
      name: 'agents',
      ...READ,
      fields: [
        { name: 'handle', type: 'text', required: true, max: 40, pattern: '^[a-z0-9][a-z0-9_-]*$' },
        { name: 'name', type: 'text', required: true, max: 60 },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['craftbot', 'external'] },
        { name: 'tone', type: 'text', max: 20 },
        { name: 'paused', type: 'bool' },
        { name: 'max_working', type: 'number', min: 1, max: 10, onlyInt: true },
        { name: 'last_seen', type: 'date' },
        { name: 'archived', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_agents_handle ON agents (handle)'],
    });
    app.save(agents);

    const boards = new Collection({
      type: 'base',
      name: 'boards',
      ...READ,
      fields: [
        { name: 'name', type: 'text', required: true, max: 80 },
        { name: 'key', type: 'text', required: true, max: 6, pattern: '^[A-Z][A-Z0-9]{0,5}$' },
        { name: 'description', type: 'text', max: 400 },
        { name: 'instructions', type: 'text', max: 12000 },
        { name: 'seq', type: 'number', onlyInt: true },
        { name: 'frozen', type: 'bool' },
        { name: 'archived', type: 'bool' },
        { name: 'sort', type: 'number' },
        { name: 'swimlanes', type: 'select', maxSelect: 1, values: ['none', 'assignee', 'priority'] },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(boards);

    const columns = new Collection({
      type: 'base',
      name: 'columns',
      ...READ,
      fields: [
        { name: 'board', type: 'relation', required: true, collectionId: boards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'name', type: 'text', required: true, max: 60 },
        { name: 'category', type: 'select', required: true, maxSelect: 1, values: ['triage', 'backlog', 'todo', 'doing', 'review', 'done', 'canceled'] },
        { name: 'position', type: 'number' },
        { name: 'wip', type: 'number', min: 0, max: 999, onlyInt: true },
        { name: 'policy', type: 'text', max: 4000 },
        { name: 'instructions', type: 'text', max: 8000 },
        { name: 'agent_mode', type: 'select', maxSelect: 1, values: ['off', 'any', 'one'] },
        { name: 'agent', type: 'relation', collectionId: agents.id, cascadeDelete: false, maxSelect: 1 },
        { name: 'plan_first', type: 'bool' },
        { name: 'need_criteria', type: 'bool' },
        { name: 'need_checklist', type: 'bool' },
        { name: 'next', type: 'text', max: 15 },
        { name: 'return_to', type: 'text', max: 15 },
        { name: 'lease_minutes', type: 'number', min: 2, max: 240, onlyInt: true },
        { name: 'max_attempts', type: 'number', min: 1, max: 10, onlyInt: true },
        { name: 'aging_days', type: 'number', min: 0, max: 365 },
        { name: 'collapsed', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(columns);

    const labels = new Collection({
      type: 'base',
      name: 'labels',
      ...READ,
      fields: [
        { name: 'board', type: 'relation', required: true, collectionId: boards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'name', type: 'text', required: true, max: 40 },
        { name: 'color', type: 'select', maxSelect: 1, values: ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(labels);

    const cards = new Collection({
      type: 'base',
      name: 'cards',
      ...READ,
      fields: [
        { name: 'board', type: 'relation', required: true, collectionId: boards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'column', type: 'relation', required: true, collectionId: columns.id, cascadeDelete: false, maxSelect: 1 },
        { name: 'number', type: 'number', onlyInt: true },
        { name: 'title', type: 'text', required: true, max: 300 },
        { name: 'description', type: 'text', max: 30000 },
        { name: 'acceptance', type: 'text', max: 6000 },
        { name: 'priority', type: 'number', min: 0, max: 4, onlyInt: true },
        { name: 'labels', type: 'relation', collectionId: labels.id, cascadeDelete: false, maxSelect: 30 },
        { name: 'due', type: 'date' },
        { name: 'estimate', type: 'number', min: 0, max: 1000 },
        { name: 'checklist', type: 'json', maxSize: 60000 },
        { name: 'position', type: 'number' },
        { name: 'assignee', type: 'text', max: 30 },
        { name: 'requester', type: 'relation', collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
        { name: 'created_by', type: 'text', max: 40 },
        { name: 'proposed', type: 'bool' },
        { name: 'agent_state', type: 'select', maxSelect: 1, values: ['queued', 'working', 'needs_input', 'needs_attention'] },
        { name: 'claimed_by', type: 'relation', collectionId: agents.id, cascadeDelete: false, maxSelect: 1 },
        { name: 'lease_until', type: 'date' },
        { name: 'attempt', type: 'number', onlyInt: true },
        { name: 'handoffs', type: 'number', onlyInt: true },
        { name: 'run', type: 'text', max: 15 },
        { name: 'progress', type: 'text', max: 300 },
        { name: 'plan', type: 'json', maxSize: 20000 },
        { name: 'plan_ok', type: 'bool' },
        { name: 'question', type: 'json', maxSize: 8000 },
        { name: 'attention', type: 'text', max: 600 },
        { name: 'review', type: 'json', maxSize: 60000 },
        { name: 'review_state', type: 'select', maxSelect: 1, values: ['pending', 'approved', 'changes', 'rejected'] },
        { name: 'feedback', type: 'text', max: 4000 },
        { name: 'work_column', type: 'text', max: 15 },
        { name: 'blocked', type: 'bool' },
        { name: 'blocked_reason', type: 'text', max: 600 },
        { name: 'column_at', type: 'date' },
        { name: 'started_at', type: 'date' },
        { name: 'done_at', type: 'date' },
        { name: 'done_kind', type: 'text', max: 10 },
        { name: 'cost', type: 'number', min: 0 },
        { name: 'version', type: 'number', onlyInt: true },
        { name: 'archived', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_cards_board ON cards (board, archived)',
        'CREATE INDEX idx_cards_state ON cards (agent_state)',
        'CREATE INDEX idx_cards_assignee ON cards (assignee)',
        'CREATE INDEX idx_cards_column ON cards (`column`)',
      ],
    });
    app.save(cards);

    const events = new Collection({
      type: 'base',
      name: 'events',
      ...READ,
      fields: [
        { name: 'board', type: 'relation', collectionId: boards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'card', type: 'relation', collectionId: cards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'actor', type: 'text', max: 40 },
        { name: 'actor_kind', type: 'select', maxSelect: 1, values: ['person', 'agent', 'rule', 'system'] },
        { name: 'kind', type: 'text', required: true, max: 30 },
        { name: 'text', type: 'text', max: 20000 },
        { name: 'field', type: 'text', max: 30 },
        { name: 'before', type: 'json', maxSize: 40000 },
        { name: 'after', type: 'json', maxSize: 40000 },
        { name: 'run', type: 'text', max: 15 },
        { name: 'meta', type: 'json', maxSize: 20000 },
        { name: 'reverted', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_events_card ON events (card, created)', 'CREATE INDEX idx_events_created ON events (created)'],
    });
    app.save(events);

    const runs = new Collection({
      type: 'base',
      name: 'runs',
      ...READ,
      fields: [
        { name: 'agent', type: 'relation', collectionId: agents.id, cascadeDelete: false, maxSelect: 1 },
        { name: 'from_pool', type: 'bool' },
        { name: 'card', type: 'relation', collectionId: cards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'board', type: 'relation', collectionId: boards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'column', type: 'text', max: 15 },
        { name: 'attempt', type: 'number', onlyInt: true },
        { name: 'started', type: 'date' },
        { name: 'ended', type: 'date' },
        { name: 'outcome', type: 'select', maxSelect: 1, values: ['working', 'submitted', 'asked', 'returned', 'failed', 'expired', 'stopped', 'released', 'planned'] },
        { name: 'note', type: 'text', max: 2000 },
        { name: 'cost', type: 'number', min: 0 },
        { name: 'decision', type: 'select', maxSelect: 1, values: ['approved', 'changes', 'rejected'] },
        { name: 'decided', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_runs_started ON runs (started)', 'CREATE INDEX idx_runs_agent ON runs (agent, started)'],
    });
    app.save(runs);

    const rules = new Collection({
      type: 'base',
      name: 'rules',
      ...READ,
      fields: [
        { name: 'board', type: 'relation', required: true, collectionId: boards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'name', type: 'text', max: 120 },
        { name: 'enabled', type: 'bool' },
        { name: 'when', type: 'select', required: true, maxSelect: 1, values: ['enters_column', 'created', 'checklist_done', 'approved', 'changes_requested', 'needs_attention', 'blocked', 'idle', 'due_soon'] },
        { name: 'column', type: 'text', max: 15 },
        { name: 'days', type: 'number', min: 0, max: 365 },
        { name: 'conditions', type: 'json', maxSize: 4000 },
        { name: 'actions', type: 'json', maxSize: 8000 },
        { name: 'position', type: 'number' },
        { name: 'runs', type: 'number', onlyInt: true },
        { name: 'last_run', type: 'date' },
        { name: 'paused_reason', type: 'text', max: 300 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(rules);

    /* ----------------------------------------------------------- defaults */
    const now = new Date().toISOString().replace('T', ' ');
    const s = new Record(settings);
    s.set('name', 'Our team');
    s.set('joining', 'open');
    s.set('defaults', { lease_minutes: 15, max_attempts: 3 });
    s.set('max_working', 2);
    app.save(s);

    // CraftBot is known from the start; other agents join the first time they call.
    const cb = new Record(agents);
    cb.set('handle', 'craftbot');
    cb.set('name', 'CraftBot');
    cb.set('kind', 'craftbot');
    cb.set('tone', 'orange');
    app.save(cb);
    void now;

    const HOW = [
      'How we work on this board:',
      '- Keep each change small and focused on the card.',
      '- Before you submit, check your work against the acceptance criteria and say how you checked it.',
      '- If the card is unclear or you would have to guess, ask one clear question instead.',
      '- Never delete or archive anything; hand a card back when it is not agent work.',
    ].join('\n');

    const guessCategory = (title, i, n) => {
      const t = String(title || '').toLowerCase();
      if (/done|complete|shipped|finished|closed/.test(t)) return 'done';
      if (/review|qa|check|approv/.test(t)) return 'review';
      if (/progress|doing|working|active|wip|build/.test(t)) return 'doing';
      if (/backlog|later|someday|idea/.test(t)) return 'backlog';
      if (/cancel|dropped|won.?t/.test(t)) return 'canceled';
      if (i === n - 1 && n > 1) return 'done';
      return 'todo';
    };
    const PALETTE = {
      gray: [107, 114, 128],
      red: [239, 68, 68],
      orange: [249, 115, 22],
      yellow: [234, 179, 8],
      green: [16, 185, 129],
      teal: [20, 184, 166],
      blue: [59, 130, 246],
      purple: [139, 92, 246],
      pink: [236, 72, 153],
    };
    const nearest = (hex) => {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
      if (!m) return 'gray';
      const rgb = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
      let best = 'gray';
      let bd = Infinity;
      for (const [k, v] of Object.entries(PALETTE)) {
        const d = (v[0] - rgb[0]) ** 2 + (v[1] - rgb[1]) ** 2 + (v[2] - rgb[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      return best;
    };
    const keyOf = (name, used) => {
      let base = String(name || 'Board')
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w[0])
        .join('')
        .slice(0, 4);
      if (base.length < 2) base = String(name || 'BRD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'BRD';
      if (!/^[A-Z]/.test(base)) base = 'B' + base;
      let k = base;
      let n = 2;
      while (used.has(k)) k = base.slice(0, 4) + n++;
      used.add(k);
      return k;
    };
    const column = (board, name, category, position, extra) => {
      const c = new Record(columns);
      c.set('board', board.id);
      c.set('name', name);
      c.set('category', category);
      c.set('position', position);
      c.set('wip', 0);
      c.set('agent_mode', 'off');
      c.set('lease_minutes', 15);
      c.set('max_attempts', 3);
      for (const k of Object.keys(extra || {})) c.set(k, extra[k]);
      app.save(c);
      return c;
    };

    if (old.boards.length > 0) {
      // Bring V1 boards across.
      const used = new Set();
      old.boards.forEach((ob, bi) => {
        const b = new Record(boards);
        b.set('name', ob.name || 'Board');
        b.set('key', keyOf(ob.name, used));
        b.set('instructions', HOW);
        b.set('seq', 0);
        b.set('sort', bi);
        b.set('swimlanes', 'none');
        app.save(b);
        const lbl = {};
        for (const ol of old.labels.filter((x) => x.board === ob.id)) {
          const l = new Record(labels);
          l.set('board', b.id);
          l.set('name', ol.name || 'Label');
          l.set('color', nearest(ol.color));
          app.save(l);
          lbl[ol.id] = l.id;
        }
        const lists = old.lists.filter((x) => x.board === ob.id).sort((a, z) => a.position - z.position);
        const colOf = {};
        lists.forEach((ol, i) => {
          colOf[ol.id] = column(b, ol.title || 'Column', guessCategory(ol.title, i, lists.length), i, {});
        });
        if (lists.length === 0) {
          ['Backlog', 'To do', 'In progress', 'Review', 'Done'].forEach((n, i) => column(b, n, ['backlog', 'todo', 'doing', 'review', 'done'][i], i, {}));
        }
        let seq = 0;
        const PRI = { urgent: 1, high: 2, medium: 3, low: 4 };
        for (const ol of lists) {
          const cards1 = old.cards.filter((x) => x.list === ol.id).sort((a, z) => a.position - z.position);
          cards1.forEach((oc, i) => {
            const col = colOf[ol.id];
            const c = new Record(cards);
            seq++;
            c.set('board', b.id);
            c.set('column', col.id);
            c.set('number', seq);
            c.set('title', oc.title || 'Untitled');
            c.set('description', oc.description || '');
            c.set('priority', PRI[oc.priority] || 0);
            c.set('labels', (oc.labels || []).map((x) => lbl[x]).filter(Boolean));
            if (oc.due) c.set('due', oc.due);
            c.set('checklist', (oc.checklist || []).map((it) => ({ id: id(), text: String((it && it.text) || ''), done: !!(it && it.done) })));
            c.set('position', (i + 1) * 1000);
            c.set('archived', !!oc.archived);
            c.set('assignee', '');
            c.set('created_by', 'system');
            c.set('version', 1);
            c.set('column_at', now);
            const cat = col.getString('category');
            if (cat === 'doing' || cat === 'review' || cat === 'done') c.set('started_at', now);
            if (cat === 'done') {
              c.set('done_at', now);
              c.set('done_kind', 'person');
            }
            app.save(c);
          });
        }
        b.set('seq', seq);
        app.save(b);
      });
    } else {
      // A fresh install: one board ready to use.
      const b = new Record(boards);
      b.set('name', 'Team board');
      b.set('key', 'TEAM');
      b.set('description', 'Work the team shares with its AI agents');
      b.set('instructions', HOW);
      b.set('seq', 0);
      b.set('sort', 0);
      b.set('swimlanes', 'none');
      app.save(b);
      column(b, 'Backlog', 'backlog', 0, {});
      column(b, 'To do', 'todo', 1, {});
      column(b, 'In progress', 'doing', 2, { wip: 4 });
      column(b, 'Review', 'review', 3, { policy: 'Agent work waits here for a person: approve it, request changes (the agent reworks it) or reject it.' });
      column(b, 'Done', 'done', 4, {});
      [
        ['Bug', 'red'],
        ['Feature', 'blue'],
        ['Research', 'purple'],
        ['Docs', 'teal'],
      ].forEach(([n, c]) => {
        const l = new Record(labels);
        l.set('board', b.id);
        l.set('name', n);
        l.set('color', c);
        app.save(l);
      });
    }
  },
  (app) => {
    for (const name of ['rules', 'runs', 'events', 'cards', 'labels', 'columns', 'boards', 'agents', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
