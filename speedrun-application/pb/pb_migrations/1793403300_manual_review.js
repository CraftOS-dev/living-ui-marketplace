/// <reference path="../pb_data/types.d.ts" />
// Add an explicit review request snapshot. Existing answers and feedback are untouched.
migrate((app) => {
  const settings = app.findCollectionByNameOrId('settings');
  settings.fields.add(new JSONField({ name: 'review_request', maxSize: 2000000 }));
  app.save(settings);
}, (app) => {
  const settings = app.findCollectionByNameOrId('settings');
  settings.fields.removeByName('review_request');
  app.save(settings);
});