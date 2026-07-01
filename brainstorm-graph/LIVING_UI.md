# Brainstorm Graph

Agentic brainstorming tool: give a topic and CraftBot spawns a growing graph of questions, answers, and ideas. Two views: Obsidian-style graph canvas and tree outline. CraftBot drives exploration autonomously.

## Overview

Brainstorm Graph turns a single topic into an ever-growing knowledge graph. Users create named sessions, each anchored by a root topic node. CraftBot can then autonomously explore the graph — picking which leaf to expand next, generating child questions, and writing answers — while users can also intervene manually: adding nodes, answering questions themselves, or directing CraftBot to a specific node.

**Primary demo value:** CraftBot visibly operating a Living UI via `expand_node`, `answer_node`, and `explore` actions while the graph grows in real time.

## Requirements

### Entities & Data Model
- Named sessions (title + topic), multiple per install
- Nodes: content, type (question/answer/idea), created by (user/agent), position (x/y for graph)
- Tree structure: each node has a single parent_id; root nodes have no parent

### Layout & Design
- Dark theme, primary color #FF4F18
- Left sidebar (220px): session list with CRUD
- Right main area: toolbar (session name, node count, AI Explore button, view toggle) + canvas/tree
- Graph view: 3000×3000 pan canvas, dot-grid background, SVG bezier edges, draggable node cards
- Tree view: collapsible nested list, Obsidian file-explorer style

### Features
- Session CRUD: create with title+topic, rename inline, delete with cascade
- Node types: question (blue), answer (green), idea (orange/primary)
- Node actions: Expand (AI adds children), Answer (AI answers a question), Add child (manual), Delete
- Graph: pan canvas, drag nodes to reposition, SVG bezier connection lines
- Tree: collapse/expand branches, same actions available on hover
- AI Explore: CraftBot picks the best node to expand next (agentic, not BFS/DFS)
- CraftBot agent can call `expand_node`, `answer_node`, `explore` via `/api/action`

### Assumptions
- No auth; single-user local tool
- SQLite for persistence; no migration tooling needed
- Integration bridge (`integration.llm_complete`) used for all AI; fallback placeholder text when bridge unavailable
- Edges are implied by parent_id (tree), no cross-links

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| BrainstormSession | A named brainstorming session | id, title, topic, created_at, updated_at |
| BrainstormNode | A node in the graph | id, session_id (FK), parent_id (FK nullable), content, node_type (question/answer/idea), created_by (user/agent), x, y, depth, created_at, updated_at |

Also keeps template models: AppState, UISnapshot, UIScreenshot.

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | /sessions | List all sessions, newest first |
| POST | /sessions | Create session + root node; returns `{session, rootNode}` |
| PUT | /sessions/{id} | Rename session `{title}` |
| DELETE | /sessions/{id} | Delete session + all nodes |
| GET | /sessions/{id}/nodes | All nodes for session |
| POST | /sessions/{id}/explore | AI picks best leaf to expand (agentic explore) |
| POST | /nodes | Create node manually `{session_id, parent_id, content, node_type}` |
| PUT | /nodes/{id} | Update `{content?, x?, y?, node_type?}` |
| DELETE | /nodes/{id} | Delete node + subtree |
| POST | /nodes/{id}/expand | AI generates 3–5 child questions |
| POST | /nodes/{id}/answer | AI writes an answer to a question node |
| GET | /state | Template: get/set app state |
| PUT | /state | Template: set app state |
| POST | /state | Template: set app state (alias) |
| DELETE | /state | Template: clear app state |
| GET | /ui-snapshot | Agent: full UI snapshot |
| GET | /ui-screenshot | Agent: screenshot |
| POST | /action | Agent: execute action (`expand_node`, `answer_node`, `explore`) |

## Frontend Components

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Root layout: sidebar + toolbar + view area + modals |
| SessionSidebar.tsx | Session list, create/rename/delete, active highlight |
| GraphView.tsx | 3000×3000 pan canvas, SVG bezier edges, draggable NodeCards |
| NodeCard.tsx | Absolutely-positioned card with type badge, content, action buttons |
| TreeView.tsx | Recursive collapsible nested list view |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | BrainstormSession + BrainstormNode SQLAlchemy models |
| backend/routes.py | All API routes including agent expand/answer/explore |
| backend/tests/test_sessions.py | 9 session CRUD tests |
| backend/tests/test_nodes.py | 17 node + agent action tests |
| frontend/types.ts | TypeScript interfaces (BrainstormSession, BrainstormNode, AppState) |
| frontend/AppController.ts | State management, all API calls, agent method wrappers |
| frontend/components/MainView.tsx | Root layout |
| frontend/components/SessionSidebar.tsx | Session management sidebar |
| frontend/components/GraphView.tsx | SVG canvas graph view |
| frontend/components/NodeCard.tsx | Draggable node card |
| frontend/components/TreeView.tsx | Collapsible tree outline |

## State Flow

```
User clicks "Expand" → NodeCard → MainView.handleExpand(id)
  → AppController.expandNode(id) → POST /api/nodes/{id}/expand
  → backend calls integration.llm_complete() → returns child nodes
  → AppController patches {nodes: [...prev, ...newNodes]}
  → React re-renders GraphView / TreeView
```

CraftBot agent path:
```
POST /api/action {action: "expand_node", payload: {node_id: 42}}
  → routes._run_expand(db, node_id)
  → new nodes inserted → returns {status, newNodes}
Frontend auto-refreshes via /api/ui-snapshot polling
```

## Testing

```bash
# Backend
cd backend
python3 -m pytest tests/ -v   # 26 tests, all green

# Frontend build
cd ..
npm install && npm run build

# Local dev run
python3 setup_local.py --port 3101 --frontend-port 3102
cd backend && uvicorn main:app --port 3101 &
cd .. && npm run preview -- --port 3102
```

Browser verification:
1. Create a session (title: "AI Research", topic: "Artificial Intelligence")
2. Root node appears in graph view
3. Click Expand on root → AI spawns 3–5 child questions
4. Click AI Explore → agent picks a leaf and expands it
5. Switch to tree view → same nodes shown as nested outline
6. Add manual child → modal opens, type content, add
7. Delete a node → children also removed
8. Rename session → sidebar updates inline
