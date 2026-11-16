/**
 * Catalog: market maps. Segments are columns, companies are tiles coloured
 * by their relation to the firm (portfolio, pipeline, passed from deals and
 * holdings; tracked or competitor as placed). People place tiles; your AI
 * agent proposes them with a source.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const MAP = S('Map id or name', { required: true });
const PLACE = {
  map: S('Map id or name (or give --thesis)'),
  thesis: S('Instead of --map: the thesis (id or name); its map is made with this segment when it has none'),
  company: S('Company id, domain or exact name'),
  name: S('Name of a company not in the records yet'),
  website: S('Its website'),
  segment: S('Segment key or label'),
  role: S('tracked (default) or competitor; portfolio, pipeline and passed come from deals', { enum: ['tracked', 'competitor'] }),
  note: S('One line'),
  source_url: S('The link that shows where it belongs'),
  source_ref: S('Other source reference'),
  licence: S('public (default) or internal_only', { enum: ['public', 'internal_only'] }),
  remove: B('true to take it off the map'),
  position: N('Its place in the segment, 0 = top (default: last when it is added or moved)'),
};

module.exports = [
  {
    name: 'maps.list',
    method: 'GET',
    fn: 'lib_markets_maps.opList',
    perm: 'markets:view',
    effect: 'read',
    desc: 'Market maps with their thesis, segments, company counts by relation, and proposals waiting.',
    params: { thesis: S('Only the maps of this thesis'), status: S('active (default), archived or all', { enum: ['active', 'archived', 'all'] }) },
  },
  {
    name: 'maps.get',
    method: 'GET',
    fn: 'lib_markets_maps.opGet',
    perm: 'markets:view',
    effect: 'read',
    desc: 'One map: segments, companies with segment and relation (portfolio, pipeline, passed from deals; tracked, competitor as placed), source, the latest moves, proposals waiting. --as_of YYYY-MM-DD shows it as it stood that day.',
    params: { map: MAP, as_of: S('Day YYYY-MM-DD') },
  },
  {
    name: 'maps.save',
    method: 'POST',
    fn: 'lib_markets_maps.opSave',
    perm: 'markets:edit',
    agent: 'propose',
    kind: 'maps',
    preview: 'lib_markets_maps.previewSave',
    effect: 'write',
    desc: 'Add a map (no --map) or change its name, thesis, segments (--segments \'["Payments","Lending"]\', or [{"key","label"}] to rename) or status. For you it is a proposal.',
    params: {
      map: S('Map id or name (to change one)'),
      name: S('Name'),
      thesis: S('Thesis id or name ("" for none)'),
      segments: S('JSON list of segment labels or {"key","label"}'),
      status: S('active or archived', { enum: ['active', 'archived'] }),
      sort: N('Order among maps'),
      source_ref: S('Where the change came from'),
    },
  },
  {
    name: 'maps.place',
    method: 'POST',
    fn: 'lib_markets_maps.opPlace',
    perm: 'markets:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Put a company on a map in a segment, move it to another segment or to another place in its segment (--position, 0 = top), or take it off (--remove true). Every change of segment is kept with its day.',
    params: PLACE,
  },
  {
    name: 'maps.propose',
    method: 'POST',
    fn: 'lib_markets_maps.opPlace',
    perm: 'markets:edit',
    agent: 'propose',
    kind: 'map_entries',
    preview: 'lib_markets_maps.previewPlace',
    effect: 'write',
    desc: 'Propose a tile: add a company to a segment of a map (--map, or --thesis: its map, made when the thesis has none), move it, or remove it, with --source_url and --why. A person accepts it (one by one or all of a map with maps.accept). A company not in the records needs --name (and --website).',
    params: PLACE,
  },
  {
    name: 'maps.accept',
    method: 'POST',
    fn: 'lib_markets_maps.opAccept',
    perm: 'markets:edit',
    agent: 'deny',
    effect: 'write',
    track: false,
    desc: 'Accept the proposals waiting for a map (all, or --proposals \'["id",...]\'); each runs as you, as its own undoable change.',
    params: { map: MAP, proposals: S('JSON list of proposal ids (default all of the map)') },
  },
];
