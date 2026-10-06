/** AdGuard Home — lab-verified (tests/fixtures/catalogue/adguardhome.json: fresh start redirects /control/status to the install page). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'adguardhome',
  version: 1,
  name: 'AdGuard Home',
  category: 'home',
  what: 'your ad blocker and home DNS server',
  sources: {
    docker: 'https://github.com/AdguardTeam/AdGuardHome/wiki/Docker',
    getting_started: 'https://github.com/AdguardTeam/AdGuardHome/wiki/Getting-Started',
    releases: 'https://github.com/AdguardTeam/AdGuardHome/releases',
    lab: 'tests/fixtures/catalogue/adguardhome.json',
  },
  recognise: {
    images: ['adguard/adguardhome'],
    containerPorts: [3000, 80, 53],
    webPorts: [3000, 80],
    ports: [3000, 53],
    processes: ['adguardhome', 'adguardhome.exe'],
    http: { path: '/control/status', want: 'status', match: (r) => !!(r && ((r.status === 302 && /install\.html|login\.html/.test(r.location || '')) || r.status === 401)) },
  },
  probe: [{ path: '/control/status', want: 'status' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_network',
  data: { important: ['AdGuard Home settings (/opt/adguardhome/conf)'], lose: 'your block lists, rules and settings', skip: ['query logs'] },
  updates: { github: 'AdguardTeam/AdGuardHome', advisories: 'github', how: updateHow('adguardhome', 'adguard/adguardhome:latest') },
  setup: {
    path: '/control/status',
    open: (r) => (!r || !r.status ? null : r.status === 302 && /install\.html/.test(r.location || '') ? true : r.status === 401 || /login\.html/.test(r.location || '') ? false : null),
    becomes: 'its admin, able to decide which websites every device on your network can reach',
    how: (a, url) => [`Open ${url} in your browser now.`, 'Go through the setup and create the admin account with a strong, unique password.'],
  },
  checks: ['APP-SETUP-OPEN'],
};
