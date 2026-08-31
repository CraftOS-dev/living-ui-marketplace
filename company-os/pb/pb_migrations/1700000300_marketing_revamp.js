/// <reference path="../pb_data/types.d.ts" />
/**
 * Marketing revamp. Turns the thin channels+promos pair into a real marketing
 * system built around the campaign as the organizing unit (goal + budget +
 * spend + target + result), with content pieces linked to campaigns and a
 * proper content pipeline (idea → draft → scheduled → published).
 *
 *   - NEW  campaigns      the backbone: one funnel goal, a budget, a target
 *   - ALTER promos        + campaign relation, + format, richer status enum
 *
 * Additive to campaigns; the promos change is a fresh-schema tweak (the enum
 * gains 'draft'/'scheduled', 'planned' folds into 'scheduled', 'done' into
 * 'published') — safe on a fresh install and mapped defensively for any data.
 */
migrate(
  (app) => {
    const AUTH = '@request.auth.id != ""';
    const RULES = {
      listRule: AUTH,
      viewRule: AUTH,
      createRule: AUTH,
      updateRule: AUTH,
      deleteRule: AUTH,
    };
    const TS = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];

    const channelsId = app.findCollectionByNameOrId('channels').id;

    // --- NEW: campaigns -----------------------------------------------------
    const campaigns = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'campaigns',
          fields: [
            { name: 'name', type: 'text', required: true, max: 160 },
            // funnel goal, plain-language in the UI
            { name: 'goal', type: 'select', maxSelect: 1, required: true, values: ['awareness', 'leads', 'sales', 'loyalty'] },
            { name: 'status', type: 'select', maxSelect: 1, required: true, values: ['planned', 'active', 'paused', 'done'] },
            { name: 'channel', type: 'relation', maxSelect: 1, collectionId: channelsId, cascadeDelete: false },
            { name: 'start', type: 'date' },
            { name: 'end', type: 'date' },
            { name: 'budget', type: 'number' }, // planned spend
            { name: 'spend', type: 'number' }, // actual spend to date
            { name: 'target', type: 'number' }, // goal number (e.g. 20 leads)
            { name: 'result', type: 'number' }, // achieved so far
            { name: 'note', type: 'text', max: 2000 },
          ].concat(TS),
        },
        RULES,
      ),
    );
    app.save(campaigns);
    const campaignsId = campaigns.id;

    // --- ALTER: promos become content pieces --------------------------------
    const promos = app.findCollectionByNameOrId('promos');
    promos.fields.add(
      new Field({ name: 'campaign', type: 'relation', maxSelect: 1, collectionId: campaignsId, cascadeDelete: false }),
    );
    promos.fields.add(
      new Field({ name: 'format', type: 'select', maxSelect: 1, values: ['post', 'email', 'ad', 'article', 'event', 'other'] }),
    );
    // richer pipeline. Map any legacy values so no record becomes invalid.
    const legacy = app.findRecordsByFilter('promos', "status = 'planned' || status = 'done'", '', 0, 0);
    for (const r of legacy) {
      r.set('status', r.getString('status') === 'done' ? 'published' : 'scheduled');
      app.save(r);
    }
    const status = promos.fields.getByName('status');
    status.values = ['idea', 'draft', 'scheduled', 'published'];
    app.save(promos);
  },
  (app) => {
    // Down: restore the original promos enum and drop the additions.
    try {
      const promos = app.findCollectionByNameOrId('promos');
      const back = app.findRecordsByFilter('promos', "status = 'draft' || status = 'scheduled' || status = 'published'", '', 0, 0);
      for (const r of back) {
        const s = r.getString('status');
        r.set('status', s === 'published' ? 'done' : s === 'idea' ? 'idea' : 'planned');
        app.save(r);
      }
      const status = promos.fields.getByName('status');
      status.values = ['idea', 'planned', 'done'];
      promos.fields.removeByName('campaign');
      promos.fields.removeByName('format');
      app.save(promos);
    } catch {
      /* best-effort */
    }
    try {
      app.delete(app.findCollectionByNameOrId('campaigns'));
    } catch {
      /* absent */
    }
  },
);
