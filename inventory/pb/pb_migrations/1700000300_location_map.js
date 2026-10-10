/// <reference path="../pb_data/types.d.ts" />
/**
 * Where each top-level place stands on the Home stockroom map: { x, z } in
 * map units on a half-unit grid, or empty for the automatic layout.
 */
migrate(
  (app) => {
    const locations = app.findCollectionByNameOrId('locations');
    locations.fields.add(new JSONField({ name: 'map', maxSize: 200 }));
    app.save(locations);
  },
  (app) => {
    const locations = app.findCollectionByNameOrId('locations');
    locations.fields.removeByName('map');
    app.save(locations);
  },
);
