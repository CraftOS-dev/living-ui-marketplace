/**
 * Business apps a small organisation self-hosts (plan §2.2, §12). Lab-verified
 * (tests/fixtures/catalogue/):
 *   odoo.json            fresh: /web/database/manager says "Warning, your Odoo database manager is
 *                        not protected" (no master password yet);
 *   odoo_protected.json  master password set: that warning is gone, the page still opens;
 *   odoo_nolist.json     --no-database-list: "The database manager has been disabled by the administrator";
 *   mattermost.json      fresh: /api/v4/config/client says NoAccounts "true" (the first account
 *                        becomes the system admin);
 *   wikijs.json          fresh: every page is "Wiki.js Setup"; wikijs_done.json: "Welcome | Wiki.js";
 *   nginxproxymanager.json  fresh 2.16: /api/ says "setup": false (no user yet);
 *   keycloak.json        fresh: "Local access required" to create the admin (safe by design).
 */
const { updateHow } = require('./_common.js');
const imageOnly = require('./image_only.js').imageOnly;

const NOT_PROTECTED = 'database manager is not protected';
const MGR_DISABLED = 'database manager has been disabled';

const odoo = {
  id: 'odoo',
  version: 2,
  name: 'Odoo',
  category: 'business',
  what: 'your CRM and business apps',
  sources: {
    security: 'https://www.odoo.com/documentation/17.0/administration/on_premise/deploy.html#database-manager-security',
    docker: 'https://hub.docker.com/_/odoo',
    releases: 'https://github.com/odoo/odoo/releases',
    lab: 'tests/fixtures/catalogue/odoo.json',
  },
  recognise: {
    images: ['odoo', 'bitnami/odoo'],
    containerPorts: [8069],
    ports: [8069],
    processes: ['odoo', 'odoo-bin'],
    http: { path: '/web/database/manager', want: 'find', find: [NOT_PROTECTED, MGR_DISABLED], match: (r) => !!(r && r.status === 200 && r.title === 'Odoo') },
  },
  probe: [{ path: '/web/database/manager', want: 'find', find: [NOT_PROTECTED, MGR_DISABLED] }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_plus_private_remote',
  template: 'critical',
  data: { important: ['every Odoo database (from the database manager, or pg_dump) and the filestore (/var/lib/odoo)'], lose: 'your customers, sales, invoices and everything else in Odoo', skip: [] },
  updates: { github: '', advisories: '', how: updateHow('odoo', 'odoo:17') },
  setup: {
    path: '/web/database/manager',
    open: (r) => (!r || !r.status || !r.found ? null : r.status === 200 && !!r.found[NOT_PROTECTED] && !r.found[MGR_DISABLED]),
    becomes: 'the keeper of Odoo’s master password — able to download, copy or delete every database, your whole CRM',
    how: (a, url) => [
      `Open ${url}/web/database/manager now and set a strong master password ("Set Master Password").`,
      'Then hide the page completely: in odoo.conf set list_db = False (or start Odoo with --no-database-list), and restart it.',
    ],
  },
  // Plan §4.2 S7: even with a master password, the database manager is one guessed password from losing everything.
  adminPage: {
    path: '/web/database/manager',
    page: 'the database manager',
    test: (http) => {
      const r = http['/web/database/manager'];
      if (!r || !r.status || !r.found) return null;
      if (r.status !== 200 || r.found[MGR_DISABLED]) return false;
      return !r.found[NOT_PROTECTED]; // no master password yet: the setup check covers it
    },
    power: 'download, copy or delete every Odoo database',
    how: (a) => [
      'In odoo.conf, set list_db = False (or add --no-database-list to the command that starts Odoo).',
      `Restart it: docker compose restart ${a.service}`,
      'Create and back up databases from the command line from now on (odoo -d … / pg_dump).',
    ],
  },
  // v3 M6 (D12): who has an account — an ordinary internal user's API key can list them and ask who is an administrator.
  accounts: {
    kind: 'odoo',
    how: [
      'In Odoo, create a user for NetSentry (Settings → Users → New), type "Internal User", with no other rights.',
      'Sign in as that user → My Profile → Account Security → New API Key, name it "NetSentry". Odoo asks how long it lasts: pick the longest it allows — NetSentry tells you when the key stops working.',
      'Paste it here as  login:key  (for example netsentry@yourcompany.com:3f5c…). If Odoo hides its database list, as  database/login:key.',
      'That user can see who has an account and who is an administrator; it can’t change anything you don’t let internal users change.',
    ],
  },
  checks: ['APP-SETUP-OPEN', 'APP-ADMIN-PAGE-OPEN', 'ACC-ADMIN-COUNT', 'ACC-STALE-USERS'],
};

const MM_KEYS = ['NoAccounts', 'EnableOpenServer', 'EnableUserCreation', 'Version', 'SiteName', 'BuildNumber'];
const mattermost = {
  id: 'mattermost',
  version: 1,
  name: 'Mattermost',
  category: 'chat',
  what: 'your team chat',
  sources: {
    first_admin: 'https://docs.mattermost.com/configure/user-management-configuration-settings.html',
    open_server: 'https://docs.mattermost.com/configure/authentication-configuration-settings.html#enable-open-server',
    releases: 'https://github.com/mattermost/mattermost/releases',
    lab: 'tests/fixtures/catalogue/mattermost.json',
  },
  recognise: {
    images: ['mattermost/mattermost-team-edition', 'mattermost/mattermost-enterprise-edition', 'mattermost/mattermost-preview'],
    containerPorts: [8065],
    ports: [8065],
    processes: ['mattermost'],
    http: { path: '/api/v4/config/client?format=old', want: 'json', keys: MM_KEYS, match: (r) => !!(r && r.json && r.json.BuildNumber && r.json.Version && r.json.NoAccounts !== undefined) },
  },
  probe: [{ path: '/api/v4/config/client?format=old', want: 'json', keys: MM_KEYS }],
  versionFrom: (http) => {
    const r = http['/api/v4/config/client?format=old'];
    return r && r.json && r.json.Version ? String(r.json.Version) : '';
  },
  config: [],
  defaultIntent: 'local_plus_private_remote',
  template: 'internal',
  data: { important: ['its database and the data folder (files people shared)'], lose: 'every message and file shared in it', skip: [] },
  updates: { github: 'mattermost/mattermost', advisories: 'github', how: updateHow('mattermost', 'mattermost/mattermost-team-edition:latest') },
  setup: {
    path: '/api/v4/config/client?format=old',
    open: (r) => (!r || !r.json || r.json.NoAccounts === undefined ? null : r.json.NoAccounts === 'true'),
    becomes: 'the system admin of your Mattermost, with every team and message',
    how: (a, url) => [`Open ${url} now and create your own account first — the first account becomes the system admin.`],
  },
  openSignup: {
    path: '/api/v4/config/client?format=old',
    test: (cfg, http) => {
      const r = http['/api/v4/config/client?format=old'];
      if (!r || !r.json || r.json.EnableOpenServer === undefined) return null;
      if (r.json.NoAccounts === 'true') return false; // the setup check covers it
      return r.json.EnableOpenServer === 'true' && r.json.EnableUserCreation === 'true';
    },
    how: () => ['In the System Console → Authentication → Signup, set "Enable Open Server" to false.', 'Invite people with team invite links instead.'],
  },
  checks: ['APP-SETUP-OPEN', 'APP-OPEN-SIGNUP'],
};

const wikijs = {
  id: 'wikijs',
  version: 1,
  name: 'Wiki.js',
  category: 'wiki',
  what: 'your wiki',
  sources: { install: 'https://docs.requarks.io/install/docker', releases: 'https://github.com/requarks/wiki/releases', lab: 'tests/fixtures/catalogue/wikijs.json' },
  recognise: {
    images: ['ghcr.io/requarks/wiki', 'requarks/wiki', 'lscr.io/linuxserver/wikijs', 'linuxserver/wikijs'],
    containerPorts: [3000],
    ports: [3000],
    processes: [],
    // "Wiki.js Setup" before setup, "Welcome | Wiki.js" after (lab: wikijs.json, wikijs_done.json).
    http: { path: '/', want: 'find', find: [], match: (r) => !!(r && r.status === 200 && /Wiki\.js/.test(r.title || '')) },
  },
  probe: [{ path: '/', want: 'find', find: [] }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_plus_private_remote',
  template: 'internal',
  data: { important: ['its database (every page and its history) and any uploaded files'], lose: 'every page in your wiki', skip: [] },
  updates: { github: 'requarks/wiki', advisories: 'github', how: updateHow('wikijs', 'ghcr.io/requarks/wiki:2') },
  setup: {
    path: '/',
    open: (r) => (!r || !r.status ? null : r.status === 200 && r.title === 'Wiki.js Setup'),
    becomes: 'the administrator of your wiki',
    how: (a, url) => [`Open ${url} now and finish the setup: create the administrator with a strong, unique password.`],
  },
  checks: ['APP-SETUP-OPEN'],
};

const npm = {
  id: 'nginxproxymanager',
  version: 1,
  name: 'Nginx Proxy Manager',
  category: 'infra',
  what: 'the proxy that sends web traffic to your apps',
  sources: { setup: 'https://nginxproxymanager.com/setup/', releases: 'https://github.com/NginxProxyManager/nginx-proxy-manager/releases', lab: 'tests/fixtures/catalogue/nginxproxymanager.json' },
  recognise: {
    images: ['jc21/nginx-proxy-manager'],
    containerPorts: [80, 443, 81],
    webPorts: [81],
    ports: [81],
    processes: [],
    http: { path: '/api/', want: 'json', match: (r) => !!(r && r.json && r.json.status === 'OK' && typeof r.json.setup === 'boolean') },
  },
  probe: [{ path: '/api/', want: 'json' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_network',
  template: 'admin_tool',
  data: { important: ['the /data volume (its database and settings) and /etc/letsencrypt (certificates)'], lose: 'every proxy host, certificate and access list', skip: [] },
  updates: { github: 'NginxProxyManager/nginx-proxy-manager', advisories: 'github', how: updateHow('nginx-proxy-manager', 'jc21/nginx-proxy-manager:latest') },
  setup: {
    path: '/api/',
    open: (r) => (!r || !r.json || typeof r.json.setup !== 'boolean' ? null : r.json.setup === false),
    becomes: 'the administrator of every site it publishes',
    how: (a, url) => [`Open ${url} now and create the administrator with a strong, unique password.`],
  },
  checks: ['APP-SETUP-OPEN'],
};

const keycloak = {
  id: 'keycloak',
  version: 1,
  name: 'Keycloak',
  category: 'identity',
  what: 'your single sign-on',
  sources: { bootstrap: 'https://www.keycloak.org/server/bootstrap-admin-recovery', releases: 'https://github.com/keycloak/keycloak/releases', lab: 'tests/fixtures/catalogue/keycloak.json' },
  recognise: {
    images: ['quay.io/keycloak/keycloak', 'keycloak/keycloak', 'bitnami/keycloak'],
    containerPorts: [8080, 8443],
    webPorts: [8080],
    ports: [8080, 8443],
    processes: [],
    http: { path: '/realms/master', want: 'json', match: (r) => !!(r && r.json && r.json.realm === 'master' && r.json['token-service']) },
  },
  probe: [{ path: '/realms/master', want: 'json' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'local_plus_private_remote',
  template: 'internal',
  data: { important: ['its database (realms, users and their settings)'], lose: 'every user, login setting and connected app', skip: [] },
  updates: { github: 'keycloak/keycloak', advisories: 'github', how: updateHow('keycloak', 'quay.io/keycloak/keycloak:latest') },
  checks: [],
};

module.exports = [
  odoo,
  mattermost,
  wikijs,
  npm,
  keycloak,
  imageOnly({
    id: 'bookstack', name: 'BookStack', category: 'wiki', what: 'your documentation wiki', ports: [80, 6875], repo: 'BookStackApp/BookStack',
    images: ['lscr.io/linuxserver/bookstack', 'linuxserver/bookstack', 'solidnerd/bookstack'], intent: 'local_plus_private_remote',
    important: ['its database and the uploads folder'], lose: 'every page, book and image in it',
    sources: { docker: 'https://docs.linuxserver.io/images/docker-bookstack/', backups: 'https://www.bookstackapp.com/docs/admin/backup-restore/', releases: 'https://github.com/BookStackApp/BookStack/releases' },
  }),
  imageOnly({
    id: 'suitecrm', name: 'SuiteCRM', category: 'business', what: 'your CRM', ports: [8080, 8443], repo: 'salesagility/SuiteCRM-Core',
    images: ['bitnami/suitecrm'], intent: 'local_plus_private_remote',
    important: ['its database and the upload folder'], lose: 'your customers, deals and history',
    sources: { docker: 'https://hub.docker.com/r/bitnami/suitecrm', releases: 'https://github.com/salesagility/SuiteCRM-Core/releases' },
  }),
  imageOnly({
    id: 'espocrm', name: 'EspoCRM', category: 'business', what: 'your CRM', ports: [80], repo: 'espocrm/espocrm',
    images: ['espocrm/espocrm'], intent: 'local_plus_private_remote',
    important: ['its database and the data folder'], lose: 'your customers, deals and history',
    sources: { docker: 'https://docs.espocrm.com/administration/docker/installation/', releases: 'https://github.com/espocrm/espocrm/releases' },
  }),
  imageOnly({
    id: 'twenty', name: 'Twenty', category: 'business', what: 'your CRM', ports: [3000], repo: 'twentyhq/twenty',
    images: ['twentycrm/twenty'], intent: 'local_plus_private_remote',
    important: ['its Postgres database'], lose: 'your customers, deals and history',
    sources: { docker: 'https://twenty.com/developers/section/self-hosting/docker-compose', releases: 'https://github.com/twentyhq/twenty/releases' },
  }),
  imageOnly({
    id: 'rocketchat', name: 'Rocket.Chat', category: 'chat', what: 'your team chat', ports: [3000], repo: 'RocketChat/Rocket.Chat',
    images: ['rocket.chat', 'rocketchat/rocket.chat', 'registry.rocket.chat/rocketchat/rocket.chat'], intent: 'local_plus_private_remote',
    important: ['its MongoDB database and uploads'], lose: 'every message and file shared in it',
    sources: { docker: 'https://docs.rocket.chat/docs/deploy-with-docker-docker-compose', releases: 'https://github.com/RocketChat/Rocket.Chat/releases' },
  }),
  imageOnly({
    id: 'gitlab', name: 'GitLab', category: 'dev', what: 'your code repositories', ports: [80, 443, 22], repo: '',
    images: ['gitlab/gitlab-ce', 'gitlab/gitlab-ee'], intent: 'local_plus_private_remote',
    important: ['a GitLab backup (gitlab-backup create) plus /etc/gitlab (its secrets)'], lose: 'every repository, issue and account',
    sources: { docker: 'https://docs.gitlab.com/install/docker/', backups: 'https://docs.gitlab.com/administration/backup_restore/', releases: 'https://about.gitlab.com/releases/categories/releases/' },
  }),
];
