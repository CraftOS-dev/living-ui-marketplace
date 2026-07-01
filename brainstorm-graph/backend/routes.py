"""
Brainstorm Graph API Routes
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List, Optional, Literal
from database import get_db
from models import AppState, UISnapshot, UIScreenshot, BrainstormSession, BrainstormNode
from datetime import datetime
import logging
import json
import re

logger = logging.getLogger(__name__)
router = APIRouter()

# AI actions require CraftBot's LLM bridge. No hardcoded/fake fallbacks:
# if the bridge isn't connected we surface a 503 so the user connects CraftBot.
BRIDGE_OFFLINE = "CraftBot is not connected. Connect CraftBot to generate AI content."


def _require_bridge() -> None:
    from services.integration_client import integration
    if not integration.available:
        raise HTTPException(status_code=503, detail=BRIDGE_OFFLINE)

CANVAS_CENTER_X = 1500.0
CANVAS_CENTER_Y = 400.0
CHILD_Y_OFFSET = 220.0
CHILD_X_SPACING = 280.0
CARD_W = 240.0   # card width + horizontal padding for collision
CARD_H = 140.0   # card height + vertical padding for collision


# ============================================================================
# Pydantic Schemas
# ============================================================================

class StateUpdate(BaseModel):
    data: Dict[str, Any]


class ActionRequest(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None


class UISnapshotUpdate(BaseModel):
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None


class UIScreenshotUpdate(BaseModel):
    imageData: str
    width: Optional[int] = None
    height: Optional[int] = None


class SessionCreate(BaseModel):
    title: str
    topic: str


class SessionUpdate(BaseModel):
    title: str


class NodeCreate(BaseModel):
    sessionId: int
    parentId: Optional[int] = None
    content: str
    nodeType: Literal["question", "answer", "idea"] = "question"


class NodeUpdate(BaseModel):
    content: Optional[str] = None
    nodeType: Optional[Literal["question", "answer", "idea"]] = None
    x: Optional[float] = None
    y: Optional[float] = None


# ============================================================================
# Helpers
# ============================================================================

def _collides(x: float, y: float, existing: List[tuple]) -> bool:
    for ex, ey in existing:
        if abs(x - ex) < CARD_W and abs(y - ey) < CARD_H:
            return True
    return False


def _child_positions(
    parent_x: float,
    parent_y: float,
    existing_count: int,
    new_count: int,
    all_positions: List[tuple] = None,
) -> List[tuple]:
    """
    Return (x, y) for new_count new children.
    Spreads them horizontally below the parent, accounting for existing siblings.
    If all_positions is given, bumps down any position that collides with an existing node.
    """
    total = existing_count + new_count
    y_base = parent_y + CHILD_Y_OFFSET
    results = []
    used = list(all_positions) if all_positions else []

    for i in range(new_count):
        idx = existing_count + i
        offset = (idx - (total - 1) / 2) * CHILD_X_SPACING
        x = parent_x + offset
        y = y_base

        # Push down until no collision
        attempts = 0
        while _collides(x, y, used) and attempts < 8:
            y += CHILD_Y_OFFSET
            attempts += 1

        results.append((x, y))
        used.append((x, y))

    return results


def _delete_subtree(db: Session, node_id: int) -> None:
    children = db.query(BrainstormNode).filter(BrainstormNode.parent_id == node_id).all()
    for child in children:
        _delete_subtree(db, child.id)
    node = db.query(BrainstormNode).filter(BrainstormNode.id == node_id).first()
    if node:
        db.delete(node)


def _node_path(node: BrainstormNode, db: Session) -> str:
    """Build 'Root → Parent → Node' breadcrumb for richer LLM context."""
    path = []
    current = node
    while current:
        path.append(current.content[:60])
        if current.parent_id:
            current = db.query(BrainstormNode).filter(BrainstormNode.id == current.parent_id).first()
        else:
            break
    return " → ".join(reversed(path))


# ============================================================================
# AI helpers
# ============================================================================

async def _run_expand(node: BrainstormNode, session: BrainstormSession, db: Session) -> List[Dict[str, Any]]:
    from services.integration_client import integration

    _require_bridge()

    all_nodes = db.query(BrainstormNode).filter(BrainstormNode.session_id == node.session_id).all()
    existing_text = "\n".join(
        f"  [{n.node_type}] {n.content}" for n in all_nodes if n.id != node.id
    )
    path = _node_path(node, db)

    prompt = (
        f"Brainstorming session topic: \"{session.topic}\"\n\n"
        f"Current node path in the graph:\n  {path}\n\n"
        f"Node to expand ({node.node_type}): \"{node.content}\"\n\n"
        f"Already in the graph (do NOT repeat any of these):\n{existing_text}\n\n"
        f"Generate exactly 3 insightful, specific questions that:\n"
        f"1. Drill deeper into \"{node.content}\" from DIFFERENT angles "
        f"(e.g. mechanisms, evidence, implications, trade-offs, real-world examples)\n"
        f"2. Are concrete enough to have definitive answers, not vague philosophical questions\n"
        f"3. Would be genuinely valuable for someone trying to deeply understand {session.topic}\n"
        f"4. Are NOT variations of questions already in the graph above\n\n"
        f"Return ONLY a JSON array of 3 question strings. No markdown, no explanation.\n"
        f"Example format: [\"How does X specifically cause Y?\", \"What evidence supports Z?\", \"Why do experts disagree on W?\"]"
    )
    system = (
        "You are an expert brainstorming facilitator and research strategist. "
        "Your questions are specific, actionable, and drive deeper understanding. "
        "Return ONLY a valid JSON array of exactly 3 question strings."
    )
    try:
        raw = await integration.llm_complete(prompt, system)
        cleaned = re.sub(r"```(?:json)?|```", "", raw or "").strip()
        questions = json.loads(cleaned)
        if not isinstance(questions, list):
            questions = []
        questions = [str(q).strip() for q in questions[:3] if str(q).strip()]
    except Exception as e:
        logger.warning("[expand] LLM failed: %s", e)
        questions = []

    if not questions:
        raise HTTPException(status_code=502, detail="AI returned no questions. Try again.")

    all_positions = [(n.x, n.y) for n in all_nodes]
    existing_count = sum(1 for n in all_nodes if n.parent_id == node.id)
    positions = _child_positions(node.x, node.y, existing_count, len(questions), all_positions)

    new_nodes = []
    for q, (cx, cy) in zip(questions, positions):
        child = BrainstormNode(
            session_id=node.session_id,
            parent_id=node.id,
            content=q,
            node_type="question",
            created_by="agent",
            x=cx,
            y=cy,
            depth=node.depth + 1,
        )
        db.add(child)
        new_nodes.append(child)

    db.commit()
    for n in new_nodes:
        db.refresh(n)
    return [n.to_dict() for n in new_nodes]


async def _run_answer(node: BrainstormNode, session: BrainstormSession, db: Session) -> Optional[Dict[str, Any]]:
    from services.integration_client import integration

    _require_bridge()

    path = _node_path(node, db)

    prompt = (
        f"Brainstorming session topic: \"{session.topic}\"\n\n"
        f"Question context (path through graph):\n  {path}\n\n"
        f"Question to answer: \"{node.content}\"\n\n"
        f"Provide a thorough, insightful answer that:\n"
        f"1. Directly answers the question with concrete, specific information\n"
        f"2. Includes at least one real-world example, case study, or empirical finding\n"
        f"3. Notes any important nuances, caveats, or areas of ongoing debate\n"
        f"4. Is 3-5 sentences — substantive but scannable\n\n"
        f"Return ONLY the answer text. No quotes, no preamble, no 'Answer:' prefix."
    )
    system = (
        "You are a world-class research analyst and domain expert. "
        "Your answers are precise, evidence-based, and immediately useful. "
        "Write in clear, direct prose. No hedging, no filler."
    )
    try:
        answer_text = await integration.llm_complete(prompt, system)
        answer_text = (answer_text or "").strip()
    except Exception as e:
        logger.warning("[answer] LLM failed: %s", e)
        answer_text = None

    if not answer_text:
        raise HTTPException(status_code=502, detail="AI returned no answer. Try again.")

    all_nodes = db.query(BrainstormNode).filter(BrainstormNode.session_id == node.session_id).all()
    all_positions = [(n.x, n.y) for n in all_nodes]
    existing_count = sum(1 for n in all_nodes if n.parent_id == node.id)
    positions = _child_positions(node.x, node.y, existing_count, 1, all_positions)
    cx, cy = positions[0]

    child = BrainstormNode(
        session_id=node.session_id,
        parent_id=node.id,
        content=answer_text,
        node_type="answer",
        created_by="agent",
        x=cx,
        y=cy,
        depth=node.depth + 1,
    )
    db.add(child)
    db.commit()
    db.refresh(child)
    return child.to_dict()


async def _run_explore(session: BrainstormSession, db: Session) -> Dict[str, Any]:
    from services.integration_client import integration

    _require_bridge()

    all_nodes = db.query(BrainstormNode).filter(BrainstormNode.session_id == session.id).all()
    if not all_nodes:
        return {"action": "none", "message": "No nodes in session"}

    node_ids_with_children = {n.parent_id for n in all_nodes if n.parent_id is not None}
    leaf_nodes = [n for n in all_nodes if n.id not in node_ids_with_children]
    unanswered_questions = [n for n in leaf_nodes if n.node_type == "question"]

    if integration.available:
        node_summary = "\n".join(
            f"  id={n.id} depth={n.depth} type={n.node_type} "
            f"is_leaf={'yes' if n.id not in node_ids_with_children else 'no'} | {n.content[:100]}"
            for n in all_nodes
        )
        prompt = (
            f"Brainstorming session topic: \"{session.topic}\"\n\n"
            f"Current graph state:\n{node_summary}\n\n"
            f"As the brainstorming strategist, choose the single most valuable next action:\n"
            f"- 'expand': generate 3 sub-questions from a node (best for broad unexplored ideas)\n"
            f"- 'answer': provide a direct answer to a question node (best for pivotal unanswered questions)\n\n"
            f"Prioritize:\n"
            f"1. Unanswered questions on unexplored branches (is_leaf=yes, type=question)\n"
            f"2. Nodes that seem most central to understanding the topic\n"
            f"3. Balance between depth (go deeper on promising threads) and breadth (start new branches)\n\n"
            f"Return ONLY JSON: {{\"nodeId\": <id>, \"action\": \"expand\" or \"answer\", "
            f"\"reason\": \"one sentence explaining why this is the most valuable next step\"}}"
        )
        system = (
            "You are an expert research strategist driving agentic brainstorming. "
            "Pick the action that will generate the most insight. Return ONLY valid JSON."
        )
        try:
            raw = await integration.llm_complete(prompt, system)
            cleaned = re.sub(r"```(?:json)?|```", "", raw or "").strip()
            decision = json.loads(cleaned)
            chosen_id = int(decision.get("nodeId", 0))
            chosen_action = decision.get("action", "expand")
            reason = decision.get("reason", "")
        except Exception as e:
            logger.warning("[explore] LLM pick failed: %s — falling back", e)
            target_node = unanswered_questions[0] if unanswered_questions else (leaf_nodes[0] if leaf_nodes else all_nodes[0])
            chosen_id = target_node.id
            chosen_action = "answer" if target_node.node_type == "question" else "expand"
            reason = "Fallback: targeting most accessible unexplored node"

    target = db.query(BrainstormNode).filter(BrainstormNode.id == chosen_id).first()
    if not target:
        target = unanswered_questions[0] if unanswered_questions else (leaf_nodes[0] if leaf_nodes else all_nodes[0])

    if chosen_action == "answer" and target.node_type == "question":
        result_node = await _run_answer(target, session, db)
        return {"action": "answer", "targetNodeId": target.id, "reason": reason, "node": result_node}
    else:
        new_nodes = await _run_expand(target, session, db)
        return {"action": "expand", "targetNodeId": target.id, "reason": reason, "newNodes": new_nodes}


async def _run_summary(session: BrainstormSession, db: Session) -> Dict[str, Any]:
    from services.integration_client import integration

    all_nodes = db.query(BrainstormNode).filter(BrainstormNode.session_id == session.id).order_by(BrainstormNode.depth).all()
    if not all_nodes:
        return {"summary": "No ideas explored yet.", "themes": [], "insights": []}

    _require_bridge()

    node_list = "\n".join(
        f"  {'  ' * n.depth}[{n.node_type}] {n.content}"
        for n in all_nodes
    )

    prompt = (
        f"Brainstorming session topic: \"{session.topic}\"\n\n"
        f"Full graph of explored ideas (indented by depth):\n{node_list}\n\n"
        f"Synthesize the brainstorming session into:\n"
        f"1. summary: 2-3 paragraphs covering what was explored, key connections, and the overall intellectual terrain\n"
        f"2. themes: 3-5 major recurring themes or patterns you observe\n"
        f"3. insights: 2-3 surprising, non-obvious insights or connections that emerge from this exploration\n\n"
        f"Return ONLY JSON:\n"
        f"{{\"summary\": \"paragraph text...\", \"themes\": [\"theme1\", ...], \"insights\": [\"insight1\", ...]}}"
    )
    system = (
        "You are a synthesis expert who finds patterns and meaning in exploratory thinking. "
        "Your summaries reveal structure that wasn't obvious, highlight unexpected connections, "
        "and leave the reader with a clearer mental model. Return ONLY valid JSON."
    )
    try:
        raw = await integration.llm_complete(prompt, system)
        cleaned = re.sub(r"```(?:json)?|```", "", raw or "").strip()
        result = json.loads(cleaned)
    except Exception as e:
        logger.warning("[summary] LLM failed: %s", e)
        raise HTTPException(status_code=502, detail="AI returned no summary. Try again.")

    return {
        "summary": result.get("summary", ""),
        "themes": result.get("themes", []),
        "insights": result.get("insights", []),
    }


# ============================================================================
# Template State Routes
# ============================================================================

@router.get("/state")
def get_state(db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
        db.commit()
        db.refresh(state)
    return state.data or {}


@router.put("/state")
def update_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.update_data(update.data)
    db.commit()
    db.refresh(state)
    return state.data or {}


@router.post("/state/replace")
def replace_state(update: StateUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    state = db.query(AppState).first()
    if not state:
        state = AppState(data=update.data)
        db.add(state)
    else:
        state.data = update.data
    db.commit()
    db.refresh(state)
    return state.data or {}


@router.delete("/state")
def clear_state(db: Session = Depends(get_db)) -> Dict[str, str]:
    state = db.query(AppState).first()
    if state:
        state.data = {}
        db.commit()
    return {"status": "cleared"}


@router.post("/action")
async def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    action = request.action
    payload = request.payload or {}
    logger.info("[action] %s", action)

    if action == "expand_node":
        node_id = payload.get("node_id") or payload.get("nodeId")
        if not node_id:
            return {"status": "error", "message": "node_id required"}
        node = db.query(BrainstormNode).filter(BrainstormNode.id == int(node_id)).first()
        if not node:
            return {"status": "not_found"}
        session = db.query(BrainstormSession).filter(BrainstormSession.id == node.session_id).first()
        new_nodes = await _run_expand(node, session, db)
        return {"status": "ok", "action": "expand_node", "newNodes": new_nodes}

    if action == "answer_node":
        node_id = payload.get("node_id") or payload.get("nodeId")
        if not node_id:
            return {"status": "error", "message": "node_id required"}
        node = db.query(BrainstormNode).filter(BrainstormNode.id == int(node_id)).first()
        if not node:
            return {"status": "not_found"}
        session = db.query(BrainstormSession).filter(BrainstormSession.id == node.session_id).first()
        answer = await _run_answer(node, session, db)
        return {"status": "ok", "action": "answer_node", "node": answer}

    if action == "explore":
        session_id = payload.get("session_id") or payload.get("sessionId")
        if not session_id:
            return {"status": "error", "message": "session_id required"}
        session = db.query(BrainstormSession).filter(BrainstormSession.id == int(session_id)).first()
        if not session:
            return {"status": "not_found"}
        result = await _run_explore(session, db)
        return {"status": "ok", "action": "explore", **result}

    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
    if action == "reset":
        state.data = {}
        db.commit()
        return {"status": "reset", "data": {}}
    logger.warning("[action] unknown: %s", action)
    return {"status": "unknown_action", "action": action}


@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {"htmlStructure": None, "visibleText": [], "inputValues": {}, "componentState": {}, "currentView": None, "viewport": {}, "timestamp": None, "status": "no_snapshot"}
    return snapshot.to_dict()


@router.post("/ui-snapshot")
def update_ui_snapshot(data: UISnapshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)
    if data.htmlStructure is not None:
        snapshot.html_structure = data.htmlStructure
    if data.visibleText is not None:
        snapshot.visible_text = data.visibleText
    if data.inputValues is not None:
        snapshot.input_values = data.inputValues
    if data.componentState is not None:
        snapshot.component_state = data.componentState
    if data.currentView is not None:
        snapshot.current_view = data.currentView
    if data.viewport is not None:
        snapshot.viewport = data.viewport
    snapshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(snapshot)
    return snapshot.to_dict()


@router.get("/ui-screenshot")
def get_ui_screenshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot or not screenshot.image_data:
        return {"imageData": None, "width": None, "height": None, "timestamp": None, "status": "no_screenshot"}
    return screenshot.to_dict()


@router.post("/ui-screenshot")
def update_ui_screenshot(data: UIScreenshotUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        screenshot = UIScreenshot()
        db.add(screenshot)
    screenshot.image_data = data.imageData
    screenshot.width = data.width
    screenshot.height = data.height
    screenshot.timestamp = datetime.utcnow()
    db.commit()
    db.refresh(screenshot)
    return {"status": "updated", "timestamp": screenshot.timestamp.isoformat()}


# ============================================================================
# Sessions
# ============================================================================

@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    sessions = db.query(BrainstormSession).order_by(BrainstormSession.updated_at.desc()).all()
    return [s.to_dict() for s in sessions]


@router.post("/sessions")
def create_session(data: SessionCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    session = BrainstormSession(title=data.title, topic=data.topic)
    db.add(session)
    db.commit()
    db.refresh(session)
    root = BrainstormNode(
        session_id=session.id,
        parent_id=None,
        content=data.topic,
        node_type="idea",
        created_by="user",
        x=CANVAS_CENTER_X,
        y=CANVAS_CENTER_Y,
        depth=0,
    )
    db.add(root)
    db.commit()
    db.refresh(root)
    logger.info("[sessions] Created %s with root node %s", session.id, root.id)
    return {"session": session.to_dict(), "rootNode": root.to_dict()}


@router.put("/sessions/{session_id}")
def update_session(session_id: int, data: SessionUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    session = db.query(BrainstormSession).filter(BrainstormSession.id == session_id).first()
    if not session:
        return {"status": "not_found"}
    session.title = data.title
    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    return session.to_dict()


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    session = db.query(BrainstormSession).filter(BrainstormSession.id == session_id).first()
    if not session:
        return {"status": "not_found"}
    db.query(BrainstormNode).filter(BrainstormNode.session_id == session_id).delete()
    db.delete(session)
    db.commit()
    logger.info("[sessions] Deleted session %s", session_id)
    return {"status": "deleted"}


@router.get("/sessions/{session_id}/nodes")
def get_session_nodes(session_id: int, db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    nodes = (
        db.query(BrainstormNode)
        .filter(BrainstormNode.session_id == session_id)
        .order_by(BrainstormNode.id)
        .all()
    )
    return [n.to_dict() for n in nodes]


@router.get("/sessions/{session_id}/summary")
async def get_session_summary(session_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    session = db.query(BrainstormSession).filter(BrainstormSession.id == session_id).first()
    if not session:
        return {"status": "not_found"}
    result = await _run_summary(session, db)
    return {"status": "ok", "sessionId": session_id, **result}


# ============================================================================
# Nodes
# ============================================================================

@router.post("/nodes")
def create_node(data: NodeCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    x, y, depth = CANVAS_CENTER_X, CANVAS_CENTER_Y, 0
    if data.parentId:
        parent = db.query(BrainstormNode).filter(BrainstormNode.id == data.parentId).first()
        if parent:
            all_nodes = db.query(BrainstormNode).filter(BrainstormNode.session_id == data.sessionId).all()
            all_positions = [(n.x, n.y) for n in all_nodes]
            existing_count = sum(1 for n in all_nodes if n.parent_id == parent.id)
            positions = _child_positions(parent.x, parent.y, existing_count, 1, all_positions)
            x, y = positions[0]
            depth = parent.depth + 1
    node = BrainstormNode(
        session_id=data.sessionId,
        parent_id=data.parentId,
        content=data.content,
        node_type=data.nodeType,
        created_by="user",
        x=x,
        y=y,
        depth=depth,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node.to_dict()


@router.put("/nodes/{node_id}")
def update_node(node_id: int, data: NodeUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    node = db.query(BrainstormNode).filter(BrainstormNode.id == node_id).first()
    if not node:
        return {"status": "not_found"}
    if data.content is not None:
        node.content = data.content
    if data.nodeType is not None:
        node.node_type = data.nodeType
    if data.x is not None:
        node.x = data.x
    if data.y is not None:
        node.y = data.y
    node.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(node)
    return node.to_dict()


@router.delete("/nodes/{node_id}")
def delete_node(node_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    node = db.query(BrainstormNode).filter(BrainstormNode.id == node_id).first()
    if not node:
        return {"status": "not_found"}
    _delete_subtree(db, node_id)
    db.commit()
    logger.info("[nodes] Deleted node %s and subtree", node_id)
    return {"status": "deleted"}


# ============================================================================
# Agent Routes
# ============================================================================

@router.post("/nodes/{node_id}/expand")
async def expand_node(node_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    node = db.query(BrainstormNode).filter(BrainstormNode.id == node_id).first()
    if not node:
        return {"status": "not_found"}
    session = db.query(BrainstormSession).filter(BrainstormSession.id == node.session_id).first()
    if not session:
        return {"status": "not_found"}
    new_nodes = await _run_expand(node, session, db)
    logger.info("[expand] Node %s → %d children", node_id, len(new_nodes))
    return {"status": "ok", "nodeId": node_id, "newNodes": new_nodes}


@router.post("/nodes/{node_id}/answer")
async def answer_node(node_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    node = db.query(BrainstormNode).filter(BrainstormNode.id == node_id).first()
    if not node:
        return {"status": "not_found"}
    if node.node_type != "question":
        return {"status": "error", "message": "Only question nodes can be answered"}
    session = db.query(BrainstormSession).filter(BrainstormSession.id == node.session_id).first()
    if not session:
        return {"status": "not_found"}
    answer = await _run_answer(node, session, db)
    logger.info("[answer] Node %s answered", node_id)
    return {"status": "ok", "nodeId": node_id, "node": answer}


@router.post("/sessions/{session_id}/explore")
async def explore_session(session_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    session = db.query(BrainstormSession).filter(BrainstormSession.id == session_id).first()
    if not session:
        return {"status": "not_found"}
    result = await _run_explore(session, db)
    return {"status": "ok", **result}
