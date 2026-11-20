# Tasks: Newsletter Tool

Every task cites what it implements. These features already exist in the published app `newsletter-tool` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3, F-FRM-4): the app frame. The sidebar lists the six sections and marks the current one; it collapses to icons by hand and between 640 and 959 px; it becomes a bottom tab bar on phones; it shows the AI generator dot (`components/MainView.tsx`, `components/Sidebar.tsx`, `hooks/useViewport.ts`).
- [x] T-2 (F-FRM-5): the app's variables are bridged onto the kit's theme tokens, with corners flattened for the brutalist style (`styles/theme-bridge.css`, `styles/global.css`).
- [x] T-3 (F-FRM-6): every controller action answers with a react-toastify toast (`AppController.ts`, `App.tsx`).
- [x] T-4 (F-DSH-1, F-DSH-2, F-DSH-3, F-DSH-4, F-DSH-5, F-DSH-6): the Dashboard: the briefing headline and header stats, the Campaigns panel, Quick start, Recent sends, the growth chart with send dots, and the audience split (`sections/Dashboard.tsx`, `/api/dashboard` in `apiAdapter.ts`).
- [x] T-5 (F-SUB-1, F-SUB-2): the subscriber list, newest first, with the "N total · M active" header, search, and status and tag filters with tag counts (`sections/Subscribers.tsx`, `handleSubscribersList`, `handleTags`).
- [x] T-6 (F-SUB-3, F-SUB-4, F-SUB-5): Add subscriber (upsert by lower-cased email, tags merged), the edit drawer (tags replaced, "Bounced" saved as unsubscribed), and Remove with a confirm (`handleSubscriberCreate`, `handleSubscriberUpdate`, `handleSubscriberDelete`).
- [x] T-7 (F-SUB-6, F-SUB-7): CSV import from pasted text with tags for every row, and the Export download through the `subscribers/export` route (`handleSubscribersImport`, `ops.pb.js`).
- [x] T-8 (F-TPL-1, F-TPL-2): the template grid ordered by uses, then by last change, and "New blank template" with the "Hello!" starter blocks (`sections/Templates.tsx`, `handleTemplateCreate`).
- [x] T-9 (F-TPL-3, F-TPL-4, F-TPL-5): the template editor on the shared canvas, with silent autosave, Duplicate as "<name> (copy)", and Delete with a confirm (`editor/TemplateEditor.tsx`, `handleTemplateUpdate`, `handleTemplateDelete`).
- [x] T-10 (F-TPL-6, F-CMP-2): campaign creation by name, as "New campaign", or from a template, which copies its subject, preheader, blocks and design and bumps its use count (`AppController.createCampaign`, `handleCampaignCreate`).
- [x] T-11 (F-CMP-1, F-CMP-3, F-CMP-4): campaign cards with the status chips, Duplicate, Delete (recipients cascade), and Cancel for scheduled campaigns (`sections/Campaigns.tsx`, `handleCampaignDuplicate`, `handleCampaignDelete`, `handleCampaignCancel`).
- [x] T-12 (F-EDT-1, F-EDT-6): the campaign editor's header and Content fields, read-only once sent, with the 700 ms autosave and its "Saving…" and "Saved" states (`editor/CampaignEditor.tsx`, `handleCampaignUpdate`).
- [x] T-13 (F-EDT-2, F-EDT-3, F-EDT-4, F-EDT-5): the palette, the WYSIWYG canvas with drag ordering and the block context menu, the inline rich-text editor, image upload up to 5 MB, and the design controls (`editor/EditorSidebar.tsx`, `editor/CampaignCanvas.tsx`, `editor/RichTextEditor.tsx`).
- [x] T-14 (F-EDT-7, F-EDT-8): the Audience tab (targeting, counts, sample recipients) and the Review tab with the rendered preview (`handleCampaignPreview`, `renderEmail`).
- [x] T-15 (F-EDT-9): the AI writer: `ai/draft` through the host's language model, the starter draft without one, and applying the result to the campaign (`editor/AIPanel.tsx`, `handleGenerate`, `ops.pb.js`).
- [x] T-16 (F-EDT-10, F-SCH-3): scheduling from the editor, and the `newsletter-scheduler` job that records due sends every minute (`handleCampaignSchedule`, `scheduler.pb.js`).
- [x] T-17 (F-EDT-11): Send now with its confirm: the snapshot of the campaign's audience (everyone subscribed, or by its tags) through `send.js` `sendCampaign(app, id, false)`, and the sidecar status set to sent (`handleCampaignSend`, `campaigns/send` in `ops.pb.js`).
- [x] T-18 (F-SCH-1, F-SCH-2): the Schedule section: the month calendar with day markers and counts, and the agenda with day filtering, opening a campaign, and cancelling its schedule (`sections/Schedule.tsx`).
- [x] T-19 (F-SET-1, F-SET-2, F-SET-3): Settings: the Integrations card (Email delivery, AI writer), and the stored sender name and email, reply-to, and footer organization name and address (`sections/Settings.tsx`, `handleSenderIdentityUpdate`, `handleIntegrations`, migration `1762819200_settings_reply_to_and_footer.js`).
- [x] T-20 (F-AGT-1, F-AGT-2, F-AGT-3, F-AGT-7, F-AGT-8): the 25 agent operations in `agent_ops.pb.js`, server ports of the adapter's handlers (`lib_agent.js`) and renderer (`lib_agent_render.js`), with `app.guide`, paged lists with totals, and one-block edits. A parity run stored byte-identical rows for each action done the UI way and through its operation.
- [x] T-21 (F-AGT-4): campaigns, templates, settings and campaign_recipients are listed in `x-agent-hidden-collections`, so only `subscribers` is a raw-data entity.
- [x] T-22 (F-AGT-5, F-AGT-6): templates.delete, campaigns.delete, campaigns.cancel and campaigns.send-now are declared destructive and go through the adapter's approval, and campaigns.schedule refuses times that are not in the future.

## Verification
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
