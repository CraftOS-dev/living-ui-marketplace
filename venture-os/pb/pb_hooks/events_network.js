/**
 * Network registrations (SPEC 4.2). Plain data.
 *
 * Event this module emits:
 *   meeting.ended { cal_event, deal, company }   (once, after an external meeting's end time; deals offers "Add note")
 *
 * Subscriptions: an intro ask that was sent (or bounced) moves its intro; a
 * merge of people, companies or deals re-points network rows inside the
 * merge's undo unit.
 *
 * Triggers: meeting_brief { event_id }, company_research { company_id },
 * intro_draft { intro_id } (lib_agent.js).
 *
 * Next: `note` (an external meeting I attended ended without a note:
 * Add note, No note). Intro drafts are kernel outbound items.
 */
const FIELD = (key, label, type, synonyms, required) => ({ key: key, label: label, type: type, synonyms: synonyms, required: required === true });

module.exports = {
  on: {
    'record.merged': 'lib_network.onMerged',
    'outbound.sent': 'lib_network_work.onOutbound',
    'outbound.failed': 'lib_network_work.onOutbound',
  },
  needsYou: 'lib_network_work.needsYou',
  triggers: {
    meeting_brief: {
      record: 'cal_events',
      param: 'event_id',
      perm: 'network:view',
      label: 'Brief a meeting',
      description: 'Your AI agent writes the brief of an external meeting: who they are, the firm\'s history with them, the deal, questions to ask and recent news with links',
      fires: 'Brief on a meeting, or 18 hours before an external meeting while the switch is on',
      cooldown: 10,
      policy: { key: 'meeting_briefs', label: 'Brief me before external meetings', tip: 'A brief for each external meeting on your calendar in the next 18 hours.' },
      deal: 'lib_network_work.eventDeal',
      check: 'lib_network_work.briefCheck',
      asked: 'lib_network_work.onBriefAsked',
      ended: 'lib_network_work.onBriefCannot',
      instruction:
        "Write the brief of the external meeting event_id. 1) briefs.get --event <event_id>: the meeting, each attendee with the firm's strength and who knows them best, the company and the deal. Read people.get for each external attendee, companies.get, records.timeline --company, interactions.list --company, deals.get when there is a deal. 2) Recent news (about 90 days): news.list --company <company>, then your own web search; keep only items with a working link. 3) briefs.save --event <event_id> --sections '{\"who\":[...],\"history\":\"...\",\"deal\":\"...\",\"questions\":[...],\"news\":[...]}' in short plain sentences (marks it ready). Never contact anyone; write unknown where you found nothing.",
    },
    company_research: {
      record: 'companies',
      param: 'company_id',
      perm: 'network:view',
      label: 'Research a company',
      description: 'Your AI agent fills a company\'s empty facts and its founders\' work history from public sources, each with its link, and adds sourced competitors',
      fires: 'Ask your AI agent on a company',
      cooldown: 10,
      deal: 'lib_network_work.researchDeal',
      check: 'lib_network_work.researchCheck',
      instruction:
        "Fill the empty facts of company company_id from public sources. 1) companies.get --company <company_id> (each field with who set it) and its founders (people.get). 2) Read its site, registries, press and the founders' public profiles. For each source: records.enrich --company <company_id> --fields '{\"description\",\"sector\",\"hq_country\",\"founded_year\",\"team_size\",...}' --source_ref <link> (only what you can source; marks it done). 3) Founders: records.enrich --person <id> --fields '{\"title\",\"location\",\"bio\",\"linkedin\"}' --source_ref <link> (work facts only). 4) Up to five sourced competitors: companies.upsert --name --domain --tags '[\"competitor\"]' --source_ref <link>. Never contact the company; never invent a value.",
    },
    intro_draft: {
      record: 'intros',
      param: 'intro_id',
      perm: 'network:edit',
      label: 'Draft an intro ask',
      description: 'Your AI agent drafts an intro ask a person picked, with a forwardable blurb; the person approves and sends it',
      fires: 'Ask for an intro on a path (people.paths), or a proposal for an intro a person accepted',
      cooldown: 10,
      deal: 'lib_network_work.introDeal',
      check: 'lib_network_work.introCheck',
      asked: 'lib_network_work.onIntroAsked',
      ended: 'lib_network_work.onIntroCannot',
      instruction:
        "Draft the intro ask of intro intro_id as the person who asked; never send it. 1) intros.get --intro <intro_id>: the target, the path (the member who knows them, the connector), who asked and the recipient. people.get on the target, companies.get on their company, deals.get when there is a deal. 2) Through a connector: a short ask to the connector plus a forwardable blurb (three to five sentences). Through another member: a short internal note asking them, with the blurb. The asker knows the target: a short warm note. 3) intros.draft --intro <intro_id> --subject \"...\" --body \"<the ask>\\n\\n<the blurb>\" (marks it done; the asker approves it in Next). Never mention strength scores or private notes.",
    },
  },
  search: 'lib_network.search',
  timeline: 'lib_network.timelineFor',
  today: 'lib_network.today',
  imports: {
    people: {
      label: 'People',
      perm: 'network:edit',
      fields: [
        FIELD('name', 'Name', 'text', ['Full name', 'Person', 'Contact', 'Contact name']),
        FIELD('email', 'Email', 'email', ['Email address', 'E-mail', 'Work email', 'Primary email']),
        FIELD('company', 'Company', 'text', ['Organization', 'Organisation', 'Company name', 'Employer', 'Account']),
        FIELD('title', 'Title', 'text', ['Job title', 'Role', 'Position']),
        FIELD('phone', 'Phone', 'text', ['Phone number', 'Mobile', 'Telephone']),
        FIELD('linkedin', 'LinkedIn', 'url', ['LinkedIn URL', 'LinkedIn profile']),
        FIELD('location', 'Location', 'text', ['City', 'Region']),
        FIELD('tags', 'Tags', 'list', ['Labels', 'Lists']),
      ],
      row: 'lib_network.importPerson',
    },
    companies: {
      label: 'Companies',
      perm: 'network:edit',
      fields: [
        FIELD('name', 'Name', 'text', ['Company', 'Company name', 'Organization', 'Organisation', 'Account'], true),
        FIELD('domain', 'Domain', 'text', ['Company domain', 'Email domain']),
        FIELD('website', 'Website', 'url', ['URL', 'Web', 'Homepage', 'Site']),
        FIELD('description', 'Description', 'text', ['About', 'One liner', 'Summary']),
        FIELD('sector', 'Sector', 'text', ['Industry', 'Vertical']),
        FIELD('subsector', 'Subsector', 'text', ['Sub-sector', 'Sub industry']),
        FIELD('hq_country', 'Country', 'text', ['HQ country', 'Headquarters country']),
        FIELD('hq_city', 'City', 'text', ['HQ city', 'Headquarters', 'HQ']),
        FIELD('founded_year', 'Founded', 'int', ['Founded year', 'Year founded']),
        FIELD('team_size', 'Team size', 'int', ['Employees', 'Headcount', 'Employee count']),
        FIELD('linkedin', 'LinkedIn', 'url', ['LinkedIn URL']),
        FIELD('tags', 'Tags', 'list', ['Labels', 'Lists']),
      ],
      row: 'lib_network.importCompany',
    },
  },
};
