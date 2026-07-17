"""
Demo data seed (F10.1): a rich, realistic dataset for an AI-agent startup —
~60 people, 20 companies, deals across a Sales Pipeline and a Fundraising
pipeline, a Design Partners list (companies), a Community list (people),
custom attributes, notes, tasks, email logs, and a backdated activity
history so the dashboard, timeline, and velocity report look alive.

Deterministic: seeded RNG, dates relative to today.
"""

import random
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from bootstrap import ensure_defaults
from crm_core import log_activity, pick_color, slugify
from models import (
    Activity,
    AiRun,
    AppState,
    Attachment,
    Attribute,
    AttributeValue,
    Company,
    Deal,
    DealPerson,
    EmailLog,
    EmailTemplate,
    ListEntry,
    Note,
    Person,
    RecordList,
    RecordTag,
    SavedView,
    Stage,
    Tag,
    Task,
)

NOW = datetime.utcnow


def days_ago(n: int, hour: int = 10) -> datetime:
    return (NOW() - timedelta(days=n)).replace(hour=hour, minute=15, second=0, microsecond=0)


def iso_in(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


COMPANIES = [
    # name, domain, industry, size, location, revenue(M)
    ("Northwind Robotics", "northwindrobotics.com", "Robotics", "51-200", "Boston, MA", 24.0),
    ("Lumen Analytics", "lumenanalytics.io", "Data & Analytics", "11-50", "San Francisco, CA", 8.5),
    ("Helios Health", "helioshealth.com", "Healthcare", "201-500", "Austin, TX", 61.0),
    ("Papercrane", "papercrane.co", "Design Tools", "11-50", "Berlin, DE", 4.2),
    ("Quantia Bank", "quantiabank.com", "Fintech", "501-1000", "London, UK", 240.0),
    ("Fieldstone Legal", "fieldstonelegal.com", "Legal Services", "51-200", "Chicago, IL", 32.0),
    ("Orbit Logistics", "orbitlogistics.net", "Logistics", "201-500", "Rotterdam, NL", 88.0),
    ("Cobalt Games", "cobaltgames.gg", "Gaming", "51-200", "Los Angeles, CA", 19.0),
    ("Verdant Grid", "verdantgrid.com", "Clean Energy", "11-50", "Denver, CO", 6.7),
    ("Atlas Learning", "atlaslearning.org", "EdTech", "51-200", "Toronto, CA", 15.3),
    ("Brightside Retail", "brightsideretail.com", "E-commerce", "201-500", "Seattle, WA", 74.0),
    ("Kestrel Security", "kestrelsec.com", "Cybersecurity", "11-50", "Tel Aviv, IL", 9.9),
    ("Mistral Media", "mistralmedia.fr", "Media", "51-200", "Paris, FR", 22.0),
    ("Sable & Co", "sableandco.com", "Consulting", "11-50", "New York, NY", 12.5),
    ("Tidewater Foods", "tidewaterfoods.com", "Food & Beverage", "501-1000", "Portland, OR", 130.0),
    ("Hawthorne Ventures", "hawthorne.vc", "Venture Capital", "1-10", "Palo Alto, CA", None),
    ("Bluecap Capital", "bluecapcapital.com", "Venture Capital", "1-10", "New York, NY", None),
    ("Foundry Angels", "foundryangels.com", "Angel Syndicate", "1-10", "San Francisco, CA", None),
    ("Meridian Partners", "meridianpartners.vc", "Venture Capital", "11-50", "London, UK", None),
    ("Sequent Labs", "sequentlabs.ai", "AI Research", "11-50", "Zurich, CH", 3.1),
]

FIRST_NAMES = [
    "Ava", "Liam", "Maya", "Noah", "Zoe", "Ethan", "Isla", "Lucas", "Nora", "Owen",
    "Priya", "Diego", "Hana", "Marcus", "Elena", "Tomas", "Ines", "Felix", "Sofia", "Jonas",
    "Amara", "Kai", "Leila", "Victor", "Freya", "Andre", "Mika", "Clara", "Ravi", "Tessa",
]
LAST_NAMES = [
    "Calloway", "Nguyen", "Okafor", "Lindqvist", "Moreau", "Tanaka", "Petrov", "Alvarez",
    "Whitfield", "Kaur", "Bergman", "Castillo", "Ito", "Novak", "Sørensen", "Mbeki",
    "Halloran", "Vasquez", "Kimura", "Ostrowski", "Ferreira", "Blackwood", "Ayala", "Strand",
]
JOB_TITLES = [
    "CEO", "CTO", "VP Engineering", "Head of Product", "Head of Operations",
    "Engineering Manager", "Product Manager", "Head of Growth", "COO",
    "Director of IT", "Head of Data", "Founder", "Managing Partner", "Principal",
    "Community Lead", "Developer Advocate", "Solutions Architect", "CFO",
]
LOCATIONS = [
    "San Francisco, CA", "New York, NY", "Austin, TX", "Boston, MA", "Seattle, WA",
    "London, UK", "Berlin, DE", "Paris, FR", "Toronto, CA", "Amsterdam, NL",
]

SALES_DEALS = [
    # name, company idx, value, stage name, days_in_flight
    ("Northwind — Agent platform pilot", 0, 48000, "Demo", 21),
    ("Lumen — Workflow automation", 1, 24000, "Qualified", 14),
    ("Helios — Clinical ops agents", 2, 96000, "Proposal", 35),
    ("Papercrane — Design ops assistant", 3, 12000, "Contacted", 6),
    ("Quantia — Compliance copilot", 4, 150000, "Negotiation", 48),
    ("Fieldstone — Contract triage", 5, 54000, "Qualified", 18),
    ("Orbit — Dispatch automation", 6, 78000, "Demo", 25),
    ("Cobalt — Player support agents", 7, 36000, "Lead", 3),
    ("Verdant — Grid report agent", 8, 18000, "Contacted", 9),
    ("Atlas — Tutor copilot", 9, 42000, "Proposal", 30),
    ("Brightside — Catalog enrichment", 10, 66000, "Qualified", 12),
    ("Kestrel — SOC summarizer", 11, 30000, "Lead", 2),
    ("Mistral — Newsroom assistant", 12, 27000, "Contacted", 8),
    ("Sable — Research agents", 13, 21000, "Demo", 16),
    ("Tidewater — Supplier agent", 14, 84000, "Negotiation", 40),
    ("Sequent — Eval harness", 19, 15000, "Lead", 4),
    # Closed deals for win-rate history
    ("Latch Systems — Support copilot", 10, 38000, "WON:35", 0),
    ("Argo Freight — Ops agents", 6, 52000, "WON:65", 0),
    ("Pinebrook — Intake automation", 5, 26000, "WON:12", 0),
    ("Corvid Apps — Agent API", 7, 19000, "LOST:28", 0),
    ("Halcyon Travel — Concierge", 13, 33000, "LOST:50", 0),
    ("Emberline — Docs agent", 3, 14000, "WON:80", 0),
    ("Stratus Nine — Infra copilot", 11, 47000, "LOST:95", 0),
]

FUNDRAISING = [
    ("Seed — Hawthorne Ventures", 15, 1500000, "Pitch"),
    ("Seed — Bluecap Capital", 16, 1000000, "Diligence"),
    ("Angel — Foundry Angels", 17, 250000, "Committed"),
    ("Seed — Meridian Partners", 18, 2000000, "Intro"),
    ("Seed extension — Sable & Co", 13, 500000, "Target"),
]

NOTES = [
    ("person", "Call recap", "Walked through the agent platform demo. Very engaged on the workflow-builder piece — wants SOC2 report before procurement. Follow up with security docs.\n\n- Send SOC2 + pen test summary\n- Intro to solutions team\n- Check in Friday"),
    ("person", "Conference chat", "Met at AgentConf. Building internal automations, frustrated with brittle scripts. Asked about pricing for 50 seats — send tier sheet."),
    ("deal", "Champion mapping", "**Champion:** VP Eng (strong).\n**Economic buyer:** CFO — hasn't seen demo yet.\n**Risk:** competing internal build. Need ROI one-pager."),
    ("company", "Account plan", "Land with support-ticket triage (fastest time-to-value), expand into ops automation in Q4. Procurement requires vendor review > $50k."),
    ("deal", "Pricing discussion", "They pushed for annual prepay discount. Offered 12% at $90k+/yr. Waiting on their board sign-off — expected next week."),
]

COMMUNITY_NOTES = [
    "Active in our Discord — answered 12 questions last month. Potential moderator.",
    "Wrote a great tutorial on multi-agent setups. Ask about co-marketing.",
    "Runs a 2k-member AI builders meetup. Offered a speaking slot next month.",
]

TASKS = [
    ("Send SOC2 report to Northwind", -2, "deal", 0),
    ("Follow up on Quantia legal review", 0, "deal", 4),
    ("Prep Helios proposal deck", 0, "deal", 2),
    ("Intro call with Meridian associate", 1, "deal", None),
    ("Ship ROI one-pager to Tidewater", 2, "deal", 14),
    ("Check in with Papercrane trial users", 3, "person", None),
    ("Book AgentConf follow-up dinner", 5, "person", None),
    ("Quarterly cleanup: archive stale leads", 9, None, None),
    ("Draft design-partner case study", 12, "company", None),
    ("Renewal check-in — Latch Systems", 20, "company", 10),
]


def clear_crm_data(db: Session) -> None:
    """Remove all CRM data (keeps users and SMTP config)."""
    for model in (Activity, Note, Task, EmailLog, AttributeValue, Attribute, ListEntry,
                  Stage, SavedView, RecordList, RecordTag, Tag, DealPerson, Attachment,
                  AiRun, Deal, Person, Company, EmailTemplate):
        db.query(model).delete()
    state = db.query(AppState).first()
    if state is not None:
        data = state.data or {}
        data["demoSeeded"] = False
        state.data = dict(data)
    db.commit()


def seed_demo_data(db: Session, actor: str = "CraftBot") -> dict:
    """Idempotent-ish: wipes CRM data then seeds the full demo dataset."""
    rng = random.Random(42)
    clear_crm_data(db)
    ensure_defaults(db)

    # ---- Companies ----
    companies = []
    for index, (name, domain, industry, size, location, revenue) in enumerate(COMPANIES):
        company = Company(
            name=name, domain=domain, industry=industry, size=size, location=location,
            annual_revenue=(revenue * 1_000_000) if revenue else None,
            avatar_color=pick_color(name),
            description=f"{industry} company" + (f" headquartered in {location}." if location else "."),
            created_at=days_ago(120 - index * 3),
        )
        db.add(company)
        companies.append(company)
    db.flush()

    # ---- People (~60) ----
    people = []
    used_names = set()
    person_count = 58
    for index in range(person_count):
        while True:
            first = FIRST_NAMES[rng.randrange(len(FIRST_NAMES))]
            last = LAST_NAMES[rng.randrange(len(LAST_NAMES))]
            if (first, last) not in used_names:
                used_names.add((first, last))
                break
        company = companies[index % len(companies)]
        title = JOB_TITLES[rng.randrange(len(JOB_TITLES))]
        email = f"{first.lower()}.{last.lower().replace(' ', '')}@{company.domain}"
        person = Person(
            first_name=first, last_name=last, emails=[email],
            phones=[f"+1 (555) 0{rng.randint(100, 199)}-{rng.randint(1000, 9999)}"] if rng.random() < 0.6 else [],
            job_title=title, company_id=company.id,
            location=LOCATIONS[rng.randrange(len(LOCATIONS))],
            linkedin=f"https://linkedin.com/in/{first.lower()}-{last.lower().replace(' ', '')}",
            avatar_color=pick_color(first + last),
            created_at=days_ago(rng.randint(10, 110)),
        )
        db.add(person)
        people.append(person)
    db.flush()

    # ---- Custom attributes ----
    persona_attr = Attribute(
        object_type="person", name="Persona", slug="persona", type="select", position=0,
        options=[
            {"id": "buyer", "label": "Buyer", "color": "#7c9ce8"},
            {"id": "champion", "label": "Champion", "color": "#8fbf8f"},
            {"id": "investor", "label": "Investor", "color": "#c98bc9"},
            {"id": "community", "label": "Community", "color": "#d9a662"},
            {"id": "design_partner", "label": "Design partner", "color": "#6fbfbf"},
        ],
    )
    source_attr = Attribute(
        object_type="person", name="Source", slug="source", type="select", position=1,
        options=[
            {"id": "inbound", "label": "Inbound", "color": "#8fbf8f"},
            {"id": "outbound", "label": "Outbound", "color": "#7c9ce8"},
            {"id": "referral", "label": "Referral", "color": "#d9a662"},
            {"id": "event", "label": "Event", "color": "#c98bc9"},
        ],
    )
    icp_attr = Attribute(
        object_type="company", name="ICP Tier", slug="icp_tier", type="select", position=0,
        options=[
            {"id": "a", "label": "Tier A", "color": "#4caf7d"},
            {"id": "b", "label": "Tier B", "color": "#d9a662"},
            {"id": "c", "label": "Tier C", "color": "#8b8b94"},
        ],
    )
    champion_attr = Attribute(
        object_type="deal", name="Champion strength", slug="champion_strength", type="rating", position=0,
    )
    db.add_all([persona_attr, source_attr, icp_attr, champion_attr])
    db.flush()

    source_ids = ["inbound", "outbound", "referral", "event"]
    for index, person in enumerate(people):
        db.add(AttributeValue(attribute_id=source_attr.id, record_type="person",
                              record_id=person.id, value=source_ids[index % 4]))
    for index, company in enumerate(companies):
        tier = "a" if index in (0, 2, 4, 6, 10, 14) else ("b" if index % 2 == 0 else "c")
        db.add(AttributeValue(attribute_id=icp_attr.id, record_type="company",
                              record_id=company.id, value=tier))

    # ---- Tags ----
    tag_defs = [("Hot", "#e08e8e"), ("Q3 target", "#7c9ce8"), ("Champion", "#8fbf8f"),
                ("Newsletter", "#d9a662"), ("Investor", "#c98bc9")]
    tags = []
    for name, color in tag_defs:
        tag = Tag(name=name, color=color)
        db.add(tag)
        tags.append(tag)
    db.flush()

    # ---- Sales Pipeline deals ----
    sales_list = db.query(RecordList).filter(RecordList.parent_object == "deal").order_by(RecordList.position).first()
    sales_stages = {s.name: s for s in db.query(Stage).filter(Stage.list_id == sales_list.id).all()}
    stage_order = ["Lead", "Contacted", "Qualified", "Demo", "Proposal", "Negotiation"]

    deals = []
    for deal_index, (name, company_index, value, stage_spec, days_in_flight) in enumerate(SALES_DEALS):
        company = companies[company_index]
        contact = people[company_index % len(people)]
        closed = stage_spec.startswith(("WON:", "LOST:"))
        if closed:
            won = stage_spec.startswith("WON:")
            closed_days_ago = int(stage_spec.split(":")[1])
            stage = sales_stages["Won" if won else "Lost"]
            status = "won" if won else "lost"
        else:
            stage = sales_stages[stage_spec]
            status = "open"
        created = days_ago((closed_days_ago + rng.randint(20, 45)) if closed else max(days_in_flight + rng.randint(5, 20), 7))
        deal = Deal(
            name=name, value=value, currency="USD", company_id=company.id,
            primary_person_id=contact.id, owner=actor, status=status,
            expected_close_date="" if closed else iso_in(rng.randint(7, 60)),
            closed_at=days_ago(closed_days_ago) if closed else None,
            created_at=created,
        )
        db.add(deal)
        deals.append((deal, stage, created, closed))
    db.flush()

    for deal_index, (deal, stage, created, closed) in enumerate(deals):
        db.add(DealPerson(deal_id=deal.id, person_id=deal.primary_person_id))
        entry = ListEntry(
            list_id=sales_list.id, record_type="deal", record_id=deal.id,
            stage_id=stage.id, position=float(deal_index),
            stage_entered_at=days_ago(rng.randint(1, 12)) if not closed else deal.closed_at,
            created_at=created,
        )
        db.add(entry)
        db.add(AttributeValue(attribute_id=champion_attr.id, record_type="deal",
                              record_id=deal.id, value=rng.randint(2, 5)))
        # Backdated stage history for velocity + timeline
        db.add(Activity(record_type="deal", record_id=deal.id, type="created",
                        title=f"{deal.name} created", actor=actor, occurred_at=created))
        target_index = stage_order.index(stage.name) if stage.name in stage_order else len(stage_order)
        walk_time = created
        previous = None
        for step in range(0, min(target_index, len(stage_order)) + (1 if stage.name not in stage_order else 0)):
            if step == 0:
                previous = stage_order[0]
                continue
            walk_time = walk_time + timedelta(days=rng.randint(2, 9))
            if walk_time > NOW():
                walk_time = NOW() - timedelta(days=1)
            to_name = stage_order[step] if step < len(stage_order) else stage.name
            db.add(Activity(
                record_type="deal", record_id=deal.id, type="stage_change",
                title=f"Moved to {to_name}", actor=actor, occurred_at=walk_time,
                extra={"listId": sales_list.id, "from": previous, "to": to_name,
                       "toColor": sales_stages.get(to_name).color if to_name in sales_stages else None},
            ))
            previous = to_name
        if closed:
            db.add(Activity(
                record_type="deal", record_id=deal.id, type="stage_change",
                title=f"Moved to {stage.name}", actor=actor, occurred_at=deal.closed_at,
                extra={"listId": sales_list.id, "from": previous, "to": stage.name, "toColor": stage.color},
            ))
        deal.last_interaction_at = entry.stage_entered_at

    # ---- Fundraising pipeline ----
    fundraising = RecordList(name="Fundraising", parent_object="deal", icon="landmark",
                             color="#c98bc9", description="Investor pipeline", position=1)
    db.add(fundraising)
    db.flush()
    fr_stage_defs = [("Target", "#8b8b94"), ("Intro", "#7c9ce8"), ("Pitch", "#6fbfbf"),
                     ("Diligence", "#d9a662"), ("Term Sheet", "#b5a642"),
                     ("Committed", "#4caf7d"), ("Passed", "#e08e8e")]
    fr_stages = {}
    for index, (stage_name, color) in enumerate(fr_stage_defs):
        stage = Stage(list_id=fundraising.id, name=stage_name, color=color, position=index,
                      is_won=(stage_name == "Committed"), is_lost=(stage_name == "Passed"))
        db.add(stage)
        fr_stages[stage_name] = stage
    db.add(SavedView(list_id=fundraising.id, name="Board", layout="kanban", is_default=True, position=0))
    db.add(SavedView(list_id=fundraising.id, name="All entries", layout="table", position=1))
    db.flush()

    for index, (name, company_index, value, stage_name) in enumerate(FUNDRAISING):
        company = companies[company_index]
        investor_contact = people[company_index % len(people)]
        created = days_ago(rng.randint(15, 60))
        deal = Deal(
            name=name, value=value, currency="USD", company_id=company.id,
            primary_person_id=investor_contact.id, owner=actor,
            status="won" if stage_name == "Committed" else "open",
            closed_at=days_ago(rng.randint(3, 10)) if stage_name == "Committed" else None,
            expected_close_date="" if stage_name == "Committed" else iso_in(rng.randint(14, 45)),
            created_at=created,
        )
        db.add(deal)
        db.flush()
        db.add(DealPerson(deal_id=deal.id, person_id=investor_contact.id))
        db.add(ListEntry(list_id=fundraising.id, record_type="deal", record_id=deal.id,
                         stage_id=fr_stages[stage_name].id, position=float(index),
                         stage_entered_at=days_ago(rng.randint(1, 10)), created_at=created))
        db.add(Activity(record_type="deal", record_id=deal.id, type="created",
                        title=f"{deal.name} created", actor=actor, occurred_at=created))
        db.add(RecordTag(tag_id=tags[4].id, record_type="company", record_id=company.id))

    # ---- Design Partners list (companies) ----
    design = RecordList(name="Design Partners", parent_object="company", icon="pen-tool",
                        color="#6fbfbf", description="Design-partner program", position=2)
    db.add(design)
    db.flush()
    dp_stage_defs = [("Prospect", "#8b8b94"), ("Outreach", "#7c9ce8"), ("Pilot", "#d9a662"), ("Active", "#4caf7d")]
    dp_stages = {}
    for index, (stage_name, color) in enumerate(dp_stage_defs):
        stage = Stage(list_id=design.id, name=stage_name, color=color, position=index,
                      is_won=(stage_name == "Active"))
        db.add(stage)
        dp_stages[stage_name] = stage
    db.add(SavedView(list_id=design.id, name="Board", layout="kanban", is_default=True, position=0))
    db.flush()
    dp_placement = [(0, "Active"), (1, "Pilot"), (3, "Pilot"), (8, "Outreach"),
                    (11, "Outreach"), (19, "Active"), (9, "Prospect"), (12, "Prospect")]
    for index, (company_index, stage_name) in enumerate(dp_placement):
        db.add(ListEntry(list_id=design.id, record_type="company",
                         record_id=companies[company_index].id,
                         stage_id=dp_stages[stage_name].id, position=float(index),
                         stage_entered_at=days_ago(rng.randint(2, 25))))

    # ---- Community list (people) ----
    community = RecordList(name="Community", parent_object="person", icon="users",
                           color="#d9a662", description="Discord & community leads", position=3)
    db.add(community)
    db.flush()
    cm_stage_defs = [("New", "#8b8b94"), ("Engaged", "#7c9ce8"), ("Advocate", "#4caf7d")]
    cm_stages = {}
    for index, (stage_name, color) in enumerate(cm_stage_defs):
        stage = Stage(list_id=community.id, name=stage_name, color=color, position=index,
                      is_won=(stage_name == "Advocate"))
        db.add(stage)
        cm_stages[stage_name] = stage
    db.add(SavedView(list_id=community.id, name="Board", layout="kanban", is_default=True, position=0))
    db.flush()
    community_people = people[40:52]
    for index, person in enumerate(community_people):
        stage_name = ["New", "Engaged", "Engaged", "Advocate"][index % 4]
        db.add(ListEntry(list_id=community.id, record_type="person", record_id=person.id,
                         stage_id=cm_stages[stage_name].id, position=float(index),
                         stage_entered_at=days_ago(rng.randint(2, 30))))
        db.add(AttributeValue(attribute_id=persona_attr.id, record_type="person",
                              record_id=person.id, value="community"))

    # Personas for the rest
    for index, person in enumerate(people[:40]):
        persona = "investor" if 15 <= (index % len(companies)) <= 18 else ("champion" if index % 5 == 0 else "buyer")
        db.add(AttributeValue(attribute_id=persona_attr.id, record_type="person",
                              record_id=person.id, value=persona))

    # ---- Tags on records ----
    for company_index in (0, 2, 4, 14):
        db.add(RecordTag(tag_id=tags[1].id, record_type="company", record_id=companies[company_index].id))
    for deal, stage, _, closed in deals[:6]:
        if not closed:
            db.add(RecordTag(tag_id=tags[0].id, record_type="deal", record_id=deal.id))
    for person in people[:8]:
        db.add(RecordTag(tag_id=tags[3].id, record_type="person", record_id=person.id))

    # ---- Notes ----
    note_targets = [
        ("person", people[0].id), ("person", people[7].id), ("deal", deals[0][0].id),
        ("company", companies[0].id), ("deal", deals[4][0].id),
    ]
    for (record_type, record_id), (_, title, content) in zip(note_targets, NOTES):
        created = days_ago(rng.randint(1, 20))
        note = Note(record_type=record_type, record_id=record_id, title=title,
                    content=content, pinned=(title in ("Champion mapping", "Account plan")),
                    created_by=actor, created_at=created, updated_at=created)
        db.add(note)
        db.add(Activity(record_type=record_type, record_id=record_id, type="note_created",
                        title=title, body=content[:200], actor=actor, occurred_at=created))
    for person, content in zip(community_people[:3], COMMUNITY_NOTES):
        created = days_ago(rng.randint(1, 15))
        db.add(Note(record_type="person", record_id=person.id, title="Community note",
                    content=content, created_by=actor, created_at=created, updated_at=created))
        db.add(Activity(record_type="person", record_id=person.id, type="note_created",
                        title="Community note", body=content, actor=actor, occurred_at=created))

    # ---- Emails logged ----
    for index, person in enumerate(people[:10]):
        when = days_ago(rng.randint(1, 28), hour=9 + index % 8)
        subject = ["Following up on our demo", "Security docs you asked for",
                   "Pricing options", "Great meeting you at AgentConf",
                   "Pilot kickoff next steps"][index % 5]
        db.add(EmailLog(person_id=person.id, record_type="person", record_id=person.id,
                        direction="outbound", to_addr=(person.emails or [""])[0],
                        from_addr="you@yourstartup.ai", subject=subject,
                        body="Thanks for the time today — recap and next steps attached.",
                        status="sent", created_by=actor, sent_at=when))
        db.add(Activity(record_type="person", record_id=person.id, type="email",
                        title=f"Email sent: {subject}", actor=actor, occurred_at=when,
                        extra={"to": (person.emails or [""])[0]}))
        person.last_interaction_at = when

    # Calls / meetings sprinkled on recent people
    for index, person in enumerate(people[10:22]):
        when = days_ago(rng.randint(1, 21), hour=11 + index % 6)
        kind = "call" if index % 2 == 0 else "meeting"
        db.add(Activity(record_type="person", record_id=person.id, type=kind,
                        title="Intro call" if kind == "call" else "Working session",
                        body="Discussed rollout plan and success criteria.",
                        actor=actor, occurred_at=when))
        person.last_interaction_at = when

    # Leave some people stale for the Reconnect block
    for person in people[52:]:
        person.last_interaction_at = days_ago(rng.randint(45, 90))

    # ---- Tasks ----
    for title, due_offset, record_type, target_index in TASKS:
        record_id = None
        rt = record_type
        if record_type == "deal" and target_index is not None:
            record_id = deals[target_index][0].id
        elif record_type == "person":
            record_id = people[rng.randrange(20)].id
        elif record_type == "company" and target_index is not None:
            record_id = companies[target_index % len(companies)].id
        elif record_type == "company":
            record_id = companies[rng.randrange(len(companies))].id
        if record_id is None:
            rt = None
        db.add(Task(title=title, due_date=iso_in(due_offset), record_type=rt,
                    record_id=record_id, created_by=actor,
                    created_at=days_ago(rng.randint(2, 12))))
    # A couple completed tasks
    for title, days_completed in (("Send AgentConf follow-ups", 3), ("Publish changelog #14", 6)):
        db.add(Task(title=title, due_date=iso_in(-days_completed), completed_at=days_ago(days_completed),
                    created_by=actor, created_at=days_ago(days_completed + 4)))

    # ---- Email templates ----
    db.add(EmailTemplate(
        name="Demo follow-up",
        subject="Next steps after our demo, {{first_name}}",
        body="Hi {{first_name}},\n\nThanks for the time today — great to walk through the platform with the {{company}} team.\n\nAs discussed:\n- Security docs are attached\n- Pilot scope: two workflows in 30 days\n- Pricing summary to follow\n\nWould Thursday work for a technical deep-dive?\n\nBest,\n",
    ))
    db.add(EmailTemplate(
        name="Investor update intro",
        subject="{{company}} x our seed round",
        body="Hi {{first_name}},\n\nWe're building agent infrastructure for operations teams — 6 paying customers, $31k MRR, growing 22% m/m.\n\nRaising a $2M seed to scale design partners into contracts. Happy to share the memo if useful.\n\nBest,\n",
    ))

    # ---- Mark seeded ----
    state = db.query(AppState).first()
    if state is None:
        state = AppState(data={})
        db.add(state)
    data = state.data or {}
    data["demoSeeded"] = True
    data["checklistDismissed"] = False
    state.data = dict(data)

    db.commit()
    return {
        "people": len(people),
        "companies": len(companies),
        "deals": db.query(Deal).count(),
        "lists": db.query(RecordList).count(),
        "tasks": db.query(Task).count(),
        "notes": db.query(Note).count(),
        "activities": db.query(Activity).count(),
    }
