"""
Built-in newsletter templates. Seeded once on startup if no templates exist
with the corresponding name. Users can clone these and edit freely; the
originals stay marked is_builtin=True so they can be reset.
"""

from typing import List, Dict, Any


BUILTIN_TEMPLATES: List[Dict[str, Any]] = [
    {
        "name": "Welcome new subscriber",
        "subject": "Welcome aboard, {firstName}!",
        "preheader": "Here's what to expect from us.",
        "category": "onboarding",
        "icon": "FiUserPlus",
        "blocks": [
            {"type": "heading", "level": 1, "text": "Welcome, {firstName}!"},
            {"type": "text", "text": "Thanks for joining. We'll send you one thoughtful update a week — nothing more, nothing less."},
            {"type": "text", "text": "If you ever want to step away, the unsubscribe link is always at the bottom of every email."},
            {"type": "button", "label": "Get started", "url": "https://example.com/start"},
            {"type": "text", "text": "Talk soon,\n— The team"},
        ],
    },
    {
        "name": "Weekly newsletter",
        "subject": "Your weekly roundup",
        "preheader": "Three things worth your attention this week.",
        "category": "newsletter",
        "icon": "FiFileText",
        "blocks": [
            {"type": "heading", "level": 1, "text": "This week's roundup"},
            {"type": "text", "text": "Hey {firstName}, here are the three things we think are worth your time this week."},
            {"type": "heading", "level": 2, "text": "1. The first thing"},
            {"type": "text", "text": "A brief paragraph explaining the first thing and why it matters."},
            {"type": "heading", "level": 2, "text": "2. The second thing"},
            {"type": "text", "text": "A brief paragraph explaining the second thing and why it matters."},
            {"type": "heading", "level": 2, "text": "3. The third thing"},
            {"type": "text", "text": "A brief paragraph explaining the third thing and why it matters."},
            {"type": "divider"},
            {"type": "text", "text": "See you next week."},
        ],
    },
    {
        "name": "Product launch",
        "subject": "Introducing something new",
        "preheader": "We've been working on this for months.",
        "category": "launch",
        "icon": "FiZap",
        "blocks": [
            {"type": "heading", "level": 1, "text": "Introducing [Product Name]"},
            {"type": "text", "text": "We've been quietly building something we're really proud of. Today it's ready."},
            {"type": "text", "text": "Here's what it does in one sentence: [one-line description of what it does]."},
            {"type": "button", "label": "See it in action", "url": "https://example.com/launch"},
            {"type": "text", "text": "We can't wait to hear what you think."},
        ],
    },
    {
        "name": "Limited-time promotion",
        "subject": "48 hours only — 25% off everything",
        "preheader": "A small thank-you to our subscribers.",
        "category": "promotion",
        "icon": "FiTag",
        "blocks": [
            {"type": "heading", "level": 1, "text": "25% off — 48 hours only"},
            {"type": "text", "text": "As a thank-you for being a subscriber, here's 25% off anything in our shop for the next two days."},
            {"type": "text", "text": "Use code  SUBSCRIBER25  at checkout. Ends Sunday night."},
            {"type": "button", "label": "Shop the sale", "url": "https://example.com/shop"},
        ],
    },
    {
        "name": "Event invitation",
        "subject": "You're invited",
        "preheader": "We're hosting something and you should come.",
        "category": "event",
        "icon": "FiCalendar",
        "blocks": [
            {"type": "heading", "level": 1, "text": "You're invited"},
            {"type": "text", "text": "We're hosting [event name] on [date] at [location], and we'd love to see you there."},
            {"type": "text", "text": "Expect: [short list of what attendees can expect]."},
            {"type": "button", "label": "RSVP", "url": "https://example.com/rsvp"},
            {"type": "text", "text": "Space is limited — first come, first served."},
        ],
    },
    {
        "name": "Monthly digest",
        "subject": "Your monthly digest",
        "preheader": "Everything you missed this month.",
        "category": "digest",
        "icon": "FiBookOpen",
        "blocks": [
            {"type": "heading", "level": 1, "text": "What happened this month"},
            {"type": "text", "text": "Hey {firstName}, here's a quick recap of everything that happened in the last 30 days."},
            {"type": "heading", "level": 2, "text": "Highlights"},
            {"type": "text", "text": "• [Highlight one]\n• [Highlight two]\n• [Highlight three]"},
            {"type": "divider"},
            {"type": "heading", "level": 2, "text": "What's next"},
            {"type": "text", "text": "A short paragraph about what's coming next month and why it matters."},
        ],
    },
    {
        "name": "Survey / feedback request",
        "subject": "Can I ask you a quick favor?",
        "preheader": "It'll take less than 2 minutes.",
        "category": "feedback",
        "icon": "FiMessageCircle",
        "blocks": [
            {"type": "heading", "level": 1, "text": "Can I ask you a favor, {firstName}?"},
            {"type": "text", "text": "We're trying to make this better, and your honest feedback would mean a lot."},
            {"type": "text", "text": "It's a short survey — 5 questions, under 2 minutes."},
            {"type": "button", "label": "Take the survey", "url": "https://example.com/survey"},
            {"type": "text", "text": "Thanks — really."},
        ],
    },
    {
        "name": "Re-engagement",
        "subject": "We miss you",
        "preheader": "Still want to hear from us?",
        "category": "re-engagement",
        "icon": "FiHeart",
        "blocks": [
            {"type": "heading", "level": 1, "text": "Hey {firstName}, still there?"},
            {"type": "text", "text": "We noticed you haven't opened our last few emails. No hard feelings — inboxes are crowded."},
            {"type": "text", "text": "If you'd still like to hear from us, no need to do anything. If not, here's a one-click way to step away:"},
            {"type": "button", "label": "Unsubscribe", "url": "{unsubscribeUrl}"},
            {"type": "text", "text": "Either way, thanks for being part of this."},
        ],
    },
]


def seed_builtin_templates(db_session) -> int:
    """One-shot seed: only insert built-in templates when the templates table
    is empty.

    Built-ins are now fully editable and deletable by the user. Once they have
    *any* template (built-in or custom), we never auto-seed again — otherwise
    deleted or renamed built-ins would silently reappear and confuse them.

    Returns the number of templates inserted.
    """
    from models import Template

    if db_session.query(Template).first() is not None:
        return 0

    inserted = 0
    for tpl in BUILTIN_TEMPLATES:
        db_session.add(Template(
            name=tpl["name"],
            subject=tpl.get("subject", ""),
            preheader=tpl.get("preheader", ""),
            blocks=tpl.get("blocks", []),
            category=tpl.get("category", "custom"),
            icon=tpl.get("icon", "FiMail"),
            is_builtin=True,
        ))
        inserted += 1
    if inserted:
        db_session.commit()
    return inserted
