/// <reference path="../pb_data/types.d.ts" />
/**
 * habits.icon holds a lucide icon name from the habit form's picker. It was
 * capped at 8 characters, which refused the form's default (CheckCircle2) and
 * 23 other picker names (the longest, MessagesSquare, has 14). Raise the cap to
 * 40 so every picker name fits; existing values (8 or fewer) stay valid.
 */
migrate(
  (app) => {
    const habits = app.findCollectionByNameOrId('habits');
    habits.fields.getByName('icon').max = 40;
    app.save(habits);
  },
  (app) => {
    // Back to 8: icons that no longer fit fall back to Circle, the app's default.
    app.db().newQuery("UPDATE habits SET icon = 'Circle' WHERE length(icon) > 8").execute();
    const habits = app.findCollectionByNameOrId('habits');
    habits.fields.getByName('icon').max = 8;
    app.save(habits);
  },
);
