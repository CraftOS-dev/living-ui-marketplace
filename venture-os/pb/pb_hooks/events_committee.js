/**
 * Committee registrations (SPEC 4.2): a deal reaching IC joins the next
 * meeting's agenda; a deal closed elsewhere leaves it; Next items (votes
 * due, reveals and decisions to record, conditions due, drafted memo
 * sections); its triggers (memo_sections, bear_case, anti_portfolio);
 * search, timeline and today; the
 * committee settings (scale, voters, cooling-off, rule, meeting day).
 *
 * Event this module emits:
 *   decision.recorded { decision, deal, outcome, corrects }
 */
module.exports = {
  on: { 'deal.moved': 'lib_committee.onDealMoved', 'deal.closed': 'lib_committee.onDealClosed' },
  needsYou: 'lib_committee.needsYou',
  triggers: {
    memo_sections: {
      record: 'memos',
      param: 'memo_id',
      perm: 'committee:edit|pipeline:edit',
      label: 'Draft memo sections',
      description: 'Your AI agent drafts the objective sections of an investment memo as tracked changes, every figure cited; never the thesis or the recommendation',
      fires: 'Draft on a memo (the sections a partner picked)',
      cooldown: 10,
      params: { sections: { type: 'string', description: 'Comma-separated section keys to draft' } },
      deal: 'lib_committee_memos.memoDeal',
      nda: true,
      check: 'lib_committee_memos.askCheck',
      asked: 'lib_committee_memos.onAsked',
      instruction:
        "Draft the memo sections named in sections (comma-separated keys) of memo memo_id, as tracked changes. 1) memos.get --memo <memo_id>: the snapshot, the sections and what is written. Read the record: deals.get, diligence answers with status confirmed only, intake facts with their grades, notes, files.text for the deal room. 2) For each key, write the section from that record only: objective, short paragraphs. Cite every figure ([n] with --citations: anchors from anchors.create, notes, or a url with its publisher); mark a figure you cannot source [?]. 3) memos.draft-block --memo <memo_id> --section <key> --text \"...\" --citations '[...]' for each (the first marks it done). Never the thesis, recommendation or scenarios.",
    },
    bear_case: {
      record: 'agenda_items',
      param: 'item_id',
      perm: 'committee:edit',
      label: 'Write a bear case',
      description: 'Your AI agent writes the bear case of a committee agenda item: risks and contrary evidence, cited, with no recommendation',
      fires: 'Bear case on an agenda item',
      cooldown: 10,
      deal: 'lib_committee.itemDeal',
      nda: true,
      check: 'lib_committee_meetings.bearCheck',
      instruction:
        "Write the bear case of committee agenda item item_id: the risks and the evidence against the thesis, cited, with no recommendation. 1) meetings.get for the item, memos.get --deal <its deal>, then the deal's record: diligence answers with status confirmed only, facts with grades, notes, references and the room files (files.text). 2) List 3 to 8 points: kind risk (what could go wrong and why it matters) or contrary (a fact in the record against the memo's claims), one or two sentences each, cited [n] in the deal's scope. 3) bearcase.save --item <item_id> --points '[{\"kind\":\"risk\",\"text\":\"... [1]\",\"citations\":[...]}]' (marks it done). No vote, no score, nothing about founders' personal traits.",
    },
    anti_portfolio: {
      record: '',
      param: '',
      perm: 'committee:view',
      label: 'Review the anti-portfolio',
      description: 'Your AI agent looks up what happened later to the companies the firm passed on (public outcomes with their sources)',
      fires: 'Ask your AI agent on the anti-portfolio, or every January 15 while the switch is on',
      cooldown: 72000,
      policy: { key: 'anti_portfolio', label: 'Yearly anti-portfolio review', tip: 'Every January 15: what happened later to the companies the firm passed on.' },
      check: 'lib_committee.antiCheck',
      instruction:
        "Record what happened later to the companies the firm passed on. 1) decisions.anti-portfolio: passed companies with the reason, the round then and the review notes already there. 2) For each, look for later public outcomes in reputable sources (a round, an acquisition, an IPO, a shutdown). Record only what a source states, with its date: decisions.review-note --decision <id> --event raised|acquired|ipo|shut_down|pivoted|still_private|other --text \"<one line as published>\" --source_url <link> --source_name <publisher> --day YYYY-MM-DD (the first marks it done). Skip companies with nothing new; never repeat a note already there.",
    },
  },
  search: 'lib_committee.search',
  timeline: 'lib_committee.timelineFor',
  today: 'lib_committee.today',
  settingsKeys: {
    committee: {
      scale: 'no_three',
      voter_roles: [],
      seniority: ['scout', 'analyst', 'platform', 'finance', 'principal', 'venture_partner', 'partner', 'owner'],
      cooling_hours: 24,
      rule: 'consensus',
      meeting_weekday: 1,
      meeting_time: '10:00',
      auto_meeting: true,
      condition_days: 14,
    },
  },
};
