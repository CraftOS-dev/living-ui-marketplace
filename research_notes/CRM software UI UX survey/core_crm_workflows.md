# Core CRM Workflows and Data Model (implementation-grade, as of late 2026)

Scope: what the data looks like, step-by-step user flows, edge cases, and best-in-class rules to copy for a local, single-user / small-team CRM with a REST/ops API that an AI agent also drives. Primary sources: Attio developer docs and help center, HubSpot Knowledge Base, Pipedrive Knowledge Base, Close help, Salesforce blog and Trailhead, Folk and Dex help, Twenty source (GitHub), Village docs. Sections 1 to 9 follow the nine workflows. Section 10 answers the cross-cutting key questions: exact rules, edge cases, and table stakes vs differentiators.

Convention: **Cited Findings** are sourced facts. **Inferences** are design recommendations I derived from those findings. They are opinions about what to build, not vendor facts.

---

## 1. Data model: people, companies, deals, lists vs objects, attribute types, relationships, IDs, dedupe keys

### Takeaway
The 2025-26 best-practice model (Attio, Twenty) is metadata-driven. It has typed **objects** (people, companies, deals, plus custom objects) whose **records** carry typed **attributes**, and **lists** whose **entries** wrap a record and add list-specific attributes. Relationships are typed record-reference attributes that are bidirectionally synced. Dedupe keys are email (people) and domain (companies), stored as normalized multi-value attributes.

