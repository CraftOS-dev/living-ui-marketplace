# CRM System

Comprehensive CRM system with contacts, companies, deals pipeline, AI-powered lead scoring, personalized email generation, sales forecasting, SMTP email, campaigns, and full reporting. Inspired by HubSpot and Salesforce.

## Overview

A full-featured single-user CRM built as a CraftBot Living UI app. Manages the complete sales lifecycle from lead capture to deal close, with AI-powered features for lead scoring, email generation, sales forecasting, meeting summaries, sentiment analysis, and a conversational CRM assistant.

## Requirements

| Decision | Choice |
|----------|--------|
| User model | Single-user (no auth) |
| Pipeline stages | Extended 8-stage: New Lead > Contacted > Qualified > Demo/Meeting > Proposal > Negotiation > Closed Won > Closed Lost |
| Demo data | Yes - ~50 contacts, 10 companies, 15 deals, sample activities |
| AI behavior | On-demand only (user clicks buttons) |
| Email | SMTP support - user configures server, email, credentials |
| Reports | Full reports with date ranges, grouping, chart visualizations |
| Attachments | File attachments on contacts, deals, companies (stored locally) |
| Data scale | Large (thousands) - server-side pagination, indexing |

### Entities & Data Model

| Entity | Key Fields | Relationships |
|--------|-----------|---------------|
| Contact | firstName, lastName, email, phone, jobTitle, leadScore, leadStatus | belongs to Company, has many Tags, linked to Deals |
| Company | name, domain, industry, size, annualRevenue | has many Contacts, has many Deals, self-referential parent |
| Deal | title, value, currency, probability, status, priority, position | belongs to Stage, belongs to Company, linked to Contacts |
| DealStage | name, position, probabilityDefault, color, isClosedWon/Lost | has many Deals |
| Activity | entityType, entityId, activityType, subject, dueDate, isCompleted | polymorphic to Contact/Deal/Company |
| Note | entityType, entityId, content, pinned, sentimentScore | polymorphic to Contact/Deal/Company |
| Tag | name, color | many-to-many with Contact, Company, Deal |
| EmailTemplate | name, subject, body, category, variables | standalone |
| Campaign | name, type, status, subject, body, stats | has many CampaignContacts |
| LeadCaptureForm | name, fields, tagIds, active, submissionsCount | standalone |
| SmtpConfig | smtpServer, smtpPort, emailAddress, password, useTls | singleton |
| EmailLog | contactId, toEmail, subject, body, status | belongs to Contact |
| Attachment | entityType, entityId, fileName, filePath, fileSize | polymorphic |
| CustomField | entityType, fieldName, fieldLabel, fieldType | standalone |
| ImportJob | entityType, fileName, status, importedRows, skippedRows | standalone |
| LeadScore | contactId, score, factors, reasoning | belongs to Contact |
| SalesForecast | dealId, closeProbability, predictedCloseDate, reasoning | belongs to Deal |
| MeetingSummary | activityId, summary, actionItems, keyTopics | belongs to Activity |
| SentimentRecord | entityType, entityId, score, label | polymorphic |
| ChatMessage | role, content, queryType, resultData | standalone |

### Layout & Design

- **Layout**: Left sidebar (240px) + top bar + scrollable main content
- **Colors**: Primary #6366f1, Secondary #8b5cf6, Accent #06b6d4
- **Theme**: System (follows OS light/dark)
- **Navigation**: 13 sidebar items with emoji icons and count badges

### Features

