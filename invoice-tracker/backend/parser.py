"""
Intelligent Email & PDF Receipt / Invoice Parser & Classifier
"""

import re
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple, List

# Known merchant dictionary with categories, default frequencies, and purpose mappings
MERCHANT_PROFILES = {
    "openai": {
        "name": "OpenAI",
        "category": "AI & Developer Tools",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "ChatGPT Plus & API usage credits for AI development",
        "icon": "bot",
    },
    "aws": {
        "name": "Amazon Web Services",
        "category": "Cloud & Infrastructure",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Cloud compute EC2, S3 storage, and database hosting",
        "icon": "cloud",
    },
    "figma": {
        "name": "Figma",
        "category": "Design & Collaboration",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Collaborative UI/UX design & prototyping platform",
        "icon": "figma",
    },
    "netflix": {
        "name": "Netflix",
        "category": "Entertainment",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "4K Ultra HD streaming entertainment subscription",
        "icon": "tv",
    },
    "github": {
        "name": "GitHub",
        "category": "Developer Tools",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "GitHub Copilot & Team code repository hosting",
        "icon": "github",
    },
    "google": {
        "name": "Google Workspace",
        "category": "Productivity & Office",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Custom domain business email & cloud drive storage",
        "icon": "mail",
    },
    "adobe": {
        "name": "Adobe Creative Cloud",
        "category": "Design & Media",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Photoshop, Illustrator, and Creative Cloud all-apps suite",
        "icon": "palette",
    },
    "spotify": {
        "name": "Spotify",
        "category": "Entertainment",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Premium music streaming & podcast subscription",
        "icon": "music",
    },
    "slack": {
        "name": "Slack Technologies",
        "category": "Productivity & Office",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Team messaging and collaboration workspace",
        "icon": "message-square",
    },
    "vercel": {
        "name": "Vercel",
        "category": "Cloud & Infrastructure",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Frontend deployment, edge hosting, and serverless functions",
        "icon": "zap",
    },
    "uber": {
        "name": "Uber",
        "category": "Travel & Transport",
        "default_type": "one_time",
        "default_freq": "none",
        "purpose": "On-demand city transit / ride receipt",
        "icon": "car",
    },
    "apple": {
        "name": "Apple Services",
        "category": "Software & Services",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "iCloud+ storage and App Store subscriptions",
        "icon": "smartphone",
    },
    "notion": {
        "name": "Notion Labs",
        "category": "Productivity & Office",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Team workspace, wiki, and project documentation",
        "icon": "file-text",
    },
    "anthropic": {
        "name": "Anthropic Claude",
        "category": "AI & Developer Tools",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Claude Pro & API inference tokens for LLM apps",
        "icon": "sparkles",
    },
    "digitalocean": {
        "name": "DigitalOcean",
        "category": "Cloud & Infrastructure",
        "default_type": "subscription",
        "default_freq": "monthly",
        "purpose": "Droplet virtual servers and managed databases",
        "icon": "server",
    },
}

INVOICE_KEYWORDS = [
    "invoice", "receipt", "bill", "billing", "payment", "charged", "order confirmation",
    "subscription", "renewed", "membership", "tax invoice", "amount due", "total paid",
    "statement", "transaction", "subtotal", "payment received", "auto-renew"
]

NON_INVOICE_KEYWORDS = [
    "newsletter", "digest", "weekly update", "password reset", "verify your email",
    "security alert", "friend request", "invitation", "promotional offer", "flash sale", "marketing"
]


def is_invoice_email(subject: str, sender: str, body: str, has_attachment: bool = False, filename: str = "") -> Tuple[bool, float, str]:
    """
    Decides if an incoming email is an invoice or receipt.
    Returns: (is_invoice, confidence_score, reason)
    """
    text = f"{subject} {sender} {body} {filename}".lower()
    
    # Check negative triggers first if no strong financial words
    is_promo = any(k in text for k in ["unsubscribe", "privacy policy", "sale ends soon", "promotional"])
    
    score = 0.0
    reasons = []

    # Check invoice keywords
    matching_keywords = [k for k in INVOICE_KEYWORDS if k in text]
    if matching_keywords:
        score += min(len(matching_keywords) * 0.2, 0.6)
        reasons.append(f"Matched invoice keywords: {', '.join(matching_keywords[:3])}")

    # Check for monetary amounts like $XX.XX
    money_matches = re.findall(r'(?:[\$\€\£]|USD|EUR|GBP)\s*(\d{1,5}(?:\.\d{2})?)|\b(\d{1,5}\.\d{2})\s*(?:USD|EUR|GBP)?', text)
    if money_matches:
        score += 0.3
        reasons.append("Detected monetary amount pattern")

    # Check known vendors
    for key in MERCHANT_PROFILES:
        if key in text or key in sender.lower():
            score += 0.3
            reasons.append(f"Recognized vendor profile: {MERCHANT_PROFILES[key]['name']}")
            break

    # Check PDF attachment
    if has_attachment or (filename and filename.lower().endswith(".pdf")):
        score += 0.25
        reasons.append("Contains invoice PDF attachment")

    confidence = min(round(score, 2), 1.0)
    is_invoice = confidence >= 0.45

    if not is_invoice and is_promo:
        return False, confidence, "Email appears to be a promotional or non-billing message"

    reason_str = "; ".join(reasons) if reasons else "No distinct billing signals found"
    return is_invoice, confidence, reason_str


