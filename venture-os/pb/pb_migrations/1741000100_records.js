/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS records (kernel-records): the firm's global people and
 * companies, work history, merged ids and dismissed duplicate pairs.
 *
 * Identity: a person by lowercased email (primary `email` unique, every
 * address in `emails`), a company by root domain (`domain` unique, every
 * domain in `domains`); free-mail domains never make a company. Fields your
 * AI agent may fill carry provenance in `prov` ({field: {by, at, run,
 * source, member}}). Soft delete with `deleted_at`; a merged record keeps
 * `merged_into` and its id resolves to the survivor through `aliases`.
 *
 * Every collection is closed to the raw API (rules null): people and your
 * AI agent reach records only through the app's operations.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const CC = '^([A-Z]{2})?$';
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const day = (name) => ({ name: name, type: 'text', max: 10, pattern: DAY });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const ORIGINS = ['manual', 'capture', 'intake', 'import', 'agent', 'markets', 'portfolio', 'other'];
    const written = () => [sel('actor', ['person', 'agent', 'system'], true), rel('member', 'members')];

    make(
      'companies',
      [
        req('name', 200),
        txt('name_key', 200),
        txt('domain', 200),
        json('domains', 4000),
        txt('website', 300),
        txt('description', 4000),
        sel('kind', ['startup', 'investor', 'corporate', 'service', 'other'], true),
        txt('sector', 80),
        txt('subsector', 80),
        txt('hq_country', 2, { pattern: CC }),
        txt('hq_city', 120),
        int('founded_year', { min: 0, max: 3000 }),
        int('team_size', { min: 0 }),
        sel('business_model', ['saas', 'marketplace', 'transactional', 'consumer_subscription', 'advertising', 'hardware', 'licensing', 'services', 'other']),
        txt('linkedin', 300),
        json('tags', 4000),
        sel('origin', ORIGINS),
        json('prov', 20000),
        txt('merged_into', 20),
        txt('deleted_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ["CREATE UNIQUE INDEX idx_companies_domain ON companies (domain) WHERE domain != ''", 'CREATE INDEX idx_companies_key ON companies (name_key)', 'CREATE INDEX idx_companies_deleted ON companies (deleted_at)'],
    );

    make(
      'people',
      [
        txt('name', 160),
        txt('name_key', 160),
        txt('email', 254),
        json('emails', 4000),
        txt('phone', 60),
        txt('title', 160),
        rel('company', 'companies'),
        txt('linkedin', 300),
        txt('location', 160),
        txt('bio', 4000),
        json('tags', 4000),
        sel('origin', ORIGINS),
        json('prov', 20000),
        txt('merged_into', 20),
        txt('deleted_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ["CREATE UNIQUE INDEX idx_people_email ON people (email) WHERE email != ''", 'CREATE INDEX idx_people_key ON people (name_key)', 'CREATE INDEX idx_people_company ON people (company)', 'CREATE INDEX idx_people_deleted ON people (deleted_at)'],
    );

    make(
      'employments',
      [rel('person', 'people', { required: true, cascadeDelete: true }), rel('company', 'companies', { required: true }), txt('title', 160), bool('current'), day('start_day'), day('end_day'), sel('origin', ORIGINS)].concat(written()).concat(stamps),
      ['CREATE INDEX idx_employments_person ON employments (person, current)', 'CREATE INDEX idx_employments_company ON employments (company, current)'],
    );

    make('aliases', [sel('kind', ['people', 'companies', 'deals'], true), req('old_id', 20), req('new_id', 20), txt('run', 40)].concat(written()).concat(stamps), ['CREATE UNIQUE INDEX idx_aliases_old ON aliases (kind, old_id)', 'CREATE INDEX idx_aliases_new ON aliases (new_id)']);

    make('dupe_ignores', [sel('kind', ['people', 'companies'], true), req('a', 20), req('b', 20)].concat(written()).concat(stamps), ['CREATE UNIQUE INDEX idx_dupe_ignores_pair ON dupe_ignores (kind, a, b)']);
  },
  (app) => {
    for (const n of ['dupe_ignores', 'aliases', 'employments', 'people', 'companies']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
