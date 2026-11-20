/**
 * Catalog: firm settings, your AI agent's autonomy and inventory, the
 * audit trail, entities (funds, SPVs, the management company), exchange
 * rates, imports and the full export.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const PAGE = { limit: N('Rows (default 50)'), offset: N('Rows to skip') };
const ENTITY = S('Entity (fund, SPV or management company) id or name', { required: true });
const IMPORT_IN = {
  target: S('What to import (imports.targets), e.g. companies', { required: true }),
  rows: S('JSON list of rows: objects keyed by column name, or lists with --headers'),
  headers: S('JSON list of column names (when --rows are lists)'),
  csv: S('CSV text (first row: column names)'),
  path: S('Your AI agent: absolute path of a CSV file'),
  mapping: S('JSON {column: field key} ("" leaves a column out); default: matched by name'),
  file_name: S('The file name, for the record'),
};

module.exports = [
  /* settings and your AI agent */
  { name: 'settings.get', method: 'GET', fn: 'lib_settings.get', perm: 'signed', effect: 'read', desc: "Firm settings: name, base currency, zone, date style, your AI agent's autonomy, whether it sees LP data, its triggers (agent_triggers) and the switches that let the app ask it on its own (agent_policy), Gmail labels, retention, each module's settings, sign-in limits." },
  {
    name: 'settings.update',
    method: 'POST',
    fn: 'lib_settings.update',
    perm: 'settings:full',
    agent: 'deny',
    effect: 'write',
    desc: "Change firm settings. modules takes {module key: {setting: value}} for the keys each module declares (settings.get shows them).",
    params: {
      firm_name: S('Firm name'),
      base_currency: S('Base currency code'),
      zone: S('IANA time zone of the firm'),
      date_style: S('iso | dmy | mdy | ymd', { enum: ['iso', 'dmy', 'mdy', 'ymd'] }),
      week_start: N('First day of the week, 0 Sunday to 6 Saturday'),
      agent_sees_fund_data: B('Your AI agent may read LP data (commitments, capital accounts)'),
      agent_policy: S('JSON {switch: true|false}: the switches that let the app ask your AI agent on its own (all off by default; settings.get agent_switches): email_decks, meeting_briefs, email_updates, board_briefs, news_digest, radar_sweeps, map_refresh, anti_portfolio'),
      mail: S('JSON {deals_label, updates_label}: Gmail labels the app reads'),
      retention: S('JSON {passed_deal_months}'),
      modules: S('JSON {module key: {setting: value}}'),
      rate_limits: S('JSON {login_fails, lock_minutes, pin_fails, pin_lock_minutes}'),
    },
  },
  { name: 'settings.logo-set', method: 'POST', fn: 'lib_logos.opFirmSet', perm: 'admin', agent: 'deny', effect: 'write', files: ['file'], bodyLimit: 8388608, desc: "The firm's logo (owner or admin): one PNG, JPG, WebP or SVG image, 2 MB at most, uploaded as the multipart field file. The sidebar shows it in place of the app's name.", params: {} },
  { name: 'settings.logo-remove', method: 'POST', fn: 'lib_logos.opFirmRemove', perm: 'admin', agent: 'deny', effect: 'write', desc: "Remove the firm's logo (owner or admin): the sidebar shows the app's name again." },
  { name: 'settings.logo', method: 'GET', fn: 'lib_logos.opFirmGet', perm: 'signed', effect: 'read', desc: "The firm's logo image (the logo_url of auth.me and settings.get). 404 when the firm has none.", params: { v: S('Version (changes with the image; any value)') } },
  { name: 'settings.autonomy', method: 'POST', fn: 'lib_settings.autonomy', perm: 'settings:full', agent: 'deny', effect: 'write', desc: "Promote a kind of your AI agent's proposals to automatic, or back to ask: note_fields, merges, asks, map_entries, stage_moves (only to Screen). Everything else always waits for a person.", params: { autonomy: S('JSON {kind: ask|auto}', { required: true }) } },
  { name: 'ai.inventory', method: 'GET', fn: 'lib_guide.inventory', perm: 'signed', effect: 'read', desc: 'The AI use inventory: every trigger that asks your AI agent for a task (what it is for, what fires it, its cooldown, its switch), the ops it may run alone, only propose, or never, the promoted kinds and what it never does.' },
  { name: 'audit.list', method: 'GET', fn: 'lib_audit.list', perm: 'settings:view', effect: 'read', desc: 'The audit trail, newest first: who (a person, your AI agent, the app) did what to which record, with before and after.', params: Object.assign({ collection: S('Collection name'), record: S('Record id'), member: S('Member id or email'), actor: S('person | agent | system', { enum: ['person', 'agent', 'system'] }), op: S('Operation name'), run: S("Your AI agent's run id"), q: S('Summary contains'), from: S('From day'), to: S('To day') }, PAGE) },

  /* entities */
  { name: 'entities.list', method: 'GET', fn: 'lib_entities.list', perm: 'signed', effect: 'read', desc: 'The management company, funds and SPVs the caller may see, with currency, vintage, size, status and LPA terms.', params: { kind: S('management | fund | spv', { enum: ['management', 'fund', 'spv'] }), include_archived: B('Archived ones too') } },
  { name: 'entities.get', method: 'GET', fn: 'lib_entities.get', perm: 'signed', effect: 'read', desc: 'One entity with its LPA terms, the LPA keys and their defaults.', params: { entity: ENTITY } },
  {
    name: 'entities.save',
    method: 'POST',
    fn: 'lib_entities.save',
    perm: 'settings:full|funds:full',
    agent: 'deny',
    effect: 'write',
    desc: 'Add (no --entity) or change a fund, SPV or the management company. --lpa merges into the terms and is checked whole: mgmt_fee_ppm, fee_basis, step_downs, carry_ppm, waterfall european|american, hurdle_ppm, catch_up_ppm, recycling, term.',
    params: {
      entity: S('Entity id or name (empty to add one)'),
      kind: S('management | fund | spv (new entities)', { enum: ['management', 'fund', 'spv'] }),
      name: S('Name'),
      short_name: S('Short name, e.g. Fund II'),
      legal_name: S('Legal name'),
      currency: S('Currency code'),
      vintage: N('Vintage year'),
      size: S('Size (committed capital) in major units'),
      target: S('Target size in major units'),
      status: S('active | raising | investing | harvesting | closed', { enum: ['active', 'raising', 'investing', 'harvesting', 'closed'] }),
      fiscal_year_end: S('MM-DD, e.g. 12-31'),
      first_close_day: S('First close YYYY-MM-DD'),
      final_close_day: S('Final close YYYY-MM-DD'),
      lpa: S('JSON LPA terms to merge (entities.get lists the keys)'),
      settings: S('JSON {module: {setting: value}} for this entity (null removes a module key)'),
      parent: S('Parent entity (an SPV under a fund) id or name'),
      deal: S('The deal an SPV was formed for (id)'),
      notes: S('Notes'),
    },
  },
  { name: 'entities.archive', method: 'POST', fn: 'lib_entities.archive', perm: 'settings:full', agent: 'deny', effect: 'write', desc: 'Archive a fund or SPV (or restore it with --archived false). The management company stays.', params: { entity: ENTITY, archived: B('true to archive (default), false to restore') } },

  /* exchange rates */
  { name: 'fx.list', method: 'GET', fn: 'lib_fx.list', perm: 'signed', effect: 'read', desc: 'Stored exchange rates, latest first (rate_e8 = units of quote for one base, scaled by 10^8), and the currencies in use.', params: { base: S('Base currency'), quote: S('Quote currency'), limit: N('Rows (default 60)') } },
  { name: 'fx.refresh', method: 'POST', fn: 'lib_fx.refreshOp', perm: 'signed', effect: 'write', track: false, desc: "Fetch today's rates from the base currency to every currency in use (European Central Bank via Frankfurter, then currency-api)." },
  { name: 'fx.set', method: 'POST', fn: 'lib_fx.setOp', perm: 'settings:full|funds:full', agent: 'deny', effect: 'write', desc: 'Set an exchange rate by hand for a day (a rate set by a person is never replaced by a fetched one).', params: { base: S('From currency', { required: true }), quote: S('To currency', { required: true }), rate: S('How many quote units one base unit buys, e.g. 0.92', { required: true }), day: S('Day (default today)') } },
  { name: 'fx.convert', method: 'GET', fn: 'lib_fx.convertOp', perm: 'signed', effect: 'read', desc: 'What an amount is worth in another currency on a day: mode end (the rate on the day, for balances) or avg (the average over from_day to day, for flows). Answers minor null with a reason when no rate is known.', params: { amount: S('Amount in major units', { required: true }), from: S('From currency', { required: true }), to: S('To currency', { required: true }), day: S('Day (default today)'), mode: S('end | avg', { enum: ['end', 'avg'] }), from_day: S('Start of the period for avg (default the first of the month)') } },

  /* imports */
  { name: 'imports.targets', method: 'GET', fn: 'lib_imports.targets', perm: 'signed', effect: 'read', desc: 'What can be imported (companies, people, deals, holdings... as modules register them), each with its fields, required ones and the column names that match them.' },
  { name: 'imports.preview', method: 'POST', fn: 'lib_imports.preview', perm: 'signed', effect: 'write', track: false, files: ['file'], bodyLimit: 31457280, desc: 'Check an import without changing anything: the column mapping, missing required fields, and what each row (up to 200) would do (created, updated, skipped, error with the reason).', params: IMPORT_IN },
  { name: 'imports.run', method: 'POST', fn: 'lib_imports.run', perm: 'signed', agent: 'propose', kind: 'imports', effect: 'write', track: false, files: ['file'], bodyLimit: 31457280, pinIf: 'lib_imports.pinNeeded', preview: 'lib_imports.previewRun', desc: 'Import up to 200 rows (one undoable unit); rows that would fail are left out with their reasons. --import continues an earlier import of the same file with the next batch. A target with pin: true (imports.targets) needs the approval PIN of the person who runs it: yours is always a proposal.', params: Object.assign({ import: S('Import id to continue (the next batch of the same file)') }, IMPORT_IN) },
  { name: 'imports.list', method: 'GET', fn: 'lib_imports.list', perm: 'signed', effect: 'read', desc: 'Past imports with what each created, updated, skipped and refused, and why.', params: { target: S('Import target'), limit: N('Rows (default 30)') } },

  /* export */
  { name: 'exports.all', method: 'POST', fn: 'lib_exports.all', perm: 'settings:full', agent: 'deny', effect: 'confirm', track: false, desc: "Download the firm's data as one ZIP (a JSON file per collection, secrets left out). Needs your PIN." },
];
