/// <reference path="../pb_data/types.d.ts" />
/**
 * Seed a starter board so the app is usable on first launch:
 * one board, three lists, and a small default label palette.
 */
migrate(
  (app) => {
    const boards = app.findCollectionByNameOrId('boards');
    const board = new Record(boards);
    board.set('name', 'My Board');
    app.save(board);

    const lists = app.findCollectionByNameOrId('lists');
    ['To Do', 'In Progress', 'Done'].forEach((title, i) => {
      const list = new Record(lists);
      list.set('board', board.id);
      list.set('title', title);
      list.set('position', i);
      app.save(list);
    });

    const labels = app.findCollectionByNameOrId('labels');
    [
      ['Bug', '#ef4444'],
      ['Feature', '#3b82f6'],
      ['Chore', '#f59e0b'],
      ['Idea', '#10b981'],
    ].forEach(([name, color]) => {
      const label = new Record(labels);
      label.set('board', board.id);
      label.set('name', name);
      label.set('color', color);
      app.save(label);
    });
  },
  () => {
    // Seed data only — the schema down-migration removes the collections.
  },
);
