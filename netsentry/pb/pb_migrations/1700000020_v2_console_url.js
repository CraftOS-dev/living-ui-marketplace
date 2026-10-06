/// <reference path="../pb_data/types.d.ts" />
/**
 * The address machines use to reach this console (security review 2026-09-30).
 * The install script and keyless enrolment use this one configured value —
 * never the address a request happened to arrive on (a proxy or an attacker
 * shapes that). https, or plain http only on the console's own machine.
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('settings');
    c.fields.add(new TextField({ name: 'console_url', max: 300 }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('settings');
    c.fields.removeByName('console_url');
    app.save(c);
  },
);
