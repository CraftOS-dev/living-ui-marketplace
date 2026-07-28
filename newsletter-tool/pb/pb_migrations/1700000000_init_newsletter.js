/// <reference path="../pb_data/types.d.ts" />
/**
 * Newsletter tool schema: subscribers, campaigns, and a per-campaign
 * recipient snapshot. "Sending" records the audience snapshot — actual
 * SMTP delivery is out of scope for a local app (export the recipient
 * list instead). Auth mode "none": open rules are acceptable because the
 * app binds loopback.
 */
migrate(
  (app) => {
    const subscribers = new Collection({
      type: 'base',
      name: 'subscribers',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'text', max: 200 },
        {
          name: 'status',
          type: 'select',
          maxSelect: 1,
          values: ['subscribed', 'unsubscribed'],
        },
        { name: 'tags', type: 'text', max: 500 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_subscribers_email ON subscribers (email)'],
    });
    app.save(subscribers);

    const campaigns = new Collection({
      type: 'base',
      name: 'campaigns',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'subject', type: 'text', required: true, max: 300 },
        { name: 'body', type: 'text', max: 50000 },
        // Structured content: [{type: heading|paragraph|button|divider, text?, url?}]
        { name: 'blocks', type: 'json' },
        { name: 'status', type: 'select', maxSelect: 1, values: ['draft', 'sent'] },
        { name: 'scheduled_at', type: 'date' },
        { name: 'sent_at', type: 'date' },
        { name: 'recipients_count', type: 'number' },
        // true = attempt real delivery (CraftBot Gmail bridge) when sending
        { name: 'deliver', type: 'bool' },
        { name: 'delivered_count', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(campaigns);

    const recipients = new Collection({
      type: 'base',
      name: 'campaign_recipients',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        {
          name: 'campaign',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('campaigns').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        // Snapshot fields — kept even if the subscriber is later deleted.
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'text', max: 200 },
        // Per-recipient outcome: delivered | logged (recorded only) | failed
        { name: 'status', type: 'select', maxSelect: 1, values: ['delivered', 'logged', 'failed'] },
        { name: 'detail', type: 'text', max: 400 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(recipients);

    const templates = new Collection({
      type: 'base',
      name: 'templates',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'name', type: 'text', required: true, max: 200 },
        { name: 'subject', type: 'text', max: 300 },
        { name: 'body', type: 'text', max: 50000 },
        { name: 'blocks', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(templates);

    // Single-row sender identity (shown on campaigns, used by exports).
    const settings = new Collection({
      type: 'base',
      name: 'settings',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'sender_name', type: 'text', max: 200 },
        { name: 'sender_email', type: 'email' },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(settings);
  },
  (app) => {
    for (const name of [
      'settings',
      'templates',
      'campaign_recipients',
      'campaigns',
      'subscribers',
    ]) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
