/// <reference path="../pb_data/types.d.ts" />
/** Seed one example session so the canvas is not empty on first launch. */
migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId('sessions');
    const nodes = app.findCollectionByNameOrId('nodes');

    const session = new Record(sessions);
    session.set('title', 'Welcome brainstorm');
    session.set('topic', 'How could we use this board?');
    app.save(session);

    const root = new Record(nodes);
    root.set('session', session.id);
    root.set('content', 'How could we use this board?');
    root.set('kind', 'question');
    app.save(root);

    [
      ['Plan a product launch', 'idea'],
      ['Map out blog post topics', 'idea'],
      ['What is blocking the team?', 'question'],
    ].forEach(([content, kind]) => {
      const node = new Record(nodes);
      node.set('session', session.id);
      node.set('parent', root.id);
      node.set('content', content);
      node.set('kind', kind);
      app.save(node);
    });
  },
  () => {
    // Seed data only — the schema down-migration removes the collections.
  },
);
