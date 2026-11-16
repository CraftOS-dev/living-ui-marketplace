/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS fix 5: logos, a company's stage and its founders.
 *
 * - `companies.logo`: the company's own logo, one image (png, jpg, webp or
 *   svg; 2 MB at most), protected: served only through the companies.logo
 *   op (lib_files.serve), never by the collection API. Set with
 *   companies.logo-set, removed with companies.logo-remove.
 * - `settings.logo`: the firm's own logo, the same rules (settings.logo-set,
 *   settings.logo-remove; owner or admin). When set, the sidebar shows it in
 *   place of the app's name.
 * - `companies.stage`: the stage a person gives the company (idea, pre_seed,
 *   seed, series_a, series_b, series_c, growth: the thesis vocabulary); the
 *   portfolio hero shows it before the latest round's label.
 * - `employments.founder`: this job is a founder's (people.link --founder),
 *   so a founder added from the company's edit sheet counts as a founder
 *   even when the company has no deal to seat them on.
 */
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const LOGO_BYTES = 2097152;
const STAGES = ['idea', 'pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'growth'];

migrate(
  (app) => {
    const companies = app.findCollectionByNameOrId('companies');
    if (!companies.fields.getByName('logo')) companies.fields.add(new FileField({ name: 'logo', maxSelect: 1, maxSize: LOGO_BYTES, mimeTypes: LOGO_TYPES, protected: true }));
    if (!companies.fields.getByName('stage')) companies.fields.add(new SelectField({ name: 'stage', maxSelect: 1, values: STAGES }));
    app.save(companies);
    const settings = app.findCollectionByNameOrId('settings');
    if (!settings.fields.getByName('logo')) settings.fields.add(new FileField({ name: 'logo', maxSelect: 1, maxSize: LOGO_BYTES, mimeTypes: LOGO_TYPES, protected: true }));
    app.save(settings);
    const jobs = app.findCollectionByNameOrId('employments');
    if (!jobs.fields.getByName('founder')) jobs.fields.add(new BoolField({ name: 'founder' }));
    app.save(jobs);
  },
  (app) => {
    const companies = app.findCollectionByNameOrId('companies');
    if (companies.fields.getByName('logo')) companies.fields.removeByName('logo');
    if (companies.fields.getByName('stage')) companies.fields.removeByName('stage');
    app.save(companies);
    const settings = app.findCollectionByNameOrId('settings');
    if (settings.fields.getByName('logo')) settings.fields.removeByName('logo');
    app.save(settings);
    const jobs = app.findCollectionByNameOrId('employments');
    if (jobs.fields.getByName('founder')) jobs.fields.removeByName('founder');
    app.save(jobs);
  },
);
