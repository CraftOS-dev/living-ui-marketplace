/// <reference path="../pb_data/types.d.ts" />
/**
 * Only an APPROVED owner or admin reads the account list. Revoking an admin
 * keeps their role (only approval is withdrawn), so the old rule still let a
 * revoked admin list every account. Everyone can still read their own account
 * (the waiting screen's "check again").
 */
migrate(
  (app) => {
    const SEE_USERS =
      '@request.auth.id != "" && (id = @request.auth.id || (@request.auth.approved = true && (@request.auth.role = "admin" || @request.auth.role = "owner")))';
    const users = app.findCollectionByNameOrId('users');
    users.listRule = SEE_USERS;
    users.viewRule = SEE_USERS;
    app.save(users);
  },
  (app) => {
    const SEE_USERS =
      '@request.auth.id != "" && (id = @request.auth.id || @request.auth.role = "admin" || @request.auth.role = "owner")';
    const users = app.findCollectionByNameOrId('users');
    users.listRule = SEE_USERS;
    users.viewRule = SEE_USERS;
    app.save(users);
  },
);
