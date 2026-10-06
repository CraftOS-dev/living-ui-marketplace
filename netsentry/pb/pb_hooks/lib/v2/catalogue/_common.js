/**
 * Building blocks shared by catalogue entries: update instructions and the
 * Sonarr family (Sonarr, Radarr, Lidarr, Prowlarr share one codebase and
 * answered the same questions the same way in the lab).
 */

/** Update steps for an app run with Docker Compose / plain Docker / a package. */
function updateHow(service, image, pkg) {
  const how = {
    docker_compose: (a) => ['cd to the folder with your docker-compose.yml', `docker compose pull ${a.compose_service || service}`, `docker compose up -d ${a.compose_service || service}`],
    docker_run: () => [`docker pull ${image}`, 'Recreate the container with the same settings and volumes.'],
  };
  if (pkg) {
    how.ubuntu_debian = () => ['sudo apt update', `sudo apt install --only-upgrade ${pkg}`];
    how.rhel_family = () => [`sudo dnf upgrade ${pkg}`];
  }
  return how;
}

/** Sonarr / Radarr / Lidarr / Prowlarr (lab: tests/fixtures/catalogue/<id>.json, sonarr_login_on.json). */
function servarr(o) {
  const base = `https://wiki.servarr.com/${o.id}`;
  return {
    id: o.id,
    version: 1,
    // Same codebase, same /ping answer: the image tells them apart.
    family: 'servarr',
    name: o.name,
    category: 'download',
    what: o.what,
    sources: {
      docs: base,
      settings: `${base}/settings#security`,
      linuxserver: `https://docs.linuxserver.io/images/docker-${o.id}/`,
      releases: `https://github.com/${o.repo}/releases`,
      lab: `tests/fixtures/catalogue/${o.id}.json`,
    },
    recognise: {
      images: [`lscr.io/linuxserver/${o.id}`, `linuxserver/${o.id}`, `ghcr.io/hotio/${o.id}`, `hotio/${o.id}`],
      containerPorts: [o.port],
      ports: [o.port],
      processes: [o.id, `${o.name}.exe`.toLowerCase()],
      // Unauthenticated health answer (lab-verified): {"status": "OK"}
      http: { path: '/ping', want: 'json', match: (r) => !!(r && r.json && r.json.status === 'OK') },
    },
    probe: [
      { path: '/ping', want: 'json' },
      { path: '/initialize.json', want: 'json' },
    ],
    versionFrom: (http) => {
      const r = http['/initialize.json'];
      return r && r.json && r.json.version && r.json.instanceName ? String(r.json.version) : '';
    },
    config: [],
    defaultIntent: 'local_network',
    data: {
      important: [`${o.name}'s settings and database (/config in the container)`],
      lose: o.lose,
      skip: ['the media files themselves'],
    },
    updates: { github: o.repo, advisories: 'github', how: updateHow(o.id, `lscr.io/linuxserver/${o.id}:latest`) },
    // Before a login is set up, /initialize.json hands its API key to anyone (lab: 200 + apiKey);
    // with a login it redirects to /login (lab: sonarr_login_on.json).
    keyExposed: {
      path: '/initialize.json',
      test: (r) => (!r ? null : r.status === 200 && r.json ? r.json.apiKey === '[exposed]' : r.status >= 300 && r.status < 500 ? false : null),
      power: o.power,
      how: [`Open ${o.name} → Settings → General → Security.`, 'Set Authentication to "Forms (Login Page)", choose a username and a strong password, and save.', 'Next to API Key, press the refresh button to make a new key (the old one was exposed), then update the apps that use it.'],
    },
    checks: ['APP-KEY-EXPOSED'],
  };
}

module.exports = { updateHow, servarr };
