"""
LedgerFlow Data Models

SQLAlchemy models for the LedgerFlow bookkeeping application.
Includes framework models (AppState, UISnapshot, UIScreenshot) and
all application domain models for double-entry accounting.
"""

from sqlalchemy import (
    Column, Integer, String, DateTime, Boolean, Text, JSON, Float, Date,
    ForeignKey,
)
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime, date
from typing import Dict, Any
import uuid

Base = declarative_base()


def _uuid() -> str:
    return str(uuid.uuid4())


# ============================================================================
# Framework Models
# ============================================================================

class AppState(Base):
    """Flexible application state storage."""
    __tablename__ = "app_state"

    id = Column(Integer, primary_key=True, default=1)
    data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "data": self.data or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def update_data(self, updates: Dict[str, Any]) -> None:
        current = self.data or {}
        current.update(updates)
        self.data = current
        self.updated_at = datetime.utcnow()


class UISnapshot(Base):
    """UI state snapshot for agent observation."""
    __tablename__ = "ui_snapshot"

    id = Column(Integer, primary_key=True, default=1)
    html_structure = Column(Text, nullable=True)
    visible_text = Column(JSON, default=list)
    input_values = Column(JSON, default=dict)
    component_state = Column(JSON, default=dict)
    current_view = Column(String(255), nullable=True)
    viewport = Column(JSON, default=dict)
    timestamp = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "htmlStructure": self.html_structure,
            "visibleText": self.visible_text or [],
            "inputValues": self.input_values or {},
            "componentState": self.component_state or {},
            "currentView": self.current_view,
            "viewport": self.viewport or {},
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


class UIScreenshot(Base):
    """UI screenshot for agent visual observation."""
    __tablename__ = "ui_screenshot"

    id = Column(Integer, primary_key=True, default=1)
    image_data = Column(Text, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "imageData": self.image_data,
            "width": self.width,
            "height": self.height,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


# ============================================================================
# Application Models
# ============================================================================

class Settings(Base):
    """Singleton application settings."""
    __tablename__ = "settings"

    id = Column(String, primary_key=True, default="default")
    business_name = Column(String(200), default="My Business")
    currency = Column(String(3), default="USD")
    fiscal_year_start = Column(Integer, default=1)
    tax_rate = Column(Float, default=0.0)
    next_invoice_number = Column(Integer, default=1001)
    next_bill_number = Column(Integer, default=1001)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "businessName": self.business_name,
            "currency": self.currency,
            "fiscalYearStart": self.fiscal_year_start,
            "taxRate": round(self.tax_rate or 0.0, 2),
            "nextInvoiceNumber": self.next_invoice_number,
            "nextBillNumber": self.next_bill_number,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Account(Base):
    """Chart of Accounts entry."""
    __tablename__ = "accounts"

    id = Column(String, primary_key=True, default=_uuid)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    account_type = Column(String(20), nullable=False)  # asset/liability/equity/revenue/expense
    sub_type = Column(String(50), nullable=True)
    parent_id = Column(String, ForeignKey("accounts.id"), nullable=True)
    description = Column(Text, nullable=True)
    currency = Column(String(3), default="USD")
    is_active = Column(Boolean, default=True)
    opening_balance = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parent = relationship("Account", remote_side=[id])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "accountType": self.account_type,
            "subType": self.sub_type,
            "parentId": self.parent_id,
            "description": self.description,
            "currency": self.currency,
            "isActive": self.is_active,
            "openingBalance": round(self.opening_balance or 0.0, 2),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Category(Base):
    """Transaction category."""
    __tablename__ = "categories"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String(100), unique=True, nullable=False)
    color = Column(String(7), nullable=True)  # hex color
    parent_id = Column(String, ForeignKey("categories.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    parent = relationship("Category", remote_side=[id])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "parentId": self.parent_id,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class Contact(Base):
    """Customer or vendor contact."""
    __tablename__ = "contacts"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String(200), nullable=False)
    contact_type = Column(String(20), nullable=False)  # customer/vendor/both
    email = Column(String(200), nullable=True)
    phone = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)
    tax_id = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "contactType": self.contact_type,
            "email": self.email,
            "phone": self.phone,
            "address": self.address,
            "taxId": self.tax_id,
            "notes": self.notes,
            "isActive": self.is_active,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class JournalEntry(Base):
    """Transaction header (double-entry journal entry)."""
    __tablename__ = "journal_entries"

    id = Column(String, primary_key=True, default=_uuid)
    entry_date = Column(Date, nullable=False)
    reference = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    contact_id = Column(String, ForeignKey("contacts.id"), nullable=True)
    category_id = Column(String, ForeignKey("categories.id"), nullable=True)
    entry_type = Column(String(20), default="manual")  # income/expense/transfer/invoice/bill/manual
    is_reconciled = Column(Boolean, default=False)
    tags = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    lines = relationship("JournalLine", cascade="all, delete-orphan", backref="journal_entry")
    contact = relationship("Contact")
    category = relationship("Category")

    def to_dict(self) -> Dict[str, Any]:
        total_amount = round(sum(l.debit or 0.0 for l in self.lines), 2) if self.lines else 0.0
        return {
            "id": self.id,
            "entryDate": self.entry_date.isoformat() if self.entry_date else None,
            "reference": self.reference,
            "description": self.description,
            "contactId": self.contact_id,
            "categoryId": self.category_id,
            "entryType": self.entry_type,
            "isReconciled": self.is_reconciled,
            "tags": self.tags,
            "totalAmount": total_amount,
            "lines": [l.to_dict() for l in self.lines] if self.lines else [],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class JournalLine(Base):
    """Individual debit/credit line within a journal entry."""
    __tablename__ = "journal_lines"

    id = Column(String, primary_key=True, default=_uuid)
    journal_entry_id = Column(String, ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
    debit = Column(Float, default=0.0)
    credit = Column(Float, default=0.0)
    description = Column(String(200), nullable=True)

    account = relationship("Account")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "journalEntryId": self.journal_entry_id,
            "accountId": self.account_id,
            "accountName": self.account.name if self.account else None,
            "accountCode": self.account.code if self.account else None,
            "debit": round(self.debit or 0.0, 2),
            "credit": round(self.credit or 0.0, 2),
            "description": self.description,
        }


class Invoice(Base):
    """Sales invoice."""
    __tablename__ = "invoices"

    id = Column(String, primary_key=True, default=_uuid)
    invoice_number = Column(String(50), unique=True, nullable=False)
    contact_id = Column(String, ForeignKey("contacts.id"), nullable=False)
    journal_entry_id = Column(String, ForeignKey("journal_entries.id"), nullable=True)
    issue_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    status = Column(String(20), default="draft")  # draft/sent/paid/overdue/void
    subtotal = Column(Float, default=0.0)
    tax_rate = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total = Column(Float, default=0.0)
    amount_paid = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contact = relationship("Contact")
    lines = relationship("InvoiceLine", cascade="all, delete-orphan", backref="invoice")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "invoiceNumber": self.invoice_number,
            "contactId": self.contact_id,
            "contactName": self.contact.name if self.contact else None,
            "journalEntryId": self.journal_entry_id,
            "issueDate": self.issue_date.isoformat() if self.issue_date else None,
            "dueDate": self.due_date.isoformat() if self.due_date else None,
            "status": self.status,
            "subtotal": round(self.subtotal or 0.0, 2),
            "taxRate": round(self.tax_rate or 0.0, 2),
            "taxAmount": round(self.tax_amount or 0.0, 2),
            "total": round(self.total or 0.0, 2),
            "amountPaid": round(self.amount_paid or 0.0, 2),
            "balanceDue": round((self.total or 0.0) - (self.amount_paid or 0.0), 2),
            "notes": self.notes,
            "lines": [l.to_dict() for l in self.lines] if self.lines else [],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class InvoiceLine(Base):
    """Line item on an invoice."""
    __tablename__ = "invoice_lines"

    id = Column(String, primary_key=True, default=_uuid)
    invoice_id = Column(String, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    description = Column(String(300), nullable=False)
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, nullable=False)
    amount = Column(Float, nullable=False)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "invoiceId": self.invoice_id,
            "description": self.description,
            "quantity": round(self.quantity or 1.0, 2),
            "unitPrice": round(self.unit_price or 0.0, 2),
            "amount": round(self.amount or 0.0, 2),
            "accountId": self.account_id,
        }


