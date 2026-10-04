# Entertainment IP Manager: requirements (binding)

Source: the user's request of 2026-10-04 ("an IP manager for entertainment companies only: anime, virtual idols,
virtual characters, and the works they produce such as songs and titles"), the research and blueprint reviewed
with the user, and the user's instruction "execute the plan", which accepted every recommendation below.

## Decisions

1. Name: Entertainment IP Manager. A separate app with its own database; the IP Manager it grew from stays unchanged.
2. Interface in English and Japanese. Each person picks a language; the organization sets the default. Text the
   server generates (deadline titles, explanations, rule names, dimension labels, errors, notifications) exists in both.
3. Business profiles at setup (anime and film, VTubers and virtual talent, characters and virtual idols) switch
   modules on; any module can be switched on later. Always on: Today, Inbox, Deadlines, Characters, Agreements,
   Can we?, Trademarks, Enforcement, People, Reports, Settings.
4. External portals in the same app: licensee, committee member, outside reviewer. No talent portal.
5. Production committees with the full distribution waterfall and distribution statements.
6. Trademark office data: JPO, USPTO TSDR and EUIPO connections kept, credentials optional; CN, KR and TW by hand.
7. Trademarks and designs in JP, US, CN, KR, TW, EM and WO. Patents and utility models are out of scope.
8. Editable starter content (rules, fees, calendars, dimension trees, approval stage templates, guideline
   templates), no sample data.

## Principles

- The character is the center: products, licences, songs, marks and cases link to the characters they use.
- Every yes has a name on it: the app shows who can approve a use, and why.
- Every date is explained and comes from a rule or a contract clause; dates are closed with a reason, never deleted.
- Automation proposes, people decide: office data, CraftBot and email land in the Inbox; nothing automated writes a
  deadline; CraftBot writes drafts only (comments, notices, emails) and never sends anything.
- Performers are private by default: legal identities visible only to admins and the talent's managers.
- Japanese practice first: Japanese business days for SLAs, JPY by default, any currency allowed.

## Quality bar

- Every user-facing action has an `/api/ops` route and an `operations.json` entry, with role checks on the server.
- Every view follows changes made by anyone (including agents) without a refresh.
- Pages work at 400, 768 and 1280 px wide with no page-level horizontal scroll (the base app's Inbox scrolled
  sideways at 1280 px; this must not recur).
- No em dashes in any copy. Japanese copy is natural business Japanese.
- Legal rules ship as editable data and are labelled for review by counsel before anyone relies on them.
