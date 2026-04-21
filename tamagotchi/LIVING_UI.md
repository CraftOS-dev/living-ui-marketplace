# Tamagotchi - CraftBot Pet

A fun, interactive, and cute virtual pet app themed around CraftBot. The pet is a tiny cat-bot (CraftBot-themed robot with cat-like features) that the user must care for by feeding, playing, sleeping, cleaning, and giving medicine. The pet evolves through 5 life stages and eventually retires with a ceremony, allowing the user to hatch a new egg.

## Overview

CraftBot Pet is a Tamagotchi-style virtual pet app. The user adopts a CraftBot cat-bot that has classic needs (hunger, happiness, health) that decay over time. The user must interact with the pet to keep it alive and happy. As the pet is well cared for, it evolves through life stages. At the final stage (Adult), the pet retires with a special ceremony and the user can hatch a new egg to start again.

## Requirements

### Entities & Data Model

**Pet**
- id, name, stage (egg/baby/child/teen/adult)
- hunger, happiness, health (Float 0-100)
- is_sleeping, is_sick, is_retired (Boolean)
- evolution_points (Int), age_minutes (Float)
- cooldowns (JSON), last_updated (DateTime)
- created_at, retired_at

**ActivityLog**
- id, pet_id (FK), action, description, timestamp

### Layout & Design

- Full modern dashboard layout
- Left/center: Large pet display area with SVG illustration + action buttons + activity log
- Right panel: Stats (hunger, happiness, health bars), age, stage info, evolution progress
- Colors: CraftBot theme - Primary #6366f1 (indigo), Secondary #8b5cf6 (purple), Accent #06b6d4 (cyan)
- Theme: Follow system (dark/light)
- Pet rendered as SVG illustration - cute cat-bot with CraftBot aesthetic
- Mood-based visual states for the pet SVG

### Features

**Feature 1: Pet Core & Stats** ✅
- Single pet entity stored in database
- Stats: hunger (0-100), happiness (0-100), health (0-100)
- Stats decay over real time (hunger 2/min, happiness 1/min, health 0.5/min)
- Backend calculates current stats based on last_updated timestamp
- GET /api/pet, POST /api/pet, PUT /api/pet/tick

**Feature 2: Care Actions** ✅
- Feed: hunger +30, happiness +5, cooldown 30s
- Play: happiness +25, hunger -5, cooldown 60s
- Sleep: is_sleeping=true, slower decay, health recovers
- Wake: is_sleeping=false
- Clean: happiness +10, health +5, cooldown 120s
- Medicine: is_sick=false, health +20, happiness -5, cooldown 60s
- All actions logged to ActivityLog

**Feature 3: Evolution & Life Cycle** ✅
- 5 stages: egg (0-50 evo pts), baby (50-150), child (150-300), teen (300-500), adult (500+)
- Evolution points earned by keeping stats above 70 (2 pts/min)
- Evolution triggers automatically when threshold reached
- At adult stage with 700+ evo pts: retirement ceremony available
- Retirement: special modal, pet retires, is_retired=true
- After retirement: memorial + "Hatch New Egg" button

**Feature 4: Moods & SVG Pet Display** ✅
- Mood computed from stats: happy, excited, neutral, hungry, sad, sick, sleeping, critical
- SVG pet changes appearance based on mood and stage
- Egg: glowing egg with CraftBot logo
- Baby/Child/Teen/Adult: cat-bot with growing features, antenna (teen+), circuits (adult)
- Mood expressions: eyes/mouth change per mood
- Bounce animation when active

**Feature 5: Activity Log & History** ✅
- Shows last 20 actions with icon, description, relative timestamp
- Scrollable list below the pet display
- GET /api/pet/activity

### Assumptions

