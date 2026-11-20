/**
 * Intake registrations (SPEC 4.2). Plain data.
 *
 * Events intake emits:
 *   intake.added    { item }
 *   intake.ready    { item }            (your AI agent finished reading it)
 *   intake.advanced { item, deal }
 *   intake.passed   { item, pass }
 */
module.exports = {
  on: {
    'file.added': 'lib_intake.onFileAdded',
    'outbound.sent': 'lib_intake_pass.onOutbound',
    'outbound.failed': 'lib_intake_pass.onOutbound',
    'record.merged': 'lib_intake.onRecordMerged',
    'deal.reopened': 'lib_intake_pass.onDealReopened',
  },
  needsYou: 'lib_intake.needsYou',
  triggers: {
    deck_triage: {
      record: 'intake_items',
      param: 'item_id',
      perm: 'intake:edit',
      label: 'Read a deck',
      description: 'Your AI agent reads an inbound deck into facts with grades and page anchors (a person decides)',
      fires: 'Add deal with a deck, Ask your AI agent on an Inbox item, or a deck that arrives by email (switch)',
      cooldown: 10,
      policy: { key: 'email_decks', label: 'Read decks that arrive by email', tip: 'Each new email with a deck in the deals label is read when it arrives.' },
      check: 'lib_intake.askCheck',
      asked: 'lib_intake.onAsked',
      ended: 'lib_intake.onCannot',
      instruction:
        "Read the inbound deck of Inbox item item_id into facts. 1) triage.start --item <item_id>: its files, email text, fact keys, grades, standard slides and the active theses. 2) Read every file (files.text --file <id>; image pages with your own vision through files.download) and the email text. 3) One triage.facts-save --item <item_id> --facts '[...]' (each fact as the source states it, with its grade, file, page and exact quote; unknown stays null) --company --one_liner --founders --missing --questions. That save makes the item Ready. Never guess a figure, never judge the founders' personal traits, never contact anyone.",
    },
    deck_fetch: {
      record: 'intake_items',
      param: 'item_id',
      perm: 'intake:edit',
      label: 'Fetch a deck link',
      description: 'Your AI agent opens a DocSend, Papermark or Drive deck link, attaches the deck and reads it (never accepts an NDA or terms)',
      fires: 'Ask your AI agent on an Inbox item that has only a deck link, Add deal with a link, or a link that arrives by email (switch)',
      cooldown: 10,
      policy: { key: 'email_decks', label: 'Read decks that arrive by email', tip: 'Each new email with a deck in the deals label is read when it arrives.' },
      check: 'lib_intake.askCheck',
      asked: 'lib_intake.onAsked',
      ended: 'lib_intake.onCannot',
      instruction:
        "Get the deck behind the link of Inbox item item_id, then read it. 1) intake.get --item <item_id>: url and link_kind. 2) Open the link with your browser; give only the firm's own email address when asked; stop at an NDA, terms or a sign-in. 3) Save the deck as a file: files.upload --owner_collection intake_items --owner_id <item_id> --folder Deck --paths '[\"<absolute path>\"]' --origin link --source_ref <the link>. 4) Read it as trigger deck_triage says: triage.start --item <item_id>, then one triage.facts-save --item <item_id> (the item becomes Ready).",
    },
    pass_draft: {
      record: 'passes',
      param: 'pass_id',
      perm: 'intake:edit',
      label: 'Draft a pass email',
      description: 'Your AI agent drafts the pass email for a deal a person passed on; the person approves and sends it',
      fires: 'Pass with an email (the Inbox or the deal page), or Ask your AI agent on a pass email not written yet',
      cooldown: 10,
      deal: 'lib_intake_pass.dealOf',
      check: 'lib_intake_pass.askCheck',
      ended: 'lib_intake_pass.onCannot',
      instruction:
        "Draft the pass email of pass pass_id; never send it. 1) passes.list --pass <pass_id>: the item or deal, reason, criterion, revisit milestone and recipients (to). 2) intake.get --item <item> (or intake.verdict --deal <deal>) for the facts and the one-liner. 3) Write it warm and under 150 words, to the founder by first name: one or two things we liked, from the facts; what we are not convinced of, from the reason and criterion only (never the founders' personal traits); what would change our view. 4) passes.draft --pass <pass_id> --subject \"...\" --body \"...\" (--to when the pass has no recipients). That draft waits in Next for the person who passed.",
    },
  },
  search: 'lib_intake.search',
  timeline: 'lib_intake.timelineFor',
  today: 'lib_intake.today',
  settingsKeys: {
    intake: {
      reply_sla_days: 5,
      sweep: true,
      pass_reasons: ['team', 'market', 'product', 'traction', 'valuation', 'thesis_fit', 'timing', 'other'],
      pass_template: '',
    },
  },
  imports: {
    intake: {
      label: 'Deal list',
      perm: 'intake:edit',
      fields: [
        { key: 'company', label: 'Company', type: 'text', synonyms: ['Company name', 'Name', 'Startup', 'Organization', 'Organisation'] },
        { key: 'website', label: 'Website', type: 'url', synonyms: ['URL', 'Domain', 'Site', 'Web'] },
        { key: 'founder_name', label: 'Founder', type: 'text', synonyms: ['Founder name', 'CEO', 'Contact', 'Contact name'] },
        { key: 'founder_email', label: 'Founder email', type: 'email', synonyms: ['Email', 'Contact email', 'CEO email'] },
        { key: 'one_liner', label: 'One-liner', type: 'text', synonyms: ['Description', 'Tagline', 'Summary', 'Pitch'] },
        { key: 'deck_link', label: 'Deck link', type: 'url', synonyms: ['Deck', 'Pitch deck', 'DocSend', 'Deck URL'] },
        { key: 'note', label: 'Note', type: 'text', synonyms: ['Notes', 'Comment', 'Comments'] },
        { key: 'received', label: 'Received', type: 'day', synonyms: ['Date', 'Date added', 'Created', 'Received on'] },
      ],
      row: 'lib_intake.importRow',
    },
  },
};
