/**
 * Install an app, secure by default (v3 plan §12) — pure.
 *
 * Each template renders a Compose project as DATA (never YAML text): the
 * machine's monitor checks it against its own rules (allowed images per
 * template, no privileged containers, folders only inside the app's own
 * folder or ones a person chose), writes compose.yaml itself, and generates
 * every password ON the machine — `${NAME}` in the spec refers to its .env.
 *
 * What every template does the same way:
 *   - one folder per app (default /srv/apps/<name>; on Unraid /mnt/user/appdata)
 *   - the app runs as an ordinary user (PUID/PGID), never root
 *   - ports published on ONE address: the machine's own (people at home) or
 *     127.0.0.1 (only this machine) — never every address, never the router
 *   - container logs capped (20 MB × 3)
 *   - restart unless-stopped; a health check where the image doesn't have one
 *   - first-time setup link shown until NetSentry sees setup finished
 */

const LOGS = { driver: 'json-file', options: { 'max-size': '20m', 'max-file': '3' } };

function ports(bind, list) {
  return list.map(([host, container, proto]) => `${bind}:${host}:${container}${proto === 'udp' ? '/udp' : ''}`);
}

function base(o, svc) {
  return Object.assign({ restart: 'unless-stopped', logging: LOGS }, svc);
}

const LS = (o) => ({ PUID: String(o.puid), PGID: String(o.pgid), TZ: o.tz });
const curlHealth = (port, path) => ({ test: ['CMD-SHELL', `curl -fsS http://localhost:${port}${path} >/dev/null || exit 1`], interval: '30s', timeout: '10s', retries: 5, start_period: '60s' });

/**
 * id → { name, category, port (host default), image: { repo, tag: 'newest-x.y.z' | fixed }, needs: ['data_root'?],
 *        render(o) → { services, volumes?, secrets: [...], dirs: [{ path, owner }], files: [{ path, content }], primary, setup, notes } }
 * o = { project, bind, port, puid, pgid, tz, data_root, tags: { [repo]: tag } }
 */
