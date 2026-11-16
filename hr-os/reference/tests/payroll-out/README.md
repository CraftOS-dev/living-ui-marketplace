# payroll-out tests

Run against a scratch copy of the app (never the live app). `HR_APP=<scratch app>`, `HR_PORT=<scratch port>` (default 3192).

1. Copy `stubs/cat_test_pout.js` and `stubs/lib_test_pout.js` into the scratch copy's `pb/pb_hooks` (fixture ops for t02 and t03), then `node tools/gen.mjs` there.
2. `node t01_bankfiles.mjs <scratch>/pb/pb_hooks` and `node t04_units.mjs <scratch>/pb/pb_hooks` (pure Node, no server).
3. `node t01_empty.mjs`, `node t02_flows.mjs`, `NO_FRESH=1 node t03_permissions.mjs` (each `fresh()` wipes the scratch database).
4. `node t05_integration.mjs` needs payroll-core's test lib next to this folder (`../../payroll-core/tests/lib.mjs` relative to the scratch app); skip it in APP.
5. `node shots.mjs seeded`, `node shots_dialog.mjs seeded` and `node shots_quick.mjs <label> <route> ...` (the Singapore run with a held person and its "Write the bank file" dialog) after t02; `EMPTY=1 node shots.mjs empty` after t01_empty.
