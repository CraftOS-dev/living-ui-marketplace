/** Nextcloud — lab-verified (tests/fixtures/catalogue/nextcloud.json: /status.php installed:false on a fresh start). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'nextcloud',
  version: 1,
  name: 'Nextcloud',
  category: 'files',
  what: 'your files, photos and calendars in your own cloud',
  sources: {
    install: 'https://docs.nextcloud.com/server/latest/admin_manual/installation/installation_wizard.html',
    docker: 'https://github.com/nextcloud/docker',
    releases: 'https://github.com/nextcloud/server/releases',
    advisories: 'https://github.com/nextcloud/security-advisories',
    lab: 'tests/fixtures/catalogue/nextcloud.json',
  },
  recognise: {
    images: ['nextcloud', 'lscr.io/linuxserver/nextcloud', 'linuxserver/nextcloud', 'nextcloud/all-in-one'],
    containerPorts: [80, 443],
    webPorts: [80],
    ports: [80, 443],
    processes: [],
    http: { path: '/status.php', want: 'json', match: (r) => !!(r && r.json && r.json.productname === 'Nextcloud') },
  },
  probe: [{ path: '/status.php', want: 'json' }],
  versionFrom: (http) => {
    const r = http['/status.php'];
    return r && r.json && r.json.versionstring ? String(r.json.versionstring) : '';
  },
  config: [],
  defaultIntent: 'local_plus_private_remote',
  data: { important: ['the Nextcloud data folder, its config and its database'], lose: 'your files, contacts, calendars and shares', skip: [] },
  updates: { github: 'nextcloud/server', advisories: 'github', how: updateHow('nextcloud', 'nextcloud:stable') },
  setup: {
    path: '/status.php',
    open: (r) => (r && r.json && typeof r.json.installed === 'boolean' ? !r.json.installed : null),
    becomes: 'the admin of your Nextcloud and everything stored in it',
    how: (a, url) => [`Open ${url} in your browser now.`, 'Create the admin account with a strong, unique password and finish the installation.'],
  },
  checks: ['APP-SETUP-OPEN'],
};
