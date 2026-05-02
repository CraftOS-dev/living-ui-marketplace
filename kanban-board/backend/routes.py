"""
Kanban Board API Routes

REST API endpoints for boards, lists, cards, labels, checklists,
search, statistics, plus framework state/observation routes.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
from typing import Dict, Any, List, Optional, Union
from database import get_db
from models import (
    AppState, UISnapshot, UIScreenshot,
    Board, BoardList, Card, Label, ChecklistItem, card_labels,
)
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


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

class BoardCreate(BaseModel):
    name: str

class BoardUpdate(BaseModel):
    name: Optional[str] = None

class ListCreate(BaseModel):
    board_id: int
    title: str
    position: Optional[int] = None

class ListUpdate(BaseModel):
    title: Optional[str] = None
    position: Optional[Union[int, str]] = None

class CardCreate(BaseModel):
    list_id: int
    title: str
    description: Optional[str] = None
    priority: Optional[str] = "none"
    due_date: Optional[str] = None

class CardUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    archived: Optional[Union[bool, str]] = None

class CardMove(BaseModel):
    list_id: int
    position: int

class LabelCreate(BaseModel):
    board_id: int
    name: str
    color: str

class LabelUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None

class ChecklistItemCreate(BaseModel):
    card_id: int
    text: str

class ChecklistItemUpdate(BaseModel):
    text: Optional[str] = None
    completed: Optional[Union[bool, str]] = None
    position: Optional[Union[int, str]] = None


# ============================================================================
# State Management Routes (Framework)
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
def execute_action(request: ActionRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    action = request.action
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
    current_data = state.data or {}
    if action == "reset":
        state.data = {}
        db.commit()
        return {"status": "reset", "data": {}}
    return {"status": "unknown_action", "action": action, "data": current_data}


# ============================================================================
# Board Routes
# ============================================================================

@router.get("/boards")
def list_boards(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    boards = db.query(Board).order_by(Board.created_at).all()
    return [b.to_dict() for b in boards]

@router.post("/boards")
def create_board(data: BoardCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    board = Board(name=data.name)
    db.add(board)
    db.flush()
    # Create default lists
    for i, title in enumerate(["To Do", "In Progress", "Done"]):
        db.add(BoardList(board_id=board.id, title=title, position=i))
    db.commit()
    db.refresh(board)
    return board.to_dict(include_lists=True, include_labels=True)

@router.get("/boards/{board_id}")
def get_board(board_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    board = db.query(Board).options(
        joinedload(Board.lists).joinedload(BoardList.cards).joinedload(Card.labels),
        joinedload(Board.lists).joinedload(BoardList.cards).joinedload(Card.checklist_items),
        joinedload(Board.labels),
    ).filter(Board.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return board.to_dict(include_lists=True, include_labels=True)

@router.put("/boards/{board_id}")
def update_board(board_id: int, data: BoardUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    board = db.query(Board).filter(Board.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if data.name is not None:
        board.name = data.name
    db.commit()
    db.refresh(board)
    return board.to_dict()

@router.delete("/boards/{board_id}")
def delete_board(board_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    board = db.query(Board).filter(Board.id == board_id).first()
    if board:
        db.delete(board)
        db.commit()
    return {"status": "deleted", "id": str(board_id)}


# ============================================================================
# List Routes
# ============================================================================

@router.post("/lists")
def create_list(data: ListCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    board = db.query(Board).filter(Board.id == data.board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if data.position is not None:
        pos = data.position
    else:
        max_pos = db.query(BoardList).filter(BoardList.board_id == data.board_id).count()
        pos = max_pos
    lst = BoardList(board_id=data.board_id, title=data.title, position=pos)
    db.add(lst)
    db.commit()
    db.refresh(lst)
    return lst.to_dict()

@router.put("/lists/{list_id}")
def update_list(list_id: int, data: ListUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    lst = db.query(BoardList).filter(BoardList.id == list_id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if data.title is not None:
        lst.title = data.title
    if data.position is not None:
        try:
            pos = int(data.position)
            siblings = db.query(BoardList).filter(
                BoardList.board_id == lst.board_id, BoardList.id != lst.id
            ).order_by(BoardList.position).all()
            ordered = list(siblings)
            ordered.insert(min(pos, len(ordered)), lst)
            for i, item in enumerate(ordered):
                item.position = i
        except (ValueError, TypeError):
            pass
    db.commit()
    db.refresh(lst)
    return lst.to_dict()

@router.delete("/lists/{list_id}")
def delete_list(list_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    lst = db.query(BoardList).filter(BoardList.id == list_id).first()
    if lst:
        db.delete(lst)
        db.commit()
    return {"status": "deleted", "id": str(list_id)}


# ============================================================================
# Card Routes
# ============================================================================

@router.post("/cards")
def create_card(data: CardCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    lst = db.query(BoardList).filter(BoardList.id == data.list_id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    max_pos = db.query(Card).filter(Card.list_id == data.list_id).count()
    due = None
    if data.due_date:
        try:
            due = datetime.fromisoformat(data.due_date.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid due_date format")
    card = Card(
        list_id=data.list_id,
        title=data.title,
        description=data.description,
        priority=data.priority or "none",
        due_date=due,
        position=max_pos,
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return card.to_dict()

@router.get("/cards/{card_id}")
def get_card(card_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    card = db.query(Card).options(
        joinedload(Card.labels),
        joinedload(Card.checklist_items),
    ).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card.to_dict()

@router.put("/cards/{card_id}")
def update_card(card_id: int, data: CardUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    card = db.query(Card).options(
        joinedload(Card.labels),
        joinedload(Card.checklist_items),
    ).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if data.title is not None:
        card.title = data.title
    if data.description is not None:
        card.description = data.description
    if data.priority is not None:
        card.priority = data.priority
    if data.due_date is not None:
        if data.due_date == "":
            card.due_date = None
        else:
            try:
                card.due_date = datetime.fromisoformat(data.due_date.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass  # Ignore invalid date formats gracefully
    if data.archived is not None:
        card.archived = data.archived if isinstance(data.archived, bool) else str(data.archived).lower() in ('true', '1')
    card.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(card)
    return card.to_dict()

@router.delete("/cards/{card_id}")
def delete_card(card_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    card = db.query(Card).filter(Card.id == card_id).first()
    if card:
        db.delete(card)
        db.commit()
    return {"status": "deleted", "id": str(card_id)}

@router.put("/cards/{card_id}/move")
def move_card(card_id: int, data: CardMove, db: Session = Depends(get_db)) -> Dict[str, Any]:
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    target_list = db.query(BoardList).filter(BoardList.id == data.list_id).first()
    if not target_list:
        raise HTTPException(status_code=404, detail="Target list not found")

    old_list_id = card.list_id
    card.list_id = data.list_id

    # Rebalance target list
    target_cards = db.query(Card).filter(
        Card.list_id == data.list_id, Card.id != card.id
    ).order_by(Card.position).all()
    target_cards.insert(min(data.position, len(target_cards)), card)
    for i, c in enumerate(target_cards):
        c.position = i

    # Rebalance old list if different
    if old_list_id != data.list_id:
        old_cards = db.query(Card).filter(
            Card.list_id == old_list_id
        ).order_by(Card.position).all()
        for i, c in enumerate(old_cards):
            c.position = i

    db.commit()
    db.refresh(card)
    return card.to_dict()


# ============================================================================
# Label Routes
# ============================================================================

@router.post("/labels")
def create_label(data: LabelCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    board = db.query(Board).filter(Board.id == data.board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    label = Label(board_id=data.board_id, name=data.name, color=data.color)
    db.add(label)
    db.commit()
    db.refresh(label)
    return label.to_dict()

@router.put("/labels/{label_id}")
def update_label(label_id: int, data: LabelUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if data.name is not None:
        label.name = data.name
    if data.color is not None:
        label.color = data.color
    db.commit()
    db.refresh(label)
    return label.to_dict()

@router.delete("/labels/{label_id}")
def delete_label(label_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    label = db.query(Label).filter(Label.id == label_id).first()
    if label:
        db.delete(label)
        db.commit()
    return {"status": "deleted", "id": str(label_id)}

@router.put("/cards/{card_id}/labels/{label_id}")
def assign_label(card_id: int, label_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    card = db.query(Card).options(joinedload(Card.labels)).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label not in card.labels:
        card.labels.append(label)
        db.commit()
    return {"status": "assigned", "cardId": card_id, "labelId": label_id}

@router.delete("/cards/{card_id}/labels/{label_id}")
def remove_label(card_id: int, label_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    card = db.query(Card).options(joinedload(Card.labels)).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label in card.labels:
        card.labels.remove(label)
        db.commit()
    return {"status": "removed", "cardId": card_id, "labelId": label_id}


# ============================================================================
# Checklist Routes
# ============================================================================

@router.post("/checklist")
def create_checklist_item(data: ChecklistItemCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    card = db.query(Card).filter(Card.id == data.card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    max_pos = db.query(ChecklistItem).filter(ChecklistItem.card_id == data.card_id).count()
    item = ChecklistItem(card_id=data.card_id, text=data.text, position=max_pos)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item.to_dict()

@router.put("/checklist/{item_id}")
def update_checklist_item(item_id: int, data: ChecklistItemUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    item = db.query(ChecklistItem).filter(ChecklistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    if data.text is not None:
        item.text = data.text
    if data.completed is not None:
        item.completed = data.completed if isinstance(data.completed, bool) else str(data.completed).lower() in ('true', '1')
    if data.position is not None:
        try:
            pos = int(data.position)
            siblings = db.query(ChecklistItem).filter(
                ChecklistItem.card_id == item.card_id, ChecklistItem.id != item.id
            ).order_by(ChecklistItem.position).all()
            siblings.insert(min(pos, len(siblings)), item)
            for i, s in enumerate(siblings):
                s.position = i
        except (ValueError, TypeError):
            pass
    db.commit()
    db.refresh(item)
    return item.to_dict()

@router.delete("/checklist/{item_id}")
def delete_checklist_item(item_id: int, db: Session = Depends(get_db)) -> Dict[str, str]:
    item = db.query(ChecklistItem).filter(ChecklistItem.id == item_id).first()
    if item:
        db.delete(item)
        db.commit()
    return {"status": "deleted", "id": str(item_id)}


# ============================================================================
# Search & Stats Routes
# ============================================================================

class SearchRequest(BaseModel):
    board_id: Optional[Union[int, str]] = None
    q: Optional[str] = None
    priority: Optional[str] = None
    label_id: Optional[Union[int, str]] = None
    due_status: Optional[str] = None

@router.post("/search")
def search_cards(
    data: SearchRequest,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    try:
        board_id = int(data.board_id) if data.board_id else None
    except (ValueError, TypeError):
        return []
    if not board_id:
        return []
    board = db.query(Board).filter(Board.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    list_ids = [lst.id for lst in db.query(BoardList).filter(BoardList.board_id == board_id).all()]
    query = db.query(Card).options(
        joinedload(Card.labels),
        joinedload(Card.checklist_items),
    ).filter(Card.list_id.in_(list_ids), Card.archived == False)

    q = data.q
    priority = data.priority
    try:
        label_id = int(data.label_id) if data.label_id else None
    except (ValueError, TypeError):
        label_id = None
    due_status = data.due_status

    if q:
        search_term = f"%{q}%"
        query = query.filter(
            (Card.title.ilike(search_term)) | (Card.description.ilike(search_term))
        )
    if priority:
        query = query.filter(Card.priority == priority)
    if label_id:
        query = query.filter(Card.labels.any(Label.id == label_id))
    if due_status:
        now = datetime.utcnow()
        if due_status == "overdue":
            query = query.filter(Card.due_date < now, Card.due_date.isnot(None))
        elif due_status == "upcoming":
            upcoming_cutoff = now + timedelta(days=7)
            query = query.filter(Card.due_date >= now, Card.due_date <= upcoming_cutoff)
        elif due_status == "no_date":
            query = query.filter(Card.due_date.is_(None))

    cards = query.order_by(Card.position).all()
    return [c.to_dict() for c in cards]

class StatsRequest(BaseModel):
    board_id: Optional[Union[int, str]] = None

@router.post("/stats")
def board_stats(data: StatsRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    try:
        board_id = int(data.board_id) if data.board_id else None
    except (ValueError, TypeError):
        return {"totalCards": 0, "cardsByList": [], "cardsByPriority": {}, "overdueCount": 0, "completedChecklistItems": 0, "totalChecklistItems": 0}
    if not board_id:
        return {"totalCards": 0, "cardsByList": [], "cardsByPriority": {}, "overdueCount": 0, "completedChecklistItems": 0, "totalChecklistItems": 0}
    board = db.query(Board).filter(Board.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    lists = db.query(BoardList).filter(BoardList.board_id == data.board_id).order_by(BoardList.position).all()
    list_ids = [lst.id for lst in lists]
    all_cards = db.query(Card).filter(Card.list_id.in_(list_ids), Card.archived == False).all()

    cards_by_list = []
    for lst in lists:
        count = sum(1 for c in all_cards if c.list_id == lst.id)
        cards_by_list.append({"listId": lst.id, "title": lst.title, "count": count})

    priority_counts: Dict[str, int] = {"none": 0, "low": 0, "medium": 0, "high": 0, "urgent": 0}
    for c in all_cards:
        p = c.priority or "none"
        if p in priority_counts:
            priority_counts[p] += 1

    now = datetime.utcnow()
    overdue_count = sum(1 for c in all_cards if c.due_date and c.due_date < now)

    all_checklist = db.query(ChecklistItem).filter(
        ChecklistItem.card_id.in_([c.id for c in all_cards])
    ).all()
    total_checklist = len(all_checklist)
    completed_checklist = sum(1 for item in all_checklist if item.completed)

    return {
        "totalCards": len(all_cards),
        "cardsByList": cards_by_list,
        "cardsByPriority": priority_counts,
        "overdueCount": overdue_count,
        "completedChecklistItems": completed_checklist,
        "totalChecklistItems": total_checklist,
    }


# ============================================================================
# UI Observation Routes (Framework - Agent API)
# ============================================================================

@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)) -> Dict[str, Any]:
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {
            "htmlStructure": None, "visibleText": [], "inputValues": {},
            "componentState": {}, "currentView": None, "viewport": {},
            "timestamp": None, "status": "no_snapshot",
        }
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
