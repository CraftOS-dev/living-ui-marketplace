/**
 * Gitea and Forgejo (Forgejo is a fork of Gitea: same pages, same answers).
 * Lab-verified (tests/fixtures/catalogue/):
 *   gitea.json / forgejo.json               a fresh start shows "Installation - …" at / to anyone;
 *   gitea_installed.json / forgejo_installed installed without an admin: /user/sign_up says
 *                                            "You are registering the first account in the system,
 *                                            which has administrator privileges", with an open form;
 *   gitea_closed.json                        DISABLE_REGISTRATION=true: the page still carries the form and
 *                                            the first-account line, but says "Registration is disabled".
 *   Forgejo does not print the first-account line (forgejo_installed.json): its first-account
 *   risk shows as open sign-ups instead.
 */
const { updateHow } = require('./_common.js');

const FIRST = 'You are registering the first account';
const FORM = 'action="/user/sign_up"';
const DISABLED = 'Registration is disabled';

function forge(o) {
  const env = o.envPrefix;
  return {
    id: o.id,
    version: 1,
    name: o.name,
    category: 'dev',
    what: 'your code repositories',
    sources: Object.assign({ lab: `tests/fixtures/catalogue/${o.id}.json` }, o.sources),
    recognise: {
      images: o.images,
      containerPorts: [3000, 22],
      webPorts: [3000],
      ports: [3000],
      processes: [o.id],
      // The page title names the app on every page, installed or not (lab).
      http: { path: '/', want: 'find', find: [], match: (r) => !!(r && r.status === 200 && (r.title || '').indexOf(o.titleWord) >= 0) },
    },
    probe: [
      { path: '/', want: 'find', find: [] },
      { path: '/api/v1/version', want: 'json' },
      { path: '/user/sign_up', want: 'find', find: [FIRST, FORM, DISABLED] },
    ],
    versionFrom: (http) => {
      const r = http['/api/v1/version'];
      return r && r.json && r.json.version ? String(r.json.version) : '';
    },
    config: [],
    defaultIntent: 'local_plus_private_remote',
    template: 'internal',
    data: { important: ['the /data folder: repositories, the database and app.ini'], lose: 'every repository, issue and account', skip: [] },
    updates: { github: o.github, advisories: o.github ? 'github' : '', how: updateHow(o.id, `${o.images[0]}:latest`) },
    setup: {
      paths: ['/', '/user/sign_up'],
      test: (http) => {
        const home = http['/'];
        if (home && home.status === 200 && /^Installation\b/.test(home.title || '')) return true;
        const su = http['/user/sign_up'];
        if (su && su.found) return !!su.found[FIRST] && !su.found[DISABLED];
        return home && home.status ? false : null;
      },
      said: (http) =>
        http['/'] && /^Installation\b/.test(http['/'].title || '')
          ? `${o.name} shows its installation page to anyone who opens it.`
          : `${o.name} says the first account to register becomes its administrator — and none exists yet.`,
      becomes: `the administrator of ${o.name}, with every repository and account in it`,
      how: (a, url) => [
        `Open ${url} now. If it shows the installation page, open "Administrator Account Settings", create the admin account there, and tick "Disable self-registration".`,
        `If it is already installed, register your own account first at ${url}/user/sign_up — the first account becomes the administrator.`,
      ],
    },
    openSignup: {
      path: '/user/sign_up',
      test: (cfg, http) => {
        const r = http['/user/sign_up'];
        if (!r || !r.status) return null;
        if (r.status !== 200 || !r.found) return false;
        if (r.found[DISABLED]) return false;
        // Before the first account exists, the setup check covers it.
        return r.found[FIRST] ? false : !!r.found[FORM];
      },
      how: (a) => [
        `In docker-compose.yml, add ${env}__service__DISABLE_REGISTRATION=true to ${o.name}'s environment (or DISABLE_REGISTRATION = true under [service] in app.ini).`,
        `Run: docker compose up -d ${a.service}`,
        'Then add people yourself from Site Administration → User Accounts.',
      ],
    },
    // D12 (organisations): who has an account and who is an administrator, with a read-only token
    // (lab: gitea_admin_users.json — a read:admin token lists accounts and is refused any change).
    accounts: {
      kind: o.id,
      how: [
        'Sign in as an administrator and open Settings → Applications.',
        'Under "Manage Access Tokens", name it "NetSentry", choose "Select permissions" and set only "admin" to Read. Leave everything else as No Access.',
        'Press "Generate Token" and paste the token here. It can list accounts but can’t change anything.',
      ],
    },
    checks: ['APP-SETUP-OPEN', 'APP-OPEN-SIGNUP', 'ACC-ADMIN-COUNT', 'ACC-STALE-USERS'],
  };
}

module.exports = [
  forge({
    id: 'gitea',
    name: 'Gitea',
    titleWord: 'Gitea',
    envPrefix: 'GITEA',
    images: ['gitea/gitea', 'docker.gitea.com/gitea'],
    github: 'go-gitea/gitea',
    sources: {
      install: 'https://docs.gitea.com/installation/install-with-docker',
      config: 'https://docs.gitea.com/administration/config-cheat-sheet#service-service',
      releases: 'https://github.com/go-gitea/gitea/releases',
    },
  }),
  forge({
    id: 'forgejo',
    name: 'Forgejo',
    titleWord: 'Forgejo',
    envPrefix: 'FORGEJO',
    images: ['codeberg.org/forgejo/forgejo'],
    // Releases are on Codeberg, not GitHub: NetSentry has no update feed for it yet (no update check).
    github: '',
    sources: {
      install: 'https://forgejo.org/docs/latest/admin/installation-docker/',
      config: 'https://forgejo.org/docs/latest/admin/config-cheat-sheet/#service-service',
      releases: 'https://codeberg.org/forgejo/forgejo/releases',
    },
  }),
];
