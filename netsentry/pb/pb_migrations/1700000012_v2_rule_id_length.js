/// <reference path="../pb_data/types.d.ts" />
/**
 * v2 check ids are longer than v1 rule ids (e.g. APP-JELLYFIN-SETUP-OPEN);
 * findings (and fixes) carry them in rule_id.
 */
migrate(
  (app) => {
    for (const name of ['findings', 'remediations']) {
      const c = app.findCollectionByNameOrId(name);
      const f = c.fields.getByName('rule_id');
      if (f) {
        f.max = 60;
        app.save(c);
      }
    }
  },
  (app) => {
    for (const name of ['findings', 'remediations']) {
      const c = app.findCollectionByNameOrId(name);
      const f = c.fields.getByName('rule_id');
      if (f) {
        f.max = 20;
        app.save(c);
      }
    }
  },
);
