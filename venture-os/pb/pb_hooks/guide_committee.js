/**
 * app.guide section and recipes: the committee (memos, IC meetings, blind
 * votes, decisions, conditions, anti-portfolio). Plain data; the kernel
 * serves every recipe with the closing data rule.
 */
module.exports = {
  title: 'Committee: memos, meetings, votes and decisions',
  section: [
    'Diligence answers count only once a person confirmed them: memo drafts, bear cases and the decision snapshot use confirmed answers, never proposed ones.',
    'Memos: memos.get --deal D-0012 shows the decision snapshot, every section with its kept text, your drafted changes (proposed), citations and the AI-use disclosure. You draft objective sections only, as tracked changes: memos.draft-block --deal --section --text --citations (when a person asks you in chat to draft a section, do it the same way). You never write the thesis, the recommendation or the scenarios (people only; refused), never keep, discard or submit.',
    'Text markup: [n] cites the n-th item of --citations; [?] right after a figure marks it uncited. Citations stay in the deal\'s scope: {"kind":"anchor","anchor":"<id>"} from anchors.create on this deal\'s files or emails, {"kind":"note","note":"<id>"} of its notes, {"kind":"url","url":"<link>","source":"<publisher>"} for a named public source. Another deal\'s files are refused.',
    'Meetings: meetings.list (the next meeting in full), meetings.get --meeting IC-003. meetings.agenda adds deals at stage IC and deals with a submitted memo to the next meeting. meetings.add-item is a proposal. Starting, running and closing meetings is people only.',
    'committee.next-step --deal D-0030 names the next committee step on a deal for whoever asks (vote, reveal, record, open, schedule, or null); for you it is open or schedule (a deals.move proposal).',
    'Votes are blind: votes.status gives counts and who voted, never a choice, and nothing else reveals one. You never vote, reveal or record a decision; when asked, say the facilitator does it in the meeting room.',
    'Decisions: decisions.list, decisions.get, decisions.anti-portfolio. A decision is never edited; decisions.review-note --decision --event --text --source_url --source_name adds a later public outcome beside it. Conditions: conditions.list; conditions.complete --condition --proof is a proposal.',
  ],
  events: ['decision.recorded { decision, deal, outcome, corrects }'],
  memo_sections: [
    'Draft the memo sections a partner asked for (trigger memo_sections { memo_id, sections }).',
    '1) memos.get --memo <memo_id> for the snapshot, the sections and what is already written. Read the record: deals.get, diligence answers with status confirmed only (an answer still proposed is not a fact; leave it out), intake facts with their grades, notes, files.text for the deal room (its NDA files open while you are asked).',
    '2) For each key in sections, write the section from that record only: objective, short paragraphs, no adjectives about founders as people. Every figure gets a citation: make anchors with anchors.create --file --page --quote and cite them [1], [2]; a public figure gets a url citation with its publisher. A figure you cannot source gets [?] after it. Unknown stays unknown.',
    '3) memos.draft-block --memo <memo_id> --section <key> --text "..." --citations \'[...]\' for each section; the first marks the ask done. Never thesis, recommendation or scenarios. A memo that is no longer a draft: agent.cannot --trigger memo_sections --record <memo_id> --reason "<why>".',
  ],
  bear_case: [
    'Write the bear case of an agenda item (trigger bear_case { item_id }): the risks and the evidence against the thesis, cited, with no recommendation.',
    '1) meetings.get for the item, memos.get --deal <its deal>, then the deal\'s record: diligence answers with status confirmed only (never a proposed one), facts with grades, notes, references and the room files (files.text).',
    '2) List 3 to 8 points: kind risk (what could go wrong and why it matters) or contrary (a fact in the record that cuts against the memo\'s claims). Each point one or two sentences, each with citations ([n]) in the deal\'s scope. No vote, no score, no recommendation, nothing about founders\' personal traits.',
    '3) bearcase.save --item <item_id> --points \'[{"kind":"risk","text":"... [1]","citations":[...]}]\' (marks the ask done).',
  ],
  anti_portfolio: [
    'Record what happened later to companies the firm passed on (trigger anti_portfolio, on request or yearly while its switch is on).',
    '1) decisions.anti-portfolio lists passed companies with the reason, the round then and the review notes already there.',
    '2) For each company, look for later public outcomes from reputable public sources (a funding round, an acquisition, an IPO, a shutdown). Record only what a source states, with its date: decisions.review-note --decision <id> --event raised|acquired|ipo|shut_down|pivoted|still_private|other --text "<one line as published>" --source_url <link> --source_name <publisher> --day YYYY-MM-DD. Skip companies with nothing new; never repeat a note already there.',
    '3) Your first review note marks the ask done. With nothing new anywhere: agent.cannot --trigger anti_portfolio --reason "Nothing new: <what you checked>".',
  ],
};
