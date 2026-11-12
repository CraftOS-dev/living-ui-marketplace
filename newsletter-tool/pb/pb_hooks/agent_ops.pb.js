/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — everything a person can do on the Newsletter Tool's
 * screens, for AI agents. Each route runs a server port of the screen's own
 * logic (lib_agent.js, ported from frontend/src/app/services/apiAdapter.ts),
 * so agents and people write identical records. Every route has a matching
 * entry in operations.json.
 *
 * Handlers run in isolated contexts: require() inside each one.
 * Read-only operations are GET (as subscribers.export and integrations.status
 * are); everything that writes is POST.
 */

// app.guide — how the app works and the block format.
routerAdd('GET', '/api/ops/app/guide', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, () => lib.guide());
});

// dashboard.get — the Dashboard screen's numbers and lists.
routerAdd('GET', '/api/ops/dashboard/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.dashboard(app));
});

// subscribers.list — the Subscribers screen with its filters.
routerAdd('GET', '/api/ops/subscribers/list', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.subscribersList(app, p));
});

// subscribers.add — the Add subscriber form (upsert by email).
routerAdd('POST', '/api/ops/subscribers/add', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.subscribersAdd(app, p));
});

// subscribers.import — Import CSV.
routerAdd('POST', '/api/ops/subscribers/import', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.subscribersImport(app, p));
});

// templates.list — the Templates screen.
routerAdd('GET', '/api/ops/templates/list', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.templatesList(app, p));
});

// templates.get — one template as the template editor opens it.
routerAdd('GET', '/api/ops/templates/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.templatesGet(app, p));
});

// templates.create — New blank template.
routerAdd('POST', '/api/ops/templates/create', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.templatesCreate(app, p));
});

// templates.update — the template editor's autosave.
routerAdd('POST', '/api/ops/templates/update', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.templatesUpdate(app, p));
});

// templates.duplicate — the template editor's Duplicate.
routerAdd('POST', '/api/ops/templates/duplicate', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.templatesDuplicate(app, p));
});

// templates.delete — Delete template (confirmed in the app).
routerAdd('POST', '/api/ops/templates/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.templatesDelete(app, p));
});

// campaigns.list — the Campaigns screen and the Schedule calendar.
routerAdd('GET', '/api/ops/campaigns/list', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsList(app, p));
});

// campaigns.get — the campaign editor and its Audience tab.
routerAdd('GET', '/api/ops/campaigns/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsGet(app, p));
});

// campaigns.preview — the Review tab's rendered email.
routerAdd('GET', '/api/ops/campaigns/preview', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsPreview(app, p));
});

// campaigns.create — New campaign / Start campaign from a template.
routerAdd('POST', '/api/ops/campaigns/create', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsCreate(app, p));
});

// campaigns.update — the campaign editor's fields and autosave.
routerAdd('POST', '/api/ops/campaigns/update', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsUpdate(app, p));
});

// campaigns.duplicate — Duplicate on a campaign card.
routerAdd('POST', '/api/ops/campaigns/duplicate', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsDuplicate(app, p));
});

// campaigns.delete — Delete on a campaign card (confirmed in the app).
routerAdd('POST', '/api/ops/campaigns/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsDelete(app, p));
});

// campaigns.schedule — the editor's Schedule (future times only).
routerAdd('POST', '/api/ops/campaigns/schedule', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsSchedule(app, p));
});

// campaigns.cancel — Cancel a scheduled send (confirmed in the app).
routerAdd('POST', '/api/ops/campaigns/cancel', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsCancel(app, p));
});

// campaigns.send-now — the editor's Send now (confirmed in the app).
routerAdd('POST', '/api/ops/campaigns/send-now', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsSendNow(app, p));
});

// campaigns.ai-write — the editor's AI writer, applied to the campaign.
routerAdd('POST', '/api/ops/campaigns/ai-write', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.campaignsAiWrite(app, p));
});

// blocks.edit — add, change, move or remove one block (editor canvas).
routerAdd('POST', '/api/ops/blocks/edit', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.blocksEdit(app, p));
});

// settings.get — sender identity and integration state (Settings screen).
routerAdd('GET', '/api/ops/settings/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.settingsGet(app));
});

// settings.update — Save on the Settings screen (sender name and email).
routerAdd('POST', '/api/ops/settings/update', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.run(e, (p, app) => lib.settingsUpdate(app, p));
});
