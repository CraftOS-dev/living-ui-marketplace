/**
 * Committee cron (firm zone): the weekly agenda kept assembled every
 * morning (a meeting is created on the meeting day when deals wait at IC),
 * condition owners told on the due day, and the yearly anti-portfolio
 * review (your AI agent looks up later outcomes of passed companies).
 */
module.exports = [
  { name: 'committee_assemble', schedule: '0 7 * * *', fn: 'lib_committee.cronAssemble', catchUp: true },
  { name: 'committee_conditions', schedule: '0 8 * * *', fn: 'lib_committee.cronConditions', catchUp: false },
  { name: 'committee_anti_portfolio', schedule: '0 9 15 1 *', fn: 'lib_committee.cronAntiPortfolio', catchUp: true },
];
