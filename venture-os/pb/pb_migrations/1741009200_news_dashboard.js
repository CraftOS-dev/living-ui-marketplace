/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS markets, fix 4: the news dashboard, your AI agent's insights
 * and market briefs.
 *
 * news             + category (what an investor reads: portfolio, pipeline,
 *                  competitors, funding, exits, macro, policy, sectors; set
 *                  from the search that found the item, never from its
 *                  words), sector (a thesis sector key, '' for market-wide
 *                  items), topic (what the search was about), snippet (the
 *                  feed's own lines), feed (bing, google, person), image (the
 *                  picture, downloaded from a declared host and served by the
 *                  app), image_source, image_by (feed or agent), a funding
 *                  round it reports (round_company, round_amount_usd,
 *                  round_stage: structured, set by a person or your AI
 *                  agent), about_kind + market.
 *                  The news is a cache of public articles that the pull
 *                  refills within two hours: rows stored before this schema
 *                  are discarded here (no category to show them under).
 * news_saves       a person saved an item (one row per item and person).
 * news_insights    your AI agent's take on the news: title, analysis,
 *                  impact (positive, negative, watch), affects [{kind, id,
 *                  name}], news_ids (the items it rests on), next_step,
 *                  refs (" kind:id " tokens for filtering), status
 *                  (active, dismissed).
 * research_reports a market brief a person asked for: topic, sector,
 *                  status (requested, writing, ready, failed), sections
 *                  [{key, title, body}], citations [{n, title, url,
 *                  source}], summary, the job.
 *
 * Every rule null (ops only). Timestamps are ISO text (UTC).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const rel = (name, target, cascade) => ({ name: name, type: 'relation', maxSelect: 1, collectionId: app.findCollectionByNameOrId(target).id, cascadeDelete: cascade === true });
    const json = (name) => ({ name: name, type: 'json', maxSize: 200000 });
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];

    // The old rows have no category: discard them (the pull refills the news).
    app.db().newQuery('DELETE FROM news').execute();

    const news = app.findCollectionByNameOrId('news');
    const kind = news.fields.getByName('about_kind');
    kind.values = ['company', 'sector', 'thesis', 'market'];
    news.fields.add(new SelectField({ name: 'category', maxSelect: 1, values: ['portfolio', 'pipeline', 'competitors', 'funding', 'exits', 'macro', 'policy', 'sectors'], required: true }));
    news.fields.add(new TextField({ name: 'sector', max: 60 }));
    news.fields.add(new TextField({ name: 'topic', max: 120 }));
    news.fields.add(new TextField({ name: 'snippet', max: 600 }));
    news.fields.add(new SelectField({ name: 'feed', maxSelect: 1, values: ['bing', 'google', 'person'] }));
    news.fields.add(new FileField({ name: 'image', maxSelect: 1, maxSize: 3145728, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], protected: true }));
    news.fields.add(new TextField({ name: 'image_source', max: 1000 }));
    news.fields.add(new SelectField({ name: 'image_by', maxSelect: 1, values: ['feed', 'agent'] }));
    news.fields.add(new TextField({ name: 'round_company', max: 200 }));
    news.fields.add(new NumberField({ name: 'round_amount_usd', onlyInt: true, min: 0 }));
    news.fields.add(new TextField({ name: 'round_stage', max: 40 }));
    news.addIndex('idx_news_category', false, 'hidden, category, published_at', '');
    news.addIndex('idx_news_sector_key', false, 'hidden, sector, published_at', '');
    app.save(news);

    const saves = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'news_saves',
          fields: [rel('news', 'news', true), rel('member', 'members', true)].concat(stamps),
          indexes: ['CREATE UNIQUE INDEX idx_news_saves_one ON news_saves (news, member)', 'CREATE INDEX idx_news_saves_member ON news_saves (member, created)'],
        },
        closed,
      ),
    );
    app.save(saves);

    const insights = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'news_insights',
          fields: [
            txt('title', 200, { required: true }),
            txt('analysis', 1500, { required: true }),
            sel('impact', ['positive', 'negative', 'watch'], true),
            json('affects'),
            json('news_ids'),
            txt('next_step', 400),
            txt('refs', 4000),
            sel('status', ['active', 'dismissed'], true),
            rel('dismissed_by', 'members'),
            txt('dismissed_at', 40),
            txt('job', 30),
            sel('actor', ['person', 'agent', 'system'], true),
            rel('member', 'members'),
          ].concat(stamps),
          indexes: ['CREATE INDEX idx_news_insights_status ON news_insights (status, created)'],
        },
        closed,
      ),
    );
    app.save(insights);

    const reports = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'research_reports',
          fields: [
            txt('title', 200, { required: true }),
            txt('topic', 300),
            txt('sector', 60),
            sel('status', ['requested', 'writing', 'ready', 'failed'], true),
            json('sections'),
            json('citations'),
            txt('summary', 600),
            txt('job', 30),
            rel('requested_by', 'members'),
            txt('ready_at', 40),
            txt('error', 400),
            sel('actor', ['person', 'agent', 'system'], true),
            rel('member', 'members'),
          ].concat(stamps),
          indexes: ['CREATE INDEX idx_research_reports_status ON research_reports (status, created)'],
        },
        closed,
      ),
    );
    app.save(reports);
  },
  (app) => {
    for (const name of ['research_reports', 'news_insights', 'news_saves']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
    try {
      const news = app.findCollectionByNameOrId('news');
      news.removeIndex('idx_news_category');
      news.removeIndex('idx_news_sector_key');
      for (const f of ['category', 'sector', 'topic', 'snippet', 'feed', 'image', 'image_source', 'image_by', 'round_company', 'round_amount_usd', 'round_stage']) if (news.fields.getByName(f)) news.fields.removeByName(f);
      news.fields.getByName('about_kind').values = ['company', 'sector', 'thesis'];
      app.save(news);
    } catch {
      /* already gone */
    }
  },
);
