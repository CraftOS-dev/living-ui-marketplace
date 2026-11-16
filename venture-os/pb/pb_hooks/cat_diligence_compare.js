/**
 * Catalog: comparison grids (diligence module; markets reuses them).
 * Companies as rows, questions as columns, each cell a cited answer.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const GRID = S('Grid id', { required: true });

module.exports = [
  {
    name: 'compare.list',
    method: 'GET',
    fn: 'lib_diligence_grid.opList',
    perm: 'diligence:view|markets:view',
    effect: 'read',
    desc: "The firm's comparison grids, newest first, each with origin and market_ref (the map or thesis it was made from). --market_ref keeps those made from one map or thesis id, or a JSON list of ids.",
    params: { market_ref: S('Map or thesis id, or a JSON list of ids'), origin: S('Only grids made from', { enum: ['deals', 'markets', 'manual'] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') },
  },
  {
    name: 'compare.get',
    method: 'GET',
    fn: 'lib_diligence_grid.opGet',
    perm: 'diligence:view|markets:view',
    effect: 'read',
    desc: 'A grid: columns (questions) and rows (companies, with their deal when they have a room), each cell an answer with value, grade and citations or null; missing counts empty cells; asks shows your AI agent filling them; for you, empty_cells lists the cells of companies without a room.',
    params: { grid: GRID },
  },
  {
    name: 'compare.save',
    method: 'POST',
    fn: 'lib_diligence_grid.opSave',
    perm: 'diligence:edit',
    effect: 'write',
    desc: 'Make or change a grid: --deals or --companies (JSON lists), --columns (checklist keys such as traction_arr, or {"text","type","unit"}; default a standard set), --name, --origin deals|markets|manual. Empty cells are asked of your AI agent unless --fill false.',
    params: {
      grid: S('Grid id (omit to create)'),
      name: S('Grid name (default: the first companies)'),
      deals: S('JSON list of deals (D-0001 or ids)'),
      companies: S('JSON list of companies (ids, domains or names)'),
      columns: S('JSON list of checklist keys or {text, type, unit}'),
      origin: S('Where it was made from', { enum: ['deals', 'markets', 'manual'] }),
      market_ref: S('The map or thesis id it was made from (compare.list filters by it)'),
      fill: B('false: do not ask your AI agent yet'),
    },
  },
  {
    name: 'compare.fill',
    method: 'POST',
    fn: 'lib_diligence_grid.opFill',
    perm: 'diligence:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Ask your AI agent for every empty cell of a grid now (rooms answer through their deal; companies without a room from public sources).',
    params: { grid: GRID },
  },
  {
    name: 'compare.delete',
    method: 'POST',
    fn: 'lib_diligence_grid.opDelete',
    perm: 'diligence:edit',
    agent: 'deny',
    effect: 'write',
    destructive: true,
    desc: 'Move a grid to the trash (Undo brings it back).',
    params: { grid: GRID },
  },
];