- Full CRUD for contacts, companies, deals, activities, notes, tags, templates
- Kanban-style deal pipeline with drag-and-drop
- Global search across all entities
- Server-side pagination (50 items per page)
- CSV import/export
- File attachments
- SMTP email sending
- Email campaigns with contact tracking
- Lead capture forms
- Full reports (Sales, Activity, Conversion funnel)
- Calendar view for activities
- Task management with grouping
- Custom fields per entity type
- AI: Lead scoring, email generation, sales forecasting, meeting summaries, sentiment analysis, chat assistant, contact enrichment
- Demo data seeding

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET/PUT/POST/DELETE | /api/state | App state management |
| POST | /api/action | Execute actions |
| GET/POST | /api/ui-snapshot | UI observation (agent) |
| GET/POST | /api/ui-screenshot | Visual observation (agent) |
| GET/POST | /api/contacts | List/create contacts |
| GET/PUT/DELETE | /api/contacts/{id} | Contact CRUD |
| GET | /api/contacts/{id}/timeline | Contact activity timeline |
| GET | /api/contacts/search | Search contacts |
| GET | /api/contacts/duplicates | Find duplicates |
| POST | /api/contacts/merge | Merge contacts |
| POST | /api/contacts/bulk-delete | Bulk delete |
| POST | /api/contacts/bulk-tag | Bulk tag |
| GET/POST | /api/companies | List/create companies |
| GET/PUT/DELETE | /api/companies/{id} | Company CRUD |
| GET | /api/companies/{id}/contacts | Company contacts |
| GET | /api/companies/{id}/deals | Company deals |
| GET/POST | /api/stages | List/create stages |
| PUT/DELETE | /api/stages/{id} | Stage CRUD |
| PUT | /api/stages/reorder | Reorder stages |
| GET/POST | /api/deals | List/create deals |
| GET | /api/deals/pipeline | Pipeline view |
| POST | /api/deals/bulk-update | Bulk update |
| GET/PUT/DELETE | /api/deals/{id} | Deal CRUD |
| PUT | /api/deals/{id}/move | Kanban move |
| POST/DELETE | /api/deals/{id}/contacts | Link/unlink contacts |
| GET/POST | /api/activities | List/create activities |
| GET | /api/activities/upcoming | Upcoming activities |
| GET | /api/activities/overdue | Overdue activities |
| GET | /api/activities/calendar | Calendar range query |
| GET/PUT/DELETE | /api/activities/{id} | Activity CRUD |
| PUT | /api/activities/{id}/complete | Toggle complete |
| GET/POST | /api/notes | List/create notes |
| PUT/DELETE | /api/notes/{id} | Note CRUD |
| PUT | /api/notes/{id}/pin | Toggle pin |
| GET/POST | /api/tags | List/create tags |
| PUT/DELETE | /api/tags/{id} | Tag CRUD |
| GET/POST | /api/email-templates | List/create templates |
| GET/PUT/DELETE | /api/email-templates/{id} | Template CRUD |
| POST | /api/email-templates/{id}/render | Render template |
| GET | /api/dashboard/summary | Dashboard metrics |
| GET | /api/dashboard/pipeline | Pipeline summary |
| GET | /api/dashboard/recent-activities | Recent activities |
| GET | /api/dashboard/upcoming-tasks | Upcoming tasks |
| GET | /api/reports/sales | Sales report |
| GET | /api/reports/conversion | Conversion funnel |
| GET | /api/reports/activity | Activity report |
| GET | /api/search | Global search |
| GET/POST | /api/custom-fields | List/create fields |
| PUT/DELETE | /api/custom-fields/{id} | Field CRUD |
| POST | /api/import/contacts | Import contacts |
| POST | /api/import/companies | Import companies |
| GET | /api/export/contacts | Export CSV |
| GET | /api/export/deals | Export CSV |
| GET | /api/import/jobs | Import history |
| POST | /api/attachments | Upload attachment |
| GET | /api/attachments/{type}/{id} | List attachments |
| GET | /api/attachments/download/{id} | Download file |
| DELETE | /api/attachments/{id} | Delete attachment |
| GET/PUT | /api/smtp/config | SMTP configuration |
| POST | /api/smtp/test | Test SMTP |
| POST | /api/email/send | Send email |
| GET | /api/email/logs | Email logs |
| GET | /api/email/logs/{contactId} | Contact emails |
| GET/POST | /api/campaigns | List/create campaigns |
| GET/PUT/DELETE | /api/campaigns/{id} | Campaign CRUD |
| POST | /api/campaigns/{id}/send | Send campaign |
| POST | /api/campaigns/{id}/contacts | Add contacts |
| GET | /api/campaigns/{id}/analytics | Campaign analytics |
| GET/POST | /api/forms | List/create forms |
| GET/PUT/DELETE | /api/forms/{id} | Form CRUD |
| POST | /api/forms/{id}/submit | Submit form |
| POST | /api/ai/score-lead/{id} | AI lead scoring |
| POST | /api/ai/score-leads | Batch scoring |
| POST | /api/ai/generate-email | AI email writer |
| POST | /api/ai/forecast-deal/{id} | AI deal forecast |
| POST | /api/ai/forecast-revenue | Revenue forecast |
| POST | /api/ai/summarize-meeting/{id} | Meeting summary |
| POST | /api/ai/analyze-sentiment | Sentiment analysis |
| POST | /api/ai/enrich-contact/{id} | Contact enrichment |
| POST | /api/ai/chat | AI chat assistant |
| GET | /api/ai/chat/history | Chat history |
| POST | /api/seed/demo-data | Seed demo data |
| DELETE | /api/seed/reset | Reset all data |

## Frontend Components

| Component | Description |
|-----------|-------------|
| MainView | App shell with sidebar routing |
| Sidebar | Left navigation with 13 modules |
| TopBar | Search bar and AI chat toggle |
| AIChatPanel | Slide-out AI assistant |
| DashboardPage | KPI cards, pipeline chart, activities, tasks |
| ContactsPage | Table, detail panel, AI scoring |
| CompaniesPage | Table, detail panel |
| DealsPage | Kanban + Table view, drag-and-drop |
| ActivitiesPage | Filterable activity list |
| TasksPage | Grouped by due date |
| CalendarPage | Month calendar grid |
| TemplatesPage | Email template editor |
| CampaignsPage | Campaign management |
| FormsPage | Lead capture form builder |
| ReportsPage | Sales, Activity, Conversion tabs |
| ImportExportPage | JSON import, CSV export |
| SettingsPage | Stages, Tags, SMTP, Data management |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | 25 SQLAlchemy models |
| backend/routes.py | ~120 API endpoints |
| backend/ai_service.py | CRMAIService wrapping CraftBot LLM |
| backend/ai_prompts.py | All AI prompt templates |
| backend/email_service.py | SMTP email sending |
| backend/seed_data.py | Demo data generator |
| frontend/types.ts | All TypeScript interfaces |
| frontend/AppController.ts | State management, API calls |
| frontend/components/MainView.tsx | App shell layout |
| frontend/components/pages/*.tsx | 13 page components |
| config/manifest.json | Project config (ports 3112/3113) |
