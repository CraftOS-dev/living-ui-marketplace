/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS deals module: meeting notes and their templates.
 *
 * note_templates: the sections a note is written in (First call, Partner
 * meeting, Reference, Board, Free), each `sections` JSON
 * [{ key, label }]; `stages` names the pipeline stage keys a template is
 * the default for (a note added to a deal at First meeting opens as a
 * First call note).
 *
 * notes: a person's written record of a meeting on a deal (or a company
 * without a deal). `body` JSON { <section key>: text } holds the person's
 * words (your AI agent never edits a person's body); `body_text` is the
 * same text flattened for search. A transcript is a stored file (files,
 * owner notes) named by `transcript`; `consent` says whether the people in
 * the meeting knew it was recorded. `status` draft while it is written
 * (autosave), saved when the person is done: then job note_review fills
 * `summary` JSON { headline, sections: { <key>: text } } and links its
 * proposals, tasks and references in `review` JSON { proposals, tasks,
 * refs }. `review_job` is the latest note_review job, `review_hash` the
 * content it was queued for (an unchanged note is not reviewed twice).
 *
 * Every rule is null: notes are reached only through the notes.* ops.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const written = () => [sel('actor', ['person', 'agent', 'system'], true), rel('member', 'members')];

    make(
      'note_templates',
      [req('key', 40), req('name', 60), json('sections', 20000), json('stages', 4000), int('sort'), bool('archived'), bool('builtin')].concat(written()).concat(stamps),
      ['CREATE UNIQUE INDEX idx_note_templates_key ON note_templates (key)'],
    );

    make(
      'notes',
      [
        rel('deal', 'deals'),
        rel('company', 'companies'),
        req('template', 40),
        txt('title', 200),
        json('body', 400000),
        txt('body_text', 400000),
        txt('meeting_day', 10),
        txt('cal_event', 40),
        sel('consent', ['informed', 'not_recorded', 'unknown'], true),
        sel('status', ['draft', 'saved'], true),
        txt('saved_at', 40),
        txt('transcript', 30),
        json('summary', 200000),
        txt('summary_at', 40),
        sel('summary_by', ['person', 'agent', 'system']),
        json('review', 20000),
        txt('review_job', 30),
        txt('review_hash', 80),
        rel('author', 'members'),
        txt('run', 40),
        txt('deleted_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      [
        'CREATE INDEX idx_notes_deal ON notes (deal, created)',
        'CREATE INDEX idx_notes_company ON notes (company, created)',
        "CREATE UNIQUE INDEX idx_notes_cal_event ON notes (cal_event, deal) WHERE cal_event != ''",
        'CREATE INDEX idx_notes_author ON notes (author, status)',
      ],
    );

    const seeds = [
      {
        key: 'first_call',
        name: 'First call',
        stages: ['sourced', 'screen', 'first_meeting'],
        sections: [
          ['team', 'Team'],
          ['product', 'Product'],
          ['market', 'Market'],
          ['traction', 'Traction'],
          ['round', 'Round'],
          ['next_steps', 'Next steps'],
        ],
      },
      {
        key: 'partner_meeting',
        name: 'Partner meeting',
        stages: ['diligence', 'partner_meeting', 'ic', 'term_sheet'],
        sections: [
          ['summary', 'Summary'],
          ['strengths', 'Strengths'],
          ['concerns', 'Concerns'],
          ['questions', 'Open questions'],
          ['next_steps', 'Next steps'],
        ],
      },
      {
        key: 'reference',
        name: 'Reference',
        stages: [],
        sections: [
          ['who', 'Who'],
          ['relationship', 'Relationship'],
          ['strengths', 'Strengths'],
          ['concerns', 'Concerns'],
          ['again', 'Would back again'],
        ],
      },
      {
        key: 'board',
        name: 'Board',
        stages: [],
        sections: [
          ['highlights', 'Highlights'],
          ['kpis', 'KPIs'],
          ['decisions', 'Decisions'],
          ['asks', 'Asks'],
          ['next_steps', 'Next steps'],
        ],
      },
      { key: 'free', name: 'Free', stages: [], sections: [['notes', 'Notes']] },
    ];
    const tc = app.findCollectionByNameOrId('note_templates');
    seeds.forEach((s, i) => {
      const r = new Record(tc);
      r.set('key', s.key);
      r.set('name', s.name);
      r.set('sections', s.sections.map((x) => ({ key: x[0], label: x[1] })));
      r.set('stages', s.stages);
      r.set('sort', i + 1);
      r.set('archived', false);
      r.set('builtin', true);
      r.set('actor', 'system');
      app.save(r);
    });
  },
  (app) => {
    for (const n of ['notes', 'note_templates']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
