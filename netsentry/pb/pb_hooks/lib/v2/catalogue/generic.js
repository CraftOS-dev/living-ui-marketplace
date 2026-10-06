/**
 * Any other app (v4 §7.4): a container NetSentry doesn't know. It still gets everything that
 * doesn't need to know the app — running or not, its logs, settings, updates of its image, who can
 * reach it, backups of its folders, Remove — so an app installed from a pasted Compose file is
 * looked after like the rest. Never matched by image: it is what's left once the others matched.
 */
module.exports = {
  id: 'container',
  version: 1,
  name: 'App',
  category: 'other',
  what: 'an app NetSentry doesn’t know yet',
  sources: { verified: 'nothing app-specific: the checks every app gets', plan: 'docs/SYSTEM-V4-PLAN.md' },
  recognise: { images: [], containerPorts: [], ports: [], processes: [], http: { path: '/', want: 'status', match: () => false } },
  probe: [],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_network',
  data: { important: ['its own folders and volumes (everything it keeps)'], lose: 'everything it keeps', skip: [] },
  updates: {},
  checks: [],
};
