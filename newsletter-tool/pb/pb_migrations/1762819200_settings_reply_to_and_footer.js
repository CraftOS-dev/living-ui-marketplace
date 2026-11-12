/// <reference path="../pb_data/types.d.ts" />
/**
 * Store the rest of the Settings form: the reply-to address and the
 * organization name and mailing address shown in every email's footer
 * (previously kept in the browser tab only and lost on reload).
 */
migrate(
  (app) => {
    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.add(new EmailField({ name: 'reply_to' }));
    settings.fields.add(new TextField({ name: 'organization_name', max: 200 }));
    settings.fields.add(new TextField({ name: 'organization_address', max: 500 }));
    app.save(settings);
  },
  (app) => {
    const settings = app.findCollectionByNameOrId('settings');
    for (const name of ['reply_to', 'organization_name', 'organization_address']) {
      settings.fields.removeByName(name);
    }
    app.save(settings);
  },
);
