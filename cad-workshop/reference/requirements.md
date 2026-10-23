# CAD Workshop: requirements

For one person (and their AI agent) designing real parts to 3D print or
machine: brackets, enclosures, mounts, adapters, plates. Parts are exact
solids with editable history, not meshes. No accounts or sign-in. Simple to
start (a starter and a few numbers), deep enough for real work (parameters,
references that never guess, exact measurements, spec checks, STEP).

Visual language: compact and detailed, like a professional CAD tool. A
full-height app with a slim icon rail; flat panels with hairline borders
and small corners (4 px chips and badges, 6 px controls, 8 px panels, 10 px
dialogs); 28 px buttons and fields; dense 24 to 40 px rows and tables split
by hairlines; the part workspace docked edge to edge (tree, view,
properties) under a header bar. Round shapes only where they are round by
nature: status dots, color swatches, switches, slider knobs, count badges.
Manrope; 12 and 13 px for data and UI, 14 and 15 px titles, on a 4 px grid;
pointer cursor on everything clickable; no emoji (line icons stored by
name). Every color comes from the host's theme tokens, with
contrast checks in every pack, light and dark; the 3D view's colors are
solved from the same tokens. The app names no particular AI agent: it says
"your AI agent". Numbers read "1,234.5" whatever the browser language.
Every page works from phone to desktop.

## Geometry truth

1. Geometry comes only from the OpenCascade kernel on this computer. The
   browser draws the build's own tessellation; every number shown
   (sizes, volume, area, mass, distances, angles, radii) is measured by the
   kernel, never from the mesh.
2. Millimetres and degrees, right-handed, Z up, XY the ground plane, Front
   looks from -Y. Inches are a display choice only.
3. A part is a feature tree in build order, driven by named parameters
   (expressions of other parameters allowed, no cycles). A feature may only
   use parameters, sketches, features and faces made before it.
4. Every face and edge has a stable name from the feature that made it
   (from the kernel's own history). References are selectors with an
   expected count; when the model no longer matches, the build fails with
   what it found and the candidates. Nothing is ever guessed.
5. A part's geometry is its current build. A build that fails shows the
   part up to the feature before the failing one, and says which feature
   failed and why in words a person can act on.

## Editing and history

6. Every edit, by the person or the AI agent, is a journaled change in a
   batch (one action, or one run of the agent). Any batch reverts in one
   step, as a new batch that can itself be reverted. Undo and redo work
   from the keyboard.
7. While a tool is open the view shows a live preview of its result (a
   build that saves nothing); dragging a handle shows a ghost at once.
8. An edit by the AI agent waits for its build and is undone when the
   build fails because of it (the agent may keep it on purpose).
9. What changed in a batch can be shown on the model: material added and
   material removed, with their volumes.
10. Spec checks (sizes, volume, mass, distances, hole spacing, radius,
    fits within a box, solid count, validity) re-run on every build and
    show pass or fail with the measured value.

## Frame

11. A slim icon rail on the left (wide screens): Home, Parts, Requests;
    Activity, Exports; Settings at the foot; the new-part button on top.
    Phones get a floating bottom bar with the new-part button in the middle.
    Counts sit on icons with something waiting (failing parts, open
    requests).
12. Hash routes: `#/`, `#/parts`, `#/part?id=`, `#/exports`, `#/activity`,
    `#/requests`, `#/settings`. Back buttons follow the app's own trail.

## Pages

13. Home: greeting, New part, Ask your AI agent; parts building or
    failing; recent parts; requests; latest changes; the engine. A
    first-time card explains the idea when there are no parts.
14. New part: made at once as "Part N" and opened, as desktop CAD opens
    an untitled design; renamed in place; material and color in the part
    panel. An empty part offers Sketch, Box, the starters (block, mounting
    plate, open box, round boss) and Describe it. Starters are real
    parameters and features, editable like anything else.
15. Parts: cards with thumbnails, size, mass and status; search; filters
    (all, pinned, not building, archived); sort; open, duplicate, pin,
    archive, delete.
16. Workspace, with the workflow of desktop CAD (Fusion, Onshape,
    SOLIDWORKS, Shapr3D): a toolbar with every tool and its shortcut; the
    parameters and the feature tree on the left; the model in the middle;
    the selection or the part, checks, history and the AI agent on the
    right. A tool opens as a small dialog over the model: the fields that
    matter first, the rest under More options; clicks in the view fill the
    active pick field; drag handles on the model set values, with a box to
    type the exact number; Enter is OK, Esc cancels; errors in plain words
    with a tip. A new sketch is drawn on its plane in the view (lines,
    rectangles, circles, slots, polygons, construction lines) with snapping,
    inference lines and typed sizes; dimensions on the canvas take numbers
    or expressions; finishing a sketch goes on to Extrude. The interface
    explains itself through what it shows (handles, highlights, previews),
    not through paragraphs of instructions. Below 1024 px wide the three
    areas become tabs.
17. The view: left click selects, left drag box-selects, right drag turns
    around the point under the pointer, middle drag pans (three schemes in
    Settings); Alt-click cycles what is under the pointer; double click
    edits the feature; right click opens a menu of what fits the thing
    under the pointer. A hover readout in plain words, the selection shared
    with the AI agent, all standard views and a navigation cube, fit,
    perspective or orthographic, a section plane, see-through, hiding
    bodies, a measurement line, the compare overlay, full screen. It draws
    only when something changes.
18. Exports: STEP (bodies named, re-read and checked for the same volume),
    3MF and STL (mesh quality Draft, Normal or Fine), GLB. Each file is kept with the part, with
    its download and its path; the Exports page says when the part has
    changed since.
19. Activity: every batch across parts, by you, your AI agent or the app,
    with revert.
20. Requests: design, fix and review requests to the AI agent with their
    status (sent, working, done, failed) and the agent's answer; a request
    nobody has picked up says so.
21. Settings: display unit, mouse navigation (three schemes), projection,
    grid, materials and densities, how long the agent's edits wait for
    their build, the engine (status, test, clean old builds).

## The AI agent

22. Every UI action is an operation the AI agent can run through the
    `agent-app` CLI; `app.guide` teaches the conventions and recipes.
23. The app hands work to the agent through three triggers: design a part
    or a change, fix a failed build, review a part for a process. The agent
    asks back when a dimension it needs is missing instead of guessing.
24. Every record type can be deleted (with a preview of what goes with it,
    or what blocks it).
