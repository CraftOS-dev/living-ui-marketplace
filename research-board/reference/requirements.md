# Research Board: requirements

## Origin

The first Research Board (V1 Living UI, ported to PocketBase in August 2026)
was a single free-form whiteboard: cards for images, videos, YouTube links,
documents and notes, uploaded or linked, dragged anywhere, joined by plain
connection lines, searched by title and filtered by type, opened in a modal.
This rebuild keeps all of that and makes it a production agent app.

## Binding

1. Everything the first version did still works: the five kinds (image,
   video, YouTube, document, note), file upload or address for media,
   free positioning by drag, connections between cards, search, filter by
   kind, a detail view to read, edit and delete.
2. The UI is a sidebar (switch and manage boards) and the board, edge to
   edge: no other pages, no backdrop or double background, no wasted
   padding. Flat, compact, high-contrast, nearly colorless (decided by the
   person on 2026-10-28 after a first version with a Home dashboard,
   Library, Tags and Settings pages in the Expenses tracker's layout).
3. The board itself follows the Research OS map: dotted stage, pan and
   zoom around the pointer, flat bordered cards, curved links with
   arrowheads (green supports, red contradicts, ink otherwise), a legend,
   zoom controls, proposals dashed until confirmed.
4. No emoji as icons; line icons only. No placeholder copy: a control
   either works end to end or is not shown.
5. Production-level motion: entrances, cards landing, links drawing in,
   panels sliding, eased view changes; all off under reduced motion.
6. Every action in the UI has an operation the AI agent can call.

## Added in the rebuild

Several boards (managed in the sidebar); link, quote and section cards;
link previews; link kinds and labels; multi-select, area select, tidy,
group in a section; resize; trash with Undo; keyboard shortcuts; paste and
drop to add; minimap; the inspector with summaries by the AI agent; board
reviews by the AI agent with proposed links; tags; Markdown export.
