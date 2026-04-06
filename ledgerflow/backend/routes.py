"""
LedgerFlow API Routes

REST API endpoints for the LedgerFlow bookkeeping application.
Provides state management, chart of accounts, double-entry transactions,
invoicing, bills, and financial reports.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, extract, and_, or_
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from datetime import datetime, date, timedelta
from database import get_db
from models import (
    AppState, UISnapshot, UIScreenshot,
    Settings, Account, Category, Contact,
    JournalEntry, JournalLine, Invoice, InvoiceLine,
    Bill, BillLine,
)
import logging
import uuid

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Helper Functions
# ============================================================================

def _get_or_create_settings(db: Session) -> Settings:
    """Get settings singleton, creating default if not exists."""
    settings = db.query(Settings).filter(Settings.id == "default").first()
    if not settings:
        settings = Settings(id="default")
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _compute_account_balance(db: Session, account_id: str, as_of: date = None) -> float:
    """Compute account balance from journal lines.

    Asset and Expense accounts are debit-normal (debit increases balance).
    Liability, Equity, and Revenue accounts are credit-normal (credit increases balance).
    """
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        return 0.0

    query = db.query(
        func.coalesce(func.sum(JournalLine.debit), 0.0).label("total_debit"),
        func.coalesce(func.sum(JournalLine.credit), 0.0).label("total_credit"),
    ).filter(JournalLine.account_id == account_id)

    if as_of:
        query = query.join(JournalEntry).filter(JournalEntry.entry_date <= as_of)

    result = query.one()
    total_debit = result.total_debit
    total_credit = result.total_credit

    opening = account.opening_balance or 0.0

    if account.account_type in ("asset", "expense"):
        balance = opening + total_debit - total_credit
    else:
        balance = opening + total_credit - total_debit

    return round(balance, 2)


def _parse_date(date_str: str) -> date:
    """Convert YYYY-MM-DD string to date object."""
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def _new_id() -> str:
    return str(uuid.uuid4())


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


# ============================================================================
# State Management Routes
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
    payload = request.payload or {}
    state = db.query(AppState).first()
    if not state:
        state = AppState(data={})
        db.add(state)
    current_data = state.data or {}

    if action == "reset":
        state.data = {}
        db.commit()
        return {"status": "reset", "data": {}}
    elif action == "increment":
        key = payload.get("key", "counter")
        current_data[key] = current_data.get(key, 0) + 1
        state.data = current_data
        db.commit()
        return {"status": "incremented", "data": current_data}
    elif action == "decrement":
        key = payload.get("key", "counter")
        current_data[key] = current_data.get(key, 0) - 1
        state.data = current_data
        db.commit()
        return {"status": "decremented", "data": current_data}
    else:
        return {"status": "unknown_action", "action": action, "data": current_data}


# ============================================================================
# UI Observation Routes
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


# ============================================================================
# Settings Routes
# ============================================================================

@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    settings = _get_or_create_settings(db)
    return settings.to_dict()


@router.put("/settings")
def update_settings(data: Dict[str, Any], db: Session = Depends(get_db)):
    settings = _get_or_create_settings(db)
    if "businessName" in data:
        settings.business_name = data["businessName"]
    if "currency" in data:
        settings.currency = data["currency"]
    if "fiscalYearStart" in data:
        settings.fiscal_year_start = data["fiscalYearStart"]
    if "taxRate" in data:
        settings.tax_rate = data["taxRate"]
    settings.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(settings)
    return settings.to_dict()


@router.post("/settings/seed")
def seed_accounts(db: Session = Depends(get_db)):
    """Seed default chart of accounts if none exist."""
    existing = db.query(Account).count()
    if existing > 0:
        return {"status": "skipped", "message": "Accounts already exist", "count": existing}

    default_accounts = [
        ("1000", "Cash", "asset", "cash"),
        ("1010", "Bank Account", "asset", "bank"),
        ("1200", "Accounts Receivable", "asset", "accounts_receivable"),
        ("1500", "Inventory", "asset", "inventory"),
        ("2000", "Accounts Payable", "liability", "accounts_payable"),
        ("2100", "Credit Card", "liability", "credit_card"),
        ("2500", "Loans Payable", "liability", "loan"),
        ("3000", "Owner's Equity", "equity", None),
        ("3100", "Retained Earnings", "equity", "retained_earnings"),
        ("4000", "Sales Revenue", "revenue", "sales"),
        ("4100", "Service Revenue", "revenue", "service"),
        ("4200", "Other Income", "revenue", "other"),
        ("5000", "Cost of Goods Sold", "expense", "cogs"),
        ("6000", "Rent Expense", "expense", "rent"),
        ("6100", "Utilities Expense", "expense", "utilities"),
        ("6200", "Office Supplies", "expense", "supplies"),
        ("6300", "Salaries & Wages", "expense", "salaries"),
        ("6400", "Insurance", "expense", "insurance"),
        ("6500", "Depreciation", "expense", "depreciation"),
        ("6900", "Miscellaneous Expense", "expense", "other"),
    ]

    for code, name, acct_type, sub_type in default_accounts:
        account = Account(
            id=_new_id(),
            code=code,
            name=name,
            account_type=acct_type,
            sub_type=sub_type,
        )
        db.add(account)

    db.commit()
    return {"status": "seeded", "count": len(default_accounts)}


# ============================================================================
# Accounts Routes
# ============================================================================

@router.get("/accounts/tree")
def get_accounts_tree(db: Session = Depends(get_db)):
    """Get accounts grouped by account_type."""
    accounts = db.query(Account).filter(Account.is_active == True).order_by(Account.code).all()
    tree: Dict[str, list] = {}
    for a in accounts:
        tree.setdefault(a.account_type, []).append(a.to_dict())
    return tree


@router.get("/accounts")
def list_accounts(
    type: Optional[str] = Query(None),
    active: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Account)
    if type:
        query = query.filter(Account.account_type == type)
    if active is not None:
        query = query.filter(Account.is_active == active)
    accounts = query.order_by(Account.code).all()
    return [a.to_dict() for a in accounts]


@router.get("/accounts/{account_id}")
def get_account(account_id: str, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account.to_dict()


@router.post("/accounts", status_code=201)
def create_account(data: Dict[str, Any], db: Session = Depends(get_db)):
    account = Account(
        id=_new_id(),
        code=data["code"],
        name=data["name"],
        account_type=data["accountType"],
        sub_type=data.get("subType"),
        parent_id=data.get("parentId"),
        description=data.get("description"),
        currency=data.get("currency", "USD"),
        opening_balance=data.get("openingBalance", 0.0),
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account.to_dict()


@router.put("/accounts/{account_id}")
def update_account(account_id: str, data: Dict[str, Any], db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    for key, attr in [
        ("code", "code"), ("name", "name"), ("accountType", "account_type"),
        ("subType", "sub_type"), ("parentId", "parent_id"),
        ("description", "description"), ("currency", "currency"),
        ("openingBalance", "opening_balance"), ("isActive", "is_active"),
    ]:
        if key in data:
            setattr(account, attr, data[key])
    account.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(account)
    return account.to_dict()


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str, db: Session = Depends(get_db)):
    """Soft delete an account."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.is_active = False
    account.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "deactivated", "id": account_id}


