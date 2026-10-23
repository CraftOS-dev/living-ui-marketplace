/// <reference path="../pb_data/types.d.ts" />
/**
 * app.guide: how the AI agent designs parts in this app through the
 * agent-app CLI. Conventions, the reference grammar, error codes and
 * ready-to-run recipes.
 */

function guide(app) {
  const kinds = require(`${__hooks}/lib_kinds.js`);
  const misc = require(`${__hooks}/lib_misc.js`);
  const s = misc.settingsGet(app);
  const run = 'agent-app run <project>';
  const parts = app.findRecordsByFilter('parts', 'archived = false', '-updated', 15, 0).map((p) => ({ name: p.getString('name'), status: p.getString('status') }));
  return {
    app: 'CAD Workshop: parametric parts (brackets, enclosures, mounts, fixtures) built from a typed feature tree by the OpenCascade kernel. Every number comes from the kernel. No logins.',
    parts: parts,
    materials: s.materials,
    conventions: [
      'Units: millimetres and degrees everywhere (inputs, results, exports). Axes: right-handed, Z up, XY is the ground; the Front view looks from -Y, Right from +X, Top from +Z.',
      'A part is an ordered feature tree driven by named parameters. Features build on what is before them. The kernel rebuilds the tree after every edit; edits answer with the build result (status, delta, per-feature status, error with code).',
      'Numbers in params may be plain numbers or {"expr": "wall * 2"} using the part\'s parameters (params.set). Changing a parameter rebuilds every feature that uses it.',
      'Faces and edges have keys from the feature that made them: ext1.cap_end (top of an extrude), ext1.side.r1.top (the side swept from sketch segment r1.top), fil1.blend.2, hole1.bore.3, shell1.inner.ext1.cap_start. A cut can split a face; the pieces are ext1.cap_end~1, ~2 (a key without ~n matches all pieces). An edge key is its two face keys joined by | (ext1.cap_end|ext1.side.r1.top). Copies from patterns and mirrors append @<feature>.<n>.',
      'References select faces, edges or bodies and say how many they expect: {"faces": {"keys": ["ext1.cap_end"]}, "expect": 1}. Selector fields (all must hold): keys, not_keys, created_by, role, role_prefix, body, type (plane cylinder cone sphere torus bspline / line circle ellipse curve), normal ("+Z"), parallel_to, perpendicular_to ("X" or [x,y,z]), radius, convexity (convex concave smooth; edges), of_faces (edges bounding faces matching a selector), between (edges between two face selectors), extreme ("+Z": the topmost only), sort ("+X") with take (first n), any (a list of selectors, union). A count different from expect fails with stale_reference and lists candidates; nothing is ever re-bound by guessing.',
      'Prefer stable selectors over long key lists: {"edges": {"between": [{"keys": ["ext1.cap_end"]}, {"role_prefix": "side."}]}, "expect": 4} keeps working when sizes change; refs.resolve tests a reference before you use it.',
      'Sketches are dimension-driven: every item is placed by numbers (no constraint solver). Profiles must be closed and must not cross or touch; a profile inside another is a hole. Sketch on a flat face with plane "face"; face coordinates are world coordinates seen from outside the face (on the top face, x and y).',
      'Every edit by the AI agent waits for its build (wait_s, default ' + s.agent_wait_s + ' s) and, when the build fails because of it, is reverted automatically (on_fail=revert; pass on_fail=keep to keep a failing edit). dry_run=true builds the edit without saving it and answers the same envelope. expected_hash (the part\'s tree_hash) refuses the edit if someone changed the part meanwhile.',
      'The agent\'s edits on a part within 15 minutes form one batch (pass batch=<id> or new_batch=true to control it). changes.revert --batch <id> undoes a whole batch in one step (a revert is itself a batch, so it can be undone). The person sees every agent-made feature marked as made by the AI agent.',
      'What the person selected in the viewer is selection.get (faces_ref and edges_ref are ready-made references). selection.set shows the person what you mean.',
      'Check numbers before claiming success: read the delta and summary of the edit, model.properties, model.measure, or checks.list. Pictures: views.render returns a PNG path (orthographic, scale stated per tile); use it to confirm orientation, not to measure.',
      'Lists and objects are JSON strings on the command line, e.g. --params \'{"radius": 3, "edges": {"edges": {"created_by": "ext1", "parallel_to": "Z"}, "expect": 4}}\'. Confirm with the person before any destructive operation (records.delete).',
    ],
    feature_kinds: kinds.describe().kinds,
    numbers: kinds.describe().numbers,
    error_codes: {
      stale_reference: 'a reference found a different count than expect (found, expected, candidates)',
      reference_order: 'a feature uses a sketch, feature or face made after it',
      kernel_failed: 'the kernel could not build the feature (fillet too big, open profile, bad axis)',
      no_effect: 'the feature adds or removes no material (it misses the body)',
      invalid_solid: 'the result is not a valid solid (too thin, tangent faces)',
      empty_result: 'nothing would be left (a cut removes the whole body)',
      sketch_invalid: 'a sketch profile is open, empty, or crosses another',
      param_invalid: 'a param is missing or of the wrong type (features.schema --kind <kind>)',
      import_failed: 'a STEP file could not be read or has no closed solids',
    },
    recipes: {
      'Start a part': run + ' parts.create --name "Wall bracket" [--material PETG] [--description "..."]',
      'A plate with four corner holes': run + ' edits.batch --part "Wall bracket" --steps \'[{"op":"params.set","name":"t","value":"4"},{"op":"features.add","kind":"sketch","params":{"plane":"XY","items":[{"type":"rectangle","id":"r1","width":60,"height":60,"corner_radius":5}]}},{"op":"features.add","kind":"extrude","params":{"sketch":"s1","extent":{"type":"distance","distance":{"expr":"t"}}}},{"op":"features.add","kind":"hole","params":{"face":{"faces":{"keys":["ext1.cap_end"]},"expect":1},"positions":[[24,24],[-24,24],[24,-24],[-24,-24]],"size":"M4","fit":"clearance","through":true}}]\'',
      'Round the edges the person selected': run + ' selection.get --part <part>, then ' + run + ' features.add --part <part> --kind fillet --params \'{"edges": <edges_ref from selection.get>, "radius": 3}\'',
      'Change a dimension': run + ' params.set --part <part> --name t --value 5 (or features.update --part <part> --feature ext1 --params \'{"extent": {"type": "distance", "distance": 12}}\'); read delta in the answer.',
      'Pull or push a face': run + ' features.add --part <part> --kind push_pull --params \'{"face": {"faces": {"keys": ["ext1.cap_end"]}, "expect": 1}, "distance": 5}\' (a negative distance pushes the face in and cuts).',
      'Find keys': run + ' model.describe --part <part> --of faces [--feature ext1] [--type plane]; edges with --of edges. ' + run + ' refs.resolve --part <part> --ref \'{"edges": {"created_by": "ext1", "parallel_to": "Z"}, "expect": 4}\' tests a reference.',
      'Measure': run + ' model.measure --part <part> --a ext1.cap_start --b ext1.cap_end (distance, angle, gap); ' + run + ' model.properties --part <part> (volume, mass, bounding box, center of mass).',
      'A build failed': run + ' builds.get --part <part> shows error (code, feature, message, candidates); fix that feature with features.update, or roll back with features.roll-to --to <feature> to inspect earlier states (roll-to --to end restores).',
      'Look at it': run + ' views.render --part <part> [--views \'["front","right","top","iso"]\'] [--highlight \'["fil1.blend.1"]\'] returns the PNG path.',
      'Spec checks that run on every build': run + ' checks.save --part <part> --name "Fits the case" --kind fits_within --box \'[80,60,40]\'; --kind bbox_z --op le --target 30; --kind center_distance --refs \'{"a":"hole1.bore.1","b":"hole1.bore.2"}\' --op eq --target 48 --tolerance 0.05 (between hole axes; distance is the closest gap between surfaces). checks.list shows pass, fail or could not run.',
      'Export for printing or CAD': run + ' exports.create --part <part> --format 3mf (or stl, step, glb) [--tolerance 0.02] returns the absolute file path; attach or upload it with your own tools.',
      'Undo': run + ' changes.list --part <part> shows batches (newest first), each with kind edit, undo or redo; ' + run + ' changes.revert --batch <id> [--preview true]. To undo the last step, revert the newest batch of kind edit or redo whose reverted_by is empty; to redo, revert the newest batch of kind undo whose reverted_by is empty (none if an edit came after it).',
      'Bring in a vendor part': run + ' assets.add --part <part> --path "<absolute path to .step>", then features.add --kind import_step --params \'{"asset": "<asset id>"}\'.',
      'Compare before and after a batch': run + ' compare.builds --part <part> --batch <id> (added and removed volume; the person sees it in the app).',
    },
    settings: { display_unit: s.display_unit, agent_wait_s: s.agent_wait_s },
  };
}

module.exports = { guide: guide };
