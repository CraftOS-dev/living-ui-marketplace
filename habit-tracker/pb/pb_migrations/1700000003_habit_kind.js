/// <reference path="../pb_data/types.d.ts" />
/**
 * The habit form offers four types: binary, count, duration and negative
 * ("Avoid"). `type` stores only the completion rule (binary | quantity), so a
 * duration habit came back as count and an avoid habit as binary after a
 * reload. `kind` keeps the form's exact choice; `type` still decides when a day
 * is done. Habits saved before this have no kind and read as before: quantity
 * as count, binary as binary.
 */
migrate(
  (app) => {
    const habits = app.findCollectionByNameOrId('habits');
    habits.fields.add(
      new SelectField({ name: 'kind', maxSelect: 1, values: ['binary', 'count', 'duration', 'negative'] }),
    );
    app.save(habits);
  },
  (app) => {
    const habits = app.findCollectionByNameOrId('habits');
    habits.fields.removeByName('kind');
    app.save(habits);
  },
);