@router.get("/accounts/{account_id}/balance")
def get_account_balance(account_id: str, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    balance = _compute_account_balance(db, account_id)
    return {"accountId": account_id, "balance": balance}


# ============================================================================
# Categories Routes
# ============================================================================

@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    cats = db.query(Category).order_by(Category.name).all()
    return [c.to_dict() for c in cats]


@router.post("/categories", status_code=201)
def create_category(data: Dict[str, Any], db: Session = Depends(get_db)):
    cat = Category(
        id=_new_id(),
        name=data["name"],
        color=data.get("color"),
        parent_id=data.get("parentId"),
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat.to_dict()


@router.put("/categories/{category_id}")
def update_category(category_id: str, data: Dict[str, Any], db: Session = Depends(get_db)):
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if "name" in data:
        cat.name = data["name"]
    if "color" in data:
        cat.color = data["color"]
    if "parentId" in data:
        cat.parent_id = data["parentId"]
    db.commit()
    db.refresh(cat)
    return cat.to_dict()


@router.delete("/categories/{category_id}")
def delete_category(category_id: str, db: Session = Depends(get_db)):
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    db.delete(cat)
    db.commit()
    return {"status": "deleted", "id": category_id}


# ============================================================================
# Contacts Routes
# ============================================================================

@router.get("/contacts")
def list_contacts(type: Optional[str] = Query(None), db: Session = Depends(get_db)):
    query = db.query(Contact).filter(Contact.is_active == True)
    if type:
        query = query.filter(or_(Contact.contact_type == type, Contact.contact_type == "both"))
    return [c.to_dict() for c in query.order_by(Contact.name).all()]


@router.get("/contacts/{contact_id}")
def get_contact(contact_id: str, db: Session = Depends(get_db)):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact.to_dict()


@router.post("/contacts", status_code=201)
def create_contact(data: Dict[str, Any], db: Session = Depends(get_db)):
    contact = Contact(
        id=_new_id(),
        name=data["name"],
        contact_type=data["contactType"],
        email=data.get("email"),
        phone=data.get("phone"),
        address=data.get("address"),
        tax_id=data.get("taxId"),
        notes=data.get("notes"),
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact.to_dict()


@router.put("/contacts/{contact_id}")
def update_contact(contact_id: str, data: Dict[str, Any], db: Session = Depends(get_db)):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for key, attr in [
        ("name", "name"), ("contactType", "contact_type"), ("email", "email"),
        ("phone", "phone"), ("address", "address"), ("taxId", "tax_id"),
        ("notes", "notes"), ("isActive", "is_active"),
    ]:
        if key in data:
            setattr(contact, attr, data[key])
    contact.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(contact)
    return contact.to_dict()


@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: str, db: Session = Depends(get_db)):
    """Soft delete a contact."""
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact.is_active = False
    contact.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "deactivated", "id": contact_id}


# ============================================================================
# Transactions Routes
# ============================================================================

@router.get("/transactions")
def list_transactions(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    account_id: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    entry_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    query = db.query(JournalEntry).options(
        joinedload(JournalEntry.lines).joinedload(JournalLine.account),
        joinedload(JournalEntry.contact),
        joinedload(JournalEntry.category),
    )

    if from_date:
        query = query.filter(JournalEntry.entry_date >= _parse_date(from_date))
    if to_date:
        query = query.filter(JournalEntry.entry_date <= _parse_date(to_date))
    if category_id:
        query = query.filter(JournalEntry.category_id == category_id)
    if entry_type:
        query = query.filter(JournalEntry.entry_type == entry_type)
    if account_id:
        query = query.join(JournalLine).filter(JournalLine.account_id == account_id)
    if search:
        query = query.filter(
            or_(
                JournalEntry.description.ilike(f"%{search}%"),
                JournalEntry.reference.ilike(f"%{search}%"),
            )
        )

    # Count before pagination
    total = query.count()

    entries = query.order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc()).offset(offset).limit(limit).all()

    results = []
    for e in entries:
        d = e.to_dict()
        d["contactName"] = e.contact.name if e.contact else None
        d["categoryName"] = e.category.name if e.category else None
        results.append(d)

    return {"transactions": results, "total": total, "limit": limit, "offset": offset}


@router.get("/transactions/{entry_id}")
def get_transaction(entry_id: str, db: Session = Depends(get_db)):
    entry = db.query(JournalEntry).options(
        joinedload(JournalEntry.lines).joinedload(JournalLine.account),
        joinedload(JournalEntry.contact),
        joinedload(JournalEntry.category),
    ).filter(JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Transaction not found")
    d = entry.to_dict()
    d["contactName"] = entry.contact.name if entry.contact else None
    d["categoryName"] = entry.category.name if entry.category else None
    return d


@router.delete("/transactions/{entry_id}")
def delete_transaction(entry_id: str, db: Session = Depends(get_db)):
    entry = db.query(JournalEntry).filter(JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(entry)
    db.commit()
    return {"status": "deleted", "id": entry_id}


@router.post("/transactions/income", status_code=201)
def create_income(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Create an income transaction: debit deposit account, credit revenue account."""
    entry_id = _new_id()
    entry = JournalEntry(
        id=entry_id,
        entry_date=_parse_date(data["date"]),
        description=data.get("description"),
        contact_id=data.get("contactId"),
        category_id=data.get("categoryId"),
        reference=data.get("reference"),
        entry_type="income",
    )
    db.add(entry)

    amount = round(float(data["amount"]), 2)
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=data["depositAccountId"], debit=amount, credit=0.0, description=data.get("description")))
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=data["revenueAccountId"], debit=0.0, credit=amount, description=data.get("description")))

    db.commit()
    db.refresh(entry)
    return entry.to_dict()


@router.post("/transactions/expense", status_code=201)
def create_expense(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Create an expense transaction: debit expense account, credit payment account."""
    entry_id = _new_id()
    entry = JournalEntry(
        id=entry_id,
        entry_date=_parse_date(data["date"]),
        description=data.get("description"),
        contact_id=data.get("contactId"),
        category_id=data.get("categoryId"),
        reference=data.get("reference"),
        entry_type="expense",
    )
    db.add(entry)

    amount = round(float(data["amount"]), 2)
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=data["expenseAccountId"], debit=amount, credit=0.0, description=data.get("description")))
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=data["paymentAccountId"], debit=0.0, credit=amount, description=data.get("description")))

    db.commit()
    db.refresh(entry)
    return entry.to_dict()


