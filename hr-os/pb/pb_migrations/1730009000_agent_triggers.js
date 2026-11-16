/// <reference path="../pb_data/types.d.ts" />
/**
 * Your AI agent is asked per piece of work (lib_agent.js): one trigger per
 * task, fired with the record's id, and the ask remembered on the record.
 *
 * - agent_asks (json) on every record a trigger names: claims, payruns,
 *   payslips, rule_packs, letters, openings, interviews, review_summaries,
 *   checklists, plus the two new records below.
 * - agent_questions: a person's question to your AI agent and its answer.
 * - timesheet_reviews: one week of timesheets your AI agent is asked to
 *   check (by a person, or by the weekly check when switched on).
 * - settings.automatic: the Automatic work switches (all off).
 * - The job queue is gone: agent_jobs is dropped, and review_summaries.job
 *   with it. Nothing is asked at upgrade; people ask again where they want.
 */
const ASKED = ['claims', 'payruns', 'payslips', 'rule_packs', 'letters', 'openings', 'interviews', 'review_summaries', 'checklists'];

migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const members = app.findCollectionByNameOrId('members').id;
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];

    for (const name of ASKED) {
      const c = app.findCollectionByNameOrId(name);
      c.fields.add(new JSONField({ name: 'agent_asks', maxSize: 20000 }));
      if (name === 'review_summaries') c.fields.removeByName('job');
      app.save(c);
    }

    const s = app.findCollectionByNameOrId('settings');
    s.fields.add(new JSONField({ name: 'automatic', maxSize: 2000 }));
    app.save(s);

    app.save(
      new Collection(
        Object.assign(
          {
            type: 'base',
            name: 'agent_questions',
            fields: [
              { name: 'question', type: 'text', required: true, max: 4000 },
              { name: 'context', type: 'text', max: 300 },
              { name: 'status', type: 'select', maxSelect: 1, required: true, values: ['asked', 'answered', 'cancelled'] },
              { name: 'answer', type: 'text', max: 20000 },
              { name: 'answered_at', type: 'text', max: 40 },
              { name: 'asked_by', type: 'relation', maxSelect: 1, collectionId: members, cascadeDelete: false },
              { name: 'asked_by_name', type: 'text', max: 160 },
              { name: 'asked_by_employee', type: 'text', max: 30 },
              { name: 'agent_asks', type: 'json', maxSize: 20000 },
            ].concat(stamps),
            indexes: ['CREATE INDEX idx_agent_questions_by ON agent_questions (asked_by, created)', 'CREATE INDEX idx_agent_questions_status ON agent_questions (status, created)'],
          },
          closed,
        ),
      ),
    );

    app.save(
      new Collection(
        Object.assign(
          {
            type: 'base',
            name: 'timesheet_reviews',
            fields: [
              { name: 'entity', type: 'text', max: 30 },
              { name: 'entity_name', type: 'text', max: 200 },
              { name: 'week_start', type: 'text', max: 10, pattern: DAY },
              { name: 'week_end', type: 'text', max: 10, pattern: DAY },
              { name: 'team', type: 'bool' },
              { name: 'people', type: 'json', maxSize: 20000 },
              { name: 'missing_punch_days', type: 'number', onlyInt: true },
              { name: 'note', type: 'text', max: 1000 },
              { name: 'source', type: 'select', maxSelect: 1, required: true, values: ['person', 'weekly'] },
              { name: 'status', type: 'select', maxSelect: 1, required: true, values: ['asked', 'done', 'cancelled'] },
              { name: 'result', type: 'json', maxSize: 100000 },
              { name: 'done_at', type: 'text', max: 40 },
              { name: 'asked_by', type: 'relation', maxSelect: 1, collectionId: members, cascadeDelete: false },
              { name: 'asked_by_name', type: 'text', max: 160 },
              { name: 'agent_asks', type: 'json', maxSize: 20000 },
            ].concat(stamps),
            indexes: ['CREATE INDEX idx_timesheet_reviews_week ON timesheet_reviews (entity, week_start)', 'CREATE INDEX idx_timesheet_reviews_status ON timesheet_reviews (status, created)'],
          },
          closed,
        ),
      ),
    );

    app.delete(app.findCollectionByNameOrId('agent_jobs'));
  },
  (app) => {
    for (const name of ['agent_questions', 'timesheet_reviews']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
    for (const name of ASKED) {
      const c = app.findCollectionByNameOrId(name);
      c.fields.removeByName('agent_asks');
      if (name === 'review_summaries') c.fields.add(new TextField({ name: 'job', max: 30 }));
      app.save(c);
    }
    const s = app.findCollectionByNameOrId('settings');
    s.fields.removeByName('automatic');
    app.save(s);
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    app.save(
      new Collection(
        Object.assign(
          {
            type: 'base',
            name: 'agent_jobs',
            fields: [
              { name: 'kind', type: 'select', maxSelect: 1, required: true, values: ['read_receipt', 'review_payrun', 'explain_variance', 'check_rule_updates', 'draft_pack_update', 'answer_question', 'draft_letter', 'draft_job_post', 'summarize_interview', 'review_timesheets', 'draft_review_summary', 'onboarding_help', 'import_help'] },
              { name: 'ref_collection', type: 'text', max: 60 },
              { name: 'ref_id', type: 'text', max: 30 },
              { name: 'summary', type: 'text', required: true, max: 300 },
              { name: 'payload', type: 'json', maxSize: 50000 },
              { name: 'status', type: 'select', maxSelect: 1, required: true, values: ['queued', 'asked', 'claimed', 'done', 'failed', 'cancelled', 'handed_over'] },
              { name: 'priority', type: 'number', onlyInt: true, min: 0, max: 9 },
              { name: 'result', type: 'json', maxSize: 100000 },
              { name: 'error', type: 'text', max: 4000 },
              { name: 'asked_at', type: 'text', max: 40 },
              { name: 'claimed_at', type: 'text', max: 40 },
              { name: 'done_at', type: 'text', max: 40 },
              { name: 'request_id', type: 'text', max: 40 },
              { name: 'requested_by', type: 'relation', maxSelect: 1, collectionId: app.findCollectionByNameOrId('members').id, cascadeDelete: false },
              { name: 'attempts', type: 'number', onlyInt: true, min: 0 },
              { name: 'note', type: 'text', max: 2000 },
              { name: 'handed_to', type: 'text', max: 200 },
              { name: 'created', type: 'autodate', onCreate: true },
              { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
            ],
            indexes: ['CREATE INDEX idx_jobs_status ON agent_jobs (status, priority, created)', 'CREATE INDEX idx_jobs_ref ON agent_jobs (kind, ref_collection, ref_id)'],
          },
          closed,
        ),
      ),
    );
  },
);
