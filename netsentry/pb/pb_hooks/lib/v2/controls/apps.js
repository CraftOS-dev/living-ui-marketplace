/**
 * App checks: who can reach it vs. who should (REACH-BEYOND-INTENT) and the
 * app-specific checks from the catalogue. Evaluators are pure (plan §20.1).
 */
const { compare, widest, reachWords, vantageWords } = require('../intent.js');
const { variantOf, bump } = require('./util.js');

// ------------------------------------------------------------------ reach

const reachBeyondIntent = {
  id: 'REACH-BEYOND-INTENT',
  version: 2,
  outcome: 'reach',
  subject: 'app',
  title: 'The app can be reached by more people than you chose',
  appliesTo: () => true,
  evaluate(app) {
    if (!app.endpoints.length) {
      return { state: 'not_applicable', reason: 'not published on any network', facts: {} };
    }
    const intent = app.intent.reach;
    const cmp = compare(app.reach.vantages, intent);
    const internetPath = app.reach.paths.find((p) => p.vantage === 'internet') || null;
    const tunnel = internetPath && internetPath.hops[0] && ['cloudflare tunnel', 'tailscale funnel'].indexOf(internetPath.hops[0].component) >= 0 ? internetPath.hops[0] : null;
    const facts = {
      short: cmp.short.length > 0,
      tunnel,
      intent,
      intent_source: app.intent.source,
      widest: widest(app.reach.vantages),
      beyond: cmp.beyond,
      port: app.endpoints[0].port,
      container_port: app.endpoints[0].container_port || app.endpoints[0].port,
      forward: internetPath && internetPath.hops[0] && internetPath.hops[0].component === 'router forward' ? internetPath.hops[0] : null,
    };
    const evidence = { vantages: app.reach.vantages, paths: app.reach.paths, intent, confidence: app.reach.confidence };
    if (cmp.ok) return { state: 'pass', facts, evidence };
    const internet = cmp.beyond.indexOf('internet') >= 0;
    const factors = [internet ? 'reachable from the internet' : 'reachable by everyone on the network', `you chose: ${reachWords(intent)}`];
    return { state: 'fail', severity: internet ? 'high' : 'medium', factors, facts, evidence };
  },
  text: {
    title: (f, app, ctx) =>
      f.beyond.indexOf('internet') >= 0 ? `${app.name} can be opened from anywhere on the internet` : `${app.name} can be opened by everyone on your ${ctx.place} network`,
    saw(f, app, ctx) {
      const out = [];
      if (f.forward) {
        out.push(`Your router${f.forward.router ? ` (${f.forward.router})` : ''} sends internet traffic on port ${f.forward.external_port} to ${ctx.machine.name}, where ${app.name} answers.`);
      }
      if (f.tunnel && f.tunnel.component === 'cloudflare tunnel') out.push(`A Cloudflare Tunnel publishes it at https://${f.tunnel.hostname}.`);
      if (f.tunnel && f.tunnel.component === 'tailscale funnel') out.push('Tailscale Funnel shares it with the whole internet, not just your devices.');
      out.push(`${app.name} accepts connections from every network ${ctx.machine.name} is on (port ${f.port}).`);
      out.push(`You chose: ${reachWords(f.intent, ctx.place)}${f.intent_source === 'default' ? ' (our suggestion — you can change it)' : ''}.`);
      return out;
    },
    means: (f, app, ctx) =>
      f.beyond.indexOf('internet') >= 0
        ? `Anyone in the world can find ${app.name} and try to get in. Automated scanners look for ${app.entry.name} all day, and a single weakness or weak password is enough.`
        : `Every device on your ${ctx.place} network — guests' phones, smart TVs, anything infected — can reach ${app.name}. You chose ${reachWords(f.intent, ctx.place)}.`,
    steps(f, app, ctx) {
      const list = [];
      const wantsRemote = f.intent === 'local_plus_private_remote';
      if (f.forward) {
        if (wantsRemote) {
          list.push(`Set up private access for your own devices first: install Tailscale on ${ctx.machine.name} (tailscale.com/download) and on your phone, and sign in to the same account on both.`);
        }
        list.push(`Delete the rule for port ${f.forward.external_port} in your router's port-forwarding page (sometimes called "Virtual Servers" or "NAT")${f.forward.router ? ` on your ${f.forward.router}` : ''}.`);
        list.push(`That rule was added automatically (UPnP). If it comes back, turn off UPnP in your router's settings.`);
        if (wantsRemote) list.push(`Away from home, open ${app.name} through Tailscale: http://${ctx.machine.name}:${f.port}`);
      }
      if (f.tunnel && f.tunnel.component === 'cloudflare tunnel') {
        list.push(`In Cloudflare Zero Trust → Access → Applications, protect https://${f.tunnel.hostname} so only people you invite can open it — or remove that hostname from the tunnel.`);
      }
      if (f.tunnel && f.tunnel.component === 'tailscale funnel') {
        list.push(`On ${ctx.machine.name}: tailscale funnel off — then share it with "tailscale serve" instead, which only your devices can open.`);
      }
      if ((!f.forward && !f.tunnel) || f.intent === 'this_machine') {
        const variant = variantOf(app, ctx.machine);
        if (variant === 'docker_compose' && f.intent === 'this_machine') {
          list.push(`In your docker-compose.yml, change the ports line of "${app.compose_service}" from "${f.port}:${f.container_port}" to "127.0.0.1:${f.port}:${f.container_port}".`);
          list.push(`Run: docker compose up -d ${app.compose_service}`);
        } else if (f.intent === 'this_machine') {
          list.push(`In ${app.name}'s network settings, make it listen on 127.0.0.1 only, then restart it.`);
        }
      }
      return { variant: f.forward ? (wantsRemote ? 'home_router_tailscale' : 'home_router') : variantOf(app, ctx.machine), list };
    },
    verify: (f, app) => `NetSentry reads your router's forwards again and re-checks who can reach ${app.name} within 5 minutes.`,
    pass: (f, app) => (f.short ? `${app.name} is locked down — but not reachable from away yet` : `${app.name} is reachable only as you chose`),
    unknown: (f, app) => `We can't tell yet who can reach ${app.name}`,
    notApplicable: (f, app) => `${app.name} isn't open on any network`,
  },
  references: ['https://jellyfin.org/docs/general/networking/', 'https://tailscale.com/kb/1017/install'],
};

