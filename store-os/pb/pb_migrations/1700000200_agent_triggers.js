/// <reference path="../pb_data/types.d.ts" />
/**
 * One trigger per kind of work (triggers.json) instead of one batched trigger.
 *
 *   settings.automation  the automatic requests the seller switched on in
 *                        Settings (all off): draft a reply when a buyer
 *                        message comes in, sort out a parcel whose tracking
 *                        turns to a problem
 *   tasks.trigger        the trigger the task was asked with
 *   tasks.requests       every request fired for the task, oldest first (a
 *                        Retry adds one; `request` is the latest)
 *
 * Tasks still open from the batched design were asked with a trigger that no
 * longer exists, so nothing will pick them up: they become "not sent" and
 * show a Retry. Tasks your AI agent already started stay as they are.
 */
migrate(
  (app) => {
    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.add(new JSONField({ name: 'automation', maxSize: 2000 }));
    app.save(settings);

    const tasks = app.findCollectionByNameOrId('tasks');
    tasks.fields.add(new TextField({ name: 'trigger', max: 60 }));
    tasks.fields.add(new JSONField({ name: 'requests', maxSize: 20000 }));
    tasks.addIndex('idx_tasks_request', false, 'request', '');
    app.save(tasks);

    for (const s of app.findRecordsByFilter('settings', '1=1', '', 0, 0)) {
      s.set('automation', { draft_replies: false, exceptions: false });
      app.save(s);
    }

    for (const t of app.findRecordsByFilter('tasks', "state = 'queued' || state = 'asked'", 'created', 0, 0)) {
      const old = t.getString('request');
      t.set('state', 'asked');
      t.set('requests', old !== '' ? [old] : []);
      t.set('request', '');
      t.set('asked_at', '');
      t.set('note', 'Not sent: Store OS now asks your AI agent for each kind of work on its own. Retry to ask again.');
      app.save(t);
    }
    for (const t of app.findRecordsByFilter('tasks', "state != 'queued' && state != 'asked'", 'created', 0, 0)) {
      const old = t.getString('request');
      t.set('requests', old !== '' ? [old] : []);
      app.save(t);
    }
  },
  (app) => {
    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.removeByName('automation');
    app.save(settings);
    const tasks = app.findCollectionByNameOrId('tasks');
    tasks.removeIndex('idx_tasks_request');
    tasks.fields.removeByName('trigger');
    tasks.fields.removeByName('requests');
    app.save(tasks);
  },
);