def extract_vendor(subject: str, sender: str, body: str) -> str:
    """Extract or infer the merchant/vendor name."""
    text = f"{subject} {sender} {body}".lower()
    
    if "amazon web services" in text or "aws" in text or "amazon.com" in sender.lower():
        return "Amazon Web Services"
    if "openai" in text or "chatgpt" in text:
        return "OpenAI"
    if "anthropic" in text or "claude" in text:
        return "Anthropic Claude"
    if "figma" in text:
        return "Figma"
    if "netflix" in text:
        return "Netflix"
    if "github" in text:
        return "GitHub"
    if "google" in text or "workspace" in text:
        return "Google Workspace"
    if "adobe" in text:
        return "Adobe Creative Cloud"
    if "spotify" in text:
        return "Spotify"
    if "slack" in text:
        return "Slack Technologies"
    if "vercel" in text:
        return "Vercel"
    if "uber" in text:
        return "Uber"
    if "apple" in text or "icloud" in text:
        return "Apple Services"
    if "notion" in text:
        return "Notion Labs"
    if "digitalocean" in text:
        return "DigitalOcean"
            
    # Try sender display name or domain
    match_display = re.search(r'([A-Za-z0-9\s]+)<', sender)
    if match_display and match_display.group(1).strip():
        name = match_display.group(1).strip()
        if not any(generic in name.lower() for generic in ["billing", "invoice", "noreply", "support", "team"]):
            return name

    # Try sender domain e.g. @github.com -> GitHub
    match_domain = re.search(r'@([a-zA-Z0-9\-]+)\.', sender)
    if match_domain:
        domain = match_domain.group(1).capitalize()
        if domain.lower() not in ["gmail", "outlook", "yahoo", "hotmail", "icloud", "mail"]:
            return domain

    # Fallback to subject extraction
    match_sub = re.search(r'(?:from|at|invoice from)\s+([A-Za-z0-9\s]+)', subject, re.IGNORECASE)
    if match_sub:
        return match_sub.group(1).strip()

    return "Online Merchant"


def extract_amount_and_currency(text: str) -> Tuple[float, str]:
    """Extract total amount and currency from text or PDF snippet."""
    # Look for explicit totals first: "Total: $129.00", "Amount paid: 15.00 USD"
    total_patterns = [
        r'(?:total|amount paid|amount charged|grand total|subtotal|due|charged)\s*[:=]?\s*(?:[\$\€\£]|USD|EUR|GBP)?\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)',
        r'(\d{1,5}(?:\.\d{2})?)\s*(?:USD|EUR|GBP)',
        r'[\$]\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)',
        r'[\€]\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)',
        r'[\£]\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)',
    ]

    currency = "USD"
    if "€" in text or "EUR" in text:
        currency = "EUR"
    elif "£" in text or "GBP" in text:
        currency = "GBP"

    for pat in total_patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            raw_val = match.group(1).replace(",", "")
            try:
                val = float(raw_val)
                if val > 0:
                    return round(val, 2), currency
            except ValueError:
                continue

    # Fallback generic decimal
    generic_match = re.search(r'\b(\d{1,4}\.\d{2})\b', text)
    if generic_match:
        try:
            return round(float(generic_match.group(1)), 2), currency
        except ValueError:
            pass

    return 0.0, currency


def extract_payment_type_and_frequency(text: str, vendor: str) -> Tuple[str, str]:
    """
    Determines if it's a recurring subscription or one-time purchase,
    and returns (payment_type, billing_frequency).
    """
    text_lower = text.lower()
    vendor_lower = vendor.lower()

    # Recurring indicators
    recurring_keywords = [
        "subscription", "recurring", "renewed", "membership", "monthly plan",
        "annual plan", "yearly plan", "per month", "/month", "/mo", "/year", "/yr",
        "next billing", "auto-renew", "seat subscription", "tier renewal", "billing statement",
        "monthly", "monthly charges", "monthly bill", "statement"
    ]
    
    # One-time indicators
    onetime_keywords = [
        "one-time", "order #", "shipping address", "delivery fee", "trip with uber",
        "ride receipt", "hardware purchase", "single purchase", "checkout summary", "trip"
    ]

    is_recurring = any(k in text_lower for k in recurring_keywords)
    is_onetime = any(k in text_lower for k in onetime_keywords)

    # Check vendor default
    for key, profile in MERCHANT_PROFILES.items():
        if key in vendor_lower or profile["name"].lower() in vendor_lower:
            if not is_onetime:
                is_recurring = profile.get("default_type") == "subscription"
            break

    if is_recurring and not is_onetime:
        # Determine frequency
        if any(w in text_lower for w in ["year", "annual", "yearly", "/yr"]):
            return "subscription", "yearly"
        elif any(w in text_lower for w in ["quarter", "quarterly"]):
            return "subscription", "quarterly"
        elif any(w in text_lower for w in ["week", "weekly"]):
            return "subscription", "weekly"
        else:
            return "subscription", "monthly"

    return "one_time", "none"


