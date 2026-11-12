/**
 * Campaign send logic, shared by the send op and the scheduler cron.
 * Always snapshots the campaign's audience onto the campaign: every
 * subscribed contact, or with tag targeting only those carrying one of its
 * tags. When `deliver` is true it also attempts real delivery of each email
 * through the CraftBot Gmail integration; per-recipient outcomes are recorded
 * on the campaign_recipients rows (delivered | logged | failed).
 */

/**
 * The subscribed contacts a campaign targets, as the editor's Audience tab
 * counts them (CampaignEditor.tsx AudienceTab): everyone subscribed when
 * targetAll (the default), otherwise those with any of targetTags (none when
 * no tag is chosen). Targeting lives in the campaign's JSON sidecar in `body`.
 */
function audienceOf(app, campaign) {
  const subscribed = Array.from(app.findRecordsByFilter('subscribers', 'status = "subscribed"', 'email', 0, 0));
  let meta = null;
  try {
    const parsed = JSON.parse(campaign.getString('body') || '');
    meta = parsed && parsed.__meta === true ? parsed : null;
  } catch (_) {
    /* a plain-text body has no targeting */
  }
  const all = meta ? meta.targetAll : true;
  // apiAdapter.ts coerceBool(sidecar.targetAll, true)
  const targetAll = all == null ? true : typeof all === 'boolean' ? all : ['true', '1'].indexOf(String(all).toLowerCase()) >= 0;
  if (targetAll) return subscribed;
  const tags = Array.isArray(meta.targetTags) ? meta.targetTags.map((t) => String(t).trim()).filter(Boolean) : [];
  return subscribed.filter((s) =>
    String(s.getString('tags'))
      .split(',')
      .some((t) => tags.indexOf(t.trim()) >= 0),
  );
}

function sendCampaign(app, campaignId, deliver) {
  const campaign = app.findRecordById('campaigns', campaignId);
  if (campaign.get('status') === 'sent') {
    throw new Error('campaign already sent');
  }
  const audience = audienceOf(app, campaign);

  let fromName = '';
  let fromEmail = '';
  try {
    const settings = app.findRecordsByFilter('settings', "id != ''", '', 1, 0);
    if (settings[0]) {
      fromName = settings[0].get('sender_name') || '';
      fromEmail = settings[0].get('sender_email') || '';
    }
  } catch (_) {
    /* settings are optional */
  }

  let html = '';
  if (deliver) {
    const { renderHtml } = require(`${__hooks}/deliver.js`);
    html = renderHtml(campaign.get('blocks'), campaign.get('body') || '');
  }

  const recipientsCollection = app.findCollectionByNameOrId('campaign_recipients');
  let delivered = 0;
  let failed = 0;
  for (const subscriber of audience) {
    const to = subscriber.get('email');
    let status = 'logged';
    let detail = '';
    if (deliver) {
      const { sendViaGmail } = require(`${__hooks}/deliver.js`);
      const result = sendViaGmail(to, fromName, fromEmail, campaign.get('subject'), html);
      if (result.ok) {
        status = 'delivered';
        delivered += 1;
      } else {
        status = 'failed';
        detail = result.detail;
        failed += 1;
      }
    }
    const recipient = new Record(recipientsCollection);
    recipient.set('campaign', campaignId);
    recipient.set('email', to);
    recipient.set('name', subscriber.get('name'));
    recipient.set('status', status);
    recipient.set('detail', detail);
    app.save(recipient);
  }

  campaign.set('status', 'sent');
  campaign.set('sent_at', new Date().toISOString());
  campaign.set('recipients_count', audience.length);
  campaign.set('delivered_count', delivered);
  app.save(campaign);
  return {
    recipients: audience.length,
    delivered: delivered,
    failed: failed,
    mode: deliver ? (delivered > 0 ? 'delivered' : 'delivery-failed') : 'recorded',
  };
}

module.exports = { sendCampaign, audienceOf };