const TEMPLATES = {
  jellyfin: {
    name: 'Jellyfin', category: 'media', port: 8096, images: { 'jellyfin/jellyfin': 'newest-3' }, needs: ['data_root'], catalogue: 'jellyfin',
    render: (o) => ({
      services: {
        jellyfin: base(o, {
          image: `jellyfin/jellyfin:${o.tags['jellyfin/jellyfin']}`, user: `${o.puid}:${o.pgid}`,
          volumes: ['./config:/config', './cache:/cache', `${o.data_root}:/media:ro`], ports: ports(o.bind, [[o.port, 8096]]), environment: { TZ: o.tz },
        }),
      },
      dirs: [{ path: 'config', owner: `${o.puid}:${o.pgid}` }, { path: 'cache', owner: `${o.puid}:${o.pgid}` }],
      primary: 'jellyfin', setup: '/web/', // opens its setup wizard by itself until setup is done (10.x and 12.x)
    }),
  },
  plex: {
    name: 'Plex', category: 'media', port: 32400, images: { 'lscr.io/linuxserver/plex': 'latest' }, needs: ['data_root'], catalogue: 'plex', hostNetwork: true,
    render: (o) => ({
      services: { plex: base(o, { image: `lscr.io/linuxserver/plex:${o.tags['lscr.io/linuxserver/plex']}`, network_mode: 'host', environment: Object.assign(LS(o), { VERSION: 'docker' }), volumes: ['./config:/config', `${o.data_root}:/media:ro`] }) },
      dirs: [{ path: 'config', owner: `${o.puid}:${o.pgid}` }], primary: 'plex', setup: '/web/index.html',
      notes: ['Plex shares your network so phones and TVs at home can find it (that is how Plex works).'],
    }),
  },
  sonarr: arr('sonarr', 'Sonarr', 8989, 'tv'),
  radarr: arr('radarr', 'Radarr', 7878, 'movies'),
  prowlarr: {
    name: 'Prowlarr', category: 'downloads', port: 9696, images: { 'lscr.io/linuxserver/prowlarr': 'latest' }, needs: [], catalogue: 'prowlarr',
    render: (o) => ({
      services: { prowlarr: base(o, { image: `lscr.io/linuxserver/prowlarr:${o.tags['lscr.io/linuxserver/prowlarr']}`, environment: LS(o), volumes: ['./config:/config'], ports: ports(o.bind, [[o.port, 9696]]), healthcheck: curlHealth(9696, '/ping') }) },
      dirs: [{ path: 'config', owner: `${o.puid}:${o.pgid}` }], primary: 'prowlarr', setup: '/',
    }),
  },
  qbittorrent: {
    name: 'qBittorrent', category: 'downloads', port: 8080, images: { 'lscr.io/linuxserver/qbittorrent': 'latest' }, needs: ['data_root'], catalogue: 'qbittorrent',
    render: (o) => ({
      services: {
        qbittorrent: base(o, {
          image: `lscr.io/linuxserver/qbittorrent:${o.tags['lscr.io/linuxserver/qbittorrent']}`, environment: Object.assign(LS(o), { WEBUI_PORT: '8080', TORRENTING_PORT: '6881' }),
          volumes: ['./config:/config', `${o.data_root}/torrents:/data/torrents`], ports: ports(o.bind, [[o.port, 8080], [6881, 6881], [6881, 6881, 'udp']]),
        }),
      },
      dirs: [{ path: 'config', owner: `${o.puid}:${o.pgid}` }], primary: 'qbittorrent', setup: '/',
      notes: ['Its first password is printed in its log once: open qBittorrent → Logs in NetSentry, then change it in qBittorrent.'],
    }),
  },
  homeassistant: {
    name: 'Home Assistant', category: 'home', port: 8123, images: { 'ghcr.io/home-assistant/home-assistant': 'stable' }, needs: [], catalogue: 'homeassistant', hostNetwork: true,
    render: (o) => ({
      services: { homeassistant: base(o, { image: `ghcr.io/home-assistant/home-assistant:${o.tags['ghcr.io/home-assistant/home-assistant']}`, network_mode: 'host', environment: { TZ: o.tz }, volumes: ['./config:/config'] }) },
      dirs: [{ path: 'config', owner: '0:0' }], primary: 'homeassistant', setup: '/onboarding.html',
      notes: ['Home Assistant shares your network so it can find devices at home (that is how it works).'],
    }),
  },
  immich: {
    name: 'Immich', category: 'photos', port: 2283, catalogue: 'immich', needs: ['data_root'],
    // Mirrors Immich's own release compose (github.com/immich-app/immich/releases/latest/download/docker-compose.yml, v3, 2026-10-01).
    images: {
      'ghcr.io/immich-app/immich-server': 'v3', 'ghcr.io/immich-app/immich-machine-learning': 'v3',
      'docker.io/valkey/valkey': '9@sha256:70739f85ad2ee01a726a965584a0f94895f01b0c60b3cc8b0aeef11eaa6888cf',
      'ghcr.io/immich-app/postgres': '14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23',
    },
    render: (o) => {
      const t = (r) => `${r}:${o.tags[r]}`;
      return {
        services: {
          // The time zone comes from TZ in .env, not /etc/localtime (minimal systems and NAS boxes may not have that file).
          'immich-server': base(o, { image: t('ghcr.io/immich-app/immich-server'), volumes: [`${o.data_root}:/data`], env_file: ['.env'], ports: ports(o.bind, [[o.port, 2283]]), depends_on: ['redis', 'database'] }),
          'immich-machine-learning': base(o, { image: t('ghcr.io/immich-app/immich-machine-learning'), volumes: ['model-cache:/cache'], env_file: ['.env'] }),
          redis: base(o, { image: t('docker.io/valkey/valkey'), healthcheck: { test: ['CMD-SHELL', 'redis-cli ping | grep -q PONG || exit 1'] } }),
          database: base(o, {
            image: t('ghcr.io/immich-app/postgres'), shm_size: '128mb', volumes: ['./postgres:/var/lib/postgresql/data'],
            environment: { POSTGRES_PASSWORD: '${DB_PASSWORD}', POSTGRES_USER: 'postgres', POSTGRES_DB: 'immich', POSTGRES_INITDB_ARGS: '--data-checksums' },
          }),
        },
        volumes: { 'model-cache': {} },
        secrets: ['DB_PASSWORD'],
        files: [{ path: '.env', content: 'DB_PASSWORD=${DB_PASSWORD}\nDB_USERNAME=postgres\nDB_DATABASE_NAME=immich\nDB_HOSTNAME=database\nREDIS_HOSTNAME=redis\nTZ=' + o.tz + '\n', append_secrets: true }],
        dirs: [{ path: 'postgres', owner: '' }], primary: 'immich-server', setup: '/auth/register',
      };
    },
  },
  vaultwarden: {
    name: 'Vaultwarden', category: 'passwords', port: 8222, images: { 'vaultwarden/server': 'newest-3' }, needs: [], catalogue: 'vaultwarden',
    render: (o) => ({
      services: { vaultwarden: base(o, { image: `vaultwarden/server:${o.tags['vaultwarden/server']}`, environment: { SIGNUPS_ALLOWED: 'true', TZ: o.tz }, volumes: ['./data:/data'], ports: ports(o.bind, [[o.port, 80]]) }) },
      dirs: [{ path: 'data', owner: '' }], primary: 'vaultwarden', setup: '/#/register',
      notes: ['Create your account, then switch sign-ups off (NetSentry reminds you until you do).', 'Browsers only allow the web vault over https or on this server itself: use it through Tailscale or Cloudflare Tunnel (the app → Use it from away, safely).'],
    }),
  },
  nextcloud: {
    name: 'Nextcloud', category: 'files', port: 8081, images: { nextcloud: 'newest-major-apache', postgres: '16', redis: '7' }, needs: [], catalogue: 'nextcloud',
    render: (o) => ({
      services: {
        nextcloud: base(o, {
          image: `nextcloud:${o.tags.nextcloud}`, depends_on: ['db', 'redis'], volumes: ['./html:/var/www/html'], ports: ports(o.bind, [[o.port, 80]]),
          environment: { POSTGRES_HOST: 'db', POSTGRES_DB: 'nextcloud', POSTGRES_USER: 'nextcloud', POSTGRES_PASSWORD: '${DB_PASSWORD}', REDIS_HOST: 'redis', NEXTCLOUD_TRUSTED_DOMAINS: `${o.bind} localhost`, TZ: o.tz },
        }),
        db: base(o, { image: `postgres:${o.tags.postgres}`, volumes: ['./db:/var/lib/postgresql/data'], environment: { POSTGRES_DB: 'nextcloud', POSTGRES_USER: 'nextcloud', POSTGRES_PASSWORD: '${DB_PASSWORD}' } }),
        redis: base(o, { image: `redis:${o.tags.redis}` }),
      },
      secrets: ['DB_PASSWORD'], dirs: [{ path: 'html', owner: '33:33' }, { path: 'db', owner: '' }], primary: 'nextcloud', setup: '/',
    }),
  },
  uptimekuma: {
    name: 'Uptime Kuma', category: 'monitoring', port: 3001, images: { 'louislam/uptime-kuma': '1' }, needs: [], catalogue: 'uptimekuma',
    render: (o) => ({
      services: { 'uptime-kuma': base(o, { image: `louislam/uptime-kuma:${o.tags['louislam/uptime-kuma']}`, volumes: ['./data:/app/data'], ports: ports(o.bind, [[o.port, 3001]]) }) },
      dirs: [{ path: 'data', owner: '' }], primary: 'uptime-kuma', setup: '/setup',
    }),
  },
  odoo: {
    name: 'Odoo', category: 'business', port: 8069, images: { odoo: '18', postgres: '16' }, needs: [], catalogue: 'odoo',
    render: (o) => ({
      services: {
        odoo: base(o, {
          image: `odoo:${o.tags.odoo}`, depends_on: ['db'], ports: ports(o.bind, [[o.port, 8069]]), volumes: ['./odoo-data:/var/lib/odoo', './config:/etc/odoo'],
          environment: { HOST: 'db', USER: 'odoo', PASSWORD: '${DB_PASSWORD}' },
        }),
        db: base(o, { image: `postgres:${o.tags.postgres}`, volumes: ['./db:/var/lib/postgresql/data'], environment: { POSTGRES_DB: 'postgres', POSTGRES_USER: 'odoo', POSTGRES_PASSWORD: '${DB_PASSWORD}' } }),
      },
      secrets: ['DB_PASSWORD', 'MASTER_PASSWORD'],
      // The database manager is protected by a long password generated on the machine (never "admin").
      // Replacing the image's odoo.conf keeps its addons_path and data_dir (without data_dir Odoo can't keep a session).
      files: [{ path: 'config/odoo.conf', content: '[options]\naddons_path = /mnt/extra-addons\ndata_dir = /var/lib/odoo\nadmin_passwd = ${MASTER_PASSWORD}\nproxy_mode = False\n' }],
      // the image's odoo user is 100, group 101 (odoo:18, checked 2026-10-01)
      dirs: [{ path: 'odoo-data', owner: '100:101' }, { path: 'config', owner: '100:101' }, { path: 'db', owner: '' }], primary: 'odoo', setup: '/web/database/manager',
      notes: ['Create your database at the setup link with the master password from the .env file in its folder (MASTER_PASSWORD).'],
    }),
  },
  gitea: {
    name: 'Gitea', category: 'code', port: 3000, images: { 'gitea/gitea': 'newest-3' }, needs: [], catalogue: 'gitea',
    render: (o) => ({
      services: {
        gitea: base(o, {
          image: `gitea/gitea:${o.tags['gitea/gitea']}`, ports: ports(o.bind, [[o.port, 3000], [2222, 22]]), volumes: ['./data:/data'],
          environment: { USER_UID: String(o.puid), USER_GID: String(o.pgid), TZ: o.tz, GITEA__service__DISABLE_REGISTRATION: 'true', GITEA__server__ROOT_URL: `http://${o.bind}:${o.port}/` },
        }),
      },
      dirs: [{ path: 'data', owner: `${o.puid}:${o.pgid}` }], primary: 'gitea', setup: '/',
      notes: ['Finish the setup page now — the first account you create there is the administrator; nobody else can sign up.'],
    }),
  },
  wikijs: {
    name: 'Wiki.js', category: 'docs', port: 3002, images: { 'ghcr.io/requarks/wiki': '2' }, needs: [], catalogue: 'wikijs',
    render: (o) => ({
      services: { wikijs: base(o, { image: `ghcr.io/requarks/wiki:${o.tags['ghcr.io/requarks/wiki']}`, environment: { DB_TYPE: 'sqlite', DB_FILEPATH: '/wiki/data/wiki.sqlite' }, volumes: ['./data:/wiki/data'], ports: ports(o.bind, [[o.port, 3000]]) }) },
      dirs: [{ path: 'data', owner: '1000:1000' }], primary: 'wikijs', setup: '/',
    }),
  },
  mattermost: {
    name: 'Mattermost', category: 'chat', port: 8065, images: { 'mattermost/mattermost-team-edition': 'newest-3', postgres: '16' }, needs: [], catalogue: 'mattermost',
    render: (o) => ({
      services: {
        mattermost: base(o, {
          image: `mattermost/mattermost-team-edition:${o.tags['mattermost/mattermost-team-edition']}`, depends_on: ['db'], ports: ports(o.bind, [[o.port, 8065]]),
          volumes: ['./config:/mattermost/config', './data:/mattermost/data', './logs:/mattermost/logs', './plugins:/mattermost/plugins', './client-plugins:/mattermost/client/plugins'],
          environment: {
            MM_SQLSETTINGS_DRIVERNAME: 'postgres', MM_SQLSETTINGS_DATASOURCE: 'postgres://mmuser:${DB_PASSWORD}@db:5432/mattermost?sslmode=disable&connect_timeout=10',
            MM_SERVICESETTINGS_SITEURL: `http://${o.bind}:${o.port}`, TZ: o.tz,
          },
        }),
        db: base(o, { image: `postgres:${o.tags.postgres}`, volumes: ['./db:/var/lib/postgresql/data'], environment: { POSTGRES_DB: 'mattermost', POSTGRES_USER: 'mmuser', POSTGRES_PASSWORD: '${DB_PASSWORD}' } }),
      },
      secrets: ['DB_PASSWORD'],
      dirs: ['config', 'data', 'logs', 'plugins', 'client-plugins'].map((p) => ({ path: p, owner: '2000:2000' })).concat([{ path: 'db', owner: '' }]),
      primary: 'mattermost', setup: '/signup_user_complete',
    }),
  },
};

