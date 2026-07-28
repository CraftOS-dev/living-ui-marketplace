/// <reference path="../pb_data/types.d.ts" />
/**
 * CRM schema: companies, people, a staged deal pipeline, notes and tasks.
 * Multi-user: sign-up/login via the kit LoginGate; all data requires auth.
 */
migrate(
  (app) => {
    // Multi-user CRM: every collection requires an authenticated user.
    const AUTH = '@request.auth.id != ""';
    const open = {
      listRule: AUTH,
      viewRule: AUTH,
      createRule: AUTH,
      updateRule: AUTH,
      deleteRule: AUTH,
    };

    const companies = new Collection({
      type: 'base',
      name: 'companies',
      ...open,
      fields: [
        { name: 'name', type: 'text', required: true, max: 255 },
        { name: 'domain', type: 'text', max: 255 },
        { name: 'industry', type: 'text', max: 120 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(companies);

    // Record lists: named collections of records of one entity, each with
    // its own optional stage pipeline (a board per list).
    const lists = new Collection({
      type: 'base',
      name: 'lists',
      ...open,
      fields: [
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'entity', type: 'select', maxSelect: 1, values: ['people', 'companies', 'deals'] },
        { name: 'description', type: 'text', max: 500 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(lists);

    const stages = new Collection({
      type: 'base',
      name: 'stages',
      ...open,
      fields: [
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'order', type: 'number' },
        { name: 'color', type: 'text', max: 20 },
        // Empty list = the main deal pipeline; set = this list's own stages.
        {
          name: 'list',
          type: 'relation',
          collectionId: lists.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
      ],
    });
    app.save(stages);

    const tags = new Collection({
      type: 'base',
      name: 'tags',
      ...open,
      fields: [
        { name: 'name', type: 'text', required: true, max: 60 },
        { name: 'color', type: 'text', max: 20 },
      ],
    });
    app.save(tags);

    // companies was created before tags — attach its tags field now.
    const companiesWithTags = app.findCollectionByNameOrId('companies');
    companiesWithTags.fields.add(
      new Field({
        name: 'tags',
        type: 'relation',
        collectionId: tags.id,
        cascadeDelete: false,
        maxSelect: 99,
      }),
    );
    app.save(companiesWithTags);

    const people = new Collection({
      type: 'base',
      name: 'people',
      ...open,
      fields: [
        { name: 'name', type: 'text', required: true, max: 255 },
        { name: 'email', type: 'email' },
        { name: 'phone', type: 'text', max: 60 },
        { name: 'title', type: 'text', max: 160 },
        {
          name: 'company',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('companies').id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'tags',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('tags').id,
          cascadeDelete: false,
          maxSelect: 99,
        },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(people);

    const deals = new Collection({
      type: 'base',
      name: 'deals',
      ...open,
      fields: [
        { name: 'name', type: 'text', required: true, max: 255 },
        { name: 'value', type: 'number' },
        {
          name: 'stage',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('stages').id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'company',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('companies').id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'person',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('people').id,
          cascadeDelete: false,
          maxSelect: 99,
        },
        {
          name: 'tags',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('tags').id,
          cascadeDelete: false,
          maxSelect: 99,
        },
        { name: 'close_date', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(deals);

    // Membership of a record in a list, with its stage inside that list.
    const listEntries = new Collection({
      type: 'base',
      name: 'list_entries',
      ...open,
      fields: [
        {
          name: 'list',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('lists').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        // Polymorphic: the id of a people/companies/deals record.
        { name: 'record_id', type: 'text', required: true, max: 40 },
        {
          name: 'stage',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('stages').id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'position', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_list_entries ON list_entries (list, record_id)'],
    });
    app.save(listEntries);

    const notes = new Collection({
      type: 'base',
      name: 'notes',
      ...open,
      fields: [
        { name: 'body', type: 'text', required: true, max: 10000 },
        {
          name: 'person',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('people').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'company',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('companies').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'deal',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('deals').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(notes);

    const tasks = new Collection({
      type: 'base',
      name: 'tasks',
      ...open,
      fields: [
        { name: 'title', type: 'text', required: true, max: 300 },
        // Day key as plain text YYYY-MM-DD — avoids timezone drift.
        { name: 'due', type: 'text', max: 10 },
        { name: 'done', type: 'bool' },
        {
          name: 'deal',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('deals').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'person',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('people').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(tasks);

    // Activity timeline: one row per notable event, written by the app
    // (record created, stage moved, note added, task completed, ...).
    const activities = new Collection({
      type: 'base',
      name: 'activities',
      ...open,
      fields: [
        { name: 'kind', type: 'text', required: true, max: 40 },
        { name: 'body', type: 'text', required: true, max: 500 },
        {
          name: 'person',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('people').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'company',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('companies').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'deal',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('deals').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(activities);

    // File attachments on any record (native PB file storage).
    const attachments = new Collection({
      type: 'base',
      name: 'attachments',
      ...open,
      fields: [
        { name: 'name', type: 'text', max: 255 },
        { name: 'file', type: 'file', required: true, maxSelect: 1, maxSize: 15728640 },
        {
          name: 'person',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('people').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'company',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('companies').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'deal',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('deals').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(attachments);

    // Saved list filters per entity tab.
    const savedViews = new Collection({
      type: 'base',
      name: 'saved_views',
      ...open,
      fields: [
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['people', 'companies', 'deals'] },
        { name: 'config', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(savedViews);

    // Custom fields (EAV): definitions + per-record values.
    const attributes = new Collection({
      type: 'base',
      name: 'attributes',
      ...open,
      fields: [
        { name: 'entity', type: 'select', maxSelect: 1, values: ['people', 'companies', 'deals'] },
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'type', type: 'select', maxSelect: 1, values: ['text', 'number', 'select'] },
        { name: 'options', type: 'text', max: 500 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(attributes);

    const attributeValues = new Collection({
      type: 'base',
      name: 'attribute_values',
      ...open,
      fields: [
        {
          name: 'attribute',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('attributes').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'record_id', type: 'text', required: true, max: 40 },
        { name: 'value', type: 'text', max: 2000 },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_attr_values ON attribute_values (attribute, record_id)',
      ],
    });
    app.save(attributeValues);

    // Email log + reusable templates (delivery via the CraftBot
    // integration bridge when available; otherwise logged locally).
    const emails = new Collection({
      type: 'base',
      name: 'emails',
      ...open,
      fields: [
        { name: 'to', type: 'email', required: true },
        { name: 'subject', type: 'text', required: true, max: 300 },
        { name: 'body', type: 'text', max: 20000 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['sent', 'logged', 'failed'] },
        { name: 'detail', type: 'text', max: 500 },
        {
          name: 'person',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('people').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(emails);

    const emailTemplates = new Collection({
      type: 'base',
      name: 'email_templates',
      ...open,
      fields: [
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'subject', type: 'text', max: 300 },
        { name: 'body', type: 'text', max: 20000 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(emailTemplates);
  },
  (app) => {
    for (const name of ['email_templates', 'emails', 'attribute_values', 'attributes', 'saved_views', 'attachments', 'activities', 'tasks', 'notes', 'list_entries', 'deals', 'people', 'tags', 'stages', 'lists', 'companies']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
