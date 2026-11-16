/**
 * Deals module registrations (SPEC 4.2). Plain data.
 *
 * Next: stalled deals for their point partner (kind stall). Tasks due today
 * are the kernel's (lib_tasks.nextItems); a meeting without a note is
 * network's (kind note).
 *
 * decision.recorded (committee) moves the deal: invest to Term sheet, pass
 * and hold as statuses, more diligence back to Diligence.
 *
 * Events this module emits:
 *   note.saved     { note, deal }   (when a person saves a note; Ask your AI agent reviews it)
 *   record.merged  { kind: 'deals', keep, drop }   (deals.merge, inside its undo unit)
 */
module.exports = {
  on: {
    'meeting.ended': 'lib_deals_notes.onMeetingEnded',
    'record.merged': 'lib_deals_notes.onMerged',
    'decision.recorded': 'lib_deals_flow.onDecision',
  },
  needsYou: 'lib_deals_flow.needsYou',
  triggers: {
    note_review: {
      record: 'notes',
      param: 'note_id',
      perm: 'pipeline:edit|portfolio:edit',
      label: 'Review a meeting note',
      description: 'Your AI agent reviews a saved meeting note: a summary, deal field changes for a person to accept, tasks for stated next steps and reference calls',
      fires: 'Ask your AI agent on a saved note',
      cooldown: 10,
      deal: 'lib_deals_notes.dealOfNote',
      check: 'lib_deals_notes.askCheck',
      instruction:
        "Review the saved meeting note note_id; never change the person's text. 1) notes.get --note <note_id>: the sections, the transcript text and the deal; deals.get --deal <deal> for the fields as they stand. 2) Each deal fact the note states that differs or fills an empty field: deals.update --deal <deal> --<field> <value> --evidence \"<the exact sentence>\" --confidence --why, one call per field. 3) Each next step with an owner: tasks.save --title --ref_collection deals --ref_id <deal> --assignee <member> (--due_day only for a real date). 4) Each reference call: refs.log. 5) notes.summary-save --note <note_id> --headline --sections '{...}' --proposals --tasks --refs (marks the review done).",
    },
  },
  search: 'lib_deals_notes.search',
  timeline: 'lib_deals_notes.timelineFor',
};