// ------------------------------------------- catalogue-driven app checks
// Each app's catalogue entry says HOW to tell (a verified answer or setting)
// and WHAT it means for that app; the check's logic and wording live here once.

/** A catalogue's steps: a list, or a function of the app (to name its real container and service). */
function stepsOf(how, app) {
  return typeof how === 'function' ? how({ container: app.container || '<container>', service: app.compose_service || app.app_type }) : how.slice();
}

function exposureSeverity(app, internetSev, networkSev, localSev) {
  if (app.reach.vantages.indexOf('internet') >= 0) return internetSev;
  if (app.reach.vantages.indexOf('local_network') >= 0) return networkSev;
  return localSev;
}

function exposureFactor(app) {
  return app.reach.vantages.indexOf('internet') >= 0 ? 'reachable from the internet' : app.reach.vantages.indexOf('local_network') >= 0 ? 'reachable on your network' : 'only on this server';
}

const setupOpen = {
  id: 'APP-SETUP-OPEN',
  version: 1,
  outcome: 'security',
  subject: 'app',
  title: "The app's first-time setup was never finished",
  appliesTo: (app) => !!app.entry.setup,
  evaluate(app) {
    const spec = app.entry.setup;
    const answer = spec.path ? app.http[spec.path] : null;
    const open = spec.test ? spec.test(app.http) : answer ? spec.open(answer) : null;
    const facts = { url: app.primary_url, widest: widest(app.reach.vantages), said: open && spec.said ? spec.said(app.http) : '' };
    const asked = spec.paths || [spec.path];
    const evidence = { asked: asked.join(', '), answer: spec.path ? answer || null : asked.reduce((o, p) => Object.assign(o, { [p]: app.http[p] || null }), {}) };
    if (open === null) return { state: 'unknown', reason: `${app.entry.name} didn't answer our question yet`, facts, evidence };
    if (!open) return { state: 'pass', facts, evidence };
    return {
      state: 'fail',
      severity: exposureSeverity(app, 'critical', 'high', 'medium'),
      factors: ['whoever opens it first takes over', exposureFactor(app)],
      facts,
      evidence,
    };
  },
  text: {
    title: (f, app) => `${app.name}: setup never finished — anyone who opens it takes over`,
    saw: (f, app, ctx) => [f.said || `${app.name} told us its first-time setup is not finished.`, `It can be opened by ${vantageWords(f.widest, ctx.place)}.`],
    means: (f, app) => `Until setup is finished, whoever opens ${app.name} first becomes ${app.entry.setup.becomes}.`,
    steps: (f, app, ctx) => ({
      variant: 'app',
      list: [`If you didn't start this setup yourself, stop ${app.name} first${app.compose_service ? ` (docker compose stop ${app.compose_service})` : ''}, then start it again when you're ready.`].concat(
        app.entry.setup.how(Object.assign({ machine: ctx.machine.name }, app), f.url || 'its web page'),
      ),
    }),
    verify: (f, app) => `NetSentry asks ${app.name} again on its next check (every few minutes); this turns green when setup is finished.`,
    pass: (f, app) => `${app.name}'s setup is finished`,
    unknown: (f, app) => `${app.name}: can't tell yet whether its setup is finished`,
  },
  references: [],
};

