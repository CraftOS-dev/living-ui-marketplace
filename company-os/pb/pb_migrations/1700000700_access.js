/// <reference path="../pb_data/types.d.ts" />
/**
 * Access control. Company OS is ONE company's workspace shared by an APPROVED
 * team — not a free-for-all. This migration:
 *
 *   1. adds `role` (owner|admin|member) and `approved` to the `users` auth
 *      collection, and locks it down: self OR admin can read; nobody can
 *      self-update role/approved (changes go through the member-access op).
 *   2. tightens EVERY business collection from "any signed-in user" to
 *      "signed-in AND approved", so an unapproved account sees nothing.
 *   3. bootstraps existing data: the company owner becomes role=owner/approved;
 *      every other existing account is set to pending (member, not approved).
 *
 * The signup guard hook (access.pb.js) forces new signups to pending, and makes
 * the very first account the owner.
 */
migrate(
  (app) => {
    const ACCESS = '@request.auth.id != "" && @request.auth.approved = true';

    // --- 1. users: fields + rules -------------------------------------------
    const users = app.findCollectionByNameOrId('users');
    if (users.fields.getByName('role') === null) {
      users.fields.add(new Field({ name: 'role', type: 'select', maxSelect: 1, values: ['owner', 'admin', 'member'] }));
    }
    if (users.fields.getByName('approved') === null) {
      users.fields.add(new Field({ name: 'approved', type: 'bool' }));
    }
    // Self OR an admin/owner may read the account list (the Team → Access UI).
    const SEE_USERS =
      '@request.auth.id != "" && (id = @request.auth.id || @request.auth.role = "admin" || @request.auth.role = "owner")';
    users.listRule = SEE_USERS;
    users.viewRule = SEE_USERS;
    users.createRule = ''; // open self-signup (guard hook forces pending)
    users.updateRule = null; // role/approved change only via the member-access op
    users.deleteRule = null;
    app.save(users);

    // --- 2. tighten all business collections --------------------------------
    // Leave the agent/trigger plane (agent_requests) on its own rules.
    const SKIP = { agent_requests: true };
    const bases = app.findAllCollections('base');
    for (let i = 0; i < bases.length; i++) {
      const c = bases[i];
      if (c.system) continue;
      if (c.name.charAt(0) === '_') continue;
      if (SKIP[c.name]) continue;
      c.listRule = ACCESS;
      c.viewRule = ACCESS;
      c.createRule = ACCESS;
      c.updateRule = ACCESS;
      c.deleteRule = ACCESS;
      app.save(c);
    }

    // --- 3. bootstrap existing accounts -------------------------------------
    let ownerId = '';
    const companies = app.findRecordsByFilter('company', "id != ''", 'created', 1, 0);
    if (companies.length > 0) ownerId = companies[0].get('owner') || '';

    const existing = app.findRecordsByFilter('users', "id != ''", 'created', 0, 0);
    if (ownerId === '' && existing.length > 0) ownerId = existing[0].id;

    for (let i = 0; i < existing.length; i++) {
      const u = existing[i];
      u.set('emailVisibility', true); // owner/admin need to see who to approve
      if (u.id === ownerId) {
        u.set('role', 'owner');
        u.set('approved', true);
      } else {
        if (!u.get('role')) u.set('role', 'member');
        u.set('approved', false);
      }
      app.save(u);
    }

    // make sure the company records who its owner is
    if (ownerId !== '' && companies.length > 0 && (companies[0].get('owner') || '') === '') {
      companies[0].set('owner', ownerId);
      app.save(companies[0]);
    }
  },
  (app) => {
    // Down: relax rules back to any-signed-in-user, drop the fields.
    const AUTH = '@request.auth.id != ""';
    const bases = app.findAllCollections('base');
    for (let i = 0; i < bases.length; i++) {
      const c = bases[i];
      if (c.system || c.name.charAt(0) === '_') continue;
      c.listRule = AUTH;
      c.viewRule = AUTH;
      c.createRule = AUTH;
      c.updateRule = AUTH;
      c.deleteRule = AUTH;
      app.save(c);
    }
    try {
      const users = app.findCollectionByNameOrId('users');
      users.listRule = 'id = @request.auth.id';
      users.viewRule = 'id = @request.auth.id';
      users.createRule = '';
      users.updateRule = 'id = @request.auth.id';
      users.deleteRule = 'id = @request.auth.id';
      if (users.fields.getByName('role') !== null) users.fields.removeByName('role');
      if (users.fields.getByName('approved') !== null) users.fields.removeByName('approved');
      app.save(users);
    } catch (_) {
      /* best-effort */
    }
  },
);
