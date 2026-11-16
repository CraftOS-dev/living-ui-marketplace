/**
 * Catalog: interviews (panel, time, place or link, kit, Google Calendar),
 * scorecards per interviewer and the neutral summary your AI agent may
 * draft. Scorecards are written by interviewers only.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const INTERVIEW = S('Interview id', { required: true });
const KINDS = ['phone', 'video', 'onsite', 'technical', 'panel', 'other'];

const WHEN = {
  day: S('Day'),
  start: S('Start time HH:MM in the time zone'),
  timezone: S('Time zone (default the entity\'s), e.g. Asia/Singapore'),
  duration_min: N('Minutes (default the kit\'s, else 45)'),
  interviewers: S('JSON list of members (ids or emails); each gets a scorecard'),
  kind: S(KINDS.join(' | '), { enum: KINDS }),
  title: S('Round name, e.g. "Technical interview"'),
  kit: S('Interview kit id'),
  location: S('Room or address'),
  link: S('Video link (https://...)'),
  note: S('Note for the panel'),
};

module.exports = [
  { name: 'interviews.list', method: 'GET', fn: 'lib_hiring_interviews.list', perm: 'signed', effect: 'read', desc: 'Interviews in a window that the caller may see (or only the ones they are on with --mine true), plus the scorecards they owe and whether Google Calendar is connected.', params: { from: S('From day (default yesterday)'), to: S('To day (default two weeks on)'), status: S('scheduled | done | cancelled | no_show | all', { enum: ['scheduled', 'done', 'cancelled', 'no_show', 'all'] }), mine: B('Only interviews I am on'), opening: S('Opening'), application: S('Application'), limit: N('Rows') } },
  { name: 'interviews.get', method: 'GET', fn: 'lib_hiring_interviews.get', perm: 'signed', effect: 'read', desc: 'One interview: panel with each scorecard status, kit with criteria and questions, the caller\'s scorecard, the others once the caller submitted theirs (or for the hiring team), and the summary.', params: { interview: INTERVIEW } },
  { name: 'interviews.schedule', method: 'POST', preview: 'lib_hiring_interviews.previewSchedule', fn: 'lib_hiring_interviews.schedule', perm: 'hiring:edit', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Schedule an interview: day, start, time zone, minutes, panel, kind, kit, place or link. The panel is told; --calendar true also creates a Google Calendar event (when connected).', params: Object.assign({ application: S('Application id', { required: true }), stage: S('Stage it belongs to (default the current)'), calendar: B('Also add it to Google Calendar'), invite_candidate: B('Invite the candidate in the calendar event (default true)') }, WHEN, { day: S('Day', { required: true, example: '2026-11-12' }), start: S('Start time HH:MM in the time zone', { required: true, example: '14:30' }) }) },
  { name: 'interviews.update', method: 'POST', preview: 'lib_hiring_interviews.previewUpdate', fn: 'lib_hiring_interviews.update', perm: 'hiring:edit', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Move an interview or change its panel, kind, kit, place or link. New interviewers get a scorecard; removed ones lose an unsubmitted one.', params: Object.assign({ interview: INTERVIEW }, WHEN) },
  { name: 'interviews.cancel', method: 'POST', fn: 'lib_hiring_interviews.cancel', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Cancel an interview; the panel is told and unsubmitted scorecards go.', params: { interview: INTERVIEW, reason: S('Why') } },
  { name: 'interviews.set-status', method: 'POST', fn: 'lib_hiring_interviews.setStatus', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Record that an interview took place (done), that the candidate did not come (no_show), or schedule it again.', params: { interview: INTERVIEW, status: S('done | no_show | scheduled', { required: true, enum: ['done', 'no_show', 'scheduled'] }) } },
  { name: 'interviews.calendar', method: 'POST', fn: 'lib_hiring_interviews.calendarOp', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Add a scheduled interview to Google Calendar (when connected to your AI agent) with the panel and, by default, the candidate as guests.', params: { interview: INTERVIEW, invite_candidate: B('Invite the candidate (default true)') } },
  { name: 'interviews.summary', method: 'POST', fn: 'lib_hiring_interviews.summary', perm: 'hiring:edit', agent: 'propose', kind: 'hiring', preview: 'lib_hiring_interviews.previewSummary', effect: 'write', desc: 'Save a summary of an interview\'s submitted scorecards: a neutral account of what interviewers wrote, where they agree and differ. Never a recommendation, score or ranking.', params: { interview: INTERVIEW, summary: S('The summary (empty clears it)', { required: true }) } },
  { name: 'interviews.summarize', method: 'POST', fn: 'lib_hiring_interviews.summarize', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Ask your AI agent for a neutral summary of the submitted scorecards (the interview_summary trigger with the interview); it comes back as a proposal on interviews.summary. Asked once while that ask is open.', params: { interview: INTERVIEW } },

  { name: 'scorecards.mine', method: 'GET', fn: 'lib_hiring_interviews.scorecardsMine', perm: 'signed', effect: 'read', desc: 'The caller\'s scorecards (owed, submitted or all) and the ones owed now.', params: { status: S('owed | submitted | all', { enum: ['owed', 'submitted', 'all'] }), limit: N('Rows') } },
  { name: 'scorecards.get', method: 'GET', fn: 'lib_hiring_interviews.scorecardGet', perm: 'signed', effect: 'read', desc: 'The caller\'s scorecard for an interview with the kit criteria, questions, the scale and the candidate\'s basics.', params: { interview: INTERVIEW } },
  { name: 'scorecards.save', method: 'POST', fn: 'lib_hiring_interviews.scorecardSave', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Save or submit your scorecard: recommendation (strong_no, no, yes, strong_yes), a score of 1 to 4 per kit criterion, notes. Interviewers only.', params: { interview: INTERVIEW, recommendation: S('strong_no | no | yes | strong_yes', { enum: ['strong_no', 'no', 'yes', 'strong_yes'] }), scores: S('JSON {"<criterion key>": 1 to 4}'), notes: S('Notes: what you saw and heard'), submit: B('Submit (the others then see it)') } },
];
