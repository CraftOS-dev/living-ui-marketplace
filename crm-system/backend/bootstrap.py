"""
Idempotent defaults: every install gets a Sales Pipeline and default saved
views even before seeding demo data. Called lazily from read endpoints
(lists/views/dashboard) because main.py's lifespan is template-owned.
"""

import logging

from sqlalchemy.orm import Session

from models import RecordList, SavedView, Stage

logger = logging.getLogger(__name__)

DEFAULT_PIPELINE_STAGES = [
    ("Lead", "#7c9ce8", False, False, 10),
    ("Contacted", "#6fbfbf", False, False, 20),
    ("Qualified", "#8fbf8f", False, False, 35),
    ("Demo", "#b5a642", False, False, 50),
    ("Proposal", "#d9a662", False, False, 65),
    ("Negotiation", "#c98bc9", False, False, 80),
    ("Won", "#4caf7d", True, False, 100),
    ("Lost", "#e08e8e", False, True, 0),
]

DEFAULT_OBJECT_VIEWS = {
    "person": [
        ("All people", ["name", "jobTitle", "company", "emails", "location", "lastInteractionAt"]),
    ],
    "company": [
        ("All companies", ["name", "domain", "industry", "size", "location", "annualRevenue"]),
    ],
    "deal": [
        ("All deals", ["name", "value", "status", "company", "owner", "expectedCloseDate"]),
    ],
}


def ensure_defaults(db: Session) -> None:
    changed = False

    # Default saved view per object type
    for object_type, views in DEFAULT_OBJECT_VIEWS.items():
        exists = db.query(SavedView).filter(SavedView.object_type == object_type).first()
        if exists is None:
            for index, (name, columns) in enumerate(views):
                db.add(SavedView(
                    object_type=object_type, name=name, layout="table",
                    visible_columns=columns, is_default=(index == 0), position=index,
                ))
            changed = True

    # Default Sales Pipeline (deal list) with opinionated stages
    has_deal_list = db.query(RecordList).filter(RecordList.parent_object == "deal").first()
    if has_deal_list is None:
        pipeline = RecordList(
            name="Sales Pipeline", parent_object="deal", icon="kanban",
            color="#7c9ce8", description="Default deals pipeline", position=0,
        )
        db.add(pipeline)
        db.flush()
        for index, (name, color, is_won, is_lost, probability) in enumerate(DEFAULT_PIPELINE_STAGES):
            db.add(Stage(
                list_id=pipeline.id, name=name, color=color, position=index,
                is_won=is_won, is_lost=is_lost, probability=probability,
            ))
        db.add(SavedView(list_id=pipeline.id, name="Board", layout="kanban", is_default=True, position=0))
        db.add(SavedView(list_id=pipeline.id, name="All entries", layout="table", position=1))
        changed = True

    if changed:
        db.commit()
        logger.info("[Bootstrap] Default views/pipeline created")
