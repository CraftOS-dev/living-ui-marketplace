"""
CRM Demo Data Seeder

Generates realistic hardcoded demo data for the CRM system.
Creates companies, contacts, deals, activities, notes, tags, and email templates
that make the CRM look like a real B2B sales pipeline.
"""

from datetime import datetime, timedelta, date
from typing import Dict, Any
from models import (
    Company, Contact, Deal, DealStage, Activity, Note,
    Tag, EmailTemplate, contact_tags, deal_contacts,
)
import logging

logger = logging.getLogger(__name__)


def seed_demo_data(db) -> Dict[str, Any]:
    """Seed the database with realistic demo data.

    Creates:
    - 10 companies (real-sounding tech, finance, healthcare companies)
    - 50 contacts across those companies
    - 15 deals in various pipeline stages
    - 30 activities (calls, emails, meetings, tasks)
    - 20 notes
    - 5 tags (Hot Lead, Enterprise, SMB, Partner, VIP)
    - 3 email templates (Follow Up, Introduction, Proposal)

    Returns dict with counts of created items.
    """
    # Check if data already exists to prevent double-seeding
    existing_companies = db.query(Company).count()
    if existing_companies > 0:
        logger.info("[Seed] Data already exists, skipping seed.")
        return {"status": "skipped", "reason": "Data already exists"}

    counts = {}
    now = datetime.utcnow()

    # ------------------------------------------------------------------
    # 1. Companies
    # ------------------------------------------------------------------
    companies_data = [
        {
            "name": "Pinnacle Dynamics",
            "domain": "pinnacledynamics.com",
            "industry": "Technology",
            "size": "201-500",
            "annual_revenue": 45000000.0,
            "phone": "+1 (415) 555-0120",
            "website": "https://pinnacledynamics.com",
            "address": "350 Market Street, Suite 800",
            "city": "San Francisco",
            "state": "CA",
            "country": "United States",
            "description": "Enterprise SaaS platform for supply chain optimization and logistics automation.",
        },
        {
            "name": "Meridian Health Partners",
            "domain": "meridianhp.com",
            "industry": "Healthcare",
            "size": "500+",
            "annual_revenue": 120000000.0,
            "phone": "+1 (212) 555-0198",
            "website": "https://meridianhp.com",
            "address": "1 Park Avenue, Floor 22",
            "city": "New York",
            "state": "NY",
            "country": "United States",
            "description": "Healthcare technology and managed services for hospital networks across the Northeast.",
        },
        {
            "name": "Crestline Financial Group",
            "domain": "crestlinefg.com",
            "industry": "Finance",
            "size": "51-200",
            "annual_revenue": 28000000.0,
            "phone": "+1 (312) 555-0145",
            "website": "https://crestlinefg.com",
            "address": "233 S Wacker Drive, Suite 4500",
            "city": "Chicago",
            "state": "IL",
            "country": "United States",
            "description": "Wealth management and advisory services for mid-market institutional investors.",
        },
        {
            "name": "Vantage Cloud Systems",
            "domain": "vantagecloudsys.com",
            "industry": "Technology",
            "size": "51-200",
            "annual_revenue": 18000000.0,
            "phone": "+1 (512) 555-0167",
            "website": "https://vantagecloudsys.com",
            "address": "900 Congress Avenue, Suite 300",
            "city": "Austin",
            "state": "TX",
            "country": "United States",
            "description": "Multi-cloud infrastructure management and DevOps consulting.",
        },
        {
            "name": "Bridgepoint Manufacturing",
            "domain": "bridgepointmfg.com",
            "industry": "Manufacturing",
            "size": "500+",
            "annual_revenue": 250000000.0,
            "phone": "+1 (313) 555-0189",
            "website": "https://bridgepointmfg.com",
            "address": "4700 Woodward Avenue",
            "city": "Detroit",
            "state": "MI",
            "country": "United States",
            "description": "Precision manufacturing for automotive and aerospace components.",
        },
        {
            "name": "Luminos Education",
            "domain": "luminosedu.com",
            "industry": "Education",
            "size": "11-50",
            "annual_revenue": 5200000.0,
            "phone": "+1 (617) 555-0134",
            "website": "https://luminosedu.com",
            "address": "77 Summer Street, Floor 5",
            "city": "Boston",
            "state": "MA",
            "country": "United States",
            "description": "Online learning platform and curriculum design for K-12 school districts.",
        },
        {
            "name": "Northstar Logistics",
            "domain": "northstarlogistics.com",
            "industry": "Logistics",
            "size": "201-500",
            "annual_revenue": 62000000.0,
            "phone": "+1 (206) 555-0156",
            "website": "https://northstarlogistics.com",
            "address": "1200 3rd Avenue, Suite 1800",
            "city": "Seattle",
            "state": "WA",
            "country": "United States",
            "description": "End-to-end freight management and cold chain logistics for the Pacific Northwest.",
        },
        {
            "name": "Apex Retail Solutions",
            "domain": "apexretail.io",
            "industry": "Retail Technology",
            "size": "11-50",
            "annual_revenue": 3800000.0,
            "phone": "+1 (305) 555-0178",
            "website": "https://apexretail.io",
            "address": "800 Brickell Avenue, Suite 1200",
            "city": "Miami",
            "state": "FL",
            "country": "United States",
            "description": "Point-of-sale and inventory analytics platform for mid-size retail chains.",
        },
        {
            "name": "Terraform Energy",
            "domain": "terraformenergy.com",
            "industry": "Energy",
            "size": "51-200",
            "annual_revenue": 35000000.0,
            "phone": "+1 (720) 555-0112",
            "website": "https://terraformenergy.com",
            "address": "1801 California Street, Suite 2400",
            "city": "Denver",
            "state": "CO",
            "country": "United States",
            "description": "Renewable energy project development and carbon credit trading.",
        },
        {
            "name": "Sentinel Cybersecurity",
            "domain": "sentinelcyber.com",
            "industry": "Cybersecurity",
            "size": "51-200",
            "annual_revenue": 22000000.0,
            "phone": "+1 (703) 555-0143",
            "website": "https://sentinelcyber.com",
            "address": "1911 N Fort Myer Drive, Suite 900",
            "city": "Arlington",
            "state": "VA",
            "country": "United States",
            "description": "Managed detection and response, penetration testing, and compliance services for government contractors.",
        },
    ]

    companies = []
    for cdata in companies_data:
        company = Company(**cdata)
        db.add(company)
        companies.append(company)
    db.flush()
    counts["companies"] = len(companies)

    # ------------------------------------------------------------------
    # 2. Contacts (50 across 10 companies)
    # ------------------------------------------------------------------
    contacts_data = [
        # Pinnacle Dynamics (0) - 6 contacts
        {"first_name": "David", "last_name": "Chen", "email": "d.chen@pinnacledynamics.com", "phone": "+1 (415) 555-1001", "job_title": "VP of Engineering", "department": "Engineering", "city": "San Francisco", "state": "CA", "country": "United States", "source": "manual", "lead_status": "customer", "lead_score": 92.0, "avatar_color": "#6366f1", "company_idx": 0},
        {"first_name": "Rachel", "last_name": "Kim", "email": "r.kim@pinnacledynamics.com", "phone": "+1 (415) 555-1002", "job_title": "CTO", "department": "Engineering", "city": "San Francisco", "state": "CA", "country": "United States", "source": "manual", "lead_status": "customer", "lead_score": 95.0, "avatar_color": "#8b5cf6", "company_idx": 0},
        {"first_name": "Marcus", "last_name": "Okafor", "email": "m.okafor@pinnacledynamics.com", "phone": "+1 (415) 555-1003", "job_title": "Director of Product", "department": "Product", "city": "San Francisco", "state": "CA", "country": "United States", "source": "web_form", "lead_status": "qualified", "lead_score": 78.0, "avatar_color": "#06b6d4", "company_idx": 0},
        {"first_name": "Emily", "last_name": "Sato", "email": "e.sato@pinnacledynamics.com", "phone": "+1 (415) 555-1004", "job_title": "Procurement Manager", "department": "Operations", "city": "San Francisco", "state": "CA", "country": "United States", "source": "csv_import", "lead_status": "contacted", "lead_score": 64.0, "avatar_color": "#f59e0b", "company_idx": 0},
        {"first_name": "James", "last_name": "Patel", "email": "j.patel@pinnacledynamics.com", "phone": "+1 (415) 555-1005", "job_title": "CFO", "department": "Finance", "city": "San Francisco", "state": "CA", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 85.0, "avatar_color": "#3b82f6", "company_idx": 0},
        {"first_name": "Sophia", "last_name": "Reyes", "email": "s.reyes@pinnacledynamics.com", "phone": "+1 (415) 555-1006", "job_title": "Engineering Manager", "department": "Engineering", "city": "San Francisco", "state": "CA", "country": "United States", "source": "web_form", "lead_status": "new", "lead_score": 55.0, "avatar_color": "#22c55e", "company_idx": 0},
        # Meridian Health Partners (1) - 6 contacts
        {"first_name": "Angela", "last_name": "Morrison", "email": "a.morrison@meridianhp.com", "phone": "+1 (212) 555-2001", "job_title": "Chief Medical Officer", "department": "Medical", "city": "New York", "state": "NY", "country": "United States", "source": "manual", "lead_status": "customer", "lead_score": 90.0, "avatar_color": "#ef4444", "company_idx": 1},
        {"first_name": "Robert", "last_name": "Vasquez", "email": "r.vasquez@meridianhp.com", "phone": "+1 (212) 555-2002", "job_title": "VP of IT", "department": "IT", "city": "New York", "state": "NY", "country": "United States", "source": "manual", "lead_status": "customer", "lead_score": 88.0, "avatar_color": "#f97316", "company_idx": 1},
        {"first_name": "Linda", "last_name": "Huang", "email": "l.huang@meridianhp.com", "phone": "+1 (212) 555-2003", "job_title": "Director of Compliance", "department": "Legal", "city": "New York", "state": "NY", "country": "United States", "source": "csv_import", "lead_status": "qualified", "lead_score": 72.0, "avatar_color": "#6366f1", "company_idx": 1},
        {"first_name": "Thomas", "last_name": "Wright", "email": "t.wright@meridianhp.com", "phone": "+1 (212) 555-2004", "job_title": "Procurement Director", "department": "Operations", "city": "New York", "state": "NY", "country": "United States", "source": "web_form", "lead_status": "contacted", "lead_score": 61.0, "avatar_color": "#8b5cf6", "company_idx": 1},
        {"first_name": "Priya", "last_name": "Sharma", "email": "p.sharma@meridianhp.com", "phone": "+1 (212) 555-2005", "job_title": "Data Science Lead", "department": "Analytics", "city": "New York", "state": "NY", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 76.0, "avatar_color": "#06b6d4", "company_idx": 1},
        {"first_name": "Kevin", "last_name": "Brooks", "email": "k.brooks@meridianhp.com", "phone": "+1 (212) 555-2006", "job_title": "IT Project Manager", "department": "IT", "city": "New York", "state": "NY", "country": "United States", "source": "csv_import", "lead_status": "new", "lead_score": 48.0, "avatar_color": "#3b82f6", "company_idx": 1},
        # Crestline Financial Group (2) - 5 contacts
        {"first_name": "Victoria", "last_name": "Sterling", "email": "v.sterling@crestlinefg.com", "phone": "+1 (312) 555-3001", "job_title": "Managing Director", "department": "Advisory", "city": "Chicago", "state": "IL", "country": "United States", "source": "manual", "lead_status": "customer", "lead_score": 94.0, "avatar_color": "#f59e0b", "company_idx": 2},
        {"first_name": "Michael", "last_name": "Torres", "email": "m.torres@crestlinefg.com", "phone": "+1 (312) 555-3002", "job_title": "Head of Technology", "department": "Technology", "city": "Chicago", "state": "IL", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 81.0, "avatar_color": "#22c55e", "company_idx": 2},
        {"first_name": "Catherine", "last_name": "Nguyen", "email": "c.nguyen@crestlinefg.com", "phone": "+1 (312) 555-3003", "job_title": "Senior Portfolio Analyst", "department": "Investments", "city": "Chicago", "state": "IL", "country": "United States", "source": "web_form", "lead_status": "contacted", "lead_score": 63.0, "avatar_color": "#ef4444", "company_idx": 2},
        {"first_name": "Andrew", "last_name": "Freeman", "email": "a.freeman@crestlinefg.com", "phone": "+1 (312) 555-3004", "job_title": "COO", "department": "Operations", "city": "Chicago", "state": "IL", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 87.0, "avatar_color": "#f97316", "company_idx": 2},
        {"first_name": "Jessica", "last_name": "Park", "email": "j.park@crestlinefg.com", "phone": "+1 (312) 555-3005", "job_title": "Compliance Officer", "department": "Legal", "city": "Chicago", "state": "IL", "country": "United States", "source": "csv_import", "lead_status": "new", "lead_score": 42.0, "avatar_color": "#6366f1", "company_idx": 2},
        # Vantage Cloud Systems (3) - 5 contacts
        {"first_name": "Brandon", "last_name": "Lee", "email": "b.lee@vantagecloudsys.com", "phone": "+1 (512) 555-4001", "job_title": "CEO", "department": "Executive", "city": "Austin", "state": "TX", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 89.0, "avatar_color": "#8b5cf6", "company_idx": 3},
        {"first_name": "Natalie", "last_name": "Cooper", "email": "n.cooper@vantagecloudsys.com", "phone": "+1 (512) 555-4002", "job_title": "VP of Sales", "department": "Sales", "city": "Austin", "state": "TX", "country": "United States", "source": "manual", "lead_status": "contacted", "lead_score": 70.0, "avatar_color": "#06b6d4", "company_idx": 3},
        {"first_name": "Derek", "last_name": "Wagner", "email": "d.wagner@vantagecloudsys.com", "phone": "+1 (512) 555-4003", "job_title": "Solutions Architect", "department": "Engineering", "city": "Austin", "state": "TX", "country": "United States", "source": "web_form", "lead_status": "new", "lead_score": 53.0, "avatar_color": "#3b82f6", "company_idx": 3},
        {"first_name": "Megan", "last_name": "Doyle", "email": "m.doyle@vantagecloudsys.com", "phone": "+1 (512) 555-4004", "job_title": "Head of DevOps", "department": "Engineering", "city": "Austin", "state": "TX", "country": "United States", "source": "csv_import", "lead_status": "qualified", "lead_score": 74.0, "avatar_color": "#f59e0b", "company_idx": 3},
        {"first_name": "Ryan", "last_name": "Mitchell", "email": "r.mitchell@vantagecloudsys.com", "phone": "+1 (512) 555-4005", "job_title": "Finance Director", "department": "Finance", "city": "Austin", "state": "TX", "country": "United States", "source": "manual", "lead_status": "contacted", "lead_score": 66.0, "avatar_color": "#22c55e", "company_idx": 3},
        # Bridgepoint Manufacturing (4) - 5 contacts
        {"first_name": "Patricia", "last_name": "Coleman", "email": "p.coleman@bridgepointmfg.com", "phone": "+1 (313) 555-5001", "job_title": "SVP of Operations", "department": "Operations", "city": "Detroit", "state": "MI", "country": "United States", "source": "manual", "lead_status": "customer", "lead_score": 91.0, "avatar_color": "#ef4444", "company_idx": 4},
        {"first_name": "Gregory", "last_name": "Adams", "email": "g.adams@bridgepointmfg.com", "phone": "+1 (313) 555-5002", "job_title": "Plant Manager", "department": "Manufacturing", "city": "Detroit", "state": "MI", "country": "United States", "source": "csv_import", "lead_status": "qualified", "lead_score": 73.0, "avatar_color": "#f97316", "company_idx": 4},
        {"first_name": "Diana", "last_name": "Russell", "email": "d.russell@bridgepointmfg.com", "phone": "+1 (313) 555-5003", "job_title": "CIO", "department": "IT", "city": "Detroit", "state": "MI", "country": "United States", "source": "manual", "lead_status": "customer", "lead_score": 88.0, "avatar_color": "#6366f1", "company_idx": 4},
        {"first_name": "Steven", "last_name": "Hayes", "email": "s.hayes@bridgepointmfg.com", "phone": "+1 (313) 555-5004", "job_title": "Quality Assurance Director", "department": "Quality", "city": "Detroit", "state": "MI", "country": "United States", "source": "web_form", "lead_status": "contacted", "lead_score": 59.0, "avatar_color": "#8b5cf6", "company_idx": 4},
        {"first_name": "Hannah", "last_name": "Fletcher", "email": "h.fletcher@bridgepointmfg.com", "phone": "+1 (313) 555-5005", "job_title": "Supply Chain Manager", "department": "Supply Chain", "city": "Detroit", "state": "MI", "country": "United States", "source": "manual", "lead_status": "new", "lead_score": 46.0, "avatar_color": "#06b6d4", "company_idx": 4},
        # Luminos Education (5) - 5 contacts
        {"first_name": "Olivia", "last_name": "Grant", "email": "o.grant@luminosedu.com", "phone": "+1 (617) 555-6001", "job_title": "CEO & Founder", "department": "Executive", "city": "Boston", "state": "MA", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 82.0, "avatar_color": "#3b82f6", "company_idx": 5},
        {"first_name": "Ethan", "last_name": "Walsh", "email": "e.walsh@luminosedu.com", "phone": "+1 (617) 555-6002", "job_title": "Head of Curriculum", "department": "Content", "city": "Boston", "state": "MA", "country": "United States", "source": "web_form", "lead_status": "contacted", "lead_score": 58.0, "avatar_color": "#f59e0b", "company_idx": 5},
        {"first_name": "Samantha", "last_name": "Price", "email": "s.price@luminosedu.com", "phone": "+1 (617) 555-6003", "job_title": "VP of Partnerships", "department": "Business Development", "city": "Boston", "state": "MA", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 75.0, "avatar_color": "#22c55e", "company_idx": 5},
        {"first_name": "Daniel", "last_name": "Burke", "email": "d.burke@luminosedu.com", "phone": "+1 (617) 555-6004", "job_title": "Lead Developer", "department": "Engineering", "city": "Boston", "state": "MA", "country": "United States", "source": "csv_import", "lead_status": "new", "lead_score": 50.0, "avatar_color": "#ef4444", "company_idx": 5},
        {"first_name": "Laura", "last_name": "Jennings", "email": "l.jennings@luminosedu.com", "phone": "+1 (617) 555-6005", "job_title": "Marketing Director", "department": "Marketing", "city": "Boston", "state": "MA", "country": "United States", "source": "web_form", "lead_status": "contacted", "lead_score": 62.0, "avatar_color": "#f97316", "company_idx": 5},
        # Northstar Logistics (6) - 5 contacts
        {"first_name": "Jonathan", "last_name": "Reed", "email": "j.reed@northstarlogistics.com", "phone": "+1 (206) 555-7001", "job_title": "COO", "department": "Operations", "city": "Seattle", "state": "WA", "country": "United States", "source": "manual", "lead_status": "customer", "lead_score": 93.0, "avatar_color": "#6366f1", "company_idx": 6},
        {"first_name": "Cynthia", "last_name": "Blake", "email": "c.blake@northstarlogistics.com", "phone": "+1 (206) 555-7002", "job_title": "VP of Technology", "department": "IT", "city": "Seattle", "state": "WA", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 80.0, "avatar_color": "#8b5cf6", "company_idx": 6},
        {"first_name": "Nathan", "last_name": "Cross", "email": "n.cross@northstarlogistics.com", "phone": "+1 (206) 555-7003", "job_title": "Fleet Manager", "department": "Logistics", "city": "Seattle", "state": "WA", "country": "United States", "source": "csv_import", "lead_status": "contacted", "lead_score": 57.0, "avatar_color": "#06b6d4", "company_idx": 6},
        {"first_name": "Rebecca", "last_name": "Dunn", "email": "r.dunn@northstarlogistics.com", "phone": "+1 (206) 555-7004", "job_title": "Director of Finance", "department": "Finance", "city": "Seattle", "state": "WA", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 71.0, "avatar_color": "#3b82f6", "company_idx": 6},
        {"first_name": "Alexander", "last_name": "Marsh", "email": "a.marsh@northstarlogistics.com", "phone": "+1 (206) 555-7005", "job_title": "Warehouse Operations Lead", "department": "Logistics", "city": "Seattle", "state": "WA", "country": "United States", "source": "web_form", "lead_status": "new", "lead_score": 40.0, "avatar_color": "#f59e0b", "company_idx": 6},
        # Apex Retail Solutions (7) - 4 contacts
        {"first_name": "Isabelle", "last_name": "Fox", "email": "i.fox@apexretail.io", "phone": "+1 (305) 555-8001", "job_title": "Founder & CEO", "department": "Executive", "city": "Miami", "state": "FL", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 79.0, "avatar_color": "#22c55e", "company_idx": 7},
        {"first_name": "Tyler", "last_name": "Graham", "email": "t.graham@apexretail.io", "phone": "+1 (305) 555-8002", "job_title": "CTO", "department": "Engineering", "city": "Miami", "state": "FL", "country": "United States", "source": "manual", "lead_status": "contacted", "lead_score": 68.0, "avatar_color": "#ef4444", "company_idx": 7},
        {"first_name": "Monica", "last_name": "Lawson", "email": "m.lawson@apexretail.io", "phone": "+1 (305) 555-8003", "job_title": "Head of Customer Success", "department": "Support", "city": "Miami", "state": "FL", "country": "United States", "source": "web_form", "lead_status": "new", "lead_score": 52.0, "avatar_color": "#f97316", "company_idx": 7},
        {"first_name": "Carlos", "last_name": "Mendez", "email": "c.mendez@apexretail.io", "phone": "+1 (305) 555-8004", "job_title": "Business Development Rep", "department": "Sales", "city": "Miami", "state": "FL", "country": "United States", "source": "csv_import", "lead_status": "new", "lead_score": 45.0, "avatar_color": "#6366f1", "company_idx": 7},
        # Terraform Energy (8) - 5 contacts
        {"first_name": "Christopher", "last_name": "Holt", "email": "c.holt@terraformenergy.com", "phone": "+1 (720) 555-9001", "job_title": "CEO", "department": "Executive", "city": "Denver", "state": "CO", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 86.0, "avatar_color": "#8b5cf6", "company_idx": 8},
        {"first_name": "Allison", "last_name": "Barker", "email": "a.barker@terraformenergy.com", "phone": "+1 (720) 555-9002", "job_title": "VP of Project Development", "department": "Projects", "city": "Denver", "state": "CO", "country": "United States", "source": "manual", "lead_status": "contacted", "lead_score": 69.0, "avatar_color": "#06b6d4", "company_idx": 8},
        {"first_name": "Peter", "last_name": "Hawkins", "email": "p.hawkins@terraformenergy.com", "phone": "+1 (720) 555-9003", "job_title": "Head of Carbon Markets", "department": "Trading", "city": "Denver", "state": "CO", "country": "United States", "source": "web_form", "lead_status": "new", "lead_score": 54.0, "avatar_color": "#3b82f6", "company_idx": 8},
        {"first_name": "Karen", "last_name": "Sutton", "email": "k.sutton@terraformenergy.com", "phone": "+1 (720) 555-9004", "job_title": "Director of Engineering", "department": "Engineering", "city": "Denver", "state": "CO", "country": "United States", "source": "csv_import", "lead_status": "qualified", "lead_score": 77.0, "avatar_color": "#f59e0b", "company_idx": 8},
        {"first_name": "Brian", "last_name": "Elliott", "email": "b.elliott@terraformenergy.com", "phone": "+1 (720) 555-9005", "job_title": "CFO", "department": "Finance", "city": "Denver", "state": "CO", "country": "United States", "source": "manual", "lead_status": "customer", "lead_score": 91.0, "avatar_color": "#22c55e", "company_idx": 8},
        # Sentinel Cybersecurity (9) - 4 contacts
        {"first_name": "Nicole", "last_name": "Stone", "email": "n.stone@sentinelcyber.com", "phone": "+1 (703) 555-0201", "job_title": "Managing Director", "department": "Executive", "city": "Arlington", "state": "VA", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 84.0, "avatar_color": "#ef4444", "company_idx": 9},
        {"first_name": "William", "last_name": "Frost", "email": "w.frost@sentinelcyber.com", "phone": "+1 (703) 555-0202", "job_title": "VP of Threat Intelligence", "department": "Security", "city": "Arlington", "state": "VA", "country": "United States", "source": "manual", "lead_status": "contacted", "lead_score": 71.0, "avatar_color": "#f97316", "company_idx": 9},
        {"first_name": "Aisha", "last_name": "Rahman", "email": "a.rahman@sentinelcyber.com", "phone": "+1 (703) 555-0203", "job_title": "Senior Security Engineer", "department": "Engineering", "city": "Arlington", "state": "VA", "country": "United States", "source": "web_form", "lead_status": "new", "lead_score": 56.0, "avatar_color": "#6366f1", "company_idx": 9},
        {"first_name": "Jason", "last_name": "Caldwell", "email": "j.caldwell@sentinelcyber.com", "phone": "+1 (703) 555-0204", "job_title": "Head of GovCloud Sales", "department": "Sales", "city": "Arlington", "state": "VA", "country": "United States", "source": "manual", "lead_status": "qualified", "lead_score": 80.0, "avatar_color": "#8b5cf6", "company_idx": 9},
    ]

    contacts = []
    for cdata in contacts_data:
        company_idx = cdata.pop("company_idx")
        contact = Contact(company_id=companies[company_idx].id, **cdata)
        db.add(contact)
        contacts.append(contact)
    db.flush()
    counts["contacts"] = len(contacts)

    # ------------------------------------------------------------------
    # 3. Tags
    # ------------------------------------------------------------------
    tags_data = [
        {"name": "Hot Lead", "color": "#ef4444"},
        {"name": "Enterprise", "color": "#6366f1"},
        {"name": "SMB", "color": "#22c55e"},
        {"name": "Partner", "color": "#f59e0b"},
        {"name": "VIP", "color": "#8b5cf6"},
    ]

    tags = []
    for tdata in tags_data:
        tag = Tag(**tdata)
        db.add(tag)
        tags.append(tag)
    db.flush()
    counts["tags"] = len(tags)

    # Assign tags to contacts
    # Hot Lead -> high-score contacts
    tag_hot = tags[0]
    tag_enterprise = tags[1]
    tag_smb = tags[2]
    tag_partner = tags[3]
    tag_vip = tags[4]

    # Build a mapping of contact -> set of tags to avoid duplicates
    contact_tag_map: dict = {c.id: set() for c in contacts}

    for c in contacts:
        if c.lead_score and c.lead_score >= 85:
            contact_tag_map[c.id].add(tag_hot)
        if c.lead_score and c.lead_score >= 90:
            contact_tag_map[c.id].add(tag_vip)

    # Enterprise tag for large companies (500+, 201-500)
    large_company_ids = {company.id for company in companies if company.size in ("500+", "201-500")}
    for c in contacts:
        if c.company_id in large_company_ids:
            contact_tag_map[c.id].add(tag_enterprise)

    # SMB tag for smaller companies
    small_company_ids = {company.id for company in companies if company.size in ("1-10", "11-50")}
    for c in contacts:
        if c.company_id in small_company_ids:
            contact_tag_map[c.id].add(tag_smb)

    # Partner tag for a few specific contacts
    if len(contacts) > 28:
        contact_tag_map[contacts[17].id].add(tag_partner)
        contact_tag_map[contacts[28].id].add(tag_partner)

    # Assign tags using the deduplicated map
    for c in contacts:
        for tag in contact_tag_map.get(c.id, set()):
            c.tags.append(tag)

    db.flush()

    # ------------------------------------------------------------------
    # 4. Deals (stages already seeded in database.py)
    # ------------------------------------------------------------------
    stages = db.query(DealStage).order_by(DealStage.position).all()
    stage_map = {s.name: s.id for s in stages}

    base_date = now.date()

    deals_data = [
        {"title": "Pinnacle Dynamics - Enterprise Platform License", "company_idx": 0, "stage": "Negotiation", "value": 185000.0, "probability": 75, "expected_close": base_date + timedelta(days=14), "status": "open", "owner": "Sarah Johnson", "priority": "high", "description": "Annual enterprise license for the full platform suite. Multi-year contract under discussion.", "contact_indices": [0, 1, 4]},
        {"title": "Meridian HP - EHR Integration Suite", "company_idx": 1, "stage": "Proposal", "value": 320000.0, "probability": 55, "expected_close": base_date + timedelta(days=30), "status": "open", "owner": "Sarah Johnson", "priority": "urgent", "description": "Electronic health records integration across 12 hospital locations. Includes training and 24/7 support.", "contact_indices": [6, 7, 8]},
        {"title": "Crestline FG - Portfolio Analytics Dashboard", "company_idx": 2, "stage": "Demo/Meeting", "value": 75000.0, "probability": 40, "expected_close": base_date + timedelta(days=45), "status": "open", "owner": "Mark Davis", "priority": "medium", "description": "Custom analytics dashboard for portfolio performance tracking and client reporting.", "contact_indices": [12, 13]},
        {"title": "Vantage Cloud - Infrastructure Monitoring", "company_idx": 3, "stage": "Qualified", "value": 48000.0, "probability": 30, "expected_close": base_date + timedelta(days=60), "status": "open", "owner": "Mark Davis", "priority": "medium", "description": "Cloud infrastructure monitoring and alerting platform deployment.", "contact_indices": [17, 20]},
        {"title": "Bridgepoint Mfg - IoT Sensor Platform", "company_idx": 4, "stage": "Closed Won", "value": 420000.0, "probability": 100, "expected_close": base_date - timedelta(days=10), "actual_close": base_date - timedelta(days=10), "status": "won", "owner": "Sarah Johnson", "priority": "high", "description": "IoT sensor network for real-time manufacturing floor monitoring. 3-year contract signed.", "contact_indices": [22, 24]},
        {"title": "Luminos Edu - LMS Platform Migration", "company_idx": 5, "stage": "Contacted", "value": 35000.0, "probability": 20, "expected_close": base_date + timedelta(days=90), "status": "open", "owner": "Lisa Chen", "priority": "low", "description": "Migration from legacy LMS to our platform. Small initial scope with expansion potential.", "contact_indices": [26, 29]},
        {"title": "Northstar - Route Optimization Engine", "company_idx": 6, "stage": "Proposal", "value": 155000.0, "probability": 60, "expected_close": base_date + timedelta(days=21), "status": "open", "owner": "Sarah Johnson", "priority": "high", "description": "AI-powered route optimization for their Pacific Northwest delivery network.", "contact_indices": [31, 32]},
        {"title": "Apex Retail - POS Analytics Upgrade", "company_idx": 7, "stage": "New Lead", "value": 22000.0, "probability": 10, "expected_close": base_date + timedelta(days=120), "status": "open", "owner": "Lisa Chen", "priority": "low", "description": "Upgrade their existing POS analytics with real-time inventory tracking.", "contact_indices": [35, 36]},
        {"title": "Terraform Energy - Carbon Tracking Platform", "company_idx": 8, "stage": "Negotiation", "value": 98000.0, "probability": 80, "expected_close": base_date + timedelta(days=7), "status": "open", "owner": "Mark Davis", "priority": "high", "description": "Carbon credit tracking and reporting platform for regulatory compliance.", "contact_indices": [39, 43]},
        {"title": "Sentinel Cyber - SIEM Integration", "company_idx": 9, "stage": "Demo/Meeting", "value": 67000.0, "probability": 45, "expected_close": base_date + timedelta(days=35), "status": "open", "owner": "Mark Davis", "priority": "medium", "description": "SIEM integration and automated threat response workflow.", "contact_indices": [44, 46]},
        {"title": "Bridgepoint Mfg - Phase 2 Predictive Maintenance", "company_idx": 4, "stage": "Qualified", "value": 280000.0, "probability": 35, "expected_close": base_date + timedelta(days=75), "status": "open", "owner": "Sarah Johnson", "priority": "medium", "description": "Phase 2 expansion: predictive maintenance AI for assembly line equipment.", "contact_indices": [22, 23, 24]},
        {"title": "Pinnacle Dynamics - Data Warehouse Modernization", "company_idx": 0, "stage": "Closed Won", "value": 92000.0, "probability": 100, "expected_close": base_date - timedelta(days=45), "actual_close": base_date - timedelta(days=45), "status": "won", "owner": "Mark Davis", "priority": "medium", "description": "Completed migration from on-prem data warehouse to cloud-native architecture.", "contact_indices": [0, 2]},
        {"title": "Meridian HP - Telemedicine Module", "company_idx": 1, "stage": "Closed Lost", "value": 150000.0, "probability": 0, "expected_close": base_date - timedelta(days=30), "actual_close": base_date - timedelta(days=25), "status": "lost", "owner": "Lisa Chen", "priority": "high", "description": "Lost to competitor. Budget was reallocated after board meeting.", "loss_reason": "Budget constraints and competitor pricing", "contact_indices": [6, 9]},
        {"title": "Crestline FG - Compliance Automation", "company_idx": 2, "stage": "New Lead", "value": 55000.0, "probability": 10, "expected_close": base_date + timedelta(days=100), "status": "open", "owner": "Lisa Chen", "priority": "medium", "description": "Automated compliance reporting for SEC and FINRA regulatory requirements.", "contact_indices": [15, 16]},
        {"title": "Northstar - Warehouse Management System", "company_idx": 6, "stage": "Contacted", "value": 110000.0, "probability": 20, "expected_close": base_date + timedelta(days=80), "status": "open", "owner": "Mark Davis", "priority": "medium", "description": "Full warehouse management system to replace their aging legacy platform.", "contact_indices": [31, 33, 34]},
    ]

    deals = []
    for ddata in deals_data:
        company_idx = ddata.pop("company_idx")
        stage_name = ddata.pop("stage")
        contact_indices = ddata.pop("contact_indices")
        expected_close = ddata.pop("expected_close", None)
        actual_close = ddata.pop("actual_close", None)
        loss_reason = ddata.pop("loss_reason", None)

        deal = Deal(
            company_id=companies[company_idx].id,
            stage_id=stage_map[stage_name],
            expected_close_date=expected_close,
            actual_close_date=actual_close,
            loss_reason=loss_reason,
            position=len(deals),
            **ddata,
        )
        db.add(deal)
        db.flush()

        for ci in contact_indices:
            deal.contacts.append(contacts[ci])

        deals.append(deal)
    db.flush()
    counts["deals"] = len(deals)

    # ------------------------------------------------------------------
    # 5. Activities (30)
    # ------------------------------------------------------------------
    activities_data = [
        # Calls
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[0].id, "activity_type": "call", "subject": "Discovery call with David Chen", "description": "Discussed current platform pain points and scalability requirements. David confirmed budget approval for Q2.", "due_date": now - timedelta(days=12), "completed_at": now - timedelta(days=12), "is_completed": True, "priority": "high", "duration_minutes": 45, "outcome": "positive", "assigned_to": "Sarah Johnson"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[6].id, "activity_type": "call", "subject": "Follow-up with Angela Morrison on EHR requirements", "description": "Reviewed technical requirements for EHR integration. Need to schedule on-site demo with IT team.", "due_date": now - timedelta(days=8), "completed_at": now - timedelta(days=8), "is_completed": True, "priority": "high", "duration_minutes": 30, "outcome": "positive", "assigned_to": "Sarah Johnson"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[12].id, "activity_type": "call", "subject": "Intro call with Victoria Sterling", "description": "First touch with Crestline managing director. Interested in analytics capabilities for portfolio reporting.", "due_date": now - timedelta(days=5), "completed_at": now - timedelta(days=5), "is_completed": True, "priority": "normal", "duration_minutes": 25, "outcome": "positive", "assigned_to": "Mark Davis"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[17].id, "activity_type": "call", "subject": "Pricing discussion with Brandon Lee", "description": "Reviewed pricing tiers. Brandon wants a custom enterprise quote for 200+ seats.", "due_date": now - timedelta(days=3), "completed_at": now - timedelta(days=3), "is_completed": True, "priority": "normal", "duration_minutes": 20, "outcome": "neutral", "assigned_to": "Mark Davis"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[8].id, "activity_type": "call", "subject": "Contract terms review - Terraform Energy", "description": "Reviewed final contract terms with Christopher Holt. Minor redlines on SLA language. Legal to finalize.", "due_date": now - timedelta(days=2), "completed_at": now - timedelta(days=2), "is_completed": True, "priority": "high", "duration_minutes": 35, "outcome": "positive", "assigned_to": "Mark Davis"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[31].id, "activity_type": "call", "subject": "Technical deep dive with Jonathan Reed", "description": "Walked through route optimization architecture and integration points with their TMS.", "due_date": now + timedelta(days=1), "is_completed": False, "priority": "high", "duration_minutes": 60, "assigned_to": "Sarah Johnson"},
        # Emails
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[1].id, "activity_type": "email", "subject": "Sent proposal to Rachel Kim", "description": "Emailed the enterprise platform license proposal including volume pricing and SLA terms.", "due_date": now - timedelta(days=10), "completed_at": now - timedelta(days=10), "is_completed": True, "priority": "high", "outcome": "positive", "assigned_to": "Sarah Johnson"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[7].id, "activity_type": "email", "subject": "Technical spec document to Robert Vasquez", "description": "Sent EHR integration technical specification and architecture diagrams.", "due_date": now - timedelta(days=7), "completed_at": now - timedelta(days=7), "is_completed": True, "priority": "normal", "outcome": "neutral", "assigned_to": "Sarah Johnson"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[26].id, "activity_type": "email", "subject": "Introduction email to Olivia Grant", "description": "Initial outreach email about LMS migration services and case studies.", "due_date": now - timedelta(days=6), "completed_at": now - timedelta(days=6), "is_completed": True, "priority": "low", "outcome": "positive", "assigned_to": "Lisa Chen"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[35].id, "activity_type": "email", "subject": "Product overview to Isabelle Fox", "description": "Sent POS analytics product overview and ROI calculator spreadsheet.", "due_date": now - timedelta(days=4), "completed_at": now - timedelta(days=4), "is_completed": True, "priority": "low", "outcome": "neutral", "assigned_to": "Lisa Chen"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[6].id, "activity_type": "email", "subject": "Revised proposal for Northstar route optimization", "description": "Sent updated proposal reflecting 15% volume discount and extended support terms.", "due_date": now - timedelta(days=1), "completed_at": now - timedelta(days=1), "is_completed": True, "priority": "high", "outcome": "positive", "assigned_to": "Sarah Johnson"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[44].id, "activity_type": "email", "subject": "SIEM integration use cases for Nicole Stone", "description": "Shared case studies of similar SIEM integrations in defense sector.", "due_date": now + timedelta(days=2), "is_completed": False, "priority": "normal", "assigned_to": "Mark Davis"},
        # Meetings
        {"entity_type": "deal", "entity_id_fn": lambda: deals[0].id, "activity_type": "meeting", "subject": "Pinnacle Dynamics contract negotiation", "description": "On-site meeting with David Chen, Rachel Kim, and James Patel to finalize enterprise license terms.", "due_date": now - timedelta(days=6), "completed_at": now - timedelta(days=6), "is_completed": True, "priority": "urgent", "duration_minutes": 90, "outcome": "positive", "assigned_to": "Sarah Johnson"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[1].id, "activity_type": "meeting", "subject": "Meridian HP EHR demo", "description": "Live platform demo for the Meridian IT and medical staff. Positive reception from CMO.", "due_date": now - timedelta(days=9), "completed_at": now - timedelta(days=9), "is_completed": True, "priority": "high", "duration_minutes": 120, "outcome": "positive", "assigned_to": "Sarah Johnson"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[2].id, "activity_type": "meeting", "subject": "Crestline analytics platform walkthrough", "description": "Virtual demo of the portfolio analytics dashboard. Victoria asked about custom KPI builders.", "due_date": now - timedelta(days=2), "completed_at": now - timedelta(days=2), "is_completed": True, "priority": "normal", "duration_minutes": 60, "outcome": "positive", "assigned_to": "Mark Davis"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[9].id, "activity_type": "meeting", "subject": "Sentinel Cyber SIEM integration kickoff", "description": "Initial technical requirements gathering with security engineering team.", "due_date": now + timedelta(days=3), "is_completed": False, "priority": "normal", "duration_minutes": 60, "assigned_to": "Mark Davis"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[10].id, "activity_type": "meeting", "subject": "Bridgepoint Phase 2 scoping session", "description": "Scoping meeting for predictive maintenance requirements. Need sensor inventory from plant team.", "due_date": now + timedelta(days=5), "is_completed": False, "priority": "high", "duration_minutes": 90, "assigned_to": "Sarah Johnson"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[39].id, "activity_type": "meeting", "subject": "Quarterly business review with Christopher Holt", "description": "QBR to discuss carbon tracking platform adoption and expansion opportunities.", "due_date": now + timedelta(days=10), "is_completed": False, "priority": "normal", "duration_minutes": 60, "assigned_to": "Mark Davis"},
        # Tasks
        {"entity_type": "deal", "entity_id_fn": lambda: deals[0].id, "activity_type": "task", "subject": "Prepare final contract for Pinnacle Dynamics", "description": "Draft final contract incorporating legal redlines from last meeting. Include multi-year discount structure.", "due_date": now + timedelta(days=2), "is_completed": False, "priority": "urgent", "assigned_to": "Sarah Johnson"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[1].id, "activity_type": "task", "subject": "Create Meridian HP implementation timeline", "description": "Build detailed project timeline for 12-hospital EHR rollout with phased go-live dates.", "due_date": now + timedelta(days=4), "is_completed": False, "priority": "high", "assigned_to": "Sarah Johnson"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[2].id, "activity_type": "task", "subject": "Build Crestline custom KPI mockups", "description": "Design mockups for custom KPI builder feature requested during demo.", "due_date": now + timedelta(days=7), "is_completed": False, "priority": "normal", "assigned_to": "Mark Davis"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[22].id, "activity_type": "task", "subject": "Send Phase 2 case study to Patricia Coleman", "description": "Compile and send predictive maintenance case studies from similar manufacturing deployments.", "due_date": now + timedelta(days=3), "is_completed": False, "priority": "normal", "assigned_to": "Sarah Johnson"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[8].id, "activity_type": "task", "subject": "Finalize Terraform Energy SLA document", "description": "Update SLA with 99.95% uptime guarantee and 4-hour response time for P1 incidents.", "due_date": now + timedelta(days=1), "is_completed": False, "priority": "urgent", "assigned_to": "Mark Davis"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[18].id, "activity_type": "task", "subject": "Research Vantage Cloud competitor landscape", "description": "Analyze competitor offerings for infrastructure monitoring to prepare battle cards.", "due_date": now + timedelta(days=6), "is_completed": False, "priority": "low", "assigned_to": "Lisa Chen"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[3].id, "activity_type": "task", "subject": "Schedule Vantage Cloud technical assessment", "description": "Coordinate with solutions engineering for a technical environment assessment.", "due_date": now + timedelta(days=8), "is_completed": False, "priority": "normal", "assigned_to": "Mark Davis"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[33].id, "activity_type": "task", "subject": "Connect Rebecca Dunn with finance team", "description": "Intro Rebecca to our finance team for billing structure discussion on the Northstar deal.", "due_date": now - timedelta(days=1), "completed_at": now - timedelta(days=1), "is_completed": True, "priority": "normal", "outcome": "positive", "assigned_to": "Sarah Johnson"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[7].id, "activity_type": "task", "subject": "Apex Retail needs assessment questionnaire", "description": "Send standard needs assessment questionnaire to understand their POS requirements.", "due_date": now + timedelta(days=5), "is_completed": False, "priority": "low", "assigned_to": "Lisa Chen"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[13].id, "activity_type": "task", "subject": "Prepare Crestline compliance demo environment", "description": "Set up a sandbox environment with sample SEC filing workflows for the demo.", "due_date": now + timedelta(days=12), "is_completed": False, "priority": "normal", "assigned_to": "Lisa Chen"},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[46].id, "activity_type": "task", "subject": "Send Sentinel Cyber security questionnaire", "description": "Complete their vendor security questionnaire (SOC 2 Type II, FedRAMP references).", "due_date": now + timedelta(days=4), "is_completed": False, "priority": "high", "assigned_to": "Mark Davis"},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[14].id, "activity_type": "task", "subject": "Draft Northstar WMS requirements doc", "description": "Document warehouse management system requirements from initial conversations with Jonathan Reed.", "due_date": now + timedelta(days=9), "is_completed": False, "priority": "normal", "assigned_to": "Mark Davis"},
    ]

    activities = []
    for adata in activities_data:
        entity_id_fn = adata.pop("entity_id_fn")
        activity = Activity(entity_id=entity_id_fn(), **adata)
        db.add(activity)
        activities.append(activity)
    db.flush()
    counts["activities"] = len(activities)

    # ------------------------------------------------------------------
    # 6. Notes (20)
    # ------------------------------------------------------------------
    notes_data = [
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[0].id, "content": "David is the primary technical decision maker. Prefers detailed ROI analysis before committing. Has strong influence over Rachel (CTO) on vendor selection.", "pinned": True, "sentiment_score": 0.6},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[1].id, "content": "Rachel mentioned they are evaluating two other vendors. Our key differentiator is the API-first architecture and developer documentation quality.", "pinned": False, "sentiment_score": 0.3},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[0].id, "content": "Pinnacle board approved the budget in their March meeting. James Patel confirmed the purchase order process takes 2-3 weeks internally. We should expect signature by end of month.", "pinned": True, "sentiment_score": 0.8},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[6].id, "content": "Angela is passionate about improving patient outcomes through technology. She pushed hard internally to get this project approved despite budget pressure from the CFO.", "pinned": True, "sentiment_score": 0.7},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[1].id, "content": "The Meridian IT team raised concerns about HIPAA compliance during the demo. We need to provide our compliance documentation and audit reports before they can proceed.", "pinned": False, "sentiment_score": 0.1},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[12].id, "content": "Victoria has been in wealth management for 25 years. She values relationships over aggressive sales tactics. Follow up with thoughtful insights rather than product pitches.", "pinned": True, "sentiment_score": 0.5},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[4].id, "content": "Contract signed! Patricia was instrumental in pushing this through. She personally vouched for our team after the pilot program exceeded KPIs by 23%.", "pinned": True, "sentiment_score": 0.9},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[17].id, "content": "Brandon is exploring partnership opportunities beyond just being a customer. Could be a strong channel partner for cloud consulting referrals.", "pinned": False, "sentiment_score": 0.6},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[6].id, "content": "Northstar is under pressure from their board to reduce delivery costs by 15% this year. Our route optimization engine could be the key to hitting that target.", "pinned": True, "sentiment_score": 0.7},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[22].id, "content": "Patricia mentioned they are considering expanding to a second plant in Tennessee. If Phase 2 goes well, there could be a $500K+ Phase 3 opportunity.", "pinned": True, "sentiment_score": 0.8},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[8].id, "content": "Terraform Energy needs the platform live before the new EPA reporting deadline in Q3. This creates urgency but also risk if we cannot meet the timeline.", "pinned": True, "sentiment_score": 0.4},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[39].id, "content": "Christopher is well-connected in the Denver renewable energy community. He offered to introduce us to two other companies if our platform delivers on carbon tracking.", "pinned": False, "sentiment_score": 0.7},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[12].id, "content": "Lost to MedTech Solutions. Their pricing came in 30% lower. Angela was disappointed but said to stay in touch for future modules. Keep the relationship warm.", "pinned": True, "sentiment_score": -0.5},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[44].id, "content": "Nicole has deep connections in DoD procurement. If we can land Sentinel as a reference customer, it opens the door to larger government contracts.", "pinned": True, "sentiment_score": 0.6},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[9].id, "content": "Sentinel needs FedRAMP authorization before they can proceed. Our FedRAMP Moderate authorization is in progress -- expected completion in 6 weeks.", "pinned": False, "sentiment_score": 0.2},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[26].id, "content": "Olivia is bootstrapping Luminos and watches every dollar. Offer flexible payment terms or a startup discount to win this deal.", "pinned": False, "sentiment_score": 0.3},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[3].id, "content": "Vantage Cloud currently uses a mix of Datadog and custom scripts. Migration path needs to be frictionless to win them over.", "pinned": False, "sentiment_score": 0.2},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[31].id, "content": "Jonathan is a former McKinsey consultant and thinks in terms of frameworks and ROI models. Prepare data-heavy presentations for him.", "pinned": True, "sentiment_score": 0.5},
        {"entity_type": "deal", "entity_id_fn": lambda: deals[11].id, "content": "This deal closed smoothly. The data warehouse migration was completed two weeks ahead of schedule. Great reference case for future cloud migration deals.", "pinned": True, "sentiment_score": 0.9},
        {"entity_type": "contact", "entity_id_fn": lambda: contacts[35].id, "content": "Isabelle is building Apex Retail from the ground up. Very hands-on founder who wants to understand every technical detail. Schedule a deep-dive session.", "pinned": False, "sentiment_score": 0.4},
    ]

    notes = []
    for ndata in notes_data:
        entity_id_fn = ndata.pop("entity_id_fn")
        note = Note(entity_id=entity_id_fn(), **ndata)
        db.add(note)
        notes.append(note)
    db.flush()
    counts["notes"] = len(notes)

    # ------------------------------------------------------------------
    # 7. Email Templates (3)
    # ------------------------------------------------------------------
    templates_data = [
        {
            "name": "Follow Up After Meeting",
            "subject": "Great connecting, {{first_name}} - Next steps for {{company_name}}",
            "body": (
                "<p>Hi {{first_name}},</p>"
                "<p>Thank you for taking the time to meet with us today. It was great learning more about "
                "{{company_name}}'s goals and challenges.</p>"
                "<p>As discussed, here are the next steps:</p>"
                "<ul>"
                "<li>We will send over the detailed proposal by {{follow_up_date}}</li>"
                "<li>Our technical team will prepare the custom demo environment</li>"
                "<li>We will schedule a follow-up call to address any questions</li>"
                "</ul>"
                "<p>In the meantime, I have attached the case studies we referenced during our conversation. "
                "I think you will find the {{industry}} examples particularly relevant.</p>"
                "<p>Please do not hesitate to reach out if you have any questions.</p>"
                "<p>Best regards,<br>{{sender_name}}</p>"
            ),
            "category": "follow_up",
            "variables": ["first_name", "company_name", "follow_up_date", "industry", "sender_name"],
        },
        {
            "name": "Initial Introduction",
            "subject": "Helping {{company_name}} achieve better results",
            "body": (
                "<p>Hi {{first_name}},</p>"
                "<p>I hope this message finds you well. My name is {{sender_name}} and I work with companies "
                "in the {{industry}} space to help them streamline operations and drive growth.</p>"
                "<p>I noticed that {{company_name}} has been {{observation}}, and I believe we could help you "
                "accelerate those efforts with our platform.</p>"
                "<p>Some of our clients in similar positions have seen:</p>"
                "<ul>"
                "<li>30% reduction in operational overhead</li>"
                "<li>2x faster time-to-insight on key metrics</li>"
                "<li>Significant improvement in team productivity</li>"
                "</ul>"
                "<p>Would you be open to a brief 15-minute call this week to explore whether there is a fit? "
                "I am happy to work around your schedule.</p>"
                "<p>Looking forward to hearing from you.</p>"
                "<p>Best,<br>{{sender_name}}</p>"
            ),
            "category": "intro",
            "variables": ["first_name", "company_name", "industry", "observation", "sender_name"],
        },
        {
            "name": "Proposal Follow Up",
            "subject": "Proposal for {{company_name}} - {{deal_title}}",
            "body": (
                "<p>Hi {{first_name}},</p>"
                "<p>I hope you have had a chance to review the proposal we sent over for {{deal_title}}. "
                "I wanted to follow up and see if you have any questions or if there are areas you would "
                "like us to clarify.</p>"
                "<p>To recap the key highlights:</p>"
                "<ul>"
                "<li><strong>Investment:</strong> {{deal_value}}</li>"
                "<li><strong>Timeline:</strong> {{timeline}}</li>"
                "<li><strong>Expected ROI:</strong> {{expected_roi}}</li>"
                "</ul>"
                "<p>We have also included flexible payment options and a satisfaction guarantee to make "
                "the decision easier for your team.</p>"
                "<p>I would love to schedule a brief call to walk through any outstanding items and discuss "
                "next steps. Would {{suggested_date}} work for you?</p>"
                "<p>Thank you for considering us, {{first_name}}. We are excited about the opportunity to "
                "partner with {{company_name}}.</p>"
                "<p>Warm regards,<br>{{sender_name}}</p>"
            ),
            "category": "proposal",
            "variables": ["first_name", "company_name", "deal_title", "deal_value", "timeline", "expected_roi", "suggested_date", "sender_name"],
        },
    ]

    templates = []
    for tdata in templates_data:
        template = EmailTemplate(**tdata)
        db.add(template)
        templates.append(template)
    db.flush()
    counts["email_templates"] = len(templates)

    # ------------------------------------------------------------------
    # Commit everything
    # ------------------------------------------------------------------
    db.commit()

    logger.info(
        f"[Seed] Demo data seeded successfully: "
        f"{counts['companies']} companies, {counts['contacts']} contacts, "
        f"{counts['deals']} deals, {counts['activities']} activities, "
        f"{counts['notes']} notes, {counts['tags']} tags, "
        f"{counts['email_templates']} email templates"
    )

    return counts
