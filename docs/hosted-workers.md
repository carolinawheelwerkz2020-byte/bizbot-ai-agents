# Hosted Mac and Windows Workers

BizBot can run as a hosted Firebase/Cloud Run control plane while Mac, Windows, or Linux machines act as execution workers.

Use polling mode for normal home and office networks. Polling mode does not require opening router ports or exposing `localhost`.

## Mac Mini Worker

```bash
cd /path/to/bizbot-ai-agents
WORKER_POLL_MODE=true \
WORKER_MAIN_API_URL=https://cww-agents.web.app \
WORKER_API_KEY=your-shared-worker-key \
WORKER_ID=mac-mini \
WORKER_NAME="Mac mini worker" \
WORKER_ROOT="$PWD" \
npm run worker
```

## Windows Worker

PowerShell:

```powershell
cd C:\path\to\bizbot-ai-agents
$env:WORKER_POLL_MODE="true"
$env:WORKER_MAIN_API_URL="https://cww-agents.web.app"
$env:WORKER_API_KEY="your-shared-worker-key"
$env:WORKER_ID="windows-laptop"
$env:WORKER_NAME="Windows laptop worker"
$env:WORKER_ROOT=$PWD.Path
npm run worker
```

## How It Works

- The hosted app creates worker jobs in Firestore.
- Each worker polls the hosted API for jobs assigned to it.
- The worker executes shell or filesystem tasks inside `WORKER_ROOT`.
- The worker posts results back to the hosted API.
- The hosted agent receives the tool result and continues the workflow.

## Security

Set `WORKER_API_KEY` in Firebase Functions secrets and on every trusted worker before using this outside local development.
