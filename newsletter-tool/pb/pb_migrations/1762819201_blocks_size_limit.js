/// <reference path="../pb_data/types.d.ts" />
/**
 * Room for uploaded images. The editor embeds an uploaded image (up to 5 MB,
 * about 6.7 MB as base64) in the `blocks` JSON, but PocketBase caps a JSON
 * field at 1 MB unless maxSize is set. 30 MB holds a few full-size uploads
 * and stays under PocketBase's 32 MB request body limit for the app's routes.
 */
migrate(
  (app) => {
    for (const name of ['campaigns', 'templates']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.getByName('blocks').maxSize = 30 * 1024 * 1024;
      app.save(collection);
    }
  },
  (app) => {
    for (const name of ['campaigns', 'templates']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.getByName('blocks').maxSize = 0;
      app.save(collection);
    }
  },
);
