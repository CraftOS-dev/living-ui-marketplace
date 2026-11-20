/// <reference path="../pb_data/types.d.ts" />
/**
 * The company logo: an image on the one settings record (PNG, JPEG, SVG or
 * WebP, up to 1 MB) and an optional one for dark mode. Protected files:
 * served only by settings.logo (public, so the sign-in screen shows it).
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('settings');
    const LOGO = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    c.fields.add(new FileField({ name: 'logo', maxSelect: 1, maxSize: 1048576, mimeTypes: LOGO, thumbs: [], protected: true }));
    c.fields.add(new FileField({ name: 'logo_dark', maxSelect: 1, maxSize: 1048576, mimeTypes: LOGO, thumbs: [], protected: true }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('settings');
    c.fields.removeByName('logo');
    c.fields.removeByName('logo_dark');
    app.save(c);
  },
);