### Cited Findings
**Objects, records, lists, entries (Attio)**
- Objects are "the foundational data types". Standard objects are people and companies, with optional deal, user and workspace objects, and custom objects can be added. "Records are an instantiation of an object." — [Attio: Objects and lists](https://docs.attio.com/docs/objects-and-lists.md)
- Lists "can be used to model a particular process". They are "composed of multiple rows, known as 'entries', each of which corresponds to a single record". Lists can have their own attributes, for example "additional attributes only relevant to a deal in that list". — [Attio: Objects and lists](https://docs.attio.com/docs/objects-and-lists.md)
- The same record can appear more than once in a list. Example: a person applying for two roles gets two entries in a Recruiting list. Each entry points to the same person record but holds different list-attribute values (Applying for, Stage, Hiring manager). Object attribute values live on the record and list attribute values live on the entry. — [Attio Help: Understanding lists](https://attio.com/help/reference/attio-101/attios-data-model/understanding-lists)
- List entries can be filtered through the special `parent_record` attribute, and filters can traverse paths such as `[["candidates","parent_record"],["people","email_addresses"]]`. — [Attio: Filtering and sorting](https://docs.attio.com/rest-api/guides/filtering-and-sorting.md)

**Attribute (field) types**
- Attio has 17 attribute types: Actor reference, Checkbox, Currency, Date, Domain, Email address, Interaction, Location, Personal name, Number, Phone number, Rating, Record reference, Select, Status, Text, Timestamp. Attribute values carry `active_from` / `active_until` for history. — [Attio: Attribute types](https://docs.attio.com/docs/attribute-types)
- Twenty CRM (open source) `FieldMetadataType` enum has 25 values: ACTOR, ADDRESS, ARRAY, BOOLEAN, CURRENCY, DATE, DATE_TIME, EMAILS, FILES, FULL_NAME, LINKS, MORPH_RELATION, MULTI_SELECT, NUMBER, NUMERIC, PHONES, POSITION, RATING, RAW_JSON, RELATION, RICH_TEXT, SELECT, TEXT, TS_VECTOR, UUID. — [twentyhq/twenty FieldMetadataType.ts](https://raw.githubusercontent.com/twentyhq/twenty/main/packages/twenty-shared/src/types/FieldMetadataType.ts)
- **Currency (Attio)**: the value is `{currency_value: number, currency_code: "USD"}`. The code is fixed per attribute: "it is not possible to override currency for a particular record or entry". It is set once via `default_currency_code`. Precision is "up to four decimal places". Values are filterable with `$eq/$gt/$gte/$lt/$lte` on `currency_value`. — [Attio: Currency](https://docs.attio.com/rest-api/attribute-types/attribute-types-currency.md)
- **Status (Attio)**: always single-select. Each option has `title`, `is_archived`, `target_time_in_status` (nullable) and `celebration_enabled`. Deals have a predefined `stage` status attribute. Writing an unknown title or ID errors "rather than create a new status". `active_from` / `active_until` allow filtering and automation on when the stage changed. — [Attio: Status](https://docs.attio.com/rest-api/attribute-types/attribute-types-status.md)
- **Phone (Attio)**: the value is `{original_phone_number, country_code (ISO 3166-1 alpha-2), normalized_phone_number}`, and "All values are validated against the E164 format". A string input must start with `+`. An object input needs `original_phone_number` and `country_code`, where `country_code` may be null if the number has a `+` prefix. — [Attio: Phone number](https://docs.attio.com/rest-api/attribute-types/attribute-types-phone-number.md)
- **Domain (Attio)**: the value is `{domain, root_domain}`. Example: `app.attio.com` has root `attio.com`, computed without the public suffix. "Any inputted values will have paths and query parameters trimmed." Companies have a multi-select `domains` attribute, and custom domain attributes cannot be created. — [Attio: Domain](https://docs.attio.com/rest-api/attribute-types/attribute-types-domain.md)
- **Record reference (Attio)**: the value is `{target_object, target_record_id}`. `is_multiselect` sets one vs many. Paired "relationship" attributes sync both ways: "updating an attribute value on either of the attributes automatically updates the other attribute". Example: adding a person to a company's `team` updates that person's `company`. — [Attio: Record reference](https://docs.attio.com/rest-api/attribute-types/attribute-types-record-reference.md)
- References can be written by matching attribute. Companies are matched via `domains` and people via `email_addresses`. A plain string "will be interpreted as a domain" for companies or as an email for people. — [Attio: Record reference](https://docs.attio.com/rest-api/attribute-types/attribute-types-record-reference.md)

**People standard object (Attio)**
- People attributes include `email_addresses` (Email address, **unique, multiselect**), `name` (Personal name), `company` (Record reference), `description`, `job_title`, `phone_numbers` (multiselect), `primary_location` (Location), `angellist`, `facebook`, `instagram`, `linkedin`, `twitter` (Text), and the conditional `associated_deals` and `associated_users`. — [Attio: People object](https://docs.attio.com/docs/standard-objects/standard-objects-people)
- "When creating a person, a related company record will automatically be generated or matched based on the domain of the person's email address." Enriched attributes "cannot be overridden by API users". — [Attio: People object](https://docs.attio.com/docs/standard-objects/standard-objects-people)

**Many-to-many relationships and association labels**
- HubSpot association labels describe the role of a link. A contact can have a **Primary** company plus labeled others ("Branch", "Regional Office"), and an associated contact can be labeled "Decision Maker". "Unlabeled" is the default association and returns a null label. Companies can have Parent/Child labels. — [HubSpot Developers: Associations schema](https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associations-schema/guide)
- Pipedrive allows only **one linked contact person per deal**. Extra people are added as **participants**, but "a participant is not formally linked to a deal the way a primary contact person is, and won't appear in the list view or Insights reports". — [Pipedrive KB: Participants](https://support.pipedrive.com/article/participants); [Pipedrive KB: Can multiple people be linked to a deal](https://support.pipedrive.com/article/can-multiple-people-be-linked-to-a-deal)

**Dedupe keys and record IDs**
- HubSpot's unique identifiers are **Email** (contacts), **Company domain name** (companies) and **Record ID** (any object). An account can also create "up to ten custom properties" that "require unique values". — [HubSpot KB: Deduplication of records](https://knowledge.hubspot.com/records/deduplication-of-records)
- The Attio upsert ("assert") endpoint takes a `matching_attribute` (ID or slug). The attribute "does not have to be unique, but a value that matches more than one record is rejected". — [Attio: Upsert a record](https://docs.attio.com/rest-api/endpoint-reference/records/upsert-a-record.md)

### Inferences
- **Recommended core schema** for a local CRM, combining Attio's shape with HubSpot and Pipedrive semantics:
  - `object(id, slug, singular, plural, is_system)`. Seeded with `people`, `companies` and `deals`, and custom objects allowed.
  - `attribute(id, object_id|list_id, slug, title, type, is_multiselect, is_unique, is_required, is_system, config_json, archived_at)`. The types to support are text, rich_text (notes only), number, currency, checkbox, date, timestamp, select, multi_select, status, rating, email, phone, domain, url/links, location/address, personal_name, record_reference (relationship), actor_reference (user/agent), and interaction (computed, read-only).
  - `record(id UUIDv7, object_id, created_at, created_by_actor, updated_at, deleted_at)`.
  - `attribute_value(id, record_id|entry_id, attribute_id, value_json, active_from, active_until, created_by_actor)`. This is Attio-style append-only versioning, and it gives both field history (section 9) and time-in-stage (section 3) from one table.
  - `list(id, slug, parent_object_id)`, `list_entry(id, list_id, record_id, created_at)`, with list-specific attributes stored as attribute values keyed by `entry_id`. Duplicate entries of the same record are allowed, following Attio.
  - `relationship` is a record_reference attribute pair with `inverse_attribute_id` that is kept in sync transactionally. An optional `label` (HubSpot-style association label such as "Primary", "Decision maker" or "Champion") goes on a join table `record_link(from_record, to_record, attribute_id, label, is_primary)`.
- **Deals ↔ people should be many-to-many with roles.** Pipedrive's single-person-plus-participants design leaves participants out of reports, and that limitation is worth avoiding.
- **Currency**: store `{amount_minor or decimal(…,4), currency_code}` per deal value. Attio's fixed-currency-per-attribute rule is simpler but cannot handle mixed-currency pipelines. Store the code per value and convert at report time (see section 3).
- **IDs**: use UUIDv7 (or ULID) so IDs sort by time, plus a human-friendly short ref (`P-1042`, `C-311`, `D-77`) that agents and users can type. Never reuse an ID after a merge (HubSpot creates a new ID on merge; see section 2). Keep an `id_alias` table that maps old IDs to the surviving ID so stale agent references still resolve.
- **Dedupe keys**: `people.email_addresses` (unique across all people, multi-value, lowercased) and `companies.domains` (unique, multi-value, normalized to `root_domain`). Add optional unique custom attributes, as HubSpot allows up to 10.
- **Tags**: model them as a multi_select attribute (shared options per object) rather than a separate entity. Lists cover the "membership plus per-membership data" case that tags cannot.
- **Owners**: use an `actor_reference` attribute (`owner`) that can point to a workspace member, so the AI agent can also be an actor in `created_by_actor`.

### Gaps
- I did not confirm the exact Twenty relation semantics (e.g., MORPH_RELATION polymorphic targets), how Attio's "Interaction" attribute value is shaped, or Folk's group or custom-field model.
- I did not fetch a primary source on tags as a distinct concept in Attio or HubSpot. The modeling advice is inference.

---

## 2. Contact and company management: create, quick-add, CSV import, export, duplicates and merge, enrichment, validation

### Takeaway
Best practice is to **upsert on a normalized unique key** (email for people, domain for companies, record ID when present). Auto-create or match the company from the email domain. In a merge, the **primary record wins and blanks are filled from the secondary**, with special rules for emails/domains (kept as secondary values), lifecycle (furthest stage), create date (oldest) and counters (summed). Merges in HubSpot and Pipedrive cannot be undone, so a local CRM gains by keeping a merge snapshot.

### Cited Findings
**Create and quick-add**
- Attio creates or matches the company from the email domain when a person is created. — [Attio: People object](https://docs.attio.com/docs/standard-objects/standard-objects-people)
- By default, Attio communication intelligence creates records "for all received emails and calendar invites". It can be set to create them "only when you have sent an email to that domain", which prevents records for newsletters and spam. — [Attio Help: Communication intelligence](https://attio.com/help/reference/attio-101/productivity/communications-intelligence)
- HubSpot alerts the user if they manually create a contact whose email matches an existing contact. Form submissions with an existing email are added to the existing contact. A form submitted with a secondary email "will overwrite the existing email address". — [HubSpot KB: Deduplication](https://knowledge.hubspot.com/records/deduplication-of-records)

**CSV import (mapping, dedupe, merge-on-import)**
- HubSpot maps file columns to properties automatically "based on the header, the header language, and the property name" on the "Map columns" screen. — [HubSpot KB: Understand the import tool](https://knowledge.hubspot.com/import-and-export/understand-the-import-tool)
- Imports use unique identifiers: Email for contacts, Company domain name for companies, and Record ID for everything else, including deals. If you choose "update existing deals" but omit a Record ID column, you must fix the file and restart. — [HubSpot KB: Understand the import tool](https://knowledge.hubspot.com/import-and-export/understand-the-import-tool); [HubSpot KB: Import objects](https://knowledge.hubspot.com/crm-setup/import-objects)
- On import, HubSpot deduplicates companies against **primary and secondary** domain values. Companies created through the API "will not be deduplicated by the Company domain name property". — [HubSpot KB: Deduplication](https://knowledge.hubspot.com/records/deduplication-of-records)
- Attio upsert semantics: when the matching attribute is multiselect (e.g., emails), "new values will be added and existing values will not be deleted". For any other multiselect attribute, the supplied list replaces the existing values ("created or deleted as necessary"). A value that matches more than one record is rejected, and no match creates a new record. — [Attio: Upsert a record](https://docs.attio.com/rest-api/endpoint-reference/records/upsert-a-record.md)

**Duplicate detection**
- The Salesforce Standard Contact Matching Rule uses **exact** match on Email and **fuzzy** match on First and Last Name. It catches "Bob" vs "Robert" but misses the same person with a different email. Fuzzy name matching also handles swapped first and last names. Mailing Street is split into sections that are scored separately and weighted, which "works best with North American data". — [Trailhead: Duplicate management unit 2](https://trailhead.salesforce.com/content/learn/modules/sales_admin_duplicate_management/sales_admin_duplicate_management_unit_2)

**Merge: which fields win**
- HubSpot: the primary record is the one selected first. "If the primary record does not have a value for a property … the secondary record's value is used." Exceptions:
  - The secondary email becomes a secondary email address.
  - The secondary domain becomes a secondary domain.
  - Lifecycle stage keeps "the stage furthest down the funnel".
  - Create date keeps the oldest value.
  - Analytics are re-synced, and conversions and form submissions are added together.
  - All timeline activities and associations from both records appear on the result.
  - "A new unique Record ID is created for the resulting merged record."
  - The secondary record "is removed from all static segments".
  - A merge is blocked once the records have 250 or more prior merges combined, or if it would exceed association limits.
  - "It's not possible to unmerge records."
  — [HubSpot KB: Merge records](https://knowledge.hubspot.com/records/merge-records)
- Pipedrive: the user picks the primary item, and "the primary item's information will be prioritized" on conflicts (e.g., the primary's phone is kept). Users cannot choose individual fields natively. Per-field choice needs third-party tools such as Insycle. — [Pipedrive KB: Merge duplicates](https://support.pipedrive.com/th/article/merge-duplicates); [Pipedrive Community: choose individual fields](https://community.pipedrive.com/discussion/16605/merging-duplicates-in-pd-can-we-choose-individual-fields-instead-of-all-or-nothing); [Insycle: Pipedrive merge overview](https://support.insycle.com/hc/en-us/articles/6586858159383)

**Enrichment (domain → company, logo)**
- The **Clearbit Logo API shut down on December 8, 2025**. Logo.dev positions itself as the drop-in successor, built by the original Clearbit Logo team, with a free tier of 500K requests/month. Brandfetch also publishes a Clearbit migration guide. — [Logo.dev: Clearbit has shut down](https://www.logo.dev/clearbit); [Brandfetch: Migrate from Clearbit Logo API](https://docs.brandfetch.com/guides/migrate-from-clearbit-logo-api)
- Attio enriched attributes are system-owned and API users cannot override them. Some are hidden depending on billing tier. — [Attio: People object](https://docs.attio.com/docs/standard-objects/standard-objects-people)

**Validation**
- Attio validates phone numbers against E.164 and stores the original input, an ISO country code and the normalized number. — [Attio: Phone number](https://docs.attio.com/rest-api/attribute-types/attribute-types-phone-number.md)
- Attio strips paths and query parameters from domain inputs and derives `root_domain`. — [Attio: Domain](https://docs.attio.com/rest-api/attribute-types/attribute-types-domain.md)

### Inferences
- **Normalization rules to implement** (these are inferences that extend Attio/HubSpot behavior):
  - *Email*: trim, lowercase the whole address, and validate syntax. Do **not** strip `+tags` or Gmail dots when deduping (that is lossy). Use them only as a "possible duplicate" hint.
  - *Domain*: strip the scheme, `www.`, path, query and port. Lowercase, punycode-normalize, and compute `root_domain` with a public-suffix list.
  - *Free-mail exclusion*: never auto-create a company from gmail.com, outlook.com, icloud.com, proton.me and similar domains. Keep a blocklist.
  - *Phone*: parse with libphonenumber using the record's or company's country as the default region. Store `original` and `e164`, and reject the value or flag it "unverified" if parsing fails.
- **Quick-add flow**:
  1. Accept a single input (name, email or URL) and detect its type.
  2. Email → look up the person by email and upsert. Derive the domain, then upsert the company, unless it is a free-mail domain.
  3. URL or domain → upsert the company and queue enrichment (name, logo, description) asynchronously.
  4. Show "Already exists, open it?" instead of creating a duplicate.
- **CSV import wizard** (copying HubSpot):
  1. Upload the file.
  2. Choose the object, or two objects (people + companies) in one file.
  3. Auto-map columns by header similarity against attribute slugs and titles. Allow "don't import column" and "create new attribute".
  4. Choose the mode: create only, update only, or upsert. Choose the match key: record ID, email or domain.
  5. Preview with per-row status (create / update / skip / error).
  6. Commit as a single **import batch** with an `import_id` so the whole import can be reverted.
- **Multi-value merge-on-import**: append values for the match key (Attio). For other multi-value fields, choose between append and replace (default to append for imports, which is safer).
- **Merge algorithm** (copy HubSpot's precedence, fix its irreversibility):
  - Scalar fields: the primary wins and blanks are filled from the secondary.
  - Multi-value keys (emails, phones, domains): union them, keeping the primary's value as primary.
  - Status or lifecycle fields: furthest-along wins.
  - `created_at`: the oldest.
  - Counters: summed.
  - Relationships, list entries, notes, tasks and activities: re-pointed to the survivor.
  - Write `id_alias(old_id → survivor_id)`, store the full secondary snapshot in an audit event, and offer **unmerge** from that snapshot within N days. That would be a differentiator, since HubSpot and Pipedrive cannot unmerge.
- **Duplicate detection** for a small CRM:
  - People: exact normalized email → definite duplicate. Exact E.164 phone → strong. Fuzzy name (normalized + nickname table, Jaro-Winkler ≥ 0.9) plus the same company → probable.
  - Companies: same `root_domain` → definite. Normalized name with legal suffixes stripped (Inc, Ltd, GmbH, LLC) → probable.
  - Surface duplicates as a review queue, never auto-merge fuzzy matches.
- **Export**: CSV of any saved view (filters and columns as shown), plus full JSON export of all objects. Agents need lossless round-trip.

### Gaps
- I did not retrieve the criteria HubSpot's "Manage duplicates" tool uses (name similarity, phone, zip and so on). The deduplication article does not list them.
- I did not find primary documentation for Attio's import mapping UI or for email validation depth (MX/SMTP checks) in any major CRM.
- Folk, Copper and Close merge rules were not checked.

---

## 3. Pipelines: multiple pipelines, stages and probabilities, won/lost and reasons, stage history, rotting, close date, value, currency, products

### Takeaway
A deal has a pipeline, a stage (each stage carries a win probability, and closed-won and closed-lost stages are required), an amount plus currency, an expected close date, an owner, a status (open/won/lost), and lost/won reasons. Weighted value = amount × stage probability. Stage history drives time-in-stage (HubSpot's entered, exited, latest and cumulative times). Pipedrive's per-stage **rotting** rule (N idle days, reset by any update or activity) is the best-known stale-deal mechanic.

### Cited Findings
**Stages and probabilities**
- HubSpot's default Sales Pipeline probabilities:

  | Stage | Probability |
  |---|---|
  | Appointment scheduled | 20% |
  | Qualified to buy | 40% |
  | Presentation scheduled | 60% |
  | Decision maker bought-in | 80% |
  | Contract sent | 90% |
  | Closed won | 100% (Won) |
  | Closed lost | 0% (Lost) |

  "You must include stages for both Won and Lost under Deal probability." — [HubSpot KB: Set up and customize pipelines](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines)
- HubSpot **conditional stage properties**: required properties can be set per stage, and "users cannot create or update the record until they set a value for it". — [HubSpot KB: Pipelines](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines)
- **Deleting a stage**: before deleting, you must "delete or move records to another pipeline" and remove references that the "Used in" column shows. Custom pipeline limits are 15 (Starter), 100 or 350 (Professional) and 350 (Enterprise). — [HubSpot KB: Pipelines](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines)
- HubSpot **Deal probability** "is updated automatically … when a user moves a deal to a new stage". Manually editing it disables automatic updates. — [HubSpot KB: Default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties)

**Deal value, weighted value and forecast fields (HubSpot defaults)**
- Amount, currency and weighted values:
  - **Amount** is "the total value of the deal in the deal's currency".
  - **Amount in company currency** is converted "based on the exchange rates set in your HubSpot account".
  - **Currency** appears only once multiple currencies are set up.
  - **Weighted amount** = "the Amount multiplied by the Deal probability".
  - **Forecast amount** = "deal amount multiplied by the forecast probability".
  - **Forecast category** is one of: Not forecasted, Pipeline, Best case, Commit, Closed won.
  - **ARR/MRR** are calculated from recurring line items and their term length.
- Status, dates and next step:
  - **Is closed won / Is closed lost** are set automatically by HubSpot.
  - **Closed lost reason** and **Closed won reason** are standard properties.
  - **Close date** is set automatically when a deal is created or moved to a closed stage. This automation can be disabled.
  - **Days to close** = time between Create date and Close date.
  - **Next step** is a free-text property.
  — [HubSpot KB: Default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties)
- Salesforce forecast categories:
  - **Pipeline**: open, early.
  - **Best Case**: likely, and includes Commit and Closed.
  - **Commit**: "fairly sure", with about 90% expected to close.
  - **Closed**: closed-won.
  - **Omitted**: excluded from the forecast.
  — [SalesforceBen: Forecast categories](https://www.salesforceben.com/forecast-categories-in-salesforce-everything-you-need-to-know/)

**Won/lost, reasons, reopening**
- Pipedrive uses **freeform lost reasons by default**. Admins can switch to **predefined lost reasons** (Company settings → Lost reasons), up to **100** per company account. — [Pipedrive KB: Lost reasons](https://support.pipedrive.com/en/article/lost-reasons); [Pipedrive KB: Enable predefined lost reasons](https://support.pipedrive.com/en/article/how-can-i-enable-predefined-lost-reasons)
- Reopening a lost deal and closing it again sets a new lost time, which changes reporting periods. Users automate "reopen 90 days after lost" for re-engagement. — [Pipedrive Community: reopening and win rate](https://community.pipedrive.com/discussion/comment/47176); [Pipedrive Community: reopen lost deal after 3 months](https://community.pipedrive.com/discussion/9070/reopen-lost-deal-after-3-months)
- Pipedrive deal API fields include `won_time`, `first_won_time`, `rotten_time`, `stage_change_time`, `weighted_value` and `lost_reason`. `won_time` reflects the current won status, while `first_won_time` records the first time the deal was won and "remains unchanged even if the deal is reopened". This is per Pipedrive API field descriptions surfaced through search and third-party connector docs; I did not fetch Pipedrive's own API reference. — [Saras Analytics: Pipedrive fields](https://docs.sarasanalytics.com/integrations/data-sources/saas-integrations/pipedrive); [Pipedrive dev community: reopen timestamp](https://devcommunity.pipedrive.com/t/reopen-timestamp-through-api/2022)

**Stage history and time-in-stage (HubSpot stage-calculated properties)**
- Per stage, HubSpot stores:
  - **Date entered [stage]** and **Date exited [stage]**.
  - **Latest time in [stage]**: time since the record last entered the stage. It stays blank while the record is in that stage, unless the record was there before.
  - **Cumulative time in [stage]**: total across multiple entries, "if a record re-enters a stage multiple times".
  - **Date entered current stage** and **Time in current stage**, which update continuously.
  These update when a deal is "closed then reopened", and they are populated "retroactively based on existing data". — [HubSpot KB: Stage calculated properties](https://knowledge.hubspot.com/properties/stage-calculated-properties)
- Workflows will not enroll on Cumulative or Latest time while the record is currently in that stage. Use Date entered current stage or Time in current stage instead. Example: a follow-up task when "Date entered Contract Sent is more than 7 days ago". — [HubSpot KB: Stage calculated properties](https://knowledge.hubspot.com/properties/stage-calculated-properties)
- Attio stage (status) values carry `active_from` / `active_until`. Options can set `target_time_in_status`. — [Attio: Status](https://docs.attio.com/rest-api/attribute-types/attribute-types-status.md)

**Rotting / stale deals (Pipedrive)**
- Configured **per stage**: "Click the 'Rotting in (days)' toggle … define the number of inactive days after which a deal in this stage is considered rotten." — [Pipedrive KB: The Rotting feature](https://support.pipedrive.com/en/article/the-rotting-feature)
- Actions that reset the timer:
  - marking activities as done;
  - adding notes and files;
  - sending, receiving, unlinking or deleting emails;
  - "updates that may not show up clearly in the deal changelog".
  A rotten deal is restored by "scheduling a new activity for the deal" or "editing any details of the deal, such as custom fields, expected close date, value". — [Pipedrive KB: The Rotting feature](https://support.pipedrive.com/en/article/the-rotting-feature)
- Edge case: "The rotting feature disregards the next activity date, so any deal with an activity scheduled far into the future can still go rotten." Visibility-restricted email actions can reset the timer invisibly. Rotten deals show a **red deal tile**. — [Pipedrive KB: The Rotting feature](https://support.pipedrive.com/en/article/the-rotting-feature)
- Pipedrive deal cards show next-activity state icons, and deals are ordered by this priority so urgent ones rise to the top of each column:
  - red arrow: overdue activity (very high priority);
  - green arrow: due today (high);
  - **yellow warning: no activity scheduled** (medium);
  - grey arrow: future activity (low).
  — [Pipedrive KB: Colored icons in Pipeline view](https://support.pipedrive.com/hc/en-us/articles/115001107229-What-are-the-colored-icons-on-the-deals-in-the-Pipeline-View-)

**Currency mixing**
- Pipedrive converts deal values to the company's default currency in reports through Open Exchange Rates. Custom currencies are excluded. Rates are "for statistical purposes only", and "the currency conversion continues to be updated after a deal is closed". Users have asked for fixed rates at close and for per-pipeline default currency, and neither has been implemented. — [Pipedrive KB: How is currency converted](https://support.pipedrive.com/en/article/how-is-currency-converted-in-pipedrive)
- Attio fixes one currency code per currency attribute. — [Attio: Currency](https://docs.attio.com/rest-api/attribute-types/attribute-types-currency.md)

### Inferences
- **Deal record (recommended fields)**:
  - Identity and placement: `name`, `pipeline_id`, `stage_id`, `status` enum(open, won, lost).
  - Value: `amount` with `currency`, `amount_base` (converted, **frozen at close time**), `fx_rate_used`, `fx_rate_date`.
  - Probability: `probability_override` (nullable). Effective probability = override ?? stage.probability.
  - Dates: `expected_close_date`, `closed_at` (set on won or lost), `first_won_at`.
  - Outcome: `lost_reason_id` + `lost_reason_note`, `won_reason`.
  - People and links: `owner`, `source` (lead source), `next_step` (text), `company_id`, people via a role-labeled join.
  - Computed: `last_activity_at`, `next_activity_at`, `stage_entered_at`, `rotten_since` (nullable).
- **Pipeline/stage tables**: `pipeline(id, name, order, archived_at)` and `stage(id, pipeline_id, name, order, probability 0..100, kind enum(open, won, lost), rotting_days nullable, target_days nullable, required_attribute_ids[])`. Enforce exactly one won and one lost stage per pipeline, or model won/lost as status independent of stage the way Pipedrive does.
- **Stage history**: an append-only `deal_stage_event(deal_id, from_stage, to_stage, from_status, to_status, at, actor)`. Derive entered, exited, latest and cumulative time per stage the way HubSpot does. Backfill is free because history is append-only.
- **Rotting rule** (Pipedrive semantics plus one improvement):
  - The deal is rotten when `status=open` AND `stage.rotting_days` is set AND `now − last_touched_at > rotting_days`.
  - `last_touched_at` = max of: deal field edit, stage change, note/file added, activity completed, activity scheduled, email linked.
  - Consider a toggle to also treat a *scheduled future activity* as "not rotting". Pipedrive ignores it, and users read that as a surprising edge case.
- **Won/lost rules**:
  - Marking lost requires a reason, either predefined or free text with an "Other" option.
  - Reopening sets status=open, keeps `first_won_at`/`first_lost_at` and clears `closed_at`.
  - Reports should state whether they use the *latest* or *first* close time.
- **Deleting a stage**: block it while deals reference the stage (HubSpot) and offer "move all deals to stage X". Stage history rows keep the stage ID with a tombstone name so old reports still render.
- **Currency**: freeze the base-currency value at close for won-revenue reports and use live rates for open pipeline. This avoids Pipedrive's "won revenue changes after close" complaint. Always show the original currency next to the converted value.
- **Products/line items (brief)**: `line_item(deal_id, product_id nullable, name, qty, unit_price, currency, discount_pct, recurring_interval nullable, term_months)`. Deal amount can optionally be computed as the sum of line items, and ARR/MRR derived as HubSpot does from recurring items.

### Gaps
- I did not confirm what Pipedrive does with stage history when a deal is moved between pipelines, or how HubSpot handles probabilities for multiple won stages.
- I did not retrieve exact Attio deal-object default attributes or Close opportunity fields (confidence, value_period).

---

## 4. Activity and communication: timeline, email logging (BCC/sync), meetings, calls, notes, tasks, @mentions, pinned notes, templates, sequences

### Takeaway
A unified, reverse-chronological **timeline** on every record aggregates emails, meetings, calls, notes, tasks and system events (stage changes, field edits). Emails are linked automatically by participant email address, and BCC/forward addresses handle manual logging. Notes can be pinned (HubSpot allows one per record). Sequences automatically unenroll contacts on reply or when a meeting is booked.

### Cited Findings
**Email logging and sync**
- Pipedrive **Smart Email BCC**:
  - Every lead and deal has its own unique BCC address. Pasting it into BCC links the email to that item.
  - Forwarding from an address linked to a person links the email to that person.
  - "Link emails to Pipedrive items" (Personal preferences → Email sync → General settings) auto-links to connected leads, deals and projects.
  - Edge case: an email auto-links to a deal **only if it is that person's only open deal**. With several open deals, the user must link manually.
  — [Pipedrive KB: Smart Email BCC](https://support.pipedrive.com/en/article/smart-email-bcc); [Pipedrive KB: emails showing under wrong deal](https://support.pipedrive.com/en/article/why-are-emails-sent-to-a-deal-specific-bcc-addresses-showing-up-under-the-wrong-deal)
- Attio email/calendar sync sharing levels are "Subject line and metadata" (default), "Metadata only" and "Full Access". Full access can be granted to particular members. — [Attio Help: Communication intelligence](https://attio.com/help/reference/attio-101/productivity/communications-intelligence)

**Activity counting semantics (HubSpot)**
- **Last activity date** is the most recent past note, call, logged sales email, meeting, LinkedIn/SMS/WhatsApp message or chat, and it includes completed tasks.
- **Last contacted** is the last chat, call, *non-forwarded one-to-one email*, meeting or message.
- **Number of sales activities** counts calls, meetings, emails, messages, tasks and notes.
- **Number of times contacted** counts activities but excludes tasks and notes.
- **Next activity date** is set automatically.
— [HubSpot KB: Default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties)

**Pinned notes**
- HubSpot: "You can pin one activity to the top of a contact, company, deal, ticket, or custom object record timeline. There can only be one pinned activity for each record", and it is visible to all users. API: set `hs_pinned_engagement_id` on the record, and the note must already be associated. — [HubSpot KB: Pin a note](https://knowledge.hubspot.com/contacts/pin-a-note-in-a-record); [HubSpot Developers: Notes API](https://developers.hubspot.com/docs/api-reference/latest/crm/activities/notes/guide)

**Tasks as timeline items**
- Attio task content is plaintext only, with "Rich text formatting, links and @references are not supported" and a 2000-character maximum. — [Attio: Create a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/create-a-task.md)

**Sequences/cadences basics**
- HubSpot sequences unenroll automatically "when a contact replies to any email" and "when a contact books a meeting":
  - An optional setting unenrolls everyone from the same company when one contact replies.
  - Meetings booked via a sequence email's meetings link unenroll the contact. Meetings booked via the record or a synced calendar unenroll only if they are with the user who enrolled the contact.
  - Both triggers can be turned off per sequence (Automate tab).
  — [HubSpot KB: Unenroll from sequence](https://knowledge.hubspot.com/sequences/unenroll-from-sequence)

**Inbox of communications**
- The Close Inbox combines inbound emails (including follow-up reminders), missed calls, inbound SMS, due tasks, "Opportunities on their expected closing date" and potential contacts. — [Close Help: Inbox](https://help.close.com/docs/inbox)

### Inferences
- **Activity entity (single polymorphic table)**:
  - Columns: `activity(id, type enum(note, email, meeting, call, task, sms, system), subject, body_md, occurred_at, due_at, done_at, direction(in/out), duration_s, outcome (call disposition: connected, no_answer, left_voicemail, wrong_number, busy), external_id/thread_id, author_actor, pinned bool)`.
  - Links: `activity_link(activity_id, record_id, role)` so one email can attach to a person, their company and a deal at once.
  - Cap pinning at 1 per record (HubSpot), or allow N pinned notes, a small UX improvement.
- **Email linking rules**:
  1. Match each participant address to people by normalized email and link the email to those people and their companies.
  2. Link to a deal only if exactly one open deal involves the matched people (Pipedrive's rule). Otherwise put it in an "unassigned" triage list.
  3. Never count forwarded or bulk email as "contacted" (HubSpot's Last contacted rule).
- **@mentions**: store mentions as structured tokens (`@[actor_id]` / `[[record_id]]`) in note markdown so the agent can parse them. A mention creates a notification inbox item. Attio's API does not support @references in tasks, which suggests mentions belong in notes or comments.
- **Templates**: email or note templates with `{{person.first_name}}`, `{{company.name}}` and `{{deal.amount}}` merge variables. Block sending when a variable resolves empty, or apply a fallback (`{{first_name|there}}`).
- **Sequences (local / agent-driven minimal version)**: `sequence(steps[{day_offset, channel: email|task|call, template_id}])` and `enrollment(person_id, sequence_id, step_idx, status(active, paused, finished, unenrolled), unenroll_reason)`. Unenroll on reply, on meeting booked, and optionally when anyone at the same company replies (HubSpot defaults).

### Gaps
- I did not fetch primary docs on call logging fields (Close or Pipedrive call outcomes), on templates, or on @mention notification rules. The call-disposition list above is a common pattern, not a cited spec.
- How Attio or HubSpot thread emails (Message-ID / In-Reply-To) was not researched.

---

## 5. Tasks and follow-ups: due dates, reminders, next step, My Work / inbox views, snoozing, overdue

### Takeaway
Tasks are lightweight records with content, a deadline, completion state, linked records and assignees (Attio's API shape). The daily "work queue" is an inbox with **Now / Done / Future** sections (Close), where snoozing moves items to Future. On deals, the next scheduled activity drives urgency signals (Pipedrive's red/green/yellow/grey icons). Keep-in-touch reminders are a separate cadence mechanism (see section 6).

### Cited Findings
- **Attio task schema** (all six fields required on create):
  - `content` (string, ≤2000 characters);
  - `format` (`"plaintext"` only);
  - `deadline_at` (ISO 8601 or null);
  - `is_completed` (bool);
  - `linked_records` (array of record refs, matchable by domain, email, record ID or a unique attribute);
  - `assignees` (array of `{referenced_actor_type, referenced_actor_id}` or `{workspace_member_email_address}`).
  — [Attio: Create a task](https://docs.attio.com/rest-api/endpoint-reference/tasks/create-a-task.md)
- **Close Inbox**: the "Inbox" section shows items to handle now, "Done" shows completed tasks and archived emails, and "Future" "shows your scheduled tasks or snoozed items". It includes due tasks and opportunities on their expected close date. — [Close Help: Inbox](https://help.close.com/docs/inbox)
- **Pipedrive deal urgency**: deal cards show red (overdue activity), green (due today), yellow (no activity scheduled) or grey (future activity), and columns sort by that priority. — [Pipedrive KB: Colored icons](https://support.pipedrive.com/hc/en-us/articles/115001107229-What-are-the-colored-icons-on-the-deals-in-the-Pipeline-View-)
- HubSpot has a **Next step** free-text deal property and an automatic **Next activity date**. — [HubSpot KB: Default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties)
- HubSpot workflows can create a follow-up task when "Date entered Contract Sent is more than 7 days ago". — [HubSpot KB: Stage calculated properties](https://knowledge.hubspot.com/properties/stage-calculated-properties)
- **Folk reminders**:
  - Can recur weekly, monthly or yearly.
  - Notify in the Folk inbox and by email at **9:00 AM local time**; "only the date is customizable, not the time".
  - "Reminders are only based on the date you set and are not affected if you have an interaction with the contact before the set date."
  - Team reminders can be shared with selected workspace members.
  — [Folk Help: Set reminders on your contacts](https://help.folk.app/en/articles/5658439-set-reminders-on-your-contacts)

### Inferences
- **Task model**: `task(id, title, notes_md, due_at, due_has_time bool, remind_at nullable, snoozed_until nullable, priority, status(open, done, cancelled), completed_at, assignee_actor, created_by_actor, recurrence_rule nullable (RRULE), source(manual, agent, sequence, automation))` plus `task_link(task_id, record_id)`.
  - Store date-only tasks as dates so time zones do not shift them. Folk's "date only, fire at 9 AM local" is a pragmatic default.
- **My Work / Today view** (copy the Close structure), with these sections:
  - **Overdue**: `due < today AND status=open`, oldest first.
  - **Today**.
  - **Upcoming** (next 7 days).
  - **Snoozed/Future**.
  - **Done** (recent).
  - Plus "attention" rows that are not tasks: unanswered inbound emails, deals with no next activity (Pipedrive yellow), rotten deals, deals past `expected_close_date` still open, and keep-in-touch contacts that are due.
- **Snooze** sets `snoozed_until`. The item leaves Inbox and returns at that time. Snooze must not change `due_at`, so overdue-ness stays reportable. Offer "Reschedule" (changes `due_at`) as a separate action.
- **Overdue handling**:
  - Never auto-close overdue tasks.
  - Offer bulk "move all overdue to today", "+1 day" or "+1 week".
  - Mark deals with an overdue next activity red.
  - Count overdue tasks as an activity-hygiene metric.
- **Next step on deals**:
  - Keep both a free-text `next_step` (HubSpot) and the derived `next_activity_at` from the earliest open task linked to the deal.
  - Warn when an open deal has no open task (Pipedrive yellow).
  - When a task is completed on a deal, prompt "schedule the next activity?". Pipedrive does this by default, though I did not cite it here.

### Gaps
- I did not find primary docs on HubSpot task queues, task reminder offsets, or Attio task reminders and snooze. The snooze semantics above are inference from Close's Inbox/Future model.
- I did not verify that Pipedrive prompts for the next activity after completion (widely known, but not fetched in this session).

---

## 6. Relationship intelligence: last contacted, interaction counts, strength, who-knows-whom, warm intro paths, keep-in-touch

### Takeaway
Auto-computed interaction attributes are the 2026 baseline: first, last and next interaction, split by email and calendar. **Connection strength** is weighted by recency and frequency (Attio), "strongest connection" names the team member with the best relationship, and second-degree intro paths take the **weaker of the two hops** as the path score (Village). Keep-in-touch cadences come in two styles: **date-based** (Folk, not reset by interaction) and **interaction-based** (Dex: next due = last interaction + frequency).

### Cited Findings
- **Attio interaction attributes**: First/Last/Next interaction, First/Last/Next email interaction, First/Last/Next calendar interaction, **Connection strength**, and **Strongest connection** (which team member has the strongest relationship with the record). — [Attio Help: Communication intelligence](https://attio.com/help/reference/attio-101/productivity/communications-intelligence)
- Attio connection strength is computed by "weighting the recency and frequency of the communication". Ten emails exchanged a year ago score weaker than ten exchanged last month. I found no published formula or discrete levels. — [Attio Help: Communication intelligence](https://attio.com/help/reference/attio-101/productivity/communications-intelligence)
- Historic values cannot be queried on Attio COMINT (communication-intelligence) or enriched attributes. The API returns 400. — [Attio: List record attribute values](https://docs.attio.com/rest-api/endpoint-reference/records/list-record-attribute-values.md)
- **Village connection scoring** (a published, concrete scheme):
  - Levels: 7+ = Excellent, 3–7 = Good, 1–3 = Okay, <1 = Weak.
  - Contact info: personal phone/email or LinkedIn connection +0.7 each, professional email +0.2.
  - Meetings: +1 per meeting, +10 for recurring meetings, +3 for meetings over 3 hours. Bonuses: mutually organized +50%, within the past year +30%, "friendly" (coffee etc.) +70%.
  - Overlapping work at a company under 20 employees +7, under 50 employees +3.
  - Shared school, same time, same major +3.
  - Private community +1.
  - Founder–investor (deal-led) +10.
  - Warm-intro paths: "the score is capped at the weaker of the two relationships" in second-degree paths.
  — [Village Docs: How we score connections](https://docs.village.ai/help-center/building-your-network/how-we-score-connections)
- **Dex keep-in-touch**:
  - When the last interaction updates, the keep-in-touch date resets to **Last Interaction + frequency** (e.g., Aug 1 + 1 month = Sep 1).
  - With no last interaction, the next date is **today + frequency**.
  - A feature request ("catch up by date calculation should start from last interaction, not the time I set the frequency") shows users expect anchoring on last interaction.
  — [Dex Guide: Keep-in-touch](https://guide.getdex.com/features/keep-in-touch); [Dex Guide: Last interaction](https://guide.getdex.com/features/last-interaction); [Dex feedback](https://feedback.getdex.com/p/catch-up-by-date-calculation-should-start-from-last-interaction)
- **Folk** reminders are date-based recurring reminders (weekly, monthly or yearly) and are not affected by interactions before the due date. — [Folk Help: Reminders](https://help.folk.app/en/articles/5658439-set-reminders-on-your-contacts)
- HubSpot's "Last contacted" excludes forwarded email. Only one-to-one emails, calls, meetings, chats and messages count. — [HubSpot KB: Default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties)
- **People changing jobs**: vendors in the "champion tracking" category describe re-enriching LinkedIn or email signals to detect job changes, finding the new work email, and alerting the owner. They claim detection "typically within 48 hours" and that champion-sourced pipeline converts at "3x". These are vendor marketing claims that I did not verify. — [LeadMagic: Champion job changes](https://leadmagic.io/blog/champion-job-changes)

### Inferences
- **Computed fields per person and company** (recompute on each activity insert):
  - `first_interaction_at`, `last_interaction_at`, `last_inbound_at`, `last_outbound_at`, `next_interaction_at` (next scheduled meeting or task);
  - `interaction_count_30d/90d/all`, `email_count`, `meeting_count`;
  - `strongest_connection_actor`, `connection_strength`.
  - A company's value = max or aggregate over its people.
- **Strength formula** (inference, consistent with Attio's description):
  - `strength = Σ_interactions w_type × 0.5^(age_days / half_life)` with a half-life of about 90 days.
  - Weights: two-way email thread 1, inbound reply 1.5, meeting 3, call 2, one-way outbound email 0.3.
  - Bucket the result into Very weak / Weak / Good / Strong / Very strong so the UI and the agent can sort and filter.
  - Exclude bulk, sequence and newsletter mail.
- **Keep-in-touch**:
  - Per person `kit_frequency_days` (nullable) and `kit_due_at = coalesce(last_interaction_at, kit_set_at) + frequency` (Dex semantics, better than Folk for a founder CRM).
  - Due items appear in My Work. "Snooze" pushes `kit_due_at`, and "Mark contacted" logs a manual interaction.
  - Offer cadence presets: 2 weeks, 1 month, 3 months, 6 months, 1 year.
- **Who-knows-whom / warm intros** (single-user or small team): a graph over team members ↔ people with edge weight = connection strength.
  - Intro path to target T at company C: for each person P you know at C (or P with a `knows` link to T), path score = min(strength(you, P), strength(P, T)) (Village rule).
  - Rank by path score, then by recency.
  - Store explicit `knows` relationships (person ↔ person, label e.g. "former colleague", "investor") because a local app has no network-wide data.
- **Job changes**:
  - Model employment as history: `employment(person_id, company_id, title, start, end, is_current)`, not a single `company` field. When a new email domain or company is set, close the old employment (end = today) instead of overwriting it.
  - Keep old emails as secondary values flagged "bounced/former".
  - Flag past champions who moved as "warm lead at new company".

### Gaps
- I found no published formula for Attio's connection strength or Clay's relationship scoring. Affinity's relationship-score method was referenced in search but not fetched.
- Folk's "last interaction" field semantics and Clay's keep-in-touch rules were not retrieved.

---

## 7. Reporting: pipeline by stage, weighted forecast, win rate, velocity, funnel conversion, activity metrics, lead source, time-in-stage

### Takeaway
The definitions to copy are:
- **Weighted pipeline** = Σ(amount × stage probability) (HubSpot).
- **Win rate** = won ÷ (won + lost) over closed deals in the period. Salesforce's blog uses won ÷ all opportunities, so state the definition in the UI.
- **Sales velocity** = (# qualified opps × avg deal value × win rate) ÷ avg sales-cycle days (Salesforce).
- **Stage-to-stage conversion** counts each deal's *first* entry into a stage and treats skipped stages as passed through (Pipedrive).

### Cited Findings
- **Weighted amount** = Amount × Deal probability. **Forecast amount** = amount × forecast probability. **Days to close** = Close date − Create date. — [HubSpot KB: Default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties)
- **Sales velocity** = (Opportunities × Deal Value × Win Rate) ÷ Length of Sales Cycle.
  - Opportunities = qualified (SQL) pipeline count.
  - Avg deal value = total revenue ÷ deals closed.
  - Win rate = deals won ÷ total opportunities.
  - Cycle length = Σ days-to-close ÷ number of deals.
  - Example: (150 × $1,000 × 0.25) ÷ 30 = **$1,250/day**, which is about $112,500 per quarter.
  — [Salesforce: Sales velocity](https://www.salesforce.com/blog/sales-velocity/)
- **Win rate (Salesforce)** = Won Opportunities ÷ Total Opportunities × 100, which differs from **close rate** = won ÷ total leads. — [Salesforce: Win rate](https://www.salesforce.com/sales/win-rate/)
- RevOps glossaries define win rate on a closed cohort, Closed Won ÷ (Closed Won + Closed Lost), excluding open deals. This comes from search-result summaries of glossary pages that I did not fetch individually. — [Count: Win rate](https://count.co/metric/win-rate); [Salesbox glossary](https://salesbox.ai/glossary/win-rate)
- **Pipedrive conversion reports**:
  - Two types: **Funnel conversion** (stage-to-stage) and **Win/loss conversion** (won vs lost).
  - By default the funnel covers deals created this year in a pipeline. Won deals count as having completed every stage "no matter where they were closed", and lost deals stop at the stage they were lost in.
  - Only the **first** entry into a stage counts, and moving stage 1 → 3 counts as passing through stage 2 ("no skipping").
  — [Pipedrive KB: Insights reports – deal conversion](https://support.pipedrive.com/en/article/insights-reports-deal-conversion)
- Time-in-stage reports come from HubSpot's **Cumulative time in [stage]** properties, for example a report of total time across stages. — [HubSpot KB: Stage calculated properties](https://knowledge.hubspot.com/properties/stage-calculated-properties)
- Re-closing a reopened deal moves its lost or won date and changes period stats. — [Pipedrive Community](https://community.pipedrive.com/discussion/comment/47176)
- Currency: Pipedrive reports convert to the default currency with live rates, including after close. — [Pipedrive KB: Currency conversion](https://support.pipedrive.com/en/article/how-is-currency-converted-in-pipedrive)
- Activity metric definitions: "Number of sales activities" includes tasks and notes, while "Number of times contacted" excludes them. — [HubSpot KB: Default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties)
- Forecast categories are Pipeline / Best case / Commit / Closed (won) / Omitted or Not forecasted. — [HubSpot KB: Default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties); [SalesforceBen](https://www.salesforceben.com/forecast-categories-in-salesforce-everything-you-need-to-know/)

### Inferences
- **Formula sheet** to implement. Show each definition in a tooltip, and parameterize every metric by period, pipeline and owner.
  - **Open pipeline by stage** = Σ amount_base of status=open deals grouped by stage. Show count, sum and average age.
  - **Weighted pipeline** = Σ amount_base × effective_probability/100 over open deals. Optional filter: expected_close_date in period.
  - **Forecast (period)** = Closed won in period + Σ weighted open deals with expected_close_date in period. Optionally show by forecast category (Commit and Best case totals).
  - **Win rate (count)** = won ÷ (won + lost), counting deals whose `closed_at` falls in the period. **Win rate (value)** = Σ won amount ÷ Σ (won + lost) amount. Exclude "disqualified" lost reasons optionally, as a toggle.
  - **Average deal size** = Σ won amount ÷ # won (period).
  - **Sales cycle** = mean (or median, which is more robust) of `closed_at − created_at` for won deals in the period.
  - **Sales velocity** = (# open qualified opps × avg deal size × win rate) ÷ avg cycle days, in currency per day. Also show the per-month figure.
  - **Stage conversion** for stage k→k+1 = deals that ever reached k+1 ÷ deals that ever reached k, using first entries only, treating skipped stages as passed and won deals as reaching all stages (Pipedrive rules).
  - **Time in stage** = mean or median cumulative time per stage, for deals that exited the stage in the period.
  - **Activity metrics** = count of activities by type, owner and week. Separately report "contacted" (calls, meetings, 1:1 emails) vs "worked" (also notes and tasks), following HubSpot's split.
  - **Lead source** = won count, won value and win rate grouped by deal `source` (or the source of the primary person).
  - **Cohorts** = deals grouped by created month, showing the % won, lost and open at +30/60/90 days.
- **Currency in reports**: convert open deals at the current rate and won/lost deals at the frozen close-time rate. Display a "converted to USD at rates as of …" note.
- **Reopened deals**: report on latest close by default, with a toggle for "first outcome", using `first_won_at`.

### Gaps
- I found no authoritative standard for whether "no decision" or disqualified deals belong in the win-rate denominator. Vendors differ, and Salesforce's blog uses all opportunities.
- Lead-source attribution rules (first-touch vs last-touch) and HubSpot's funnel report definitions were not retrieved.

---

## 8. Search, filters and views: filter grammar, saved views, sorting, grouping, smart lists

### Takeaway
Use a JSON filter AST with `$and/$or/$not`, per-attribute operators (`$eq, $contains, $starts_with, $ends_with, $lt/$lte/$gt/$gte, $in, $not_empty`), sub-field addressing (e.g., `name.first_name`, `currency_value`), and **path filters across relationships** (Attio). Saved "smart views" (Close) are dynamic: records flow in and out as data changes, and they support activity-based conditions such as "not contacted in X days".

### Cited Findings
- **Attio filter grammar**:
  - *Shorthand* is an equality map (`{"name":"John Smith"}`). *Verbose* is `{"$and":[{"name":{"full_name":{"$eq":"John Smith"}}}, …]}`.
  - Operators: `$eq`, `$not_empty`, `$in`, `$contains` (case-insensitive substring), `$starts_with`, `$ends_with`, `$lt/$lte/$gt/$gte`. "Support varies by attribute type."
  - Logical operators: `$and` (implied in shorthand), `$or`, and `$not`. There are no inverse operators like `$neq`; use `$not`.
  - Path filtering: `{"path":[["candidates","parent_record"],["people","email_addresses"]], "constraints":{"email_domain":"apple.com"}}`.
  - Sorts: `{"sorts":[{"direction":"asc","attribute":"name","field":"last_name"}]}`, plus path-based sorts such as `[["people","company"],["companies","name"]]`.
  — [Attio: Filtering and sorting](https://docs.attio.com/rest-api/guides/filtering-and-sorting.md)
- Status attributes can be filtered by **when** they changed using `active_from` with `$gte/$lt` (e.g., "moved to stage X since date"). — [Attio: Status](https://docs.attio.com/rest-api/attribute-types/attribute-types-status.md)
- Currency filters target sub-fields, e.g., `{"amount_owed":{"currency_value":{"$gte":500}}}`. — [Attio: Currency](https://docs.attio.com/rest-api/attribute-types/attribute-types-currency.md)
- **Close Smart Views**:
  - "Saved Lead Filters that give you 1-click access". "Leads dynamically flow in and out of Smart Views based on your filters."
  - Combinable queries include activity-based ones (calls, emails, SMS, WhatsApp, meetings, notes, custom activities), such as "has not been contacted in X days" or "called twice".
  - Views can be shared or kept private and reordered by drag-and-drop in the sidebar.
  - Recommended workflow: a sequence of views such as untouched leads → attempted → cold cadence → warm with opportunities.
  — [Close Help: Smart Views](https://help.close.com/docs/smart-views)

### Inferences
- **Filter AST for the local CRM API** (Attio-compatible so agents can transfer knowledge):
  ```json
  {"filter": {"$and": [
     {"attr": "stage", "op": "$in", "value": ["Proposal","Negotiation"]},
     {"$or": [
        {"attr": "amount", "field": "value", "op": "$gte", "value": 10000},
        {"attr": "owner", "op": "$eq", "value": "me"}]},
     {"$not": {"attr": "tags", "op": "$contains", "value": "churned"}},
     {"path": [["deals","company"],["companies","domains"]], "op": "$ends_with", "value": ".io"},
     {"attr": "last_interaction_at", "op": "$lt", "value": {"relative": "-30d"}}]},
   "sort": [{"attr":"expected_close_date","dir":"asc","nulls":"last"}],
   "group_by": "stage"}
  ```
  - Add **relative dates** (`today`, `-30d`, `start_of_quarter`), `$is_empty`, `me` for the current actor, and an **activity predicate** (`{"activity": {"type":"call","op":"count_gte","value":2,"within":"14d"}}`) for Close-style smart views.
- **Operator matrix per type**:

  | Type | Operators |
  |---|---|
  | text | eq, contains, starts_with, ends_with, empty |
  | number / currency / date | eq, lt, lte, gt, gte, between, empty, relative date |
  | select / status | eq, in, empty; status also changed_since (active_from) |
  | multi_select | contains_any, contains_all, empty |
  | reference | eq / in record IDs, path traversal |
  | checkbox | eq |

- **Saved view** = `{id, object_or_list, name, filter_ast, sort[], group_by, visible_columns[], column_widths, layout(table, board, calendar), is_shared, position}`. A board layout groups by a status or select attribute, which is how a pipeline view works. Views are always dynamic. A "static list" is a list (section 1), not a view.
- **Global search** covers names, emails, domains, phones and note text through a full-text index; Twenty has a TS_VECTOR field type for this. Rank exact email/domain hits first. Expose `GET /search?q=` for agents.

### Gaps
- I did not retrieve Attio's full per-type operator support matrix, HubSpot's filter limits (number of AND/OR groups), or Twenty's view/filter persistence model.

---

## 9. Undo, history and audit: field change history, restore deleted records, activity log

### Takeaway
Best practice combines three things. **Per-attribute value history** stores actor and validity interval (Attio `active_from` / `active_until` / `created_by_actor`). **Soft delete with a restore window** keeps records restorable (HubSpot: 90 days, 10,000 records per restore, blocked if the email collides with an active contact; GDPR deletes are immediate and permanent). A **system-event timeline** records stage changes and edits. Merges in HubSpot cannot be undone.

### Cited Findings
- **Attio historic values**: `show_historic=true` returns all values "sorted from oldest to newest (by active_from)". Each value has `active_from`, `active_until` (null = current) and `created_by_actor` (workspace member, API token, system or app). This is not available for COMINT or enriched attributes (400 error). — [Attio: List record attribute values](https://docs.attio.com/rest-api/endpoint-reference/records/list-record-attribute-values.md)
- **HubSpot restore records**:
  - Deleted records can be restored "up to 90 days after they were deleted", and "some of the data associated with them will still be lost".
  - Permanent or GDPR deletions are immediate and cannot be restored.
  - A deleted contact cannot be restored if its email matches an active contact.
  - The tool restores at most 10,000 records at a time.
  — [HubSpot KB: Restore deleted records](https://knowledge.hubspot.com/records/restore-deleted-records)
- HubSpot deleted activities (notes, calls, meetings, tasks) are restorable within 90 days and permanently deleted after that. — [HubSpot KB: Restore deleted activity in a record](https://knowledge.hubspot.com/records/restore-deleted-activity-in-a-record)
- HubSpot merges create a new record ID and "it's not possible to unmerge records". — [HubSpot KB: Merge records](https://knowledge.hubspot.com/records/merge-records)
- Pipedrive warns that some actions reset rotting but "may not show up clearly in the deal changelog". Visibility restrictions on email actions can make a deal look untouched. — [Pipedrive KB: The Rotting feature](https://support.pipedrive.com/en/article/the-rotting-feature)

### Inferences
- **Event log as the source of truth**:
  - Table: `event(id, at, actor (user | agent:<name> | import:<id> | system), action(create, update, delete, restore, merge, link, unlink, stage_change, import), object, record_id, diff_json {attr: {from, to}}, request_id, batch_id)`.
  - Combined with versioned `attribute_value` rows (section 1), this provides field history per record, a global audit log, and a record timeline of "system" items.
- **Undo**:
  - Every mutating API call returns an `event_id` or `batch_id`, and `POST /undo {batch_id}` applies inverse diffs.
  - The UI shows a toast with "Undo" for about 10 seconds after edits, deletes, bulk updates, merges and imports.
  - This matters for an AI agent: every agent write should be revertible as a batch. Batch undo goes beyond what HubSpot or Pipedrive offer and is a differentiator.
- **Soft delete**:
  - Deleting sets `deleted_at` and hides the record from views and search. A "Recently deleted" view supports restore within 90 days (HubSpot parity), and "Delete permanently" is explicit.
  - On restore, re-check unique keys (HubSpot's email-collision rule). If a new record now owns the email, offer a merge instead.
  - Cascade rules: deleting a company does **not** delete its people. It unlinks them, and the restore re-links them. Deleting a person soft-deletes their list entries and keeps their activities, which still show on the company and deal timelines.
- **Merge undo**: store the secondary snapshot plus the re-pointed link IDs in the merge event so the merge can be reversed (see section 2).

### Gaps
- I found no primary documentation on Attio's delete semantics (soft vs hard, restore). The Attio delete endpoint doc says nothing about restore.
- I could not retrieve Twenty's soft-delete and "deleted records" view behavior or its timelineActivity schema from docs. The search returned nothing relevant, and I did not have time to read the source further.

---

## 10. Cross-cutting key questions: exact rules, tricky edge cases, table stakes vs differentiators

### Takeaway
Most of the hard rules already exist in vendor docs and can be copied:
- HubSpot merge precedence and stage-time properties;
- Pipedrive's per-stage rotting and "only open deal" email linking;
- Attio's upsert, value history and filter grammar;
- Salesforce's velocity formula.

The edge cases that break implementations involve **identity**: duplicates, job changes, merges, multiple open deals per contact. They also involve **time**: reopened deals, skipped stages, deleted stages, and FX rates moving after close. For a 2026 small-team CRM, auto-capture of interactions and relationship intelligence are close to table stakes. Agent-safe APIs with batch undo, and reversible merges, are where a product can differentiate.

### Cited Findings (rules collected from the sections above)
- Merge precedence:
  - The primary wins and blanks are filled from the secondary.
  - Secondary email and domain are kept as secondary values.
  - Lifecycle keeps the furthest stage, and create date keeps the oldest.
  - Conversions are summed.
  - The merged record gets a new ID, and merges cannot be undone.
  — [HubSpot KB: Merge records](https://knowledge.hubspot.com/records/merge-records)
- Pipedrive merges keep the primary's values with no per-field picking. — [Pipedrive KB: Merge duplicates](https://support.pipedrive.com/th/article/merge-duplicates)
- Stale-deal threshold is per stage, "Rotting in (days)". The timer resets on edits, notes, files, emails and completed or scheduled activities, and it ignores the next activity date. — [Pipedrive KB: Rotting](https://support.pipedrive.com/en/article/the-rotting-feature)
- Weighted = Amount × Deal probability, with probability set from the stage on each move. — [HubSpot KB: Default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties)
- Velocity = (Opps × Avg deal × Win rate) ÷ Cycle days. — [Salesforce](https://www.salesforce.com/blog/sales-velocity/)
- Win rate is won ÷ total opportunities (Salesforce) vs won ÷ (won + lost) on a closed cohort (RevOps glossaries). — [Salesforce](https://www.salesforce.com/sales/win-rate/); [Count](https://count.co/metric/win-rate)
- Funnel conversion counts the first stage entry, treats skipped stages as passed, and treats won deals as completing every stage. — [Pipedrive KB](https://support.pipedrive.com/en/article/insights-reports-deal-conversion)
- An email auto-links to a deal only if it is the contact's only open deal. — [Pipedrive KB: Smart BCC](https://support.pipedrive.com/en/article/smart-email-bcc)
- Upsert rejects a value that matches more than one record. — [Attio: Upsert](https://docs.attio.com/rest-api/endpoint-reference/records/upsert-a-record.md)
- A stage cannot be deleted while records sit in it. — [HubSpot KB: Pipelines](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines)
- Restore is possible within 90 days and is blocked by an email collision. — [HubSpot KB: Restore](https://knowledge.hubspot.com/records/restore-deleted-records)
- Pipedrive reports keep re-converting FX after close. — [Pipedrive KB: Currency](https://support.pipedrive.com/en/article/how-is-currency-converted-in-pipedrive)
- A single-person deal model leaves participants out of reports. — [Pipedrive KB: Participants](https://support.pipedrive.com/article/participants)

### Inferences

**Edge cases and recommended handling**

| Edge case | Recommended handling |
|---|---|
| Same person at two companies (advisor, board member, job change) | Use employment history with `is_current` and labeled associations ("Primary", "Advisor"). Dedupe on email, not on name+company. |
| Person changes jobs | Close the old employment. Keep the old email as a secondary "former" value. The person stays one record linked to both companies. Old deals keep pointing at the old company. |
| Shared or role inboxes (sales@, info@) | Do not create a person (or flag "role address"). Attach the email to the company only. |
| Free-mail domains | Never derive a company from them. |
| Same domain, multiple companies (subsidiaries) or one company with many domains | Company `domains` is multi-value (Attio, HubSpot secondary domains). Use parent/child company links (HubSpot labels). |
| Deals with multiple contacts | Use a many-to-many with roles. Email linking falls back to manual or a triage queue when there are 2+ open deals (Pipedrive rule). |
| Currency mixing | Store the per-deal currency. Convert at report time, and freeze FX at close for won/lost. Never sum raw amounts across currencies. |
| Deleted stage | Block the deletion or force a move. Keep history rows with a tombstoned stage name. |
| Stage renamed or reordered | History references stage IDs, not names. Funnel order uses the current order. |
| Reopened lost or won deal | Keep `first_*` timestamps. Cumulative time-in-stage continues (HubSpot). Reports pick latest or first close explicitly. |
| Skipped stages | Funnel treats them as passed through (Pipedrive). Time-in-stage for skipped stages = 0, not null. |
| Probability manually overridden | Stop auto-updating, as HubSpot does, and show an "overridden" indicator. Clear the override on the next stage move only if the user opts in. |
| Merge of records that both have open deals or list entries | Re-point everything. Duplicate list entries are allowed (Attio), so flag them for review. |
| Agent writes ambiguous matches | Reject the upsert on multiple matches (Attio) and return candidate IDs so the agent can disambiguate. |
| Restore after the unique key was reused | Offer to merge into the record that now holds the key (HubSpot blocks the restore). |
| Time zones | Date-only due dates and close dates are stored as dates. Timestamps are UTC, and "today" is computed in the user's time zone. |

**Table stakes vs differentiators for a founder or small-team CRM in 2026** (judgment, not a cited survey)
- *Table stakes*:
  - people, companies and deals with custom fields;
  - multiple pipelines with stage probabilities and a kanban view;
  - won/lost with reasons;
  - a unified activity timeline (notes, tasks, email, meetings);
  - CSV import with dedupe and upsert, and CSV export;
  - duplicate detection and merge;
  - saved filtered views (table and board);
  - tasks with due dates and a Today/overdue view;
  - basic reports (pipeline by stage, weighted forecast, win rate);
  - field history and a restorable trash;
  - email/calendar sync, or at least BCC/forward logging;
  - domain-based company auto-create with logos;
  - a REST API.
- *Increasingly expected (Attio and Folk set the bar)*:
  - auto-computed last/next interaction and connection strength;
  - "strongest connection" on companies;
  - lists with list-specific attributes;
  - relationship-attribute two-way sync;
  - stale or rotting deal signals;
  - keep-in-touch cadences.
- *Differentiators*:
  - an agent-first ops API (idempotent upserts by natural key, filter AST, batch writes with **batch undo**, event stream);
  - reversible merges;
  - warm-intro path finding over your own graph (Village-style min-edge scoring);
  - job-change and employment history;
  - frozen-FX won revenue;
  - explainable metrics (each formula shown);
  - Close-style unified inbox that mixes tasks, replies, rotting deals and keep-in-touch due items;
  - local-first privacy (email bodies stay local, with Attio-style sharing levels).

### Gaps
- I found no 2026 market survey that ranks table-stakes features for small-team CRMs. The list above is synthesized from vendor capabilities, not from survey data.
- Copper, EspoCRM and SuiteCRM docs were not consulted within the tool-call budget, and Twenty's audit and soft-delete semantics remain unverified.
