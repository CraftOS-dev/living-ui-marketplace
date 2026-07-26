/// <reference path="../pb_data/types.d.ts" />
/** Seed the pipeline stages and a small example book of business. */
migrate(
  (app) => {
    const stages = app.findCollectionByNameOrId('stages');
    const stageIds = {};
    [
      ['Lead', '#64748b'],
      ['Qualified', '#3b82f6'],
      ['Proposal', '#f59e0b'],
      ['Won', '#10b981'],
      ['Lost', '#ef4444'],
    ].forEach(([name, color], i) => {
      const record = new Record(stages);
      record.set('name', name);
      record.set('order', i);
      record.set('color', color);
      app.save(record);
      stageIds[name] = record.id;
    });

    const companies = app.findCollectionByNameOrId('companies');
    const acme = new Record(companies);
    acme.set('name', 'Acme Corp');
    acme.set('domain', 'acme.com');
    acme.set('industry', 'Manufacturing');
    app.save(acme);
    const globex = new Record(companies);
    globex.set('name', 'Globex');
    globex.set('domain', 'globex.io');
    globex.set('industry', 'Software');
    app.save(globex);

    const people = app.findCollectionByNameOrId('people');
    const jane = new Record(people);
    jane.set('name', 'Jane Doe');
    jane.set('email', 'jane@acme.com');
    jane.set('title', 'Head of Ops');
    jane.set('company', acme.id);
    app.save(jane);
    const raj = new Record(people);
    raj.set('name', 'Raj Patel');
    raj.set('email', 'raj@globex.io');
    raj.set('title', 'CTO');
    raj.set('company', globex.id);
    app.save(raj);

    const deals = app.findCollectionByNameOrId('deals');
    const dealA = new Record(deals);
    dealA.set('name', 'Acme onboarding');
    dealA.set('value', 12000);
    dealA.set('stage', stageIds['Qualified']);
    dealA.set('company', acme.id);
    dealA.set('person', [jane.id]);
    app.save(dealA);
    const dealB = new Record(deals);
    dealB.set('name', 'Globex platform license');
    dealB.set('value', 48000);
    dealB.set('stage', stageIds['Proposal']);
    dealB.set('company', globex.id);
    dealB.set('person', [raj.id]);
    app.save(dealB);

    const tasks = app.findCollectionByNameOrId('tasks');
    const task = new Record(tasks);
    task.set('title', 'Follow up with Raj about the proposal');
    task.set('done', false);
    task.set('deal', dealB.id);
    task.set('person', raj.id);
    app.save(task);
  },
  () => {
    // Seed data only — the schema down-migration removes the collections.
  },
);
