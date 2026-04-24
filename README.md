<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/ff3bf5b0-7aab-4cf8-97e8-e0f8c60df3b4

## Firebase web config (hosted + local)

- **Firebase Hosting** (`*.web.app`): the app loads `/__/firebase/init.json` at runtime, so you do not have to inject `VITE_FIREBASE_*` into every CI build for production.
- **Local `vite dev`**: set `VITE_FIREBASE_*` in `.env.local` (see `.env.example`).

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Agent Freedom Controls

The local BizBot runtime has configurable autonomy controls in `.env`/`.env.local`:

- `RELAY_ALLOWED_COMMANDS` controls what executables agents can run.
- `RELAY_ALLOW_SHELL_OPERATORS=true` allows chained commands like `cmd1 && cmd2`.
- `BIZBOT_AUTO_APPROVE_ACTIONS` can auto-approve selected actions for trusted roles.

Example:

```env
RELAY_ALLOWED_COMMANDS=*
RELAY_ALLOW_SHELL_OPERATORS=true
BIZBOT_AUTO_APPROVE_ACTIONS=register_tool,save_healing_recipe,run_healing_recipe
```

## Security (auth bypass)

- **Server / Cloud Functions:** `AUTH_DISABLED=true` alone does not disable auth when `NODE_ENV=production`. For a deliberate insecure deployment only, set `ALLOW_INSECURE_CLOUD_AUTH_BYPASS=true` as well (not recommended for public URLs).
- **Web client:** `VITE_AUTH_DISABLED=true` skips Firebase Auth only in Vite dev. For a production build, the same requires `VITE_ALLOW_INSECURE_CLOUD_AUTH_BYPASS=true`.
- Prefer **tight `ALLOWED_EMAILS`** and **Secret Manager** for API keys; avoid `firebase deploy --debug` in CI (logs can echo config).

## Firebase deploy (functions)

If the CLI times out during function discovery, use a longer timeout (the `deploy:functions` script sets 120s):

`npm run deploy:functions`

Typical full UI + API rollout:

`npm run deploy:app` (hosting build, then functions).

**GCP — Compute Engine API:** If deploy logs mention it, enable for **`cww-agents`** (or set `GCP_PROJECT_ID`):

- **Console (one click):** [Enable Compute Engine API for `cww-agents`](https://console.cloud.google.com/apis/library/compute.googleapis.com?project=cww-agents) — use **Enable**.
- **CLI:** After `gcloud auth login`, run `npm run gcp:enable-compute` (uses `scripts/gcp-enable-compute.sh`). If `gcloud` is not on your `PATH`, install the SDK from [Cloud SDK install](https://cloud.google.com/sdk/docs/install); a user-local install often lives at `~/google-cloud-sdk/google-cloud-sdk/bin/gcloud`.
