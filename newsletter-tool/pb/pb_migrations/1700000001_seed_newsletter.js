/// <reference path="../pb_data/types.d.ts" />
/** Seed a small example audience so the app is demonstrable on first launch. */
migrate(
  (app) => {
    const subscribers = app.findCollectionByNameOrId('subscribers');
    [
      ['ada@example.com', 'Ada Lovelace', 'vip'],
      ['grace@example.com', 'Grace Hopper', 'vip'],
      ['alan@example.com', 'Alan Turing', ''],
    ].forEach(([email, name, tags]) => {
      const record = new Record(subscribers);
      record.set('email', email);
      record.set('name', name);
      record.set('status', 'subscribed');
      record.set('tags', tags);
      app.save(record);
    });

    const templates = app.findCollectionByNameOrId('templates');
    const template = new Record(templates);
    template.set('name', 'Monthly update');
    template.set('subject', 'What we shipped this month');
    template.set(
      'body',
      'Hi there,\n\nHere is what happened this month:\n\n' +
        '- Highlight one\n- Highlight two\n- Highlight three\n\n' +
        'Thanks for reading!\n',
    );
    app.save(template);

    const settings = app.findCollectionByNameOrId('settings');
    const row = new Record(settings);
    row.set('sender_name', 'My Newsletter');
    row.set('sender_email', 'newsletter@example.com');
    app.save(row);
  },
  () => {
    // Seed data only — the schema down-migration removes the collections.
  },
);
