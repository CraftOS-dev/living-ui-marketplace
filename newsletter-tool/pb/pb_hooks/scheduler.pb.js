/// <reference path="../pb_data/types.d.ts" />
/**
 * Scheduled sends: every minute, drafts whose scheduled_at has passed are
 * sent (audience snapshot) automatically.
 */
cronAdd('newsletter-scheduler', '* * * * *', () => {
  const { sendCampaign } = require(`${__hooks}/send.js`);
  const now = new Date().toISOString().replace('T', ' ');
  const due = $app.findRecordsByFilter(
    'campaigns',
    `status = "draft" && scheduled_at != "" && scheduled_at <= "${now}"`,
    '',
    0,
    0,
  );
  for (const campaign of due) {
    try {
      const result = sendCampaign($app, campaign.id, campaign.get('deliver') === true);
      console.log(
        '[newsletter-scheduler] sent',
        campaign.get('subject'),
        '→',
        result.recipients,
        'recipient(s),',
        result.mode,
      );
    } catch (err) {
      console.log('[newsletter-scheduler] failed:', String(err));
    }
  }
});
