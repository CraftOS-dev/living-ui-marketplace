/// <reference path="../pb_data/types.d.ts" />
/**
 * Craft Sheets schema.
 *
 * V1 stored each named grid as one `sheets` SQL row (whole grid as JSON) and
 * evaluated formulas on the Python backend via formula.py. V2 keeps ONE
 * `sheets` record per grid; the fetch adapter (src/app/services/apiAdapter.ts)
 * ports formula.py to TS and computes the `values` / `errors` maps CLIENT-SIDE
 * on every read/write. CSV/XLSX import & export are pure client-side SheetJS.
 *
 * `sid` is a stable INTEGER id exposed to the (unchanged) V1 frontend, which
 * treats sheet ids as numbers (localStorage `Number()` round-trip, `===`
 * matching). PocketBase record ids are strings, so the adapter assigns an
 * incrementing `sid` on create and translates every id in/out.
 *
 * Fields mirror Sheet.to_dict():
 *   name / columns (json) / num_rows / cells (json) / row_heights (json) /
 *   frozen_rows / frozen_cols / position, plus created/updated autodate.
 *
 * Auth mode "none": open rules are acceptable because the app binds loopback
 * and the origin guard (_system.pb.js) refuses foreign-origin writes.
 */
migrate(
  (app) => {
    const sheets = new Collection({
      type: 'base',
      name: 'sheets',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'sid', type: 'number', required: true },
        { name: 'name', type: 'text', required: true, max: 255 },
        { name: 'columns', type: 'json', maxSize: 2000000 },
        { name: 'num_rows', type: 'number' },
        { name: 'cells', type: 'json', maxSize: 20000000 },
        { name: 'row_heights', type: 'json', maxSize: 2000000 },
        { name: 'frozen_rows', type: 'number' },
        { name: 'frozen_cols', type: 'number' },
        { name: 'position', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_sheets_sid ON sheets (sid)'],
    });
    app.save(sheets);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('sheets'));
  },
);
