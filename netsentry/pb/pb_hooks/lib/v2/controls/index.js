/**
 * The v2 check catalogue (plan §20). Add a check = add it to one of the
 * family files. Each check: id, version, outcome, subject, appliesTo,
 * evaluate (pure), text (content layers), references.
 */
const ALL = [].concat(require('./apps.js'), require('./accounts.js'), require('./outcomes.js').controls, require('./machine.js').controls, require('./cloud.js'), require('./self.js'), require('./health.js'));

const BY_ID = {};
for (const c of ALL) BY_ID[c.id] = c;

function forSubject(kind) {
  return ALL.filter((c) => c.subject === kind);
}

module.exports = { ALL, get: (id) => BY_ID[id] || null, forSubject };