- Single user, single pet at a time (no multi-user)
- Stats decay calculated server-side based on elapsed time
- Time accelerated for fun gameplay
- Pet can get sick randomly if health drops below 20
- No death mechanic — critical state instead
- Mobile responsive design

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| Pet | The virtual pet entity | name, stage, hunger, happiness, health, is_sleeping, is_sick, is_retired, evolution_points, cooldowns, last_updated |
| ActivityLog | Log of all care actions | pet_id, action, description, timestamp |
| AppState | Generic state storage | data (JSON) |
| UISnapshot | Agent UI observation | html_structure, visible_text, component_state |
| UIScreenshot | Agent visual observation | image_data, width, height |

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/pet | Get current pet state (with calculated stats) |
| POST | /api/pet | Create new pet (hatch egg) |
| PUT | /api/pet/tick | Update stats based on elapsed time |
| POST | /api/pet/feed | Feed the pet (hunger +30, cooldown 30s) |
| POST | /api/pet/play | Play with the pet (happiness +25, cooldown 60s) |
| POST | /api/pet/sleep | Put pet to sleep |
| POST | /api/pet/wake | Wake pet up |
| POST | /api/pet/clean | Clean the pet (cooldown 120s) |
| POST | /api/pet/medicine | Give medicine (cures sick, cooldown 60s) |
| GET | /api/pet/evolution-status | Check evolution/retirement readiness |
| POST | /api/pet/retire | Trigger retirement ceremony |
| GET | /api/pet/activity | Get recent activity log (last 20) |
| GET | /api/pet/retired | Get most recently retired pet |

## Frontend Components

### Components (frontend/components/)

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Main dashboard layout — header, 2-col grid, loading/error/no-pet states |
| PetDisplay.tsx | SVG cat-bot with stage-based sizing, mood expressions, bounce animation |
| StatsPanel.tsx | Hunger/happiness/health bars, age, stage badge, evolution progress |
| ActionButtons.tsx | 5 care action buttons with live cooldown timers, toast notifications |
| ActivityLog.tsx | Scrollable activity history with relative timestamps |
| RetirementModal.tsx | Two-phase retirement ceremony modal |
| HatchEggView.tsx | Empty state — animated egg, name input, retired pet memorial |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | Pet, ActivityLog, AppState, UISnapshot, UIScreenshot models |
| backend/routes.py | All API endpoints |
| backend/tests/test_pet_core.py | 9 tests for pet core (all passing) |
| backend/tests/test_care_actions.py | 19 tests for care actions (all passing) |
| backend/tests/test_evolution.py | 10 tests for evolution/retirement (all passing) |
| backend/tests/test_moods.py | 10 tests for mood computation (all passing) |
| backend/tests/test_activity_log.py | 11 tests for activity log (all passing) |
| frontend/types.ts | TypeScript interfaces + STAGE_INFO, MOOD_INFO, ACTION_INFO |
| frontend/AppController.ts | Pet state management, polling (10s), care action methods |
| frontend/components/MainView.tsx | Main dashboard layout |
| frontend/components/PetDisplay.tsx | SVG pet with mood states |
| frontend/components/StatsPanel.tsx | Stats bars + evolution progress |
| frontend/components/ActionButtons.tsx | Care action buttons with cooldowns |
| frontend/components/ActivityLog.tsx | Activity history |
| frontend/components/RetirementModal.tsx | Retirement ceremony |
| frontend/components/HatchEggView.tsx | Empty state / hatch screen |

## State Flow

```
User Action → ActionButtons → AppController.performAction() → POST /api/pet/{action}
                                    ↓
              Poll every 10s → GET /api/pet → Update UI State
                                    ↓
                         PetDisplay + StatsPanel re-render
```

## Test Results

- Total: 59 tests, 59 passing, 0 failing
- test_pet_core.py: 9/9 ✅
- test_care_actions.py: 19/19 ✅
- test_evolution.py: 10/10 ✅
- test_moods.py: 10/10 ✅
- test_activity_log.py: 11/11 ✅

## Feature Implementation Status

- [x] Feature 1: Pet Core & Stats
- [x] Feature 2: Care Actions
- [x] Feature 3: Evolution & Life Cycle
- [x] Feature 4: Moods & SVG Pet Display
- [x] Feature 5: Activity Log & History