function arr(id, name, port, media) {
  return {
    name, category: 'downloads', port, images: { [`lscr.io/linuxserver/${id}`]: 'latest' }, needs: ['data_root'], catalogue: id,
    render: (o) => ({
      services: {
        [id]: base(o, {
          image: `lscr.io/linuxserver/${id}:${o.tags[`lscr.io/linuxserver/${id}`]}`, environment: LS(o),
          // One shared /data (downloads + media) so moving a finished download is instant (hard links), not a copy.
          volumes: ['./config:/config', `${o.data_root}:/data`], ports: ports(o.bind, [[o.port, port]]), healthcheck: curlHealth(port, '/ping'),
        }),
      },
      dirs: [{ path: 'config', owner: `${o.puid}:${o.pgid}` }], primary: id, setup: '/',
      notes: [`Point it at /data/media/${media} for the library and /data/torrents for downloads (both inside the data folder you chose).`],
    }),
  };
}

/**
 * The newest release tag with `parts` numbers (no pre-releases, no flavours), or null. A release
 * tagged with fewer numbers plus a build stamp ("12.1.20260915-010956") counts too.
 */
function newestRelease(tags, parts, suffix) {
  const images = require('./images.js');
  let best = null;
  for (const t of tags || []) {
    if (/(alpha|beta|rc|dev|nightly|unstable|preview|test)/i.test(t)) continue;
    const v = images.versionOf(t);
    if (!v || v.prefix || (suffix ? v.suffix !== suffix : v.suffix)) continue;
    if (v.build ? v.nums.length > parts || v.nums.length < 2 : v.nums.length !== parts) continue;
    if (!best || images.compareVersions(v, best.v) > 0) best = { tag: t, v };
  }
  return best ? best.tag : null;
}

module.exports = { TEMPLATES, newestRelease, LOGS };
