/// <reference path="../pb_data/types.d.ts" />
/**
 * Handing work to people: a notification's `ref` (what it is about, for
 * deduplication: kind, the person told and the record) and an agent job's
 * `note` and `handed_over` status (your AI agent gave the job to a person,
 * so jobs.next no longer offers it).
 */
migrate(
  (app) => {
    const n = app.findCollectionByNameOrId('notifications');
    n.fields.add(new TextField({ name: 'ref', max: 200 }));
    n.addIndex('idx_notifications_ref', false, 'member, kind, ref', '');
    app.save(n);
    const j = app.findCollectionByNameOrId('agent_jobs');
    j.fields.add(new TextField({ name: 'note', max: 2000 }));
    j.fields.add(new TextField({ name: 'handed_to', max: 200 }));
    const st = j.fields.getByName('status');
    st.values = ['queued', 'asked', 'claimed', 'done', 'failed', 'cancelled', 'handed_over'];
    app.save(j);
  },
  (app) => {
    const n = app.findCollectionByNameOrId('notifications');
    n.removeIndex('idx_notifications_ref');
    n.fields.removeByName('ref');
    app.save(n);
    const j = app.findCollectionByNameOrId('agent_jobs');
    j.fields.removeByName('note');
    j.fields.removeByName('handed_to');
    j.fields.getByName('status').values = ['queued', 'asked', 'claimed', 'done', 'failed', 'cancelled'];
    app.save(j);
  },
);
