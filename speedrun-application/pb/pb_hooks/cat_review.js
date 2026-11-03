/**
 * Catalog: the checks and the odds.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  {
    name: 'review.checks',
    method: 'GET',
    fn: 'lib_checks.list',
    effect: 'read',
    desc: 'Every check against speedrun\'s published guidance (team, clarity, insight, momentum, video, form) with pass, fail or wait, why it matters (with the source) and the fix; the do-first list; and the reviewer\'s progress.',
    params: { status: S('Only this status', { enum: ['pass', 'fail', 'wait', 'na'] }), group: S('Only this group', { enum: ['before', 'team', 'clarity', 'idea', 'traction', 'video', 'form'] }), brief: B('One line per check, no do-first list') },
  },
  { name: 'review.odds', method: 'GET', fn: 'lib_odds.get', effect: 'read', desc: 'The estimated chance of getting into the speedrun cohort, its band and rank, and every factor with its effect (an estimate from what speedrun publishes, not speedrun\'s number).', params: {} },
];
