/**
 * qBittorrent — catalogue entry (plan §14.1). The config keys and the
 * unauthenticated-API behaviour were verified in the lab
 * (tests/fixtures/lab/app_config.json, probe_apps.json).
 */
const CONF_KEYS = [
  { key: 'Preferences/WebUI\\AuthSubnetWhitelistEnabled' },
  { key: 'Preferences/WebUI\\AuthSubnetWhitelist' },
  { key: 'Preferences/WebUI\\LocalHostAuth' },
];

module.exports = {
  id: 'qbittorrent',
  version: 1,
  name: 'qBittorrent',
  category: 'download',
  what: 'your download client',
  sources: {
    webui_api: 'https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)',
    preferences: 'https://github.com/qbittorrent/qBittorrent/blob/master/src/base/preferences.cpp',
    linuxserver: 'https://docs.linuxserver.io/images/docker-qbittorrent/',
    releases: 'https://github.com/qbittorrent/qBittorrent/releases',
  },
  recognise: {
    images: ['lscr.io/linuxserver/qbittorrent', 'linuxserver/qbittorrent', 'qbittorrentofficial/qbittorrent-nox'],
    containerPorts: [8080],
    ports: [8080],
    processes: ['qbittorrent', 'qbittorrent-nox', 'qbittorrent.exe'],
    // Answers only without a password requirement, so it recognises and proves the bypass at once.
    http: { path: '/api/v2/app/version', want: 'text', match: (r) => !!(r && r.status === 200 && /^v\d+\.\d+/.test(r.text || '')) },
  },
  probe: [{ path: '/api/v2/app/version', want: 'text' }],
  versionFrom: (http) => {
    const r = http['/api/v2/app/version'];
    return r && r.status === 200 && /^v\d/.test(r.text || '') ? r.text.slice(1).trim() : '';
  },
  // Only the linuxserver image's config path is verified; others stay "can't check" (honest) until verified.
  config: [
    { images: ['lscr.io/linuxserver/qbittorrent', 'linuxserver/qbittorrent'], path: '/config/qBittorrent/qBittorrent.conf', format: 'ini', keys: CONF_KEYS },
  ],
  defaultIntent: 'local_network',
  data: {
    important: ['qBittorrent settings (/config in the container)'],
    lose: 'its settings and your list of downloads',
    skip: ['downloads'],
  },
  updates: {
    github: 'qbittorrent/qBittorrent',
    tagPrefix: 'release-',
    advisories: 'github',
    how: {
      docker_compose: (a) => ['cd to the folder with your docker-compose.yml', `docker compose pull ${a.compose_service || 'qbittorrent'}`, `docker compose up -d ${a.compose_service || 'qbittorrent'}`],
      ubuntu_debian: () => ['sudo apt update', 'sudo apt install --only-upgrade qbittorrent-nox'],
      windows_gui: () => ['Download the new installer from qbittorrent.org/download and run it.'],
    },
  },
  checks: ['APP-QBIT-AUTH-BYPASS'],
};