const noPassword = {
  id: 'APP-NO-PASSWORD',
  version: 1,
  outcome: 'security',
  subject: 'app',
  title: 'The app has no password',
  appliesTo: (app) => !!app.entry.noPassword,
  evaluate(app) {
    const spec = app.entry.noPassword;
    const cfg = app.config ? app.config.values : null;
    const open = spec.test(app.http, cfg);
    const facts = { widest: widest(app.reach.vantages), by: spec.path ? 'answer' : 'settings' };
    const evidence = { asked: spec.path || null, answer: spec.path ? app.http[spec.path] || null : null, settings: cfg };
    if (open === null) return { state: 'unknown', reason: spec.path ? `${app.entry.name} didn't answer yet` : `we couldn't read ${app.entry.name}'s settings yet`, facts, evidence };
    if (!open) return { state: 'pass', facts, evidence };
    return { state: 'fail', severity: exposureSeverity(app, 'critical', 'high', 'medium'), factors: ['no password', exposureFactor(app)], facts, evidence };
  },
  text: {
    title: (f, app) => (app.entry.noPassword.title ? app.entry.noPassword.title(app) : `${app.name} has no password — anyone who can reach it gets in`),
    saw: (f, app, ctx) => [
      f.by === 'answer' ? `${app.name} answered us without asking for a password.` : `${app.name}'s settings have no username or password for its control page.`,
      `It can be opened by ${vantageWords(f.widest, ctx.place)}.`,
    ],
    means: (f, app, ctx) => `Anyone who can reach ${app.name} — ${f.widest === 'internet' ? 'anyone in the world' : `any device on your ${ctx.place} network`} — can ${app.entry.noPassword.power}.`,
    steps: (f, app) => ({ variant: 'app', list: stepsOf(app.entry.noPassword.how, app) }),
    verify: (f, app) => `NetSentry checks ${app.name} again on its next check; this turns green once it asks for a password.`,
    pass: (f, app) => `${app.name} asks for a password`,
    unknown: (f, app) => `${app.name}: can't tell yet whether it asks for a password`,
  },
  references: [],
};