@router.post("/transactions/transfer", status_code=201)
def create_transfer(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Create a transfer: debit toAccount, credit fromAccount."""
    entry_id = _new_id()
    entry = JournalEntry(
        id=entry_id,
        entry_date=_parse_date(data["date"]),
        description=data.get("description"),
        contact_id=data.get("contactId"),
        category_id=data.get("categoryId"),
        reference=data.get("reference"),
        entry_type="transfer",
    )
    db.add(entry)

    amount = round(float(data["amount"]), 2)
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=data["toAccountId"], debit=amount, credit=0.0, description=data.get("description")))
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=data["fromAccountId"], debit=0.0, credit=amount, description=data.get("description")))

    db.commit()
    db.refresh(entry)
    return entry.to_dict()


# ============================================================================
# Invoices Routes
# ============================================================================

@router.get("/invoices")
def list_invoices(
    status: Optional[str] = Query(None),
    contact_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Invoice).options(joinedload(Invoice.contact), joinedload(Invoice.lines))
    if status:
        query = query.filter(Invoice.status == status)
    if contact_id:
        query = query.filter(Invoice.contact_id == contact_id)
    invoices = query.order_by(Invoice.issue_date.desc()).all()
    return [inv.to_dict() for inv in invoices]


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: str, db: Session = Depends(get_db)):
    inv = db.query(Invoice).options(
        joinedload(Invoice.contact), joinedload(Invoice.lines),
    ).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv.to_dict()


@router.post("/invoices", status_code=201)
def create_invoice(data: Dict[str, Any], db: Session = Depends(get_db)):
    settings = _get_or_create_settings(db)
    inv_number = data.get("invoiceNumber", f"INV-{settings.next_invoice_number:04d}")

    inv_id = _new_id()
    inv = Invoice(
        id=inv_id,
        invoice_number=inv_number,
        contact_id=data["contactId"],
        issue_date=_parse_date(data["issueDate"]),
        due_date=_parse_date(data["dueDate"]),
        status=data.get("status", "draft"),
        tax_rate=data.get("taxRate", settings.tax_rate or 0.0),
        notes=data.get("notes"),
    )
    db.add(inv)

    subtotal = 0.0
    for line_data in data.get("lines", []):
        qty = float(line_data.get("quantity", 1.0))
        price = float(line_data["unitPrice"])
        amount = round(qty * price, 2)
        line = InvoiceLine(
            id=_new_id(),
            invoice_id=inv_id,
            description=line_data["description"],
            quantity=qty,
            unit_price=price,
            amount=amount,
            account_id=line_data.get("accountId"),
        )
        db.add(line)
        subtotal += amount

    inv.subtotal = round(subtotal, 2)
    inv.tax_amount = round(subtotal * (inv.tax_rate or 0.0) / 100, 2)
    inv.total = round(inv.subtotal + inv.tax_amount, 2)

    settings.next_invoice_number += 1
    db.commit()
    db.refresh(inv)
    return inv.to_dict()


@router.put("/invoices/{invoice_id}")
def update_invoice(invoice_id: str, data: Dict[str, Any], db: Session = Depends(get_db)):
    inv = db.query(Invoice).options(joinedload(Invoice.lines)).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft invoices can be edited")

    for key, attr in [
        ("contactId", "contact_id"), ("issueDate", None), ("dueDate", None),
        ("notes", "notes"), ("taxRate", "tax_rate"),
    ]:
        if key in data:
            if key == "issueDate":
                inv.issue_date = _parse_date(data[key])
            elif key == "dueDate":
                inv.due_date = _parse_date(data[key])
            else:
                setattr(inv, attr, data[key])

    if "lines" in data:
        # Replace lines
        for old_line in inv.lines:
            db.delete(old_line)
        db.flush()

        subtotal = 0.0
        for line_data in data["lines"]:
            qty = float(line_data.get("quantity", 1.0))
            price = float(line_data["unitPrice"])
            amount = round(qty * price, 2)
            line = InvoiceLine(
                id=_new_id(),
                invoice_id=invoice_id,
                description=line_data["description"],
                quantity=qty,
                unit_price=price,
                amount=amount,
                account_id=line_data.get("accountId"),
            )
            db.add(line)
            subtotal += amount

        inv.subtotal = round(subtotal, 2)
        inv.tax_amount = round(inv.subtotal * (inv.tax_rate or 0.0) / 100, 2)
        inv.total = round(inv.subtotal + inv.tax_amount, 2)

    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return inv.to_dict()


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: str, db: Session = Depends(get_db)):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status in ("sent", "paid"):
        inv.status = "void"
        inv.updated_at = datetime.utcnow()
        db.commit()
        return {"status": "voided", "id": invoice_id}
    db.delete(inv)
    db.commit()
    return {"status": "deleted", "id": invoice_id}


@router.post("/invoices/{invoice_id}/send")
def send_invoice(invoice_id: str, db: Session = Depends(get_db)):
    inv = db.query(Invoice).options(joinedload(Invoice.contact)).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status not in ("draft",):
        raise HTTPException(status_code=400, detail="Invoice already sent or processed")

    inv.status = "sent"

    # Find AR account (code 1200)
    ar_account = db.query(Account).filter(Account.code == "1200").first()
    if not ar_account:
        raise HTTPException(status_code=400, detail="Accounts Receivable account (1200) not found. Seed accounts first.")

    # Find revenue account
    revenue_account = db.query(Account).filter(Account.code == "4000").first()
    if not revenue_account:
        revenue_account = db.query(Account).filter(Account.account_type == "revenue").first()
    if not revenue_account:
        raise HTTPException(status_code=400, detail="No revenue account found. Seed accounts first.")

    entry_id = _new_id()
    entry = JournalEntry(
        id=entry_id,
        entry_date=inv.issue_date,
        description=f"Invoice {inv.invoice_number}",
        contact_id=inv.contact_id,
        entry_type="invoice",
        reference=inv.invoice_number,
    )
    db.add(entry)
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=ar_account.id, debit=inv.total, credit=0.0, description=f"Invoice {inv.invoice_number}"))
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=revenue_account.id, debit=0.0, credit=inv.total, description=f"Invoice {inv.invoice_number}"))

    inv.journal_entry_id = entry_id
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return inv.to_dict()


@router.post("/invoices/{invoice_id}/payment")
def record_invoice_payment(invoice_id: str, data: Dict[str, Any], db: Session = Depends(get_db)):
    inv = db.query(Invoice).options(joinedload(Invoice.contact)).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    amount = round(float(data["amount"]), 2)

    ar_account = db.query(Account).filter(Account.code == "1200").first()
    if not ar_account:
        raise HTTPException(status_code=400, detail="AR account (1200) not found")

    entry_id = _new_id()
    entry = JournalEntry(
        id=entry_id,
        entry_date=date.today(),
        description=f"Payment for Invoice {inv.invoice_number}",
        contact_id=inv.contact_id,
        entry_type="income",
        reference=f"PMT-{inv.invoice_number}",
    )
    db.add(entry)
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=data["depositAccountId"], debit=amount, credit=0.0, description=f"Payment for Invoice {inv.invoice_number}"))
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=ar_account.id, debit=0.0, credit=amount, description=f"Payment for Invoice {inv.invoice_number}"))

    inv.amount_paid = round((inv.amount_paid or 0.0) + amount, 2)
    if inv.amount_paid >= inv.total:
        inv.status = "paid"
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return inv.to_dict()


# ============================================================================
# Bills Routes
# ============================================================================

@router.get("/bills")
def list_bills(
    status: Optional[str] = Query(None),
    contact_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Bill).options(joinedload(Bill.contact), joinedload(Bill.lines))
    if status:
        query = query.filter(Bill.status == status)
    if contact_id:
        query = query.filter(Bill.contact_id == contact_id)
    bills = query.order_by(Bill.issue_date.desc()).all()
    return [b.to_dict() for b in bills]


@router.get("/bills/{bill_id}")
def get_bill(bill_id: str, db: Session = Depends(get_db)):
    bill = db.query(Bill).options(
        joinedload(Bill.contact), joinedload(Bill.lines),
    ).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill.to_dict()


@router.post("/bills", status_code=201)
def create_bill(data: Dict[str, Any], db: Session = Depends(get_db)):
    settings = _get_or_create_settings(db)
    bill_number = data.get("billNumber", f"BILL-{settings.next_bill_number:04d}")

    bill_id = _new_id()
    bill = Bill(
        id=bill_id,
        bill_number=bill_number,
        contact_id=data["contactId"],
        issue_date=_parse_date(data["issueDate"]),
        due_date=_parse_date(data["dueDate"]),
        status=data.get("status", "draft"),
        tax_rate=data.get("taxRate", settings.tax_rate or 0.0),
        notes=data.get("notes"),
    )
    db.add(bill)

    subtotal = 0.0
    for line_data in data.get("lines", []):
        qty = float(line_data.get("quantity", 1.0))
        price = float(line_data["unitPrice"])
        amount = round(qty * price, 2)
        line = BillLine(
            id=_new_id(),
            bill_id=bill_id,
            description=line_data["description"],
            quantity=qty,
            unit_price=price,
            amount=amount,
            account_id=line_data.get("accountId"),
        )
        db.add(line)
        subtotal += amount

    bill.subtotal = round(subtotal, 2)
    bill.tax_amount = round(subtotal * (bill.tax_rate or 0.0) / 100, 2)
    bill.total = round(bill.subtotal + bill.tax_amount, 2)

    settings.next_bill_number += 1
    db.commit()
    db.refresh(bill)
    return bill.to_dict()


@router.put("/bills/{bill_id}")
def update_bill(bill_id: str, data: Dict[str, Any], db: Session = Depends(get_db)):
    bill = db.query(Bill).options(joinedload(Bill.lines)).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.status not in ("draft",):
        raise HTTPException(status_code=400, detail="Only draft bills can be edited")

    for key, attr in [
        ("contactId", "contact_id"), ("issueDate", None), ("dueDate", None),
        ("notes", "notes"), ("taxRate", "tax_rate"),
    ]:
        if key in data:
            if key == "issueDate":
                bill.issue_date = _parse_date(data[key])
            elif key == "dueDate":
                bill.due_date = _parse_date(data[key])
            else:
                setattr(bill, attr, data[key])

    if "lines" in data:
        for old_line in bill.lines:
            db.delete(old_line)
        db.flush()

        subtotal = 0.0
        for line_data in data["lines"]:
            qty = float(line_data.get("quantity", 1.0))
            price = float(line_data["unitPrice"])
            amount = round(qty * price, 2)
            line = BillLine(
                id=_new_id(),
                bill_id=bill_id,
                description=line_data["description"],
                quantity=qty,
                unit_price=price,
                amount=amount,
                account_id=line_data.get("accountId"),
            )
            db.add(line)
            subtotal += amount

        bill.subtotal = round(subtotal, 2)
        bill.tax_amount = round(bill.subtotal * (bill.tax_rate or 0.0) / 100, 2)
        bill.total = round(bill.subtotal + bill.tax_amount, 2)

    bill.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(bill)
    return bill.to_dict()


@router.delete("/bills/{bill_id}")
def delete_bill(bill_id: str, db: Session = Depends(get_db)):
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.status in ("received", "paid"):
        bill.status = "void"
        bill.updated_at = datetime.utcnow()
        db.commit()
        return {"status": "voided", "id": bill_id}
    db.delete(bill)
    db.commit()
    return {"status": "deleted", "id": bill_id}


@router.post("/bills/{bill_id}/receive")
def receive_bill(bill_id: str, db: Session = Depends(get_db)):
    bill = db.query(Bill).options(joinedload(Bill.contact)).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.status not in ("draft",):
        raise HTTPException(status_code=400, detail="Bill already received or processed")

    bill.status = "received"

    # Find AP account (code 2000)
    ap_account = db.query(Account).filter(Account.code == "2000").first()
    if not ap_account:
        raise HTTPException(status_code=400, detail="Accounts Payable account (2000) not found. Seed accounts first.")

    # Find expense account
    expense_account = db.query(Account).filter(Account.code == "5000").first()
    if not expense_account:
        expense_account = db.query(Account).filter(Account.account_type == "expense").first()
    if not expense_account:
        raise HTTPException(status_code=400, detail="No expense account found. Seed accounts first.")

    entry_id = _new_id()
    entry = JournalEntry(
        id=entry_id,
        entry_date=bill.issue_date,
        description=f"Bill {bill.bill_number}",
        contact_id=bill.contact_id,
        entry_type="bill",
        reference=bill.bill_number,
    )
    db.add(entry)
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=expense_account.id, debit=bill.total, credit=0.0, description=f"Bill {bill.bill_number}"))
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=ap_account.id, debit=0.0, credit=bill.total, description=f"Bill {bill.bill_number}"))

    bill.journal_entry_id = entry_id
    bill.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(bill)
    return bill.to_dict()


@router.post("/bills/{bill_id}/payment")
def record_bill_payment(bill_id: str, data: Dict[str, Any], db: Session = Depends(get_db)):
    bill = db.query(Bill).options(joinedload(Bill.contact)).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    amount = round(float(data["amount"]), 2)

    ap_account = db.query(Account).filter(Account.code == "2000").first()
    if not ap_account:
        raise HTTPException(status_code=400, detail="AP account (2000) not found")

    entry_id = _new_id()
    entry = JournalEntry(
        id=entry_id,
        entry_date=date.today(),
        description=f"Payment for Bill {bill.bill_number}",
        contact_id=bill.contact_id,
        entry_type="expense",
        reference=f"PMT-{bill.bill_number}",
    )
    db.add(entry)
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=ap_account.id, debit=amount, credit=0.0, description=f"Payment for Bill {bill.bill_number}"))
    db.add(JournalLine(id=_new_id(), journal_entry_id=entry_id, account_id=data["paymentAccountId"], debit=0.0, credit=amount, description=f"Payment for Bill {bill.bill_number}"))

    bill.amount_paid = round((bill.amount_paid or 0.0) + amount, 2)
    if bill.amount_paid >= bill.total:
        bill.status = "paid"
    bill.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(bill)
    return bill.to_dict()


# ============================================================================
# Reports Routes
# ============================================================================

@router.get("/reports/profit-loss")
def profit_loss_report(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    today = date.today()
    fd = _parse_date(from_date) if from_date else today.replace(day=1)
    td = _parse_date(to_date) if to_date else today

    # Revenue accounts
    revenue_accounts = db.query(Account).filter(Account.account_type == "revenue", Account.is_active == True).all()
    revenue_items = []
    total_revenue = 0.0
    for acct in revenue_accounts:
        amt = db.query(
            func.coalesce(func.sum(JournalLine.credit), 0.0) - func.coalesce(func.sum(JournalLine.debit), 0.0)
        ).join(JournalEntry).filter(
            JournalLine.account_id == acct.id,
            JournalEntry.entry_date >= fd,
            JournalEntry.entry_date <= td,
        ).scalar() or 0.0
        amt = round(amt, 2)
        if amt != 0:
            revenue_items.append({"accountId": acct.id, "accountCode": acct.code, "accountName": acct.name, "amount": amt})
            total_revenue += amt

    # Expense accounts
    expense_accounts = db.query(Account).filter(Account.account_type == "expense", Account.is_active == True).all()
    expense_items = []
    total_expenses = 0.0
    for acct in expense_accounts:
        amt = db.query(
            func.coalesce(func.sum(JournalLine.debit), 0.0) - func.coalesce(func.sum(JournalLine.credit), 0.0)
        ).join(JournalEntry).filter(
            JournalLine.account_id == acct.id,
            JournalEntry.entry_date >= fd,
            JournalEntry.entry_date <= td,
        ).scalar() or 0.0
        amt = round(amt, 2)
        if amt != 0:
            expense_items.append({"accountId": acct.id, "accountCode": acct.code, "accountName": acct.name, "amount": amt})
            total_expenses += amt

    return {
        "fromDate": fd.isoformat(),
        "toDate": td.isoformat(),
        "revenue": revenue_items,
        "totalRevenue": round(total_revenue, 2),
        "expenses": expense_items,
        "totalExpenses": round(total_expenses, 2),
        "netIncome": round(total_revenue - total_expenses, 2),
    }


@router.get("/reports/balance-sheet")
def balance_sheet_report(
    as_of: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    as_of_date = _parse_date(as_of) if as_of else date.today()

    final = {"asOf": as_of_date.isoformat()}

    for acct_type in ("asset", "liability", "equity"):
        accounts = db.query(Account).filter(Account.account_type == acct_type, Account.is_active == True).order_by(Account.code).all()
        items = []
        total = 0.0
        for acct in accounts:
            bal = _compute_account_balance(db, acct.id, as_of=as_of_date)
            items.append({"accountId": acct.id, "accountCode": acct.code, "accountName": acct.name, "balance": bal})
            total += bal
        key = "assets" if acct_type == "asset" else ("liabilities" if acct_type == "liability" else "equity")
        final[key] = {"accounts": items, "total": round(total, 2)}

    return final


@router.get("/reports/trial-balance")
def trial_balance_report(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    today = date.today()
    fd = _parse_date(from_date) if from_date else today.replace(day=1)
    td = _parse_date(to_date) if to_date else today

    accounts = db.query(Account).filter(Account.is_active == True).order_by(Account.code).all()
    items = []
    total_debits = 0.0
    total_credits = 0.0

    for acct in accounts:
        row = db.query(
            func.coalesce(func.sum(JournalLine.debit), 0.0).label("d"),
            func.coalesce(func.sum(JournalLine.credit), 0.0).label("c"),
        ).join(JournalEntry).filter(
            JournalLine.account_id == acct.id,
            JournalEntry.entry_date >= fd,
            JournalEntry.entry_date <= td,
        ).one()

        d = round(row.d, 2)
        c = round(row.c, 2)
        if d != 0 or c != 0:
            items.append({
                "accountId": acct.id, "accountCode": acct.code,
                "accountName": acct.name, "accountType": acct.account_type,
                "debit": d, "credit": c,
            })
            total_debits += d
            total_credits += c

    return {
        "fromDate": fd.isoformat(),
        "toDate": td.isoformat(),
        "accounts": items,
        "totalDebits": round(total_debits, 2),
        "totalCredits": round(total_credits, 2),
    }


@router.get("/reports/account-ledger/{account_id}")
def account_ledger_report(account_id: str, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    lines = (
        db.query(JournalLine, JournalEntry)
        .join(JournalEntry)
        .filter(JournalLine.account_id == account_id)
        .order_by(JournalEntry.entry_date, JournalEntry.created_at)
        .all()
    )

    is_debit_normal = account.account_type in ("asset", "expense")
    balance = account.opening_balance or 0.0
    entries = []

    for line, entry in lines:
        if is_debit_normal:
            balance += (line.debit or 0.0) - (line.credit or 0.0)
        else:
            balance += (line.credit or 0.0) - (line.debit or 0.0)

        entries.append({
            "date": entry.entry_date.isoformat() if entry.entry_date else None,
            "description": line.description or entry.description,
            "reference": entry.reference,
            "debit": round(line.debit or 0.0, 2),
            "credit": round(line.credit or 0.0, 2),
            "balance": round(balance, 2),
        })

    return {
        "account": account.to_dict(),
        "entries": entries,
        "currentBalance": round(balance, 2),
    }


# ============================================================================
# Dashboard Routes
# ============================================================================

@router.get("/dashboard/summary")
def dashboard_summary(db: Session = Depends(get_db)):
    today = date.today()
    month_start = today.replace(day=1)

    # Cash balance (accounts 1000 + 1010)
    cash_balance = 0.0
    for code in ("1000", "1010"):
        acct = db.query(Account).filter(Account.code == code).first()
        if acct:
            cash_balance += _compute_account_balance(db, acct.id)

    # Total income this month (revenue accounts)
    total_income = 0.0
    revenue_accounts = db.query(Account).filter(Account.account_type == "revenue").all()
    for acct in revenue_accounts:
        amt = db.query(
            func.coalesce(func.sum(JournalLine.credit), 0.0) - func.coalesce(func.sum(JournalLine.debit), 0.0)
        ).join(JournalEntry).filter(
            JournalLine.account_id == acct.id,
            JournalEntry.entry_date >= month_start,
            JournalEntry.entry_date <= today,
        ).scalar() or 0.0
        total_income += amt

    # Total expenses this month
    total_expenses = 0.0
    expense_accounts = db.query(Account).filter(Account.account_type == "expense").all()
    for acct in expense_accounts:
        amt = db.query(
            func.coalesce(func.sum(JournalLine.debit), 0.0) - func.coalesce(func.sum(JournalLine.credit), 0.0)
        ).join(JournalEntry).filter(
            JournalLine.account_id == acct.id,
            JournalEntry.entry_date >= month_start,
            JournalEntry.entry_date <= today,
        ).scalar() or 0.0
        total_expenses += amt

    # Accounts Receivable
    ar = 0.0
    ar_acct = db.query(Account).filter(Account.code == "1200").first()
    if ar_acct:
        ar = _compute_account_balance(db, ar_acct.id)

    # Accounts Payable
    ap = 0.0
    ap_acct = db.query(Account).filter(Account.code == "2000").first()
    if ap_acct:
        ap = _compute_account_balance(db, ap_acct.id)

    # Overdue counts
    overdue_invoices = db.query(Invoice).filter(
        Invoice.due_date < today,
        Invoice.status.notin_(["paid", "void"]),
    ).count()

    overdue_bills = db.query(Bill).filter(
        Bill.due_date < today,
        Bill.status.notin_(["paid", "void"]),
    ).count()

    return {
        "cashBalance": round(cash_balance, 2),
        "totalIncome": round(total_income, 2),
        "totalExpenses": round(total_expenses, 2),
        "netIncome": round(total_income - total_expenses, 2),
        "accountsReceivable": round(ar, 2),
        "accountsPayable": round(ap, 2),
        "overdueInvoiceCount": overdue_invoices,
        "overdueBillCount": overdue_bills,
    }


@router.get("/dashboard/recent")
def dashboard_recent(db: Session = Depends(get_db)):
    entries = (
        db.query(JournalEntry)
        .options(
            joinedload(JournalEntry.lines).joinedload(JournalLine.account),
            joinedload(JournalEntry.contact),
            joinedload(JournalEntry.category),
        )
        .order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
        .limit(10)
        .all()
    )

    results = []
    for e in entries:
        d = e.to_dict()
        d["contactName"] = e.contact.name if e.contact else None
        d["categoryName"] = e.category.name if e.category else None
        results.append(d)
    return results


@router.get("/dashboard/overdue")
def dashboard_overdue(db: Session = Depends(get_db)):
    today = date.today()

    overdue_invoices = (
        db.query(Invoice)
        .options(joinedload(Invoice.contact))
        .filter(Invoice.due_date < today, Invoice.status.notin_(["paid", "void"]))
        .order_by(Invoice.due_date)
        .all()
    )

    overdue_bills = (
        db.query(Bill)
        .options(joinedload(Bill.contact))
        .filter(Bill.due_date < today, Bill.status.notin_(["paid", "void"]))
        .order_by(Bill.due_date)
        .all()
    )

    return {
        "overdueInvoices": [inv.to_dict() for inv in overdue_invoices],
        "overdueBills": [b.to_dict() for b in overdue_bills],
    }


@router.get("/dashboard/income-expense-chart")
def dashboard_income_expense_chart(db: Session = Depends(get_db)):
    """Monthly income vs expenses for last 6 months."""
    today = date.today()
    results = []

    for i in range(5, -1, -1):
        # Calculate month start/end going back i months
        year = today.year
        month = today.month - i
        while month <= 0:
            month += 12
            year -= 1

        month_start = date(year, month, 1)
        if month == 12:
            month_end = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            month_end = date(year, month + 1, 1) - timedelta(days=1)

        # Income (revenue accounts: credit - debit)
        income = db.query(
            func.coalesce(func.sum(JournalLine.credit), 0.0) - func.coalesce(func.sum(JournalLine.debit), 0.0)
        ).join(JournalEntry).join(Account, JournalLine.account_id == Account.id).filter(
            Account.account_type == "revenue",
            JournalEntry.entry_date >= month_start,
            JournalEntry.entry_date <= month_end,
        ).scalar() or 0.0

        # Expenses (expense accounts: debit - credit)
        expenses = db.query(
            func.coalesce(func.sum(JournalLine.debit), 0.0) - func.coalesce(func.sum(JournalLine.credit), 0.0)
        ).join(JournalEntry).join(Account, JournalLine.account_id == Account.id).filter(
            Account.account_type == "expense",
            JournalEntry.entry_date >= month_start,
            JournalEntry.entry_date <= month_end,
        ).scalar() or 0.0

        results.append({
            "month": f"{year}-{month:02d}",
            "income": round(income, 2),
            "expenses": round(expenses, 2),
        })

    return results


@router.get("/dashboard/expense-breakdown")
def dashboard_expense_breakdown(db: Session = Depends(get_db)):
    """Expenses by category this month."""
    today = date.today()
    month_start = today.replace(day=1)

    # Get expenses grouped by category
    rows = (
        db.query(
            JournalEntry.category_id,
            func.coalesce(func.sum(JournalLine.debit), 0.0).label("total_debit"),
            func.coalesce(func.sum(JournalLine.credit), 0.0).label("total_credit"),
        )
        .join(JournalLine)
        .join(Account, JournalLine.account_id == Account.id)
        .filter(
            Account.account_type == "expense",
            JournalEntry.entry_date >= month_start,
            JournalEntry.entry_date <= today,
        )
        .group_by(JournalEntry.category_id)
        .all()
    )

    results = []
    for row in rows:
        amount = round(row.total_debit - row.total_credit, 2)
        if amount <= 0:
            continue

        cat_name = "Uncategorized"
        cat_color = None
        cat_id = row.category_id

        if cat_id:
            cat = db.query(Category).filter(Category.id == cat_id).first()
            if cat:
                cat_name = cat.name
                cat_color = cat.color

        results.append({
            "categoryId": cat_id,
            "categoryName": cat_name,
            "amount": amount,
            "color": cat_color,
        })

    results.sort(key=lambda x: x["amount"], reverse=True)
    return results
