/**
 * Catalog: review templates, review cycles (draft, launch, phases,
 * reminders, close), participants, reviews (self, manager, peer, upward;
 * autosaved drafts, submit, share, acknowledge, HR sign-off), calibration
 * of final ratings and your AI agent's neutral review summaries.
 *
 * Your AI agent never writes, rates, ranks, calibrates, shares or decides a
 * review: those ops are people only. It drafts a summary of the period
 * (review-summaries.submit) that the manager may use or ignore.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const CYCLE = S('Review cycle id', { required: true });
const REVIEW = S('Review id', { required: true });
const PARTICIPANT = S('Participant id (one person in a cycle)', { required: true });
const TEMPLATE = S('Template id or name', { required: true });
const CKINDS = ['annual', 'half_year', 'quarterly', 'probation', 'project'];
const PHASES = ['goals', 'self', 'peer', 'upward', 'manager', 'calibration', 'sharing'];

const TEMPLATE_FIELDS = {
  description: S('What the template is for'),
  entity: S('Entity it is meant for (empty = all)'),
  scale: S('JSON {points: 3..7, labels: ["lowest", ..., "highest"]}'),
  sections: S('JSON list of sections [{kind: goals|competencies|questions, title, weight (0..100, goals and competencies), kinds: [self, manager, peer, upward], rate (goals), items: competencies [{name, description}] or questions [{text, help, required}]}]'),
  overall_kinds: S('JSON list of the review kinds that give an overall rating: self and/or manager'),
};

const CYCLE_FIELDS = {
  name: S('Name (default from the kind and period, e.g. "Annual review 2026")'),
  kind: S('annual | half_year | quarterly | probation | project', { enum: CKINDS }),
  entity: S('Entity (empty = every entity you may see)'),
  period_start: S('First day of the period reviewed'),
  period_end: S('Last day of the period reviewed'),
  template: S('Template id or name (default by kind)'),
  participants: S('JSON {entities: [...], departments: [...], employees: [...], exclude: [...], started_before: "YYYY-MM-DD", probation_ending: true} (empty = everyone in the entity)'),
  phases: S('JSON list [{key: goals|self|peer|upward|manager|calibration|sharing, start, end}] (default by kind)'),
  note: S('Note'),
};

module.exports = [
  { name: 'review-templates.list', method: 'GET', fn: 'lib_performance_reviews.templatesList', perm: 'performance:view', effect: 'read', desc: 'Review templates: their rating scale, sections (goals with weight, competencies with descriptions, questions) and who answers each section.', params: { archived: B('Include archived templates') } },
  { name: 'review-templates.get', method: 'GET', fn: 'lib_performance_reviews.templatesGet', perm: 'performance:view', effect: 'read', desc: 'One review template.', params: { template: TEMPLATE } },
  { name: 'review-templates.create', method: 'POST', fn: 'lib_performance_reviews.templatesCreate', perm: 'performance:full', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Add a review template (or copy one with --copy_of and change what you give). Launched cycles keep a copy of their template, so changes never touch reviews in progress.', params: Object.assign({ name: S('Template name', { required: true }), copy_of: S('Template to copy (id or name)') }, TEMPLATE_FIELDS) },
  { name: 'review-templates.update', method: 'POST', fn: 'lib_performance_reviews.templatesUpdate', perm: 'performance:full', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Change a review template (name, scale, sections, overall rating kinds, archived). Cycles already launched keep their copy.', params: Object.assign({ template: TEMPLATE, name: S('Template name'), archived: B('Archive (hide from new cycles)') }, TEMPLATE_FIELDS) },
  { name: 'review-templates.delete', method: 'POST', fn: 'lib_performance_reviews.templatesDelete', perm: 'performance:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a review template no cycle uses (archive it otherwise).', params: { template: TEMPLATE } },

  { name: 'cycles.list', method: 'GET', fn: 'lib_performance_reviews.cyclesList', perm: 'signed', effect: 'read', desc: 'Review cycles the caller runs, takes part in, reviews in or has reports in: kind, period, status (draft, active, closed), phases with their state today, progress counts per review kind.', params: { status: S('draft | active | closed | open | all (default)', { enum: ['draft', 'active', 'closed', 'open', 'all'] }) } },
  { name: 'cycles.get', method: 'GET', fn: 'lib_performance_reviews.cyclesGet', perm: 'signed', effect: 'read', desc: 'One review cycle: phases, template copy, participants rule, progress, and the caller\'s own participation.', params: { cycle: CYCLE } },
  { name: 'cycles.defaults', method: 'GET', fn: 'lib_performance_reviews.cyclesDefaults', perm: 'performance:full', effect: 'read', desc: 'Suggested name, period, phases with dates and template for a new cycle of a kind (the wizard starts from these).', params: { kind: S('annual | half_year | quarterly | probation | project', { enum: CKINDS }), entity: S('Entity (its fiscal year sets the annual period)'), start: S('First day of the first phase (default today)') } },
  { name: 'cycles.create', method: 'POST', fn: 'lib_performance_reviews.cyclesCreate', perm: 'performance:full', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Draft a review cycle. Everything you leave out comes from the kind (period, phases, template, everyone in the entity). Nothing reaches anyone until a person launches it.', params: CYCLE_FIELDS },
  { name: 'cycles.update', method: 'POST', fn: 'lib_performance_reviews.cyclesUpdate', perm: 'performance:full', agent: 'propose', kind: 'performance', effect: 'write', desc: 'Change a draft cycle (anything), or the name, note and phase dates of an active one.', params: Object.assign({ cycle: CYCLE }, CYCLE_FIELDS) },
  { name: 'cycles.preview', method: 'GET', fn: 'lib_performance_reviews.cyclesPreview', perm: 'performance:full', effect: 'read', desc: 'Who a draft cycle would include if launched today, and how many have no manager.', params: { cycle: CYCLE } },
  { name: 'cycles.launch', method: 'POST', fn: 'lib_performance_reviews.cyclesLaunch', perm: 'performance:full', agent: 'deny', effect: 'write', desc: 'Launch a draft cycle: copies the template, adds every participant with their self, manager and upward reviews, and tells reviewers what they owe.', params: { cycle: CYCLE } },
  { name: 'cycles.phase', method: 'POST', fn: 'lib_performance_reviews.cyclesPhase', perm: 'performance:full', agent: 'deny', effect: 'write', desc: 'Move a phase: start it now, end it now, set its days, or (drafts) remove it. Phases set due days and reminders.', params: { cycle: CYCLE, phase: S('goals | self | peer | upward | manager | calibration | sharing', { required: true, enum: PHASES }), action: S('start_now | end_now | set (default) | remove', { enum: ['start_now', 'end_now', 'set', 'remove'] }), start: S('Start day (set)'), end: S('End day (set)') } },
  { name: 'cycles.remind', method: 'POST', fn: 'lib_performance_reviews.cyclesRemind', perm: 'performance:full', agent: 'deny', effect: 'write', desc: 'Remind now everyone with a review still to finish in the open phases (once a day per review).', params: { cycle: CYCLE } },
  { name: 'cycles.close', method: 'POST', fn: 'lib_performance_reviews.cyclesClose', perm: 'performance:full', agent: 'deny', effect: 'write', desc: 'Close an active cycle: reviews are kept as they are and nothing more is written.', params: { cycle: CYCLE } },
  { name: 'cycles.delete', method: 'POST', fn: 'lib_performance_reviews.cyclesDelete', perm: 'performance:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a draft cycle.', params: { cycle: CYCLE } },
  { name: 'cycles.export', method: 'GET', fn: 'lib_performance_reviews.cyclesExport', perm: 'signed', agent: 'deny', effect: 'read', desc: 'CSV of cycle results the caller may see: per person review statuses, score, manager and calibrated rating with reason, days shared, acknowledged, signed.', params: { cycle: CYCLE } },

  { name: 'participants.list', method: 'GET', fn: 'lib_performance_reviews.participantsList', perm: 'signed', effect: 'read', desc: 'The people in a cycle the caller may see, with each review\'s status (who has not submitted), stage (open, submitted, shared, acknowledged, signoff, signed) and the rating when the caller may see it.', params: { cycle: CYCLE, stage: S('Only this stage'), department: S('Only this department'), missing: S('Only people with this review kind not submitted: self | manager | peer | upward | any', { enum: ['self', 'manager', 'peer', 'upward', 'any', ''] }), q: S('Name or number contains'), limit: N('Rows (default 100)'), offset: N('Rows to skip') } },
  { name: 'participants.get', method: 'GET', fn: 'lib_performance_reviews.participantsGet', perm: 'signed', effect: 'read', desc: 'One person in a cycle: the reviews the caller may read, the stage, rating and calibration history (when the caller may see them) and what the caller can do (share, acknowledge, add peers, calibrate).', params: { participant: PARTICIPANT } },
  { name: 'participants.add', method: 'POST', fn: 'lib_performance_reviews.participantsAdd', perm: 'performance:full', agent: 'deny', effect: 'write', desc: 'Add a person to an active cycle (a late joiner) with their reviews.', params: { cycle: CYCLE, employee: S('Employee number, id or email', { required: true }) } },
  { name: 'participants.remove', method: 'POST', fn: 'lib_performance_reviews.participantsRemove', perm: 'performance:full', agent: 'deny', effect: 'write', desc: 'Take a person out of a cycle (long leave, left); their reviews stop being owed. Not once their review was shared.', params: { participant: PARTICIPANT, note: S('Why') } },

  { name: 'reviews.list', method: 'GET', fn: 'lib_performance_reviews.reviewsList', perm: 'self', effect: 'read', desc: 'The caller\'s reviews: to_write (default, with due days), written, about_me (self reviews and shared manager reviews), team (reviews of their reports).', params: { view: S('to_write | written | about_me | team', { enum: ['to_write', 'written', 'about_me', 'team'] }) } },
  { name: 'reviews.get', method: 'GET', fn: 'lib_performance_reviews.reviewsGet', perm: 'signed', effect: 'read', desc: 'One review: its sections (the goals section lists the period\'s goals), scale, answers and ratings the caller may read, the person\'s other reviews the caller may read, your AI agent\'s draft summaries.', params: { review: REVIEW } },
  { name: 'reviews.context', method: 'GET', fn: 'lib_performance_reviews.reviewsContext', perm: 'signed', effect: 'read', desc: 'What the reviewer has at hand, limited to what they may see: goals and check-ins of the period, feedback and praise, trainings completed, earlier reviews. Your AI agent reads it for --summary <id>.', params: { review: REVIEW, summary: S('Summary request id (your AI agent: the job payload.summary)') } },
  { name: 'reviews.save', method: 'POST', fn: 'lib_performance_reviews.reviewsSave', perm: 'self', agent: 'deny', effect: 'write', desc: 'Autosave a draft review (reviewer only): answers, ratings and overall rating merge by key (<section>.<item> or <section>.<goal id>; empty or 0 clears).', params: { review: REVIEW, answers: S('JSON {"<key>": "text"}'), ratings: S('JSON {"<key>": 1..points}'), overall: N('Overall rating 1..points (0 clears)') } },
  { name: 'reviews.submit', method: 'POST', fn: 'lib_performance_reviews.reviewsSubmit', perm: 'self', agent: 'deny', effect: 'write', desc: 'Submit a review (saving what you give first). Refused with what is missing: required questions; for manager reviews every rating and the overall one.', params: { review: REVIEW, answers: S('JSON {"<key>": "text"}'), ratings: S('JSON {"<key>": 1..points}'), overall: N('Overall rating') } },
  { name: 'reviews.reopen', method: 'POST', fn: 'lib_performance_reviews.reviewsReopen', perm: 'performance:full', agent: 'deny', effect: 'write', desc: 'Send a submitted review back to its reviewer as a draft (before it is shared).', params: { review: REVIEW, note: S('What to change') } },
  { name: 'reviews.add-peer', method: 'POST', fn: 'lib_performance_reviews.reviewsAddPeer', perm: 'self', agent: 'deny', effect: 'write', desc: 'Ask peers to review a person (the person, their managers or HR; cycles with a peer phase; at most 10).', params: { participant: PARTICIPANT, reviewer: S('One peer (employee number, id or email)'), reviewers: S('JSON list of peers') } },
  { name: 'reviews.decline', method: 'POST', fn: 'lib_performance_reviews.reviewsDecline', perm: 'self', agent: 'deny', effect: 'write', desc: 'Decline a peer or upward review you were asked to write.', params: { review: REVIEW, reason: S('Why (shown to HR and the manager)') } },
  { name: 'reviews.reassign', method: 'POST', fn: 'lib_performance_reviews.reviewsReassign', perm: 'performance:full', agent: 'deny', effect: 'write', desc: 'Give a draft manager, peer or upward review to another reviewer (no manager, a manager who left).', params: { review: REVIEW, reviewer: S('New reviewer (employee number, id or email)', { required: true }) } },
  { name: 'reviews.remove', method: 'POST', fn: 'lib_performance_reviews.reviewsRemove', perm: 'performance:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a peer or upward review request that was not submitted.', params: { review: REVIEW } },
  { name: 'reviews.share', method: 'POST', fn: 'lib_performance_reviews.reviewsShare', perm: 'self', agent: 'deny', effect: 'write', desc: 'Share a submitted manager review (and final rating) with the person: the manager from the sharing phase, HR any time. They are asked to acknowledge it.', params: { participant: PARTICIPANT } },
  { name: 'reviews.share-all', method: 'POST', fn: 'lib_performance_reviews.reviewsShareAll', perm: 'performance:full', agent: 'deny', effect: 'write', desc: 'Share every submitted manager review of a cycle the caller may see.', params: { cycle: CYCLE } },
  { name: 'reviews.acknowledge', method: 'POST', fn: 'lib_performance_reviews.reviewsAcknowledge', perm: 'self', agent: 'deny', effect: 'write', desc: 'The person acknowledges their shared review, with an optional comment. Where the entity requires it, HR then signs it off (a review_signoff approval).', params: { participant: PARTICIPANT, comment: S('Your comment on the review') } },
  { name: 'reviews.request-summary', method: 'POST', fn: 'lib_performance_reviews.requestSummary', perm: 'self', agent: 'deny', effect: 'write', desc: 'The reviewer asks your AI agent for a neutral summary of the period (goals, check-ins, feedback) to use or ignore (the review_summary_draft trigger with the summary request). It never proposes a rating.', params: { review: REVIEW } },
  { name: 'review-summaries.submit', method: 'POST', fn: 'lib_performance_reviews.submitSummary', perm: 'signed', effect: 'write', desc: 'Your AI agent: answer a summary request (the summary_id of review_summary_draft) with a neutral, factual summary of the period and its sources. No ratings, rankings or comparisons. Closes the ask.', params: { summary: S('Summary request id (summary_id)', { required: true }), text: S('The summary (plain text, at most 8000 characters)', { required: true }), sources: S('JSON list [{kind: goal|checkin|feedback|praise|training|review, id, note}]') } },
  { name: 'review-summaries.mark', method: 'POST', fn: 'lib_performance_reviews.markSummary', perm: 'self', agent: 'deny', effect: 'write', desc: 'The reviewer marks your AI agent\'s summary as used or dismissed.', params: { summary: S('Summary id', { required: true }), status: S('used | dismissed', { required: true, enum: ['used', 'dismissed'] }) } },

  { name: 'calibration.view', method: 'GET', fn: 'lib_performance_reviews.calibrationView', perm: 'signed', effect: 'read', desc: 'Calibration of a cycle for HR and people leaders: rating distribution (final, else the manager\'s) per department and overall, people with manager rating, score, final rating, reason, history.', params: { cycle: CYCLE, department: S('Only this department') } },
  { name: 'calibration.adjust', method: 'POST', fn: 'lib_performance_reviews.calibrationAdjust', perm: 'self', agent: 'deny', effect: 'write', desc: 'Set a final rating after calibration with a reason (kept in history); 0 goes back to the manager\'s rating. Before sharing; HR and leaders above them.', params: { participant: PARTICIPANT, final: N('Final rating 1..points (0 = the manager\'s rating)', { required: true }), reason: S('Why', { required: true }) } },
];