def extract_purpose(vendor: str, text: str, payment_type: str) -> str:
    """Generate or extract a clear explanation of what the subscription or purchase is for."""
    vendor_key = vendor.lower()
    for key, profile in MERCHANT_PROFILES.items():
        if key in vendor_key:
            return profile.get("purpose", f"{profile['name']} recurring plan")

    # Look for plan names in text
    plan_match = re.search(r'(?:plan|subscription|package|tier):\s*([A-Za-z0-9\s\-]+)', text, re.IGNORECASE)
    if plan_match:
        return f"{plan_match.group(1).strip()} subscription"

    if payment_type == "subscription":
        return f"{vendor} monthly software & cloud subscription"
    return f"{vendor} digital service / one-time transaction"


def extract_category(vendor: str, text: str) -> str:
    """Determine the financial category for spending analytics."""
    vendor_key = vendor.lower()
    for key, profile in MERCHANT_PROFILES.items():
        if key in vendor_key:
            return profile.get("category", "Software & SaaS")

    text_lower = text.lower()
    if any(w in text_lower for w in ["cloud", "hosting", "server", "aws", "storage", "database", "domain"]):
        return "Cloud & Infrastructure"
    elif any(w in text_lower for w in ["ai", "gpt", "model", "tokens", "inference", "claude"]):
        return "AI & Developer Tools"
    elif any(w in text_lower for w in ["streaming", "music", "movie", "video", "entertainment"]):
        return "Entertainment"
    elif any(w in text_lower for w in ["ride", "trip", "flight", "transport", "travel", "car"]):
        return "Travel & Transport"
    elif any(w in text_lower for w in ["design", "creative", "figma", "video editing"]):
        return "Design & Creative"
    elif any(w in text_lower for w in ["marketing", "ad", "campaign", "newsletter"]):
        return "Marketing & Growth"
    
    return "Software & SaaS"


def calculate_next_renewal(invoice_date: datetime, frequency: str) -> datetime:
    """Calculates the upcoming renewal date based on billing cycle."""
    if frequency == "yearly":
        return invoice_date + timedelta(days=365)
    elif frequency == "quarterly":
        return invoice_date + timedelta(days=90)
    elif frequency == "weekly":
        return invoice_date + timedelta(days=7)
    else:  # default monthly
        return invoice_date + timedelta(days=30)


def extract_invoice_number(text: str) -> Optional[str]:
    """Find invoice or receipt number."""
    patterns = [
        r'(?:invoice|receipt|order|reference|bill)\s*(?:#|no\.?|num\.?|id)?\s*[:=]?\s*([A-Za-z0-9\-_]{4,20})',
        r'INV-([A-Za-z0-9\-]+)',
        r'REC-([A-Za-z0-9\-]+)'
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def parse_email_message(
    subject: str,
    sender: str,
    body: str,
    has_attachment: bool = False,
    pdf_filename: Optional[str] = None,
    pdf_text: Optional[str] = None,
    received_at: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Main parser method that combines text and PDF extraction, classifies
    the email, extracts all financial attributes, and returns structured data.
    """
    full_text = f"{subject}\n{sender}\n{body}\n{pdf_text or ''}"
    invoice_date = received_at or datetime.utcnow()

    is_inv, confidence, reason = is_invoice_email(
        subject, sender, body, has_attachment, pdf_filename or ""
    )

    if not is_inv:
        return {
            "is_invoice": False,
            "confidence_score": confidence,
            "reason": reason,
        }

    vendor = extract_vendor(subject, sender, full_text)
    amount, currency = extract_amount_and_currency(full_text)
    payment_type, frequency = extract_payment_type_and_frequency(full_text, vendor)
    purpose = extract_purpose(vendor, full_text, payment_type)
    category = extract_category(vendor, full_text)
    invoice_no = extract_invoice_number(full_text) or f"INV-{int(datetime.utcnow().timestamp())}"
    next_renewal = calculate_next_renewal(invoice_date, frequency) if payment_type == "subscription" else None

    # Line item mock/extraction
    line_items = [
        {
            "description": purpose,
            "quantity": 1,
            "unitPrice": amount,
            "total": amount
        }
    ]

    return {
        "is_invoice": True,
        "vendor": vendor,
        "amount": amount,
        "currency": currency,
        "payment_type": payment_type,
        "billing_frequency": frequency,
        "category": category,
        "purpose": purpose,
        "invoice_date": invoice_date,
        "invoice_number": invoice_no,
        "email_sender": sender,
        "email_subject": subject,
        "email_snippet": body[:200] if body else "",
        "raw_email_body": body,
        "has_pdf_attachment": has_attachment or bool(pdf_filename),
        "pdf_filename": pdf_filename or ("Invoice.pdf" if has_attachment else None),
        "pdf_text_preview": (pdf_text[:300] if pdf_text else None),
        "line_items": line_items,
        "confidence_score": confidence,
        "next_renewal_date": next_renewal,
        "reason": reason
    }
