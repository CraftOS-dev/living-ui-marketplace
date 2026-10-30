# Image Utility: requirements

For one person (and their AI agent) doing everyday image work on their own
computer: screenshots for docs and tickets, product and blog photos, social
posts, favicons, a folder of pictures for the web or an email. No accounts
or sign-in, nothing uploaded. Simple to start (drop an image, pick a tool),
careful where it matters (originals never touched, real file sizes before
saving, location stripped, secrets redacted for good).

Visual language: CAD Workshop's. A full-height app with a slim icon rail;
flat panels with hairline borders and small corners (4 px chips and
badges, 6 px controls, 8 px panels, 10 px dialogs); 28 px buttons and
fields; dense rows and tables split by hairlines; the image workspace
docked edge to edge (stack and library, stage, inspector) under a header
bar and a toolbar of labelled tools. Round shapes only where round by
nature: status dots, colour swatches, switches, slider knobs, count
badges, numbered steps. Manrope; 12 and 13 px for data and UI, 14 and 15 px
titles, on a 4 px grid; pointer cursor on everything clickable; no emoji
(line icons). Every colour comes from the host's theme tokens with contrast
checks, light and dark; transparency shows as a checkerboard solved from
the same tokens. The app names no particular AI agent: it says "your AI
agent". Every page works from phone to desktop.

## Image truth

1. The original file is kept as imported and never written. An image is
   that original plus an ordered stack of edits; what you see and export
   is the engine's render of the stack.
2. Every edit stays changeable, can be turned off, reordered or removed,
   and every change is undoable: undo, redo, and revert any single change,
   for you and for your AI agent alike.
3. Coordinates are full-resolution pixels of the image as it enters an
   edit. Sizes through the stack are computed the same way in the engine,
   the hooks and the workspace.
4. Colour is converted to sRGB for editing and tagged sRGB on export; EXIF
   orientation is applied to the pixels; 16-bit and CMYK images are read
   correctly; animated GIF and WebP keep their frames where the output can
   hold them.
5. File sizes shown before export are real encodes, not guesses. A size
   target finds the highest quality that fits and shrinks the image only
   when it must, rather than dropping to a quality that looks broken.
6. Metadata on export is a choice (basic, everything, none); the location
   is removed unless the person keeps it; the alt text travels as the
   file's description.
7. Redaction replaces pixels; solid boxes are recommended for secrets and
   the app says why.
8. Marks over the photo (text, arrows, lines, boxes, ellipses, highlights,
   numbered steps, drawings, redactions, logos and watermarks) are layers:
   each one is selected, moved, resized, turned, restacked, hidden, locked,
   renamed, duplicated and deleted on its own, on the image and in a
   Layers list, as in a design tool, and stays editable later. A layer is
   pinned to the photo (it follows crops and turns) or to the frame (it
   stays put). The screen draws them live; the engine draws the same
   layers for exports.

## The AI agent

9. The agent uses the same operations as the UI and sees what the person
   sees (`app.context`, `images.render`, `analyze.image`).
10. By default its edits are proposals: previewed on the image, accepted or
    rejected by the person (with a reason it reads). It can never change or
    remove the person's edits under that policy. Its batches wait for the
    person to run them. Settings can let it edit or run directly.
11. It writes files only inside the folder the person names; it cannot
    change its own policy or install background models.
12. Everything it makes is marked as its own.
13. Requests from the app (edit, describe) reach it through triggers; it
    asks back instead of guessing when a request is ambiguous.

## Engine

14. Everything runs on this computer: an embedded Python with Pillow,
    MozJPEG, oxipng and AVIF, downloaded once from official sources,
    pinned and checked; background removal with ONNX models only when the
    person installs it. Only permissively licensed components are
    downloaded; HEIC and JPEG XL are not supported because their Python
    builds are GPL.
15. Until the engine is ready, imports are kept and read as soon as it is;
    nothing is lost and the app says what it is waiting for.

## Pages

16. Home (which is the library, kept simple), the image workspace,
    Batches, Exports, Requests, Activity, Settings, as listed in
    `AGENT_APP.md`. Tools save as you change them: no Apply or Cancel,
    undo and redo always at hand.
17. Every action in the UI has an operation for the agent, and every
    operation's refusal says what to do instead.
