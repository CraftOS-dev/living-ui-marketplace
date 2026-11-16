/**
 * app.guide section: the kernel (the firm, Next, proposals, asking your AI
 * agent, outbound, tasks, imports) and the full recipe of question_asked.
 * Plain data.
 */
module.exports = {
  title: 'The firm, Next and asking your AI agent',
  section: [
    'Funds and entities: entities.list (the management company, funds, SPVs with their LPA terms). Changing them is people only.',
    'Next is the one queue of what needs a person (next.list). Your drafts and proposals land there; people clear it in Focus mode.',
    'Messages: outbound.draft --kind request|notice|lp_pack|digest|reply --module <module> --to \'["a@b.com"]\' --subject --body drafts a message a person approves and sends (outbound.approve is people only). A pass email goes on its pass (passes.request, then passes.draft) and an intro ask on its intro (intros.request, then intros.draft). Change your own untouched draft with outbound.update; never send anything yourself.',
    'Tasks: tasks.save --title --assignee <member> --due_day --ref_collection --ref_id opens a follow-up (stated next steps only; a vague intention is not a date). Completing a person\'s task is theirs.',
    'Comments: comments.add --ref_collection --ref_id --body (marked as yours).',
    'Imports: imports.targets lists what can be imported and the columns each takes; imports.preview checks a file (--csv text or --path) and changes nothing; imports.run commits up to 200 rows (a proposal for you). Asked to bring a list in: read the file, pick the target, imports.preview with the columns renamed to its fields (dates YYYY-MM-DD, plain numbers; never invent a value, leave unknowns empty), fix what it reports, then imports.run in batches of 200 (--import <id> for the next batch).',
    'Exchange rates: fx.convert --amount --from --to --day [--mode avg --from_day] answers the converted amount, or minor null with a reason; never convert by your own rate.',
    'When something needs a person\'s decision, say so in your answer (chat.answer), or open a task for them (tasks.save --assignee). When a trigger asked you for something you cannot do: agent.cannot --trigger <name> --record <id> --reason "<why>"; the person sees it on the record.',
  ],
  events: [
    'entity.created { entity, kind }',
    'entity.updated { entity, kind }',
    'setup.completed { firm, fund, member }',
    'outbound.sent { outbound, kind, module, ref_collection, ref_id, deal }',
    'outbound.failed { outbound, kind, module, ref_collection, ref_id, deal }',
  ],
  question_asked: [
    'Answer or do what a person told you in Venture OS (trigger question_asked { ask_id }).',
    '1) chat.get --ask <ask_id>: the question, where the person was (context), the top of the asker\'s Next (asker_next) and the local time; next.list --member <asked_by> reads more while the question waits. Read what you need through the ops (search.query, the module ops of the topic). Answer only from what the app returned and what the asker may see; mark anything unknown as unknown.',
    '2) When the text asks for a change, make it through the op (it may become a proposal) and say what the app returned. When it asks for something people only do (advance, vote, approve, send), say where they do it (the refusal names the screen); never ask for a PIN. Asked to pass a deal or to ask for an intro: propose it (passes.request, intros.request); the email follows as its own trigger once a person accepts.',
    '3) chat.answer --ask <ask_id> --answer "<short plain answer, with the numbers, dates and record names you used>" (marks it done). The answer shows under the ask bar and the asker is told.',
  ],
};
