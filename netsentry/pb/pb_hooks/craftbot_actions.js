/**
 * CraftBot actions NetSentry uses — kept at the top level of pb_hooks so the
 * validation gate derives `capabilities.actions` from these literals.
 * Outside CraftBot every call returns { status: 503 } and callers degrade.
 */

/** Email the CraftBot account owner (no recipient = the user). */
function emailOwner(subject, body) {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  return bridge.callAction('send_gmail', { subject, body }, { confirmIrreversible: true });
}

module.exports = { emailOwner };
