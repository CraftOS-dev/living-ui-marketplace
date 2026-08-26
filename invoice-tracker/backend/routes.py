"""
Living UI REST API Routes for Invoice & Subscription Tracker (Multi-Group Workspace)
"""

from fastapi import APIRouter, Response, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

from database import get_db, seed_group_starter_data
from models import AppState, UISnapshot, UIScreenshot, InvoiceReceipt, Subscription, TrackerGroup, ActivityLog

router = APIRouter()


# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================

class StateUpdateRequest(BaseModel):
    data: Dict[str, Any]


class SnapshotRequest(BaseModel):
    htmlStructure: Optional[str] = None
    visibleText: Optional[List[str]] = None
    inputValues: Optional[Dict[str, Any]] = None
    componentState: Optional[Dict[str, Any]] = None
    currentView: Optional[str] = None
    viewport: Optional[Dict[str, Any]] = None


class ScreenshotRequest(BaseModel):
    imageData: str
    width: Optional[int] = None
    height: Optional[int] = None


class GroupCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#FF9900"
    icon: Optional[str] = "Layers"
    currency: Optional[str] = "USD"
    template_type: Optional[str] = "blank"  # 'blank', 'cloud', 'ai', 'marketing'


class GroupUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    currency: Optional[str] = None


class InvoiceCreateRequest(BaseModel):
    vendor: str
    amount: float
    currency: str = "USD"
    payment_type: str = "one_time"  # 'one_time' or 'subscription'
    billing_frequency: str = "none"  # 'monthly', 'yearly', 'weekly', 'quarterly', 'none'
    category: str = "Software & SaaS"
    purpose: Optional[str] = None
    invoice_date: Optional[str] = None
    invoice_number: Optional[str] = None
    group_id: Optional[int] = None
    has_pdf_attachment: bool = False
    pdf_filename: Optional[str] = None
    pdf_text_preview: Optional[str] = None
    line_items: Optional[List[Dict[str, Any]]] = None
    pdf_data_base64: Optional[str] = None
    notes: Optional[str] = None


class InvoiceUpdateRequest(BaseModel):
    vendor: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    payment_type: Optional[str] = None
    billing_frequency: Optional[str] = None
    category: Optional[str] = None
    purpose: Optional[str] = None
    invoice_date: Optional[str] = None
    invoice_number: Optional[str] = None
    group_id: Optional[int] = None
    has_pdf_attachment: Optional[bool] = None
    pdf_filename: Optional[str] = None
    pdf_text_preview: Optional[str] = None
    pdf_data_base64: Optional[str] = None
    line_items: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None


class SubscriptionCreateRequest(BaseModel):
    name: str
    vendor: str
    amount: float
    currency: str = "USD"
    billing_frequency: str = "monthly"  # 'monthly', 'yearly', 'weekly', 'quarterly'
    category: str = "Software & SaaS"
    purpose: Optional[str] = None
    status: str = "active"
    group_id: Optional[int] = None
    last_billed_date: Optional[str] = None
    next_renewal_date: Optional[str] = None
    auto_renew: bool = True
    icon_name: Optional[str] = "CreditCard"


class SubscriptionUpdateRequest(BaseModel):
    name: Optional[str] = None
    vendor: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    billing_frequency: Optional[str] = None
    category: Optional[str] = None
    purpose: Optional[str] = None
    status: Optional[str] = None
    group_id: Optional[int] = None
    last_billed_date: Optional[str] = None
    next_renewal_date: Optional[str] = None
    auto_renew: Optional[bool] = None
    icon_name: Optional[str] = None


class ActivityCreateRequest(BaseModel):
    event_type: str
    title: str
    description: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = "USD"
    vendor: Optional[str] = None
    group_id: Optional[int] = None


# =============================================================================
# LIVING UI / AGENT COMPLIANCE ENDPOINTS
# =============================================================================

@router.get("/state")
def get_app_state(db: Session = Depends(get_db)):
    """Get global app state."""
    state = db.query(AppState).first()
    if not state:
        state = AppState()
        db.add(state)
        db.commit()
    return state.to_dict()


@router.put("/state")
def update_app_state(req: StateUpdateRequest, db: Session = Depends(get_db)):
    """Update global app state."""
    state = db.query(AppState).first()
    if not state:
        state = AppState()
        db.add(state)
    state.update_data(req.data)
    db.commit()
    return state.to_dict()


@router.post("/ui-snapshot")
def save_ui_snapshot(req: SnapshotRequest, db: Session = Depends(get_db)):
    """Save UI snapshot for agent inspection."""
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        snapshot = UISnapshot()
        db.add(snapshot)
    snapshot.html_structure = req.htmlStructure
    snapshot.visible_text = req.visibleText
    snapshot.input_values = req.inputValues
    snapshot.component_state = req.componentState
    snapshot.current_view = req.currentView
    snapshot.viewport = req.viewport
    snapshot.timestamp = datetime.utcnow()
    db.commit()
    return {"status": "ok"}


@router.get("/ui-snapshot")
def get_ui_snapshot(db: Session = Depends(get_db)):
    snapshot = db.query(UISnapshot).first()
    if not snapshot:
        return {}
    return snapshot.to_dict()


@router.post("/ui-screenshot")
def save_ui_screenshot(req: ScreenshotRequest, db: Session = Depends(get_db)):
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        screenshot = UIScreenshot()
        db.add(screenshot)
    screenshot.image_data = req.imageData
    screenshot.width = req.width
    screenshot.height = req.height
    screenshot.timestamp = datetime.utcnow()
    db.commit()
    return {"status": "ok"}


@router.get("/ui-screenshot")
def get_ui_screenshot(db: Session = Depends(get_db)):
    screenshot = db.query(UIScreenshot).first()
    if not screenshot:
        return {}
    return screenshot.to_dict()


# =============================================================================
# WORKSPACE GROUPS ENDPOINTS
# =============================================================================

