# Tasks: Life OS

Every task cites what it implements. These features already exist in the published app `life-os` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3): the grove sidebar with the carved sign, the drawn places, the parts of life and projects as trees, the quiet counts and the agent badge, and the weather at the foot (`components/Shell.tsx`, `app.status`).
- [x] T-2 (F-FRM-4): the phone bottom bar (Home, Board, Habits, My life, More) and the menu sliding from the left.
- [x] T-3 (F-FRM-5, F-FRM-6): quick add (Q, one task per line, to Today or the Inbox) and Find (Ctrl K) over goals, habits, cards, people, projects, books and pages, with the page and action shortcuts (`components/overlays.tsx`, `find.all`).
- [x] T-4 (F-FRM-7, F-AI-6, F-AGT-9): the activity trail written with every write, `activity.undo` and `activity.last`, the snack with Undo, and Ctrl Z waiting for writes still on their way (`lib_activity.js`, `components/snack.tsx`).
- [x] T-5 (F-FRM-8): `--lo-*`, `--lo-art-*` and `--lo-k-*` colors derived from the kit tokens with contrast checks for every theme pack, light and dark (`lib/themeColors.ts`, `theme.css`).
- [x] T-6 (F-FRM-9, F-FEEL-1, F-FEEL-2): live views over operations: one realtime hub on the topic `lo`, edits laid over every view before the server answers and put back on a refusal, the remembered last copy per view, page transitions, and the reload onto a new build (`lib/live.ts`, `lib_bus.js`, `lib/router.ts`).
- [x] T-7 (F-HOME-1, F-HOME-2): the Home landscape by time of day, season and weather, the greeting, the agent's note or the day in a sentence, the weather now, and the town search when no place is known (`pages/Home.tsx`, `components/Scene.tsx`, `components/glance.tsx`).
- [x] T-8 (F-HOME-3, F-HOME-4): Home's rows of one to three panels, dragged by the handle or moved with the arrow keys, "Arrange Home" on phones, and the order kept in `settings.home_rows`.
- [x] T-9 (F-HOME-5, F-HOME-6, F-HOME-7, F-HOME-8): Today with the big add and the top three, Heads up from the nudges, the habit buttons, and You today (moods, water glasses, the day's body, the latest page) (`home.summary`, `lib_dash.js`).
- [x] T-10 (F-HOME-9, F-HOME-10, F-HOME-11, F-HOME-12, F-HOME-13, F-HOME-14): goals as trails, the money jar with a quick spend, Coming up for seven days, people to reach with "Talked today", the weather by the hour and the week, and the news by topic (`lib_world.js`).
- [x] T-11 (F-BRD-1, F-BRD-2, F-BRD-3, F-BRD-9): the Board's lists by time with their composers, drag and drop between and within lists (the day follows the list), and snapping lists on phones (`pages/Board.tsx`, `board.get`, `tasks.move`).
- [x] T-12 (F-BRD-4, F-BRD-5, F-CRD-5): cards in their area's color with goal, project, person, steps, dates, time, repeat and star, rows for lists, and the filter by part of life (`components/tasks.tsx`).
- [x] T-13 (F-BRD-6): the Week: seven days with weather, plans and calendar events, the inbox beside them, and moving by seven days (`board.week`).
- [x] T-14 (F-BRD-7, F-BRD-8, F-AGT-10, F-AGT-11): "Plan my day with your AI agent" and "Sort with your AI agent" (`agent.request` firing `day_plan_requested` and `inbox_sort_requested`), the request states, waiting plan proposals on the Board, and the `day_plan` and `inbox` playbooks (`board.plan`, `suggestions.create`).
- [x] T-15 (F-CRD-1, F-CRD-2, F-CRD-3, F-CRD-4): one-tap tick with the fold, the top three capped at three, the card drawer (when, due, time, repeat, area, goal, project, person, steps, notes, history), and delete behind its confirmation (`lib_tasks.js`).
- [x] T-16 (F-HAB-1, F-HAB-2, F-HAB-3): today's habit buttons by time of day with rings for counted habits, and the two-week tracker grid where every square taps (`pages/Habits.tsx`, `components/habits.tsx`, `habits.tap`).
- [x] T-17 (F-HAB-4, F-HAB-8): one-tap habit ideas for the parts of life switched on, a habit in your own words with a drawing, and the "Start with one" state.
- [x] T-18 (F-HAB-5, F-HAB-6): the habit drawer (numbers, the year, name, drawing, schedule, each day, source, when, cue, area, goal), Skip today, Put away, and delete.
- [x] T-19 (F-HAB-7, F-AGT-13): "Not sticking? Ask your AI agent" firing `habit_help_requested`, with its playbook.
- [x] T-20 (F-LIFE-1, F-LIFE-2, F-LIFE-3, F-LIFE-5): My life: the balance chart, each part with its level, line and score, goals by part, and the scores from each part's own data (`pages/Life.tsx`, `components/radar.tsx`, `lib_life.js`).
- [x] T-21 (F-LIFE-4, F-SET-3): switching parts of life on and off from My life, a part's page and Settings (`areas.set`).
- [x] T-22 (F-AREA-1, F-AREA-2, F-AREA-3, F-AREA-4): a part of life's page: its drawing and line, its own tool first, then Goals, To do and Habits (`pages/Area.tsx`, `life.area`).
- [x] T-23 (F-HLT-1, F-HLT-2, F-HLT-3): Health: the body today (water, sleep, steps, weight with its line), workouts by drawing, and two weeks of bars (`components/areas/Health.tsx`, `health.log`, `workouts.add`, `health.trend`).
- [x] T-24 (F-MON-1, F-MON-2, F-MON-3): Money: the month in a jar with the budget, spends and income by category drawing, where it went, day by day, and the latest entries (`components/areas/Money.tsx`, `money.month`, `money.add`).
- [x] T-25 (F-MON-4, F-MON-5): savings jars (put in, take out, new jar) and monthly bills paid with a tap and noted as a spend (`pots.*`, `bills.pay`).
- [x] T-26 (F-PPL-1, F-PPL-2, F-PPL-3, F-PPL-4): Friends and family: the connection map with its key, adding someone by name in a circle, time to reach out, birthdays and plans together (`components/areas/People.tsx`, `components/connections.tsx`, `people.reach`, `events.create`).
- [x] T-27 (F-PPL-5, F-PPL-6): the person drawer (look, relation, touches, keep in touch, circle, birthday, who they know, plans, cards, notes, times in touch), put away and delete (`components/people.tsx`, `people.touch`, `people.link`).
- [x] T-28 (F-WRK-1, F-WRK-2, F-WRK-3): Work: the focus timer kept in the browser across pages and noted when it rings, the week's focus bars, and wins (`components/areas/Work.tsx`, `focus.log`, `wins.add`).
- [x] T-29 (F-GRW-1, F-GRW-2, F-GRW-3, F-GRW-4): Growth: reading now with the page, the wooden shelf, the book dialog, and learning with one-tap practice and progress (`components/areas/Growth.tsx`, `books.*`, `learning.practice`).
- [x] T-30 (F-FUN-1, F-FUN-2, F-FUN-3, F-FUN-4): Fun: trip tickets with the countdown, the add bar that grows once the trip has a name, packing lists starting with the basics, and the bucket list of stamps (`components/areas/Fun.tsx`, `trips.pack`, `bucket.update`).
- [x] T-31 (F-HSE-1, F-HSE-2, F-HSE-3): Home: chores by room with when they are due again, and the shopping notepad (paste a list, tick, clear what is bought) (`components/areas/HomeArea.tsx`, `chores.done`, `shopping.clear`).
- [x] T-32 (F-MND-1, F-MND-2, F-MND-3): Mind: today's mood, a month of moods, the breathing circle noting calm minutes, and other quiet time (`components/areas/Mind.tsx`, `days.mood`, `health.log --add_mind`).
- [x] T-33 (F-GOAL-1, F-GOAL-2, F-GOAL-3, F-GOAL-4): goals as trails with pace, "A new goal" with ideas per part of life and every measure, the goal drawer with the action its measure needs, and pause, pick up, reach and delete (`components/goals.tsx`, `lib_goals.js` `recompute`).
- [x] T-34 (F-GOAL-5, F-AGT-12): "Ask your AI agent for steps" firing `breakdown_requested`, with its playbook and `goals.breakdown` as a proposal with items.
- [x] T-35 (F-PRJ-1, F-PRJ-2, F-PRJ-3, F-PRJ-4): Projects as journeys of stepping stones, "A new project" with first steps, a project's To do, Doing and Done to drag between, its details, and its states (`pages/Projects.tsx`, `pages/Project.tsx`).
- [x] T-36 (F-JRN-1, F-JRN-2, F-JRN-3, F-JRN-4): the journal page that keeps itself (700 ms), mood stickers, the day's weather, the polaroid photo, part-of-life stickers, the privacy lock, and delete (`pages/Journal.tsx`, `journal.write`).
- [x] T-37 (F-JRN-5): the timeline: a year of days with the writing streak, every page by month, and "On this day" (`journal.heat`, `journal.list`, `journal.memories`).
- [x] T-38 (F-JRN-6, F-AGT-14): the week counted by itself with the moods, wins and goals that moved, the agent's paragraph or "Ask your AI agent to sum it up" (`recap_requested`), the morning routine (`morning_note_due`), and their playbooks (`recap.write`, `days.note`).
- [x] T-39 (F-AI-1, F-AGT-15): questions to your AI agent with their states, `question_asked`, and the question playbook (`asks.*`).
- [x] T-40 (F-AI-2, F-AI-3, F-AI-4, F-AGT-4, F-AGT-5, F-AGT-16): proposals with previews kept whole or item by item, sent back with a note (`proposal_returned`), declined, withdrawn or made stale, and field suggestions kept or dismissed (`lib_agent.js`, `components/agent.tsx`).
- [x] T-41 (F-AI-5, F-AGT-16): routines (morning note, evening check-in, the week's recap) switched on with a time and days, quiet hours, missed runs, and the `evening_checkin` playbook (`lib_routines.js`, job `lo_tick`).
- [x] T-42 (F-SET-1, F-SET-2, F-SET-4, F-SET-6): Settings: you, where you live, units, currency, the week, the day's start, daily aims, what the agent may read and do, quiet hours, and the JSON export (`pages/Settings.tsx`, `lib_settings.js`).
- [x] T-43 (F-SET-5): the read-only Google Calendar mirror through the host, synced every 15 minutes while on, with its state (`lib_calendar.js`).
- [x] T-44 (F-RUN-1, F-RUN-2, F-RUN-3): the first run in five skippable steps sent in one `onboarding.complete`, with the place, currency and units found by themselves (`pages/Welcome.tsx`, `lib_world.js` `detect`).
- [x] T-45 (F-FEEL-3, F-FEEL-4): the motion (rise, slide in, fold away, drawers, dialogs, fills) removed under reduced motion, tap areas on touch, 16 px fields on iPhone, and tap alternatives to dragging (`lib/motion.ts`, `theme.css`).
- [x] T-46 (F-AGT-1, F-AGT-2, F-AGT-3): the operation catalog of 171 operations (`cat_core.js`, `cat_life.js`, `cat_areas.js`) generated into `routes.pb.js` and `ops.gen.ts` by `tools/gen.mjs`. The 155 declared in `operations.json` are served to agents by `a2app_routes.pb.js`, with `app.guide` and `agent.brief`.
- [x] T-47 (F-AGT-6, F-AGT-7, F-AGT-8, F-AGT-17): the dispatcher and caller check: person-only operations refused, journal privacy, proposals for what the person defined, `--confirm true` for the agent's deletions, and errors that name the right id or parameter (`lib_ops.js`, `lib_auth.js`, `lib_core.js` `need`, `lib_journal.js`).
- [x] T-48 (F-AGT-3): record hooks refusing direct writes to every collection, so all writes keep progress, pace and the activity trail in step (`hooks.pb.js`).

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 155 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
