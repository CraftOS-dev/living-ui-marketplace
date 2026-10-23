/// <reference path="../pb_data/types.d.ts" />
/**
 * A product tile on the register is a square picture with the name under
 * it; whether the price shows under the name is a setting. It starts on for
 * every shop, new or already selling, as the tiles showed prices before.
 */
migrate(
  (app) => {
    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.add(new BoolField({ name: 'show_tile_prices' }));
    app.save(settings);
    app.db().newQuery('UPDATE settings SET show_tile_prices = TRUE').execute();
  },
  (app) => {
    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.removeByName('show_tile_prices');
    app.save(settings);
  },
);
