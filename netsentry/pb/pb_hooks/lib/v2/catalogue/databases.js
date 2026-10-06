/**
 * Databases and caches — behind-the-scenes services that normally only the
 * machine (or its containers) should reach (organisations, plan §12.2
 * "behind-the-scenes service"). NetSentry never signs in to them (D8): it asks
 * only what they say before any login. Lab-verified (tests/fixtures/catalogue/):
 *   postgres.json            says nothing first; answers the SSL question ("N" or "S") before any login;
 *   mariadb.json             greets with its version ("11.8.9-MariaDB…");
 *   redis.json               official image: PING → +PONG with no password;
 *   redis_auth.json          with requirepass: PING → -NOAUTH;
 *   mongo.json               an HTTP question on its port gets "…access MongoDB over HTTP…";
 *   elasticsearch.json       8.x default: TLS + a login (401 over https);
 *   elasticsearch_open.json  xpack.security.enabled=false: answers everything to anyone.
 */
const { updateHow } = require('./_common.js');

const SSL_QUESTION = 'hex:0000000804d2162f';

function tcpFirst(http) {
  const r = http['/tcp'];
  return r && r.status === 'open' ? String(r.banner || '') : null;
}

const postgres = {
  id: 'postgres',
  version: 1,
  name: 'PostgreSQL',
  category: 'database',
  what: 'a database',
  sources: { docker: 'https://hub.docker.com/_/postgres', protocol: 'https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-SSL', releases: 'https://www.postgresql.org/support/versioning/', lab: 'tests/fixtures/catalogue/postgres.json' },
  recognise: {
    images: ['postgres', 'bitnami/postgresql', 'postgis/postgis', 'timescale/timescaledb'],
    containerPorts: [5432],
    ports: [5432],
    processes: ['postgres'],
    http: { path: '/tcp', want: 'tcp', send: SSL_QUESTION, match: (r) => !!(r && r.status === 'open' && (r.banner === 'N' || r.banner === 'S')) },
  },
  probe: [{ path: '/tcp', want: 'tcp', send: SSL_QUESTION }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'this_machine',
  template: 'backend',
  data: { important: ['a dump of every database (pg_dumpall), or the data folder while it is stopped'], lose: 'everything stored in it', skip: [] },
  updates: { github: '', advisories: '', how: updateHow('postgres', 'postgres:16') },
  checks: [],
};

const mariadb = {
  id: 'mariadb',
  version: 1,
  name: 'MariaDB / MySQL',
  category: 'database',
  what: 'a database',
  sources: { docker: 'https://hub.docker.com/_/mariadb', mysql: 'https://hub.docker.com/_/mysql', releases: 'https://mariadb.org/mariadb/all-releases/', lab: 'tests/fixtures/catalogue/mariadb.json' },
  recognise: {
    images: ['mariadb', 'mysql', 'bitnami/mariadb', 'bitnami/mysql', 'lscr.io/linuxserver/mariadb', 'linuxserver/mariadb'],
    containerPorts: [3306],
    ports: [3306],
    processes: ['mariadbd', 'mysqld'],
    // The server greets first with its version and how it wants people to sign in.
    http: { path: '/tcp', want: 'tcp', send: '', match: (r) => !!(r && r.status === 'open' && /(mysql_native_password|caching_sha2_password)/.test(r.banner || '')) },
  },
  probe: [{ path: '/tcp', want: 'tcp', send: '' }],
  versionFrom: (http) => {
    const m = /(\d+\.\d+\.\d+)(-MariaDB)?/.exec(tcpFirst(http) || '');
    return m ? m[1] : '';
  },
  config: [],
  defaultIntent: 'this_machine',
  template: 'backend',
  data: { important: ['a dump of every database (mariadb-dump --all-databases)'], lose: 'everything stored in it', skip: [] },
  updates: { github: '', advisories: '', how: updateHow('mariadb', 'mariadb:11') },
  checks: [],
};

const redis = {
  id: 'redis',
  version: 1,
  name: 'Redis',
  category: 'database',
  what: 'a fast in-memory store',
  sources: { docker: 'https://hub.docker.com/_/redis', security: 'https://redis.io/docs/latest/operate/oss_and_stack/management/security/', lab: 'tests/fixtures/catalogue/redis.json' },
  recognise: {
    images: ['redis', 'bitnami/redis', 'redis/redis-stack-server', 'valkey/valkey'],
    containerPorts: [6379],
    ports: [6379],
    processes: ['redis-server', 'valkey-server'],
    http: { path: '/tcp', want: 'tcp', send: 'PING', match: (r) => !!(r && r.status === 'open' && /^(\+PONG|-NOAUTH)/.test(r.banner || '')) },
  },
  probe: [{ path: '/tcp', want: 'tcp', send: 'PING' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'this_machine',
  template: 'backend',
  data: { important: ['its dump file (dump.rdb / appendonly) if you keep data in it'], lose: 'whatever is stored in it (often only a cache)', skip: [] },
  updates: { github: 'redis/redis', advisories: 'github', how: updateHow('redis', 'redis:7') },
  // The official image has no password: anyone who reaches the port can read and change everything.
  noPassword: {
    path: '/tcp',
    test: (http) => {
      const b = tcpFirst(http);
      return b === null ? null : /^\+PONG/.test(b) ? true : /^-NOAUTH/.test(b) ? false : null;
    },
    power: 'read, change or wipe everything stored in it',
    how: (a) => [
      `Best: don't publish its port at all — remove the "ports:" lines for ${a.service} in docker-compose.yml; the apps that use it reach it over the Docker network.`,
      'Also give it a password: add command: redis-server --requirepass <a long random password>, and put the same password in the apps that use it.',
      `Run: docker compose up -d ${a.service}`,
    ],
  },
  checks: ['APP-NO-PASSWORD'],
};

const mongo = {
  id: 'mongo',
  version: 1,
  name: 'MongoDB',
  category: 'database',
  what: 'a document database',
  sources: { docker: 'https://hub.docker.com/_/mongo', security: 'https://www.mongodb.com/docs/manual/administration/security-checklist/', lab: 'tests/fixtures/catalogue/mongo.json' },
  recognise: {
    images: ['mongo', 'bitnami/mongodb', 'mongodb/mongodb-community-server'],
    containerPorts: [27017],
    ports: [27017],
    processes: ['mongod'],
    http: { path: '/', want: 'text', match: (r) => !!(r && /access MongoDB over HTTP/.test(r.text || '')) },
  },
  probe: [{ path: '/', want: 'text' }],
  versionFrom: () => '',
  config: [],
  defaultIntent: 'this_machine',
  template: 'backend',
  data: { important: ['a dump of every database (mongodump)'], lose: 'everything stored in it', skip: [] },
  updates: { github: '', advisories: '', how: updateHow('mongo', 'mongo:7') },
  checks: [],
};

const elasticsearch = {
  id: 'elasticsearch',
  version: 1,
  name: 'Elasticsearch',
  category: 'database',
  what: 'a search database',
  sources: {
    security: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/security-minimal-setup.html',
    docker: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/docker.html',
    releases: 'https://github.com/elastic/elasticsearch/releases',
    lab: 'tests/fixtures/catalogue/elasticsearch_open.json',
  },
  recognise: {
    images: ['docker.elastic.co/elasticsearch/elasticsearch', 'elasticsearch', 'bitnami/elasticsearch'],
    containerPorts: [9200],
    ports: [9200],
    processes: [],
    // Its own greeting (security off), or a login demand from its "security" realm (default).
    http: {
      path: '/',
      want: 'json',
      keys: ['cluster_name', 'tagline', 'version.number'],
      match: (r) => !!(r && r.json && r.json.tagline === 'You Know, for Search'),
    },
    // With security on (the default) it only speaks TLS and asks for a login.
    also: [{ path: '/_security/_authenticate', want: 'status', tls: true, match: (r) => !!(r && r.status === 401) }],
  },
  probe: [
    { path: '/', want: 'json', keys: ['cluster_name', 'tagline', 'version.number'] },
    { path: '/_security/_authenticate', want: 'status', tls: true },
  ],
  versionFrom: (http) => {
    const r = http['/'];
    return r && r.json && r.json['version.number'] ? String(r.json['version.number']) : '';
  },
  config: [],
  defaultIntent: 'this_machine',
  template: 'backend',
  data: { important: ['a snapshot repository with every index (Elasticsearch snapshots)'], lose: 'every index stored in it', skip: [] },
  updates: { github: 'elastic/elasticsearch', advisories: 'github', how: updateHow('elasticsearch', 'docker.elastic.co/elasticsearch/elasticsearch:8.15.0') },
  // xpack.security.enabled=false: anyone who reaches it can read, change and delete every index.
  noPassword: {
    path: '/',
    test: (http) => {
      const r = http['/'];
      if (r && r.status === 200 && r.json && r.json.tagline === 'You Know, for Search') return true;
      const s = http['/_security/_authenticate'];
      return s && s.status === 401 ? false : null;
    },
    power: 'read, change and delete everything stored in it',
    how: (a) => [
      'Turn security back on: remove xpack.security.enabled=false (it is on by default since version 8).',
      `Run: docker compose up -d ${a.service}, then set the passwords with: docker exec -it ${a.container} bin/elasticsearch-reset-password -u elastic`,
      'Give the apps that use it their own user and password.',
    ],
  },
  checks: ['APP-NO-PASSWORD'],
};

module.exports = [postgres, mariadb, redis, mongo, elasticsearch];
