# BizBot Multi-Device Architecture

This repo now has the first architecture seam for running BizBot from any device while keeping machine-local execution safe.

## Control Plane

The main API server owns orchestration:

- chat and model calls
- approval policy
- run history and templates
- worker registry
- capability-based execution routing

Browser clients should call same-origin `/api/*` by default or set `VITE_API_BASE_URL` when the API is hosted separately.

## Worker Plane

Worker nodes represent machines that can execute local-only capabilities:

- `shell`
- `filesystem`
- `git`
- `npm`
- `playwright`
- `browser`
- `tool`

Workers register with:

```http
POST /api/workers/register
```

Workers keep themselves online with:

```http
POST /api/workers/:id/heartbeat
```

The server can ask a specific worker to run a task with:

```http
POST /api/workers/:id/run
```

The dashboard/API status shape is exposed at:

```http
GET /api/workers/status
```

## Execution Routing

Execution goes through:

```http
POST /api/relay/execute
```

The existing compatibility endpoints still work:

- `POST /api/relay/exec`
- `GET /api/relay/read`
- `POST /api/relay/write`
- `POST /api/relay/edit`

Those endpoints now route through the execution router instead of directly binding the frontend to `localhost`.

## Running The Pieces

Run the main server:

```bash
npm run dev
```

Run a Mac worker:

```bash
WORKER_MAIN_API_URL=http://localhost:3000 \
WORKER_NAME="Mac Mini Worker" \
WORKER_ROOT="/Users/bobbysanderlin/Desktop/bizbot-ai-agents" \
npm run worker
```

Run a Windows worker from PowerShell:

```powershell
$env:WORKER_MAIN_API_URL="http://MAIN-SERVER-LAN-IP:3000"
$env:WORKER_NAME="Windows Laptop Worker"
$env:WORKER_ROOT="C:\path\to\bizbot-ai-agents"
npm run worker
```

For a worker on another device, `WORKER_HOST` must be reachable by the main server, for example:

```bash
WORKER_HOST=http://192.168.1.50:4317
```

## Storage Direction

The current default is `BIZBOT_STORAGE_MODE=local-json` to preserve desktop behavior.

The Firestore adapter and collection names are in place for shared storage migration:

- approvals
- schedules
- run history
- templates
- neural memory
- registered tools
- healing recipes
- browser trace metadata
- worker registry

Machine-local artifacts should stay local:

- screenshots
- browser artifacts
- temporary uploads
- local repo workspaces

## Migration Order

1. Keep local JSON as default.
2. Move one collection at a time behind storage adapters.
3. Register Mac/Windows/Linux workers.
4. Move browser/file/shell requests through worker capabilities.
5. Keep approvals around privileged actions before execution.
