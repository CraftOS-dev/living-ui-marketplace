/** Home Assistant — lab-verified (tests/fixtures/catalogue/homeassistant.json: /api/onboarding "user" step not done on a fresh start). */
const { updateHow } = require('./_common.js');

module.exports = {
  id: 'homeassistant',
  version: 1,
  name: 'Home Assistant',
  category: 'home',
  what: 'your smart-home hub',
  sources: {
    install: 'https://www.home-assistant.io/installation/linux#docker-compose',
    onboarding: 'https://github.com/home-assistant/core/tree/dev/homeassistant/components/onboarding',
    releases: 'https://github.com/home-assistant/core/releases',
    advisories: 'https://github.com/home-assistant/core/security/advisories',
    lab: 'tests/fixtures/catalogue/homeassistant.json',
  },
  recognise: {
    images: ['ghcr.io/home-assistant/home-assistant', 'homeassistant/home-assistant', 'lscr.io/linuxserver/homeassistant', 'linuxserver/homeassistant'],
    containerPorts: [8123],
    ports: [8123],
    processes: ['hass'],
    http: { path: '/manifest.json', want: 'json', match: (r) => !!(r && r.json && /Home automation platform/.test(String(r.json.description || ''))) },
  },
  probe: [
    { path: '/manifest.json', want: 'json' },
    { path: '/api/onboarding', want: 'text' },
  ],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_plus_private_remote',
  data: { important: ['the Home Assistant configuration folder (/config)'], lose: 'your automations, devices and dashboards', skip: [] },
  updates: { github: 'home-assistant/core', advisories: 'github', how: updateHow('homeassistant', 'ghcr.io/home-assistant/home-assistant:stable') },
  setup: {
    path: '/api/onboarding',
    open: (r) => {
      const t = r && r.text;
      if (!t) return null;
      const m = /"step"\s*:\s*"user"\s*,\s*"done"\s*:\s*(true|false)/.exec(t);
      return m ? m[1] === 'false' : null;
    },
    becomes: 'the owner of your smart home: every device, lock and camera it controls',
    how: (a, url) => [`Open ${url} in your browser now.`, 'Create the owner account with a strong, unique password and finish the onboarding.'],
  },
  checks: ['APP-SETUP-OPEN'],
};