const keyExposed = {
  id: 'APP-KEY-EXPOSED',
  version: 1,
  outcome: 'security',
  subject: 'app',
  title: 'The app hands out its master key',
  appliesTo: (app) => !!app.entry.keyExposed,
  evaluate(app) {
    const spec = app.entry.keyExposed;
    const answer = app.http[spec.path];
    const exposed = answer ? spec.test(answer) : null;
    const facts = { widest: widest(app.reach.vantages) };
    // The key itself is never kept: the monitor records only that it was handed out.
    const evidence = { asked: spec.path, status: answer ? answer.status : null, key_handed_out: exposed === true };
    if (exposed === null) return { state: 'unknown', reason: `${app.entry.name} didn't answer our question yet`, facts, evidence };
    if (!exposed) return { state: 'pass', facts, evidence };
    return { state: 'fail', severity: exposureSeverity(app, 'critical', 'high', 'medium'), factors: ['its key is handed to anyone', exposureFactor(app)], facts, evidence };
  },
  text: {
    title: (f, app) => `${app.name} gives its master key to anyone who asks`,
    saw: (f, app, ctx) => [`${app.name} handed us its master key without asking for a login. (NetSentry did not keep it.)`, `It can be opened by ${vantageWords(f.widest, ctx.place)}.`],
    means: (f, app) => `With that key, anyone who can reach ${app.name} can ${app.entry.keyExposed.power}. Setting up a login stops it handing the key out.`,
    steps: (f, app) => ({ variant: 'app', list: stepsOf(app.entry.keyExposed.how, app) }),
    verify: (f, app) => `NetSentry asks ${app.name} again on its next check; this turns green once it asks for a login instead.`,
    pass: (f, app) => `${app.name} keeps its key behind a login`,
    unknown: (f, app) => `${app.name}: can't tell yet whether its key is protected`,
  },
  references: ['https://wiki.servarr.com/sonarr/settings#security'],
};

const openSignup = {
  id: 'APP-OPEN-SIGNUP',
  version: 1,
  outcome: 'security',
  subject: 'app',
  title: 'Anyone can create an account in the app',
  appliesTo: (app) => !!app.entry.openSignup,
  evaluate(app) {
    const spec = app.entry.openSignup;
    const cfg = app.config ? app.config.values : null;
    const open = spec.test(cfg, app.http);
    const facts = { widest: widest(app.reach.vantages), by: spec.path ? 'answer' : 'settings' };
    const evidence = spec.path
      ? { asked: spec.path, answer: app.http[spec.path] || null }
      : { settings: cfg ? { SIGNUPS_ALLOWED: cfg.SIGNUPS_ALLOWED === undefined ? null : cfg.SIGNUPS_ALLOWED } : null };
    if (open === null) return { state: 'unknown', reason: spec.path ? `${app.entry.name} didn't answer yet` : `we couldn't read ${app.entry.name}'s settings yet`, facts, evidence };
    if (!open) return { state: 'pass', facts, evidence };
    return { state: 'fail', severity: exposureSeverity(app, 'high', 'medium', 'low'), factors: ['sign-ups open', exposureFactor(app)], facts, evidence };
  },
  text: {
    title: (f, app) => `Anyone who can reach ${app.name} can create an account`,
    saw: (f, app, ctx) => [
      f.by === 'answer' ? `${app.name} shows a "Register" page to anyone who opens it.` : `${app.name} lets new people sign up by themselves (sign-ups are not turned off).`,
      `It can be opened by ${vantageWords(f.widest, ctx.place)}.`,
    ],
    means: (f, app) => `Strangers who reach ${app.name} can make their own account on your server and use it. Invite the people you want instead.`,
    steps: (f, app) => ({ variant: 'app', list: stepsOf(app.entry.openSignup.how, app) }),
    verify: (f, app) =>
      f.by === 'answer'
        ? `NetSentry opens ${app.name}'s sign-up page again on its next check; this turns green when it no longer lets people register.`
        : `NetSentry re-reads ${app.name}'s settings within minutes of the change; this turns green when sign-ups are off.`,
    pass: (f, app) => `${app.name}: only people you invite can have an account`,
    unknown: (f, app) => `${app.name}: can't tell yet whether sign-ups are open`,
  },
  references: ['https://github.com/dani-garcia/vaultwarden/wiki/Disable-registration-of-new-users'],
};

