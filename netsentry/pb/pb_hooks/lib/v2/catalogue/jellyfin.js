/**
 * Jellyfin — catalogue entry (plan §14.1). Every fact cites a source; facts
 * NetSentry relies on at runtime were also verified in the lab
 * (tests/fixtures/lab/probe_apps.json).
 */
module.exports = {
  id: 'jellyfin',
  version: 1,
  name: 'Jellyfin',
  category: 'media',
  what: 'your media server (movies, shows, music)',
  sources: {
    networking: 'https://jellyfin.org/docs/general/networking/',
    public_info: 'https://github.com/jellyfin/jellyfin/blob/master/MediaBrowser.Model/System/PublicSystemInfo.cs',
    startup_api: 'https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/StartupController.cs',
    docker: 'https://jellyfin.org/docs/general/installation/container',
    releases: 'https://github.com/jellyfin/jellyfin/releases',
    advisories: 'https://github.com/jellyfin/jellyfin/security/advisories',
  },
  recognise: {
    images: ['jellyfin/jellyfin', 'ghcr.io/jellyfin/jellyfin', 'lscr.io/linuxserver/jellyfin', 'linuxserver/jellyfin'],
    containerPorts: [8096],
    ports: [8096],
    processes: ['jellyfin', 'jellyfin.exe'],
    // Unauthenticated public info (source: public_info); lab-verified.
    http: { path: '/System/Info/Public', want: 'json', match: (r) => !!(r && r.json && r.json.ProductName === 'Jellyfin Server') },
  },
  probe: [
    { path: '/System/Info/Public', want: 'json' },
    { path: '/health', want: 'text' },
  ],
  versionFrom: (http) => {
    const r = http['/System/Info/Public'];
    return r && r.json && r.json.Version ? String(r.json.Version) : '';
  },
  config: [],
  defaultIntent: 'local_plus_private_remote',
  data: {
    important: ['Jellyfin settings, users and watch history (/config in the container)'],
    lose: "its users, settings and everyone's watch history",
    skip: ['your media files — usually re-downloadable; you choose'],
  },
  updates: {
    github: 'jellyfin/jellyfin',
    advisories: 'github',
    how: {
      docker_compose: (a) => [`cd to the folder with your docker-compose.yml`, `docker compose pull ${a.compose_service || 'jellyfin'}`, `docker compose up -d ${a.compose_service || 'jellyfin'}`],
      docker_run: () => ['docker pull jellyfin/jellyfin:latest', 'Recreate the container with the same settings and volumes.'],
      ubuntu_debian: () => ['sudo apt update', 'sudo apt install --only-upgrade jellyfin'],
      windows_gui: () => ['Download the new installer from jellyfin.org/downloads/windows and run it — your settings are kept.'],
    },
  },
  // Until the first-time setup is finished, whoever opens it creates the admin
  // (lab: StartupWizardCompleted false; /Startup/* answered without a login).
  setup: {
    path: '/System/Info/Public',
    open: (r) => (r && r.json && typeof r.json.StartupWizardCompleted === 'boolean' ? !r.json.StartupWizardCompleted : null),
    becomes: 'its admin — with its users and every file it can see',
    how: (a, url) => [`Open ${a.name} in your browser: ${url}`, 'Finish the setup wizard and create your admin account with a strong, unique password.'],
  },
  checks: ['APP-SETUP-OPEN'],
};
