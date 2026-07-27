/// <reference path="../pb_data/types.d.ts" />
/** Seed starter categories and habits so the grid is usable immediately. */
migrate(
  (app) => {
    const categories = app.findCollectionByNameOrId('categories');
    const habits = app.findCollectionByNameOrId('habits');

    const makeCategory = (name, color, order) => {
      const record = new Record(categories);
      record.set('name', name);
      record.set('color', color);
      record.set('order', order);
      app.save(record);
      return record;
    };
    const health = makeCategory('Health', '#10b981', 0);
    const focus = makeCategory('Focus', '#3b82f6', 1);

    [
      ['Exercise', 'binary', null, '', '#ef4444', '🏃', health.id, 0],
      ['Drink water', 'quantity', 8, 'glasses', '#06b6d4', '💧', health.id, 1],
      ['Sleep 8h', 'binary', null, '', '#8b5cf6', '😴', health.id, 2],
      ['Deep work', 'quantity', 4, 'hours', '#3b82f6', '🎯', focus.id, 3],
      ['Read', 'binary', null, '', '#f59e0b', '📚', focus.id, 4],
    ].forEach(([name, type, target, unit, color, icon, category, order]) => {
      const record = new Record(habits);
      record.set('name', name);
      record.set('type', type);
      if (target !== null) record.set('target', target);
      record.set('unit', unit);
      record.set('color', color);
      record.set('icon', icon);
      record.set('category', category);
      record.set('order', order);
      record.set('archived', false);
      app.save(record);
    });
  },
  () => {
    // Seed data only — the schema down-migration removes the collections.
  },
);