const adminSecretPlain = {
  id: 'APP-ADMIN-SECRET-PLAIN',
  version: 1,
  outcome: 'security',
  subject: 'app',
  title: "The app's admin password is stored in plain text",
  appliesTo: (app) => !!app.entry.adminSecret,
  evaluate(app) {
    const cfg = app.config ? app.config.values : null;
    const plain = app.entry.adminSecret.test(cfg);
    const facts = {};
    const evidence = { admin_token: cfg && cfg.ADMIN_TOKEN ? cfg.ADMIN_TOKEN : null };
    if (plain === null) return { state: 'unknown', reason: `we couldn't read ${app.entry.name}'s settings yet`, facts, evidence };
    if (!plain) return { state: 'pass', facts, evidence };
    return { state: 'fail', severity: 'medium', factors: ['admin password readable in its settings'], facts, evidence };
  },
  text: {
    title: (f, app) => `${app.name}'s admin password is stored in plain text`,
    saw: (f, app) => [`${app.name}'s admin page is on, and its password (ADMIN_TOKEN) is written as plain text in the container's settings.`],
    means: (f, app) => `Anyone who can see the container's settings — a backup, a support log, Docker access — can open ${app.name}'s admin page and change everything.`,
    steps: (f, app) => ({ variant: 'app', list: stepsOf(app.entry.adminSecret.how, app) }),
    verify: (f, app) => `NetSentry re-reads ${app.name}'s settings within minutes; this turns green when the token is a hash.`,
    pass: (f, app) => `${app.name}'s admin password is stored safely (or the admin page is off)`,
    unknown: (f, app) => `${app.name}: can't tell yet how its admin password is stored`,
  },
  references: ['https://github.com/dani-garcia/vaultwarden/wiki/Enabling-admin-page#secure-the-admin_token'],
};

// ----------------------------------------------------------- qBittorrent

const QB = {
  enabled: 'Preferences/WebUI\\AuthSubnetWhitelistEnabled',
  list: 'Preferences/WebUI\\AuthSubnetWhitelist',
  localhost: 'Preferences/WebUI\\LocalHostAuth',
};

const qbitAuthBypass = {
  id: 'APP-QBIT-AUTH-BYPASS',
  version: 1,
  outcome: 'security',
  subject: 'app',
  title: 'qBittorrent skips the password for some devices',
  appliesTo: (app) => app.app_type === 'qbittorrent',
  evaluate(app) {
    const cfg = app.config && app.config.values;
    const probe = app.http['/api/v2/app/version'];
    const answeredFromNetwork = !!(probe && probe.status === 200 && app.primary_probe_is_network);
    const facts = { widest: widest(app.reach.vantages) };
    const evidence = { config: cfg || null, unauthenticated_answer: probe ? { status: probe.status, from: app.primary_probe_host } : null };
    if (!cfg) {
      if (answeredFromNetwork) {
        return { state: 'fail', severity: 'high', factors: ['answered us without a password'], facts: Object.assign(facts, { confirmed: true, subnets: '' }), evidence };
      }
      return { state: 'unknown', reason: app.config_readable === false ? "we couldn't read qBittorrent's settings file" : "we haven't read qBittorrent's settings yet", facts, evidence };
    }
    const subnetsOn = String(cfg[QB.enabled] || '').toLowerCase() === 'true' && String(cfg[QB.list] || '').trim() !== '';
    const localhostOff = String(cfg[QB.localhost] || '').toLowerCase() === 'false';
    // A measurement beats a settings file that may be older: it answered us without a password, so it does.
    if (!subnetsOn && !localhostOff && answeredFromNetwork) {
      return { state: 'fail', severity: 'high', factors: ['answered us without a password'], facts: Object.assign(facts, { confirmed: true, subnets: '' }), evidence };
    }
    if (!subnetsOn && !localhostOff) return { state: 'pass', facts, evidence };
    Object.assign(facts, { subnets: subnetsOn ? String(cfg[QB.list]) : '', localhost_only: !subnetsOn && localhostOff, confirmed: answeredFromNetwork });
    const network = app.reach.vantages.indexOf('local_network') >= 0;
    const sev = subnetsOn ? (network ? 'high' : 'medium') : 'medium';
    return {
      state: 'fail',
      severity: app.reach.vantages.indexOf('internet') >= 0 ? bump(sev, 1) : sev,
      factors: [subnetsOn ? 'no password for devices on your network' : 'no password for programs on this server', answeredFromNetwork ? 'confirmed: it answered us without a password' : 'from its settings'],
      facts,
      evidence,
    };
  },
  text: {
    title: (f, app, ctx) =>
      f.localhost_only ? `${app.name} lets programs on ${ctx.machine.name} in without a password` : `${app.name} lets devices on your network in without a password`,
    saw(f, app, ctx) {
      const out = [];
      if (f.subnets) out.push(`The setting "Bypass authentication for clients in whitelisted IP subnets" is on, for your ${ctx.place} network (${f.subnets}).`);
      if (f.localhost_only) out.push('The setting "Bypass authentication for clients on localhost" is on.');
      if (f.confirmed) out.push(`We confirmed it: ${app.name} answered us without asking for a password.`);
      return out.length ? out : [`${app.name} answered us without asking for a password.`];
    },
    means: (f, app, ctx) =>
      f.localhost_only
        ? `Any program on ${ctx.machine.name} — including anything that sneaks in — can control ${app.name} without the password.`
        : `Anyone on your ${ctx.place} network — a guest's phone, a smart TV, anything infected — can add downloads, change settings or delete files in ${app.name}.`,
    steps: (f, app) => ({
      variant: 'app',
      list: [
        `Open ${app.name} in your browser and go to Tools → Options… → WebUI.`,
        f.localhost_only ? 'Untick "Bypass authentication for clients on localhost".' : 'Untick "Bypass authentication for clients in whitelisted IP subnets".',
        'Make sure a username and a strong password are set, then click Save.',
      ],
    }),
    verify: (f, app) => `NetSentry re-reads ${app.name}'s settings and asks it again without a password on its next check (every 5 minutes).`,
    pass: (f, app) => `${app.name} asks everyone for its password`,
    unknown: (f, app) => `We can't tell yet whether ${app.name} asks everyone for its password`,
  },
  references: ['https://github.com/qbittorrent/qBittorrent/blob/master/src/base/preferences.cpp', 'https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)'],
};