@router.get("/groups")
def list_groups(db: Session = Depends(get_db)):
    """List all workspace groups with summary counts."""
    groups = db.query(TrackerGroup).all()
    out = []
    for g in groups:
        d = g.to_dict()
        d["invoicesCount"] = db.query(InvoiceReceipt).filter(InvoiceReceipt.group_id == g.id).count()
        d["activeSubsCount"] = db.query(Subscription).filter(Subscription.group_id == g.id, Subscription.status == "active").count()
        tot = db.query(func.sum(InvoiceReceipt.amount)).filter(InvoiceReceipt.group_id == g.id).scalar()
        d["totalSpend"] = round(float(tot or 0.0), 2)
        out.append(d)
    return out


@router.get("/groups/{group_id}")
def get_group_detail(group_id: int, db: Session = Depends(get_db)):
    """Get single group by ID."""
    g = db.query(TrackerGroup).filter(TrackerGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    d = g.to_dict()
    d["invoicesCount"] = db.query(InvoiceReceipt).filter(InvoiceReceipt.group_id == g.id).count()
    d["activeSubsCount"] = db.query(Subscription).filter(Subscription.group_id == g.id, Subscription.status == "active").count()
    tot = db.query(func.sum(InvoiceReceipt.amount)).filter(InvoiceReceipt.group_id == g.id).scalar()
    d["totalSpend"] = round(float(tot or 0.0), 2)
    return d


@router.post("/groups")
def create_group(req: GroupCreateRequest, db: Session = Depends(get_db)):
    """Create a new workspace group."""
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required.")

    g = TrackerGroup(
        name=name,
        description=req.description.strip() if req.description else "",
        color=req.color or "#FF9900",
        icon=req.icon or "Layers",
        currency=req.currency or "USD",
    )
    db.add(g)
    db.commit()
    db.refresh(g)

    # If template requested, seed starter records
    if req.template_type in ["cloud", "ai", "marketing"]:
        seed_group_starter_data(db, g, template_type=req.template_type)

    act = ActivityLog(
        event_type="group_created",
        title=f"Workspace Created: {g.name}",
        description=f"Created workspace group '{g.name}' ({g.currency}).",
        group_id=g.id,
        created_at=datetime.utcnow()
    )
    db.add(act)
    db.commit()

    return g.to_dict()


@router.put("/groups/{group_id}")
def update_group(group_id: int, req: GroupUpdateRequest, db: Session = Depends(get_db)):
    """Update workspace group details."""
    g = db.query(TrackerGroup).filter(TrackerGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")

    if req.name is not None and req.name.strip():
        g.name = req.name.strip()
    if req.description is not None:
        g.description = req.description.strip()
    if req.color is not None:
        g.color = req.color
    if req.icon is not None:
        g.icon = req.icon
    if req.currency is not None:
        g.currency = req.currency

    g.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(g)
    return g.to_dict()


@router.delete("/groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db)):
    """Delete a workspace group and its associated records."""
    g = db.query(TrackerGroup).filter(TrackerGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")

    # Clean up associated items
    db.query(InvoiceReceipt).filter(InvoiceReceipt.group_id == group_id).delete()
    db.query(Subscription).filter(Subscription.group_id == group_id).delete()
    db.query(ActivityLog).filter(ActivityLog.group_id == group_id).delete()
    db.delete(g)
    db.commit()
    return {"status": "deleted", "id": group_id}


# =============================================================================
# DASHBOARD STATS ENDPOINT (GROUP-SCOPED)
# =============================================================================

@router.get("/dashboard/stats")
def get_dashboard_stats(
    group_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Compute financial summary, category breakdowns, and recurring spending for active group."""
    now = datetime.utcnow()
    month_start = datetime(now.year, now.month, 1)

    target_group = None
    if group_id:
        target_group = db.query(TrackerGroup).filter(TrackerGroup.id == group_id).first()

    inv_query = db.query(InvoiceReceipt)
    sub_query = db.query(Subscription).filter(Subscription.status == "active")
    act_query = db.query(ActivityLog)

    if target_group:
        inv_query = inv_query.filter(InvoiceReceipt.group_id == target_group.id)
        sub_query = sub_query.filter(Subscription.group_id == target_group.id)
        act_query = act_query.filter(ActivityLog.group_id == target_group.id)

    invoices = inv_query.all()
    subscriptions = sub_query.all()

    # Calculate exact total money spent from all user invoices + elapsed subscriptions spent up to now
    real_inv_total = sum(inv.amount for inv in invoices)
    
    # Subscriptions spent up till now (elapsed periods)
    subs_spent_total = 0.0
    for sub in subscriptions:
        if (sub.status or "active").lower() == "active":
            has_inv = any(
                (getattr(inv, 'subscription_id', None) == sub.id) or
                ((inv.vendor or '').lower() == (sub.vendor or sub.name or '').lower() and getattr(inv, 'payment_type', '') == 'subscription')
                for inv in invoices
            )
            if not has_inv:
                freq = (sub.billing_frequency or "monthly").lower()
                sub_start_yr = sub.created_at.year if sub.created_at else now.year
                sub_start_m = sub.created_at.month if sub.created_at else now.month
                elapsed_months = max(1, (now.year - sub_start_yr) * 12 + (now.month - sub_start_m) + 1)
                
                if freq == "yearly":
                    subs_spent_total += sub.amount
                elif freq == "weekly":
                    subs_spent_total += sub.amount * 4.33 * elapsed_months
                elif freq == "quarterly":
                    quarters_count = max(1, (elapsed_months + 2) // 3)
                    subs_spent_total += sub.amount * quarters_count
                else:
                    subs_spent_total += sub.amount * elapsed_months

    total_spent_all_time = round(real_inv_total + subs_spent_total, 2)
    total_spent_month = round(sum(inv.amount for inv in invoices if inv.invoice_date and inv.invoice_date >= month_start), 2)

    # Monthly subscription burn calculated strictly from active subscriptions
    monthly_burn_rate = 0.0
    for sub in subscriptions:
        if (sub.status or "active").lower() == "active":
            freq = (sub.billing_frequency or "monthly").lower()
            if freq == "yearly":
                monthly_burn_rate += sub.amount / 12.0
            elif freq == "weekly":
                monthly_burn_rate += sub.amount * 4.33
            elif freq == "quarterly":
                monthly_burn_rate += sub.amount / 3.0
            else:
                monthly_burn_rate += sub.amount
    monthly_burn_rate = round(monthly_burn_rate, 2)

    # Category breakdown
    category_totals: Dict[str, Dict[str, Any]] = {}
    for inv in invoices:
        cat = inv.category or "Other"
        if cat not in category_totals:
            category_totals[cat] = {"total": 0.0, "count": 0}
        category_totals[cat]["total"] += inv.amount
        category_totals[cat]["count"] += 1

    category_breakdown = []
    for cat_name, val in sorted(category_totals.items(), key=lambda x: x[1]["total"], reverse=True):
        pct = (val["total"] / total_spent_all_time * 100.0) if total_spent_all_time > 0 else 0.0
        category_breakdown.append({
            "category": cat_name,
            "total": round(val["total"], 2),
            "count": val["count"],
            "percentage": round(pct, 1)
        })

    # Recurring vs One-time
    recurring_total = sum(inv.amount for inv in invoices if inv.payment_type == "subscription")
    onetime_total = sum(inv.amount for inv in invoices if inv.payment_type == "one_time")

    # Upcoming Renewal Calendar strictly taking information from active subscriptions
    upcoming_renewals = []
    active_subs_list = [s for s in subscriptions if (s.status or "active").lower() == "active"]
    for sub in sorted(active_subs_list, key=lambda x: x.next_renewal_date or (now + timedelta(days=30))):
        ren_dt = sub.next_renewal_date or (now + timedelta(days=30))
        days_left = max((ren_dt - now).days, 0)
        upcoming_renewals.append({
            "id": sub.id,
            "name": sub.name,
            "vendor": sub.vendor,
            "amount": sub.amount,
            "currency": sub.currency,
            "billingFrequency": sub.billing_frequency,
            "category": sub.category,
            "purpose": sub.purpose,
            "nextRenewalDate": sub.next_renewal_date.isoformat() if sub.next_renewal_date else None,
            "daysLeft": days_left,
            "iconName": sub.icon_name,
            "status": sub.status,
        })

    # Curated high-contrast palette for distinct service & vendor rendering
    DISTINCT_PALETTE = [
        "#FF9900", "#00A67E", "#635BFF", "#3B82F6", "#F24E1E",
        "#7952DE", "#1A73E8", "#8B5CF6", "#D97706", "#EC407A",
        "#10B981", "#3ECF8E", "#06B6D4", "#F59E0B", "#8E24AA",
        "#43A047", "#EF4444", "#00ACC1", "#5E6AD2", "#E11D48",
        "#2563EB", "#D946EF", "#14B8A6", "#F97316", "#64748B",
    ]

    SERVICE_COLORS = {
        "Amazon Web Services": "#FF9900",
        "AWS": "#FF9900",
        "Amazon RDS": "#43A047",
        "Amazon ElastiCache": "#FB8C00",
        "Amazon DynamoDB": "#8E24AA",
        "Other Services": "#EC407A",
        "OpenAI": "#00A67E",
        "Cursor AI": "#3B82F6",
        "Anthropic": "#D97706",
        "Midjourney": "#8B5CF6",
        "GitHub": "#7952DE",
        "Google Workspace": "#1A73E8",
        "Google": "#1A73E8",
        "Google One": "#1A73E8",
        "Figma": "#F24E1E",
        "Stripe": "#635BFF",
        "Vercel": "#000000",
        "Supabase": "#3ECF8E",
        "Notion": "#2F3437",
        "Linear": "#5E6AD2",
        "Slack": "#E01E5A",
        "Datadog": "#632CA6",
    }

    def get_color_for_vendor(v_name: str, index: int = 0) -> str:
        if v_name in SERVICE_COLORS:
            return SERVICE_COLORS[v_name]
        h = sum(ord(c) * (31 ** i) for i, c in enumerate(v_name[:10]))
        return DISTINCT_PALETTE[(abs(h) + index) % len(DISTINCT_PALETTE)]

    # 1. Extract active subscriptions monthly rate by vendor
    active_subs_totals: Dict[str, float] = {}
    for s in subscriptions:
        if (s.status or "active").lower() == "active":
            v = s.vendor or s.name
            freq = (s.billing_frequency or "monthly").lower()
            amt = s.amount
            if freq == "yearly":
                amt = round(s.amount / 12.0, 2)
            elif freq == "weekly":
                amt = round(s.amount * 4.33, 2)
            elif freq == "quarterly":
                amt = round(s.amount / 3.0, 2)
            active_subs_totals[v] = round(active_subs_totals.get(v, 0.0) + amt, 2)

    # 2. Extract monthly spending strictly from actual user invoices
    monthly_spending = []
    month_names = ["Mar", "Apr", "May", "Jun", "Jul", "Aug"]
    for idx, m_name in enumerate(month_names):
        m_vendor_totals: Dict[str, float] = {}

        # Add invoices & receipts for this month
        month_invoices = [inv for inv in invoices if inv.invoice_date and inv.invoice_date.strftime("%b") == m_name]
        for inv in month_invoices:
            v = inv.vendor or "Other Services"
            m_vendor_totals[v] = round(m_vendor_totals.get(v, 0.0) + inv.amount, 2)

        # For current month (August), if there are active subscriptions, include active recurring subscriptions
        if m_name == "Aug" and active_subs_totals:
            for v_name, v_amt in active_subs_totals.items():
                if v_name not in m_vendor_totals:
                    m_vendor_totals[v_name] = v_amt

        m_tot = round(sum(m_vendor_totals.values()), 2)
        m_segments = []
        for s_idx, (v_name, v_amt) in enumerate(sorted(m_vendor_totals.items(), key=lambda x: x[1], reverse=True)):
            pct = round((v_amt / m_tot * 100.0), 1) if m_tot > 0 else 0.0
            c = get_color_for_vendor(v_name, s_idx)
            m_segments.append({
                "service": v_name,
                "category": v_name,
                "amount": round(v_amt, 2),
                "percentage": pct,
                "color": c
            })

        monthly_spending.append({
            "month": f"{m_name} 2026",
            "shortMonth": m_name,
            "total": m_tot,
            "segments": m_segments
        })

    # The current month breakdown
    aug_month = monthly_spending[-1]
    service_breakdown = aug_month["segments"]
    effective_mtd = aug_month["total"]

    top_service = service_breakdown[0]["service"] if service_breakdown else "None"

    return {
        "totalSpentAllTime": round(total_spent_all_time, 2),
        "totalSpentMonth": round(total_spent_month, 2),
        "monthToDateSpend": round(effective_mtd, 2),
        "monthlyRecurringBurn": round(monthly_burn_rate, 2),
        "topService": top_service,
        "activeSubscriptionsCount": len([s for s in subscriptions if (s.status or "active").lower() == "active"]),
        "totalInvoicesCount": len(invoices),
        "recurringTotal": round(recurring_total, 2),
        "onetimeTotal": round(onetime_total, 2),
        "categoryBreakdown": category_breakdown,
        "serviceBreakdown": service_breakdown,
        "monthlySpending": monthly_spending,
        "upcomingRenewals": upcoming_renewals[:6],
        "activeGroupName": target_group.name if target_group else "All Workspaces",
        "activeGroupId": target_group.id if target_group else None,
        "activeCurrency": target_group.currency if target_group else "USD",
        "lastUpdated": now.isoformat(),
    }


# =============================================================================
# YEARLY SPEND HISTORY ENDPOINT (GROUP-SCOPED)
# =============================================================================

@router.get("/yearly-history")
def get_yearly_history(
    group_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Retrieve multi-year financial history derived strictly from active group's real invoices."""
    groups = db.query(TrackerGroup).all()
    target_group = None
    if group_id:
        target_group = db.query(TrackerGroup).filter(TrackerGroup.id == group_id).first()
    elif groups:
        target_group = groups[0]
    
    invoices_query = db.query(InvoiceReceipt)
    subs_query = db.query(Subscription).filter(Subscription.status == "active")
    if target_group:
        invoices_query = invoices_query.filter(InvoiceReceipt.group_id == target_group.id)
        subs_query = subs_query.filter(Subscription.group_id == target_group.id)
    invoices = invoices_query.all()
    subscriptions = subs_query.all()

    # 1. Group real invoices by year
    real_years_data: Dict[int, Dict[str, Any]] = {}
    for inv in invoices:
        y = inv.invoice_date.year if inv.invoice_date else 2026
        if y not in real_years_data:
            real_years_data[y] = {
                "invoices": [],
                "total": 0.0,
                "months": {},
                "vendors": {},
                "categories": {},
                "quarters": {"Q1": 0.0, "Q2": 0.0, "Q3": 0.0, "Q4": 0.0}
            }
        real_years_data[y]["invoices"].append(inv)
        real_years_data[y]["total"] += inv.amount
        
        m_key = inv.invoice_date.strftime("%b") if inv.invoice_date else "Aug"
        real_years_data[y]["months"][m_key] = round(real_years_data[y]["months"].get(m_key, 0.0) + inv.amount, 2)
        
        v = inv.vendor or "Other Services"
        real_years_data[y]["vendors"][v] = round(real_years_data[y]["vendors"].get(v, 0.0) + inv.amount, 2)
        
        c = inv.category or "Software & SaaS"
        real_years_data[y]["categories"][c] = round(real_years_data[y]["categories"].get(c, 0.0) + inv.amount, 2)
        
        m = inv.invoice_date.month if inv.invoice_date else 8
        if m in [1, 2, 3]:
            real_years_data[y]["quarters"]["Q1"] = round(real_years_data[y]["quarters"]["Q1"] + inv.amount, 2)
        elif m in [4, 5, 6]:
            real_years_data[y]["quarters"]["Q2"] = round(real_years_data[y]["quarters"]["Q2"] + inv.amount, 2)
        elif m in [7, 8, 9]:
            real_years_data[y]["quarters"]["Q3"] = round(real_years_data[y]["quarters"]["Q3"] + inv.amount, 2)
        else:
            real_years_data[y]["quarters"]["Q4"] = round(real_years_data[y]["quarters"]["Q4"] + inv.amount, 2)

    # 2. Add active subscriptions for tracked years (strictly spent up till now, no future costs)
    current_now = datetime.utcnow()
    current_year = current_now.year
    current_month = current_now.month

    standard_years = [2026, 2025, 2024, 2023]
    for yr in standard_years:
        if yr not in real_years_data:
            real_years_data[yr] = {
                "invoices": [],
                "total": 0.0,
                "months": {},
                "vendors": {},
                "categories": {},
                "quarters": {"Q1": 0.0, "Q2": 0.0, "Q3": 0.0, "Q4": 0.0}
            }
        
        for sub in subscriptions:
            sub_start_yr = sub.created_at.year if sub.created_at else 2026
            sub_start_month = sub.created_at.month if sub.created_at else 8
            if yr < sub_start_yr:
                continue
            
            # Check if this sub already has an invoice in this year
            has_inv = any(
                (getattr(inv, 'subscription_id', None) == sub.id) or
                ((inv.vendor or '').lower() == (sub.vendor or sub.name or '').lower() and getattr(inv, 'payment_type', '') == 'subscription')
                for inv in real_years_data[yr]["invoices"]
            )
            if not has_inv:
                # Calculate elapsed months in this year up till now (no future projection)
                if yr == current_year:
                    start_m = sub_start_month if sub_start_yr == current_year else 1
                    elapsed_m = max(1, current_month - start_m + 1)
                elif yr < current_year:
                    start_m = sub_start_month if sub_start_yr == yr else 1
                    elapsed_m = max(1, 12 - start_m + 1)
                else:
                    elapsed_m = 0

                if elapsed_m <= 0:
                    continue

                freq = (sub.billing_frequency or 'monthly').lower()
                if freq == 'yearly':
                    spent_upto_now = sub.amount
                elif freq == 'weekly':
                    spent_upto_now = sub.amount * 4.33 * elapsed_m
                elif freq == 'quarterly':
                    quarters_count = max(1, (elapsed_m + 2) // 3)
                    spent_upto_now = sub.amount * quarters_count
                else:
                    spent_upto_now = sub.amount * elapsed_m
                
                spent_upto_now = round(spent_upto_now, 2)
                real_years_data[yr]["total"] += spent_upto_now
                v = sub.vendor or sub.name or "Other Services"
                c = sub.category or "Software & SaaS"
                real_years_data[yr]["vendors"][v] = round(real_years_data[yr]["vendors"].get(v, 0.0) + spent_upto_now, 2)
                real_years_data[yr]["categories"][c] = round(real_years_data[yr]["categories"].get(c, 0.0) + spent_upto_now, 2)
                
                # Attribute to elapsed quarters (e.g. Q3 for August)
                target_q = "Q3" if current_month in [7, 8, 9] else ("Q1" if current_month in [1, 2, 3] else ("Q2" if current_month in [4, 5, 6] else "Q4"))
                real_years_data[yr]["quarters"][target_q] = round(real_years_data[yr]["quarters"].get(target_q, 0.0) + spent_upto_now, 2)

    # Standard years to inspect (2026, 2025, 2024, 2023, plus any other years present in data)
    all_years_set = {2026, 2025, 2024, 2023}.union(set(real_years_data.keys()))
    sorted_years = sorted(list(all_years_set), reverse=True)

    summaries = []
    for y in sorted_years:
        y_data = real_years_data.get(y)
        if y_data and y_data["total"] > 0:
            y_tot = round(y_data["total"], 2)
            y_cnt = len(y_data["invoices"])
            y_top_v = max(y_data["vendors"].items(), key=lambda x: x[1])[0] if y_data["vendors"] else "None"
            y_q = y_data["quarters"]
            y_v = y_data["vendors"]
            y_c = y_data["categories"]
            m_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            y_m = [{"month": m, "total": y_data["months"].get(m, 0.0)} for m in m_names]
        else:
            y_tot = 0.0
            y_cnt = 0
            y_top_v = "None"
            y_q = {"Q1": 0.0, "Q2": 0.0, "Q3": 0.0, "Q4": 0.0}
            y_v = {}
            y_c = {}
            m_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            y_m = [{"month": m, "total": 0.0} for m in m_names]

        # Calculate YoY growth vs previous year if both have spending
        prev_year_data = real_years_data.get(y - 1)
        prev_tot = prev_year_data["total"] if prev_year_data else 0.0
        growth = 0.0
        if prev_tot > 0 and y_tot > 0:
            growth = round(((y_tot - prev_tot) / prev_tot) * 100.0, 1)

        summaries.append({
            "year": y,
            "totalSpend": y_tot,
            "invoiceCount": y_cnt,
            "averageMonthly": round(y_tot / 12.0, 2) if y_tot > 0 else 0.0,
            "topVendor": y_top_v,
            "yoyGrowthPct": growth,
            "quarterlySpend": y_q,
            "categoryBreakdown": y_c,
            "vendorBreakdown": y_v,
            "monthlyTotals": y_m
        })

    grand_total = sum(s["totalSpend"] for s in summaries)
    total_invs = sum(s["invoiceCount"] for s in summaries)

    return {
        "allYears": sorted_years,
        "yearlySummaries": summaries,
        "grandTotalAllYears": round(grand_total, 2),
        "totalInvoicesAllYears": total_invs
    }


# =============================================================================
# INVOICE & RECEIPT CRUD ENDPOINTS
# =============================================================================

@router.get("/invoices")
def list_invoices(
    category: Optional[str] = None,
    payment_type: Optional[str] = None,
    vendor: Optional[str] = None,
    search: Optional[str] = None,
    group_id: Optional[int] = None,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Retrieve filterable invoice/receipt records for the active group."""
    query = db.query(InvoiceReceipt)

    if group_id:
        target_group = db.query(TrackerGroup).filter(TrackerGroup.id == group_id).first()
        if target_group:
            query = query.filter(InvoiceReceipt.group_id == target_group.id)
        else:
            query = query.filter(InvoiceReceipt.group_id == group_id)

    if category and category != "all":
        query = query.filter(InvoiceReceipt.category == category)
    if payment_type and payment_type != "all":
        query = query.filter(InvoiceReceipt.payment_type == payment_type)
    if vendor:
        query = query.filter(InvoiceReceipt.vendor.ilike(f"%{vendor}%"))
    if search:
        s = f"%{search}%"
        query = query.filter(
            (InvoiceReceipt.vendor.ilike(s)) |
            (InvoiceReceipt.purpose.ilike(s)) |
            (InvoiceReceipt.notes.ilike(s)) |
            (InvoiceReceipt.invoice_number.ilike(s))
        )

    results = query.order_by(desc(InvoiceReceipt.invoice_date)).limit(limit).all()
    return [inv.to_dict() for inv in results]


@router.get("/invoices/{invoice_id}")
def get_invoice_detail(invoice_id: int, db: Session = Depends(get_db)):
    """Get single invoice with receipt details."""
    inv = db.query(InvoiceReceipt).filter(InvoiceReceipt.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv.to_dict()


@router.post("/invoices")
def create_invoice(req: InvoiceCreateRequest, db: Session = Depends(get_db)):
    """Direct manual user entry of an invoice or receipt."""
    if not req.vendor.strip():
        raise HTTPException(status_code=400, detail="Vendor name is required.")
    if req.amount is None or req.amount < 0:
        raise HTTPException(status_code=400, detail="Please provide a valid amount.")

    inv_date = datetime.utcnow()
    if req.invoice_date:
        try:
            inv_date = datetime.fromisoformat(req.invoice_date.replace("Z", "+00:00"))
        except Exception:
            try:
                inv_date = datetime.strptime(req.invoice_date, "%Y-%m-%d")
            except Exception:
                inv_date = datetime.utcnow()

    inv_num = req.invoice_number.strip() if req.invoice_number else f"INV-{int(datetime.utcnow().timestamp())}"

    # Auto-resolve group
    grp_id = req.group_id
    if not grp_id:
        first_grp = db.query(TrackerGroup).first()
        grp_id = first_grp.id if first_grp else None

    new_inv = InvoiceReceipt(
        vendor=req.vendor.strip(),
        amount=round(float(req.amount), 2),
        currency=req.currency or "USD",
        payment_type=req.payment_type or "one_time",
        billing_frequency=req.billing_frequency or "none",
        category=req.category or "Software & SaaS",
        purpose=req.purpose.strip() if req.purpose else "",
        invoice_date=inv_date,
        invoice_number=inv_num,
        group_id=grp_id,
        has_pdf_attachment=req.has_pdf_attachment or bool(req.pdf_filename) or bool(req.pdf_data_base64),
        pdf_filename=req.pdf_filename or (f"{req.vendor.replace(' ', '_')}_Invoice.pdf" if req.pdf_data_base64 else None),
        pdf_text_preview=req.pdf_text_preview,
        pdf_data_base64=req.pdf_data_base64,
        line_items=req.line_items or [{"description": req.vendor, "quantity": 1, "unitPrice": req.amount, "total": req.amount}],
        confidence_score=1.0,
        is_verified=True,
        notes=req.notes.strip() if req.notes else "",
        created_at=datetime.utcnow(),
    )
    db.add(new_inv)

    # Link to existing subscription only if one already exists
    sub = db.query(Subscription).filter(
        Subscription.vendor.ilike(f"%{new_inv.vendor}%"),
        Subscription.group_id == grp_id
    ).first()
    if sub:
        new_inv.subscription_id = sub.id

    # Ingest event into Live Ingestion Feed
    act = ActivityLog(
        event_type="invoice_ingested" if new_inv.has_pdf_attachment else "invoice_created",
        title=f"Invoice Received: {new_inv.vendor}",
        description=f"Processed {new_inv.currency} {new_inv.amount:.2f} invoice #{new_inv.invoice_number or 'N/A'} for {new_inv.category}.",
        amount=new_inv.amount,
        currency=new_inv.currency,
        vendor=new_inv.vendor,
        group_id=grp_id,
        created_at=datetime.utcnow()
    )
    db.add(act)

    db.commit()
    db.refresh(new_inv)

    return new_inv.to_dict()


@router.put("/invoices/{invoice_id}")
def update_invoice(invoice_id: int, req: InvoiceUpdateRequest, db: Session = Depends(get_db)):
    """Update existing invoice/receipt record."""
    inv = db.query(InvoiceReceipt).filter(InvoiceReceipt.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if req.vendor is not None and req.vendor.strip():
        inv.vendor = req.vendor.strip()
    if req.amount is not None:
        inv.amount = round(float(req.amount), 2)
    if req.currency is not None:
        inv.currency = req.currency
    if req.payment_type is not None:
        inv.payment_type = req.payment_type
    if req.billing_frequency is not None:
        inv.billing_frequency = req.billing_frequency
    if req.category is not None:
        inv.category = req.category
    if req.purpose is not None:
        inv.purpose = req.purpose.strip()
    if req.invoice_number is not None:
        inv.invoice_number = req.invoice_number.strip()
    if req.notes is not None:
        inv.notes = req.notes.strip()
    if req.line_items is not None:
        inv.line_items = req.line_items
    if req.group_id is not None:
        inv.group_id = req.group_id
    if req.has_pdf_attachment is not None:
        inv.has_pdf_attachment = req.has_pdf_attachment
    if req.pdf_filename is not None:
        inv.pdf_filename = req.pdf_filename
    if req.pdf_text_preview is not None:
        inv.pdf_text_preview = req.pdf_text_preview
    if req.pdf_data_base64 is not None:
        inv.pdf_data_base64 = req.pdf_data_base64
        inv.has_pdf_attachment = True

    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return inv.to_dict()


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: int, db: Session = Depends(get_db)):
    """Delete an invoice."""
    inv = db.query(InvoiceReceipt).filter(InvoiceReceipt.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    act = ActivityLog(
        event_type="invoice_deleted",
        title=f"Invoice Removed: {inv.vendor}",
        description=f"Deleted {inv.currency} {inv.amount:.2f} invoice #{inv.invoice_number or 'N/A'}.",
        amount=inv.amount,
        currency=inv.currency,
        vendor=inv.vendor,
        group_id=inv.group_id,
        created_at=datetime.utcnow()
    )
    db.add(act)

    db.delete(inv)
    db.commit()
    return {"status": "deleted", "id": invoice_id}


# =============================================================================
# SUBSCRIPTIONS CRUD ENDPOINTS
# =============================================================================

@router.get("/subscriptions")
def list_subscriptions(
    status: Optional[str] = None,
    category: Optional[str] = None,
    group_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """List all recurring subscriptions for active group."""
    query = db.query(Subscription)
    if group_id:
        target_group = db.query(TrackerGroup).filter(TrackerGroup.id == group_id).first()
        if target_group:
            query = query.filter(Subscription.group_id == target_group.id)
        else:
            query = query.filter(Subscription.group_id == group_id)

    if status and status != "all":
        query = query.filter(Subscription.status == status)
    if category and category != "all":
        query = query.filter(Subscription.category == category)
    
    subs = query.order_by(Subscription.next_renewal_date).all()
    return [s.to_dict() for s in subs]


@router.post("/subscriptions")
def create_subscription(req: SubscriptionCreateRequest, db: Session = Depends(get_db)):
    """Add a new recurring subscription directly."""
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Subscription name is required.")
    if req.amount is None or req.amount < 0:
        raise HTTPException(status_code=400, detail="Please provide a valid subscription amount.")

    now = datetime.utcnow()
    ren_date = now + timedelta(days=30)
    if req.next_renewal_date:
        try:
            ren_date = datetime.fromisoformat(req.next_renewal_date.replace("Z", "+00:00"))
        except Exception:
            try:
                ren_date = datetime.strptime(req.next_renewal_date, "%Y-%m-%d")
            except Exception:
                ren_date = now + timedelta(days=30)

    # Auto-resolve group
    grp_id = req.group_id
    if not grp_id:
        first_grp = db.query(TrackerGroup).first()
        grp_id = first_grp.id if first_grp else None

    sub = Subscription(
        name=req.name.strip(),
        vendor=req.vendor.strip() if req.vendor else req.name.strip(),
        amount=round(float(req.amount), 2),
        currency=req.currency or "USD",
        billing_frequency=req.billing_frequency or "monthly",
        category=req.category or "Software & SaaS",
        purpose=req.purpose.strip() if req.purpose else "",
        status=req.status or "active",
        group_id=grp_id,
        last_billed_date=now,
        next_renewal_date=ren_date,
        auto_renew=req.auto_renew,
        icon_name=req.icon_name or "CreditCard",
        total_spent_to_date=round(float(req.amount), 2),
        created_at=datetime.utcnow(),
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    # Activity log
    act = ActivityLog(
        event_type="subscription_created",
        title=f"New Subscription: {sub.name}",
        description=f"Created recurring subscription of {sub.currency} {sub.amount:.2f}/{sub.billing_frequency}.",
        amount=sub.amount,
        currency=sub.currency,
        vendor=sub.vendor,
        group_id=grp_id,
        created_at=datetime.utcnow()
    )
    db.add(act)
    db.commit()

    return sub.to_dict()


@router.patch("/subscriptions/{sub_id}")
def update_subscription(
    sub_id: int,
    req: SubscriptionUpdateRequest,
    db: Session = Depends(get_db)
):
    """Update subscription details."""
    sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    if req.name is not None and req.name.strip():
        sub.name = req.name.strip()
    if req.vendor is not None and req.vendor.strip():
        sub.vendor = req.vendor.strip()
    if req.amount is not None:
        sub.amount = round(float(req.amount), 2)
    if req.currency is not None:
        sub.currency = req.currency
    if req.billing_frequency is not None:
        sub.billing_frequency = req.billing_frequency
    if req.category is not None:
        sub.category = req.category
    if req.purpose is not None:
        sub.purpose = req.purpose.strip()
    if req.status is not None:
        sub.status = req.status
    if req.group_id is not None:
        sub.group_id = req.group_id
    if req.auto_renew is not None:
        sub.auto_renew = req.auto_renew
    if req.icon_name is not None:
        sub.icon_name = req.icon_name
    if req.next_renewal_date:
        try:
            sub.next_renewal_date = datetime.fromisoformat(req.next_renewal_date.replace("Z", "+00:00"))
        except Exception:
            try:
                sub.next_renewal_date = datetime.strptime(req.next_renewal_date, "%Y-%m-%d")
            except Exception:
                pass

    sub.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(sub)
    return sub.to_dict()


@router.patch("/subscriptions/{sub_id}/toggle-status")
def toggle_subscription_status(sub_id: int, db: Session = Depends(get_db)):
    """Toggle subscription status between active and paused."""
    sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    sub.status = "paused" if sub.status == "active" else "active"
    sub.updated_at = datetime.utcnow()

    act = ActivityLog(
        event_type=f"subscription_{sub.status}",
        title=f"Subscription {sub.status.capitalize()}: {sub.name}",
        description=f"Subscription for {sub.vendor} ({sub.currency} {sub.amount:.2f}/{sub.billing_frequency}) is now {sub.status}.",
        amount=sub.amount,
        currency=sub.currency,
        vendor=sub.vendor,
        group_id=sub.group_id,
        created_at=datetime.utcnow()
    )
    db.add(act)

    db.commit()
    db.refresh(sub)
    return sub.to_dict()


@router.delete("/subscriptions/{sub_id}")
def delete_subscription(sub_id: int, db: Session = Depends(get_db)):
    """Delete a subscription."""
    sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    act = ActivityLog(
        event_type="subscription_deleted",
        title=f"Subscription Cancelled: {sub.name}",
        description=f"Removed recurring subscription of {sub.currency} {sub.amount:.2f}/{sub.billing_frequency} for {sub.vendor}.",
        amount=sub.amount,
        currency=sub.currency,
        vendor=sub.vendor,
        group_id=sub.group_id,
        created_at=datetime.utcnow()
    )
    db.add(act)

    db.delete(sub)
    db.commit()
    return {"status": "deleted", "id": sub_id}


# =============================================================================
# ACTIVITY FEED ENDPOINTS
# =============================================================================

@router.get("/activity")
def get_activity_feed(group_id: Optional[int] = None, limit: int = 50, db: Session = Depends(get_db)):
    """Get activity audit stream for active group."""
    query = db.query(ActivityLog)
    if group_id:
        query = query.filter(ActivityLog.group_id == group_id)
    logs = query.order_by(desc(ActivityLog.created_at)).limit(limit).all()
    return [l.to_dict() for l in logs]


@router.post("/activity")
def create_activity(req: ActivityCreateRequest, db: Session = Depends(get_db)):
    """Log an activity event."""
    act = ActivityLog(
        event_type=req.event_type,
        title=req.title,
        description=req.description or "",
        amount=req.amount,
        currency=req.currency or "USD",
        vendor=req.vendor,
        group_id=req.group_id,
        created_at=datetime.utcnow(),
    )
    db.add(act)
    db.commit()
    db.refresh(act)
    return act.to_dict()

import base64

def generate_minimal_pdf_bytes(vendor: str, invoice_num: str, amount: float, currency: str, date_str: str, category: str) -> bytes:
    """Generate a clean, valid PDF binary document for downloading."""
    content_stream = f"""BT
/F1 18 Tf
50 720 Td
({vendor.upper()} - INVOICE STATEMENT) Tj
/F1 12 Tf
0 -30 Td
(Invoice Number: {invoice_num}) Tj
0 -20 Td
(Date: {date_str}) Tj
0 -20 Td
(Category: {category}) Tj
0 -20 Td
(Status: PAID / VERIFIED) Tj
0 -30 Td
(-------------------------------------------------------) Tj
0 -30 Td
/F1 14 Tf
(TOTAL AMOUNT BILLED: ${amount:.2f} {currency}) Tj
0 -40 Td
/F1 10 Tf
(Thank you for your business. Generated by Living UI Invoice Tracker.) Tj
ET"""
    stream_bytes = content_stream.encode('latin1')
    stream_len = len(stream_bytes)

    pdf_text = f"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length {stream_len} >>
stream
{content_stream}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000227 00000 n 
0000000300 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
380
%%EOF
"""
    return pdf_text.encode('latin1')


@router.get("/invoices/{invoice_id}/download-pdf")
def download_invoice_pdf(invoice_id: int, db: Session = Depends(get_db)):
    """Download the attached PDF document for an invoice."""
    inv = db.query(InvoiceReceipt).filter(InvoiceReceipt.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    filename = inv.pdf_filename or f"{inv.vendor.replace(' ', '_')}_Invoice_{inv.invoice_number or inv.id}.pdf"
    if not filename.lower().endswith(".pdf"):
        filename = f"{filename}.pdf"

    if inv.pdf_data_base64 and "," in inv.pdf_data_base64:
        try:
            b64_data = inv.pdf_data_base64.split(",", 1)[1]
            pdf_bytes = base64.b64decode(b64_data)
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'}
            )
        except Exception:
            pass
    elif inv.pdf_data_base64:
        try:
            pdf_bytes = base64.b64decode(inv.pdf_data_base64)
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'}
            )
        except Exception:
            pass

    # Generate standard valid PDF document
    date_formatted = inv.invoice_date.strftime("%Y-%m-%d") if inv.invoice_date else "2026-08-01"
    pdf_bytes = generate_minimal_pdf_bytes(
        vendor=inv.vendor,
        invoice_num=inv.invoice_number or f"INV-{inv.id}",
        amount=inv.amount,
        currency=inv.currency or "USD",
        date_str=date_formatted,
        category=inv.category or "Software & SaaS"
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.post("/email/simulate")
def simulate_email(payload: Dict[str, Any] = Body(...), db: Session = Depends(get_db)):
    """Simulate an incoming email bill with neural OCR parsing."""
    preset = payload.get("preset", "aws")
    now = datetime.utcnow()
    
    presets_map = {
        "aws": {
            "vendor": "Amazon Web Services",
            "amount": 248.50,
            "currency": "USD",
            "payment_type": "subscription",
            "billing_frequency": "monthly",
            "category": "Cloud & Infrastructure",
            "purpose": "Monthly AWS cloud computing & S3 storage bill",
            "has_pdf_attachment": True,
            "pdf_filename": "AWS_Tax_Invoice_Aug2026.pdf",
            "confidence_score": 0.98,
        },
        "openai": {
            "vendor": "OpenAI",
            "amount": 42.00,
            "currency": "USD",
            "payment_type": "subscription",
            "billing_frequency": "monthly",
            "category": "AI & Developer Tools",
            "purpose": "ChatGPT Plus & GPT-4o API developer credit tier",
            "has_pdf_attachment": True,
            "pdf_filename": "OpenAI_Invoice_Aug2026.pdf",
            "confidence_score": 0.99,
        },
        "figma": {
            "vendor": "Figma",
            "amount": 15.00,
            "currency": "USD",
            "payment_type": "subscription",
            "billing_frequency": "monthly",
            "category": "Design & Collaboration",
            "purpose": "Figma Pro design seat renewal",
            "has_pdf_attachment": True,
            "pdf_filename": "Figma_Receipt_Aug2026.pdf",
            "confidence_score": 0.97,
        },
    }
    
    p = presets_map.get(preset, presets_map["aws"])
    
    # Create invoice
    inv = InvoiceReceipt(
        vendor=p["vendor"],
        amount=p["amount"],
        currency=p["currency"],
        payment_type=p["payment_type"],
        billing_frequency=p["billing_frequency"],
        category=p["category"],
        purpose=p["purpose"],
        invoice_date=now,
        invoice_number=f"INV-{p['vendor'][:3].upper()}-{int(now.timestamp())}",
        has_pdf_attachment=p["has_pdf_attachment"],
        pdf_filename=p["pdf_filename"],
        confidence_score=p["confidence_score"],
    )
    db.add(inv)
    db.flush()

    # Create/update subscription if subscription type
    sub = None
    if p["payment_type"] == "subscription":
        sub = db.query(Subscription).filter(Subscription.vendor.ilike(f"%{p['vendor']}%")).first()
        if not sub:
            sub = Subscription(
                name=p["vendor"],
                vendor=p["vendor"],
                category=p["category"],
                amount=p["amount"],
                currency=p["currency"],
                billing_frequency=p["billing_frequency"],
                status="active",
                next_renewal_date=now + timedelta(days=30),
                auto_renew=True,
            )
            db.add(sub)
            db.flush()
        inv.subscription_id = sub.id

    # Log activity
    log = ActivityLog(
        event_type="email_simulated",
        title=f"Simulated Bill: {p['vendor']}",
        description=f"Simulated email bill received from {p['vendor']} for ${p['amount']:.2f}",
        vendor=p["vendor"],
        amount=p["amount"],
    )
    db.add(log)
    db.commit()

    return {
        "status": "success",
        "isInvoice": True,
        "invoice": inv.to_dict(),
        "subscription": sub.to_dict() if sub else None,
    }


@router.post("/action")
def execute_agent_action(payload: Dict[str, Any] = Body(...), db: Session = Depends(get_db)):
    """Agent compliance action endpoint."""
    action = payload.get("action", "")
    data = payload.get("payload", {})
    if action == "sync_email":
        return {"status": "synced", "action": action, "data": data}
    return {"status": "ok", "action": action, "data": data}

