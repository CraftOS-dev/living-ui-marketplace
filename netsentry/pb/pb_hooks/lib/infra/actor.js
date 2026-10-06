/**
 * INFRA — who is calling. A signed-in user, the agent (which operates the app
 * with the machine superuser credential through the A2App surface), a
 * registered sensor, or the scheduler.
 */

const SYSTEM = { type: 'system', id: '', label: 'system', role: '' };

function resolveActor(e) {
  let auth = null;
  try {
    auth = e.auth;
  } catch (_) {
    auth = null;
  }
  if (!auth) return null;
  const collection = auth.collection().name;
  if (collection === '_superusers') return { type: 'agent', id: '', label: 'agent', role: '' };
  if (collection === 'sensors') {
    if (auth.getString('status') === 'revoked') return null;
    return { type: 'sensor', id: auth.id, label: 'sensor ' + auth.getString('name'), role: '' };
  }
  if (collection === 'users') {
    return { type: 'user', id: auth.id, label: auth.getString('email'), role: auth.getString('role') || 'viewer' };
  }
  return null;
}

module.exports = { resolveActor, SYSTEM };
