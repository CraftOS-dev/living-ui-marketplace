/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS markets, fix 3: news, and the order of tiles on a market map.
 *
 * news         one public article about what the firm cares about: a
 *              portfolio company, a late-stage pipeline company or a thesis
 *              sector (about_kind company | sector | thesis, about_id the
 *              company or thesis id, about_key the sector key, about_name
 *              what a chip shows). Pulled from keyless public RSS news
 *              search every 2 hours (origin pull, deduped by url, kept 60
 *              days) or added by a person (origin person); your AI agent
 *              writes a one-sentence summary for the ones that matter
 *              (news.summarize). A person can hide one.
 * map_entries  + position: the tile's place in its segment (0 first).
 *
 * Timestamps are ISO text (UTC).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const rel = (name, target) => ({ name: name, type: 'relation', maxSelect: 1, collectionId: app.findCollectionByNameOrId(target).id, cascadeDelete: false });

    const news = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'news',
          fields: [
            txt('title', 500, { required: true }),
            txt('url', 2000, { required: true }),
            txt('source', 200),
            txt('source_url', 500),
            txt('published_at', 40),
            txt('summary', 400),
            txt('summarized_at', 40),
            sel('about_kind', ['company', 'sector', 'thesis'], true),
            txt('about_id', 30),
            txt('about_key', 60),
            txt('about_name', 200),
            txt('query', 300),
            sel('origin', ['pull', 'person'], true),
            txt('fetched_at', 40),
            sel('licence', ['public'], true),
            { name: 'hidden', type: 'bool' },
            txt('hidden_at', 40),
            rel('hidden_by', 'members'),
            sel('actor', ['person', 'agent', 'system'], true),
            rel('member', 'members'),
            { name: 'created', type: 'autodate', onCreate: true },
            { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          ],
          indexes: [
            'CREATE UNIQUE INDEX idx_news_url ON news (url)',
            'CREATE INDEX idx_news_published ON news (hidden, published_at)',
            'CREATE INDEX idx_news_about ON news (about_kind, about_id, published_at)',
            'CREATE INDEX idx_news_sector ON news (about_kind, about_key, published_at)',
          ],
        },
        closed,
      ),
    );
    app.save(news);

    const entries = app.findCollectionByNameOrId('map_entries');
    if (!entries.fields.getByName('position')) entries.fields.add(new NumberField({ name: 'position', onlyInt: true, min: 0 }));
    entries.addIndex('idx_map_entries_order', false, 'map, segment, position', '');
    app.save(entries);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('news'));
    } catch {
      /* already gone */
    }
    try {
      const entries = app.findCollectionByNameOrId('map_entries');
      entries.removeIndex('idx_map_entries_order');
      if (entries.fields.getByName('position')) entries.fields.removeByName('position');
      app.save(entries);
    } catch {
      /* already gone */
    }
  },
);
