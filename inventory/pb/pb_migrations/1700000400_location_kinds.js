/// <reference path="../pb_data/types.d.ts" />
/**
 * More kinds of place for the stockroom map and the nesting rules:
 * container, pallet rack, cabinet, fridge, drawer and pallet join site, room,
 * area, shelf, bin, box, vehicle and other.
 */
const KINDS = ['site', 'room', 'area', 'container', 'vehicle', 'rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'];
const BEFORE = ['site', 'room', 'area', 'shelf', 'bin', 'box', 'vehicle', 'other'];

migrate(
  (app) => {
    const locations = app.findCollectionByNameOrId('locations');
    locations.fields.getByName('kind').values = KINDS;
    app.save(locations);
  },
  (app) => {
    for (const rec of app.findRecordsByFilter('locations', '', '', 0, 0)) {
      if (BEFORE.indexOf(rec.getString('kind')) >= 0) continue;
      rec.set('kind', 'other');
      app.saveNoValidate(rec);
    }
    const locations = app.findCollectionByNameOrId('locations');
    locations.fields.getByName('kind').values = BEFORE;
    app.save(locations);
  },
);
