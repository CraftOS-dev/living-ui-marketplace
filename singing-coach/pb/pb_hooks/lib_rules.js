/// <reference path="../pb_data/types.d.ts" />
/**
 * The operations to use instead of writing a collection directly.
 */

const OPS_ONLY = {
  settings: 'settings.update',
  voice: 'voice.test',
  songs: 'songs.add, songs.update, songs.remove or songs.restore',
  progress: 'runs.save (progress follows the practice), songs.transpose or songs.reset',
  runs: 'runs.save or runs.dispute',
  tracks: 'runs.track',
  sessions: 'runs.save, sessions.end or sessions.review',
  checkins: 'health.checkin',
  messages: 'coach.send, coach.reply or sessions.review',
  plans: 'plan.set, plan.start, plan.done or plan.reset',
  lessons: 'learn.lesson',
  skills: 'drills.save',
  drills: 'drills.save',
};

/** Refuse a direct API write to a collection that changes only through operations. */
function refuse(rec) {
  const name = rec.collection().name;
  throw new BadRequestError('"' + name + '" records change only through the app\'s operations, which keep progress, sessions, plans and the voice record in step. Use ' + (OPS_ONLY[name] || 'the app operations') + ' (see app.guide).');
}

module.exports = { OPS_ONLY: OPS_ONLY, refuse: refuse };
