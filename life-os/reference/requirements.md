# Life OS: requirements

Personal use only: one person, no accounts or sign-in. Life OS is a life on
one screen, not a database to fill in. It shows useful things by itself (the
weather where the person lives, the news, who to get in touch with, what is
due, how the money is going), keeps count by itself (goals fill from the
jar, the books finished, the weigh-ins, the habits kept), and asks for as
little typing as possible: one line to add a task, one tap for a habit, one
tap for "talked today", type an amount and tap what it was for.

Revamped 2026-10-24 after the first version was rejected as "boxes, forms
and a database the user has to populate". Values, reviews, captures,
insights and the separate goals and areas pages are gone on purpose.

## Look

A cozy illustrated life in the family of an island dashboard. A deep green
sidebar with a carved wooden sign (the person's name), every place drawn
(a cottage for Home, a pinboard for the Board, a sprout for Habits, an
island for My life, stepping stones for Projects, a notebook for the
Journal, the agent's seedling), the parts of life as drawings under My life,
and today's weather at the foot. Every part of life has its own drawing and
its own color taken from it (an apple for Health, a coin jar for Money, two
mugs for Friends and family, a briefcase for Work, a cottage for
Home, books with a sprout for Growth, a kite for Fun, a lotus for Mind).
The landscape at the top of Home follows
the time of day, the season and the weather outside (rain falls when it
rains). Fraunces for headings, Nunito for text, one type scale of 12, 13,
14, 15 and 26 px, a pointer on everything clickable. Every color derives
from the host's theme tokens (an ink pack turns the drawings gray); nothing
light sits on light or dark on dark in any of the 16 packs, light or dark.
No emoji anywhere. The app says "your AI agent" and names no product.

## Layout

Every page is built from one kind of panel (a drawing, a title, a quiet
note and one action in the same places, the content under a hairline), on
a clear grid with the most important panel first and widest. Home is a
stack of rows, each with one to three panels side by side from 1280 px
(Today and Heads up; Habits and You today; Goals and Money; Coming up,
People and Weather; News across); on phones every panel stacks. The person
drags a row by its handle (or uses the arrow keys on it) to put the rows in
their own order, which is kept (on a phone: "Arrange Home", a short list
with up and down). Every part of life has its own tool on the left and the
same three panels on the right (Goals, To do, Habits).

## Feel

Every tap answers at once: the screen changes first and the server keeps
it behind; if the server refuses, the screen goes back and says why. Pages
open without loading flashes, and a page you return to shows at once.
Things move with purpose: panels rise in when a page opens, new rows slide
in, removed or finished rows fold away, drawers slide and dialogs ease in,
progress fills smoothly. Nothing moves when the system asks for reduced
motion.

## Phones

Made for a phone as much as a desk: a bottom bar (Home, Board, Habits, My
life, More), every panel stacked, nothing that only shows on hover, every
control easy to hit with a thumb (about 44 px of tap area), no page that
scrolls sideways, fields that do not make an iPhone zoom, Board lists that
snap into place, and every drag also possible by tapping (cards move from
their drawer, Home rows from "Arrange Home").

## Places

1. **Home**: greeting and your AI agent's note on the landscape, the weather
   now; nudges (a birthday, someone not heard from, a bill due, rain, a trip,
   chores late); Today with a big "What do you want to do today?" and the
   top three; habit buttons to tap; how today feels (five stickers); the body
   today (water glasses to tap); goals as trails; the latest journal page;
   the weather by the hour and the week; money left this month with a quick
   spend; people to reach with "Talked today"; what is coming up; the news by
   topic.
2. **Board**: lists by time (Inbox, Today with the minutes planned and
   how many are done, Coming up by day, Later, Done), "Add a card" at the
   top of every list, drag and drop between and within lists, cards in their
   area's color with the goal they move, the person they are for, steps,
   dates, length and repeat; a filter by part of life; the next seven days
   with each day's weather and plans; "Plan my day with your AI agent".
   Unscheduled steps of a project stay in the project.
3. **Habits**: big drawn buttons by time of day (a counted habit fills a ring
   one tap at a time), the last two weeks as a tracker grid where every
   square can be tapped, streaks that skips never break, one-tap ideas and a
   habit in your own words; a habit's drawer with its year, numbers,
   schedule, drawing, cue, area and goal.
4. **My life**: a balance (spider) chart with a spoke per part of life,
   reaching out as far as that part is going well (scored from what is done
   there; a part with too little to go on sits at the middle), beside a list
   of each part with how it is going; every goal under its part; parts
   switch on and off.
5. **A part of life**: its own tool first (Health: water, sleep, steps,
   weigh-ins, workouts by drawing, two weeks of bars; Money: the month in a
   jar, spend by drawing, where it went, jars, bills; Friends and family
   (partner, family and friends together): a connection map
   with you in the middle and everyone on rings by how close they are, a
   line to each person showing who is due a call, thin lines between people
   who know each other (set in a person's drawer), then time to reach out,
   birthdays, plans; Work: a focus timer that keeps running, the
   week's focus, wins; Growth: reading now, a wooden bookshelf, learning with
   one-tap practice; Fun: each trip one full-width ticket (where, the dates
   and nights, how much is packed, the days to go on the stub) that opens to
   its packing list, and one add bar where the place and dates appear once
   the trip has a name, then a bucket list of stamps; Home: chores by room with when they are due, the
   shopping list on a notepad; Mind: a month of moods, a breathing circle,
   calm minutes), then its goals, its cards and its habits.
6. **Goals** live in their part of life and count by themselves where they
   can: a savings goal from its jar, a reading goal from books finished, a
   weight goal from weigh-ins, a habits goal from how often its habits are
   done, tasks and milestones from what is ticked; number goals take a
   check-in. Started from ideas per part of life in one dialog.
7. **Projects**: journeys of stepping stones to a flag with the next step;
   a project's To do, Doing and Done to drag between.
8. **Journal**: a page of lined paper for today that keeps itself as you
   type, mood stickers, the day's weather, a photo as a polaroid, parts of
   life as stickers, private unless shared with your AI agent; a timeline by
   month with a year of days and "On this day"; the week counted by itself
   with your AI agent's paragraph.
9. **Your AI agent**: ask a question, keep or decline what it proposes, its
   visits on a schedule (a morning note, an evening check-in, the week's
   recap), what was done by whom with undo.
10. **Settings**: name, where you live, units, currency, week start, when a
    day starts, daily aims (water, sleep, steps), the parts of life, what
    your AI agent may read and when it stays quiet, the calendar mirror,
    export.
11. **First run** (the first version's onboarding, kept by request): a
    wooden sign over the landscape, a card with step dots; your name and week
    start; the parts of life; an optional first goal (done or not, or a
    number, by when, why); an optional first habit (drawing, cue, how often,
    when, counts toward the goal); the rhythm (morning note, evening
    check-in, weekly recap). Where you live, the currency and units are found
    by themselves.

## Rules

- Your AI agent adds cards, logs and notes freely (all in the activity with
  undo); new goals, habits, people and projects, deletions and plans for a
  day arrive as proposals kept item by item. Journal pages are the person's:
  the agent reads only pages shared with it (and none when Settings say
  never) and never writes them; it never sets the mood.
- Every UI action has a CLI operation; changes show live on open screens.
  Your AI agent sees and does through the CLI what the person sees and does
  in the app (the brief, every list, proposals for what the person defined),
  with safe-to-repeat writes, several things per call, ids in every answer,
  and errors that name the right id.
- Money is kept in minor units; zero-decimal currencies have none.