const adminPageOpen = {
  id: 'APP-ADMIN-PAGE-OPEN',
  version: 1,
  outcome: 'security',
  subject: 'app',
  title: "The app's admin page can be opened by anyone who reaches it",
  appliesTo: (app) => !!app.entry.adminPage,
  evaluate(app) {
    const spec = app.entry.adminPage;
    const open = spec.test(app.http);
    const facts = { widest: widest(app.reach.vantages) };
    const evidence = { asked: spec.path, answer: app.http[spec.path] || null };
    if (open === null) return { state: 'unknown', reason: `${app.entry.name} didn't answer yet`, facts, evidence };
    if (!open) return { state: 'pass', facts, evidence };
    return { state: 'fail', severity: exposureSeverity(app, 'high', 'medium', 'low'), factors: [`${spec.page} is open`, exposureFactor(app)], facts, evidence };
  },
  text: {
    title: (f, app) => `${app.name}: ${app.entry.adminPage.page} can be opened by anyone who reaches it`,
    saw: (f, app, ctx) => [`${app.name} shows ${app.entry.adminPage.page} (${app.entry.adminPage.path}) without a login.`, `It can be opened by ${vantageWords(f.widest, ctx.place)}.`],
    means: (f, app) => `It is protected only by one password. Anyone who guesses it can ${app.entry.adminPage.power}. Hiding the page removes the risk.`,
    steps: (f, app) => ({ variant: 'app', list: stepsOf(app.entry.adminPage.how, app) }),
    verify: (f, app) => `NetSentry opens ${app.entry.adminPage.path} again on its next check; this turns green when it is switched off.`,
    pass: (f, app) => `${app.name}: ${app.entry.adminPage.page} is switched off`,
    unknown: (f, app) => `${app.name}: can't tell yet whether ${app.entry.adminPage.page} is open`,
  },
  references: [],
};

module.exports = [reachBeyondIntent, setupOpen, noPassword, keyExposed, openSignup, adminSecretPlain, qbitAuthBypass, adminPageOpen];
