# Tasks: Resume Maker

Every task cites what it implements. These features already exist in the published app `resume-builder` 1.0.0 (the agent operations were added with the framework conversion), so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2): the workspace. `App.tsx` lays out the header, toolbar, editor panel and preview. `EditorPanel.tsx` and `Editor/EditorTabs.tsx` hold the eleven tabs in a three-column grid.
- [x] T-2 (F-FRM-3): host theme messages recolor the app chrome with five palettes or custom colors, dark or light (`App.tsx`, `theme/themes.ts`). The A4 sheet stays white.
- [x] T-3 (F-RES-1, F-RES-2, F-RES-3, F-RES-4, F-RES-5): the header's resume group (`Header.tsx`, `context/ResumeContext.tsx`):
  - the selector;
  - New, with the "Resume #<n>" dialog and a random sample person (`utils/randomCandidateGenerator.ts`);
  - Rename;
  - Duplicate ("<title> Duplicate");
  - Delete, with its confirmation and the default resume when the last one goes.
- [x] T-4 (F-RES-6, F-OUT-4): Import reads a `.json` backup as a new resume over the built-in sample, and refuses non-exports with the app's alert. Backup (JSON) downloads the whole resume.
- [x] T-5 (F-RES-7, F-RES-8, F-RES-9): `ResumeContext.tsx`:
  - loads `resume_state` newest first, filling missing parts from `data/presets.ts`;
  - caches the list and the open resume in local storage;
  - saves the active resume into its own record 600 ms after the last change; New, Duplicate and Import create their record at once, and Delete removes it;
  - lists the resumes whose changes did not reach the database (`living_resume_maker_unsaved_v2`), so the next load keeps their cached copy and saves it.
  The migration `1700000001_seed_resume.js` seeds the sample resume.
- [x] T-6 (F-PER-1, F-PER-2, F-PER-3): the Personal tab (`Editor/PersonalForm.tsx`): contact fields, links, summary, photo upload as a data URL, URL paste and removal. The templates add inline editing of name, title and summary, and click-to-upload on their photo.
- [x] T-7 (F-WRK-1, F-WRK-2, F-WRK-3, F-WRK-5, F-WRK-6): the Experience tab (`Editor/ExperienceForm.tsx`):
  - add first, with placeholders;
  - free-text fields;
  - Current setting "Present" and disabling the end date;
  - the ten action-verb buttons;
  - remove.
  The templates add inline position and bullet editing.
- [x] T-8 (F-WRK-4): Enter continues "•", "-", "*" or numbered bullets and ends the list on an empty bullet, in experience and project descriptions (`utils/bulletUtils.ts`).
- [x] T-9 (F-EDU-1): the Education tab: add first with placeholders, five fields, remove (`Editor/EducationForm.tsx`).
- [x] T-10 (F-SKL-1, F-SKL-2, F-SKL-3): the Skills tab: quick-add with four categories at level Advanced; name, free-text category and level per row; remove (`Editor/SkillsForm.tsx`). Grouped and levelled skills appear on the templates that draw them (`Preview/Sections/GroupedSkills.tsx`, `utils/proficiencyHelper.ts`).
- [x] T-11 (F-MYT-1, F-MYT-2): the My Time tab:
  - rows with color picker, label and percentage;
  - the six-colour cycle for new rows;
  - the total with its "(Recommended to equal 100%)" hint;
  - bars on the preview (`Editor/MyTimeForm.tsx`, `Preview/Sections/MyTimeChart.tsx`).
- [x] T-12 (F-ACH-1, F-PHI-1): the Achievements tab (headline, description, eight badge icons) and the Philosophy tab (quote and author, falling back to the person's name) (`MostProudOfForm.tsx`, `PhilosophyForm.tsx`, `MostProudOfBadges.tsx`, `PhilosophyQuote.tsx`).
- [x] T-13 (F-PRJ-1, F-CRT-1, F-PUB-1): the Projects, Certs and Papers tabs with their fields, add and remove, and the empty sentences of Certs and Papers.
- [x] T-14 (F-STY-1, F-STY-2, F-STY-3, F-STY-4): the toolbar (`Toolbar.tsx`):
  - 34 templates in five groups;
  - picking a template resets the font and applies the template's sections (`utils/templateSections.ts`);
  - eight accent swatches;
  - font, scale, line spacing and avatar.
- [x] T-15 (F-LAY-1, F-LAY-2): the Layout tab: show/hide per section, "(Omitted in template)" for sections the template lacks, and up/down moves disabled at the ends (`Editor/VisibilityForm.tsx`).
- [x] T-16 (F-PRV-1, F-PRV-3): the A4 preview (`Preview/ResumeCanvas.tsx`) renders the 34 templates with the chosen accent, font, scale and spacing. Links go through `utils/linkUtils.ts` (https, mailto, tel).
- [x] T-17 (F-PRV-2): page measurement: the page-count badge, dotted break lines, and pushing cut items to the next page, recomputed after changes and resizes.
- [x] T-18 (F-OUT-1, F-OUT-2, F-OUT-3): the Export menu: PDF through the browser's print dialog with the A4 print stylesheet (`styles/print.css`), the Word `.doc` and the LaTeX `.tex` downloads.
- [x] T-19 (F-SCO-1, F-SCO-2): the score pill colored by band and the breakdown dialog with five groups and recommendations (`utils/scoreCalculator.ts`, `Header.tsx`).
- [x] T-20 (F-AGT-1, F-AGT-2, F-AGT-8): the 42 operations, served to agents by `a2app_routes.pb.js`:
  - `operations.json` declares them;
  - `pb/pb_hooks/agent_ops.pb.js` routes them;
  - `lib_agent.js` implements them.
  `app.guide` gives the rules, and `resumes.delete` goes through the adapter's approval.
- [x] T-21 (F-AGT-3, F-AGT-4, F-AGT-6): `lib_agent.js` writes the record the View reads:
  - inside a transaction, in the View's shape, with the add buttons' defaults and insert positions;
  - validates every value as the screens' controls constrain it;
  - marks a leftover save copy from older versions with `shadowOf` in `resumes.list` and `resumes.get`.
- [x] T-22 (F-AGT-5, F-AGT-7): `resumes.import` runs the View's import test plus the shape check, and reports `filledFromSample`. `resumes.score` and `resumes.export` port the score and the JSON, Word and LaTeX builders; a parity test against the frontend sources and a browser download comparison matched them byte for byte when they were added.

## Verification
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
