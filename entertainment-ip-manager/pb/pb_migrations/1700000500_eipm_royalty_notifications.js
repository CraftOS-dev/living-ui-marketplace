/// <reference path="../pb_data/types.d.ts" />
/**
 * Filing a royalty statement notifies its reviewer with the kind "royalty",
 * which the notifications kind list never had, so that notification was
 * dropped. Add it.
 */
migrate(
  (app) => {
    const notifications = app.findCollectionByNameOrId('notifications');
    notifications.fields.getByName('kind').values = ['digest', 'escalation', 'inbox', 'sync', 'assignment', 'approval', 'consent', 'portal', 'info', 'royalty'];
    app.save(notifications);
  },
  (app) => {
    const notifications = app.findCollectionByNameOrId('notifications');
    notifications.fields.getByName('kind').values = ['digest', 'escalation', 'inbox', 'sync', 'assignment', 'approval', 'consent', 'portal', 'info'];
    app.save(notifications);
  },
);
