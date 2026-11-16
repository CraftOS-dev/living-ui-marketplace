/**
 * app.guide section: lifecycle (onboarding and offboarding checklists,
 * letters, separations, assets, the handbook, grievances).
 */
module.exports = {
  title: 'Lifecycle: onboarding, letters, separations, assets, handbook, grievances',
  rules: [
    'Onboarding starts by itself on every hire (employment.hired) from the entity default template; offboarding on every approved separation. lifecycle.home shows who starts and leaves in the next 30 days and what is overdue; checklists.get --checklist <id> shows one board.',
    'Tasks belong to a lane: hr, manager, it, employee (the person), a named member, or agent (you). tasks.list (view mine) lists yours; finish each with tasks.complete --task <id> --note "<what you did or the draft>". You may complete only tasks assigned to you; never mark a person\'s task done.',
    'Templates: checklist-templates.list and .save (a proposal). Due offsets count from the first day (onboarding) or the last day (offboarding); a document task completes with an upload (--path for you). checklist-templates.seed --entity adds the country defaults an entity lacks.',
    'Letters: letter-templates.list shows the kinds and placeholders. letters.draft --employee E0001 --template "<name>" (or --kind custom --body "<markdown with {{placeholders}}>") makes a draft (a proposal). letters.update --letter L0001 --body changes a draft (a proposal). People issue letters (letters.issue): you never issue, void or send one.',
    'Separations are decided by people only: you read them (separations.list, separations.get) but never request, approve or withdraw one. Exit interview answers are confidential to HR and never shown to you. separations.settlement --separation S0001 is the full and final statement.',
    'Assets: assets.list, assets.add, assets.issue, assets.return (proposals). Never invent serial numbers or values.',
    'Handbook: answer people\'s policy questions from handbook.text (--employee <the asker> keeps the pages they read); name the page title and version you used, and say plainly when the handbook does not cover the question. handbook.save drafts a page (a proposal); people publish.',
    'Grievances are confidential: you see one only when HR shared it with you (grievances.share --agent true). Never guess who reported an anonymous case, never repeat its content to anyone, never contact the people involved.',
    'checklist-templates.save --tasks is the whole list in order, for example [{"title":"Prepare the laptop","assignee":"it","due_offset_days":-3,"kind":"task"}]. letter-templates.save placeholders include {{employee.name}}, {{job.title}}, {{entity.legal_name}}, {{letter.date}} and {{letter.<word>}} for a value given with each letter.',
    'letters.draft --kind without --template takes the template of that kind for the entity of the person, else its country, else the whole company (a built-in one first); with none it is refused (no_template) listing the templates of that kind. Your own --body needs no template.',
    'exit-forms.save --questions example: [{"key":"reason","label":"What made you decide to leave?","type":"choice","options":["..."]}]; the types are text, rating (1 to 5), choice and yes_no.',
  ],
  triggers: {
    letter_draft: 'HR asked you to write the text of one letter (params.letter_id). letters.get --letter <letter_id> gives the draft, the person, the kind, the language and agent.note (HR\'s instructions); people.get --employee <number> the facts. Use only facts from the records and the instructions; never invent dates, amounts or promises. Write markdown in the letter\'s language and prefer placeholders over typed facts ({{employee.name}}, {{job.title}}, {{employment.start_day}}, {{entity.legal_name}}, {{letter.date}}, {{signer.name}}; letter-templates.list lists them). Done: letters.update --letter <letter_id> --title "<title>" --body "<markdown>" --why "<what you wrote, from which records>" (a proposal HR accepts and issues). Unclear instructions: hand the question to HR with inbox.route instead of guessing.',
    onboarding_help: 'Do the open tasks assigned to you on one onboarding or offboarding checklist (params.checklist_id). checklists.get --checklist <checklist_id> lists them (lane agent); people.get --employee <number> gives role, team, manager, start or last day and location. For each task do it from the records: drafts (a welcome note, a first-week plan) go in the note, tasks.complete --task <id> --note "<the draft, plain text>"; a letter task: letters.draft --employee <number> --template "<the matching template>" --why "..." (a proposal), then tasks.complete --task <id> --note "Drafted letter <number> for HR to issue". A task that needs a person (a signature, a decision): tasks.update --task <id> --assignee hr --why "<what is needed>" (a proposal). Done when none of your tasks is open.',
  },
  recipes: {
    letter_draft: [
      'Write the text of a letter HR asked for (letter_draft; params.letter_id).',
      '1) letters.get --letter <letter_id> (the draft, the person, the kind, the language and agent.note: HR\'s instructions) and people.get --employee <the letter\'s employee number>. Use only facts from the records and the instructions, never invent dates, amounts or promises.',
      '2) Write the letter in markdown in its language. Prefer placeholders over typed facts ({{employee.name}}, {{job.title}}, {{employment.start_day}}, {{entity.legal_name}}, {{letter.date}}, {{signer.name}}, {{signer.title}}; letter-templates.list lists them), so the issued letter uses the records of the letter day.',
      '3) letters.update --letter <letter_id> --title "<title>" --body "<markdown>" --why "<one line: what you wrote and from which records>" (a proposal HR accepts). That closes the ask. If the instructions are unclear, hand the question to HR with inbox.route instead of guessing.',
    ],
    onboarding_help: [
      'Do the tasks assigned to you on an onboarding or offboarding checklist (onboarding_help; params.checklist_id).',
      '1) checklists.get --checklist <checklist_id> (your tasks are in the agent lane) and people.get --employee <the checklist\'s employee number> (role, team, manager, start or last day, location).',
      '2) For each open task of yours: do it from the records. Drafts (a welcome note, a first-week plan) go in the note: tasks.complete --task <id> --note "<the draft, plain text>". A task to draft a letter: letters.draft --employee <number> --template "<the matching template>" --why "..." (a proposal), then tasks.complete --task <id> --note "Drafted letter <number> for HR to issue".',
      '3) When a task needs a person (a signature, a decision), give it to them: tasks.update --task <id> --assignee hr (or manager, it, employee) --why "<what is needed>" (a proposal). When none of your tasks is open the ask is closed.',
    ],
  },
  events: [
    'separation.approved { separation, employment, last_day, kind }  (subscribers may answer { payrun: "<termination run id>" }; it is kept as the settlement pay run)',
    'separation.changed { separation, employment, last_day, kind }  (the last day of an approved separation moved)',
    'checklist.completed { checklist, employment, kind }',
  ],
};
