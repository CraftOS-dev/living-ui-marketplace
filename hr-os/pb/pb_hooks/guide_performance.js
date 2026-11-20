/**
 * app.guide section: performance (goals, review cycles, calibration,
 * feedback, skills, training). Plain data; tools/gen_triggers.mjs reads the
 * instruction of review_summary_draft.
 */
module.exports = {
  title: 'Performance',
  rules: [
    'Employment decisions are high risk: you summarise and draft, you never rate, rank, calibrate, compare people, recommend a rating, promotion, pay change or termination, or decide anything about a review. Reviews, ratings, calibration, sharing, acknowledgement and sign-off are people only.',
    'Goals: goals.list (--view mine|team|company|all --employee --status --needs_update true), goals.get --goal, goals.tree. New goals, changes and check-ins (goals.create, goals.update, goals.checkin) are proposals a person accepts; say why with --why. Key results are JSON [{key, title, start, target, current, unit}]; a check-in gives --key_results \'{"kr1": 40}\' and a short --note.',
    'Review cycles: cycles.list, cycles.get --cycle, participants.list --cycle --missing self|manager|any (who has not submitted). You may draft a cycle or a template (cycles.create, review-templates.create, proposals); launching, phases, reminders, closing and every review write are people only.',
    'Feedback and praise are in people\'s own words: you read them (feedback.list --view wall|about) but never give, ask for or delete them.',
    'Skills: skills.list, skills.matrix; a person\'s levels are set with employee-skills.set (people only verify). Training: trainings.list, trainings.get, trainings.compliance (--state overdue); scheduling, enrolment, attendance and requirements are proposals.',
    'When you report on reviews, use only what the ops return and the person asking may see; never infer protected characteristics (age, health, family, religion, origin) or intentions.',
    'Op details: company and team goals are visible to everyone; personal goals to the person, their managers and HR. goals.import-check CSV columns: title (required), employee or department (neither = a company goal), kind, description, weight, start_day, due, status, kr_title, kr_start, kr_target, kr_current, kr_unit. trainings.attendance statuses: enrolled, attended, completed, no_show, cancelled. calibration.view applies no automatic curve.',
    'trainings.attendance --rows example: [{"employee":"E0001","status":"completed","score":92,"result":"pass"}] (or "attendee":"<attendee id>" in place of employee).',
  ],
  triggers: {
    review_summary_draft: 'A reviewer asked you for a neutral summary of a person\'s period for one review (params.summary_id). reviews.context --review <the summary\'s review> --summary <summary_id> (review-summaries are listed on reviews.get) gives the goals and check-ins, feedback and praise, trainings and earlier reviews the reviewer may see for the period. Write plain text (short paragraphs): where each goal stands with its numbers and last check-in, what changed with dates, themes in feedback and praise (quote briefly), trainings completed, and gaps in the record. Describe; never give or suggest a rating, score, ranking, comparison or a recommendation on pay, promotion or employment, and never guess at causes, health, family or intentions. Done: review-summaries.submit --summary <summary_id> --text "<the summary>" --sources \'[{"kind":"goal","id":"<id>"}]\'.',
  },
  recipes: {
    review_summary_draft: [
      'Write a neutral summary of a person\'s period for the reviewer of a review (review_summary_draft; params.summary_id); never a rating.',
      '1) reviews.context --review <the review of the summary request> --summary <summary_id>: the goals and check-ins, feedback and praise, trainings and earlier reviews the reviewer may see, for the period.',
      '2) Write plain text (under 2000 words, short paragraphs): goals and where each stands (progress, status, key results with their numbers, the last check-in), what changed during the period with dates, themes in the feedback and praise received (quote briefly, name the writer only when the source names them), trainings completed, and gaps in the record (for example no check-ins since a day, goals without key results). Describe; do not judge.',
      '3) Never give or suggest a rating, a score, a ranking, a comparison with other people, or a recommendation on pay, promotion or employment; never guess at causes, health, family or intentions. If the record is thin, say so.',
      '4) review-summaries.submit --summary <summary_id> --text "<the summary>" --sources \'[{"kind":"goal","id":"<goal id>"},{"kind":"feedback","id":"<id>"}]\'. That closes the ask.',
    ],
  },
  events: [
    'goal.checked_in { goal, employee, progress, status }',
    'review_cycle.launched { cycle, participants }',
    'review.submitted { review, cycle, kind, employee }',
    'review.shared { participant, cycle, employee }',
    'review.acknowledged { participant, cycle, employee, signoff }',
    'review.signed { participant, cycle, employee }',
    'training.completed { attendee, employee, program, completed_on }',
  ],
};
