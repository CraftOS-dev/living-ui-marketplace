/**
 * app.guide section and recipes of the deals module (pipelines, the deal
 * page, meeting notes) and the full recipe of its trigger. Plain data.
 */
module.exports = {
  title: 'Deals, the pipeline and meeting notes',
  section: [
    'The pipeline: deals.board (stages with counts and stall flags, each column in the order the team placed the cards; deals.reorder is people only), deals.funnel (the cohort of this quarter: Inbound, the intake items received, then how many of them reached each stage, each bar over the one before; deals in each stage now), deals.stalls (deals past their stage\'s stall days). Pipelines deal_flow, spv, lp_raise and program share one board (pipelines.list).',
    'You never move, pass, hold or close a deal: deals.move and deals.merge are proposals a person accepts; deals.status is people only. Asked to pass a deal: passes.request --deal <D-0007> --reason valuation --criterion "<their words>" (a proposal; accepting passes it and the app asks you for its email: trigger pass_draft, passes.draft --pass <id>).',
    'Notes: notes.list --deal, notes.get --note (sections, transcript text, summary, review). A person\'s note is theirs: never change its text. You may write your own notes (notes.create), but most of your note work is the review of a person\'s note (trigger note_review { note_id }).',
    'A note\'s review shows to the person as a picture: Saved, Reading, Summary, Ready. What you find arrives as one-click changes: each deal change is its own deals.update proposal with the sentence that supports it.',
  ],
  events: ['note.saved { note, deal }', "record.merged { kind: 'deals', keep, drop }"],
  note_review: [
    'Review a saved meeting note (trigger note_review { note_id }).',
    '1) notes.get --note <note_id>: the template\'s sections (key, label), the person\'s text per section, the transcript text, the deal and its stage. deals.get --deal <deal> for the fields as they stand.',
    '2) For every deal fact the note states that differs from the deal or fills an empty field (round type, raise, pre or post money, the firm\'s check, currency, instrument, source): deals.update --deal <deal> --<field> <value> --evidence "<the exact sentence from the note or transcript>" --confidence <0 to 1> --why "<one line>", ONE call per field so each change is accepted on its own. Keep each proposal id the answer gives. Never propose from a guess.',
    '3) For every next step stated with an owner: tasks.save --title "<the step>" --ref_collection deals --ref_id <deal> --deal <deal> --assignee <the member who owns it, by email>, with --due_day only when the note names a real date or a day you can compute exactly ("by Friday" from the meeting day). A vague intention ("let\'s catch up soon") is not a date and not a task. Keep the task ids.',
    '4) For every reference call the note records (someone who spoke about the founders or the company): refs.log --deal <deal> --person <id or email> (or --name) --kind provided|backchannel|customer|expert --signal positive|neutral|negative --note "<short>"; a reference only offered (not called yet): --offered true without a signal. Keep the ids.',
    '5) notes.summary-save --note <note_id> --headline "<one line>" --sections \'{"<key>":"<summary>"}\' using only the template\'s section keys, short plain sentences drawn from the note and the transcript, nothing invented; then --proposals, --tasks and --refs with the ids from steps 2 to 4 (JSON lists). Never write in the person\'s own sections, never judge the founders\' personal traits.',
    '6) That save marks the review done for the person who asked; its proposals show "From a meeting note". When you cannot review it: agent.cannot --trigger note_review --record <note_id> --reason "<why>".',
  ],
};
