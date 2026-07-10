<!--
  HOW TO ENQUEUE A LIVING UI REQUEST
  1. Copy this file to queue/<YYYYMMDD>-<slug>.md  (e.g. queue/20260708-invoice-manager.md)
  2. Fill in the front matter and the three body sections.
  3. Leave status: QUEUED — the pipeline runner owns it from claim onward.
  4. Paste the AUTO kickoff prompt (README.md §5) into a Claude Code session.
-->
---
app_name: ""              # Display name, e.g. "Invoice Manager"
slug: ""                  # kebab-case; becomes the app folder AND catalogue id
tags: []                  # 3–5 marketplace tags, e.g. [finance, invoicing, small-business]
priority: 2               # 1 = high, 2 = normal, 3 = low
status: QUEUED            # leave as QUEUED — runner-owned after claim
requested: YYYY-MM-DD     # today
claimed_by: ""            # runner-owned
run_id: ""                # runner-owned
updated: YYYY-MM-DD       # runner-owned after claim; set = requested for now
review_round: 0           # runner-owned
pr_url: ""                # runner-owned
blocked_reason: ""        # runner-owned
---

## Requirement

<!-- 1–10 plain-English sentences. What the app is, who uses it, the few things
     it absolutely must do. The pipeline researches the rest — don't write a spec. -->

## References

<!-- Optional. Products or URLs you already like ("pipeline view like Pipedrive").
     These are PINNED: they outrank anything the research finds, and become the
     primary design references. Leave empty to let research choose. -->

## Constraints

<!-- Optional but read literally. Auth/multi-user needs, integrations to use
     (only listed ones are allowed), explicit non-goals ("no email sending"). -->
