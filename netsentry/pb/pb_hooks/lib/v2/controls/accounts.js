/**
 * Sign-in & accounts (plan §16.7, D12): who has an account in an app and who
 * is an administrator — only for apps someone gave NetSentry a read-only key
 * for (organisation mode). Pure evaluators over the monitor's account lists.
 */
const { day, plural } = require('../content.js');

const MAX_ADMINS = 3;
const STALE_DAYS = 90;
const NEW_GRACE_DAYS = 30;

function status(app) {
  return app.accountsStatus || null;
}

function listed(app) {
  const st = status(app);
  if (!st) return { state: 'unknown', reason: 'waiting for the first account list (within 6 hours of adding the key)', facts: {} };
  if (!st.ok) return { state: 'unknown', reason: st.error || "couldn't list the accounts", facts: {} };
  return null;
}

function names(list, max) {
  const n = list.slice(0, max || 6).map((a) => a.login);
  return list.length > n.length ? `${n.join(', ')} and ${list.length - n.length} more` : n.join(', ');
}

const adminCount = {
  id: 'ACC-ADMIN-COUNT',
  version: 1,
  outcome: 'security',
  subject: 'app',
  title: 'More people are administrators than needed',
  appliesTo: (app) => !!(app.entry.accounts && app.access),
  evaluate(app) {
    const wait = listed(app);
    if (wait) return wait;
    const admins = app.accounts.filter((a) => a.active && a.is_admin);
    const facts = { admins: admins.map((a) => a.login), count: admins.length, limit: MAX_ADMINS };
    const evidence = { admins: admins.map((a) => ({ login: a.login, last_login: a.last_login })) };
    if (admins.length <= MAX_ADMINS) return { state: 'pass', facts, evidence };
    return { state: 'fail', severity: 'low', factors: [`${admins.length} administrators`], facts, evidence };
  },
  text: {
    title: (f, app) => `${app.name} has ${f.count} administrators — more than most teams need`,
    saw: (f, app) => [`${app.name}'s administrators: ${f.admins.join(', ')}.`],
    means: (f, app) =>
      `Every administrator can change anything in ${app.name}, so each one is a way in if their password leaks. Keep it to the few people who really look after it.`,
    steps: (f, app) => ({
      variant: 'app',
      list: [
        `Check with each of them whether they still need to manage ${app.name}.`,
        `In ${app.name}, open Site Administration → User Accounts, edit each one who doesn't, and untick "Is Administrator".`,
      ],
    }),
    verify: (f, app) => `NetSentry reads ${app.name}'s account list again within 6 hours; this turns green at ${f.limit} or fewer.`,
    pass: (f, app) => `${app.name}: ${plural(f.count, 'administrator')}`,
    unknown: (f, app) => `${app.name}: can't tell yet who is an administrator`,
  },
  references: [],
};

const staleUsers = {
  id: 'ACC-STALE-USERS',
  version: 1,
  outcome: 'security',
  subject: 'app',
  title: "Accounts nobody has used in months are still open",
  appliesTo: (app) => !!(app.entry.accounts && app.access),
  evaluate(app, ctx) {
    const wait = listed(app);
    if (wait) return wait;
    const now = Date.parse(ctx.now);
    const stale = app.accounts.filter((a) => {
      if (!a.active) return false;
      if (a.last_login) return now - Date.parse(a.last_login) > STALE_DAYS * 86400000;
      return !!a.created && now - Date.parse(a.created) > NEW_GRACE_DAYS * 86400000; // never signed in
    });
    const facts = { stale: stale.map((a) => ({ login: a.login, last: a.last_login, admin: !!a.is_admin })), days: STALE_DAYS, admins: stale.filter((a) => a.is_admin).length };
    const evidence = { stale: facts.stale, checked: app.accounts.length };
    if (!stale.length) return { state: 'pass', facts, evidence };
    return {
      state: 'fail',
      severity: facts.admins ? 'high' : 'medium',
      factors: [`${plural(stale.length, 'unused account')}`].concat(facts.admins ? [`${facts.admins} of them ${facts.admins === 1 ? 'is an administrator' : 'are administrators'}`] : []),
      facts,
      evidence,
    };
  },
  text: {
    title: (f, app) => `${app.name}: ${plural(f.stale.length, 'account')} unused for ${f.days}+ days still open`,
    saw: (f, app) => [
      `Not used for over ${f.days} days: ${names(f.stale.map((s) => ({ login: s.last ? `${s.login} (last ${day(s.last)})` : `${s.login} (never signed in)` })))}.`,
    ].concat(f.admins ? [`${f.admins} of them ${f.admins === 1 ? 'is an administrator' : 'are administrators'}.`] : []),
    means: () => 'Accounts of people who left, or never started, are a way in that nobody watches: if one password leaks, nobody notices the sign-in.',
    steps: (f, app) => ({
      variant: 'app',
      list: [
        'Ask whether each person still needs the account.',
        `In ${app.name}, open Site Administration → User Accounts and, for each one that isn't needed, tick "Disable sign-in" (or delete the account).`,
      ],
    }),
    verify: (f, app) => `NetSentry reads ${app.name}'s account list again within 6 hours; this turns green when no unused account is still open.`,
    pass: (f, app) => `${app.name}: every open account has been used in the last ${f.days} days`,
    unknown: (f, app) => `${app.name}: can't tell yet which accounts are in use`,
  },
  references: [],
};

module.exports = [adminCount, staleUsers];
