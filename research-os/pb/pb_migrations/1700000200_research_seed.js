/// <reference path="../pb_data/types.d.ts" />
/**
 * Research OS seed: the one settings row (highlight colors and their
 * meanings, the default citation style, your AI agent's limits) and the
 * platform settings this app needs (request logs kept to warnings, a larger
 * body limit is set per route for PDF uploads). No sample data.
 */
migrate(
  (app) => {
    const settings = new Record(app.findCollectionByNameOrId('settings'));
    settings.set('highlight_slots', [
      { slot: 1, hue: 'yellow', meaning: 'Key point' },
      { slot: 2, hue: 'red', meaning: 'Disagree' },
      { slot: 3, hue: 'green', meaning: 'Result' },
      { slot: 4, hue: 'blue', meaning: 'Method' },
      { slot: 5, hue: 'violet', meaning: 'Question' },
      { slot: 6, hue: 'orange', meaning: 'Follow up' },
      { slot: 7, hue: 'teal', meaning: 'Definition' },
      { slot: 8, hue: 'gray', meaning: 'Background' },
    ]);
    settings.set('citation_style', 'apa');
    settings.set('contact_email', '');
    settings.set('agent_policy', { node_cap: 300, cell_cap: 1000, auto_identify: true, auto_ocr: true, auto_oa: true });
    settings.set('jobs', {});
    settings.set('welcome_done', false);
    app.save(settings);

    const s = app.settings();
    s.logs.maxDays = 14;
    s.logs.minLevel = 4;
    app.save(s);
  },
  (app) => {
    for (const r of app.findAllRecords('settings')) app.delete(r);
  },
);
