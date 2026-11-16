/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS fix 8: your AI agent is asked exactly the way the other agent
 * apps do it (pb_hooks/lib_agent.js): one trigger per task with params
 * naming the record, fired from the op where a person asks. No job queue.
 *
 * - `agent_jobs` is dropped (the queue, its hand-out and its minute loop are
 *   gone; what was waiting in it is discarded).
 * - Every record a trigger names keeps its asks in `agent` (JSON):
 *   { <trigger>: { request, at, by, done_at, error } } (the request id of
 *   the platform's agent_requests row; deals also keep `_nda`, the 24 hours
 *   your AI agent may read their NDA files after an NDA ask). A firm task
 *   (news, the anti-portfolio) keeps it on the settings row.
 * - The job pointers and job provenance fields go: intake_items.triage_job,
 *   passes.job, notes.review_job (and review_hash), briefs.job, intros.job,
 *   agenda_items.bearcase_job, radars.last_job, research_reports.job,
 *   news_insights.job, memo_blocks.job, dd_answers.job, references.job,
 *   outbound.job, tasks.job, proposals.job, activity.job.
 * - `settings.automatic` becomes `settings.agent_policy` (the switches that
 *   let the app fire a trigger on its own; the values carry over).
 * - New: `agent_asks` (a question a person asked your AI agent; trigger
 *   question_asked { ask_id }) and `lp_questions` (an LP's question your AI
 *   agent drafts an answer to; trigger lp_answer { question_id }).
 */
const TARGETS = ['intake_items', 'passes', 'cal_events', 'board_meetings', 'companies', 'intros', 'notes', 'deals', 'compare_grids', 'files', 'memos', 'agenda_items', 'holdings', 'updates', 'quarters', 'capital_events', 'statements', 'research_reports', 'maps', 'radars', 'settings'];
const JOB_FIELDS = {
  intake_items: ['triage_job'],
  passes: ['job'],
  notes: ['review_job', 'review_hash'],
  briefs: ['job'],
  intros: ['job'],
  agenda_items: ['bearcase_job'],
  radars: ['last_job'],
  research_reports: ['job'],
  news_insights: ['job'],
  memo_blocks: ['job'],
  dd_answers: ['job'],
  references: ['job'],
  outbound: ['job'],
  tasks: ['job'],
  proposals: ['job'],
  activity: ['job'],
};
const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
// Plain field objects (a Collection made from field instances keeps only its id).
const stamps = () => [
  { name: 'created', type: 'autodate', onCreate: true },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
];
const txt = (name, max, required) => ({ name: name, type: 'text', max: max, required: required === true });
const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
const rel = (name, collectionId, required) => ({ name: name, type: 'relation', maxSelect: 1, collectionId: collectionId, cascadeDelete: false, required: required === true });
const json = (name, max) => ({ name: name, type: 'json', maxSize: max });
// A module's collections are changed where the module is installed (the kernel's own test build has none).
const found = (app, name) => {
  try {
    return app.findCollectionByNameOrId(name);
  } catch {
    return null;
  }
};

migrate(
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('agent_jobs'));
    } catch {
      /* a fresh database made after this change never had it */
    }
    for (const name of Object.keys(JOB_FIELDS)) {
      const c = found(app, name);
      if (c === null) continue;
      for (const f of JOB_FIELDS[name]) if (c.fields.getByName(f)) c.fields.removeByName(f);
      app.save(c);
    }
    const settings = app.findCollectionByNameOrId('settings');
    const auto = settings.fields.getByName('automatic');
    if (auto) auto.name = 'agent_policy';
    else if (!settings.fields.getByName('agent_policy')) settings.fields.add(new JSONField({ name: 'agent_policy', maxSize: 4000 }));
    app.save(settings);
    for (const name of TARGETS) {
      const c = found(app, name);
      if (c === null) continue;
      if (!c.fields.getByName('agent')) c.fields.add(new JSONField({ name: 'agent', maxSize: 20000 }));
      app.save(c);
    }
    const members = app.findCollectionByNameOrId('members').id;
    app.save(
      new Collection(
        Object.assign(
          {
            type: 'base',
            name: 'agent_asks',
            fields: [
              txt('question', 8000, true),
              txt('context', 300),
              sel('status', ['waiting', 'answered', 'failed'], true),
              txt('answer', 20000),
              txt('failure', 2000),
              txt('request', 40),
              rel('asked_by', members),
              txt('answered_at', 40),
              json('agent', 20000),
            ].concat(stamps()),
            indexes: ['CREATE INDEX idx_agent_asks_by ON agent_asks (asked_by, status, created)', 'CREATE INDEX idx_agent_asks_created ON agent_asks (created)'],
          },
          closed,
        ),
      ),
    );
    if (found(app, 'lps') === null) return;
    app.save(
      new Collection(
        Object.assign(
          {
            type: 'base',
            name: 'lp_questions',
            fields: [
              rel('lp', app.findCollectionByNameOrId('lps').id, true),
              rel('fund', app.findCollectionByNameOrId('entities').id),
              txt('question', 8000, true),
              rel('asked_by', members),
              txt('outbound', 30),
              json('agent', 20000),
            ].concat(stamps()),
            indexes: ['CREATE INDEX idx_lp_questions_lp ON lp_questions (lp, created)'],
          },
          closed,
        ),
      ),
    );
  },
  (app) => {
    for (const name of ['lp_questions', 'agent_asks']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* never made */
      }
    }
    for (const name of TARGETS) {
      const c = found(app, name);
      if (c === null) continue;
      if (c.fields.getByName('agent')) c.fields.removeByName('agent');
      app.save(c);
    }
    const settings = app.findCollectionByNameOrId('settings');
    const pol = settings.fields.getByName('agent_policy');
    if (pol) pol.name = 'automatic';
    app.save(settings);
    for (const name of Object.keys(JOB_FIELDS)) {
      const c = found(app, name);
      if (c === null) continue;
      for (const f of JOB_FIELDS[name]) if (!c.fields.getByName(f)) c.fields.add(new TextField({ name: f, max: 100 }));
      app.save(c);
    }
    const members = app.findCollectionByNameOrId('members').id;
    app.save(
      new Collection(
        Object.assign(
          {
            type: 'base',
            name: 'agent_jobs',
            fields: [
              txt('kind', 40, true),
              txt('trigger', 40),
              txt('source', 40),
              txt('ref_collection', 60),
              txt('ref_id', 30),
              txt('deal', 30),
              { name: 'nda', type: 'bool' },
              txt('summary', 300, true),
              json('payload', 200000),
              sel('status', ['queued', 'asked', 'claimed', 'done', 'failed', 'cancelled', 'handed_over', 'unanswered'], true),
              { name: 'priority', type: 'number', onlyInt: true, min: 0, max: 9 },
              json('result', 100000),
              txt('error', 4000),
              txt('note', 1000),
              txt('handed_to', 200),
              txt('asked_at', 40),
              txt('claimed_at', 40),
              txt('done_at', 40),
              txt('request_id', 40),
              rel('requested_by', members),
              { name: 'attempts', type: 'number', onlyInt: true, min: 0 },
              txt('run', 40),
            ].concat(stamps()),
            indexes: ['CREATE INDEX idx_jobs_status ON agent_jobs (status, priority, created)', 'CREATE INDEX idx_jobs_ref ON agent_jobs (kind, ref_collection, ref_id)', 'CREATE INDEX idx_jobs_trigger ON agent_jobs (trigger, status)'],
          },
          closed,
        ),
      ),
    );
  },
);
