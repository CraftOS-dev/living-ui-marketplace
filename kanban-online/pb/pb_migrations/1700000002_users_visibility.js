/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared-workspace membership: any signed-in user can see the member list
 * (name + email of teammates). Registration stays open (self sign-up).
 */
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.listRule = '@request.auth.id != ""';
    users.viewRule = '@request.auth.id != ""';
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.listRule = 'id = @request.auth.id';
    users.viewRule = 'id = @request.auth.id';
    app.save(users);
  },
);
