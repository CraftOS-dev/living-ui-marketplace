/// <reference path="../pb_data/types.d.ts" />
/**
 * First-open data: the one settings row and a short list of materials with
 * their densities (g/cm3), used for mass. No parts and no sample data.
 */
migrate(
  (app) => {
    const settings = new Record(app.findCollectionByNameOrId('settings'));
    settings.set('display_unit', 'mm');
    settings.set('navigation', 'left_rotates');
    settings.set('projection', 'perspective');
    settings.set('show_grid', true);
    settings.set('default_material', 'PLA');
    settings.set('materials', [
      { name: 'PLA', density: 1.24 },
      { name: 'PETG', density: 1.27 },
      { name: 'ABS', density: 1.04 },
      { name: 'ASA', density: 1.07 },
      { name: 'TPU', density: 1.21 },
      { name: 'Nylon (PA12)', density: 1.01 },
      { name: 'Resin (standard)', density: 1.15 },
      { name: 'Aluminium 6061', density: 2.7 },
      { name: 'Steel', density: 7.85 },
      { name: 'Stainless steel 304', density: 8.0 },
      { name: 'Brass', density: 8.5 },
      { name: 'Plywood', density: 0.6 },
    ]);
    settings.set('agent_wait_s', 20);
    settings.set('last_prune_at', '');
    app.save(settings);
  },
  (app) => {
    for (const r of app.findRecordsByFilter('settings', '', '', 0, 0)) app.delete(r);
  },
);