class Bill(Base):
    """Purchase bill (mirrors Invoice for payables)."""
    __tablename__ = "bills"

    id = Column(String, primary_key=True, default=_uuid)
    bill_number = Column(String(50), unique=True, nullable=False)
    contact_id = Column(String, ForeignKey("contacts.id"), nullable=False)
    journal_entry_id = Column(String, ForeignKey("journal_entries.id"), nullable=True)
    issue_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    status = Column(String(20), default="draft")  # draft/received/paid/overdue/void
    subtotal = Column(Float, default=0.0)
    tax_rate = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total = Column(Float, default=0.0)
    amount_paid = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contact = relationship("Contact")
    lines = relationship("BillLine", cascade="all, delete-orphan", backref="bill")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "billNumber": self.bill_number,
            "contactId": self.contact_id,
            "contactName": self.contact.name if self.contact else None,
            "journalEntryId": self.journal_entry_id,
            "issueDate": self.issue_date.isoformat() if self.issue_date else None,
            "dueDate": self.due_date.isoformat() if self.due_date else None,
            "status": self.status,
            "subtotal": round(self.subtotal or 0.0, 2),
            "taxRate": round(self.tax_rate or 0.0, 2),
            "taxAmount": round(self.tax_amount or 0.0, 2),
            "total": round(self.total or 0.0, 2),
            "amountPaid": round(self.amount_paid or 0.0, 2),
            "balanceDue": round((self.total or 0.0) - (self.amount_paid or 0.0), 2),
            "notes": self.notes,
            "lines": [l.to_dict() for l in self.lines] if self.lines else [],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class BillLine(Base):
    """Line item on a bill."""
    __tablename__ = "bill_lines"

    id = Column(String, primary_key=True, default=_uuid)
    bill_id = Column(String, ForeignKey("bills.id", ondelete="CASCADE"), nullable=False)
    description = Column(String(300), nullable=False)
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, nullable=False)
    amount = Column(Float, nullable=False)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "billId": self.bill_id,
            "description": self.description,
            "quantity": round(self.quantity or 1.0, 2),
            "unitPrice": round(self.unit_price or 0.0, 2),
            "amount": round(self.amount or 0.0, 2),
            "accountId": self.account_id,
        }
