/**
 * Catalog: the deals module's pipeline views (the stage funnel, stalled
 * deals), the board order of a column (deals.reorder, people only) and deal merges. Board, list, moves and status are kernel-records'
 * (cat_deals_core.js). Your AI agent reads both views; a merge is a
 * proposal (kind merges, promotable by the owner).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

module.exports = [
  {
    name: 'deals.funnel',
    method: 'GET',
    fn: 'lib_deals_flow.opFunnel',
    perm: 'signed',
    agent: 'allow',
    effect: 'read',
    desc: 'Cohort funnel of a quarter (default this one). Deal flow: bar Inbound = intake items received in it, then per stage how many of that cohort ever reached it (other pipelines: deals created in it). Bars only shrink; conversion_ppm = a bar over the bar before (null when none). Stage bars carry now (deals in it now), median_days, stall_days. hidden: open deals you may not see.',
    params: { pipeline: S('deal_flow (default), spv, lp_raise, program'), quarter: S('YYYY-Qn, e.g. 2026-Q4 (default: this quarter)'), fund: S('Only deals of this fund (id or name)') },
  },
  {
    name: 'deals.stalls',
    method: 'GET',
    fn: 'lib_deals_flow.opStalls',
    perm: 'signed',
    agent: 'allow',
    effect: 'read',
    desc: 'Open deals past their stage\'s stall days (days in stage over the stage setting; 0 never stalls), most overdue first, each with days_in_stage and stall_days. --point me for your own; --days 21 for every deal in its stage more than 21 days. hidden counts restricted deals you may not see.',
    params: { pipeline: S('One pipeline (default: all)'), point: S('Point partner: member id or email, or "me"'), days: N('In their stage more than this many days, whatever the stage setting (e.g. 21 for three weeks)'), limit: N('Rows (default 100)') },
  },
  {
    name: 'deals.members',
    method: 'GET',
    fn: 'lib_deals_flow.opMembers',
    perm: 'signed',
    agent: 'allow',
    effect: 'read',
    desc: 'The active members who work the pipeline (id, name, email, title, role): the people a point partner or a deal team is chosen from (deals.assign, deals.team). The caller first.',
  },
  {
    name: 'deals.reorder',
    method: 'POST',
    fn: 'lib_deals_flow.opReorder',
    perm: 'pipeline:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Put an open or held deal at a place in its board column (people only; the board shows columns in this order). --stage moves it to that stage first (as deals.move). --before: the deal it lands in front of (none: the end of the column); or --index: its place among the deals you see in that column, 0 = the top. Undo puts every card back.',
    params: { deal: S('Deal id or display id', { required: true, example: 'D-0012' }), stage: S('Stage key or label (default: its stage now)'), before: S('The deal it lands in front of: id or D-0001 (none: the end)'), index: N('Its place in the column, 0 = the top (instead of --before)'), note: S('Why, in a line (a stage move)') },
  },
  {
    name: 'deals.merge',
    method: 'POST',
    fn: 'lib_deals_flow.opMerge',
    perm: 'pipeline:edit',
    agent: 'propose',
    kind: 'merges',
    preview: 'lib_deals_flow.previewMerge',
    effect: 'write',
    desc: 'Fold a duplicate deal (--drop) into the one kept (--keep), same pipeline: its notes, tasks, files, team and founders move over; the dropped deal is removed and its id resolves to the kept one. Undo restores both. For you it is a proposal.',
    params: { keep: S('The deal kept: id or D-0001', { required: true }), drop: S('The duplicate: id or D-0002', { required: true }) },
  },
];
