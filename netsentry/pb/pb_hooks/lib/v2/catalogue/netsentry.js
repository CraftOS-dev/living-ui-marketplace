/**
 * NetSentry itself (plan §16.10 NS-SELF-EXPOSED): its console is an app like
 * any other, so "who can reach it" is the ordinary reach check — and nobody
 * should reach it from the whole internet. It runs as a PocketBase program, like
 * other apps do, so it only counts once the console answers
 * /api/netsentry/whoami itself (confirmRequired).
 */
module.exports = {
  id: 'netsentry',
  version: 1,
  name: 'NetSentry',
  category: 'infra',
  what: 'this security console',
  sources: { code: 'pb/pb_hooks/enrol.pb.js', plan: 'docs/SYSTEM-V2-PLAN.md' },
  recognise: {
    images: [],
    containerPorts: [],
    webPorts: [],
    ports: [],
    processes: ['pocketbase', 'pocketbase.exe'],
    confirmRequired: true,
    http: { path: '/api/netsentry/whoami', want: 'json', match: (r) => !!(r && r.json && r.json.app === 'netsentry' && r.json.role === 'console') },
  },
  probe: [{ path: '/api/netsentry/whoami', want: 'json' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_plus_private_remote',
  template: 'internal',
  data: { important: ['its data folder (pb_data): history, settings and the keys it holds'], lose: 'your history, settings and every key NetSentry holds', skip: [] },
  updates: { github: '', advisories: '', how: {} },
  checks: [],
};
