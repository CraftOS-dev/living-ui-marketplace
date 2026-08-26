"""
Living UI Data Models for Invoice & Subscription Tracker
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, JSON, Float, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
from typing import Dict, Any, List

Base = declarative_base()


class AppState(Base):
    """
    Flexible application state storage for general config/state.
    """
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


class TrackerGroup(Base):
    """
    User Workspace / Project Group (e.g. Engineering & Cloud, Marketing Ops, Personal SaaS).
    """
    __tablename__ = "tracker_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(50), default="#FF9900")
    icon = Column(String(50), default="Layers")
    currency = Column(String(10), default="USD")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description or "",
            "color": self.color,
            "icon": self.icon,
            "currency": self.currency,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class InvoiceReceipt(Base):
    """
    Invoice or receipt entry created and managed by the user.
    """
    __tablename__ = "invoice_receipts"

    id = Column(Integer, primary_key=True, index=True)
    vendor = Column(String(255), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD")
    payment_type = Column(String(50), default="one_time")  # 'one_time' or 'subscription'
    billing_frequency = Column(String(50), default="none")  # 'monthly', 'yearly', 'weekly', 'quarterly', 'none'
    category = Column(String(100), default="Software & SaaS")
    purpose = Column(Text, nullable=True)  # Description / notes / what the purchase is for
    invoice_date = Column(DateTime, default=datetime.utcnow)
    invoice_number = Column(String(255), nullable=True)
    group_id = Column(Integer, ForeignKey("tracker_groups.id"), nullable=True, index=True)
    subscription_id = Column(Integer, nullable=True, index=True)
    has_pdf_attachment = Column(Boolean, default=False)
    pdf_filename = Column(String(255), nullable=True)
    pdf_text_preview = Column(Text, nullable=True)
    pdf_data_base64 = Column(Text, nullable=True)
    line_items = Column(JSON, default=list)
    confidence_score = Column(Float, default=1.0)
    is_verified = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "vendor": self.vendor,
            "amount": self.amount,
            "currency": self.currency,
            "paymentType": self.payment_type,
            "billingFrequency": self.billing_frequency,
            "category": self.category,
            "purpose": self.purpose or "",
            "invoiceDate": self.invoice_date.isoformat() if self.invoice_date else None,
            "invoiceNumber": self.invoice_number or "",
            "groupId": self.group_id,
            "subscriptionId": self.subscription_id,
            "hasPdfAttachment": bool(self.has_pdf_attachment),
            "pdfFilename": self.pdf_filename or "",
            "pdfTextPreview": self.pdf_text_preview or "",
            "pdfDataBase64": self.pdf_data_base64 or "",
            "lineItems": self.line_items or [],
            "confidenceScore": self.confidence_score,
            "isVerified": self.is_verified,
            "notes": self.notes or "",
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class Subscription(Base):
    """
    Recurring subscription tracked inside a group.
    """
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    vendor = Column(String(255), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD")
    billing_frequency = Column(String(50), default="monthly")  # 'monthly', 'yearly', 'weekly', 'quarterly'
    category = Column(String(100), default="Software & SaaS")
    purpose = Column(Text, nullable=True)  # What the subscription is for
    status = Column(String(50), default="active")  # 'active', 'paused', 'cancelled'
    group_id = Column(Integer, ForeignKey("tracker_groups.id"), nullable=True, index=True)
    last_billed_date = Column(DateTime, default=datetime.utcnow)
    next_renewal_date = Column(DateTime, nullable=False)
    auto_renew = Column(Boolean, default=True)
    latest_invoice_id = Column(Integer, nullable=True)
    total_spent_to_date = Column(Float, default=0.0)
    icon_name = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "vendor": self.vendor,
            "amount": self.amount,
            "currency": self.currency,
            "billingFrequency": self.billing_frequency,
            "category": self.category,
            "purpose": self.purpose or "",
            "status": self.status,
            "groupId": self.group_id,
            "lastBilledDate": self.last_billed_date.isoformat() if self.last_billed_date else None,
            "nextRenewalDate": self.next_renewal_date.isoformat() if self.next_renewal_date else None,
            "autoRenew": self.auto_renew,
            "latestInvoiceId": self.latest_invoice_id,
            "totalSpentToDate": self.total_spent_to_date,
            "iconName": self.icon_name or "",
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class ActivityLog(Base):
    """
    Activity feed event recorded when an invoice or subscription is added or updated.
    """
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(100), nullable=False)  # 'invoice_added', 'subscription_created', 'subscription_renewed', 'group_created'
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    amount = Column(Float, nullable=True)
    currency = Column(String(10), default="USD")
    vendor = Column(String(255), nullable=True)
    group_id = Column(Integer, ForeignKey("tracker_groups.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "eventType": self.event_type,
            "title": self.title,
            "description": self.description or "",
            "amount": self.amount,
            "currency": self.currency,
            "vendor": self.vendor,
            "groupId": self.group_id,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
